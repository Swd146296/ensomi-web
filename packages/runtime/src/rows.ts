// audio_rows/rowsgen.py: song encoder, GRU, copy mixture, quiet rests and section tilt.
import type { Models } from './models.js';
import type { RandomSource } from './random.js';
import { Grid } from './grid.js';
import { clip, mod, interp, round, f32, sum } from './math.js';
import { StrainState, REFERENCE_LANES } from './strain.js';
export interface RowsSection {
    start_ms: number;
    end_ms: number;
    star?: number;
    request?: number;
}
export type Trace = (name: string, values: Record<string, ArrayLike<number> | number>) => void | Promise<void>;
export function starRequest(record: Record<string, any>, star: number) { return interp(star, record.star_map.star, record.star_map.request); }
export function songInputs(models: Models, grid: Grid, songMs: number, request: number, sections: RowsSection[] = []) {
    const record = models.manifest.rows.record, positions = models.manifest.constants['audio_rows.figures'].POSITIONS;
    const b0 = Math.floor(grid.beat(0)), nb = Math.max(Math.ceil(grid.beat(songMs)) - b0, 1);
    const edges = Float64Array.from({ length: nb + 1 }, (_, i) => grid.time(b0 + i)), positionMs = new Float64Array(nb * 24), extra = new Float32Array(nb * 9), target = new Float64Array(nb).fill(NaN);
    const standard = (x: number) => (x - record.label_mean) / record.label_std;
    for (let b = 0; b < nb; b++) {
        const time = clip(edges[b], 0, songMs);
        extra[b * 9 + mod(b0 + b, 4)] = 1;
        extra[b * 9 + 4] = time / songMs;
        extra[b * 9 + 5] = grid.bpm(time) / 120;
        extra[b * 9 + 6] = standard(request);
        for (let p = 0; p < 24; p++)
            positionMs[b * 24 + p] = grid.time(b0 + b + positions[p] / 48);
        for (const section of sections)
            if (time >= section.start_ms && time < section.end_ms) {
                const value = section.request ?? starRequest(record, section.star!);
                extra[b * 9 + 7] = standard(value);
                extra[b * 9 + 8] = 1;
                target[b] = value;
            }
    }
    return { b0, nb, edges, positionMs, extra, target };
}
export function quietRank(mel: Float32Array, beatFrames: BigInt64Array, window = 4) {
    const nf = mel.length / 128, nb = beatFrames.length / 2, cs = new Float64Array(nf + 1);
    for (let f = 0; f < nf; f++) {
        let total = 0;
        for (let m = 0; m < 128; m++)
            total += mel[f * 128 + m];
        cs[f + 1] = cs[f] + f32(total / 128);
    }
    const intensity = Array.from({ length: nb }, (_, b) => { const lo = Number(beatFrames[Math.max(b - window, 0) * 2]), hi = Number(beatFrames[Math.min(b + window, nb - 1) * 2 + 1]); return (cs[hi] - cs[lo]) / Math.max(hi - lo, 1); });
    const order = Array.from({ length: nb }, (_, i) => i).sort((a, b) => intensity[a] - intensity[b]), ranks = new Float64Array(nb);
    order.forEach((b, r) => ranks[b] = r / Math.max(nb - 1, 1));
    return ranks;
}
export function cleanHeads(heads: number[], songMs: number) { const out: number[] = []; for (const t of heads.map(round).sort((a, b) => a - b))
    if (t >= 0 && t <= songMs - 2 && (!out.length || t - out[out.length - 1] >= 2))
        out.push(t); return out; }
