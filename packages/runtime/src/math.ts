export const f32 = Math.fround;
export const sum = (a: ArrayLike<number>) => { let s = 0; for (let i = 0; i < a.length; i++)
    s += a[i]; return s; };
export const mean = (a: ArrayLike<number>) => sum(a) / a.length;
export const norm = (a: ArrayLike<number>) => Math.sqrt(Array.from(a, x => x * x).reduce((a, b) => a + b, 0));
export function median(a: ArrayLike<number>) { const s = Array.from(a).sort((a, b) => a - b), n = s.length; return n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2; }
export function quantile(a: ArrayLike<number>, q: number) { const s = Array.from(a).sort((a, b) => a - b), i = (s.length - 1) * q, j = Math.floor(i); return s[j] + (s[Math.min(j + 1, s.length - 1)] - s[j]) * (i - j); }
export const mod = (x: number, p: number) => ((x % p) + p) % p;
export function round(x: number) { const lo = Math.floor(x), d = x - lo; return d === 0.5 ? lo + (lo % 2 === 0 ? 0 : 1) : Math.round(x); }
export const clip = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
export function argmax(a: ArrayLike<number>) { let k = 0; for (let i = 1; i < a.length; i++)
    if (a[i] > a[k])
        k = i; return k; }
export function lowerBound(a: ArrayLike<number>, x: number) { let l = 0, r = a.length; while (l < r) {
    const m = (l + r) >>> 1;
    if (a[m] < x)
        l = m + 1;
    else
        r = m;
} return l; }
export function interp(x: number, xp: ArrayLike<number>, fp: ArrayLike<number>) { const i = lowerBound(xp, x); if (i === 0)
    return fp[0]; if (i === xp.length)
    return fp[i - 1]; return fp[i - 1] + (fp[i] - fp[i - 1]) * (x - xp[i - 1]) / (xp[i] - xp[i - 1]); }
export function line(x: number[], y: number[], weights?: number[]): [
    number,
    number
] {
    let sw = 0, sx = 0, sy = 0;
    for (let i = 0; i < x.length; i++) {
        const w = weights?.[i] ?? 1;
        sw += w;
        sx += w * x[i];
        sy += w * y[i];
    }
    const mx = sx / sw, my = sy / sw;
    let xx = 0, xy = 0;
    for (let i = 0; i < x.length; i++) {
        const w = weights?.[i] ?? 1;
        xx += w * (x[i] - mx) ** 2;
        xy += w * (x[i] - mx) * (y[i] - my);
    }
    const b = xy / xx;
    return [my - b * mx, b];
}
/** Round through IEEE binary16, matching the feature cache. */
export function half(x: number): number {
    const sign = x < 0 ? -1 : 1, a = Math.abs(x);
    if (a === 0)
        return x;
    if (a < 2 ** -14)
        return sign * round(a / 2 ** -24) * 2 ** -24;
    const e = Math.floor(Math.log2(a));
    return sign * round(a / 2 ** (e - 10)) * 2 ** (e - 10);
}
