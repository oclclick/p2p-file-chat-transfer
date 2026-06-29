export type ConnectionState =
  | 'idle'
  | 'waiting'        // Waiting for peer to join
  | 'connecting'     // Handshake and signaling starting
  | 'negotiating'    // SDP exchange in progress
  | 'connected'      // Direct WebRTC connection active
  | 'reconnecting'   // Reconnection attempt in progress
  | 'disconnected'   // Peer disconnected
  | 'failed';        // WebRTC or signaling failure

export type TransferRole = 'sender' | 'receiver';

export type TransferState =
  | 'idle'
  | 'waiting_approval' // Receiver waiting to accept or reject
  | 'transferring'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'rejected';

export interface FileMetadata {
  id: string;
  name: string;
  size: number;
  type: string;
  chunkCount: number;
}

export interface FileTransfer {
  metadata: FileMetadata;
  role: TransferRole;
  state: TransferState;
  progress: number;            // Percentage 0-100
  bytesTransferred: number;
  speed: number;               // Bytes per second
  eta: number;                 // Seconds remaining
  error?: string;
  downloadUrl?: string;        // Created after assembly on receiver
}

export interface ChatMessage {
  id: string;
  sender: 'me' | 'peer';
  text: string;
  timestamp: number;
}

export interface IceServerConfig {
  urls: string[];
  username?: string;
  credential?: string;
}

export interface SignalingSettings {
  useCustomTurn: boolean;
  turnServer: string;
  turnUsername?: string;
  turnPassword?: string;
}
