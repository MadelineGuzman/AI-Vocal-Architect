import { AnalysisResult } from '../types';

export const mockAnalysis: AnalysisResult = {
  sections: [], // No longer mocking sections
  findings: [
    {
      id: 'f1',
      timeRange: { start: 32, end: 42 },
      category: 'mixing',
      observation: 'Vocal masking detected',
      evidence: 'Frequency overlap between 1.2kHz - 2.5kHz with the lead synth.',
      confidence: 85,
      explanation: 'The lead vocal becomes partially masked by the synth during this section, reducing lyrical intelligibility.',
      recommendation: 'Consider dynamic EQ on the synth sidechained to the vocal, or a slight static dip in the synth at 2kHz.',
      userStatus: 'open',
      provenance: 'mock'
    },
    {
      id: 'f3',
      timeRange: { start: 14, end: 22 },
      category: 'vocals',
      observation: 'Possible pitch inconsistency',
      evidence: 'Detected deviation of +25 cents on sustained notes in the vocal take.',
      confidence: 70,
      explanation: 'There is a noticeable drift in pitch during the sustained notes of the verse melody. Depending on the genre, this may sound slightly unstable.',
      recommendation: 'Investigate the vocal take in this section. Light pitch correction with a slow retune speed could stabilize it without losing character.',
      userStatus: 'open',
      provenance: 'mock'
    }
  ]
};

export class AnalysisService {
  static async analyzeAudio(_fileUrl: string): Promise<AnalysisResult> {
    return new Promise((resolve) => {
      // Small artificial delay to represent analysis processing time
      setTimeout(() => {
        resolve({
          sections: [], // Always empty, artist defines them now
          findings: [...mockAnalysis.findings]
        });
      }, 1000);
    });
  }
}
