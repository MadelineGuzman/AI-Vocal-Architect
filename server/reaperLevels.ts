import { open } from 'node:fs/promises';
import path from 'node:path';
import { bridgePath } from './reaper';
import type { LevelReport, LevelMetrics } from '../src/types/reaper';
const object = (x: unknown): x is Record<string, unknown> => Boolean(x) && typeof x === 'object' && !Array.isArray(x);
const finite = (x: unknown, low: number, high: number): x is number => typeof x === 'number' && Number.isFinite(x) && x >= low && x <= high;
const text = (x: unknown, size=1024): x is string => typeof x === 'string' && x.length <= size;
const integer = (x: unknown, low: number, high: number): x is number => finite(x,low,high) && Number.isSafeInteger(x);
// Correlation id, restricted to the characters the server ever generates.
const requestId = (x: unknown): x is string => typeof x === 'string' && x.length >= 1 && x.length <= 128 && /^[A-Za-z0-9-]+$/.test(x);
export function validateLevelReport(x: unknown, now=Date.now()): LevelReport {
  if (!object(x) || x.version !== 1 || !['running','ready','error'].includes(String(x.status)) ||
    !text(x.id,128) || !x.id || !text(x.message) || !finite(x.updatedAt,1,now+5000) ||
    !text(x.projectId,128) || !x.projectId || !integer(x.projectRevision,0,Number.MAX_SAFE_INTEGER) ||
    !text(x.trackId,128) || !x.trackId || !text(x.trackName) || !text(x.takeId,128) || !x.takeId || !text(x.takeName) ||
    x.signal !== 'take-pre-fx' || !integer(x.sampleRate,8000,192000) || !integer(x.channels,1,2) ||
    !finite(x.startSeconds,-1e9,1e9) || !finite(x.endSeconds,x.startSeconds+1/x.sampleRate,x.startSeconds+120.001) ||
    !finite(x.progress,0,1) || (x.requestId !== undefined && !requestId(x.requestId))) throw new Error('Invalid level report');
  let metrics: LevelMetrics | undefined;
  if (x.status === 'ready') {
    const m=x.metrics;
    if (!object(m) || !integer(m.activeWindows,0,301) || !integer(m.sampleCount,1,46080000) ||
      !integer(m.samplesAtFullScale,0,m.sampleCount) || typeof m.silent !== 'boolean' || x.progress !== 1) throw new Error('Invalid metrics');
    for (const key of ['samplePeakDbfs','rmsDbfs','crestDb','activeVariationDb']) {
      if (m[key] !== undefined && !finite(m[key], key.endsWith('Dbfs') ? -10000 : 0, 10000)) throw new Error('Invalid metric');
    }
    if (!m.silent && (m.samplePeakDbfs === undefined || m.rmsDbfs === undefined || m.crestDb === undefined)) throw new Error('Missing signal metrics');
    if (m.silent && (m.samplePeakDbfs !== undefined || m.rmsDbfs !== undefined || m.samplesAtFullScale !== 0)) throw new Error('Invalid silence metrics');
    if (m.activeWindows < 2 && m.activeVariationDb !== undefined) throw new Error('Insufficient active windows');
    metrics={ samplePeakDbfs:m.samplePeakDbfs as number|undefined, rmsDbfs:m.rmsDbfs as number|undefined,
      crestDb:m.crestDb as number|undefined, activeVariationDb:m.activeVariationDb as number|undefined,
      activeWindows:m.activeWindows, sampleCount:m.sampleCount, samplesAtFullScale:m.samplesAtFullScale, silent:m.silent };
  }
  return { version:1,id:x.id,status:x.status as LevelReport['status'],message:x.message,updatedAt:x.updatedAt,
    requestId: requestId(x.requestId) ? x.requestId : undefined,
    projectId:x.projectId,projectRevision:x.projectRevision,trackId:x.trackId,trackName:x.trackName,
    takeId:x.takeId,takeName:x.takeName,signal:'take-pre-fx',sampleRate:x.sampleRate,channels:x.channels,
    startSeconds:x.startSeconds,endSeconds:x.endSeconds,progress:x.progress,metrics };
}
export async function readLevelReport(filename=path.join(path.dirname(bridgePath()),'levels.json'),now=Date.now()): Promise<{ levels:LevelReport|null; levelsError?:string; levelsNotice?: {message:string; updatedAt:number} }> {
  try {
    const file=await open(filename,'r');
    try {
      const buffer=Buffer.alloc(16385);
      const {bytesRead}=await file.read(buffer,0,buffer.length,0);
      if (bytesRead>16384) throw new Error('Oversize report');
      const raw: unknown=JSON.parse(buffer.subarray(0,bytesRead).toString('utf8'));
      if (object(raw) && raw.kind==='notice') {
        if (raw.version!==1 || !text(raw.message) || !raw.message || !finite(raw.updatedAt,1,now+5000) ||
            (raw.requestId !== undefined && !requestId(raw.requestId))) throw new Error('Invalid notice');
        return {levels:null,levelsNotice:{message:raw.message,updatedAt:raw.updatedAt,requestId:requestId(raw.requestId)?raw.requestId:undefined}};
      }
      const report=validateLevelReport(raw,now);
      if (report.status==='running' && now-report.updatedAt>5000) {
        return {levels:{...report,status:'error',message:'Analysis stopped responding. Run the check again in REAPER.'}};
      }
      return {levels:report};
    } finally { await file.close(); }
  } catch(error) {
    if ((error as NodeJS.ErrnoException).code==='ENOENT') return {levels:null};
    return {levels:null,levelsError:'The level report could not be read. Run the check again if this persists.'};
  }
}
