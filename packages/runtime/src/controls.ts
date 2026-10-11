// system/controls.py: class-preserving controls and corpus-scope lookup.
import { argmax, clip, lowerBound, mean, median, quantile } from './math.js';
import type { Models } from './models.js';
import type { ChartState } from './r2/features.js';
export interface ActionTable {
    heads: number[][];
    ln: number[][];
    features: number[][];
    groups: Record<string, number[][]>;
    /** Lanes with a head, one bit per lane. */
    masks: number[];
    /** Actions allowed on a head row and on the final row. */
    support: boolean[];
    final: boolean[];
}
export function actionTables(actions: number[][]): ActionTable[] {
    return Array.from({ length: 16 }, (_, pattern) => {
        const held = [0, 1, 2, 3].map(l => (pattern >> l) & 1);
        const heads = actions.map(c => c.map((v, l) => Number(held[l] ? v === 3 || v === 4 : v === 1 || v === 2))), ln = actions.map(c => c.map((v, l) => Number(held[l] ? v === 4 : v === 2)));
        const features = heads.map((h, i) => [ln[i].reduce((a, b) => a + b, 0), h.reduce((a, b) => a + b, 0), Number(h.every((x, l) => x || held[l]))]);
        const groups: Record<string, number[][]> = {};
        for (const concept of ['jack', 'stream_subtype', 'stream', 'chord']) {
            const keyed = new Map<string, number[]>();
            features.forEach((f, i) => { const values = concept === 'jack' ? f : concept === 'stream_subtype' ? [Number(f[0] > 0), f[1], f[2]] : [Number(f[0] > 0), f[2]], key = values.join(','); if (!keyed.has(key))
                keyed.set(key, []); keyed.get(key)!.push(i); });
            groups[concept] = [...keyed.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(x => x[1]);
        }
        const masks = heads.map(h => h.reduce((m, v, l) => m | v << l, 0));
        const support = actions.map((codes, i) => codes.every((c, l) => held[l] || c <= 2) && heads[i].some(Boolean)), final = actions.map(codes => codes.every((c, l) => c === (held[l] ? 2 : 0)));
        return { heads, ln, features, groups, masks, support, final };
    });
}
export function logNormalize(logp: ArrayLike<number>): Float64Array {
    let max = -Infinity;
    for (let i = 0; i < logp.length; i++)
        if (logp[i] > max)
            max = logp[i];
    let sum = 0;
    for (let i = 0; i < logp.length; i++)
        if (Number.isFinite(logp[i]))
            sum += Math.exp(logp[i] - max);
    const z = max + Math.log(sum);
    return Float64Array.from(logp, x => x - z);
}
function logAddExp(a: number, b: number) { if (a === -Infinity)
    return b; if (b === -Infinity)
    return a; const m = Math.max(a, b); return m + Math.log1p(Math.exp(-Math.abs(a - b))); }
export function tilt(logp: Float64Array, feature: boolean[], groups: number[][], weight: number): {
    logp: Float64Array;
    error: number;
} {
    if (weight === 0)
        return { logp, error: 0 };
    const out = logp.slice();
    let error = 0;
    for (const group of groups) {
        const indices = group.filter(i => Number.isFinite(logp[i]));
        if (!indices.length)
            continue;
        let oldZ = -Infinity, newZ = -Infinity;
        for (const i of indices) {
            oldZ = logAddExp(oldZ, logp[i]);
            newZ = logAddExp(newZ, logp[i] + weight * Number(feature[i]));
        }
        let oldMass = 0, newMass = 0;
        for (const i of indices) {
            out[i] = logp[i] + weight * Number(feature[i]) + oldZ - newZ;
            oldMass += Math.exp(logp[i]);
            newMass += Math.exp(out[i]);
        }
        error = Math.max(error, Math.abs(newMass - oldMass));
    }
    return { logp: out, error };
}
export function transition(heads: number[], previous: number[], beforePrevious?: number[]): [
    boolean,
    boolean
] {
    const jack = heads.some((v, l) => v && previous[l]);
    const back = beforePrevious !== undefined && previous.reduce((a, b) => a + b, 0) !== 3 && !previous.some((v, l) => v && beforePrevious[l]) && heads.every((v, l) => v === beforePrevious[l]);
    return [jack, !jack && !back];
}
function choose(n: number, k: number) { if (k > n)
    return 0; let x = 1; for (let j = 1; j <= k; j++)
    x = x * (n - j + 1) / j; return x; }
export const CHANCE = Array.from({ length: 5 }, (_, a) => Array.from({ length: 5 }, (_, b) => a && b ? 1 - choose(4 - a, b) / choose(4, b) : 0));
export const SUBTYPES: Record<string, {
    concept: string;
    share: string;
}> = { jumpstream: { concept: 'stream', share: 'jump_share' }, chordstream: { concept: 'stream', share: 'hand_share' }, chordjack: { concept: 'jack', share: 'chord_share' } };
export const chordFeature = (count: number, subtype: string) => subtype === 'jumpstream' ? count === 2 : count >= (subtype === 'chordstream' ? 3 : 2);
export const logit = (v: number) => { const p = clip(v, 0.01, 0.99); return Math.log(p / (1 - p)); };
export function rowRange(heads: number[], a: number, b: number, songMs: number): [
    number,
    number
] { return [lowerBound(heads, a), b >= songMs ? heads.length : lowerBound(heads, b)]; }
export class Playability {
    readonly runs = [0, 0, 0, 0];
    quadRun = 0;
    constructor(readonly config: Record<string, any>) { }
    rejections(chart: ChartState, k: number, masks: number[]): Record<string, boolean[]> {
        const gap = k ? chart.headMs[k] - chart.headMs[k - 1] : Infinity;
        let tercile = 0;
        while (tercile < this.config.gap_tercile_edges_ms.length && this.config.gap_tercile_edges_ms[tercile] <= gap)
            tercile++;
        const cap = this.config.jack_run_caps[tercile], quad = this.quadRun >= this.config.quad_run_cap;
        let reattack = 0, jack = 0;
        for (let l = 0; l < 4; l++) {
            if (chart.headMs[k] - chart.lastAttack[k][l] < this.config.reattack_floor_ms)
                reattack |= 1 << l;
            if (this.runs[l] >= cap)
                jack |= 1 << l;
        }
        return { reattack: masks.map(m => (m & reattack) !== 0), quad: masks.map(m => m === 15 && quad), jack: masks.map(m => (m & jack) !== 0) };
    }
    observe(heads: number[]) { for (let l = 0; l < 4; l++)
        this.runs[l] = heads[l] ? this.runs[l] + 1 : 0; this.quadRun = heads.every(Boolean) ? this.quadRun + 1 : 0; }
}
export function fallbackAction(logp: Float64Array, heads: number[][], elapsed: number[]): number {
    let candidates = Array.from(logp, (_, i) => i).filter(i => Number.isFinite(logp[i]) && heads[i].reduce((a, b) => a + b, 0) === 1);
    const oldest = Math.max(...candidates.map(i => elapsed[heads[i].findIndex(Boolean)]));
    candidates = candidates.filter(i => elapsed[heads[i].findIndex(Boolean)] === oldest);
    return candidates[argmax(candidates.map(i => logp[i]))];
}
export interface PatternScope {
    concept: 'stream' | 'jack';
    a_ms: number;
    b_ms: number;
    q: number;
    subtype?: string;
    [key: string]: any;
}
export type ScopeTable = Record<string, Float64Array>;
export async function loadScopes(models: Models): Promise<ScopeTable> {
    const columns = models.manifest.calibration.scope_table.columns;
    return Object.fromEntries(await Promise.all(columns.map(async (c: any) => [c.name, Float64Array.from(await models.array(c), Number)])));
}
function matchedScopes(table: ScopeTable, band: number, lengthMs: number, gapMs: number, subtype?: string, chordTarget?: number) {
    const lengths = [8, 16, 32], length = lengths[argmax(lengths.map(x => -Math.abs(Math.log(x) - Math.log(lengthMs / 1000))))];
    const indices = Array.from(table.band, (_, i) => i).filter(i => table.band[i] === band && table.length_s[i] === length);
    let scale: any = null, distances: number[];
    const lg = indices.map(i => Math.log(table.median_gap_ms[i]));
    if (!subtype)
        distances = lg.map(x => Math.abs(x - Math.log(gapMs)));
    else {
        const share = indices.map(i => table[SUBTYPES[subtype].share][i]), means = [mean(lg), mean(share)], sd = [lg, share].map((values, j) => Math.sqrt(mean(values.map(x => (x - means[j]) ** 2))) || 1);
        distances = indices.map((_, i) => Math.hypot((lg[i] - Math.log(gapMs)) / sd[0], (share[i] - chordTarget!) / sd[1]));
        scale = { population_scopes: indices.length, mean: means, sd, ddof: 0, constant_coordinate_scale: 1 };
    }
    const nearest = indices.map((i, j) => ({ i, d: distances[j] })).sort((a, b) => a.d - b.d).slice(0, 256).map(x => x.i);
    return { indices: nearest, length, scale };
}
export function resolveRequests(heads: number[], songMs: number, requests: PatternScope[], band: number, cal: Record<string, any>, table: ScopeTable): PatternScope[] {
    return requests.map(request => {
        const [lo, hi] = rowRange(heads, request.a_ms, request.b_ms, songMs), gaps = heads.slice(lo + 1, hi).map((x, i) => x - heads[lo + i]), gap = median(gaps), sub = request.subtype;
        if (gaps.length === 0)
            throw new Error('A pattern scope must contain at least two head rows');
        const first = matchedScopes(table, band, request.b_ms - request.a_ms, gap), floor = cal.masks[String(band)].reattack_floor_ms;
        let values: any;
        if (sub) {
            const preset = cal.subtypes[sub].bands[String(band)], shares = first.indices.map(i => table[SUBTYPES[sub].share][i]), chordTarget = quantile(shares, preset.q_sub), match = matchedScopes(table, band, request.b_ms - request.a_ms, gap, sub, chordTarget), metric = SUBTYPES[sub].concept === 'stream' ? 'S' : 'J_ex', vs = match.indices.map(i => table[metric][i]), reasons: string[] = [];
            if ((sub === 'jumpstream' || sub === 'chordstream') && gap > cal.stream_eligibility_gap_ms)
                reasons.push('rows do not carry a stream: median gap above stream p90');
            if (sub === 'chordstream' && 2 * gap < floor)
                reasons.push('two median gaps below re-attack floor');
            if (sub === 'chordjack' && gap < Math.max(floor, preset.reference_gap_p10_ms))
                reasons.push('median gap below re-attack floor or chordjack reference p10');
            values = { target: quantile(vs, request.q), band: [quantile(vs, 0.05), quantile(vs, 0.95)], p90: quantile(vs, 0.9), neighbors: vs.length, length_bin_s: first.length, chord_target: chordTarget, chord_band: [quantile(shares, 0.05), quantile(shares, 0.95)], chord_q: preset.q_sub, chord_neighbors: shares.length, preset_in_band: preset.in_band, preset_out_of_band_reasons: preset.out_of_band_reasons, concept_match_standardization: match.scale, temporal_eligible: !reasons.length, eligibility_reasons: reasons, reattack_floor_ms: floor, reference_gap_p10_ms: preset.reference_gap_p10_ms };
        }
        else {
            const vs = first.indices.map(i => table[request.concept === 'stream' ? 'S' : 'J_ex'][i]);
            values = { target: quantile(vs, request.q), band: [quantile(vs, 0.05), quantile(vs, 0.95)], p90: quantile(vs, 0.9), neighbors: vs.length, length_bin_s: first.length };
        }
        return { ...request, ...values, median_gap_ms: gap, ...(request.concept === 'stream' ? { rows_carry_stream: gap <= cal.stream_eligibility_gap_ms } : { reattack_floor_ms: floor, rows_allow_jack: gap >= floor }) };
    });
}
export function scopeStatistics(chart: ChartState, a: number, b: number) {
    const [lo, hi] = rowRange(chart.headMs, a, b, chart.songMs), jack: number[] = [], stream: number[] = [], chance: number[] = [];
    const counts = chart.attack.slice(lo, hi).map(h => h.reduce((a, b) => a + b, 0));
    let chordPairs = 0, identical = 0;
    for (let k = Math.max(1, lo); k < hi; k++) {
        const [j, s] = transition(chart.attack[k], chart.attack[k - 1], chart.attack[k - 2]);
        jack.push(Number(j));
        stream.push(Number(s));
        const a = chart.attack[k - 1].reduce((a, b) => a + b, 0), b = chart.attack[k].reduce((a, b) => a + b, 0);
        chance.push(CHANCE[a][b]);
        if (a >= 2 && b >= 2) {
            chordPairs++;
            if (chart.attack[k].every((x, l) => x === chart.attack[k - 1][l]))
                identical++;
        }
    }
    const n = jack.length, share = (test: (x: number) => boolean) => counts.length ? mean(counts.map(x => Number(test(x)))) : null;
    return { transitions: n, J: n ? mean(jack) : null, J_chance: n ? mean(chance) : null, J_ex: n ? mean(jack) - mean(chance) : null, S: n ? mean(stream) : null, heads_per_row: counts.length ? mean(counts) : null, single_note_share: share(x => x === 1), jump_share: share(x => x === 2), hand_share: share(x => x >= 3), chord_share: share(x => x >= 2), arity_mix: Object.fromEntries([1, 2, 3, 4].map(n => [n, share(x => x === n)])), identical_consecutive_chord_share: n ? identical / n : null, identical_consecutive_chord_count: identical, consecutive_chord_transitions: chordPairs, identical_given_consecutive_chord_share: chordPairs ? identical / chordPairs : null };
}
