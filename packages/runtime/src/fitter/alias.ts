import { mean, round, mod, argmax } from '../math.js';
import { centered, bestCandidate, scoreGrid } from './scoring.js';
import { phaseError, aliases, timingSegments, weightedScore } from './segments.js';
import { bpm, type Config, type SegmentFit, type TimingSegment } from './types.js';
interface AliasOption {
    fit: SegmentFit;
    local_score: number;
    change_kind: string;
    beat_support_ratio: number;
    has_strong_evidence: boolean;
}
const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(1e-6, Math.abs(b) * 1e-9);
function semanticPromotion(current: number, candidate: number, score: number, currentScore: number, c: Config): boolean {
    if (current <= 0 || candidate <= current)
        return false;
    const below = current < c.alias_preferred_min_bpm, trap = current >= c.alias_semantic_promotion_in_band_min_bpm && current <= c.alias_semantic_promotion_current_max_bpm;
    if (!below && !trap || candidate < c.alias_preferred_min_bpm || candidate > c.alias_preferred_max_bpm || !Number.isFinite(score))
        return false;
    if (!Number.isFinite(currentScore) || currentScore <= 0)
        return score > 0;
    const ratio = score / currentScore;
    if (below)
        return currentScore <= c.alias_semantic_promotion_low_bpm_max_fit_score && ratio >= c.alias_semantic_promotion_score_ratio_threshold;
    if (ratio >= c.alias_semantic_promotion_strong_score_ratio_threshold)
        return true;
    return currentScore <= c.alias_semantic_promotion_low_confidence_max_fit_score && candidate <= c.alias_semantic_promotion_low_confidence_max_candidate_bpm && ratio >= c.alias_semantic_promotion_low_confidence_score_ratio_threshold;
}
function localScore(score: number, b: number, down: number, current: boolean, c: Config) { return score + (Number.isFinite(down) ? c.alias_downbeat_score_weight * down : 0) + (b >= c.alias_preferred_min_bpm && b <= c.alias_preferred_max_bpm ? c.alias_preferred_band_bonus : 0) + (current ? c.alias_current_tempo_bonus : 0); }
function supportRatio(fit: SegmentFit, candidate: SegmentFit, signal: Float64Array, times: Float64Array, kind: string, c: Config): number {
    const base = kind === 'demotion' ? fit : candidate, match = kind === 'demotion' ? candidate : fit;
    const lo = Math.ceil((times[0] - base.offset_ms) / base.beat_length_ms), hi = Math.floor((times[times.length - 1] - base.offset_ms) / base.beat_length_ms);
    const kept: number[] = [], changed: number[] = [], step = times.length === 1 ? c.pulse_width_ms : (times[times.length - 1] - times[0]) / (times.length - 1), radius = Math.ceil(c.pulse_width_ms / step) + 2;
    for (let n = lo; n <= hi; n++) {
        const t = base.offset_ms + n * base.beat_length_ms, center = round((t - times[0]) / step);
        let support = 0;
        for (let j = Math.max(0, center - radius); j <= Math.min(signal.length - 1, center + radius); j++)
            support = Math.max(support, signal[j] * Math.max(0, 1 - Math.abs(times[j] - t) / c.pulse_width_ms));
        (phaseError(t, match.offset_ms, match.beat_length_ms) <= c.alias_beat_match_tolerance_ms ? kept : changed).push(support);
    }
    return !kept.length || !changed.length || mean(kept) <= 1e-9 ? Infinity : mean(changed) / mean(kept);
}
function optionsFor(fit: SegmentFit, signal: Float64Array, times: Float64Array, downbeat: Float64Array, c: Config, lower: boolean): AliasOption[] {
    const raw = signal.slice(fit.start_frame, fit.end_frame), [s, n] = centered(raw), t = times.slice(fit.start_frame, fit.end_frame), [d, dn] = centered(downbeat.slice(fit.start_frame, fit.end_frame));
    const original = { fit, local_score: localScore(fit.score, bpm(fit), -Infinity, true, c), change_kind: 'same', beat_support_ratio: Infinity, has_strong_evidence: true };
    if (n === 0)
        return [{ ...original, local_score: fit.score }];
    const options = new Map<number, AliasOption>([[round(bpm(fit) * 1e6) / 1e6, original]]);
    const base = Number.isFinite(fit.raw_bpm) && fit.raw_bpm > 0 ? fit.raw_bpm : bpm(fit) / fit.tempo_multiplier;
    for (const mult of c.alias_tempo_multipliers) {
        const b = base * mult;
        if (!lower && dn === 0 && Math.abs(fit.tempo_multiplier - 1) > 1e-9 && b < bpm(fit))
            continue;
        if (b < c.min_bpm || b > c.max_bpm || !Number.isFinite(b) || close(b, bpm(fit)))
            continue;
        const length = 60000 / b, count = length > fit.beat_length_ms ? Math.max(1, round(length / fit.beat_length_ms)) : 1, offsets: number[] = [], seen = new Set<number>();
        for (let i = 0; i < count; i++) {
            const o = mod(fit.offset_ms + i * fit.beat_length_ms, length), key = round(o * 1e6) / 1e6;
            if (!seen.has(key)) {
                seen.add(key);
                offsets.push(o);
            }
        }
        offsets.sort((a, b) => a - b);
        const candidates = offsets.map(o => ({ score: scoreGrid(s, n, t, length, o, c.pulse_width_ms), bpm: b, beat_length_ms: length, offset_ms: o }));
        const [score, ds, , , offset] = bestCandidate(candidates, d, dn, t, c), semantic = semanticPromotion(bpm(fit), b, score, fit.score, c);
        const scoreClose = !Number.isFinite(fit.score) || score + c.alias_score_tie_margin >= fit.score || (fit.score > 0 && score >= fit.score * c.alias_score_ratio_threshold);
        if (!Number.isFinite(score) || !scoreClose && !semantic)
            continue;
        const kind = b > bpm(fit) ? 'promotion' : 'demotion', next = { ...fit, score, beat_length_ms: length, offset_ms: offset, tempo_multiplier: mult };
        const ratio = supportRatio(fit, next, raw, t, kind, c), strong = semantic || (Number.isFinite(ratio) && (kind === 'promotion' ? ratio >= c.alias_promotion_inserted_support_ratio_threshold : ratio <= c.alias_demotion_dropped_support_ratio_threshold));
        if (!strong)
            continue;
        const local = localScore(score, b, ds, close(b, bpm(fit)), c) + (semantic ? c.alias_semantic_promotion_bonus : 0), key = round(b * 1e6) / 1e6, old = options.get(key);
        if (!old || local > old.local_score)
            options.set(key, { fit: next, local_score: local, change_kind: kind, beat_support_ratio: ratio, has_strong_evidence: strong });
    }
    return [...options.values()].sort((a, b) => bpm(a.fit) - bpm(b.fit));
}
function switchCount(segments: TimingSegment[], c: Config) { let n = 0; for (let i = 1; i < segments.length; i++)
    if (Math.abs(bpm(segments[i - 1]) - bpm(segments[i])) > c.merge_bpm_tolerance && aliases(bpm(segments[i - 1]), bpm(segments[i]), c.merge_alias_bpm_tolerance))
        n++; return n; }
