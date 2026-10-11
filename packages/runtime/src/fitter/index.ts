import { fitSegment } from './segment_fit.js';
import { splitSegments } from './splitting.js';
import { canonicalizeAliases } from './alias.js';
import { timingSegments } from './segments.js';
import { refineTiming } from './refinement.js';
import { refinePeaks, downbeatPhase } from './peaks.js';
import { melPhase, melTempo } from './mel_phase.js';
import type { Config } from './types.js';
export function fitSegments(beat: ArrayLike<number>, downbeat: ArrayLike<number>, config: Config, trace?: (name: string, value: unknown) => void) {
    const signal = Float64Array.from(beat, x => Math.fround(1 / (1 + Math.exp(-x)))), down = Float64Array.from(downbeat, x => Math.fround(1 / (1 + Math.exp(-x)))), times = Float64Array.from({ length: signal.length }, (_, i) => i / 50 * 1000);
    const c = { ...config };
    if (signal.length / 50 >= c.long_prediction_duration_seconds)
        for (const key of ['max_segments', 'max_grid_candidates_per_segment', 'max_split_candidates_per_segment', 'downbeat_refine_candidate_count'])
            c[key] = Math.max(c[key], c[`long_${key}`]);
    const initial = fitSegment(signal, times, down, 0, signal.length, c);
    trace?.('initial', initial);
    const splits = splitSegments(signal, times, down, initial, c);
    trace?.('splits', splits);
    const aliases = canonicalizeAliases(splits, signal, times, down, c);
    trace?.('aliases', aliases);
    const raw = timingSegments(aliases, times, c);
    trace?.('raw', raw);
    return refineTiming(raw, times, signal, c);
}
export function fitGrid(beat: ArrayLike<number>, downbeat: ArrayLike<number>, mel: Float32Array, songMs: number, config: Config, trace?: (name: string, value: unknown) => void) {
    let segments = fitSegments(beat, downbeat, config, trace);
    trace?.('legacy', segments);
    segments = refinePeaks(segments, beat);
    trace?.('peaks', segments);
    segments = downbeatPhase(segments, beat, downbeat);
    trace?.('downbeat', segments);
    segments = melPhase(segments, mel, beat, songMs);
    trace?.('mel_phase', segments);
    segments = melTempo(segments, mel, beat, songMs);
    trace?.('mel_tempo', segments);
    return segments;
}
