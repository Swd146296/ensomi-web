import { detectChanges } from './change_detection.js';
import { fitSegment } from './segment_fit.js';
import { centered } from './scoring.js';
import { fitsMergeable, weightedScore } from './segments.js';
import type { Config, SegmentFit, EvaluatedSplit } from './types.js';
const splitBetter = (a: EvaluatedSplit, b: EvaluatedSplit) => a.improvement > b.improvement || (a.improvement === b.improvement && a.candidate.score > b.candidate.score);
export function splitSegments(signal: Float64Array, times: Float64Array, downbeat: Float64Array, initial: SegmentFit, c: Config): SegmentFit[] {
    let remaining = c.max_segments - 1;
    const cache = new Map<string, SegmentFit>([[`${initial.start_frame}:${initial.end_frame}`, initial]]);
    function fit(start: number, end: number) { const key = `${start}:${end}`; let f = cache.get(key); if (!f) {
        f = fitSegment(signal, times, downbeat, start, end, c);
        cache.set(key, f);
    } return f; }
    let fits = [initial];
    const candidates = detectChanges(signal, times, downbeat, initial, c);
    if (candidates.length >= 2 && !(candidates.length < c.initial_batch_split_min_candidate_count && initial.score > c.initial_batch_split_max_parent_score)) {
        const selected = candidates.slice(0, Math.min(remaining, c.initial_batch_split_candidate_count)).sort((a, b) => a.frame - b.frame);
        const edges = [initial.start_frame, ...selected.map(x => x.frame), initial.end_frame], batch = edges.slice(0, -1).map((x, i) => fit(x, edges[i + 1]));
        const alias = batch.length >= c.merge_alias_min_segments && centered(downbeat)[1] > 0, loose = batch.length >= c.merge_many_similar_min_segments, merged: SegmentFit[] = [];
        for (const f of batch) {
            const prev = merged[merged.length - 1];
            if (!prev || !fitsMergeable(prev, f, times, c, alias && f.score <= c.merge_alias_max_fit_score, loose))
                merged.push(f);
            else
                merged[merged.length - 1] = fit(prev.start_frame, f.end_frame);
        }
        if (merged.length >= 2 && weightedScore(merged) - initial.score >= c.split_score_improvement_threshold)
            fits = merged;
    }
    remaining -= fits.length - 1;
    const splits = new Map<string, EvaluatedSplit | null>();
    while (remaining > 0) {
        let best: EvaluatedSplit | null = null;
        for (let i = 0; i < fits.length; i++) {
            const f = fits[i], key = `${f.start_frame}:${f.end_frame}`;
            if (!splits.has(key)) {
                let local: EvaluatedSplit | null = null;
                for (const candidate of detectChanges(signal, times, downbeat, f, c).slice(0, c.max_split_candidates_per_segment)) {
                    const left = fit(f.start_frame, candidate.frame), right = fit(candidate.frame, f.end_frame);
                    if (fitsMergeable(left, right, times, c))
                        continue;
                    const value = { segment_index: i, candidate, left_fit: left, right_fit: right, improvement: weightedScore([left, right]) - f.score };
                    if (!local || splitBetter(value, local))
                        local = value;
                }
                splits.set(key, local);
            }
            const cached = splits.get(key);
            if (!cached)
                continue;
            const value = { ...cached, segment_index: i };
            if (!best || splitBetter(value, best))
                best = value;
        }
        if (!best || best.improvement < c.split_score_improvement_threshold)
            break;
        fits.splice(best.segment_index, 1, best.left_fit, best.right_fit);
        remaining--;
    }
    return fits;
}
