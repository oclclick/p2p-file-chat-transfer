'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Copy, Check, Share2, ArrowLeft, ArrowLeftRight } from 'lucide-react';
import { ConnectionState, ChatMessage, FileTransfer, SignalingSettings } from '../types';
import { Header } from '../components/Header';
import { RoomSetup } from '../components/RoomSetup';
import { FileArea } from '../components/FileArea';
import { ChatArea } from '../components/ChatArea';
import { Settings, loadSignalingSettings, getIceConfig } from '../components/Settings';
import { ToastContainer, ToastMessage } from '../components/Toast';
import { SignalingClient } from '../lib/signaling';
import { WebRTCManager } from '../lib/webrtc';

export default function Home() {
  // Application States
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const [roomCode, setRoomCode] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [fileTransfer, setFileTransfer] = useState<FileTransfer | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  
  // UI Modal & Notification States
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<SignalingSettings>({ useCustomTurn: false, turnServer: '' });
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // Refs for persistent managers
  const signalingClient = useRef<SignalingClient | null>(null);
  const webrtcManager = useRef<WebRTCManager | null>(null);

  // Helper to add toast notifications
  const addToast = (message: string, type: 'info' | 'success' | 'warning' | 'error') => {
    const id = Math.random().toString(36).substr(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);
  };

  const cleanupConnection = () => {
    if (signalingClient.current) {
      signalingClient.current.disconnect();
      signalingClient.current = null;
    }
    if (webrtcManager.current) {
      webrtcManager.current.cleanup();
      webrtcManager.current = null;
    }
  };

  // Load configuration on mount
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSettings(loadSignalingSettings());
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupConnection();
    };
  }, []);

  const handleSettingsSave = (newSettings: SignalingSettings) => {
    setSettings(newSettings);
    addToast('Network settings saved', 'success');
    if (roomCode) {
      addToast('Please recreate or rejoin the room to apply new server settings', 'warning');
    }
  };

  // Initiates Room Creation
  const handleCreateRoom = async () => {
    setIsLoading(true);
    cleanupConnection();

    try {
      // Load ice candidate settings (TURN if enabled)
      const iceConfig = getIceConfig(settings);

      // Create WebRTC Manager
      webrtcManager.current = new WebRTCManager({
        onConnectionStateChange: (state) => setConnectionState(state),
        onMessageReceived: (msg) => setMessages((prev) => [...prev, msg]),
        onSignalingMessage: (msg) => {
          if (signalingClient.current) {
            signalingClient.current.sendSignal(msg);
          }
        },
        onFileTransferUpdate: (transfer) => setFileTransfer(transfer),
        onToast: (msg, type) => addToast(msg, type)
      }, iceConfig);

      // Connect to signaling server
      signalingClient.current = new SignalingClient({
        onConnected: () => {
          console.log('Connected to signaling server');
        },
        onRoomCreated: (code) => {
          setRoomCode(code);
          setConnectionState('waiting');
          setIsLoading(false);
          addToast(`Room created: ${code}`, 'success');
        },
        onPeerJoined: () => {
          addToast('Peer has joined the room. Establishing connection...', 'info');
          // Creator acts as initiator
          if (webrtcManager.current) {
            webrtcManager.current.initialize(true);
          }
        },
        onSignalReceived: (data: unknown) => {
          if (!webrtcManager.current) return;
          const msg = data as { type: string; sdp?: string; candidate?: RTCIceCandidateInit };
          if (msg.type === 'offer' && msg.sdp) {
            webrtcManager.current.handleOffer(msg.sdp);
          } else if (msg.type === 'answer' && msg.sdp) {
            webrtcManager.current.handleAnswer(msg.sdp);
          } else if (msg.type === 'candidate' && msg.candidate) {
            webrtcManager.current.handleCandidate(msg.candidate);
          }
        },
        onPeerDisconnected: () => {
          addToast('Peer disconnected from signaling', 'warning');
          setConnectionState('disconnected');
          if (webrtcManager.current) {
            webrtcManager.current.cleanup();
          }
        },
        onError: (err) => {
          addToast(err.message, 'error');
          setIsLoading(false);
          setConnectionState('failed');
        },
        onDisconnected: () => {
          console.log('Signaling websocket disconnected');
        }
      });

      await signalingClient.current.connect();
      signalingClient.current.createRoom();
    } catch (err) {
      addToast(`Room creation failed: ${(err as Error).message}`, 'error');
      setIsLoading(false);
      setConnectionState('failed');
    }
  };

  // Initiates Room Joining
  const handleJoinRoom = async (code: string) => {
    setIsLoading(true);
    cleanupConnection();

    try {
      const iceConfig = getIceConfig(settings);

      webrtcManager.current = new WebRTCManager({
        onConnectionStateChange: (state) => setConnectionState(state),
        onMessageReceived: (msg) => setMessages((prev) => [...prev, msg]),
        onSignalingMessage: (msg) => {
          if (signalingClient.current) {
            signalingClient.current.sendSignal(msg);
          }
        },
        onFileTransferUpdate: (transfer) => setFileTransfer(transfer),
        onToast: (msg, type) => addToast(msg, type)
      }, iceConfig);

      signalingClient.current = new SignalingClient({
        onConnected: () => {
          console.log('Connected to signaling server');
        },
        onRoomJoined: (joinedCode) => {
          setRoomCode(joinedCode);
          setConnectionState('connecting');
          setIsLoading(false);
          addToast(`Joined room: ${joinedCode}`, 'success');
          // Joiner waits for creator to initialize or initializes receiver WebRTC
          if (webrtcManager.current) {
            webrtcManager.current.initialize(false);
          }
        },
        onSignalReceived: (data: unknown) => {
          if (!webrtcManager.current) return;
          const msg = data as { type: string; sdp?: string; candidate?: RTCIceCandidateInit };
          if (msg.type === 'offer' && msg.sdp) {
            webrtcManager.current.handleOffer(msg.sdp);
          } else if (msg.type === 'answer' && msg.sdp) {
            webrtcManager.current.handleAnswer(msg.sdp);
          } else if (msg.type === 'candidate' && msg.candidate) {
            webrtcManager.current.handleCandidate(msg.candidate);
          }
        },
        onPeerDisconnected: () => {
          addToast('Peer disconnected from signaling', 'warning');
          setConnectionState('disconnected');
          if (webrtcManager.current) {
            webrtcManager.current.cleanup();
          }
        },
        onError: (err) => {
          addToast(err.message, 'error');
          setIsLoading(false);
          setConnectionState('failed');
        },
        onDisconnected: () => {
          console.log('Signaling websocket disconnected');
        }
      });

      await signalingClient.current.connect();
      signalingClient.current.joinRoom(code);
    } catch (err) {
      addToast(`Failed to join room: ${(err as Error).message}`, 'error');
      setIsLoading(false);
      setConnectionState('failed');
    }
  };

  // Leaves Room and resets State
  const handleLeaveRoom = () => {
    cleanupConnection();
    setRoomCode('');
    setConnectionState('idle');
    setMessages([]);
    setFileTransfer(null);
    addToast('Left the room', 'info');
  };

  // Actions passed to children components
  const handleSendMessage = (text: string) => {
    if (webrtcManager.current) {
      const msg = webrtcManager.current.sendChatMessage(text);
      if (msg) {
        setMessages((prev) => [...prev, msg]);
      }
    }
  };

  const handleSendFile = (file: File) => {
    if (webrtcManager.current) {
      webrtcManager.current.sendFileOffer(file);
    }
  };

  const handleAcceptFile = () => {
    if (webrtcManager.current) {
      webrtcManager.current.acceptIncomingTransfer();
    }
  };

  const handleRejectFile = () => {
    if (webrtcManager.current) {
      webrtcManager.current.rejectIncomingTransfer();
    }
  };

  const handleCancelTransfer = () => {
    if (webrtcManager.current) {
      if (fileTransfer?.role === 'sender') {
        webrtcManager.current.cancelOutgoingTransfer();
      } else {
        webrtcManager.current.cancelIncomingTransfer();
      }
    }
  };

  const handleResetTransfer = () => {
    if (webrtcManager.current) {
      webrtcManager.current.resetTransfer();
    }
  };

  // Clipboard room sharing utilities
  const handleCopyCode = () => {
    navigator.clipboard.writeText(roomCode);
    setIsCopied(true);
    addToast('Room code copied to clipboard', 'success');
    setTimeout(() => setIsCopied(false), 2000);
  };

  const handleCopyLink = () => {
    if (typeof window === 'undefined') return;
    const link = `${window.location.origin}?room=${roomCode}`;
    navigator.clipboard.writeText(link);
    addToast('Join link copied to clipboard', 'success');
  };

  // Automatically join room if code is present in URL search params
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const urlParams = new URLSearchParams(window.location.search);
    const room = urlParams.get('room');
    if (room && room.trim().length === 6 && roomCode === '') {
      setTimeout(() => {
        addToast(`Found room code in URL: ${room}. Joining...`, 'info');
        handleJoinRoom(room.trim().toUpperCase());
      }, 0);
      // Clean query parameter after trigger
      window.history.replaceState({}, document.title, window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="min-h-screen relative flex flex-col justify-between overflow-x-hidden">
      {/* Background blobs */}
      <div className="bg-blob blob-1"></div>
      <div className="bg-blob blob-2"></div>
      <div className="bg-blob blob-3"></div>

      {/* Main Container */}
      <div className="relative z-10 flex-grow flex flex-col">
        <Header
          connectionState={connectionState}
          onOpenSettings={() => setIsSettingsOpen(true)}
          roomCode={roomCode}
          onLeaveRoom={handleLeaveRoom}
        />

        <div className="flex-grow flex items-center justify-center py-6">
          {!roomCode ? (
            /* Welcome Landing Screen */
            <div className="w-full max-w-5xl mx-auto space-y-12 animate-fade-in">
              <div className="text-center space-y-4 px-6 select-none">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 border border-purple-500/30 rounded-full bg-purple-500/10 text-xs font-semibold text-purple-400">
                  <ArrowLeftRight className="w-3.5 h-3.5" />
                  Direct WebRTC Transfer
                </div>
                <h2 className="text-4xl md:text-6xl font-black text-white tracking-tight">
                  Share files <span className="bg-gradient-to-r from-purple-500 to-indigo-400 bg-clip-text text-transparent">directly</span> between devices.
                </h2>
                <p className="text-sm md:text-base text-slate-400 max-w-xl mx-auto leading-relaxed">
                  P2P Sender establishes a direct connection between two browsers, enabling secure file sharing and chat with zero server storage.
                </p>
              </div>

              <RoomSetup
                onCreateRoom={handleCreateRoom}
                onJoinRoom={handleJoinRoom}
                isLoading={isLoading}
              />
            </div>
          ) : (
            /* Active Connected Room Dashboard */
            <div className="w-full max-w-5xl mx-auto px-4 space-y-6 animate-fade-in flex flex-col">
              {/* Room sharing panel */}
              <div className="w-full p-6 rounded-3xl glass-panel flex flex-col sm:flex-row items-center justify-between gap-4 select-none">
                <div className="space-y-1 text-center sm:text-left">
                  <p className="text-xs text-slate-400 font-medium">Room Created. Share this code with peer:</p>
                  <div className="flex items-center justify-center sm:justify-start gap-3">
                    <span className="text-3xl font-black tracking-widest text-purple-400">{roomCode}</span>
                    <button
                      onClick={handleCopyCode}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 border border-white/5 active:scale-95 transition-all cursor-pointer"
                      title="Copy Code"
                    >
                      {isCopied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={handleCopyLink}
                    className="px-4 py-2 text-xs font-bold bg-white/5 hover:bg-white/10 text-slate-200 rounded-xl border border-white/5 transition-all flex items-center gap-2 cursor-pointer shadow-md"
                  >
                    <Share2 className="w-3.5 h-3.5 text-purple-400" />
                    Copy Share Link
                  </button>
                  <button
                    onClick={handleLeaveRoom}
                    className="px-4 py-2 text-xs font-bold bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 rounded-xl border border-rose-500/10 transition-all flex items-center gap-2 cursor-pointer"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    Exit Room
                  </button>
                </div>
              </div>

              {/* Two Column Grid */}
              <div className="grid md:grid-cols-2 gap-6 items-stretch flex-grow min-h-[460px]">
                {/* File Transfer Area */}
                <FileArea
                  transfer={fileTransfer}
                  onSendFile={handleSendFile}
                  onAcceptFile={handleAcceptFile}
                  onRejectFile={handleRejectFile}
                  onCancelTransfer={handleCancelTransfer}
                  onResetTransfer={handleResetTransfer}
                />

                {/* Live Chat Area */}
                <ChatArea
                  messages={messages}
                  onSendMessage={handleSendMessage}
                  isConnected={connectionState === 'connected'}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <footer className="relative z-10 py-6 text-center text-[10px] text-slate-500 tracking-wider font-semibold border-t border-white/5 bg-slate-950/20 select-none">
        P2P SENDER &bull; 100% PRIVATE DIRECT WebRTC CHANNELS
      </footer>

      {/* Modals & Portal Overlays */}
      <Settings
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onSave={handleSettingsSave}
      />

      <ToastContainer toasts={toasts} setToasts={setToasts} />
    </main>
  );
}
