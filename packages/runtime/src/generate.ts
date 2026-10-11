import { mono, melPcm, resample, sincResample, loadResampler, spectrogram, beatActivations, features } from './audio.js';
import { fitGrid } from './fitter/index.js';
import { correctedGrid, Grid } from './grid.js';
import { decodeRows } from './rows.js';
import { rowsFeatures, predictPrior, kappaTargets } from './prior.js';
import { loadScopes, resolveRequests, type PatternScope } from './controls.js';
import { arrange } from './arrange.js';
import { difficultyPasses } from './difficulty.js';
import { SeededRandom, type RandomSource } from './random.js';
import { chartFromDecisions, validateChart, osuText, exportOsz, audioFilename } from './export.js';
import { GenerationPhase, type PCM, type AudioPCM, type EncodedAudio, type GenerateChartRequest, type GenerationProgress, type GenerationResult } from './types.js';
import type { Models } from './models.js';
export interface GenerateOptions {
    onProgress?: (progress: GenerationProgress) => void;
    random?: RandomSource;
    audio?: EncodedAudio;
    setting?: string;
    /** Optional diagnostics; parity checks observe these values without replacing them. */
    trace?: (name: string, values: any) => void | Promise<void>;
}
const supportedRates = [11025, 16000, 24000, 32000, 44100, 48000, 88200, 96000, 192000];
function validate(pcm: PCM, sampleRate: number, request: GenerateChartRequest): AudioPCM {
    const audio = pcm instanceof Float32Array || pcm instanceof Float64Array ? { samples: pcm, channels: 1 } : pcm;
    if (!Number.isFinite(sampleRate) || sampleRate <= 0 || !Number.isInteger(audio.channels) || audio.channels < 1 || !audio.samples.length || audio.samples.length % audio.channels)
        throw new Error('PCM needs nonempty interleaved samples, a positive sample rate and a channel count');
    for (const x of audio.samples)
        if (!Number.isFinite(x))
            throw new Error('PCM samples must be finite');
    for (const stream of [audio.mel, audio.beatthis])
        if (stream) {
            if (!stream.length)
                throw new Error('Frontend PCM must be nonempty');
            for (const x of stream)
                if (!Number.isFinite(x))
                    throw new Error('Frontend PCM samples must be finite');
        }
    const duration = audio.samples.length / audio.channels / sampleRate * 1000;
    if (duration < 3000)
        throw new Error('Audio must be at least three seconds long to fit a beat grid');
    if (!(request.star >= 2 && request.star < 6))
        throw new Error('star_out_of_range: star must be in [2, 6)');
    const seed = request.seed ?? 0;
    if (typeof seed !== 'number' && typeof seed !== 'bigint' || typeof seed === 'number' && (!Number.isSafeInteger(seed) || seed < 0) || typeof seed === 'bigint' && (seed < 0n || seed > 0xffffffffffffffffn))
        throw new Error('Seed must be an unsigned 64-bit integer; use bigint above the safe-number range');
    if (![0, 1, 2, 3].includes(request.controls?.long_notes ?? 0))
        throw new Error('unsupported_control: unknown long_notes value');
    const sections = request.controls?.sections ?? [];
    for (const section of sections) {
        if (!Number.isInteger(section.start_ms) || !Number.isInteger(section.end_ms) || section.start_ms < 0 || section.end_ms > duration || section.end_ms <= section.start_ms || section.end_ms - section.start_ms < 8000 || section.end_ms - section.start_ms > 32000)
            throw new Error('unsupported_control: sections must be 8–32 seconds within the song');
        if ((section.star !== undefined) === (section.pattern !== undefined))
            throw new Error('unsupported_control: each section needs exactly one star or pattern target');
        if (section.star !== undefined && !(section.star >= 2 && section.star < 6))
            throw new Error('star_out_of_range: section star must be in [2, 6)');
        if (section.pattern && (![1, 2, 3, 4, 5].includes(section.pattern.kind) || !(section.pattern.strength >= 0 && section.pattern.strength <= 1)))
            throw new Error('unsupported_control: pattern kind and strength in [0, 1] are required');
    }
    const ordered = sections.slice().sort((a, b) => a.start_ms - b.start_ms);
    for (let i = 1; i < ordered.length; i++)
        if (ordered[i].start_ms < ordered[i - 1].end_ms)
            throw new Error('unsupported_control: sections must not overlap');
    return audio;
}
export async function generateChart(models: Models, pcm: PCM, sampleRate: number, request: GenerateChartRequest, options: GenerateOptions = {}): Promise<GenerationResult> {
    const audio = validate(pcm, sampleRate, request), songMs = 1000 * audio.samples.length / audio.channels / sampleRate, seed = request.seed ?? 0, seed32 = Number(BigInt(seed) & 0xffffffffn), r2Seed32 = Number((BigInt(seed) + 954n) & 0xffffffffn);
    const random = options.random ?? new SeededRandom(seed32), seconds: Record<string, number> = {}, allStart = performance.now(), progress = (phase: GenerationPhase) => options.onProgress?.({ phase }), trace = options.trace;
    progress(GenerationPhase.LOADING);
    const wave = mono(audio.samples, audio.channels);
    let beatPcm = audio.beatthis;
    let start = performance.now();
    if (!beatPcm) {
        if (sampleRate === 22050)
            beatPcm = Float32Array.from(wave);
        else if (supportedRates.includes(sampleRate))
            beatPcm = resample(wave, await loadResampler(sampleRate, models.runtimeSource));
        else
            beatPcm = sincResample(wave, sampleRate, 22050);
    }
    const rowsPcm = audio.mel ?? melPcm(wave, sampleRate);
    seconds.pcm = (performance.now() - start) / 1000;
    progress(GenerationPhase.TIMING);
    start = performance.now();
    const spect = await spectrogram(beatPcm, models, 'beatthis');
    seconds.spectrogram = (performance.now() - start) / 1000;
    start = performance.now();
    const acts = await beatActivations(spect, models);
    seconds.beatthis = (performance.now() - start) / 1000;
    start = performance.now();
    const logMel = await spectrogram(rowsPcm, models, 'rows'), feats = features(logMel, acts.beatProbability, acts.downbeatProbability);
    seconds.mel = (performance.now() - start) / 1000;
    start = performance.now();
    const segments = fitGrid(acts.beat, acts.downbeat, logMel, songMs, models.manifest.grid_fitter), corrected = correctedGrid(segments, songMs), grid = new Grid(corrected);
    seconds.grid = (performance.now() - start) / 1000;
    await trace?.('listener', { spectrogram: spect, log_mel: logMel, features: feats, beat_logits: acts.beat, downbeat_logits: acts.downbeat, segments, grid, song_ms: songMs });
    progress(GenerationPhase.ROWS);
    random.reset(seed32);
    start = performance.now();
    const sections = request.controls?.sections ?? [], rows = await decodeRows(models, feats, grid, songMs, request.star, random, { sections: sections.filter(s => s.star !== undefined), trace });
    seconds.rows = (performance.now() - start) / 1000;
    if (rows.headMs.length < 2)
        throw new Error('generation_failed: the rows model placed fewer than two heads');
    await trace?.('system/rows', { ...rows, grid, songMs });
    progress(GenerationPhase.ARRANGEMENT);
    start = performance.now();
    const band = Math.min(5, Math.floor(request.star)), priorFeatures = rowsFeatures(rows.headMs, songMs, grid), prediction = predictPrior(models.manifest.prior, priorFeatures, band);
    await trace?.('system/prior', { features: priorFeatures, band, ...prediction });
    const patternNames = [null, ['stream', undefined], ['stream', 'jumpstream'], ['stream', 'chordstream'], ['jack', undefined], ['jack', 'chordjack']] as const;
    const external: PatternScope[] = sections.filter(s => s.pattern).map(s => { const [concept, subtype] = patternNames[s.pattern!.kind]!; return { concept, subtype, a_ms: s.start_ms, b_ms: s.end_ms, q: s.pattern!.strength }; });
    const requests = external.length ? resolveRequests(rows.headMs, songMs, external, band, models.manifest.calibration, await loadScopes(models)) : [];
    const lnMode = request.controls?.long_notes ?? 0, lnFraction = lnMode === 1 ? 0 : lnMode === 2 ? 0.5 : 1;
    seconds.prior = (performance.now() - start) / 1000;
    start = performance.now();
    const run = async (multiplier: number, pass: number) => {
        random.reset(r2Seed32);
        const target = kappaTargets(prediction, lnFraction, multiplier);
        await trace?.(`r2_pass_${pass}/target`, { values: target, multiplier, kappa: [3, 3, 3] });
        return arrange(models, rows.headMs, songMs, grid, random, { target, lnFraction, requests, masks: models.manifest.calibration.masks[String(band)], prefix: `r2_pass_${pass}`, trace });
    };
    const { result, multiplier, info } = await difficultyPasses(run, models.manifest.calibration, band, models.manifest.system.default_q[String(band)], Math.exp(prediction.log_r));
    seconds.arrangement = (performance.now() - start) / 1000;
    await trace?.('system/arrangement', result);
    progress(GenerationPhase.EXPORT);
    start = performance.now();
    const chart = chartFromDecisions(rows.headMs, songMs, result.actions, result.gap);
    validateChart(chart);
    const setting = (options.setting ?? 'r2').replace(/[^A-Za-z0-9_-]/g, '-'), title = request.title ?? 'Ensomi', artist = request.artist ?? 'Unknown', name = audioFilename(options.audio?.name ?? request.audio?.local_path ?? request.audio?.uri ?? 'audio.wav'), bookmarks = requests.flatMap(r => [r.a_ms, r.b_ms]);
    const osu = osuText(chart, corrected, { title, artist, setting, seed, audioName: name, bookmarks, randomAlgorithm: random.algorithm });
    const held = result.chart.held.slice(0, rows.headMs.length).flat(), heads = result.chart.attack.slice(0, rows.headMs.length).flat(), lnHeads = result.chart.lnHead.slice(0, rows.headMs.length).flat();
    const detail = { runtime: { name: '@ensomi/runtime', version: '0.1.0', random_algorithm: random.algorithm, seed32, r2_seed32: r2Seed32 }, audio: request.audio ?? null, star: request.star, band, seed, setting, metadata: { title, artist }, rows: { request: rows.request, sections: sections.filter(s => s.star !== undefined), K: rows.headMs.length, dropped_close_heads: rows.dropped, segments: corrected.map(s => [s.offset_ms, s.beat_length_ms, 4]) }, prior: { method: models.manifest.prior.method, features: Object.fromEntries(['log_rows_s', 'log_gap_ms', 'log_wh_s', 'log_bpm'].map((k, i) => [k, priorFeatures[i]])), predicted: prediction }, controls: { ln: { mode: lnFraction === 0 ? 'tap' : lnFraction === 0.5 ? 'half' : 'natural', fraction: lnFraction, natural_held_share: prediction.held, target_held_share: prediction.held * lnFraction, achieved_held_share: held.reduce((a, b) => a + b, 0) / held.length, ln_heads: lnHeads.reduce((a, b) => a + b, 0) }, difficulty: { ...info, default: true }, sections: result.requests }, targets: kappaTargets(prediction, lnFraction, multiplier), achieved: { held_share: held.reduce((a, b) => a + b, 0) / held.length, heads_per_row: heads.reduce((a, b) => a + b, 0) / rows.headMs.length, busy_share: result.chart.busy[rows.headMs.length] / rows.headMs.length, r: result.r }, fallback_count: result.fallbackCount, fallbacks: result.fallbacks, mask_firings_total: Object.fromEntries(['reattack', 'quad', 'jack'].map((k, i) => [k, result.maskFirings[i]])), export: { legal: true, head_rows_equal: true, replay_finalized: result.chart.held[result.chart.held.length - 1].every(x => !x), objects: chart.objects.length, bookmarks_ms: bookmarks }, seconds };
    seconds.export = (performance.now() - start) / 1000;
    seconds.total = (performance.now() - allStart) / 1000;
    const receiptJson = JSON.stringify(detail, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2), receipt = { model_name: models.capabilities.model_name, model_version: models.capabilities.model_version, seed, star: request.star, receipt_json: receiptJson };
    const osz = options.audio ? exportOsz(osu, options.audio, receiptJson) : undefined;
    await trace?.('system/export', { chart, osu, detail });
    return { chart, receipt, osu, ...(osz ? { osz } : {}) };
}
