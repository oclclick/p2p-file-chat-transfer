import React, { useState, useRef, useEffect } from 'react';
import { Send, MessageSquare } from 'lucide-react';
import { ChatMessage } from '../types';

interface ChatAreaProps {
  messages: ChatMessage[];
  onSendMessage: (text: string) => void;
  isConnected: boolean;
}

export const ChatArea: React.FC<ChatAreaProps> = ({ messages, onSendMessage, isConnected }) => {
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputText.trim() && isConnected) {
      onSendMessage(inputText.trim());
      setInputText('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSend(e);
    }
  };

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const formatTimestamp = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="flex flex-col h-[400px] md:h-full justify-between p-6 rounded-3xl glass-panel relative overflow-hidden">
      {/* Header */}
      <div className="pb-4 border-b border-white/5 flex items-center gap-2">
        <MessageSquare className="w-5 h-5 text-purple-400" />
        <div>
          <h3 className="text-md font-semibold text-white">Live Chat</h3>
          <p className="text-[10px] text-slate-400">Direct encrypted messages</p>
        </div>
      </div>

      {/* Message Feed */}
      <div className="flex-grow my-4 overflow-y-auto pr-2 space-y-4 custom-scrollbar">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-4">
            <p className="text-xs text-slate-500 italic">
              {isConnected
                ? 'No messages yet. Say hello!'
                : 'Chat will become active once peer connects.'}
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            const isMe = msg.sender === 'me';
            return (
              <div
                key={msg.id}
                className={`flex flex-col max-w-[80%] ${isMe ? 'ml-auto items-end' : 'mr-auto items-start'}`}
              >
                <div
                  className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                    isMe
                      ? 'bg-gradient-to-br from-purple-600 to-indigo-600 text-white rounded-tr-none shadow-md'
                      : 'bg-white/5 border border-white/5 text-slate-100 rounded-tl-none'
                  }`}
                >
                  <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                </div>
                <span className="text-[9px] text-slate-500 mt-1 font-semibold tracking-wider">
                  {formatTimestamp(msg.timestamp)}
                </span>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input controls */}
      <form onSubmit={handleSend} className="flex gap-2 items-center">
        <input
          type="text"
          placeholder={isConnected ? "Type a message..." : "Waiting for peer to connect..."}
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!isConnected}
          className="flex-grow px-4 py-3 rounded-2xl text-sm glass-input disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <button
          type="submit"
          disabled={!isConnected || !inputText.trim()}
          className="p-3 bg-purple-600 hover:bg-purple-500 disabled:bg-slate-900 disabled:text-slate-600 text-white rounded-2xl shadow-lg hover:shadow-purple-500/20 active:scale-95 transition-all flexitems-center justify-center cursor-pointer disabled:cursor-not-allowed"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
};
