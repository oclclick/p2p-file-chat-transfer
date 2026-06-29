import React, { useRef, useState } from 'react';
import { UploadCloud, File, RefreshCw, X, Download, AlertCircle, CheckCircle2 } from 'lucide-react';
import { FileTransfer } from '../types';
import { formatBytes, formatSpeed, formatTime } from '../lib/utils';

interface FileAreaProps {
  transfer: FileTransfer | null;
  onSendFile: (file: File) => void;
  onAcceptFile: () => void;
  onRejectFile: () => void;
  onCancelTransfer: () => void;
  onResetTransfer: () => void;
}

export const FileArea: React.FC<FileAreaProps> = ({
  transfer,
  onSendFile,
  onAcceptFile,
  onRejectFile,
  onCancelTransfer,
  onResetTransfer
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragActive, setIsDragActive] = useState(false);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setIsDragActive(true);
    } else if (e.type === 'dragleave') {
      setIsDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      onSendFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onSendFile(e.target.files[0]);
    }
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  // If no active transfer, display the Drag & Drop area
  if (!transfer || transfer.state === 'idle') {
    return (
      <div className="flex flex-col h-full justify-between p-8 rounded-3xl glass-panel relative overflow-hidden group">
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-white">File Transfer</h3>
          <p className="text-xs text-slate-400">Send files directly to your peer over secure WebRTC channels</p>
        </div>

        <div
          onDragEnter={handleDrag}
          onDragOver={handleDrag}
          onDragLeave={handleDrag}
          onDrop={handleDrop}
          onClick={triggerFileInput}
          className={`mt-6 flex-grow min-h-[220px] flex flex-col items-center justify-center border-2 border-dashed rounded-2xl cursor-pointer p-6 transition-all duration-300 ${
            isDragActive
              ? 'border-purple-500 bg-purple-500/5 shadow-inner scale-[1.01]'
              : 'border-white/10 hover:border-purple-500/50 hover:bg-white/5 bg-slate-950/20'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            onChange={handleFileChange}
            className="hidden"
          />
          <UploadCloud className={`w-12 h-12 mb-4 transition-transform duration-300 ${isDragActive ? 'translate-y-[-4px] text-purple-400' : 'text-slate-400 group-hover:text-purple-400'}`} />
          <p className="text-sm font-semibold text-slate-200 text-center">
            Drag & drop your file here
          </p>
          <p className="text-xs text-slate-400 mt-1.5 text-center">
            or click to browse local files
          </p>
        </div>
      </div>
    );
  }

  const { metadata, role, state, progress, bytesTransferred, speed, eta, error, downloadUrl } = transfer;

  return (
    <div className="flex flex-col h-full justify-between p-8 rounded-3xl glass-panel relative overflow-hidden">
      {/* Header Info */}
      <div className="space-y-1">
        <h3 className="text-lg font-semibold text-white">
          {role === 'sender' ? 'Outgoing Transfer' : 'Incoming Transfer'}
        </h3>
        <p className="text-xs text-slate-400">
          File: <span className="text-slate-200 font-medium">{metadata.name}</span> ({formatBytes(metadata.size)})
        </p>
      </div>

      {/* State Machine UI Router */}
      <div className="my-8 flex-grow flex flex-col justify-center">
        {/* Waiting Approval (Sender Side) */}
        {state === 'waiting_approval' && role === 'sender' && (
          <div className="text-center space-y-4 py-4">
            <div className="relative inline-flex">
              <div className="w-12 h-12 rounded-full border border-purple-500/20 bg-purple-500/5 flex items-center justify-center text-purple-400">
                <RefreshCw className="w-5 h-5 animate-spin" />
              </div>
            </div>
            <p className="text-sm font-medium text-slate-300">
              Waiting for peer to accept transfer request...
            </p>
            <button
              onClick={onCancelTransfer}
              className="px-4 py-2 text-xs font-semibold bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white rounded-xl border border-white/5 transition-all flex items-center gap-1.5 mx-auto cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
              Cancel Offer
            </button>
          </div>
        )}

        {/* Waiting Approval (Receiver Side) */}
        {state === 'waiting_approval' && role === 'receiver' && (
          <div className="text-center space-y-5 py-4">
            <div className="w-12 h-12 rounded-full border border-purple-500/20 bg-purple-500/5 flex items-center justify-center text-purple-400 mx-auto">
              <File className="w-5 h-5 animate-pulse" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-slate-200">
                Incoming File Offer
              </p>
              <p className="text-xs text-slate-400">
                {metadata.name} ({formatBytes(metadata.size)})
              </p>
            </div>
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={onRejectFile}
                className="px-5 py-2.5 text-xs font-bold rounded-xl text-slate-300 hover:text-white bg-slate-900 border border-white/5 hover:bg-slate-800 transition-all cursor-pointer"
              >
                Reject
              </button>
              <button
                onClick={onAcceptFile}
                className="px-5 py-2.5 text-xs font-bold bg-purple-600 hover:bg-purple-500 text-white rounded-xl shadow-lg hover:shadow-purple-500/20 transition-all cursor-pointer"
              >
                Accept & Stream
              </button>
            </div>
          </div>
        )}

        {/* Transferring Progress State */}
        {state === 'transferring' && (
          <div className="space-y-5">
            {/* Progress Indicators */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold">
                <span className="text-slate-300">
                  {role === 'sender' ? 'Uploading chunks...' : 'Streaming to IndexedDB...'}
                </span>
                <span className="text-purple-400">{progress}%</span>
              </div>
              <div className="w-full h-3 rounded-full bg-slate-950/50 border border-white/5 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-purple-500 to-indigo-500 rounded-full transition-all duration-200"
                  style={{ width: `${progress}%` }}
                ></div>
              </div>
            </div>

            {/* Statistics Dash */}
            <div className="grid grid-cols-2 gap-3 p-4 rounded-2xl bg-slate-950/20 border border-white/5">
              <div className="space-y-0.5">
                <p className="text-[10px] uppercase font-bold tracking-wider text-slate-500">Transferred</p>
                <p className="text-xs font-semibold text-slate-200">
                  {formatBytes(bytesTransferred)} / {formatBytes(metadata.size)}
                </p>
              </div>
              <div className="space-y-0.5">
                <p className="text-[10px] uppercase font-bold tracking-wider text-slate-500">Speed</p>
                <p className="text-xs font-semibold text-slate-200">{formatSpeed(speed)}</p>
              </div>
              <div className="space-y-0.5 col-span-2">
                <p className="text-[10px] uppercase font-bold tracking-wider text-slate-500">Estimated Time Remaining</p>
                <p className="text-xs font-semibold text-slate-200">{formatTime(eta)}</p>
              </div>
            </div>

            <button
              onClick={onCancelTransfer}
              className="px-4 py-2 text-xs font-semibold bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 text-rose-300 hover:text-rose-200 rounded-xl transition-all flex items-center gap-1.5 mx-auto cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
              Cancel Transfer
            </button>
          </div>
        )}

        {/* Transfer Completed */}
        {state === 'completed' && (
          <div className="text-center space-y-4 py-4">
            <div className="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 mx-auto">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-emerald-400">Transfer Completed!</p>
              <p className="text-xs text-slate-400">
                {metadata.name} ({formatBytes(metadata.size)})
              </p>
            </div>

            {role === 'receiver' && downloadUrl && (
              <a
                href={downloadUrl}
                download={metadata.name}
                className="inline-flex items-center gap-2 px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-xl shadow-lg hover:shadow-emerald-500/20 active:scale-95 transition-all cursor-pointer mx-auto"
              >
                <Download className="w-4 h-4" />
                Download File
              </a>
            )}

            <button
              onClick={onResetTransfer}
              className="block mx-auto text-xs font-semibold text-slate-400 hover:text-white transition-colors underline pt-2 cursor-pointer"
            >
              Send Another File
            </button>
          </div>
        )}

        {/* Rejected Offer */}
        {state === 'rejected' && (
          <div className="text-center space-y-4 py-4">
            <div className="w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 mx-auto">
              <AlertCircle className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-amber-300">Offer Rejected</p>
              <p className="text-xs text-slate-400">The remote peer declined your transfer offer.</p>
            </div>
            <button
              onClick={onResetTransfer}
              className="px-4 py-2 text-xs font-semibold bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white rounded-xl border border-white/5 transition-all cursor-pointer mx-auto"
            >
              Reset
            </button>
          </div>
        )}

        {/* Cancelled Transfer */}
        {state === 'cancelled' && (
          <div className="text-center space-y-4 py-4">
            <div className="w-12 h-12 rounded-full bg-slate-500/10 border border-slate-500/20 flex items-center justify-center text-slate-400 mx-auto">
              <X className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-slate-300">Transfer Cancelled</p>
              <p className="text-xs text-slate-400">The file transfer was stopped mid-way.</p>
            </div>
            <button
              onClick={onResetTransfer}
              className="px-4 py-2 text-xs font-semibold bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white rounded-xl border border-white/5 transition-all cursor-pointer mx-auto"
            >
              Reset
            </button>
          </div>
        )}

        {/* Failed Transfer */}
        {state === 'failed' && (
          <div className="text-center space-y-4 py-4">
            <div className="w-12 h-12 rounded-full bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400 mx-auto">
              <AlertCircle className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-rose-400">Transfer Failed</p>
              <p className="text-xs text-slate-400 leading-normal max-w-xs mx-auto">
                {error || 'An unexpected WebRTC failure occurred.'}
              </p>
            </div>
            <button
              onClick={onResetTransfer}
              className="px-4 py-2 text-xs font-semibold bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white rounded-xl border border-white/5 transition-all cursor-pointer mx-auto"
            >
              Reset / Retry
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
