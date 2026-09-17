import type { Finding, SongSection } from '../types';

export class DSPAnalyzer {
  static async analyzeBlob(audio: Blob): Promise<{ duration: number; powers: number[] }> {
    const context = new AudioContext();
    try {
      const buffer = await context.decodeAudioData(await audio.arrayBuffer());
      return { duration: buffer.duration, powers: DSPAnalyzer.calculateWindowedPower(buffer) };
    } catch {
      throw new Error('This audio file could not be decoded. Try a WAV or MP3 recording. Your current project has not been replaced.');
    } finally { await context.close(); }
  }

  static calculateWindowedPower(buffer: AudioBuffer, windowSizeSeconds = 0.5): number[] {
    if (!(windowSizeSeconds > 0) || !Number.isFinite(windowSizeSeconds)) throw new Error('Invalid analysis window.');
    const windowSize = Math.max(1, Math.floor(buffer.sampleRate * windowSizeSeconds));
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
    const powers: number[] = [];
    for (let start = 0; start < buffer.length; start += windowSize) {
      const end = Math.min(start + windowSize, buffer.length);
      let sum = 0;
      for (const channel of channels) {
        for (let sample = start; sample < end; sample++) sum += channel[sample] ** 2;
      }
      powers.push(sum / ((end - start) * channels.length));
    }
    return powers;
  }

  static powerToDBFS(power: number): number {
    return Number.isFinite(power) && power > 0 ? Math.max(10 * Math.log10(power), -100) : -100;
  }

  static calculateSectionEnergies(powers: number[], windowSizeSeconds: number, sections: SongSection[]) {
    const trackMax = powers.reduce((max, power) => Math.max(max, DSPAnalyzer.powerToDBFS(power)), -100);
    const threshold = Math.max(-60, trackMax - 24);
    const measuredEnd = powers.length * windowSizeSeconds;
    return sections.map(section => {
      const start = Math.max(0, section.timeRange.start);
      const end = Math.min(section.timeRange.end ?? measuredEnd, measuredEnd);
      let sum = 0;
      let weight = 0;
      let active = 0;
      if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
        for (let index = Math.floor(start / windowSizeSeconds); index < Math.ceil(end / windowSizeSeconds); index++) {
          const power = powers[index];
          if (!Number.isFinite(power) || power < 0) continue;
          const seconds = Math.max(0, Math.min(end, (index + 1) * windowSizeSeconds) - Math.max(start, index * windowSizeSeconds));
          sum += power * seconds;
          weight += seconds;
          if (DSPAnalyzer.powerToDBFS(power) > threshold) active += seconds;
        }
      }
      return { section, averageDBFS: DSPAnalyzer.powerToDBFS(weight ? sum / weight : 0),
        activityPercentage: weight ? active / weight * 100 : 0, measuredSeconds: weight };
    });
  }

  static generateEnergyFindings(powers: number[], sections: SongSection[]): Finding[] {
    const energies = DSPAnalyzer.calculateSectionEnergies(powers, 0.5, [...sections].sort((a, b) => a.timeRange.start - b.timeRange.start));
    const findings: Finding[] = [];
    for (let index = 0; index < energies.length - 1; index++) {
      const current = energies[index];
      const next = energies[index + 1];
      // Do not turn empty, silent or overlapping selections into production advice.
      if (!current.measuredSeconds || !next.measuredSeconds ||
          (!current.activityPercentage && !next.activityPercentage) ||
          (current.section.timeRange.end ?? powers.length * 0.5) > next.section.timeRange.start) continue;
      const difference = next.averageDBFS - current.averageDBFS;
      const similar = Math.abs(difference) < 1;
      if (!similar && Math.abs(difference) <= 4) continue;
      const direction = difference > 0 ? 'increase' : 'decrease';
      findings.push({
        id: `dsp-energy-${current.section.id}-${next.section.id}`,
        timeRange: next.section.timeRange, relatedTimeRanges: [current.section.timeRange],
        category: similar ? 'arrangement' : 'mixing',
        observation: similar ? `Similar measured energy: ${current.section.name} to ${next.section.name}` : `Measured energy ${direction} entering ${next.section.name}`,
        evidence: `${current.section.name}: ${current.averageDBFS.toFixed(1)} dBFS, ${current.activityPercentage.toFixed(0)}% active audio. ${next.section.name}: ${next.averageDBFS.toFixed(1)} dBFS, ${next.activityPercentage.toFixed(0)}% active audio. Difference: ${difference >= 0 ? '+' : ''}${difference.toFixed(1)} dB. Estimated from 0.5-second windows.`,
        confidence: 90,
        explanation: 'This compares measured average energy and audio activity. It does not identify instruments, masking, pitch accuracy, or whether your arrangement is right or wrong.',
        recommendation: similar ? 'Listen across the transition. If you intended more contrast, experiment with level or arrangement; similar energy can also be intentional.' : 'Listen across the transition and compare it with your intent. Adjust the level only if the change feels unintended.',
        userStatus: 'open', provenance: 'real-dsp',
      });
    }
    return findings;
  }
}
