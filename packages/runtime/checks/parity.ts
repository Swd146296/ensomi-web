import * as ort from 'onnxruntime-node';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { loadModels, type Ort } from '../src/models.js';
import { generateChart } from '../src/generate.js';
import { validateChart } from '../src/export.js';
import { round } from '../src/math.js';
import { Recording } from './recording.js';
import { ReplayRandom } from './replay_random.js';
import { networkReplay } from './network.js';
import { difference, firstTextDifference, parseOsu } from './compare.js';
const modelDir = resolve(process.env.ENSOMI_MODEL_DIR ?? '../../../ensomi-model/artifacts/release-r2/bulk/hf/ensomi-r2');
const modelRepo = resolve(process.env.ENSOMI_MODEL_REPO ?? join(modelDir, '../../../../..'));
const referenceDir = resolve(process.env.ENSOMI_REFERENCE_DIR ?? '../../../ensomi-model/artifacts/runtime-ref');
const args = process.argv.slice(2), songs = args.filter(x => !x.startsWith('--'));
const selected = songs.length ? songs : ['hesitation-snow', 'saigetsu', 'catch-the-moment', 'adventure'];
const report: any = { ort: ort.env.versions.node, provider: 'cpu', threads: 1, graph_tolerance: 1e-4, grid_tolerance_ms: 1e-4, scope: 'recorded graph inputs, PCM frontends, full TypeScript decode with carried state and replayed random draws, exact exports, own PRNG', songs: {}, passed: false };
await mkdir('artifacts/bulk', { recursive: true });
const save = () => writeFile('artifacts/parity.json', JSON.stringify(report, null, 2) + '\n');
const models = await loadModels(async (p) => new Uint8Array(await readFile(join(modelDir, 'onnx', p))), { ort: ort as unknown as Ort, session: { executionProviders: ['cpu'], intraOpNumThreads: 1, interOpNumThreads: 1 }, runtimeSource: async (p) => new Uint8Array(await readFile(join('assets', p))) });
try {
    // All six graphs on every recorded input, before beginning the frontend/decode checks.
    for (const song of selected) {
        console.log(`${song}: stage 1 graph replay`);
        const recording = await Recording.open(join(referenceDir, 'bulk', song));
        try {
            report.songs[song] = { stage1: { passed: true, networks: await networkReplay(recording, models) } };
        }
        finally {
            await recording.close();
        }
        console.log(song, 'stage 1', Object.fromEntries(Object.entries(report.songs[song].stage1.networks).map(([name, value]: [
            string,
            any
        ]) => [name, value.max_abs])));
        await save();
    }
    for (const song of selected) {
        const row = report.songs[song], recording = await Recording.open(join(referenceDir, 'bulk', song)), random = new ReplayRandom(recording), audio = await recording.event('audio'), listener = await recording.event('listener'), gridEvent = await recording.event('rows/grid'), expectedRows = await recording.event('system/rows'), expectedPrior = await recording.event('system/prior');
        const receipt = JSON.parse(await readFile(join(modelDir, 'examples', song, 'receipt.json'), 'utf8')), expectedOsu = await readFile(join(modelDir, 'examples', song, 'generated.osu'), 'utf8'), summary = JSON.parse(await readFile(join(referenceDir, song, 'summary.json'), 'utf8'));
        const encoded = { name: summary.audio.split('/').pop(), bytes: new Uint8Array(await readFile(join(modelRepo, summary.audio))) };
        const request = { star: receipt.star, seed: receipt.seed, title: receipt.metadata.title, artist: receipt.metadata.artist, audio: { asset_id: song } };
        const pcm = { samples: audio.pcm as Float64Array, channels: recording.index.arrays[0].shape[1] ?? 1, mel: audio.mel_pcm as Float32Array }, sampleRate = Number(audio.sample_rate[0]);
        const phases: number[] = [];
        let decisions = 0, figures = 0;
        console.log(`${song}: stages 2–5, replaying draws`);
        try {
            const result = await generateChart(models, pcm, sampleRate, request, { random, audio: encoded, setting: receipt.setting, onProgress: p => phases.push(p.phase), trace: async (name, values) => {
                    if (name === 'listener') {
                        const g = values.grid, b0 = Math.floor(g.beat(0)), nb = Math.max(Math.ceil(g.beat(values.song_ms)) - b0, 1), positions = models.manifest.constants['audio_rows.figures'].POSITIONS;
                        let maxGridMs = 0, wholeMsMismatches = 0, frameMismatches = 0;
                        for (let b = 0; b < nb; b++)
                            for (let p = 0; p < 24; p++) {
                                const actual = g.time(b0 + b + positions[p] / 48), expected = Number(gridEvent.position_ms[b * 24 + p]);
                                maxGridMs = Math.max(maxGridMs, Math.abs(actual - expected));
                                wholeMsMismatches += Number(round(actual) !== round(expected));
                                frameMismatches += Number(Math.trunc(actual / 10) !== Math.trunc(expected / 10));
                            }
                        row.stage2 = { passed: maxGridMs <= 1e-4 && !wholeMsMismatches && !frameMismatches, max_grid_error_ms: maxGridMs, whole_ms_mismatches: wholeMsMismatches, frame_mismatches: frameMismatches, spectrogram: difference(values.spectrogram, audio.spectrogram), log_mel: difference(values.log_mel, listener.log_mel), beat_logits: difference(values.beat_logits, listener.beat_logits), segments: values.segments };
                        if (!row.stage2.passed)
                            throw new Error(JSON.stringify({ stage: 2, song, ...row.stage2 }));
                    }
                    if (/^rows\/\d+\/sample$/.test(name))
                        figures++;
                    if (name === 'system/rows') {
                        const diff = difference(values.headMs, expectedRows.head_ms);
                        row.stage3 = { passed: diff.max_abs === 0 && diff.same_length, figures, heads: values.headMs.length, head_times: diff };
                        if (!row.stage3.passed)
                            throw new Error(JSON.stringify({ stage: 3, song, ...row.stage3 }));
                    }
                    if (name === 'system/prior') {
                        let error = 0;
                        for (const key of ['held', 'heads', 'busy_free', 'quad', 'log_r'])
                            error = Math.max(error, Math.abs(values[key] - Number(expectedPrior[key][0])));
                        row.stage4 = { passed: false, prior_max_error: error };
                        if (error !== 0)
                            throw new Error(JSON.stringify({ stage: 4, song, step: 'prior', error }));
                    }
                    if (/^r2_pass_\d+\/\d+\/chosen$/.test(name)) {
                        const expected = await recording.event(name);
                        decisions++;
                        for (const key of ['codes', 'releases']) {
                            const diff = difference(values[key], expected[key]);
                            if (diff.max_abs || !diff.nonfinite_equal)
                                throw new Error(JSON.stringify({ stage: 4, song, step: name, key, ...diff }));
                        }
                    }
                } });
            if (random.position !== recording.index.draws.length)
                throw new Error(`Unconsumed draws: ${random.position}/${recording.index.draws.length}`);
            const detail = JSON.parse(result.receipt.receipt_json);
            row.stage4 = { ...row.stage4, passed: true, decisions, draws_consumed: random.position, draws_recorded: recording.index.draws.length, passes: detail.controls.difficulty.passes };
            row.replay_seconds = detail.seconds;
            row.phases = phases;
            const expectedObjects = parseOsu(expectedOsu), objectsEqual = JSON.stringify(result.chart.objects) === JSON.stringify(expectedObjects);
            if (!objectsEqual) {
                const index = result.chart.objects.findIndex((o, i) => JSON.stringify(o) !== JSON.stringify(expectedObjects[i]));
                throw new Error(JSON.stringify({ stage: 5, song, step: 'hitobjects', index, actual: result.chart.objects[index], reference: expectedObjects[index] }));
            }
            const archive = unzipSync(result.osz!);
            const audioKey = Object.keys(archive).find(x => x.startsWith('audio.'))!;
            const zipValid = strFromU8(archive['generated.osu']) === result.osu && strFromU8(archive['receipt.json']).trim() === result.receipt.receipt_json && archive[audioKey].length === encoded.bytes.length && archive[audioKey].every((x, i) => x === encoded.bytes[i]);
            if (!zipValid)
                throw new Error(`Stage 5 ${song}: osz round trip changed content`);
            const stripGenerator = (text: string) => text.split('\n').filter(line => !/^\/\/ (rows=|@ensomi\/runtime )/.test(line)).join('\n');
            const textDifference = firstTextDifference(stripGenerator(result.osu), stripGenerator(expectedOsu));
            row.stage5 = { passed: textDifference === null, hitobjects_identical: true, objects: result.chart.objects.length, osu_identical_except_generator: textDifference === null, first_text_difference: textDifference, osz_round_trip: true };
            await mkdir(`artifacts/bulk/${song}`, { recursive: true });
            await writeFile(`artifacts/bulk/${song}/runtime.osu`, result.osu);
            await writeFile(`artifacts/bulk/${song}/runtime.osz`, result.osz!);
            console.log(song, 'replay', row.stage5);
            console.log(`${song}: own PRNG run`);
            const own = await generateChart(models, pcm, sampleRate, request, { audio: encoded, setting: receipt.setting });
            validateChart(own.chart);
            const ownDetail = JSON.parse(own.receipt.receipt_json);
            if (!ownDetail.export.replay_finalized)
                throw new Error(`Own PRNG left an open hold: ${song}`);
            row.prng = { passed: true, algorithm: ownDetail.runtime.random_algorithm, seed: request.seed, objects: own.chart.objects.length, heads: ownDetail.rows.K, fallbacks: ownDetail.fallback_count, seconds: ownDetail.seconds };
            await writeFile(`artifacts/bulk/${song}/prng.osu`, own.osu);
            await writeFile(`artifacts/bulk/${song}/prng-receipt.json`, own.receipt.receipt_json + '\n');
            console.log(song, 'PRNG valid', row.prng.objects, row.prng.seconds);
        }
        finally {
            await recording.close();
            await save();
        }
    }
    report.passed = selected.every(song => [1, 2, 3, 4, 5].every(n => report.songs[song][`stage${n}`]?.passed) && report.songs[song].prng?.passed);
    if (!report.passed) {
        report.stopped_at_stage = 5;
        process.exitCode = 1;
    }
}
catch (error) {
    report.failure = String(error);
    process.exitCode = 1;
    console.error(error);
}
finally {
    await models.dispose();
    await save();
}
