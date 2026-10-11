export function difference(actual: ArrayLike<any>, expected: ArrayLike<any>) {
    let max_abs = 0, index = -1, nonfinite_equal = true, sse = 0;
    for (let i = 0; i < expected.length; i++) {
        const a = Number(actual[i]), b = Number(expected[i]);
        if (!Number.isFinite(a) || !Number.isFinite(b)) {
            if (!(Object.is(a, b) || Number.isNaN(a) && Number.isNaN(b)))
                nonfinite_equal = false;
            continue;
        }
        const delta = Math.abs(a - b);
        sse += delta * delta;
        if (delta > max_abs) {
            max_abs = delta;
            index = i;
        }
    }
    return { max_abs, rms: Math.sqrt(sse / expected.length), index, nonfinite_equal, reference: index < 0 ? null : Number(expected[index]), actual: index < 0 ? null : Number(actual[index]), same_length: actual.length === expected.length };
}
export function firstTextDifference(actual: string, expected: string) {
    const a = actual.split('\n'), b = expected.split('\n');
    for (let i = 0; i < Math.max(a.length, b.length); i++)
        if (a[i] !== b[i])
            return { line: i + 1, actual: a[i] ?? null, reference: b[i] ?? null };
    return null;
}
export function parseOsu(text: string) { return text.split('[HitObjects]\n')[1].trim().split('\n').filter(Boolean).map(line => { const p = line.split(','), lane = (Number(p[0]) - 64) / 128, start_ms = Number(p[2]); return Number(p[3]) & 128 ? { lane, start_ms, end_ms: Number(p[5].split(':')[0]) } : { lane, start_ms }; }); }
