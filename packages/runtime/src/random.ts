import { f32 } from './math.js';
export interface RandomSource {
    readonly algorithm: string;
    reset(seed: number): void;
    multinomial(probabilities: Float32Array, name: string): number | Promise<number>;
    gumbel(logits: ArrayLike<number>, name: string): number | Promise<number>;
    orientation(name: string): number | Promise<number>;
}
/** Mulberry32; 53-bit uniforms combine two outputs. Seeds are reduced modulo 2^32. */
export class SeededRandom implements RandomSource {
    readonly algorithm = 'mulberry32-u53-v1';
    private state: number;
    constructor(seed = 0) { this.state = seed >>> 0; }
    reset(seed: number) { this.state = seed >>> 0; }
    uint32(): number {
        this.state = (this.state + 0x6d2b79f5) >>> 0;
        let t = this.state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return (t ^ (t >>> 14)) >>> 0;
    }
    uniform(): number { return Math.min(1 - Number.EPSILON / 2, ((this.uint32() >>> 5) * 67108864 + (this.uint32() >>> 6) + 0.5) / 9007199254740992); }
    // Both samplers take the argmax as they draw: the first maximum wins, as in math.argmax.
    multinomial(p: Float32Array, _name: string): number {
        let k = 0, best = -Infinity;
        for (let i = 0; i < p.length; i++) {
            const score = f32(p[i] / f32(-Math.log(this.uniform())));
            if (i === 0 || score > best) {
                k = i;
                best = score;
            }
        }
        return k;
    }
    gumbel(logits: ArrayLike<number>, _name: string): number {
        let k = 0, best = -Infinity;
        for (let i = 0; i < logits.length; i++) {
            const score = logits[i] - Math.log(-Math.log(this.uniform()));
            if (i === 0 || score > best) {
                k = i;
                best = score;
            }
        }
        return k;
    }
    orientation(_name: string): number { return this.uint32() & 1; }
}
