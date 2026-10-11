import * as ort from 'onnxruntime-node';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { loadModels, type Ort } from '../src/models.js';
import { Grid, correctedGrid } from '../src/grid.js';
import { rowsFeatures, predictPrior, kappaTargets } from '../src/prior.js';
import { arrange } from '../src/arrange.js';
import { difficultyPasses } from '../src/difficulty.js';
import { Recording } from './recording.js';
import { ReplayRandom } from './replay_random.js';
const root = resolve(process.env.ENSOMI_MODEL_DIR ?? '../../../ensomi-model/artifacts/release-r2/bulk/hf/ensomi-r2');
const refs = resolve(process.env.ENSOMI_REFERENCE_DIR ?? '../../../ensomi-model/artifacts/runtime-ref');
const models = await loadModels(async (p) => new Uint8Array(await readFile(join(root, 'onnx', p))), { ort: ort as unknown as Ort, session: { executionProviders: ['cpu'], intraOpNumThreads: 1, interOpNumThreads: 1 } });
const names = process.argv.slice(2), report: any = {};
try {
    for (const song of names.length ? names : ['hesitation-snow', 'saigetsu', 'catch-the-moment', 'adventure']) {
        const r = await Recording.open(join(refs, 'bulk', song)), rows = JSON.parse(await readFile(`artifacts/bulk/${song}-rows.json`, 'utf8')), receipt = JSON.parse(await readFile(join(root, 'examples', song, 'receipt.json'), 'utf8'));
        const random = new ReplayRandom(r);
        random.position = rows.randomPosition;
        const grid = new Grid(correctedGrid(rows.segments, rows.songMs)), band = Math.min(5, Math.max(2, Math.floor(receipt.star))), features = rowsFeatures(rows.headMs, rows.songMs, grid), prediction = predictPrior(models.manifest.prior, features, band), expectedPrior = await r.event('system/prior');
        console.log(song, 'prior', prediction);
        const start = performance.now();
        try {
            let priorError = 0;
            for (const [key, value] of Object.entries(prediction))
                priorError = Math.max(priorError, Math.abs(value - Number(expectedPrior[key][0])));
            if (priorError > 1e-10)
                throw new Error(JSON.stringify({ stage: 4, song, step: 'prior', prediction, expected: Object.fromEntries(Object.keys(prediction).map(k => [k, Number(expectedPrior[k][0])])) }));
            let chosen = 0;
            const run = async (multiplier: number, pass: number) => {
                console.log(song, `pass ${pass}`, multiplier);
                return arrange(models, rows.headMs, rows.songMs, grid, random, { target: kappaTargets(prediction, 1, multiplier), masks: models.manifest.calibration.masks[String(band)], prefix: `r2_pass_${pass}`, trace: async (name, values) => {
                        if (!name.endsWith('/chosen'))
                            return;
                        const expected = await r.event(name);
                        for (const key of ['codes', 'releases']) {
                            const actual = values[key] as number[];
                            for (let l = 0; l < 4; l++)
                                if (!(actual[l] === Number(expected[key][l]) || Number.isNaN(actual[l]) && Number.isNaN(Number(expected[key][l]))))
                                    throw new Error(JSON.stringify({ stage: 4, song, name, key, lane: l, actual: actual[l], reference: Number(expected[key][l]) }));
                        }
                        chosen++;
                    } });
            };
            const { result, multiplier, info } = await difficultyPasses(run, models.manifest.calibration, band, models.manifest.system.default_q[String(band)], Math.exp(prediction.log_r));
            if (random.position !== r.index.draws.length)
                throw new Error(`Unconsumed draws ${random.position}/${r.index.draws.length}`);
            const seconds = (performance.now() - start) / 1000;
            report[song] = { passed: true, seconds, prior_error: priorError, decisions: chosen, draws: random.position, passes: info.passes, fallbacks: result.fallbackCount };
            await writeFile(`artifacts/bulk/${song}-arrangement.json`, JSON.stringify({ actions: result.actions, gap: result.gap, headMs: rows.headMs, songMs: rows.songMs, segments: correctedGrid(rows.segments, rows.songMs), prediction, multiplier, difficulty: info }) + '\n');
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
            await writeFile('artifacts/arrange.json', JSON.stringify(report, null, 2) + '\n');
        }
    }
}
finally {
    await models.dispose();
}
