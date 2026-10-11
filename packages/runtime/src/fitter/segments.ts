import { mod, round } from '../math.js';
import { bpm, frameCount, type TimingSegment, type SegmentFit, type Config } from './types.js';
export const phaseError = (time: number, offset: number, length: number) => { const phase = mod(time - offset, length); return Math.min(phase, length - phase); };
export const nearestOffset = (offset: number, length: number, target: number) => offset + round((target - offset) / length) * length;
export const aliases = (a: number, b: number, tolerance: number) => a > 0 && b > 0 && [0.25, 1 / 3, 0.5, 2, 3, 4].some(m => Math.abs(a * m - b) <= tolerance);
export function mergeable(a: TimingSegment, b: TimingSegment, c: Config, allowAlias = false, loose = false): boolean {
    let tolerance = Math.max(c.merge_bpm_tolerance, Math.min(bpm(a), bpm(b)) * c.merge_relative_bpm_tolerance);
    if (loose)
        tolerance = Math.max(tolerance, c.merge_many_similar_bpm_tolerance);
    if (Math.abs(bpm(a) - bpm(b)) <= tolerance)
        return loose || phaseError(b.offset_ms, a.offset_ms, a.beat_length_ms) <= c.merge_phase_tolerance_ms;
    return allowAlias && aliases(bpm(a), bpm(b), c.merge_alias_bpm_tolerance) && phaseError(b.offset_ms, a.offset_ms, Math.min(a.beat_length_ms, b.beat_length_ms)) <= c.merge_alias_phase_tolerance_ms;
}
export function rawSegments(fits: SegmentFit[], times: Float64Array): TimingSegment[] {
    const out: TimingSegment[] = [];
    for (const fit of fits) {
        let o = fit.offset_ms;
        if (out.length) {
            o = nearestOffset(o, fit.beat_length_ms, times[fit.start_frame]);
            while (o <= out[out.length - 1].offset_ms)
                o += fit.beat_length_ms;
        }
        out.push({ offset_ms: o, beat_length_ms: fit.beat_length_ms });
    }
    return out;
}
export function mergeSegments(segments: TimingSegment[], c: Config): TimingSegment[] { const out = [segments[0]]; for (const s of segments.slice(1))
    if (!mergeable(out[out.length - 1], s, c))
        out.push(s); return out; }
export const timingSegments = (fits: SegmentFit[], times: Float64Array, c: Config) => mergeSegments(rawSegments(fits, times), c);
export function fitsMergeable(a: SegmentFit, b: SegmentFit, times: Float64Array, c: Config, alias = false, loose = false) { const s = rawSegments([a, b], times); return mergeable(s[0], s[1], c, alias, loose); }
export function weightedScore(fits: SegmentFit[]) { let weight = 0, score = 0; for (const s of fits) {
    weight += frameCount(s);
    score += s.score * frameCount(s);
} return weight > 0 ? score / weight : -Infinity; }
