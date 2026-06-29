import React from 'react';
import { Settings2, Zap, ArrowLeftRight } from 'lucide-react';
import { ConnectionState } from '../types';

interface HeaderProps {
  connectionState: ConnectionState;
  onOpenSettings: () => void;
  roomCode?: string;
  onLeaveRoom?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  connectionState,
  onOpenSettings,
  roomCode,
  onLeaveRoom
}) => {
  const getStatusConfig = () => {
    switch (connectionState) {
      case 'idle':
        return { label: 'Offline', color: 'bg-zinc-500', pulse: false };
      case 'waiting':
        return { label: 'Waiting for Peer', color: 'bg-amber-500', pulse: true };
      case 'connecting':
        return { label: 'Connecting', color: 'bg-yellow-500', pulse: true };
      case 'negotiating':
        return { label: 'Negotiating', color: 'bg-indigo-500', pulse: true };
      case 'connected':
        return { label: 'Connected P2P', color: 'bg-emerald-500', pulse: true };
      case 'reconnecting':
        return { label: 'Reconnecting', color: 'bg-amber-500', pulse: true };
      case 'disconnected':
        return { label: 'Peer Disconnected', color: 'bg-rose-500', pulse: false };
      case 'failed':
        return { label: 'Connection Failed', color: 'bg-rose-600', pulse: false };
    }
  };

  const status = getStatusConfig();

  return (
    <header className="w-full py-4 px-6 mb-8 flex items-center justify-between border-b border-white/5 backdrop-blur-md bg-slate-950/20 sticky top-0 z-40">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-purple-600/20 border border-purple-500/30 rounded-xl text-purple-400">
          <ArrowLeftRight className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-purple-400 to-indigo-300 bg-clip-text text-transparent">
            P2P Sender
          </h1>
          <p className="text-xs text-slate-400 hidden sm:block">Secure Direct Peer-to-Peer Transfer</p>
        </div>
      </div>

      <div className="flex items-center gap-4">
        {/* Status Badge */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900/60 border border-white/5 text-xs font-semibold">
          <span className="relative flex h-2 w-2">
            {status.pulse && (
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${status.color} opacity-75`}></span>
            )}
            <span className={`relative inline-flex rounded-full h-2 w-2 ${status.color}`}></span>
          </span>
          <span className="text-slate-200">{status.label}</span>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          {roomCode && onLeaveRoom && (
            <button
              onClick={onLeaveRoom}
              className="px-3.5 py-1.5 rounded-xl text-xs font-medium bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 hover:text-rose-200 border border-rose-500/20 transition-all active:scale-95 cursor-pointer"
            >
              Leave Room
            </button>
          )}
          <button
            onClick={onOpenSettings}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/5 border border-transparent hover:border-white/5 transition-colors cursor-pointer"
            title="Connection Settings"
          >
            <Settings2 className="w-5 h-5" />
          </button>
        </div>
      </div>
    </header>
  );
};
