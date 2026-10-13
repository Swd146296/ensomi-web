// The page prepares a song and generates from the Prepared with ChartScheduler ('whole-chart'); this checks that it
// gets generateChart's chart and .osu. Per song: the recorded PCM averaged to mono at its recorded rate (as
// ensomi-runtime's js/checks/stream.mjs reads it), both paths with the same request, ONNX Runtime Web WASM, one thread.
// Run from packages/runtime with the sibling ensomi-model and ensomi-runtime checkouts: node checks/prepare-equal.mjs [song...]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadModels, generateChart, prepare, ChartScheduler } from '@ensomi/runtime';
const runtime = resolve(import.meta.dirname, '..'), web = resolve(runtime, '../..'), modelRepo = resolve(web, '../ensomi-model');
const { Recording } = await import(pathToFileURL(resolve(web, '../ensomi-runtime/js/checks/recording.mjs')));
const out = join(runtime, 'artifacts/browser-test/prepare-equal.json'), args = process.argv.slice(2), songs = args.length ? args : ['catch-the-moment', 'hesitation-snow'];
const modelDir = join(modelRepo, 'artifacts/release-r2/bulk/hf/ensomi-r2');
const models = await loadModels(async p => new Uint8Array(await readFile(join(modelDir, 'onnx', p))), { backend: 'wasm', wasm: { numThreads: 1 } });
const report = { runtime: JSON.parse(await readFile(join(web, 'node_modules/@ensomi/runtime/package.json'), 'utf8')).version, songs: {} };
for (const song of songs) {
    const recording = await Recording.open(join(modelRepo, 'artifacts/runtime-ref/bulk', song));
    const audio = await recording.event('audio');
    const channels = recording.shape(recording.index.events.find(e => e.name === 'audio').arrays.pcm)[1] ?? 1;
    await recording.close();
    const pcm = new Float32Array(audio.pcm.length / channels);
    for (let i = 0; i < pcm.length; i++) {
        let sum = 0;
        for (let c = 0; c < channels; c++) sum += audio.pcm[i * channels + c];
        pcm[i] = sum / channels;
    }
    const sampleRate = Number(audio.sample_rate[0]);
    for (const request of [{ star: 3.5, seed: 1, title: song }, { star: 4.5, seed: 7, title: song, controls: { sections: [{ start_ms: 20000, end_ms: 40000, pattern: { kind: 2, strength: 0.7 } }] } }]) {
        const direct = await generateChart(models, pcm, sampleRate, request);
        const prepared = await prepare(models, pcm, sampleRate);
        const scheduler = await ChartScheduler.create(models, prepared, request, { mode: 'whole-chart' });
        scheduler.start(0);
        let action;
        do action = await scheduler.work(); while (action.kind !== 'done');
        scheduler.free();
        const viaPrepared = action.result, a = JSON.parse(direct.receipt.receipt_json), b = JSON.parse(viaPrepared.receipt.receipt_json);
        const row = { seed: request.seed, star: request.star, sections: request.controls?.sections.length ?? 0, objects: direct.chart.objects.length, sameChart: JSON.stringify(direct.chart) === JSON.stringify(viaPrepared.chart), sameOsu: direct.osu === viaPrepared.osu, sameSegments: JSON.stringify(a.rows.segments) === JSON.stringify(b.rows.segments), directSeconds: a.seconds, preparedSeconds: b.seconds };
        (report.songs[song] ??= []).push(row);
        console.log(song, JSON.stringify(row));
    }
}
await models.dispose();
await mkdir(join(runtime, 'artifacts/browser-test'), { recursive: true });
await writeFile(out, JSON.stringify(report, null, 2) + '\n');
if (Object.values(report.songs).flat().some(r => !r.sameChart || !r.sameOsu)) process.exitCode = 1;
