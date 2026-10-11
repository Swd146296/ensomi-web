import { mean, median, lowerBound, round } from '../math.js';
import { phaseError } from './segments.js';
import { centered } from './scoring.js';
import type { SegmentFit, SplitCandidate, Config } from './types.js';
interface Change {
    time_ms: number;
    score: number;
}
export function peakTimes(signal: Float64Array, times: Float64Array, c: Config): number[] {
    if (signal.length < 3)
        return [];
    const m = mean(signal), sd = Math.sqrt(mean(signal.map(x => (x - m) ** 2))), threshold = Math.max(m + sd, Math.max(...signal) * 0.35);
    const chosen: number[] = [];
    for (let i = 1; i < signal.length - 1; i++)
        if (signal[i] >= signal[i - 1] && signal[i] > signal[i + 1] && signal[i] >= threshold) {
            const last = chosen[chosen.length - 1];
            if (!chosen.length || times[i] - times[last] >= c.offset_step_ms)
                chosen.push(i);
            else if (signal[i] > signal[last])
                chosen[chosen.length - 1] = i;
        }
    return chosen.map(i => times[i]);
}
function boundary(peaks: number[], index: number, downbeats: number[], fit: SegmentFit): number {
    const time = peaks[index], before = peaks[Math.max(0, index - 1)], after = peaks[Math.min(peaks.length - 1, index + 1)];
    const nearby = downbeats.filter(x => x >= Math.min(before, time) - fit.beat_length_ms * 0.25 && x <= Math.max(after, time) + fit.beat_length_ms * 0.25);
    if (!nearby.length)
        return time;
    return nearby.reduce((a, b) => Math.abs(b - time) < Math.abs(a - time) ? b : a);
}
function mergeChanges(candidates: Change[], distance: number): Change[] {
    const out: Change[] = [];
    for (const v of candidates.sort((a, b) => a.time_ms - b.time_ms)) {
        if (!out.length || v.time_ms - out[out.length - 1].time_ms >= distance)
            out.push(v);
        else if (v.score > out[out.length - 1].score)
            out[out.length - 1] = v;
    }
    return out;
}
export function detectChanges(signal: Float64Array, times: Float64Array, downbeat: Float64Array, fit: SegmentFit, c: Config): SplitCandidate[] {
    const s = signal.slice(fit.start_frame, fit.end_frame), d = downbeat.slice(fit.start_frame, fit.end_frame), t = times.slice(fit.start_frame, fit.end_frame);
    const dn = centered(d)[1], detection = dn === 0 ? s : s.map((x, i) => x + d[i] * c.split_downbeat_signal_weight), peaks = peakTimes(detection, t, c);
    if (peaks.length < 4)
        return [];
    const step = times.length < 2 ? 20 : median(times.slice(1).map((x, i) => x - times[i])), minFrames = Math.max(1, round(c.min_segment_duration_ms / step));
    const downbeats = dn === 0 ? [] : peakTimes(d, t, c), intervals = peaks.slice(1).map((x, i) => x - peaks[i]);
    const phase = peaks.map(x => phaseError(x, fit.offset_ms, fit.beat_length_ms));
    const candidates: Change[] = [], supers: Change[] = [], threshold = Math.max(c.offset_step_ms, c.split_phase_change_threshold_ms * 2);
    for (let i = 4; i <= intervals.length - 4; i++) {
        const change = Math.abs(median(intervals.slice(i, i + 4)) - median(intervals.slice(i - 4, i)));
        const before = median(phase.slice(i - 4, i)), after = median(phase.slice(i, i + 4)), pc = Math.abs(after - before), residual = Math.max(before, after);
        const score = change / threshold + pc / Math.max(c.split_phase_change_threshold_ms, 1e-6) + residual / Math.max(fit.beat_length_ms, 1e-6);
        if (change + 1e-9 >= threshold || pc >= c.split_phase_change_threshold_ms || residual >= c.split_phase_change_threshold_ms * 2)
            candidates.push({ time_ms: boundary(peaks, i, downbeats, fit), score });
    }
    const strengths = peaks.map(x => signal[Math.min(lowerBound(times, x), signal.length - 1)]), minChange = Math.max(c.split_relative_interval_change_threshold, 1e-9);
    for (let i = 3; i <= intervals.length - 3; i++) {
        const before = median(intervals.slice(i - 3, i)), after = median(intervals.slice(i, i + 3));
        if (before <= 0 || after <= 0)
            continue;
        const change = Math.abs(after - before), relative = change / Math.max(Math.min(before, after), 1e-6);
        if (relative < minChange)
            continue;
        const residual = Math.max(median(phase.slice(i - 3, i)), median(phase.slice(i, i + 3)));
        const score = relative / minChange + change / Math.max(c.offset_step_ms, 1e-6) + residual / Math.max(c.split_phase_change_threshold_ms, 1e-6) + 0.25 * (mean(strengths.slice(i - 3, i + 1)) + mean(strengths.slice(i, i + 4)) + strengths[i]);
        supers.push({ time_ms: boundary(peaks, i, downbeats, fit), score });
    }
    const merged = mergeChanges(candidates, c.min_segment_duration_ms);
    const all = [...merged, ...mergeChanges(supers, c.min_segment_duration_ms).filter(x => !merged.some(y => Math.abs(x.time_ms - y.time_ms) < c.min_segment_duration_ms))];
    const byFrame = new Map<number, SplitCandidate>();
    for (const v of all) {
        const frame = lowerBound(times, v.time_ms);
        if (frame - fit.start_frame < minFrames || fit.end_frame - frame < minFrames)
            continue;
        let bonus = 0;
        if (downbeats.length) {
            const distance = Math.min(...downbeats.map(x => Math.abs(x - v.time_ms))), tol = Math.min(fit.beat_length_ms * 0.5, c.min_segment_duration_ms * 0.125);
            if (distance <= tol)
                bonus = c.downbeat_split_score_bonus * (1 - distance / Math.max(tol, 1e-6));
        }
        const score = v.score + bonus, old = byFrame.get(frame);
        if (!old || score > old.score)
            byFrame.set(frame, { frame, score });
    }
    return [...byFrame.values()].sort((a, b) => b.score - a.score);
}
