export interface TimingSegment {
    offset_ms: number;
    beat_length_ms: number;
}
export interface SegmentFit extends TimingSegment {
    start_frame: number;
    end_frame: number;
    score: number;
    raw_bpm: number;
    tempo_multiplier: number;
}
export interface GridCandidate extends TimingSegment {
    score: number;
    bpm: number;
}
export interface SplitCandidate {
    frame: number;
    score: number;
}
export interface EvaluatedSplit {
    segment_index: number;
    candidate: SplitCandidate;
    left_fit: SegmentFit;
    right_fit: SegmentFit;
    improvement: number;
}
export type Config = Record<string, any>;
export const bpm = (s: TimingSegment) => 60000 / s.beat_length_ms;
export const frameCount = (s: SegmentFit) => s.end_frame - s.start_frame;
