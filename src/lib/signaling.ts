export interface SignalingCallbacks {
  onConnected?: () => void;
  onRoomCreated?: (code: string, peerId: string) => void;
  onRoomJoined?: (code: string, peerId: string, isInitiator: boolean) => void;
  onPeerJoined?: (peerId: string) => void;
  onRoomReady?: (code: string, isInitiator: boolean) => void;
  onSignalReceived?: (data: any) => void;
  onPeerDisconnected?: () => void;
  onError?: (error: { code?: string; message: string }) => void;
  onDisconnected?: () => void;
}

export class SignalingClient {
  private socket: WebSocket | null = null;
  private callbacks: SignalingCallbacks;
  private url: string;
  private isConnecting = false;

  constructor(callbacks: SignalingCallbacks, customUrl?: string) {
    this.callbacks = callbacks;
    this.url = customUrl || this.getDefaultUrl();
  }

  private getDefaultUrl(): string {
    if (typeof window === 'undefined') return '';
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const hostname = window.location.hostname;
    
    // Default to port 3001 for local signaling server
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return `${protocol}//${hostname}:3001`;
    }
    
    // In production, connect to the same host
    return `${protocol}//${window.location.host}`;
  }

  public connect(): Promise<void> {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }

    this.isConnecting = true;

    return new Promise((resolve, reject) => {
      try {
        console.log(`Connecting to signaling server at ${this.url}`);
        this.socket = new WebSocket(this.url);

        this.socket.onopen = () => {
          this.isConnecting = false;
          console.log('Connected to signaling server');
          if (this.callbacks.onConnected) {
            this.callbacks.onConnected();
          }
          resolve();
        };

        this.socket.onmessage = (event) => {
          this.handleMessage(event.data);
        };

        this.socket.onclose = () => {
          this.isConnecting = false;
          this.socket = null;
          console.log('Disconnected from signaling server');
          if (this.callbacks.onDisconnected) {
            this.callbacks.onDisconnected();
          }
        };

        this.socket.onerror = (err) => {
          this.isConnecting = false;
          console.error('Signaling socket error:', err);
          if (this.callbacks.onError) {
            this.callbacks.onError({ message: 'Failed to connect to signaling server' });
          }
          reject(err);
        };
      } catch (err: any) {
        this.isConnecting = false;
        reject(err);
      }
    });
  }

  private handleMessage(dataStr: string) {
    try {
      const payload = JSON.parse(dataStr);
      const { type } = payload;

      switch (type) {
        case 'room_created':
          if (this.callbacks.onRoomCreated) {
            this.callbacks.onRoomCreated(payload.code, payload.peerId);
          }
          break;

        case 'room_joined':
          if (this.callbacks.onRoomJoined) {
            this.callbacks.onRoomJoined(payload.code, payload.peerId, payload.isInitiator);
          }
          break;

        case 'peer_joined':
          if (this.callbacks.onPeerJoined) {
            this.callbacks.onPeerJoined(payload.peerId);
          }
          break;

        case 'room_ready':
          if (this.callbacks.onRoomReady) {
            this.callbacks.onRoomReady(payload.code, payload.isInitiator);
          }
          break;

        case 'signal':
          if (this.callbacks.onSignalReceived) {
            this.callbacks.onSignalReceived(payload.data);
          }
          break;

        case 'peer_disconnected':
          if (this.callbacks.onPeerDisconnected) {
            this.callbacks.onPeerDisconnected();
          }
          break;

        case 'error':
          if (this.callbacks.onError) {
            this.callbacks.onError({ code: payload.code, message: payload.message });
          }
          break;

        default:
          console.warn('Unknown signaling message type:', type);
      }
    } catch (err) {
      console.error('Error parsing signaling message:', err);
    }
  }

  public createRoom() {
    this.send({ type: 'create_room' });
  }

  public joinRoom(code: string) {
    this.send({ type: 'join_room', code: code.toUpperCase() });
  }

  public sendSignal(data: any) {
    this.send({ type: 'signal', data });
  }

  private send(payload: any) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      console.error('Cannot send message, WebSocket not connected');
      return;
    }
    this.socket.send(JSON.stringify(payload));
  }

  public disconnect() {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }
}
