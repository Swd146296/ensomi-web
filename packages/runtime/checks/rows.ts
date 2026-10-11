import * as ort from 'onnxruntime-node';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { loadModels, type Ort } from '../src/models.js';
import { features } from '../src/audio.js';
import { Grid, correctedGrid } from '../src/grid.js';
import { decodeRows } from '../src/rows.js';
import { Recording } from './recording.js';
import { ReplayRandom } from './replay_random.js';
const root = resolve(process.env.ENSOMI_MODEL_DIR ?? '../../../ensomi-model/artifacts/release-r2/bulk/hf/ensomi-r2');
const refs = resolve(process.env.ENSOMI_REFERENCE_DIR ?? '../../../ensomi-model/artifacts/runtime-ref');
const models = await loadModels(async (p) => new Uint8Array(await readFile(join(root, 'onnx', p))), { ort: ort as unknown as Ort, session: { executionProviders: ['cpu'], intraOpNumThreads: 1, interOpNumThreads: 1 } });
const grids = JSON.parse(await readFile('artifacts/grid.json', 'utf8')), report: any = {};
const names = process.argv.slice(2);
try {
    for (const song of names.length ? names : ['hesitation-snow', 'saigetsu', 'catch-the-moment', 'adventure']) {
        const r = await Recording.open(join(refs, 'bulk', song)), expected = await r.event('listener'), systemRows = await r.event('system/rows'), random = new ReplayRandom(r);
        const receipt = JSON.parse(await readFile(join(root, 'examples', song, 'receipt.json'), 'utf8'));
        async function data(key: string) { const b = await readFile(`artifacts/bulk/${song}-${key}.bin`); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); }
        const mel = await data('mel'), beat = await data('beat'), downbeat = await data('downbeat'), feats = features(mel, beat.map(x => 1 / (1 + Math.exp(-x))), downbeat.map(x => 1 / (1 + Math.exp(-x)))), songMs = Number(expected.song_ms[0]), segments = grids[song].segments;
        const grid = new Grid(correctedGrid(segments, songMs));
        let maxProbabilityError = 0;
        const start = performance.now();
        try {
            const rows = await decodeRows(models, feats, grid, songMs, receipt.star, random, { trace: async (name, values) => {
                    if (!name.endsWith('/sample'))
                        return;
                    const expected = await r.event(name), actual = values.probability as Float32Array;
                    for (let i = 0; i < actual.length; i++)
                        maxProbabilityError = Math.max(maxProbabilityError, Math.abs(actual[i] - Number(expected.probability[i])));
                } });
            const seconds = (performance.now() - start) / 1000, heads = Array.from(systemRows.head_ms, Number);
            const mismatch = rows.headMs.findIndex((x, i) => x !== heads[i]);
            if (mismatch >= 0 || rows.headMs.length !== heads.length)
                throw new Error(JSON.stringify({ stage: 3, song, index: mismatch, actual: rows.headMs[mismatch], reference: heads[mismatch], lengths: [rows.headMs.length, heads.length] }));
            report[song] = { passed: true, seconds, beats: rows.nb, heads: rows.headMs.length, draws: random.position, max_probability_error: maxProbabilityError };
            await writeFile(`artifacts/bulk/${song}-rows.json`, JSON.stringify({ ...rows, ids: Array.from(rows.ids), figures: Array.from(rows.figures), edges: Array.from(rows.edges), gates: undefined, tilts: Array.from(rows.tilts), songMs, segments, randomPosition: random.position }) + '\n');
            console.log(song, report[song]);
        }
        catch (e) {
            report[song] = { passed: false, error: String(e) };
            console.error(e);
            process.exitCode = 1;
            break;
        }
        finally {
            await r.close();
            await writeFile('artifacts/rows.json', JSON.stringify(report, null, 2) + '\n');
        }
    }
}
finally {
    await models.dispose();
}
