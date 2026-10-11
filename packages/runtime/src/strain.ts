// r2/strain.py: frozen ras-v1 workload. Strain continues across section boundaries.
export const REFERENCE_LANES = [0, 2, 1, 3];
const TAU_I = -1 / Math.log(0.125), TAU_G = -1 / Math.log(0.30);
export class StrainState {
    constructor(readonly lane = [0, 0, 0, 0], readonly overall = 0, readonly time_ms = 0) { }
    decayed(time: number) { const dt = (time - this.time_ms) / 1000; return new StrainState(this.lane.map(x => x * Math.exp(-dt / TAU_I)), this.overall * Math.exp(-dt / TAU_G), time); }
    cost(heads: ArrayLike<number | boolean>) { let m = 0, dot = 0; for (let l = 0; l < 4; l++) {
        const q = Number(heads[l]);
        m += q;
        dot += q * this.lane[l];
    } return TAU_I * (dot + m / 2) + 0.25 * TAU_G * (this.overall * m + m * m / 2); }
    append(time: number, heads: ArrayLike<number | boolean>): [
        StrainState,
        number
    ] { const s = this.decayed(time), q = Array.from(heads, Number); return [new StrainState(s.lane.map((x, i) => x + q[i]), s.overall + q.reduce((a, b) => a + b, 0), time), s.cost(q)]; }
}
export function referenceWorkload(heads: ArrayLike<number>) { let state = new StrainState(), sum = 0; for (let i = 0; i < heads.length; i++) {
    const q = [0, 0, 0, 0];
    q[REFERENCE_LANES[i % 4]] = 1;
    const [next, charge] = state.append(heads[i], q);
    state = next;
    sum += charge;
} return sum; }
