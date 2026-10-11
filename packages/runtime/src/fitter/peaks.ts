import { mean, median, round, line, interp, argmax, mod } from '../math.js';
import { canonicalLength } from '../grid.js';
import type { TimingSegment } from './types.js';
export function beatPeaks(logits: ArrayLike<number>, fps = 50): {
    times: number[];
    weights: number[];
} {
    const n = logits.length, groups: number[][] = [];
    for (let i = 0; i < n; i++) {
        if (logits[i] <= 0)
            continue;
        let max = -Infinity;
        for (let j = Math.max(0, i - 3); j <= Math.min(n - 1, i + 3); j++)
            max = Math.max(max, logits[j]);
        if (logits[i] < max)
            continue;
        const prev = groups[groups.length - 1];
        if (prev && prev[prev.length - 1] === i - 1)
            prev.push(i);
        else
            groups.push([i]);
    }
    const probability = Array.from(logits, x => 1 / (1 + Math.exp(-x))), times: number[] = [], weights: number[] = [];
    for (const group of groups) {
        const center = round(mean(group));
        weights.push(Math.max(...group.map(i => probability[i])));
        let frame = mean(group);
        if (center >= 2 && center + 2 < n) {
            let sum = 0, w = 0;
            for (let i = center - 2; i <= center + 2; i++) {
                sum += i * probability[i];
                w += probability[i];
            }
            frame = sum / w;
        }
        times.push(frame * 1000 / fps);
    }
    return { times, weights };
}
function refineOne(times: number[], weights: number[], offset: number, length: number): [
    number,
    number
] | null {
    if (!times.length)
        return null;
    const window = Math.min(0.25 * length, 50);
    let residual = times.map(t => t - (offset + round((t - offset) / length) * length));
    let keep = residual.map((r, i) => Math.abs(r) < window ? i : -1).filter(i => i >= 0);
    if (keep.length < 8 || keep.length / times.length < 0.4)
        return null;
    [offset, length] = line(keep.map(i => round((times[i] - offset) / length)), keep.map(i => times[i]), keep.map(i => weights[i]));
    residual = times.map(t => t - (offset + round((t - offset) / length) * length));
    const middle = median(keep.map(i => residual[i])), scale = 1.4826 * median(keep.map(i => Math.abs(residual[i] - middle)));
    keep = residual.map((r, i) => Math.abs(r) < Math.min(window, Math.max(3 * scale, 5)) ? i : -1).filter(i => i >= 0);
    if (keep.length < 8)
        return [offset, length];
    return line(keep.map(i => round((times[i] - offset) / length)), keep.map(i => times[i]), keep.map(i => weights[i]));
}
export function refinePeaks(segments: TimingSegment[], logits: ArrayLike<number>, fps = 50): TimingSegment[] {
    const { times, weights } = beatPeaks(logits, fps);
    let refined = segments.map((s, j) => {
        const ids = times.map((t, i) => t >= (j === 0 ? -Infinity : s.offset_ms) && t < (segments[j + 1]?.offset_ms ?? Infinity) ? i : -1).filter(i => i >= 0);
        const fit = refineOne(ids.map(i => times[i]), ids.map(i => weights[i]), s.offset_ms, s.beat_length_ms);
        return fit ? { offset_ms: fit[0], beat_length_ms: fit[1] } : s;
    });
    if (refined.length > 1) {
        const aligned = refined.map(s => s.beat_length_ms * 2 ** round(Math.log2(refined[0].beat_length_ms / s.beat_length_ms)));
        if (aligned.every(x => Math.abs(x / aligned[0] - 1) < 0.003)) {
            const i = argmax(refined.map((s, i) => (refined[i + 1]?.offset_ms ?? logits.length * 1000 / fps) - s.offset_ms)), longest = refined[i];
            const fit = refineOne(times, weights, longest.offset_ms, longest.beat_length_ms);
            if (fit)
                refined = [{ offset_ms: fit[0], beat_length_ms: fit[1] }];
        }
    }
    return refined.map(s => ({ ...s, offset_ms: round(s.offset_ms) }));
}
export function downbeatPhase(segments: TimingSegment[], beat: ArrayLike<number>, downbeat: ArrayLike<number>, fps = 50): TimingSegment[] {
    if (!segments.length)
        return segments;
    const { times } = beatPeaks(beat, fps);
    if (!times.length)
        return segments;
    const { offset_ms: offset, beat_length_ms: length } = segments[0], period = Math.max(round(4 * canonicalLength(length) / length), 1), end = segments[1]?.offset_ms ?? times[times.length - 1];
    const lo = Math.ceil((times[0] - offset) / length), hi = Math.floor((end - offset) / length);
    if (hi - lo + 1 < period)
        return segments;
    const xp = Float64Array.from({ length: downbeat.length }, (_, i) => i * 1000 / fps), prob = Float64Array.from(downbeat, x => 1 / (1 + Math.exp(-x))), scores = new Array<number>(period).fill(0);
    for (let n = lo; n <= hi; n++)
        scores[mod(n - lo, period)] += interp(offset + n * length, xp, prob);
    let shift = mod(lo + argmax(scores), period);
    if (shift > period / 2)
        shift -= period;
    return [{ offset_ms: round(offset + shift * length), beat_length_ms: length }, ...segments.slice(1)];
}
