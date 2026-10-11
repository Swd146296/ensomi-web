import type { Models } from '../src/models.js';
import type { Recording } from './recording.js';
import { difference } from './compare.js';
export async function networkReplay(recording: Recording, models: Models) {
    const report: Record<string, any> = {};
    for (const call of recording.index.graphs) {
        const feeds = Object.fromEntries(await Promise.all(Object.entries(call.inputs).map(async ([name, id]) => [name, await recording.tensor(id, models.ort)])));
        const start = performance.now(), output = await models.run(call.name, feeds), seconds = (performance.now() - start) / 1000;
        const entry = report[call.name] ??= { calls: 0, seconds: 0, max_abs: 0, outputs: {} };
        entry.calls++;
        entry.seconds += seconds;
        for (const [key, value] of Object.entries(output)) {
            const expected = await recording.get(call.outputs[key]), diff = difference(value.data, expected), old = entry.outputs[key];
            if (!old || diff.max_abs > old.max_abs)
                entry.outputs[key] = { ...diff, scope: call.scope, step: call.step };
            entry.max_abs = Math.max(entry.max_abs, diff.max_abs);
            if (diff.max_abs > 1e-4 || !diff.nonfinite_equal || !diff.same_length)
                throw new Error(JSON.stringify({ stage: 1, graph: call.name, output: key, scope: call.scope, step: call.step, ...diff }));
        }
    }
    return report;
}
