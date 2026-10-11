import { clip, median } from './math.js';
import { referenceWorkload } from './strain.js';
import type { Grid } from './grid.js';
export interface Prediction {
    held: number;
    heads: number;
    busy_free: number;
    quad: number;
    log_r: number;
}
export function rowsFeatures(headMs: number[], songMs: number, grid: Grid): number[] {
    const seconds = songMs / 1000, gap = headMs.length > 1 ? median(headMs.slice(1).map((t, i) => t - headMs[i])) : songMs;
    return [Math.log(headMs.length / seconds), Math.log(Math.max(gap, 1)), Math.log(Math.max(referenceWorkload(headMs), 1e-6) / seconds), Math.log(median(headMs.map(t => grid.bpm(t))))];
}
export function predictPrior(prior: Record<string, any>, features: number[], band: number): Prediction {
    const p = prior.bands[String(band)];
    let values: number[];
    if (prior.method === 'median')
        values = p.median;
    else if (prior.method === 'linear')
        values = Array.from({ length: 5 }, (_, i) => [1, ...features].reduce((s, x, j) => s + x * p.coef[j][i], 0));
    else {
        const z = features.map((x, i) => (x - p.mean[i]) / p.sd[i]);
        const distances = p.table.map((row: number[], i: number) => ({ i, d: Math.sqrt(z.reduce((s, x, j) => s + (row[j] - x) ** 2, 0)) }));
        distances.sort((a: {
            d: number;
        }, b: {
            d: number;
        }) => a.d - b.d);
        const near = distances.slice(0, prior.neighbours ?? 64).map((x: {
            i: number;
        }) => p.table[x.i]);
        values = Array.from({ length: 5 }, (_, i) => median(near.map((row: number[]) => row[i + 4])));
    }
    return { held: clip(values[0], 0, 1), heads: clip(values[1], 1, 4), busy_free: clip(values[2], 0, 1), quad: clip(values[3], 0, 1), log_r: values[4] };
}
export function kappaTargets(p: Prediction, lnFraction = 1, multiplier = 1) { return [p.held * lnFraction, p.heads * multiplier, p.busy_free * lnFraction + p.quad * Math.min(1, multiplier)]; }
