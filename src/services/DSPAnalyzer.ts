import { Finding, SongSection } from '../types';

export class DSPAnalyzer {
  static async fetchAndDecodeAudio(fileUrl: string): Promise<AudioBuffer> {
    const response = await fetch(fileUrl);
    const arrayBuffer = await response.arrayBuffer();
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    const audioContext = new AudioContextClass();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    return audioBuffer;
  }

  static calculateWindowedPower(audioBuffer: AudioBuffer, windowSizeSeconds: number = 0.5): number[] {
    const channelDataL = audioBuffer.getChannelData(0);
    const isStereo = audioBuffer.numberOfChannels > 1;
    const channelDataR = isStereo ? audioBuffer.getChannelData(1) : channelDataL;

    const sampleRate = audioBuffer.sampleRate;
    const windowSizeSamples = Math.floor(windowSizeSeconds * sampleRate);

    const powerValues: number[] = [];

    for (let i = 0; i < channelDataL.length; i += windowSizeSamples) {
      let sumSquares = 0;
      let count = 0;
      const end = Math.min(i + windowSizeSamples, channelDataL.length);

      for (let j = i; j < end; j++) {
        // Sum the squared amplitude for both channels to get total power
        sumSquares += (channelDataL[j] * channelDataL[j]) + (channelDataR[j] * channelDataR[j]);
        count += 2;
      }

      const power = sumSquares / count;
      powerValues.push(power);
    }

    return powerValues;
  }

  static powerToDBFS(power: number): number {
    if (power === 0) return -100;
    // Since power is RMS^2, we can convert power directly: 10 * log10(power) = 20 * log10(RMS)
    const dbfs = 10 * Math.log10(power);
    return Math.max(dbfs, -100);
  }

  static calculateSectionEnergies(powerValues: number[], windowSizeSeconds: number, sections: SongSection[]) {
    // Find track max DBFS to establish a relative silence floor
    let trackMaxDBFS = -100;
    for (const p of powerValues) {
      const dbfs = this.powerToDBFS(p);
      if (dbfs > trackMaxDBFS) trackMaxDBFS = dbfs;
    }
    const activityThresholdDBFS = Math.max(-60, trackMaxDBFS - 24);

    return sections.map(section => {
      const startIndex = Math.floor(section.timeRange.start / windowSizeSeconds);
      const endIndex = section.timeRange.end
        ? Math.ceil(section.timeRange.end / windowSizeSeconds)
        : powerValues.length;

      const safeEndIndex = Math.min(endIndex, powerValues.length);

      let sumPower = 0;
      let count = 0;
      let activeCount = 0;

      for (let i = startIndex; i < safeEndIndex; i++) {
        sumPower += powerValues[i];
        count++;
        if (this.powerToDBFS(powerValues[i]) > activityThresholdDBFS) {
          activeCount++;
        }
      }

      const averagePower = count > 0 ? sumPower / count : 0;
      const dbfs = this.powerToDBFS(averagePower);
      const activityPercentage = count > 0 ? (activeCount / count) * 100 : 0;

      return {
        section,
        averageDBFS: dbfs,
        activityPercentage
      };
    });
  }

  static generateEnergyFindings(powerValues: number[], sections: SongSection[]): Finding[] {
    const windowSize = 0.5; // MUST MATCH THE ONE USED IN calculateWindowedPower
    const sectionEnergies = this.calculateSectionEnergies(powerValues, windowSize, sections);

    const findings: Finding[] = [];

    // Analyze adjacent sections for energy transitions
    for (let i = 0; i < sectionEnergies.length - 1; i++) {
      const current = sectionEnergies[i];
      const next = sectionEnergies[i + 1];

      const diffDB = next.averageDBFS - current.averageDBFS;
      // Deterministic ID based on sections being compared
      const deterministicId = `dsp-energy-${current.section.id}-${next.section.id}`;

      if (Math.abs(diffDB) < 1.0) {
        findings.push({
          id: deterministicId,
          timeRange: next.section.timeRange,
          relatedTimeRanges: [current.section.timeRange],
          category: 'arrangement',
          observation: `Energy does not change significantly from ${current.section.name} to ${next.section.name}`,
          evidence: `${current.section.name} average: ${current.averageDBFS.toFixed(1)} dBFS. ${next.section.name} average: ${next.averageDBFS.toFixed(1)} dBFS. Difference: ${(diffDB > 0 ? '+' : '')}${diffDB.toFixed(1)} dB.`,
          confidence: 95,
          explanation: `The measured energy difference between the preceding ${current.section.name.toLowerCase()} and ${next.section.name.toLowerCase()} is relatively small (${diffDB.toFixed(1)} dB). Typically, new sections use contrast in density or loudness to feel impactful.`,
          recommendation: `If you intended the ${next.section.name.toLowerCase()} to create a larger sense of contrast or lift, you may want to investigate arrangement density, dynamics, or instrumentation.`,
          userStatus: 'open',
          provenance: 'real-dsp'
        });
      } else if (diffDB > 4.0) {
         findings.push({
          id: deterministicId,
          timeRange: next.section.timeRange,
          relatedTimeRanges: [current.section.timeRange],
          category: 'mixing',
          observation: `Large energy jump entering ${next.section.name}`,
          evidence: `${current.section.name} average: ${current.averageDBFS.toFixed(1)} dBFS. ${next.section.name} average: ${next.averageDBFS.toFixed(1)} dBFS. Difference: +${diffDB.toFixed(1)} dB.`,
          confidence: 90,
          explanation: `There is a significant increase in measured energy (+${diffDB.toFixed(1)} dB) when transitioning into the ${next.section.name.toLowerCase()}.`,
          recommendation: `This may be an intentional dynamic shift, but if it feels too abrupt, consider automating the volume of incoming elements or using a transition effect (like a swell or drum fill) to smooth the entry.`,
          userStatus: 'open',
          provenance: 'real-dsp'
        });
      }
    }

    return findings;
  }
}
