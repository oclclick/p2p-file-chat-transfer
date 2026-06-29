export interface SignalingCallbacks {
  onConnected?: () => void;
  onRoomCreated?: (code: string, peerId: string) => void;
  onRoomJoined?: (code: string, peerId: string, isInitiator: boolean) => void;
  onPeerJoined?: (peerId: string) => void;
  onRoomReady?: (code: string, isInitiator: boolean) => void;
  onSignalReceived?: (data: unknown) => void;
  onPeerDisconnected?: () => void;
  onError?: (error: { code?: string; message: string }) => void;
  onDisconnected?: () => void;
}

export class SignalingClient {
  private socket: WebSocket | null = null;
  private callbacks: SignalingCallbacks;
  private url: string;
  private isConnecting = false;

  // Session state tracking
  private roomCode: string | null = null;
  private peerId: string | null = null;
  private isInitiator = false;

  // Reconnection state
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private intentionalDisconnect = false;

  // Heartbeat keepalive state
  private pingInterval: NodeJS.Timeout | null = null;
  private pingTimeout: NodeJS.Timeout | null = null;

  constructor(callbacks: SignalingCallbacks, customUrl?: string) {
    this.callbacks = callbacks;
    this.url = customUrl || this.getDefaultUrl();
  }

  private getDefaultUrl(): string {
    if (typeof window === 'undefined') return '';

    // Check for explicit environment variable configuration
    if (process.env.NEXT_PUBLIC_SIGNALING_SERVER_URL) {
      return process.env.NEXT_PUBLIC_SIGNALING_SERVER_URL;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const hostname = window.location.hostname;
    
    // In development, the signaling server runs on port 3001 to avoid Next.js HMR websocket interference.
    const isDev = process.env.NODE_ENV === 'development';
    const port = isDev ? ':3001' : (window.location.port ? `:${window.location.port}` : '');

    return `${protocol}//${hostname}${port}`;
  }

  public connect(): Promise<void> {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }

    this.isConnecting = true;
    this.intentionalDisconnect = false;

    return new Promise((resolve, reject) => {
      try {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [SignalingClient] Connecting to signaling server at ${this.url}`);
        this.socket = new WebSocket(this.url);

        this.socket.onopen = () => {
          this.isConnecting = false;
          this.reconnectAttempts = 0; // Reset reconnection attempts on success
          const openTimestamp = new Date().toISOString();
          console.log(`[${openTimestamp}] [SignalingClient] Connected to signaling server`);

          this.startHeartbeat();

          // If we have an existing session, restore it
          if (this.roomCode && this.peerId) {
            this.send({
              type: 'reconnect_room',
              code: this.roomCode,
              peerId: this.peerId,
              isInitiator: this.isInitiator
            });
          }

          if (this.callbacks.onConnected) {
            this.callbacks.onConnected();
          }

          resolve();
        };

        this.socket.onmessage = (event) => {
          this.handleMessage(event.data);
        };

        this.socket.onclose = (event) => {
          this.isConnecting = false;
          this.socket = null;
          this.clearHeartbeat();

          const closeTimestamp = new Date().toISOString();
          console.log(`[${closeTimestamp}] [SignalingClient] Disconnected from signaling server (Code: ${event.code}, Reason: ${event.reason || 'none'})`);

          if (this.callbacks.onDisconnected) {
            this.callbacks.onDisconnected();
          }

          if (!this.intentionalDisconnect) {
            this.scheduleReconnect();
          }
        };

        this.socket.onerror = (err) => {
          this.isConnecting = false;
          const errTimestamp = new Date().toISOString();
          console.error(`[${errTimestamp}] [SignalingClient] Signaling socket error:`, err);

          if (this.callbacks.onError) {
            this.callbacks.onError({ message: 'Failed to connect to signaling server' });
          }
          reject(err);
        };
      } catch (err) {
        this.isConnecting = false;
        reject(err);
      }
    });
  }

  private scheduleReconnect() {
    if (this.intentionalDisconnect) return;
    if (this.reconnectTimer) return; // Reconnection is already scheduled

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      const timestamp = new Date().toISOString();
      console.error(`[${timestamp}] [SignalingClient] Max reconnect attempts (${this.maxReconnectAttempts}) reached. Giving up.`);
      if (this.callbacks.onError) {
        this.callbacks.onError({ message: 'Signaling server connection lost. Please refresh or try again.' });
      }
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 10000);
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [SignalingClient] Scheduling reconnect attempt ${this.reconnectAttempts} of ${this.maxReconnectAttempts} in ${delay}ms...`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      const attemptTimestamp = new Date().toISOString();
      console.log(`[${attemptTimestamp}] [SignalingClient] Reconnecting...`);
      this.connect().catch((err) => {
        const failTimestamp = new Date().toISOString();
        console.warn(`[${failTimestamp}] [SignalingClient] Reconnection attempt failed: ${err.message}`);
      });
    }, delay);
  }

  private startHeartbeat() {
    this.clearHeartbeat();

    // Ping every 20 seconds (Render load balancers terminate idle sockets at 55s)
    this.pingInterval = setInterval(() => {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.send({ type: 'ping' });

        // Await pong response within 10 seconds
        this.pingTimeout = setTimeout(() => {
          const timeoutTimestamp = new Date().toISOString();
          console.warn(`[${timeoutTimestamp}] [SignalingClient] Heartbeat timeout. Server did not respond. Reconnecting...`);
          if (this.socket) {
            this.socket.close(); // Triggers onclose -> scheduleReconnect
          }
        }, 10000);
      }
    }, 20000);
  }

