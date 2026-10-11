// Mirrors audio_rows/fitter/scoring.py. Scores and fitting arithmetic are float64.
import { mean, norm, round, mod } from '../math.js';
import type { Config, GridCandidate } from './types.js';
export function centered(signal: Float64Array): [
    Float64Array,
    number
] {
    const m = mean(signal), c = signal.map(x => x - m);
    return [c, norm(c)];
}
export function scoreGrid(signal: Float64Array, signalNorm: number, times: Float64Array, length: number, offset: number, width: number): number {
    const count = times.length;
    if (!count)
        return -Infinity;
    const first = times[0], last = times[count - 1], step = count === 1 ? width : (last - first) / (count - 1);
    const lo = Math.floor((first - offset - width) / length), hi = Math.ceil((last - offset + width) / length), radius = Math.ceil(width / step) + 2;
    let s = 0, ss = 0, dot = 0;
    if (length <= width * 2 || (hi - lo + 1) * (2 * radius + 1) >= count || step <= 0) {
        for (let i = 0; i < count; i++) {
            const phase = mod(times[i] - offset, length), w = Math.max(0, 1 - Math.min(phase, length - phase) / width);
            s += w;
            ss += w * w;
            dot += signal[i] * w;
        }
    }
    else {
        for (let b = lo; b <= hi; b++) {
            const t = offset + b * length, c = round((t - first) / step);
            for (let i = Math.max(0, c - radius); i <= Math.min(count - 1, c + radius); i++) {
                const w = 1 - Math.abs(times[i] - t) / width;
                if (w > 0) {
                    s += w;
                    ss += w * w;
                    dot += signal[i] * w;
                }
            }
        }
    }
    const v = ss - s * s / count;
    return v <= 0 ? -Infinity : dot / (signalNorm * Math.sqrt(v));
}
const fractionalParts = Array.from(new Set([...Array.from({ length: 8 }, (_, i) => (i + 1) / 9), ...([1, 3, 5, 7].map(x => x / 8)), 1 / 3, 2 / 3])).sort((a, b) => a - b);
function quantizeBpm(bpm: number, c: Config) { return c.min_bpm + round((bpm - c.min_bpm) / c.bpm_step) * c.bpm_step; }
export function candidateBpms(signal: Float64Array, fps: number, c: Config): number[] {
    const scores: [
        number,
        number
    ][] = [];
    for (let lag = Math.ceil(fps * 60 / c.max_bpm); lag <= Math.min(Math.floor(fps * 60 / c.min_bpm), signal.length - 1); lag++) {
        let ll = 0, rr = 0, lr = 0;
        for (let i = 0; i < signal.length - lag; i++) {
            const l = signal[i], r = signal[i + lag];
            ll += l * l;
            rr += r * r;
            lr += l * r;
        }
        const d = Math.sqrt(ll) * Math.sqrt(rr);
        if (d !== 0)
            scores.push([lr / d, lag]);
    }
    scores.sort((a, b) => b[0] - a[0] || b[1] - a[1]);
    const exact: number[] = [], expanded: number[] = [];
    for (const [, lag] of scores.slice(0, c.autocorrelation_candidate_count))
        for (const mult of [1, 2, 0.5, 3, 4, 1 / 3, 0.25]) {
            const value = 60 * fps / lag * mult;
            exact.push(value);
            if (value < c.min_bpm || value > c.max_bpm)
                continue;
            const radius = Math.max(c.bpm_search_window_min_bpm, value * c.bpm_search_window_ratio);
            const lo = Math.max(c.min_bpm, quantizeBpm(value - radius, c)), hi = Math.min(c.max_bpm, quantizeBpm(value + radius, c));
            for (let v = lo; v < hi + c.bpm_step * 0.5; v += c.bpm_step)
                expanded.push(v);
        }
    let unique = Array.from(new Set([...exact, ...expanded].map(x => quantizeBpm(x, c)).filter(x => x >= c.min_bpm && x <= c.max_bpm)));
    if (!unique.length)
        for (let x = c.min_bpm; x < c.max_bpm + c.bpm_step * 0.5; x += c.bpm_step)
            unique.push(x);
    let count = 0;
    const limited: number[] = [];
    for (const value of unique) {
        const n = Math.max(1, Math.ceil(60000 / value / c.offset_step_ms));
        if (limited.length && count + n > c.max_grid_candidates_per_segment)
            continue;
        limited.push(value);
        count += n;
    }
    const result = new Set<number>();
    for (const value of limited) {
        const candidates = [value];
        if (value >= 80)
            for (const i of [Math.floor(value) - 1, Math.floor(value), Math.floor(value) + 1])
                for (const f of fractionalParts)
                    if (Math.abs(i + f - value) <= 0.25)
                        candidates.push(i + f);
        candidates.sort((a, b) => Math.abs(a - value) - Math.abs(b - value) || a - b);
        for (const v of candidates) {
            const rounded = round(v * 1e6) / 1e6;
            if (rounded >= c.min_bpm && rounded <= c.max_bpm)
                result.add(rounded);
        }
    }
    return [...result];
}
export function better(score: number, downbeat: number, best: number, bestDownbeat: number, c: Config): boolean {
    const margin = c.downbeat_tie_score_margin;
    if (score > best + margin)
        return true;
    if (score < best - margin)
        return false;
    if (Number.isFinite(downbeat) || Number.isFinite(bestDownbeat)) {
        if (downbeat > bestDownbeat + margin)
            return true;
        if (downbeat < bestDownbeat - margin)
            return false;
    }
    return score > best;
}
export function bestDownbeat(signal: Float64Array | undefined, signalNorm: number, times: Float64Array, length: number, offset: number, c: Config): [
    number,
    number
] {
    if (!signal || signalNorm === 0)
        return [-Infinity, offset];
    let best = -Infinity, at = offset;
    for (let j = 0; j < c.downbeat_period_beats; j++) {
        const o = offset + j * length, s = scoreGrid(signal, signalNorm, times, length * c.downbeat_period_beats, o, c.pulse_width_ms);
        if (s > best) {
            best = s;
            at = o;
        }
    }
    return [best, at];
}
export function bestCandidate(candidates: GridCandidate[], downbeat: Float64Array | undefined, downNorm: number, times: Float64Array, c: Config): [
    number,
    number,
    number,
    number,
    number
] {
    if (!candidates.length)
        return [-Infinity, -Infinity, c.min_bpm, 60000 / c.min_bpm, 0];
    const sorted = candidates.slice().sort((a, b) => b.score - a.score);
    let best = sorted[0];
    if (Math.abs(quantizeBpm(best.bpm, c) - best.bpm) > 1e-6) {
        const coarse = sorted.find(x => Math.abs(quantizeBpm(x.bpm, c) - x.bpm) <= 1e-6);
        if (coarse && best.score < coarse.score + 0.08)
            best = coarse;
    }
    if (!downbeat || downNorm === 0)
        return [best.score, -Infinity, best.bpm, best.beat_length_ms, best.offset_ms];
    let score = -Infinity, ds = -Infinity, b = best.bpm, length = best.beat_length_ms, offset = best.offset_ms;
    for (const candidate of sorted.slice(0, c.downbeat_refine_candidate_count)) {
        const [d, o] = bestDownbeat(downbeat, downNorm, times, candidate.beat_length_ms, candidate.offset_ms, c);
        if (better(candidate.score, d, score, ds, c)) {
            score = candidate.score;
            ds = d;
            b = candidate.bpm;
            length = candidate.beat_length_ms;
            offset = o;
        }
    }
    return [score, ds, b, length, offset];
}
export function refineOffset(signal: Float64Array, signalNorm: number, times: Float64Array, length: number, offset: number, score: number, ds: number, c: Config, downbeat?: Float64Array, downNorm = 0): [
    number,
    number,
    number
] {
    const step = c.offset_refine_step_ms, center = round(offset / step) * step, count = Math.ceil(c.offset_refine_radius_ms / step);
    for (let i = -count; i <= count; i++) {
        const o = center + i * step, s = scoreGrid(signal, signalNorm, times, length, o, c.pulse_width_ms);
        const d = downbeat && downNorm !== 0 ? scoreGrid(downbeat, downNorm, times, length * c.downbeat_period_beats, o, c.pulse_width_ms) : -Infinity;
        if (better(s, d, score, ds, c)) {
            score = s;
            ds = d;
            offset = o;
        }
    }
    return [score, offset, ds];
}
export function bestBpm(signal: Float64Array, signalNorm: number, times: Float64Array, bpm: number, c: Config, downbeat?: Float64Array, downNorm = 0): [
    number,
    number,
    number
] {
    if (bpm < c.min_bpm || bpm > c.max_bpm)
        return [-Infinity, 0, -Infinity];
    const length = 60000 / bpm, candidates: GridCandidate[] = [];
    for (let offset = 0; offset < length; offset += c.offset_step_ms)
        candidates.push({ score: scoreGrid(signal, signalNorm, times, length, offset, c.pulse_width_ms), bpm, beat_length_ms: length, offset_ms: offset });
    const [s, d, , , o] = bestCandidate(candidates, downbeat, downNorm, times, c);
    return refineOffset(signal, signalNorm, times, length, o, s, d, c, downbeat, downNorm);
}
