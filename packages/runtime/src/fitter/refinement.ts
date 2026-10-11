import { argmax, lowerBound, mod, round, sum } from '../math.js';
import { centered, bestBpm, scoreGrid } from './scoring.js';
import { mergeSegments, phaseError, nearestOffset } from './segments.js';
import { bpm, type TimingSegment, type Config } from './types.js';
function collapse(segments: TimingSegment[], times: Float64Array, c: Config): TimingSegment[] {
    if (segments.length < c.refine_dominant_min_segments)
        return segments;
    const first = times[0], last = times[times.length - 1];
    const durations = segments.map((s, i) => Math.max(0, Math.min(last, segments[i + 1]?.offset_ms ?? last) - (i === 0 ? first : Math.max(first, s.offset_ms)))), total = sum(durations);
    if (total <= 0)
        return segments;
    const families: {
        bpm: number;
        indices: number[];
        weight: number;
        bpmSum: number;
    }[] = [];
    segments.forEach((s, i) => {
        const b = bpm(s), duration = durations[i];
        const f = families.find(f => Math.abs(b - (f.weight <= 0 ? b : f.bpmSum / f.weight)) <= Math.max(c.refine_dominant_bpm_tolerance, Math.min(b, f.weight <= 0 ? b : f.bpmSum / f.weight) * c.merge_relative_bpm_tolerance));
        if (f) {
            f.indices.push(i);
            f.weight += duration;
            f.bpmSum += b * duration;
            f.bpm = f.weight <= 0 ? bpm(segments[f.indices[0]]) : f.bpmSum / f.weight;
        }
        else
            families.push({ bpm: b, indices: [i], weight: duration, bpmSum: b * duration });
    });
    if (families.length < 2)
        return segments;
    const dominant = families[argmax(families.map(f => f.weight))], indices = dominant.indices;
    const farTol = Math.max(c.refine_dominant_far_bpm_tolerance, dominant.bpm * c.refine_dominant_far_relative_bpm_tolerance);
    const far = segments.filter((s, i) => !indices.includes(i) && Math.abs(bpm(s) - dominant.bpm) > farTol).length;
    const off = segments.slice(1).filter((s, i) => phaseError(s.offset_ms, segments[i].offset_ms, segments[i].beat_length_ms) > c.refine_dominant_boundary_phase_tolerance_ms).length;
    if (indices.length < c.refine_dominant_min_segment_count || segments.length - indices.length < c.refine_dominant_min_outlier_segments || far < c.refine_dominant_min_far_outlier_segments || dominant.weight / total < c.refine_dominant_min_duration_ratio)
        return segments;
    if ((Math.max(first, segments[indices[0]].offset_ms) - first) / Math.max(1, last - first) > c.refine_dominant_max_first_anchor_ratio || off < c.refine_dominant_min_off_lattice_transitions || indices[indices.length - 1] - indices[0] + 1 === indices.length)
        return segments;
    const b = Math.abs(dominant.bpm - round(dominant.bpm)) <= c.refine_dominant_bpm_snap_tolerance ? round(dominant.bpm) : dominant.bpm, length = 60000 / b;
    let x = 0, y = 0, weight = 0, longest = indices[0], longestDuration = -1;
    for (const i of indices) {
        const w = durations[i], a = 2 * Math.PI * mod(segments[i].offset_ms, length) / length;
        x += w * Math.cos(a);
        y += w * Math.sin(a);
        weight += w;
        if (w > longestDuration) {
            longest = i;
            longestDuration = w;
        }
    }
    let offset = mod(segments[longest].offset_ms, length);
    if (weight > 0 && Math.hypot(x, y) / weight >= c.refine_circular_phase_min_coherence)
        offset = mod(Math.atan2(y, x), 2 * Math.PI) / (2 * Math.PI) * length;
    return [{ offset_ms: nearestOffset(offset, length, segments[0].offset_ms), beat_length_ms: length }];
}
function gridScore(segments: TimingSegment[], times: Float64Array, signal: Float64Array, c: Config): number | null {
    let weighted = 0, count = 0;
    for (let i = 0; i < segments.length; i++) {
        const s = segments[i], start = lowerBound(times, i === 0 ? times[0] : Math.max(times[0], s.offset_ms)), end = lowerBound(times, Math.min(times[times.length - 1] + 1, segments[i + 1]?.offset_ms ?? Infinity));
        if (end - start < 2)
            continue;
        const [v, n] = centered(signal.slice(start, end));
        if (n === 0)
            continue;
        const score = scoreGrid(v, n, times.slice(start, end), s.beat_length_ms, s.offset_ms, c.pulse_width_ms);
        if (!Number.isFinite(score))
            continue;
        weighted += score * (end - start);
        count += end - start;
    }
    return count <= 0 ? null : weighted / count;
}
export function refineTiming(segments: TimingSegment[], times: Float64Array, signal: Float64Array, c: Config): TimingSegment[] {
    let collapsed = collapse(segments, times, c);
    if (collapsed !== segments && collapsed.length === 1) {
        const [s, n] = centered(signal);
        if (n !== 0) {
            const [, offset] = bestBpm(s, n, times, bpm(collapsed[0]), c);
            collapsed = [{ ...collapsed[0], offset_ms: offset }];
        }
    }
    let refined = segments;
    if (collapsed !== segments) {
        const old = gridScore(segments, times, signal, c), next = gridScore(collapsed, times, signal, c);
        if (old === null || next === null || next >= old - c.refine_structural_max_score_loss)
            refined = collapsed;
    }
    refined = mergeSegments(refined, c);
    let previous = -Infinity;
    const quantized = refined.map(s => { let offset = round(s.offset_ms / c.refine_offset_quantum_ms) * c.refine_offset_quantum_ms; if (offset <= previous)
        offset = previous + c.refine_offset_quantum_ms; previous = offset; return { ...s, offset_ms: offset }; });
    return mergeSegments(quantized, c);
}
