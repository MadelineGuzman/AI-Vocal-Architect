import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Mic, Play, Square, Trash2, X } from 'lucide-react';
import { useProjectStore } from '../store/projectStore';
import { decodeAudio, analyzeMelody } from '../services/MelodyAnalyzer';
import { SparkAudioStore } from '../services/SparkAudioStore';
import { MelodyAnalysis, Spark } from '../types';

const MAX_SECONDS = 30;

export const HumToSparkDialog: React.FC = () => {
  const { isHumModalOpen, setIsHumModalOpen, sparks, addSpark, removeSpark } = useProjectStore();
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [status, setStatus] = useState<'idle' | 'recording' | 'analyzing' | 'preview'>('idle');
  const [preview, setPreview] = useState<{ blob: Blob; url: string; analysis: MelodyAnalysis } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const releaseStream = () => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
  };

  const clearTimer = () => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = null;
  };

  const stopRecording = () => {
    clearTimer();
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  };

  useEffect(() => () => {
    clearTimer();
    releaseStream();
    if (preview) URL.revokeObjectURL(preview.url);
  }, [preview]);

  const startRecording = async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setError('Microphone recording is unavailable in this browser.');
      return;
    }
    try {
      if (preview) URL.revokeObjectURL(preview.url);
      setPreview(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = event => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = async () => {
        releaseStream();
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        if (!blob.size) { setStatus('idle'); setError('No audio was captured.'); return; }
        setStatus('analyzing');
        try {
          const analysis = analyzeMelody(await decodeAudio(blob));
          setPreview({ blob, url: URL.createObjectURL(blob), analysis });
          setStatus('preview');
        } catch {
          setStatus('idle');
          setError('Cadenzai could not decode that recording. Please try again.');
        }
      };
      recorder.start();
      setElapsed(0);
      setStatus('recording');
      const started = Date.now();
      timerRef.current = window.setInterval(() => {
        const seconds = (Date.now() - started) / 1000;
        setElapsed(seconds);
        if (seconds >= MAX_SECONDS) stopRecording();
      }, 100);
    } catch {
      releaseStream();
      setError('Microphone access was not granted. Check the browser permission and try again.');
    }
  };

  const saveSpark = async () => {
    if (!preview) return;
    const id = `spark-${crypto.randomUUID()}`;
    await SparkAudioStore.put(id, preview.blob);
    const spark: Spark = {
      id,
      title: `Spark ${new Date().toLocaleString()}`,
      createdAt: Date.now(),
      audioKey: id,
      analysis: preview.analysis,
    };
    addSpark(spark);
    URL.revokeObjectURL(preview.url);
    setPreview(null);
    setStatus('idle');
  };

  const playSpark = async (spark: Spark) => {
    const blob = await SparkAudioStore.get(spark.audioKey);
    if (!blob) { setError('The locally stored recording could not be found.'); return; }
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.onended = () => URL.revokeObjectURL(url);
    await audio.play();
  };

  const deleteSpark = async (spark: Spark) => {
    await SparkAudioStore.remove(spark.audioKey);
    removeSpark(spark.id);
  };

  const close = () => {
    if (status === 'recording') stopRecording();
    setIsHumModalOpen(false);
  };

  if (!isHumModalOpen) return null;
  const analysis = preview?.analysis;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 backdrop-blur-sm p-6">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-2xl max-h-full overflow-hidden shadow-2xl flex flex-col">
        <header className="flex items-center justify-between p-5 border-b border-zinc-800 bg-zinc-950/50">
          <div><h2 className="text-lg font-semibold text-zinc-100 flex items-center gap-2"><Mic size={18} className="text-cyan-400" /> Hum to Spark</h2><p className="text-xs text-zinc-500 mt-1">Analyzed locally. Audio stays in this browser.</p></div>
          <button onClick={close} className="p-1 text-zinc-500 hover:text-zinc-200"><X size={20} /></button>
        </header>

        <div className="p-6 overflow-y-auto space-y-6">
          <section className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-6 text-center">
            {status === 'recording' ? <><p className="text-red-400 text-xs font-bold uppercase tracking-widest">Recording</p><p className="text-4xl font-mono my-5">{elapsed.toFixed(1)}s</p><button onClick={stopRecording} className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-5 py-3 font-medium text-white"><Square size={16} /> Stop and analyze</button></> :
             status === 'analyzing' ? <div className="py-8 flex flex-col items-center gap-4"><Loader2 className="animate-spin text-cyan-400" /><p className="text-zinc-300">Reading pitch and melodic shape...</p></div> :
             status === 'preview' && analysis ? <div className="text-left space-y-4">
               <audio controls src={preview.url} className="w-full" />
               <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                 <Metric label="Read" value={analysis.read.inference} />
                 <Metric label="Confidence" value={`${Math.round(analysis.read.confidence * 100)}%`} />
                 <Metric label="Key" value={analysis.key.value || 'Inconclusive'} />
                 <Metric label="Notes" value={String(analysis.notes.length)} />
               </div>
               <ul className="text-sm text-zinc-400 list-disc pl-5">{analysis.read.evidence.map(item => <li key={item}>{item}</li>)}</ul>
               <p className="text-xs text-zinc-500">{analysis.read.limitations.join(' ')}</p>
               <div className="flex gap-3"><button onClick={saveSpark} className="rounded-lg bg-cyan-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-cyan-500">Save Spark</button><button onClick={startRecording} className="rounded-lg border border-zinc-700 px-5 py-2.5 text-sm text-zinc-300 hover:bg-zinc-800">Re-record</button></div>
             </div> : <div className="py-8"><Mic size={34} className="mx-auto text-cyan-400 mb-4" /><h3 className="text-xl text-zinc-100 font-semibold">Capture an idea before it disappears</h3><p className="text-sm text-zinc-500 mt-2 mb-6">Hum or sing for at least three seconds. Cadenzai will report only what the recording supports.</p><button onClick={startRecording} className="inline-flex items-center gap-2 rounded-lg bg-cyan-600 px-5 py-3 font-medium text-white hover:bg-cyan-500"><Mic size={16} /> Start recording</button></div>}
            {error && <p className="text-sm text-red-400 mt-4">{error}</p>}
          </section>

          <section><div className="flex items-center justify-between mb-3"><h3 className="text-xs uppercase tracking-widest font-bold text-zinc-300">Saved Sparks</h3><span className="text-xs font-mono text-zinc-600">{sparks.length}</span></div>
            <div className="space-y-2">{sparks.length === 0 ? <p className="text-sm text-zinc-600">No captured ideas yet.</p> : sparks.map(spark => <article key={spark.id} className="flex items-center gap-4 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4"><button onClick={() => playSpark(spark)} className="rounded-full p-2 bg-zinc-800 hover:bg-zinc-700"><Play size={14} /></button><div className="min-w-0 flex-1"><p className="text-sm text-zinc-200 truncate">{spark.title}</p><p className="text-xs text-zinc-500">{spark.analysis.read.inference} · {spark.analysis.key.value || 'key inconclusive'}</p></div><button onClick={() => deleteSpark(spark)} className="p-2 text-zinc-600 hover:text-red-400" title="Delete Spark"><Trash2 size={15} /></button></article>)}</div>
          </section>
        </div>
      </div>
    </div>
  );
};

const Metric = ({ label, value }: { label: string; value: string }) => <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-3"><p className="text-[10px] uppercase tracking-widest text-zinc-600">{label}</p><p className="text-sm text-zinc-200 mt-1 capitalize">{value}</p></div>;
