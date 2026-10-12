// Long-note ends against the next head in the same lane, in charts this runtime generates for the four release songs
// (recorded release PCM, seeds 0-4, default controls) and in the Python release charts. Counts tails later than the
// next head (a chart error), tails at the same millisecond, and gaps smaller than the inspector's drawn head height at
// each visual speed (also 120 px/s, the slowest speed before 2026-10-12), gaps in which the inspector's tail cap reaches
// into the next head with the tail at its end time and at the shortened tail time, and the gaps in beats.
//
// Run from packages/runtime: node --import tsx checks/ln-gaps.mjs   writes artifacts/ln-gaps.json
// Reads what checks/same-as-ts.mjs reads (ENSOMI_MODEL_DIR and ENSOMI_REFERENCE_DIR override).
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import * as ort from 'onnxruntime-web/wasm';
import { loadModels, generateChart } from '@ensomi/runtime';
import { Recording, parseOsu } from '../../../../ensomi-runtime/js/checks/recording.mjs';
import { NOTE_HEIGHT, TAIL_HEIGHT, TAIL_SHORTEN_MS, VISUAL_SPEEDS, tailTime } from '../../../site/player.ts';

const runtime = resolve(import.meta.dirname, '..'), modelRepo = resolve(runtime, '../../../ensomi-model');
const modelDir = process.env.ENSOMI_MODEL_DIR ?? join(modelRepo, 'artifacts/release-r2/bulk/hf/ensomi-r2');
const referenceDir = process.env.ENSOMI_REFERENCE_DIR ?? join(modelRepo, 'artifacts/runtime-ref');
const songs = ['hesitation-snow', 'saigetsu', 'catch-the-moment', 'adventure'], seeds = [0, 1, 2, 3, 4], speeds = [120, ...VISUAL_SPEEDS];

/** Each long note's end against the next head in its lane: gap in ms and in beats of the segment it ends in. */
function gaps(objects, segments) {
    const out = [];
    for (const [i, o] of objects.entries()) {
        if (o.end_ms === undefined) continue;
        const next = objects.slice(i + 1).find(n => n.lane === o.lane);
        if (!next) continue;
        const beat = segments.findLast(s => s[0] <= o.end_ms)?.[1] ?? segments[0][1];
        out.push({ ms: next.start_ms - o.end_ms, drawnMs: next.start_ms - tailTime(o.start_ms, o.end_ms), beats: (next.start_ms - o.end_ms) / beat });
    }
    return out;
}
function summary(all) {
    const ms = all.map(g => g.ms).sort((a, b) => a - b), beats = {};
    for (const g of all) {
        // The smallest grid division the gap is a whole multiple of (whole-millisecond times move it by under 0.05).
        const d = [1, 2, 3, 4, 6, 8, 12, 16].find(d => Math.abs(g.beats * d - Math.round(g.beats * d)) < 0.05);
        const key = g.beats <= 0 ? '0 or less' : g.beats > 0.95 ? '1 or more' : d ? `${Math.round(g.beats * d)}/${d}` : 'other';
        beats[key] = (beats[key] ?? 0) + 1;
    }
    return {
        longNotesWithNextHead: all.length,
        tailAfterNextHead: ms.filter(x => x < 0).length,
        tailAtNextHead: ms.filter(x => x === 0).length,
        underHeadHeight: Object.fromEntries(speeds.map(v => [`${v} px/s (< ${(NOTE_HEIGHT / v * 1000).toFixed(1)} ms)`, ms.filter(x => x * v / 1000 < NOTE_HEIGHT).length])),
        // The tail cap reaches into the next head: their centres are closer than half of both heights.
        capInHead: Object.fromEntries(speeds.map(v => [`${v} px/s`, {
            atEnd: all.filter(g => g.ms * v / 1000 < (NOTE_HEIGHT + TAIL_HEIGHT) / 2).length,
            shortened: all.filter(g => g.drawnMs * v / 1000 < (NOTE_HEIGHT + TAIL_HEIGHT) / 2).length,
        }])),
        smallestMs: ms.slice(0, 5),
        gapInBeats: beats,
    };
}

const report = { headHeightPx: NOTE_HEIGHT, tailHeightPx: TAIL_HEIGHT, tailShortenMs: TAIL_SHORTEN_MS, speeds, seeds, generated: {}, python: {} };
const read = async (p) => new Uint8Array(await readFile(join(modelDir, 'onnx', p)));
const models = await loadModels(read, { ort, backend: 'wasm', wasm: { numThreads: 1 } });
const generated = [], python = [];
try {
    for (const song of songs) {
        const recording = await Recording.open(join(referenceDir, 'bulk', song));
        const audio = await recording.event('audio');
        const pcm = { samples: audio.pcm, channels: recording.shape(recording.index.events.find(e => e.name === 'audio').arrays.pcm)[1] ?? 1, mel: audio.mel_pcm }, sampleRate = Number(audio.sample_rate[0]);
        await recording.close();
        const reference = join(referenceDir, 'bulk', song, 'reference'), receipt = JSON.parse(await readFile(join(reference, 'receipt.json'), 'utf8'));
        const pythonGaps = gaps(parseOsu(await readFile(join(reference, 'generated.osu'), 'utf8')), receipt.rows.segments);
        python.push(...pythonGaps);
        report.python[song] = summary(pythonGaps);
        report.generated[song] = [];
        for (const seed of seeds) {
            const result = await generateChart(models, pcm, sampleRate, { star: receipt.star, seed, audio: { asset_id: song } });
            const songGaps = gaps(result.chart.objects, JSON.parse(result.receipt.receipt_json).rows.segments);
            generated.push(...songGaps);
            report.generated[song].push({ seed, ...summary(songGaps) });
            console.log(song, seed, JSON.stringify(summary(songGaps)));
        }
    }
    report.generatedTotal = summary(generated);
    report.pythonTotal = summary(python);
    console.log('generated', JSON.stringify(report.generatedTotal), '\npython', JSON.stringify(report.pythonTotal));
}
finally {
    await models.dispose();
    await writeFile(join(runtime, 'artifacts/ln-gaps.json'), JSON.stringify(report, null, 2) + '\n');
}