export function canonicalizeAliases(fits: SegmentFit[], signal: Float64Array, times: Float64Array, downbeat: Float64Array, c: Config): SegmentFit[] {
    const options = fits.map(f => optionsFor(f, signal, times, downbeat, c, fits.length > 1));
    let scores = options[0].map(x => x.local_score), paths = options[0].map((_, i) => [i]);
    for (let s = 1; s < options.length; s++) {
        const nextScores: number[] = [], nextPaths: number[][] = [];
        for (let i = 0; i < options[s].length; i++) {
            let best = -Infinity, path: number[] = [];
            for (let j = 0; j < scores.length; j++) {
                const b = bpm(options[s][i].fit), prev = bpm(options[s - 1][j].fit), penalty = prev <= 0 || b <= 0 ? 0 : c.alias_continuity_penalty * Math.abs(Math.log2(b / prev));
                const score = scores[j] + options[s][i].local_score - penalty;
                if (score > best) {
                    best = score;
                    path = [...paths[j], i];
                }
            }
            nextScores.push(best);
            nextPaths.push(path);
        }
        scores = nextScores;
        paths = nextPaths;
    }
    const path = paths[argmax(scores)], proposed = path.map((k, i) => options[i][k]);
    const changed = proposed.filter((x, i) => !close(bpm(x.fit), bpm(fits[i])));
    if (!changed.length)
        return proposed.map(x => x.fit);
    if (changed.some(x => !x.has_strong_evidence))
        return fits;
    if (fits.length > c.alias_semantic_promotion_low_bpm_max_segments && proposed.some((x, i) => bpm(fits[i]) < c.alias_preferred_min_bpm && bpm(x.fit) > bpm(fits[i])))
        return fits;
    const next = proposed.map(x => x.fit), originalSegments = timingSegments(fits, times, c), nextSegments = timingSegments(next, times, c);
    if (nextSegments.length > originalSegments.length)
        return fits;
    const oldScore = weightedScore(fits), newScore = weightedScore(next);
    if (nextSegments.length < originalSegments.length && (!Number.isFinite(newScore) || (Number.isFinite(oldScore) && oldScore > 0 && newScore < oldScore * c.alias_collapse_score_ratio_threshold)))
        return fits;
    if (switchCount(nextSegments, c) > switchCount(originalSegments, c))
        return fits;
    if (bpm(next[0]) < bpm(fits[0]) && bpm(fits[0]) >= c.alias_preferred_min_bpm && bpm(fits[0]) <= c.alias_preferred_max_bpm)
        return fits;
    return next;
}
