import { ConnectionState, FileTransfer, ChatMessage, FileMetadata, IceServerConfig } from '../types';
import { saveChunk, clearTransfer, assembleFile } from './db';

const CHUNK_SIZE = 16384; // 16 KB chunks for high compatibility and throughput
const BUFFERED_AMOUNT_THRESHOLD = 1048576; // 1 MB backpressure limit

export interface WebRTCEvents {
  onConnectionStateChange: (state: ConnectionState) => void;
  onMessageReceived: (message: ChatMessage) => void;
  onSignalingMessage: (msg: unknown) => void;
  onFileTransferUpdate: (transfer: FileTransfer) => void;
  onToast: (message: string, type: 'info' | 'success' | 'warning' | 'error') => void;
}

export class WebRTCManager {
  private pc: RTCPeerConnection | null = null;
  private chatChannel: RTCDataChannel | null = null;
  private fileChannel: RTCDataChannel | null = null;
  
  private events: WebRTCEvents;
  private iceServers: IceServerConfig[] = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }
  ];
  
  private iceCandidateQueue: RTCIceCandidateInit[] = [];
  
  // File Transfer State (Sender)
  private currentSenderFile: File | null = null;
  private currentSenderIndex = 0;
  private isSenderCancelled = false;
  private isReadingChunk = false;
  private senderTimer: NodeJS.Timeout | null = null;
  
  // File Transfer State (Receiver)
  private currentReceiverMetadata: FileMetadata | null = null;
  private currentReceiverIndex = 0;
  private bytesReceived = 0;
  private receiverStartTime = 0;
  private isReceiverCancelled = false;
  private receiverTimer: NodeJS.Timeout | null = null;
  private pendingSavePromises: Promise<void>[] = [];

  // Active File Transfer info
  private activeTransfer: FileTransfer | null = null;

  constructor(events: WebRTCEvents, customTurn?: IceServerConfig) {
    this.events = events;
    if (customTurn && customTurn.urls.length > 0) {
      this.iceServers = [...this.iceServers, customTurn];
    }
  }

  public initialize(isInitiator: boolean) {
    this.cleanup();
    this.events.onConnectionStateChange('connecting');

    try {
      this.pc = new RTCPeerConnection({
        iceServers: this.iceServers,
        iceCandidatePoolSize: 10
      });

      this.pc.onicecandidate = (event) => {
        if (event.candidate) {
          this.events.onSignalingMessage({
            type: 'candidate',
            candidate: event.candidate
          });
        }
      };

      this.pc.oniceconnectionstatechange = () => {
        this.handleIceConnectionStateChange();
      };

      this.pc.onconnectionstatechange = () => {
        this.handleConnectionStateChange();
      };

      if (isInitiator) {
        // Initiator creates data channels
        this.setupChatChannel(this.pc.createDataChannel('chat', { ordered: true }));
        this.setupFileChannel(this.pc.createDataChannel('file', { ordered: true }));
        
        this.createOffer();
      } else {
        // Receiver waits for channels
        this.pc.ondatachannel = (event) => {
          const channel = event.channel;
          if (channel.label === 'chat') {
            this.setupChatChannel(channel);
          } else if (channel.label === 'file') {
            this.setupFileChannel(channel);
          }
        };
      }
    } catch (error) {
      this.events.onToast(`RTC connection setup failed: ${(error as Error).message}`, 'error');
      this.events.onConnectionStateChange('failed');
    }
  }

  private handleIceConnectionStateChange() {
    if (!this.pc) return;
    const state = this.pc.iceConnectionState;
    if (state === 'checking') {
      this.events.onConnectionStateChange('negotiating');
    } else if (state === 'connected' || state === 'completed') {
      this.events.onConnectionStateChange('connected');
    } else if (state === 'disconnected') {
      this.events.onConnectionStateChange('reconnecting');
    } else if (state === 'failed') {
      this.events.onConnectionStateChange('failed');
    }
  }

  private handleConnectionStateChange() {
    if (!this.pc) return;
    const state = this.pc.connectionState;
    if (state === 'connecting') {
      this.events.onConnectionStateChange('connecting');
    } else if (state === 'connected') {
      this.events.onConnectionStateChange('connected');
    } else if (state === 'disconnected') {
      this.events.onConnectionStateChange('disconnected');
    } else if (state === 'failed') {
      this.events.onConnectionStateChange('failed');
    }
  }

  private setupChatChannel(channel: RTCDataChannel) {
    this.chatChannel = channel;
    this.chatChannel.onopen = () => {
      this.events.onToast('Chat channel connected', 'success');
    };
    this.chatChannel.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const msg: ChatMessage = {
          id: data.id || Math.random().toString(36).substr(2, 9),
          sender: 'peer',
          text: data.text,
          timestamp: data.timestamp || Date.now()
        };
        this.events.onMessageReceived(msg);
      } catch (err) {
        console.error('Failed to parse chat message', err);
      }
    };
    this.chatChannel.onclose = () => {
      this.events.onToast('Chat channel closed', 'info');
    };
  }

  private setupFileChannel(channel: RTCDataChannel) {
    this.fileChannel = channel;
    this.fileChannel.binaryType = 'arraybuffer';
    
    this.fileChannel.onopen = () => {
      this.events.onToast('File channel connected', 'success');
    };

    this.fileChannel.onmessage = async (event) => {
      if (typeof event.data === 'string') {
        // Handle control messages
        try {
          const msg = JSON.parse(event.data);
          await this.handleFileControlMessage(msg);
        } catch (err) {
          console.error('Failed to parse file control message', err);
        }
      } else if (event.data instanceof ArrayBuffer) {
        // Handle incoming chunk
        await this.handleIncomingChunk(event.data);
      }
    };

    this.fileChannel.onclose = () => {
      this.events.onToast('File channel closed', 'info');
      this.cleanupReceiverTimer();
      this.cleanupSenderTimer();
    };

    this.fileChannel.onbufferedamountlow = () => {
      if (this.currentSenderFile && this.activeTransfer && this.activeTransfer.state === 'transferring') {
        this.sendNextChunk();
      }
    };
  }

  // --- WebRTC Negotiation Callbacks ---
  
  private async createOffer() {
    if (!this.pc) return;
    try {
      this.events.onConnectionStateChange('negotiating');
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      this.events.onSignalingMessage({
        type: 'offer',
        sdp: offer.sdp
      });
    } catch (err) {
      this.events.onToast(`Create offer failed: ${(err as Error).message}`, 'error');
      this.events.onConnectionStateChange('failed');
    }
  }

  public async handleOffer(sdp: string) {
    if (!this.pc) return;
    try {
      this.events.onConnectionStateChange('negotiating');
      await this.pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp }));
      
      // Process queued candidates
      for (const candidate of this.iceCandidateQueue) {
        await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
      this.iceCandidateQueue = [];

      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      
      this.events.onSignalingMessage({
        type: 'answer',
        sdp: answer.sdp
      });
    } catch (err) {
      this.events.onToast(`Handle offer failed: ${(err as Error).message}`, 'error');
      this.events.onConnectionStateChange('failed');
    }
  }

  public async handleAnswer(sdp: string) {
    if (!this.pc) return;
    try {
      await this.pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp }));
      
      // Process queued candidates
      for (const candidate of this.iceCandidateQueue) {
        await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
      this.iceCandidateQueue = [];
    } catch (err) {
      this.events.onToast(`Handle answer failed: ${(err as Error).message}`, 'error');
      this.events.onConnectionStateChange('failed');
    }
  }

  public async handleCandidate(candidate: RTCIceCandidateInit) {
    if (!this.pc) return;
    try {
      if (!this.pc.remoteDescription) {
        this.iceCandidateQueue.push(candidate);
      } else {
        await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
    } catch (err) {
      console.warn('Add ICE candidate failed', err);
    }
  }

  // --- Live Chat Feature ---
  public sendChatMessage(text: string): ChatMessage | null {
    if (!this.chatChannel || this.chatChannel.readyState !== 'open') {
      this.events.onToast('Cannot send message: Peer not connected', 'error');
      return null;
    }
    const msg: ChatMessage = {
      id: Math.random().toString(36).substr(2, 9),
      sender: 'me',
      text,
      timestamp: Date.now()
    };
    this.chatChannel.send(JSON.stringify(msg));
    return msg;
  }

  // --- File Transfer Control Messages ---

  private async handleFileControlMessage(rawMsg: unknown) {
    const msg = rawMsg as { type: string; metadata?: FileMetadata; fileId?: string };
    switch (msg.type) {
      case 'header':
        // Receiver side gets details of incoming file
        if (!msg.metadata) return;
        this.currentReceiverMetadata = msg.metadata;
        this.currentReceiverIndex = 0;
        this.bytesReceived = 0;
        this.isReceiverCancelled = false;
        
        this.activeTransfer = {
          metadata: msg.metadata,
          role: 'receiver',
          state: 'waiting_approval',
          progress: 0,
          bytesTransferred: 0,
          speed: 0,
          eta: 0
        };
        this.events.onFileTransferUpdate(this.activeTransfer);
        this.events.onToast(`Incoming file: ${msg.metadata.name}`, 'info');
        break;

      case 'accept':
        // Sender side starts sending
        if (this.currentSenderFile && this.activeTransfer && this.activeTransfer.metadata.id === msg.fileId) {
          this.isSenderCancelled = false;
          this.activeTransfer.state = 'transferring';
          this.events.onFileTransferUpdate(this.activeTransfer);
          this.events.onToast('File transfer accepted', 'success');
          
          this.currentSenderIndex = 0;
          this.startSenderSpeedTimer();
          this.sendNextChunk();
        }
        break;

      case 'reject':
        // Sender side gets rejection
        if (this.activeTransfer && this.activeTransfer.metadata.id === msg.fileId) {
          this.activeTransfer.state = 'rejected';
          this.events.onFileTransferUpdate(this.activeTransfer);
          this.events.onToast('Peer rejected the file transfer', 'warning');
          this.currentSenderFile = null;
        }
        break;

      case 'cancel':
        // Handle cancel from the other side
        if (this.activeTransfer && this.activeTransfer.metadata.id === msg.fileId) {
          this.activeTransfer.state = 'cancelled';
          this.activeTransfer.error = 'Cancelled by peer';
          this.events.onFileTransferUpdate(this.activeTransfer);
          this.events.onToast('File transfer cancelled by peer', 'warning');

          if (this.activeTransfer.role === 'sender') {
            this.cleanupSender();
          } else {
            await this.cleanupReceiver();
          }
        }
        break;

      case 'eof':
        // Receiver finished receiving chunks, stitch together
        if (this.activeTransfer && this.currentReceiverMetadata && this.activeTransfer.metadata.id === msg.fileId) {
          this.cleanupReceiverTimer();
          this.events.onToast('Assembling file...', 'info');
          
          try {
            // Wait for all pending database saves to complete
            await Promise.all(this.pendingSavePromises);
            this.pendingSavePromises = [];

            // Detect missing chunks or byte discrepancies
            if (this.currentReceiverIndex !== this.currentReceiverMetadata.chunkCount) {
              throw new Error(`Missing chunks: received ${this.currentReceiverIndex} out of ${this.currentReceiverMetadata.chunkCount}`);
            }
            if (this.bytesReceived !== this.currentReceiverMetadata.size) {
              throw new Error(`Size mismatch: received ${this.bytesReceived} bytes, expected ${this.currentReceiverMetadata.size}`);
            }

            const url = await assembleFile(
              this.currentReceiverMetadata.id,
              this.currentReceiverMetadata.name,
              this.currentReceiverMetadata.type,
              this.currentReceiverMetadata.chunkCount,
              (progress) => {
                if (this.activeTransfer) {
                  this.activeTransfer.progress = progress;
                  this.events.onFileTransferUpdate({ ...this.activeTransfer });
                }
              }
            );

            this.activeTransfer.state = 'completed';
            this.activeTransfer.progress = 100;
            this.activeTransfer.downloadUrl = url;
            this.events.onFileTransferUpdate({ ...this.activeTransfer });
            this.events.onToast('File transfer completed!', 'success');
          } catch (err) {
            this.activeTransfer.state = 'failed';
            this.activeTransfer.error = `Assembly failed: ${(err as Error).message}`;
            this.events.onFileTransferUpdate({ ...this.activeTransfer });
            this.events.onToast(`File assembly failed: ${(err as Error).message}`, 'error');
          } finally {
            // Keep the data in IndexedDB until download or reset, clean it up then.
          }
        }
        break;
      
      case 'reset':
        // Reset local UI transfer state
        this.activeTransfer = null;
        this.events.onFileTransferUpdate({
          metadata: { id: '', name: '', size: 0, type: '', chunkCount: 0 },
          role: 'sender',
          state: 'idle',
          progress: 0,
          bytesTransferred: 0,
          speed: 0,
          eta: 0
        });
        break;
    }
  }

  // --- Sender Core Logic ---

  public sendFileOffer(file: File) {
    if (!this.fileChannel || this.fileChannel.readyState !== 'open') {
      this.events.onToast('Cannot transfer file: Peer not connected', 'error');
      return;
    }

    this.currentSenderFile = file;
    this.currentSenderIndex = 0;
    this.isSenderCancelled = false;

    const metadata: FileMetadata = {
      id: Math.random().toString(36).substr(2, 9),
      name: file.name,
      size: file.size,
      type: file.type,
      chunkCount: Math.ceil(file.size / CHUNK_SIZE)
    };

    this.activeTransfer = {
      metadata,
      role: 'sender',
      state: 'waiting_approval',
      progress: 0,
      bytesTransferred: 0,
      speed: 0,
      eta: 0
    };

    this.events.onFileTransferUpdate(this.activeTransfer);
    this.events.onToast(`Sending transfer offer for ${file.name}`, 'info');

    // Send metadata to peer
    this.fileChannel.send(JSON.stringify({
      type: 'header',
      metadata
    }));
  }

  private sendNextChunk() {
    if (this.isSenderCancelled || !this.currentSenderFile || !this.fileChannel || this.fileChannel.readyState !== 'open') {
      return;
    }
    if (this.isReadingChunk) {
      return;
    }

    const file = this.currentSenderFile;
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

    // Keep loop active while under threshold
    while (this.currentSenderIndex < totalChunks) {
      if (this.fileChannel.bufferedAmount > BUFFERED_AMOUNT_THRESHOLD) {
        // Buffer filled up, pause and wait for onbufferedamountlow
        return;
      }

      const start = this.currentSenderIndex * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const slice = file.slice(start, end);

      this.isReadingChunk = true;
      const reader = new FileReader();
      reader.onload = (e) => {
        this.isReadingChunk = false;
        if (e.target?.result instanceof ArrayBuffer) {
          try {
            if (this.fileChannel && this.fileChannel.readyState === 'open') {
              this.fileChannel.send(e.target.result);
              this.currentSenderIndex++;

              const bytesSent = Math.min(this.currentSenderIndex * CHUNK_SIZE, file.size);
              if (this.activeTransfer) {
                this.activeTransfer.bytesTransferred = bytesSent;
                this.activeTransfer.progress = Math.round((bytesSent / file.size) * 100);
              }

              // Check if completed sending
              if (this.currentSenderIndex >= totalChunks) {
                this.cleanupSenderTimer();
                this.fileChannel.send(JSON.stringify({
                  type: 'eof',
                  fileId: this.activeTransfer?.metadata.id
                }));
                if (this.activeTransfer) {
                  this.activeTransfer.state = 'completed';
                  this.activeTransfer.progress = 100;
                  this.events.onFileTransferUpdate({ ...this.activeTransfer });
                }
                this.events.onToast('File sent successfully, waiting for receiver assembly', 'success');
              } else {
                // Continue loop
                this.sendNextChunk();
              }
            }
          } catch (err) {
            this.handleSenderError((err as Error).message);
          }
        }
      };

      reader.onerror = () => {
        this.handleSenderError('Failed to read file slice');
      };

      reader.readAsArrayBuffer(slice);
      return; // Break synchronous loop, file reader onload will trigger next chunk
    }
  }

  private handleSenderError(errMsg: string) {
    this.cleanupSender();
    if (this.activeTransfer) {
      this.activeTransfer.state = 'failed';
      this.activeTransfer.error = errMsg;
      this.events.onFileTransferUpdate(this.activeTransfer);
    }
    this.events.onToast(`File transfer failed: ${errMsg}`, 'error');
  }

  private startSenderSpeedTimer() {
    this.cleanupSenderTimer();
    let lastBytes = 0;

    this.senderTimer = setInterval(() => {
      if (!this.activeTransfer || !this.currentSenderFile) return;

      const currentBytes = this.activeTransfer.bytesTransferred;
      const speed = Math.max(0, currentBytes - lastBytes); // Bytes transferred in 1s
      lastBytes = currentBytes;

      const total = this.currentSenderFile.size;
      const remainingBytes = total - currentBytes;
      const eta = speed > 0 ? remainingBytes / speed : 0;

      this.activeTransfer.speed = speed;
      this.activeTransfer.eta = eta;

      this.events.onFileTransferUpdate({ ...this.activeTransfer });
    }, 1000);
  }

  private cleanupSenderTimer() {
    if (this.senderTimer) {
      clearInterval(this.senderTimer);
      this.senderTimer = null;
    }
  }

  private cleanupSender() {
    this.cleanupSenderTimer();
    this.currentSenderFile = null;
    this.currentSenderIndex = 0;
    this.isSenderCancelled = true;
  }

  public cancelOutgoingTransfer() {
    if (this.activeTransfer && this.fileChannel && this.fileChannel.readyState === 'open') {
      this.fileChannel.send(JSON.stringify({
        type: 'cancel',
        fileId: this.activeTransfer.metadata.id
      }));
    }
    this.cleanupSender();
    if (this.activeTransfer) {
      this.activeTransfer.state = 'cancelled';
      this.events.onFileTransferUpdate(this.activeTransfer);
    }
    this.events.onToast('File transfer cancelled', 'info');
  }

  // --- Receiver Core Logic ---

  public acceptIncomingTransfer() {
    if (!this.activeTransfer || !this.currentReceiverMetadata || !this.fileChannel || this.fileChannel.readyState !== 'open') {
      return;
    }

    this.isReceiverCancelled = false;
    this.activeTransfer.state = 'transferring';
    this.events.onFileTransferUpdate(this.activeTransfer);
    this.events.onToast('Accepting file, starting stream...', 'info');

    this.receiverStartTime = Date.now();
    this.startReceiverSpeedTimer();

    // Signal approval
    this.fileChannel.send(JSON.stringify({
      type: 'accept',
      fileId: this.currentReceiverMetadata.id
    }));
  }

  public rejectIncomingTransfer() {
    if (!this.activeTransfer || !this.currentReceiverMetadata || !this.fileChannel || this.fileChannel.readyState !== 'open') {
      return;
    }

    this.fileChannel.send(JSON.stringify({
      type: 'reject',
      fileId: this.currentReceiverMetadata.id
    }));

    this.activeTransfer = null;
    this.events.onFileTransferUpdate({
      metadata: { id: '', name: '', size: 0, type: '', chunkCount: 0 },
      role: 'receiver',
      state: 'idle',
      progress: 0,
      bytesTransferred: 0,
      speed: 0,
      eta: 0
    });
    this.events.onToast('File transfer rejected', 'warning');
  }

  private async handleIncomingChunk(chunk: ArrayBuffer) {
    if (this.isReceiverCancelled || !this.currentReceiverMetadata) return;

    const transferId = this.currentReceiverMetadata.id;
    const index = this.currentReceiverIndex;
    
    // Increment index and bytesReceived synchronously to prevent race conditions 
    // when chunks arrive in rapid succession on the WebRTC data channel.
    this.currentReceiverIndex++;
    this.bytesReceived += chunk.byteLength;

    const savePromise = saveChunk(transferId, index, chunk);
    this.pendingSavePromises.push(savePromise);
    
    // Remove the promise from the list when it completes to avoid memory leak
    savePromise.then(() => {
      this.pendingSavePromises = this.pendingSavePromises.filter(p => p !== savePromise);
    }).catch(() => {});

    try {
      await savePromise;

      if (this.activeTransfer) {
        this.activeTransfer.bytesTransferred = this.bytesReceived;
        this.activeTransfer.progress = Math.round((this.bytesReceived / this.currentReceiverMetadata.size) * 100);
        // Throttle UI update state slightly to avoid congestion
        if (index % 10 === 0 || this.bytesReceived === this.currentReceiverMetadata.size) {
          this.events.onFileTransferUpdate({ ...this.activeTransfer });
        }
      }
    } catch (err) {
      this.handleReceiverError(`IndexedDB Save Error: ${(err as Error).message}`);
    }
  }

  private handleReceiverError(errMsg: string) {
    this.cleanupReceiver();
    if (this.activeTransfer) {
      this.activeTransfer.state = 'failed';
      this.activeTransfer.error = errMsg;
      this.events.onFileTransferUpdate(this.activeTransfer);
    }
    this.events.onToast(`File transfer failed: ${errMsg}`, 'error');
  }

  private startReceiverSpeedTimer() {
    this.cleanupReceiverTimer();
    let lastBytes = 0;

    this.receiverTimer = setInterval(() => {
      if (!this.activeTransfer || !this.currentReceiverMetadata) return;

      const currentBytes = this.bytesReceived;
      const speed = Math.max(0, currentBytes - lastBytes); // Bytes in 1s
      lastBytes = currentBytes;

      const total = this.currentReceiverMetadata.size;
      const remainingBytes = total - currentBytes;
      const eta = speed > 0 ? remainingBytes / speed : 0;

      this.activeTransfer.speed = speed;
      this.activeTransfer.eta = eta;

      this.events.onFileTransferUpdate({ ...this.activeTransfer });
    }, 1000);
  }

  private cleanupReceiverTimer() {
    if (this.receiverTimer) {
      clearInterval(this.receiverTimer);
      this.receiverTimer = null;
    }
  }

  private async cleanupReceiver() {
    this.cleanupReceiverTimer();
    this.isReceiverCancelled = true;
    this.pendingSavePromises = [];
    if (this.currentReceiverMetadata) {
      try {
        await clearTransfer(this.currentReceiverMetadata.id, this.currentReceiverMetadata.chunkCount);
      } catch (e) {
        console.error('Error clearing chunks on cancel', e);
      }
    }
    this.currentReceiverMetadata = null;
    this.currentReceiverIndex = 0;
    this.bytesReceived = 0;
  }

  public async cancelIncomingTransfer() {
    if (this.activeTransfer && this.fileChannel && this.fileChannel.readyState === 'open') {
      this.fileChannel.send(JSON.stringify({
        type: 'cancel',
        fileId: this.activeTransfer.metadata.id
      }));
    }
    await this.cleanupReceiver();
    if (this.activeTransfer) {
      this.activeTransfer.state = 'cancelled';
      this.events.onFileTransferUpdate(this.activeTransfer);
    }
    this.events.onToast('File transfer cancelled', 'info');
  }

  // --- Reset Room for Another Transfer ---
  public resetTransfer() {
    if (this.activeTransfer && this.fileChannel && this.fileChannel.readyState === 'open') {
      this.fileChannel.send(JSON.stringify({
        type: 'reset'
      }));
    }
    
    // Clear local storage if we finished a receiver transfer
    if (this.activeTransfer && this.activeTransfer.role === 'receiver') {
      if (this.activeTransfer.downloadUrl) {
        URL.revokeObjectURL(this.activeTransfer.downloadUrl);
      }
      clearTransfer(this.activeTransfer.metadata.id, this.activeTransfer.metadata.chunkCount).catch(console.error);
    }

    this.activeTransfer = null;
    this.cleanupSender();
    this.cleanupReceiver();
    
    this.events.onFileTransferUpdate({
      metadata: { id: '', name: '', size: 0, type: '', chunkCount: 0 },
      role: 'sender',
      state: 'idle',
      progress: 0,
      bytesTransferred: 0,
      speed: 0,
      eta: 0
    });
  }

  // --- Clean Up ---
  public cleanup() {
    this.cleanupSender();
    this.cleanupReceiver();
    
    if (this.chatChannel) {
      this.chatChannel.close();
      this.chatChannel = null;
    }
    if (this.fileChannel) {
      this.fileChannel.close();
      this.fileChannel = null;
    }
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    this.iceCandidateQueue = [];
    this.activeTransfer = null;
  }
}
