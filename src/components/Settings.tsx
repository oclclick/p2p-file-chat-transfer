import React, { useState, useEffect } from 'react';
import { X, Settings2, ShieldCheck, HelpCircle } from 'lucide-react';
import { SignalingSettings, IceServerConfig } from '../types';

interface SettingsProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (settings: SignalingSettings) => void;
}

export const loadSignalingSettings = (): SignalingSettings => {
  if (typeof window === 'undefined') {
    return { useCustomTurn: false, turnServer: '' };
  }
  const saved = localStorage.getItem('p2p_sender_settings');
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch (e) {
      // Ignore
    }
  }
  return { useCustomTurn: false, turnServer: '' };
};

export const getIceConfig = (settings: SignalingSettings): IceServerConfig | undefined => {
  if (settings.useCustomTurn && settings.turnServer) {
    return {
      urls: [settings.turnServer],
      username: settings.turnUsername,
      credential: settings.turnPassword
    };
  }
  return undefined;
};

export const Settings: React.FC<SettingsProps> = ({ isOpen, onClose, onSave }) => {
  const [useCustomTurn, setUseCustomTurn] = useState(false);
  const [turnServer, setTurnServer] = useState('');
  const [turnUsername, setTurnUsername] = useState('');
  const [turnPassword, setTurnPassword] = useState('');

  useEffect(() => {
    const settings = loadSignalingSettings();
    setUseCustomTurn(settings.useCustomTurn);
    setTurnServer(settings.turnServer || '');
    setTurnUsername(settings.turnUsername || '');
    setTurnPassword(settings.turnPassword || '');
  }, [isOpen]);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const settings: SignalingSettings = {
      useCustomTurn,
      turnServer: turnServer.trim(),
      turnUsername: turnUsername.trim() || undefined,
      turnPassword: turnPassword.trim() || undefined
    };
    localStorage.setItem('p2p_sender_settings', JSON.stringify(settings));
    onSave(settings);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-md overflow-hidden rounded-2xl glass-panel border border-white/10 shadow-2xl animate-scale-up">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/5">
          <div className="flex items-center gap-2">
            <Settings2 className="w-5 h-5 text-purple-400" />
            <h2 className="text-lg font-semibold text-white">Network Settings</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSave} className="p-6 space-y-5">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <label htmlFor="turn-toggle" className="text-sm font-medium text-white flex items-center gap-1.5">
                Use Custom TURN Server
                <div className="group relative">
                  <HelpCircle className="w-3.5 h-3.5 text-slate-400 cursor-help" />
                  <span className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 w-48 p-2 bg-slate-950 text-xs rounded border border-white/10 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none shadow-xl leading-normal">
                    Used to bypass symmetric NAT firewalls when direct connection fails.
                  </span>
                </div>
              </label>
              <p className="text-xs text-slate-400">
                Recommended if you are on restricted networks
              </p>
            </div>
            <input
              id="turn-toggle"
              type="checkbox"
              checked={useCustomTurn}
              onChange={(e) => setUseCustomTurn(e.target.checked)}
              className="w-10 h-5 bg-slate-800 rounded-full border-slate-700 checked:bg-purple-600 focus:ring-0 cursor-pointer appearance-none relative before:content-[''] before:absolute before:h-4 before:w-4 before:left-0.5 before:bottom-0.5 before:bg-white before:rounded-full before:transition-transform checked:before:translate-x-5"
            />
          </div>

          {useCustomTurn && (
            <div className="space-y-4 animate-slide-down">
              <div>
                <label className="block mb-1.5 text-xs font-medium text-slate-300">
                  TURN Server URL
                </label>
                <input
                  type="text"
                  placeholder="turn:example.com:3478"
                  value={turnServer}
                  onChange={(e) => setTurnServer(e.target.value)}
                  required={useCustomTurn}
                  className="w-full px-3.5 py-2 rounded-xl text-sm glass-input"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block mb-1.5 text-xs font-medium text-slate-300">
                    Username
                  </label>
                  <input
                    type="text"
                    placeholder="my-username"
                    value={turnUsername}
                    onChange={(e) => setTurnUsername(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl text-sm glass-input"
                  />
                </div>
                <div>
                  <label className="block mb-1.5 text-xs font-medium text-slate-300">
                    Password / Credential
                  </label>
                  <input
                    type="password"
                    placeholder="••••••••"
                    value={turnPassword}
                    onChange={(e) => setTurnPassword(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl text-sm glass-input"
                  />
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 p-3 bg-purple-500/5 border border-purple-500/10 rounded-xl">
            <ShieldCheck className="w-5 h-5 text-purple-400 flex-shrink-0" />
            <p className="text-xs text-slate-300 leading-normal">
              By default, we route connections through secure, anonymous Google STUN servers. No user data is ever exposed.
            </p>
          </div>

          {/* Footer Buttons */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-white/5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium rounded-xl text-slate-300 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 text-sm font-medium bg-purple-600 hover:bg-purple-500 text-white rounded-xl shadow-lg hover:shadow-purple-500/20 active:scale-95 transition-all"
            >
              Save Settings
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