export async function decodeRows(models: Models, features: Float32Array, grid: Grid, songMs: number, star: number, random: RandomSource, options: {
    sections?: RowsSection[];
    temperature?: number;
    quiet_rests?: number;
    section_gain?: number;
    trace?: Trace;
} = {}) {
    const cfg = models.manifest.rows.config, record = models.manifest.rows.record, V = cfg.vocab, lags = cfg.lags, heads = cfg.heads, key = cfg.key;
    const request = starRequest(record, star), input = songInputs(models, grid, songMs, request, options.sections), { b0, nb, edges, positionMs, extra, target } = input, nf = features.length / 130;
    const mel = new Float32Array(nf * 128);
    for (let f = 0; f < nf; f++)
        mel.set(features.subarray(f * 130, f * 130 + 128), f * 128);
    const posFrames = BigInt64Array.from(positionMs, x => BigInt(clip(Math.trunc(x / 10), 0, nf - 1))), bf = Array.from(edges, x => clip(Math.trunc(x / 10), 0, nf));
    const beatFrames = new BigInt64Array(nb * 2), available = new Uint8Array(nb * 24);
    for (let b = 0; b < nb; b++) {
        beatFrames[b * 2] = BigInt(bf[b]);
        beatFrames[b * 2 + 1] = BigInt(Math.min(nf, Math.max(bf[b + 1], bf[b] + 1)));
    }
    for (let i = 0; i < positionMs.length; i++)
        available[i] = Number(positionMs[i] >= 0 && positionMs[i] <= songMs - 2);
    const tensor = (type: any, data: any, dims: number[]) => new models.ort.Tensor(type, data, dims);
    const encoded = await models.run('rows_encoder', { mel: tensor('float32', mel, [1, nf, 128]), pos_frames: tensor('int64', posFrames, [1, nb, 24]), beat_frames: tensor('int64', beatFrames, [1, nb, 2]), extra: tensor('float32', extra, [1, nb, 9]), valid: tensor('bool', new Uint8Array(nb).fill(1), [1, nb]) });
    const quiet = quietRank(mel, beatFrames), ids = new Int32Array(nb).fill(-1), figures = new Int32Array(nb), gates = new Float32Array(nb * (1 + heads)), tilts = new Float32Array(nb), wh = new Float64Array(nb);
    const counts = Int32Array.from(record.vocab, (f: number) => { let c = 0; while (f) {
        c += f & 1;
        f >>>= 1;
    } return c; });
    let hidden = tensor('float32', new Float32Array(cfg.hidden), [1, 1, cfg.hidden]), prev = V, strain = new StrainState(), nHeads = 0, sectionStart = 0;
    const gain = options.section_gain ?? 3, steer = gain !== 0 && target.some(x => !Number.isNaN(x));
    const slice = (name: string, b: number, size: number, dims: number[]) => tensor('float32', (encoded[name].data as Float32Array).slice(b * size, (b + 1) * size), dims);
    await options.trace?.('rows/grid', { edges, position_ms: positionMs, available, beat_frames: Array.from(beatFrames, Number), target });
    for (let b = 0; b < nb; b++) {
        const backIds = new Int32Array(lags).fill(-1), backKeys = new Float32Array(lags * heads * key), eq = new Float32Array(lags * 2), ok = new Uint8Array(lags), isQuiet = quiet[b] < (options.quiet_rests ?? 0.4);
        for (let lag = 0; lag < lags; lag++) {
            const j = b - 1 - lag, jj = Math.max(j, 0);
            if (j >= 0)
                backIds[lag] = ids[j];
            backKeys.set((encoded.key.data as Float32Array).subarray(jj * heads * key, (jj + 1) * heads * key), lag * heads * key);
            for (let d = 1; d <= 2; d++) {
                const before = b - d >= 0 ? ids[b - d] : -1, bj = jj - d >= 0 ? ids[jj - d] : -1;
                eq[lag * 2 + d - 1] = Number(j >= 0 && bj === before && before >= 0);
            }
            ok[lag] = Number(j >= 0 && (isQuiet || backIds[lag] !== 0));
        }
        const out = await models.run('rows_step', { context: slice('context', b, cfg.ctx, [1, cfg.ctx]), pos: slice('pos', b, 24 * cfg.enc, [1, 24, cfg.enc]), query: slice('query', b, heads * key, [1, heads, key]), extra: tensor('float32', extra.slice(b * 9, (b + 1) * 9), [1, 9]), prev: tensor('int64', BigInt64Array.of(BigInt(prev)), [1]), hidden, back_keys: tensor('float32', backKeys, [1, lags, heads, key]), eq: tensor('float32', eq, [1, lags, 2]), back_ok: tensor('bool', ok, [1, lags]), temperature: tensor('float32', Float32Array.of(options.temperature ?? 1), []) });
        hidden = out.hidden_out;
        const gate = out.gate.data as Float32Array, att = out.attention.data as Float32Array, logp = out.logp.data as Float32Array, pgen = new Float32Array(V), p = new Float32Array(V), ph = new Float32Array(V);
        for (let v = 0; v < V; v++) {
            pgen[v] = Math.exp(logp[v]);
            p[v] = f32(gate[0] * pgen[v]);
        }
        for (let hd = 0; hd < heads; hd++) {
            const base = hd * (lags + 1), generate = att[base + lags], weight = gate[hd + 1];
            for (let v = 0; v < V; v++)
                ph[v] = f32(generate * pgen[v]);
            for (let lag = 0; lag < lags; lag++)
                if (ok[lag])
                    ph[backIds[lag]] = f32(ph[backIds[lag]] + att[base + lag]);
            for (let v = 0; v < V; v++)
                p[v] = f32(p[v] + f32(weight * ph[v]));
        }
        await options.trace?.(`rows/${b}/mixture`, { generator: pgen, mixed: p, back_ids: backIds, quiet: Number(isQuiet), copy_allowed: ok });
        let forbidden = 0;
        for (let pos = 0; pos < 24; pos++)
            if (!available[b * 24 + pos])
                forbidden |= 1 << pos;
        for (let v = 0; v < V; v++)
            if ((record.vocab[v] & forbidden) !== 0)
                p[v] = 0;
        if (steer && !Number.isNaN(target[b])) {
            if (b === 0 || target[b - 1] !== target[b])
                sectionStart = b;
            const a = Math.max(Math.min(sectionStart, b - 4), 0), ta = clip(edges[a], 0, songMs), tb = clip(edges[b], 0, songMs);
            if (b > a && tb > ta) {
                const realised = Math.log(Math.max(sum(wh.subarray(a, b)) / ((tb - ta) / 1000), 0.001));
                tilts[b] = clip(gain * (target[b] - realised), -2, 2);
                for (let v = 0; v < V; v++)
                    p[v] = f32(p[v] * f32(Math.exp(f32(tilts[b] * counts[v]))));
            }
        }
        const total = f32(sum(p)), probability = p.map(x => f32(x / total)), chosen = await random.multinomial(probability, `rows/${b}/figure`);
        await options.trace?.(`rows/${b}/sample`, { probability, tilt: tilts[b], chosen });
        ids[b] = chosen;
        figures[b] = record.vocab[chosen];
        gates.set(gate, b * (1 + heads));
        prev = chosen;
        if (steer)
            for (let pos = 0; pos < 24; pos++)
                if (figures[b] & (1 << pos)) {
                    const q = [0, 0, 0, 0];
                    q[REFERENCE_LANES[nHeads % 4]] = 1;
                    const [next, charge] = strain.append(round(positionMs[b * 24 + pos] * 1000) / 1000, q);
                    strain = next;
                    nHeads++;
                    wh[b] += charge;
                }
    }
    const times: number[] = [];
    for (let b = 0; b < nb; b++)
        for (let p = 0; p < 24; p++)
            if (figures[b] & (1 << p))
                times.push(round(positionMs[b * 24 + p] * 1000) / 1000);
    const rawHeads = [...new Set(times)].sort((a, b) => a - b), headMs = cleanHeads(rawHeads, songMs);
    return { headMs, rawHeads, request, b0, nb, ids, figures, edges, gates, tilts, dropped: rawHeads.length - headMs.length };
}
