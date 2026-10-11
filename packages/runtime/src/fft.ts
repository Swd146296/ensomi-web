/** Mixed-radix Cooley–Tukey FFT (the release uses lengths 1024 and 960). */
export class FFT {
    readonly radix: number;
    readonly child?: FFT;
    readonly cos: Float64Array;
    readonly sin: Float64Array;
    readonly re: Float64Array;
    readonly im: Float64Array;
    constructor(readonly n: number) {
        let r = 2;
        while (n % r !== 0 && r < n)
            r++;
        this.radix = r;
        if (n > 1)
            this.child = new FFT(n / r);
        this.cos = Float64Array.from({ length: n }, (_, k) => Math.cos(-2 * Math.PI * k / n));
        this.sin = Float64Array.from({ length: n }, (_, k) => Math.sin(-2 * Math.PI * k / n));
        this.re = new Float64Array(n);
        this.im = new Float64Array(n);
    }
    run(input: ArrayLike<number>, offset = 0, stride = 1): void {
        if (this.n === 1) {
            this.re[0] = input[offset];
            this.im[0] = 0;
            return;
        }
        const r = this.radix, m = this.n / r, c = this.child!;
        for (let j = 0; j < r; j++) {
            c.run(input, offset + j * stride, stride * r);
            this.re.set(c.re, j * m);
            this.im.set(c.im, j * m);
        }
        const rr = new Float64Array(r), ii = new Float64Array(r);
        for (let k = 0; k < m; k++) {
            for (let j = 0; j < r; j++) {
                rr[j] = this.re[j * m + k];
                ii[j] = this.im[j * m + k];
            }
            for (let l = 0; l < r; l++) {
                let ar = 0, ai = 0;
                const f = k + l * m;
                for (let j = 0; j < r; j++) {
                    const t = j * f % this.n, co = this.cos[t], si = this.sin[t];
                    ar += rr[j] * co - ii[j] * si;
                    ai += rr[j] * si + ii[j] * co;
                }
                this.re[f] = ar;
                this.im[f] = ai;
            }
        }
    }
}
