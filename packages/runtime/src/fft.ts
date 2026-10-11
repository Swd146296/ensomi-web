/** Mixed-radix Cooley–Tukey FFT (the release uses lengths 1024 and 960).
 * Iterative and in place, with the twiddles and summation order of the recursive decimation-in-time form,
 * so its outputs are bit-identical to that form's. */
export class FFT {
    readonly re: Float64Array;
    readonly im: Float64Array;
    /** Input index read into each position before the first stage. */
    private readonly order: Int32Array;
    /** Stages from the smallest transforms up: size, radix and that size's twiddles; for radices above 2, also the
     * twiddle of each output l and term j of butterfly k, at ((k * r + l) * r + j). */
    private readonly stages: { n: number; r: number; cos: Float64Array; sin: Float64Array; wcos: Float64Array; wsin: Float64Array }[] = [];
    private readonly rr: Float64Array;
    private readonly ii: Float64Array;
    constructor(readonly n: number) {
        this.re = new Float64Array(n);
        this.im = new Float64Array(n);
        this.order = new Int32Array(n);
        const radix = (size: number) => { let r = 2; while (size % r !== 0 && r < size) r++; return r; };
        const fill = (size: number, offset: number, stride: number, at: number) => {
            if (size === 1) {
                this.order[at] = offset;
                return;
            }
            const r = radix(size), m = size / r;
            for (let j = 0; j < r; j++)
                fill(m, offset + j * stride, stride * r, at + j * m);
        };
        fill(n, 0, 1, 0);
        for (let size = n; size > 1; size /= radix(size)) {
            const r = radix(size), m = size / r, cos = Float64Array.from({ length: size }, (_, k) => Math.cos(-2 * Math.PI * k / size)), sin = Float64Array.from({ length: size }, (_, k) => Math.sin(-2 * Math.PI * k / size));
            const wcos = new Float64Array(r > 2 ? m * r * r : 0), wsin = new Float64Array(wcos.length);
            for (let k = 0, w = 0; w < wcos.length; k++)
                for (let l = 0; l < r; l++)
                    for (let j = 0; j < r; j++, w++) {
                        const t = j * (k + l * m) % size;
                        wcos[w] = cos[t];
                        wsin[w] = sin[t];
                    }
            this.stages.unshift({ n: size, r, cos, sin, wcos, wsin });
        }
        const maxRadix = Math.max(1, ...this.stages.map(s => s.r));
        this.rr = new Float64Array(maxRadix);
        this.ii = new Float64Array(maxRadix);
    }
    run(input: ArrayLike<number>): void {
        const { re, im, order, rr, ii } = this, N = this.n;
        for (let i = 0; i < N; i++) {
            re[i] = input[order[i]];
            im[i] = 0;
        }
        for (const { n, r, cos, sin, wcos, wsin } of this.stages) {
            const m = n / r;
            for (let base = 0; base < N; base += n) {
                if (r === 2) {
                    // The j = 0 term has twiddle (1, -0): it contributes 0 + x exactly.
                    for (let k = 0; k < m; k++) {
                        const p = base + k, q = p + m, a = 0 + re[p], b = 0 + im[p], c = re[q], d = im[q];
                        re[p] = a + (c * cos[k] - d * sin[k]);
                        im[p] = b + (c * sin[k] + d * cos[k]);
                        re[q] = a + (c * cos[k + m] - d * sin[k + m]);
                        im[q] = b + (c * sin[k + m] + d * cos[k + m]);
                    }
                    continue;
                }
                for (let k = 0, w = 0; k < m; k++) {
                    for (let j = 0; j < r; j++) {
                        rr[j] = re[base + j * m + k];
                        ii[j] = im[base + j * m + k];
                    }
                    for (let l = 0; l < r; l++) {
                        let ar = 0, ai = 0;
                        for (let j = 0; j < r; j++, w++) {
                            ar += rr[j] * wcos[w] - ii[j] * wsin[w];
                            ai += rr[j] * wsin[w] + ii[j] * wcos[w];
                        }
                        re[base + k + l * m] = ar;
                        im[base + k + l * m] = ai;
                    }
                }
            }
        }
    }
}
