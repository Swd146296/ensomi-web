// r2/features.py and sampling.IncrementalState: explicit, committed-prefix state.
import { Grid } from '../grid.js';
import { clip, lowerBound, round } from '../math.js';
export const psi = (d: number, scale: number) => [clip(d / scale, -32, 32), Math.sign(d) * Math.log1p(Math.abs(d) / scale)];
export const psiPair = (ms: number, beats: number) => [...psi(ms, 1000), ...psi(beats, 1)];
export const phase = (beat: number) => [1, 4, 16].flatMap(p => { const angle = 2 * Math.PI * beat / p; return [Math.sin(angle), Math.cos(angle)]; });
const onehot = (value: number, size: number) => Array.from({ length: size }, (_, i) => Number(i === clip(value, 0, size - 1)));
function rightBound(a: number[], x: number) { let i = lowerBound(a, x); while (i < a.length && a[i] === x)
    i++; return i; }
export class ChartState {
    readonly K: number;
    readonly headBeats: number[];
    readonly songBeat: number;
    readonly actions: number[][] = [];
    readonly gap: number[][] = [];
    readonly held: number[][] = [[0, 0, 0, 0]];
    readonly start: number[][] = [[NaN, NaN, NaN, NaN]];
    readonly birth: number[][] = [[-1, -1, -1, -1]];
    readonly release: number[][] = [];
    readonly attack: number[][] = [];
    readonly lnHead: number[][] = [];
    readonly lastAttack: number[][] = [[NaN, NaN, NaN, NaN]];
    readonly lastRelease: number[][] = [[NaN, NaN, NaN, NaN]];
    readonly cumHeads: number[] = [0];
    readonly cumHeld: number[] = [0];
    readonly busy: number[] = [0];
    constructor(readonly headMs: number[], readonly songMs: number, readonly grid: Grid) { this.K = headMs.length; this.headBeats = headMs.map(t => grid.beat(t)); this.songBeat = grid.beat(songMs); }
    time(k: number) { return k < this.K ? this.headMs[k] : this.songMs; }
    beat(k: number) { return k < this.K ? this.headBeats[k] : this.songBeat; }
    append(codes: number[], gap: number[]) {
        const k = this.actions.length, t = this.time(k), held = this.held[k], starts = this.start[k], births = this.birth[k];
        const attack = codes.map((c, l) => Number(held[l] ? c >= 3 : c === 1 || c === 2)), ln = codes.map((c, l) => Number(held[l] ? c === 4 : c === 2)), closed = codes.map((c, l) => Boolean(held[l] && c !== 0));
        const release = codes.map((c, l) => closed[l] ? (c === 1 ? t : gap[l]) : NaN);
        this.actions.push(codes.slice());
        this.gap.push(gap.slice());
        this.attack.push(attack);
        this.lnHead.push(ln);
        this.release.push(release);
        this.held.push(held.map((h, l) => Number(h && !closed[l] || ln[l])));
        this.start.push(starts.map((s, l) => ln[l] ? t : closed[l] ? NaN : s));
        this.birth.push(births.map((b, l) => ln[l] ? k : closed[l] ? -1 : b));
        this.lastAttack.push(this.lastAttack[k].map((v, l) => attack[l] ? t : v));
        this.lastRelease.push(this.lastRelease[k].map((v, l) => Number.isNaN(release[l]) ? v : Number.isNaN(v) ? release[l] : Math.max(v, release[l])));
        this.cumHeads.push(this.cumHeads[k] + attack.reduce((a, b) => a + b, 0));
        this.cumHeld.push(this.cumHeld[k] + held.reduce((a, b) => a + b, 0));
        this.busy.push(this.busy[k] + Number(held.every((h, l) => h || attack[l])));
    }
}
export function laneQuery(chart: ChartState, k: number): number[][] {
    const t = chart.time(k), bt = chart.beat(k);
    const age = (x: number) => Number.isNaN(x) ? [0, 0, 0, 0] : psiPair(t - x, bt - chart.grid.beat(x));
    return [0, 1, 2, 3].map(l => [chart.held[k][l], ...age(chart.start[k][l]), ...age(chart.lastAttack[k][l]), ...age(chart.lastRelease[k][l]), Number(Number.isNaN(chart.lastAttack[k][l])), Number(Number.isNaN(chart.lastRelease[k][l]))]);
}
export function queryFeatures(chart: ChartState, k: number): Float32Array {
    const lanes = laneQuery(chart, k), t = chart.time(k), bt = chart.beat(k), prev = Math.max(0, k - 1), K = chart.K;
    const shared = [...psiPair(k === 0 ? 0 : t - chart.time(prev), k === 0 ? 0 : bt - chart.beat(prev)), ...psiPair(chart.songMs - t, chart.songBeat - bt), t / chart.songMs, k / Math.max(K, 1), Number(k === 0), Number(k === K), ...phase(bt), chart.grid.bpm(t) / 120, chart.grid.meter(t) / 4];
    const lo = rightBound(chart.headBeats, bt);
    for (const h of [1, 2, 4, 8, 16, 32])
        shared.push(k === K ? 0 : Math.log1p(rightBound(chart.headBeats, bt + h) - lo));
    for (let i = 1; i <= 16; i++) {
        const index = k + i, a = Math.min(index, K - 1), b = Math.min(Math.max(index - 1, 0), K - 1);
        shared.push(...(index <= K - 1 ? psiPair(chart.headMs[a] - chart.headMs[b], chart.headBeats[a] - chart.headBeats[b]) : [0, 0, 0, 0]));
    }
    return Float32Array.from([[0, 1, 2, 3], [3, 2, 1, 0]].flatMap(order => [...order.flatMap(l => lanes[l]), ...shared]));
}
export function historyToken(chart: ChartState, k: number): Float32Array {
    const t = chart.time(k), bt = chart.beat(k), prev = Math.max(k - 1, 0);
    const lanes = [0, 1, 2, 3].map(l => {
        const release = chart.release[k][l], start = chart.start[k][l], valid = !Number.isNaN(release) && !Number.isNaN(start);
        const views = valid ? [...psiPair(release - t, chart.grid.beat(release) - bt), ...psiPair(release - chart.time(prev), chart.grid.beat(release) - chart.beat(prev)), ...psiPair(release - start, chart.grid.beat(release) - chart.grid.beat(start))] : new Array<number>(12).fill(0);
        return [...onehot(chart.actions[k][l], 5), chart.held[k][l], Number(!Number.isNaN(release)), ...views];
    });
    const shared = [...psiPair(t - chart.time(prev), bt - chart.beat(prev)), ...psiPair(t - chart.headMs[0], bt - chart.headBeats[0]), ...phase(bt), ...onehot(chart.attack[k].reduce((a, b) => a + b, 0), 5), ...onehot(chart.lnHead[k].reduce((a, b) => a + b, 0), 5)];
    return Float32Array.from([[0, 1, 2, 3], [3, 2, 1, 0]].flatMap(order => [...order.flatMap(l => lanes[l]), ...shared]));
}
export interface Candidates {
    times: number[];
    beats: number[];
    static: number[][];
}
export function buildCandidates(a: number, b: number, grid: Grid): Candidates {
    const gridTimes = new Set<number>(), S = grid.offsets.length;
    for (let s = grid.segment(a); s <= grid.segment(b); s++) {
        const lo = s === 0 ? -Infinity : grid.offsets[s], hi = s === S - 1 ? Infinity : grid.offsets[s + 1], left = Math.max(a - 1, lo), right = Math.min(b + 1, hi);
        if (right < left)
            continue;
        for (const denominator of [32, 24]) {
            const step = grid.lengths[s] / denominator, n0 = Math.ceil((left - grid.offsets[s]) / step), n1 = Math.floor((right - grid.offsets[s]) / step);
            for (let n = n0; n <= n1; n++) {
                const at = grid.offsets[s] + n * step;
                if (at < lo || at >= hi)
                    continue;
                const u = Math.floor(at + 0.5);
                if (u > a && u < b)
                    gridTimes.add(u);
            }
        }
    }
    const bb = grid.beat(b), ba = grid.beat(a), mid = Math.floor((a + b) / 2 + 0.5), eighth = Math.floor(grid.time(bb - 0.125) + 0.5), quarter = Math.floor(grid.time(bb - 0.25) + 0.5);
    const times = Array.from(new Set([...gridTimes, ...[mid, eighth, quarter].filter(x => x > a && x < b)])).sort((a, b) => a - b), beats = times.map(t => grid.beat(t));
    const staticFeatures = times.map((u, i) => {
        const snap = new Array<number>(10).fill(0), local = grid.localBeat(u), length = grid.lengths[grid.segment(u)], denominators = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32];
        for (let j = 0; j < denominators.length; j++) {
            const d = denominators[j];
            if (Math.abs(local * d - round(local * d)) / d * length <= 1) {
                snap[j] = 1;
                break;
            }
        }
        return [...psiPair(u - b, beats[i] - bb), ...psiPair(u - a, beats[i] - ba), (u - a) / (b - a), Number(u === mid), Number(u === eighth), Number(u === quarter), Number(gridTimes.has(u)), ...snap, grid.bpm(u) / 120, ...phase(beats[i])];
    });
    return { times, beats, static: staticFeatures };
}
export function releaseFactor(chart: ChartState, k: number, codes: number[], lane: number, orientation: number, placed: Map<number, [
    number,
    boolean
]>, candidates: Candidates) {
    const start = chart.start[k][lane], startBeat = chart.grid.beat(start), features = new Float32Array(candidates.times.length * 34), relations = new Float32Array(candidates.times.length * 28);
    for (let i = 0; i < candidates.times.length; i++) {
        const u = candidates.times[i], ub = candidates.beats[i], s = candidates.static[i];
        features.set([...s.slice(0, 8), ...psiPair(u - start, ub - startBeat), ...s.slice(8)], i * 34);
        for (let slot = 0; slot < 4; slot++) {
            const physical = orientation === 0 ? slot : 3 - slot, placement = placed.get(physical);
            if (!placement)
                continue;
            const [r, onRow] = placement;
            relations.set([...psiPair(u - r, ub - chart.grid.beat(r)), Number(chart.birth[k][physical] === chart.birth[k][lane] && chart.birth[k][physical] >= 0), 1, Number(onRow)], i * 28 + slot * 7);
        }
    }
    return { codes: orientation ? codes.slice().reverse() : codes, slot: orientation ? 3 - lane : lane, laneFeatures: Float32Array.from(laneQuery(chart, k)[lane]), features, relations };
}
