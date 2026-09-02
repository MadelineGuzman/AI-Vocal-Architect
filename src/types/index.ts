export type FindingCategory = 'composition' | 'arrangement' | 'vocals' | 'mixing' | 'creative';
export type FindingStatus = 'open' | 'accepted' | 'ignored' | 'investigate';
export type FindingProvenance = 'mock' | 'real-dsp' | 'ai-model';

export interface TimeRange {
    start: number; // in seconds
    end?: number;
}

export interface Finding {
    id: string;
    timeRange: TimeRange;
    relatedTimeRanges?: TimeRange[]; // For comparisons
    category: FindingCategory;
    observation: string;
    evidence: string;
    confidence: number; // 0-100
    explanation: string;
    recommendation: string;
    userStatus: FindingStatus;
    provenance: FindingProvenance;
}

export interface SongSection {
    id: string;
    name: string;
    timeRange: TimeRange;
    color: string;
    provenance?: 'suggested' | 'artist';
}

export interface AnalysisResult {
    sections: SongSection[];
    findings: Finding[];
}

export interface AssetMetadata {
    assetType: string;
    content: string;
    userLabel: string;
}

export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
}