  private clearHeartbeat() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    this.clearPingTimeout();
  }

  private clearPingTimeout() {
    if (this.pingTimeout) {
      clearTimeout(this.pingTimeout);
      this.pingTimeout = null;
    }
  }

  private handleMessage(dataStr: string) {
    // Reset watchdog ping timeout since server responded
    this.clearPingTimeout();

    try {
      const payload = JSON.parse(dataStr);
      const { type } = payload;

      // Handle heartbeat response silently
      if (type === 'pong') {
        return;
      }

      const logTimestamp = new Date().toISOString();
      console.log(`[${logTimestamp}] [SignalingClient] Received message: ${type}`);

      switch (type) {
        case 'room_created':
          this.roomCode = payload.code;
          this.peerId = payload.peerId;
          this.isInitiator = true;
          if (this.callbacks.onRoomCreated) {
            this.callbacks.onRoomCreated(payload.code, payload.peerId);
          }
          break;

        case 'room_joined':
          this.roomCode = payload.code;
          this.peerId = payload.peerId;
          this.isInitiator = payload.isInitiator;
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
          if (payload.code === 'ROOM_NOT_FOUND' || payload.code === 'ROOM_FULL') {
            // Clear registration details so we don't loop rejoin attempts
            this.roomCode = null;
            this.peerId = null;
          }
          if (this.callbacks.onError) {
            this.callbacks.onError({ code: payload.code, message: payload.message });
          }
          break;

        default:
          console.warn('[SignalingClient] Unknown message type received:', type);
      }
    } catch (err) {
      console.error('[SignalingClient] Error parsing message:', err);
    }
  }

  public createRoom() {
    this.send({ type: 'create_room' });
  }

  public joinRoom(code: string) {
    this.send({ type: 'join_room', code: code.toUpperCase() });
  }

  public sendSignal(data: unknown) {
    this.send({ type: 'signal', data });
  }

  private send(payload: Record<string, unknown> | unknown) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      console.error('[SignalingClient] Cannot send message: socket not open');
      return;
    }
    this.socket.send(JSON.stringify(payload));
  }

  public disconnect() {
    this.intentionalDisconnect = true;
    this.roomCode = null;
    this.peerId = null;
    this.isInitiator = false;
    this.clearHeartbeat();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }

    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [SignalingClient] Intentionally disconnected`);
  }
}
