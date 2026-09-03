import React, { useEffect, useRef, useState } from 'react';
import { useProjectStore } from '../../store/projectStore';
import { clsx } from 'clsx';
import { Check, X, Search, MessageSquare, ArrowRight, XCircle, Copy } from 'lucide-react';
import { Finding } from '../../types';
import { AssistantService, ChatContext } from '../../services/AssistantService';

export const IntelligenceHub: React.FC = () => {
  const { findings, selectedFindingId, setSelectedFinding, updateFindingStatus, chatHistory, addChatMessage, currentTime, duration, sections, audioFileName, windowedPowers, assetMetadata, abortController, setAbortController } = useProjectStore();
  const listRef = useRef<HTMLDivElement>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  const [isChatOpen, setIsChatOpen] = useState(false);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);

  const handleCopy = (id: string, content: string) => {
    navigator.clipboard.writeText(content);
    setCopiedMessageId(id);
    setTimeout(() => {
      setCopiedMessageId(null);
    }, 2000);
  };

  const formatTime = (time: number) => {
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  useEffect(() => {
    if (selectedFindingId && listRef.current && !isChatOpen) {
      const el = document.getElementById(`finding-${selectedFindingId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, [selectedFindingId, isChatOpen]);

  useEffect(() => {
    if (isChatOpen && chatBottomRef.current) {
      chatBottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatHistory, isChatOpen]);

  const handleStop = () => {
    if (abortController) {
      abortController.abort();
      setAbortController(null);
      setIsTyping(false);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || isTyping) return;

    const userMsg = { id: `msg-${Date.now()}`, role: 'user' as const, content: input.trim(), timestamp: Date.now() };
    addChatMessage(userMsg);
    setInput('');
    setIsTyping(true);

    const controller = new AbortController();
    setAbortController(controller);

    const currentSection = sections.find(s => currentTime >= s.timeRange.start && (s.timeRange.end === undefined || currentTime <= s.timeRange.end)) || null;
    const selectedFinding = findings.find(f => f.id === selectedFindingId) || null;

    const context: ChatContext = {
      trackName: audioFileName,
      duration,
      currentTime,
      currentSection,
      sections,
      selectedFinding,
      windowedPowers,
      allFindings: findings,
      assetMetadata
    };

    try {
      const responseText = await AssistantService.sendMessage([...chatHistory, userMsg], context, controller.signal);
      addChatMessage({ id: `msg-${Date.now()+1}`, role: 'assistant', content: responseText, timestamp: Date.now()+1 });
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        addChatMessage({ id: `msg-${Date.now()+1}`, role: 'assistant', content: `Error: ${err.message}`, timestamp: Date.now()+1 });
      }
    } finally {
      if (useProjectStore.getState().abortController === controller) {
         setAbortController(null);
         setIsTyping(false);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    // Prevent Spacebar from triggering play/pause
    if (e.key === ' ') {
      e.stopPropagation();
    }
  };

  return (
    <div className="w-[420px] border-l border-zinc-800 bg-zinc-900/40 flex flex-col h-full shrink-0 relative z-10 shadow-2xl">
      <div className="p-5 border-b border-zinc-800 flex items-center justify-between bg-zinc-950/50 backdrop-blur-md">
        <h2 className="text-xs font-bold text-zinc-200 uppercase tracking-widest">
          {isChatOpen ? 'Assistant' : 'Findings'}
        </h2>
        {!isChatOpen ? (
          <span className="text-[10px] font-mono text-zinc-500 px-2 py-1 bg-zinc-900 rounded-md border border-zinc-800">{findings.length} DETECTED</span>
        ) : (
          <button onClick={() => setIsChatOpen(false)} className="text-zinc-400 hover:text-white">
            <XCircle size={16} />
          </button>
        )}
      </div>

      {!isChatOpen ? (
        <div ref={listRef} className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
          {findings.length === 0 && (
            <div className="text-zinc-500 text-sm text-center mt-12 px-6">
              No analysis data yet. Import an audio file to begin.
            </div>
          )}
          {findings.map(finding => (
            <div
              id={`finding-${finding.id}`}
              key={finding.id}
              onClick={() => setSelectedFinding(finding.id)}
              className={clsx(
                "p-5 rounded-2xl border transition-all cursor-pointer text-left",
                selectedFindingId === finding.id
                  ? "bg-zinc-800 border-zinc-600 shadow-xl"
                  : "bg-zinc-900/50 border-zinc-800/50 hover:border-zinc-700 hover:bg-zinc-800/50"
              )}
            >
              <div className="flex justify-between items-start mb-3">
                <span className="text-xs font-mono text-zinc-400 bg-zinc-950/50 px-2 py-1 rounded border border-zinc-800/50">
                  {formatTime(finding.timeRange.start)} {finding.timeRange.end ? `- ${formatTime(finding.timeRange.end)}` : ''}
                </span>
                <div className="flex gap-2">
                  <span className={clsx(
                    "text-[9px] uppercase tracking-widest font-bold px-2 py-1 rounded-sm",
                    finding.provenance === 'real-dsp' ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20" : "bg-zinc-800/50 text-zinc-500 border border-zinc-700"
                  )}>
                    {finding.provenance === 'real-dsp' ? 'REAL DSP' : 'MOCK'}
                  </span>
                  <span className={clsx(
                    "text-[9px] uppercase tracking-widest font-bold px-2 py-1 rounded-sm",
                    finding.userStatus === 'accepted' ? "bg-green-500/10 text-green-400" :
                    finding.userStatus === 'investigate' ? "bg-blue-500/10 text-blue-400" :
                    finding.userStatus === 'ignored' ? "bg-red-500/10 text-red-400" :
                    "bg-zinc-800 text-zinc-400"
                  )}>
                    {finding.userStatus !== 'open' ? finding.userStatus : finding.category}
                  </span>
                </div>
              </div>

              <h3 className="text-[15px] font-semibold text-zinc-100 mb-1 leading-snug">{finding.observation}</h3>

              {selectedFindingId === finding.id && (
                <div className="mt-6 space-y-5 animate-in fade-in slide-in-from-top-2 duration-300">
                  <div>
                    <h4 className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mb-1.5 flex items-center gap-2">
                      Evidence <span className="w-full h-px bg-zinc-800/50 flex-1"></span>
                    </h4>
                    <p className="text-[13px] text-zinc-400 leading-relaxed">{finding.evidence}</p>
                  </div>
                  <div>
                    <h4 className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mb-1.5 flex items-center gap-2">
                      Why It Matters <span className="w-full h-px bg-zinc-800/50 flex-1"></span>
                    </h4>
                    <p className="text-[13px] text-zinc-400 leading-relaxed">{finding.explanation}</p>
                  </div>
                  <div>
                    <h4 className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mb-1.5 flex items-center gap-2">
                      Recommendation <span className="w-full h-px bg-zinc-800/50 flex-1"></span>
                    </h4>
                    <p className="text-[13px] text-zinc-300 leading-relaxed">{finding.recommendation}</p>
                  </div>

                  <div className="pt-4 flex gap-2">
                    <StatusButton finding={finding} status="accepted" icon={<Check size={14} />} label="Accept" onClick={updateFindingStatus} />
                    <StatusButton finding={finding} status="investigate" icon={<Search size={14} />} label="Investigate" onClick={updateFindingStatus} />
                    <StatusButton finding={finding} status="ignored" icon={<X size={14} />} label="Ignore" onClick={updateFindingStatus} />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
          {selectedFindingId && findings.find(f => f.id === selectedFindingId) && (
            <div className="mb-4 bg-zinc-900/50 border border-zinc-800 rounded-lg p-3 text-xs">
              <span className="text-zinc-500 block mb-1">Current Context:</span>
              <span className="text-zinc-300 font-semibold">{findings.find(f => f.id === selectedFindingId)?.observation}</span>
              {findings.find(f => f.id === selectedFindingId)?.provenance === 'mock' && (
                <span className="ml-2 bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded text-[9px] uppercase font-bold tracking-widest">Mock Data</span>
              )}
            </div>
          )}
          {chatHistory.length === 0 && (
            <div className="text-zinc-500 text-sm text-center mt-12 px-6">
              Ask Cadenzai about the current findings, song structure, or for production advice.
            </div>
          )}
          {chatHistory.map(msg => (
            <div key={msg.id} className={clsx("flex", msg.role === 'user' ? "justify-end" : "justify-start")}>
              <div className={clsx(
                "group relative max-w-[85%] rounded-xl p-3 text-[13px] leading-relaxed whitespace-pre-wrap",
                msg.role === 'user' ? "bg-cyan-900/50 text-cyan-50 border border-cyan-800/50" : "bg-zinc-800/80 text-zinc-300 border border-zinc-700/50 select-text",
                msg.role === 'assistant' && "pr-10"
              )}>
                {msg.content}

                {msg.role === 'assistant' && (
                  <button
                    onClick={() => handleCopy(msg.id, msg.content)}
                    className="absolute right-2 top-2 p-1.5 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700/50 opacity-0 group-hover:opacity-100 transition-all"
                    title="Copy response"
                  >
                    {copiedMessageId === msg.id ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                  </button>
                )}
              </div>
            </div>
          ))}
          {isTyping && (
            <div className="flex justify-start">
              <div className="bg-zinc-800/80 text-zinc-400 border border-zinc-700/50 rounded-xl p-3 text-[13px]">
                Thinking...
              </div>
            </div>
          )}
          <div ref={chatBottomRef} />
        </div>
      )}

      <div className="p-4 bg-zinc-950/50 backdrop-blur-md border-t border-zinc-800">
        {!isChatOpen ? (
          <button onClick={() => setIsChatOpen(true)} className="w-full flex items-center justify-between px-5 py-3.5 bg-zinc-900 rounded-xl border border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700 hover:bg-zinc-800 transition-all shadow-sm">
            <span className="text-sm font-medium">Ask Cadenzai...</span>
            <MessageSquare size={16} className="text-zinc-500" />
          </button>
        ) : (
          <div className="relative">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask a question..."
              className="w-full bg-zinc-900 border border-zinc-700 rounded-xl pl-4 pr-12 py-3 text-sm text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-cyan-600 resize-none min-h-[44px] max-h-[120px]"
              rows={Math.min(4, input.split('\n').length || 1)}
              disabled={isTyping}
            />
            {isTyping ? (
              <button
                onClick={handleStop}
                className="absolute right-2 bottom-2 p-2 rounded-lg bg-red-600/20 text-red-400 hover:bg-red-600/30 hover:text-red-300 transition-colors border border-red-900/50"
                title="Stop Generating"
              >
                <div className="w-3.5 h-3.5 bg-current rounded-sm"></div>
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!input.trim()}
                className="absolute right-2 bottom-2 p-2 rounded-lg bg-cyan-600 text-white hover:bg-cyan-500 disabled:opacity-50 disabled:hover:bg-cyan-600 transition-colors"
              >
                <ArrowRight size={14} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const StatusButton = ({ finding, status, icon, label, onClick }: { finding: Finding, status: Finding['userStatus'], icon: React.ReactNode, label: string, onClick: (id: string, status: Finding['userStatus']) => void }) => {
  const isActive = finding.userStatus === status;

  const getColors = () => {
    switch (status) {
      case 'accepted': return isActive ? "bg-green-500/20 text-green-300 border-green-500/30 shadow-[0_0_15px_rgba(34,197,94,0.15)]" : "bg-zinc-900 text-zinc-400 border-zinc-700 hover:bg-zinc-800 hover:text-zinc-300";
      case 'investigate': return isActive ? "bg-blue-500/20 text-blue-300 border-blue-500/30 shadow-[0_0_15px_rgba(59,130,246,0.15)]" : "bg-zinc-900 text-zinc-400 border-zinc-700 hover:bg-zinc-800 hover:text-zinc-300";
      case 'ignored': return isActive ? "bg-red-500/20 text-red-300 border-red-500/30 shadow-[0_0_15px_rgba(239,68,68,0.15)]" : "bg-zinc-900 text-zinc-400 border-zinc-700 hover:bg-zinc-800 hover:text-zinc-300";
      default: return "";
    }
  };

  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(finding.id, isActive ? 'open' : status); }}
      className={clsx(
        "flex-1 flex flex-col items-center justify-center gap-1.5 py-3 rounded-xl text-[10px] uppercase font-bold tracking-wider transition-all border",
        getColors()
      )}
    >
      {icon}
      {label}
    </button>
  );
};
