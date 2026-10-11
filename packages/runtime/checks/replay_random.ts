import { argmax, f32 } from '../src/math.js';
import type { RandomSource } from '../src/random.js';
import { Recording, type Draw } from './recording.js';
export class ReplayRandom implements RandomSource {
    readonly algorithm = 'python-recorded-draws';
    position = 0;
    constructor(readonly recording: Recording) { }
    reset(_seed: number) { }
    async draw(name: string, kind: string) {
        const row = this.recording.index.draws[this.position++];
        if (row?.name !== name || row?.kind !== kind)
            throw new Error(JSON.stringify({ stage: 'random replay', draw: this.position - 1, name, kind, expected: row }));
        return { row, values: await this.recording.get(row.values) };
    }
    async check(row: Draw, chosen: number, scores: ArrayLike<number>) {
        if (chosen !== row.chosen) {
            const reference = await this.recording.get(row.scores), old = row.chosen;
            throw new Error(JSON.stringify({ stage: 'sample', name: row.name, kind: row.kind, draw: this.position - 1, reference: old, actual: chosen, original_scores: [Number(reference[old]), Number(reference[chosen])], replay_scores: [scores[old], scores[chosen]], original_margin: Number(reference[old]) - Number(reference[chosen]), replay_margin: scores[chosen] - scores[old] }));
        }
        return chosen;
    }
    async multinomial(probabilities: Float32Array, name: string) {
        const { row, values } = await this.draw(name, 'exponential');
        const scores = probabilities.map((p, i) => f32(p / Number(values[i])));
        return this.check(row, argmax(scores), scores);
    }
    async gumbel(logits: ArrayLike<number>, name: string) {
        const { row, values } = await this.draw(name, 'uniform');
        const scores = Array.from(logits, (p, i) => p - Math.log(-Math.log(Math.max(Number(values[i]), 2.2250738585072014e-308))));
        return this.check(row, argmax(scores), scores);
    }
    async orientation(name: string) { const { row, values } = await this.draw(name, 'orientation'); return this.check(row, Number(values[0]), [0, 0]); }
}
