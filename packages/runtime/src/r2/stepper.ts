import type { Models } from '../models.js';
import type { Tensor } from 'onnxruntime-web';
import { ChartState, queryFeatures, historyToken, releaseFactor, type Candidates } from './features.js';
export class R2Stepper {
    state: Record<string, Tensor> = {};
    constructor(readonly models: Models) { }
    async initialize() { for (const [name, spec] of Object.entries(this.models.manifest.state.r2_initial))
        this.state[name] = await this.models.tensor(spec); }
    tensor(type: any, data: any, dims: number[]) { return new this.models.ort.Tensor(type, data, dims); }
    async predict(chart: ChartState, k: number) {
        return this.models.run('r2_predict', { last: this.state.last, query: this.tensor('float32', queryFeatures(chart, k), [1, 2, 150]), row_condition: this.tensor('float32', new Float32Array(68), [1, 68]) });
    }
    async release(hands: Tensor, chart: ChartState, k: number, codes: number[], lane: number, orientation: number, placed: Map<number, [
        number,
        boolean
    ]>, candidates: Candidates) {
        const factor = releaseFactor(chart, k, codes, lane, orientation, placed, candidates), n = candidates.times.length;
        const output = await this.models.run('r2_release', { hands, orientation: this.tensor('int64', BigInt64Array.of(BigInt(orientation)), [1]), codes: this.tensor('int64', BigInt64Array.from(factor.codes, BigInt), [1, 4]), slot: this.tensor('int64', BigInt64Array.of(BigInt(factor.slot)), [1]), lane_features: this.tensor('float32', factor.laneFeatures, [1, 15]), relations: this.tensor('float32', factor.relations, [n, 28]), candidates: this.tensor('float32', factor.features, [n, 34]), pair_condition: this.tensor('float32', new Float32Array(n * 68), [n, 68]) });
        return output.release_scores.data as Float32Array;
    }
    async commit(chart: ChartState, k: number) {
        const feeds: Record<string, Tensor> = { history_token: this.tensor('float32', historyToken(chart, k), [2, 100]) };
        for (const spec of this.models.manifest.graphs.r2_commit.inputs)
            if (spec.name !== 'history_token')
                feeds[spec.name] = this.state[spec.name];
        const output = await this.models.run('r2_commit', feeds);
        this.state = Object.fromEntries(Object.entries(this.models.manifest.state.r2_commit_outputs).map(([out, name]) => [name, output[out]]));
    }
}
