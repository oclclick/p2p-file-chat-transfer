import React, { useState } from 'react';
import { PlusCircle, LogIn, Loader2, ShieldCheck, KeyRound } from 'lucide-react';

interface RoomSetupProps {
  onCreateRoom: () => void;
  onJoinRoom: (code: string) => void;
  isLoading: boolean;
}

export const RoomSetup: React.FC<RoomSetupProps> = ({ onCreateRoom, onJoinRoom, isLoading }) => {
  const [code, setCode] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (code.trim().length === 6) {
      onJoinRoom(code.trim().toUpperCase());
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const uppercaseVal = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (uppercaseVal.length <= 6) {
      setCode(uppercaseVal);
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto grid md:grid-cols-2 gap-8 items-stretch px-4 select-none">
      {/* Left Box: Create Room */}
      <div className="flex flex-col justify-between p-8 rounded-3xl glass-panel relative overflow-hidden group">
        <div className="absolute top-0 right-0 w-32 h-32 bg-purple-600/10 rounded-full blur-3xl group-hover:bg-purple-600/20 transition-all duration-500"></div>
        <div className="space-y-4 relative z-10">
          <div className="w-12 h-12 bg-purple-500/10 border border-purple-500/20 rounded-2xl flex items-center justify-center text-purple-400">
            <PlusCircle className="w-6 h-6 animate-pulse" />
          </div>
          <h3 className="text-xl font-bold text-white">Create a Transfer Room</h3>
          <p className="text-sm text-slate-400 leading-relaxed">
            Generate a unique, temporary 6-character code. Share this code with another device to establish an instant, secure peer-to-peer connection for files and chat.
          </p>
        </div>

        <button
          onClick={onCreateRoom}
          disabled={isLoading}
          className="mt-8 w-full py-4 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:from-purple-800 disabled:to-indigo-800 text-white font-semibold rounded-2xl shadow-xl hover:shadow-purple-500/25 active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Generating Room...
            </>
          ) : (
            <>
              <PlusCircle className="w-5 h-5" />
              Create Room
            </>
          )}
        </button>
      </div>

      {/* Right Box: Join Room */}
      <div className="flex flex-col justify-between p-8 rounded-3xl glass-panel relative overflow-hidden group">
        <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-600/10 rounded-full blur-3xl group-hover:bg-indigo-600/20 transition-all duration-500"></div>
        <div className="space-y-4 relative z-10">
          <div className="w-12 h-12 bg-indigo-500/10 border border-indigo-500/20 rounded-2xl flex items-center justify-center text-indigo-400">
            <LogIn className="w-6 h-6" />
          </div>
          <h3 className="text-xl font-bold text-white">Join with Code</h3>
          <p className="text-sm text-slate-400 leading-relaxed">
            Enter the 6-character room code shared by the other peer. This will initiate the signaling handshake and establish a direct connection.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-400">
              <KeyRound className="w-5 h-5" />
            </div>
            <input
              type="text"
              placeholder="ENTER 6-CHAR CODE"
              value={code}
              onChange={handleInputChange}
              disabled={isLoading}
              className="w-full pl-12 pr-4 py-4 text-center text-lg font-bold tracking-widest uppercase rounded-2xl glass-input placeholder:text-slate-600 placeholder:tracking-normal placeholder:font-medium placeholder:text-sm"
              required
            />
          </div>

          <button
            type="submit"
            disabled={isLoading || code.length !== 6}
            className="w-full py-4 bg-slate-800 hover:bg-slate-700 disabled:bg-slate-900/60 disabled:text-slate-500 text-white font-semibold rounded-2xl border border-white/5 disabled:border-transparent transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg active:scale-[0.98]"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Connecting...
              </>
            ) : (
              <>
                <LogIn className="w-5 h-5" />
                Join Room
              </>
            )}
          </button>
        </form>
      </div>

      {/* Safety Notice Banner */}
      <div className="md:col-span-2 mt-4 p-4 rounded-2xl glass-panel bg-white/5 border-white/5 flex items-center gap-3">
        <ShieldCheck className="w-6 h-6 text-emerald-400 flex-shrink-0" />
        <p className="text-xs text-slate-400 leading-relaxed">
          <strong>Privacy Guarantee:</strong> All files and messages are transferred directly between browser endpoints. No files, messages, or metadata are ever uploaded to our servers. The signaling process serves exclusively to connect the two devices.
        </p>
      </div>
    </div>
  );
};
