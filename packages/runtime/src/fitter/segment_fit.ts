import { median } from '../math.js';
import { centered, candidateBpms, scoreGrid, bestCandidate, refineOffset, bestBpm } from './scoring.js';
import type { SegmentFit, GridCandidate, Config } from './types.js';
export function fitSegment(signal: Float64Array, times: Float64Array, downbeat: Float64Array, start: number, end: number, c: Config): SegmentFit {
    const [s, n] = centered(signal.slice(start, end)), t = times.slice(start, end);
    if (n === 0)
        return { start_frame: start, end_frame: end, score: -Infinity, beat_length_ms: 60000 / c.min_bpm, offset_ms: 0, raw_bpm: c.min_bpm, tempo_multiplier: 1 };
    const [d, dn] = centered(downbeat.slice(start, end)), candidates: GridCandidate[] = [];
    const step = t.length < 2 ? 20 : median(t.slice(1).map((x, i) => x - t[i])), fps = step <= 0 ? 50 : 1000 / step;
    for (const b of candidateBpms(s, fps, c)) {
        const length = 60000 / b;
        for (let o = 0; o < length; o += c.offset_step_ms)
            candidates.push({ score: scoreGrid(s, n, t, length, o, c.pulse_width_ms), bpm: b, beat_length_ms: length, offset_ms: o });
    }
    let [score, ds, b, length, offset] = bestCandidate(candidates, d, dn, t, c);
    [score, offset, ds] = refineOffset(s, n, t, length, offset, score, ds, c, d, dn);
    const raw_bpm = b, raw_score = score, raw_ds = ds;
    const [double, doff, dds] = bestBpm(s, n, t, raw_bpm * 2, c, d, dn);
    let mult = 1;
    const rejects = Number.isFinite(raw_ds) && Number.isFinite(dds) && double <= raw_score + c.downbeat_tie_score_margin && raw_ds > dds + c.downbeat_tie_score_margin;
    if (double !== -Infinity && double >= raw_score * c.double_tempo_score_ratio_threshold && !rejects) {
        b = raw_bpm * 2;
        length = 60000 / b;
        offset = doff;
        score = double;
        mult = 2;
    }
    return { start_frame: start, end_frame: end, score, beat_length_ms: length, offset_ms: offset, raw_bpm, tempo_multiplier: mult };
}
