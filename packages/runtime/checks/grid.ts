import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { Recording } from './recording.js';
import { fitGrid } from '../src/fitter/index.js';
import { Grid, correctedGrid } from '../src/grid.js';
const root = resolve(process.env.ENSOMI_MODEL_DIR ?? '../../../ensomi-model/artifacts/release-r2/bulk/hf/ensomi-r2');
const refs = resolve(process.env.ENSOMI_REFERENCE_DIR ?? '../../../ensomi-model/artifacts/runtime-ref');
const manifest = JSON.parse(await readFile(join(root, 'onnx/runtime.json'), 'utf8'));
const names = process.argv.slice(2).filter(x => !x.startsWith('--'));
const useReference = process.argv.includes('--recorded-features');
const report: any = {};
for (const song of names.length ? names : ['hesitation-snow', 'saigetsu', 'catch-the-moment', 'adventure']) {
    const r = await Recording.open(join(refs, 'bulk', song)), expected = await r.event('listener');
    async function data(key: string) { const b = await readFile(`artifacts/bulk/${song}-${key}.bin`); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); }
    const beat = useReference ? expected.beat_logits as Float32Array : await data('beat'), down = useReference ? expected.downbeat_logits as Float32Array : await data('downbeat'), mel = useReference ? expected.log_mel as Float32Array : await data('mel');
    const trace: any = {}, start = performance.now();
    console.log(song, 'fit started');
    const segments = fitGrid(beat, down, mel, Number(expected.song_ms[0]), manifest.grid_fitter, (name, value) => { trace[name] = value; console.log(song, name, JSON.stringify(value)); });
    const seconds = (performance.now() - start) / 1000;
    const wanted = Array.from(expected.segments, Number), actual = segments.flatMap(s => [s.offset_ms, s.beat_length_ms]);
    const diffs = actual.map((x, i) => x - wanted[i]);
    const grid = correctedGrid(segments, Number(expected.song_ms[0])), expectedGrid = await r.event('system/rows');
    const arrays = new Grid(grid), b0 = Math.floor(arrays.beat(0)), nb = Math.max(Math.ceil(arrays.beat(Number(expected.song_ms[0]))) - b0, 1), positions = manifest.constants['audio_rows.figures'].POSITIONS;
    const rowsGrid = await r.event('rows/grid');
    let maxGridMs = 0, wholeMsMismatches = 0, frameMismatches = 0;
    let firstMismatch: any;
    for (let b = 0; b < nb; b++)
        for (let p = 0; p < 24; p++) {
            const at = arrays.time(b0 + b + positions[p] / 48), want = Number(rowsGrid.position_ms[b * 24 + p]);
            maxGridMs = Math.max(maxGridMs, Math.abs(at - want));
            if (Math.round(at) !== Math.round(want)) {
                wholeMsMismatches++;
                firstMismatch ??= { beat: b, position: p, actual: at, reference: want };
            }
            if (Math.trunc(at / 10) !== Math.trunc(want / 10))
                frameMismatches++;
        }
    const gridParity = { max_error_ms: maxGridMs, whole_ms_mismatches: wholeMsMismatches, frame_mismatches: frameMismatches, firstMismatch };
    if (maxGridMs > 1e-4 || wholeMsMismatches || frameMismatches)
        throw new Error(JSON.stringify({ stage: 2, song, ...gridParity }));
    console.log(song, 'grid parity', gridParity);
    report[song] = { gridParity, seconds, segments, expected: wanted, differences: diffs, grid, expected_grid: { offsets: Array.from(expectedGrid.grid_offsets, Number), lengths: Array.from(expectedGrid.grid_lengths, Number) }, trace };
    console.log(song, 'result', JSON.stringify({ seconds, segments, expected: wanted, differences: diffs, grid }));
    await r.close();
    await writeFile(`artifacts/grid${useReference ? '-recorded-features' : ''}.json`, JSON.stringify(report, null, 2) + '\n');
}
