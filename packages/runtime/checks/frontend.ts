import * as ort from 'onnxruntime-node';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { loadModels, type Ort } from '../src/models.js';
import { Recording } from './recording.js';
import { loadResampler, mono, resample, spectrogram, beatActivations } from '../src/audio.js';
const root = resolve(process.env.ENSOMI_MODEL_DIR ?? '../../../ensomi-model/artifacts/release-r2/bulk/hf/ensomi-r2');
const refs = resolve(process.env.ENSOMI_REFERENCE_DIR ?? '../../../ensomi-model/artifacts/runtime-ref');
const models = await loadModels(async (p) => new Uint8Array(await readFile(join(root, 'onnx', p))), { ort: ort as unknown as Ort, session: { executionProviders: ['cpu'], intraOpNumThreads: 1, interOpNumThreads: 1 } });
const songs = process.argv.slice(2);
const report: any = {};
function compare(a: ArrayLike<number>, b: ArrayLike<number>) { let max_abs = 0, at = -1, sse = 0; for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    sse += d * d;
    if (d > max_abs) {
        max_abs = d;
        at = i;
    }
} return { max_abs, rms: Math.sqrt(sse / a.length), index: at, actual: a[at], reference: b[at] }; }
await mkdir('artifacts/bulk', { recursive: true });
try {
    for (const song of songs.length ? songs : ['hesitation-snow', 'saigetsu', 'catch-the-moment', 'adventure']) {
        const r = await Recording.open(join(refs, 'bulk', song));
        const audio = await r.event('audio'), expected = await r.event('listener');
        const result: any = {};
        let t = performance.now();
        const kernel = await loadResampler(Number(audio.sample_rate[0]), async (p) => new Uint8Array(await readFile(join('assets', p))));
        const pcm = resample(mono(audio.pcm as Float64Array, 2), kernel);
        result.resample_seconds = (performance.now() - t) / 1000;
        t = performance.now();
        const spect = await spectrogram(pcm, models, 'beatthis');
        result.spect_seconds = (performance.now() - t) / 1000;
        result.spect = compare(spect, audio.spectrogram as Float32Array);
        console.log(song, 'spect', result.spect_seconds, result.spect);
        t = performance.now();
        const acts = await beatActivations(spect, models);
        result.beatthis_seconds = (performance.now() - t) / 1000;
        result.beat = compare(acts.beat, expected.beat_logits as Float32Array);
        result.downbeat = compare(acts.downbeat, expected.downbeat_logits as Float32Array);
        t = performance.now();
        const mel = await spectrogram(audio.mel_pcm as Float32Array, models, 'rows');
        result.mel_seconds = (performance.now() - t) / 1000;
        result.mel = compare(mel, expected.log_mel as Float32Array);
        console.log(song, JSON.stringify(result));
        report[song] = result;
        for (const [key, data] of Object.entries({ mel, spect, beat: acts.beat, downbeat: acts.downbeat }))
            await writeFile(`artifacts/bulk/${song}-${key}.bin`, new Uint8Array(data.buffer));
        await r.close();
        await writeFile('artifacts/frontend.json', JSON.stringify(report, null, 2) + '\n');
    }
}
finally {
    await models.dispose();
}
