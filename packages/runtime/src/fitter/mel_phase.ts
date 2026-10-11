import { mean, median, line, round, lowerBound, clip, argmax } from '../math.js';
import { correctedGrid } from '../grid.js';
import { beatPeaks } from './peaks.js';
import type { TimingSegment } from './types.js';
export function onsetEnvelope(logMel: Float32Array): Float64Array {
    const out = new Float64Array(logMel.length / 128);
    for (let f = 1; f < out.length; f++) {
        let sum = 0;
        for (let m = 0; m < 128; m++)
            sum += Math.max(0, logMel[f * 128 + m] - logMel[(f - 1) * 128 + m]);
        out[f] = sum;
    }
    return out;
}
export function onsetTimes(env: Float64Array, times: number[], window = 60): number[] {
    const peaks: number[] = [];
    for (let i = 1; i < env.length - 1; i++)
        if (env[i] > env[i - 1] && env[i] >= env[i + 1])
            peaks.push(i);
    const at = peaks.map(i => i * 10 + 15);
    return times.map(t => {
        const lo = lowerBound(at, t - window), hi = lowerBound(at, t + window);
        if (lo === hi)
            return NaN;
        let best = lo;
        for (let j = lo + 1; j < hi; j++)
            if (env[peaks[j]] > env[peaks[best]])
                best = j;
        const i = peaks[best], a = env[i - 1], b = env[i], c = env[i + 1], curvature = a - 2 * b + c, delta = Math.abs(curvature) > 1e-12 ? clip(0.5 * (a - c) / curvature, -0.5, 0.5) : 0;
        return i * 10 + 15 + 10 * delta;
    });
}
function beats(grid: TimingSegment[], lo: number, hi: number): {
    times: number[];
    indices: number[];
} {
    const times: number[] = [], indices: number[] = [];
    for (let j = 0; j < grid.length; j++) {
        const s = grid[j], end = grid[j + 1]?.offset_ms ?? Math.max(hi, s.offset_ms) + s.beat_length_ms;
        const first = j === 0 ? Math.floor(Math.min(lo - grid[0].offset_ms, 0) / grid[0].beat_length_ms) : 0;
        const last = j < grid.length - 1 ? Math.ceil((end - s.offset_ms) / s.beat_length_ms - 1e-9) - 1 : Math.ceil((end - s.offset_ms) / s.beat_length_ms);
        for (let n = first; n <= last; n++) {
            const t = s.offset_ms + n * s.beat_length_ms;
            if (t >= lo && t <= hi) {
                times.push(t);
                indices.push(j);
            }
        }
    }
    return { times, indices };
}
export function melPhase(segments: TimingSegment[], mel: Float32Array, logits: ArrayLike<number>, songMs: number): TimingSegment[] {
    const peaks = beatPeaks(logits).times;
    if (!peaks.length)
        return segments;
    const order = segments.map((_, i) => i).sort((a, b) => segments[a].offset_ms - segments[b].offset_ms), grid = correctedGrid(segments, songMs);
    const { times, indices } = beats(grid, peaks[0] - 30, peaks[peaks.length - 1] - 30), onsets = onsetTimes(onsetEnvelope(mel), times.map(t => t + 16)), offsets = onsets.map((t, i) => t - times[i]);
    const found = offsets.filter(Number.isFinite);
    if (found.length < 8)
        return segments;
    const song = median(found);
    let shifts = grid.map((_, j) => { const values = offsets.filter((x, i) => Number.isFinite(x) && indices[i] === j); return (values.length >= 32 ? median(values) : song) - 14.873; });
    if (grid.length !== segments.length)
        shifts = segments.map(() => shifts[0]);
    const out = segments.slice();
    order.forEach((k, j) => out[k] = { ...segments[k], offset_ms: segments[k].offset_ms + shifts[j] });
    return out;
}
function drift(x: number[], y: number[]): [
    number,
    number
] | null {
    const med = median(y);
    let keep = y.map((v, i) => Math.abs(v - med) <= 25 ? i : -1).filter(i => i >= 0);
    if (keep.length < 8)
        return null;
    let a = 0, b = 0;
    for (let iter = 0; iter < 2; iter++) {
        [a, b] = line(keep.map(i => x[i]), keep.map(i => y[i]));
        const residual = y.map((v, i) => v - a - b * x[i]), middle = median(keep.map(i => residual[i]));
        const bound = Math.max(3, 3 * 1.4826 * median(keep.map(i => Math.abs(residual[i] - middle)))), next = residual.map((r, i) => Math.abs(r) <= bound ? i : -1).filter(i => i >= 0);
        if (next.length < 8)
            break;
        keep = next;
    }
    return [a, b];
}
export function melTempo(segments: TimingSegment[], mel: Float32Array, logits: ArrayLike<number>, songMs: number): TimingSegment[] {
    const peaks = beatPeaks(logits).times;
    if (!peaks.length)
        return segments;
    const order = segments.map((_, i) => i).sort((a, b) => segments[a].offset_ms - segments[b].offset_ms), grid = correctedGrid(segments, songMs), lo = peaks[0] - 30, hi = peaks[peaks.length - 1] - 30;
    const { times, indices } = beats(grid, lo, hi), onsets = onsetTimes(onsetEnvelope(mel), times.map(t => t + 16)), offsets = onsets.map((t, i) => t - times[i]);
    const out = grid.map(s => ({ ...s }));
    let refitted = false;
    for (let j = 0; j < grid.length; j++) {
        const ids = times.map((_, i) => Number.isFinite(offsets[i]) && indices[i] === j ? i : -1).filter(i => i >= 0);
        if (ids.length < 16)
            continue;
        const center = mean(ids.map(i => times[i])), fit = drift(ids.map(i => times[i] - center), ids.map(i => offsets[i]));
        if (!fit)
            continue;
        const [a, b] = fit, local = times.filter((_, i) => indices[i] === j), span = Math.max(...local) - Math.min(...local);
        if (Math.abs(b) * span < 3 || Math.abs(b) > 0.03 || grid[j].beat_length_ms === 750)
            continue;
        const start = grid[j].offset_ms + a - 14.873 + b * (grid[j].offset_ms - center);
        if (j > 0 && start <= out[j - 1].offset_ms || j + 1 < grid.length && start >= grid[j + 1].offset_ms)
            continue;
        out[j] = { offset_ms: start, beat_length_ms: grid[j].beat_length_ms * (1 + b) };
        refitted = true;
    }
    if (!refitted)
        return segments;
    if (grid.length === 1) {
        const sorted = order.map(i => segments[i]), spans = sorted.map((s, i) => (sorted[i + 1]?.offset_ms ?? Math.max(songMs, sorted[sorted.length - 1].offset_ms + 1)) - s.offset_ms);
        const octave = 2 ** round(Math.log2(sorted[argmax(spans)].beat_length_ms / grid[0].beat_length_ms)), bpm = 60000 / (out[0].beat_length_ms * octave);
        if (Math.abs(bpm - round(bpm)) <= 0.25) {
            const length = 60000 / round(bpm) / octave, middle = 0.5 * (Math.max(out[0].offset_ms, lo) + hi);
            out[0] = { offset_ms: out[0].offset_ms + round((middle - out[0].offset_ms) / out[0].beat_length_ms) * (out[0].beat_length_ms - length), beat_length_ms: length };
        }
        return [{ offset_ms: out[0].offset_ms + 30, beat_length_ms: out[0].beat_length_ms * octave }];
    }
    const result = segments.slice();
    order.forEach((k, j) => result[k] = { offset_ms: out[j].offset_ms + 30, beat_length_ms: segments[k].beat_length_ms * out[j].beat_length_ms / grid[j].beat_length_ms });
    return result;
}
