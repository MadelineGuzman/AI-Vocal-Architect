import React, { useState, useRef } from 'react';
import { useProjectStore } from '../store/projectStore';
import { AssetMetadata } from '../types';
import { DSPAnalyzer } from '../services/DSPAnalyzer';
import { AnalysisService } from '../services/AnalysisService';
import { Upload, X, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';

const ASSET_TYPES = [
  'Individual Stem',
  'Stem Mix / Premix',
  'Full Mix / Premix',
  'Final Mix',
  'Mastered Track',
  'Reference Track',
  'Other'
];

const CONTENT_LABELS = [
  'Drums',
  'Percussion',
  'Bass',
  'Lead Vocal',
  'Background Vocals',
  'Guitars',
  'Keys',
  'Synths',
  'Orchestra / Strings',
  'FX',
  'Other / Custom'
];

export const ImportAudioDialog: React.FC = () => {
  const { isImportModalOpen, setIsImportModalOpen, setAudio, setFindings, setWindowedPowers, setIsAnalyzing } = useProjectStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [assetType, setAssetType] = useState<string>('');
  const [content, setContent] = useState<string>('');
  const [userLabel, setUserLabel] = useState<string>('');
  
  const [isProcessing, setIsProcessing] = useState(false);

  const resetState = () => {
    setSelectedFile(null);
    setAssetType('');
    setContent('');
    setUserLabel('');
    setIsProcessing(false);
  };

  const handleClose = () => {
    if (isProcessing) return;
    setIsImportModalOpen(false);
    resetState();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  const handleImport = async () => {
    if (!selectedFile) return;
    
    const metadata: AssetMetadata = {
      assetType,
      content,
      userLabel
    };

    const url = URL.createObjectURL(selectedFile);
    
    setIsProcessing(true);
    setIsAnalyzing(true);
    setAudio(url, selectedFile.name, metadata);
    setIsImportModalOpen(false); // Close dialog immediately and show main loading state
    resetState();
    
    try {
      const audioBuffer = await DSPAnalyzer.fetchAndDecodeAudio(url);
      const windowSize = 0.5;
      const powerValues = DSPAnalyzer.calculateWindowedPower(audioBuffer, windowSize);
      const mockAnalysis = await AnalysisService.analyzeAudio(url);
      
      setFindings(mockAnalysis.findings);
      setWindowedPowers(powerValues);
    } catch (err) {
      console.error("Analysis failed:", err);
    } finally {
      setIsAnalyzing(false);
    }
  };

  if (!isImportModalOpen) return null;

  const showContentSelection = assetType === 'Individual Stem' || assetType === 'Stem Mix / Premix';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-6">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col max-h-full">
        <div className="flex items-center justify-between p-5 border-b border-zinc-800 bg-zinc-950/50">
          <h2 className="text-lg font-semibold text-zinc-100 flex items-center gap-2">
            <Upload size={18} className="text-cyan-500" /> Import Audio
          </h2>
          <button 
            onClick={handleClose}
            disabled={isProcessing}
            className="text-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-50 p-1"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 custom-scrollbar space-y-6">
          {!selectedFile ? (
            <div 
              className="border-2 border-dashed border-zinc-700/50 rounded-xl p-10 flex flex-col items-center justify-center text-center hover:bg-zinc-800/50 hover:border-zinc-600 transition-all cursor-pointer group"
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <Upload size={28} className="text-zinc-400 group-hover:text-cyan-400 transition-colors" />
              </div>
              <h3 className="text-zinc-200 font-medium mb-1">Select Audio File</h3>
              <p className="text-sm text-zinc-500">WAV, MP3, AIFF up to 100MB</p>
              <input type="file" accept="audio/*" ref={fileInputRef} className="hidden" onChange={handleFileChange} />
            </div>
          ) : (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="bg-zinc-950 border border-zinc-800 p-4 rounded-xl flex items-center justify-between">
                <div className="truncate pr-4">
                  <p className="text-xs text-zinc-500 font-medium uppercase tracking-wider mb-1">Selected File</p>
                  <p className="text-zinc-200 font-medium truncate">{selectedFile.name}</p>
                </div>
                <button 
                  onClick={() => setSelectedFile(null)}
                  className="text-xs text-zinc-400 hover:text-zinc-200 uppercase tracking-widest font-bold"
                >
                  Change
                </button>
              </div>

              <div className="space-y-3">
                <label className="block text-sm font-medium text-zinc-300">What are you uploading?</label>
                <div className="grid grid-cols-2 gap-2">
                  {ASSET_TYPES.map(type => (
                    <button
                      key={type}
                      onClick={() => { setAssetType(type); setContent(''); }}
                      className={clsx(
                        "px-3 py-2.5 rounded-lg text-sm text-left transition-all border",
                        assetType === type 
                          ? "bg-cyan-500/10 border-cyan-500/50 text-cyan-400 font-medium" 
                          : "bg-zinc-950 border-zinc-800 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300"
                      )}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>

              {showContentSelection && (
                <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
                  <label className="block text-sm font-medium text-zinc-300">Content Category</label>
                  <div className="grid grid-cols-3 gap-2">
                    {CONTENT_LABELS.map(label => (
                      <button
                        key={label}
                        onClick={() => setContent(label)}
                        className={clsx(
                          "px-3 py-2 rounded-lg text-xs text-center transition-all border",
                          content === label 
                            ? "bg-cyan-500/10 border-cyan-500/50 text-cyan-400 font-medium" 
                            : "bg-zinc-950 border-zinc-800 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300"
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {(content === 'Other / Custom' || (!showContentSelection && assetType)) && (
                <div className="space-y-2 animate-in fade-in slide-in-from-top-2">
                  <label className="block text-sm font-medium text-zinc-300">User Label (Optional)</label>
                  <input
                    type="text"
                    value={userLabel}
                    onChange={(e) => setUserLabel(e.target.value)}
                    placeholder="e.g. Drum Pre-Mix v2"
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-cyan-600"
                  />
                </div>
              )}
            </div>
          )}
        </div>

        <div className="p-5 border-t border-zinc-800 bg-zinc-950 flex justify-end gap-3">
          <button
            onClick={handleClose}
            disabled={isProcessing}
            className="px-5 py-2.5 rounded-lg text-sm font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={!selectedFile || !assetType || (showContentSelection && !content) || isProcessing}
            className="px-5 py-2.5 rounded-lg text-sm font-medium bg-cyan-600 text-white hover:bg-cyan-500 transition-colors disabled:opacity-50 disabled:hover:bg-cyan-600 flex items-center gap-2"
          >
            {isProcessing ? (
              <><Loader2 size={16} className="animate-spin" /> Analyzing...</>
            ) : (
              'Import & Analyze'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
