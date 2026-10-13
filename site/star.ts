import type { ChartObject } from '@ensomi/runtime';

const SECTION_MS = 400, DECAY_WEIGHT = 0.9, INDIVIDUAL_DECAY = 0.125, OVERALL_DECAY = 0.3, RELEASE_THRESHOLD = 30, MULTIPLIER = 0.018;

interface Raw { start: number; end: number; column: number }
interface Note extends Raw { delta: number; columnDelta: number; previous: (Note | undefined)[] }

const bigger = (a: number, b: number) => a - 1 > b;
const decay = (value: number, ms: number, base: number) => value * Math.pow(base, ms / 1000);
/** .NET's Math.Round: a half goes to the even neighbour. */
function roundEven(x: number) {
    const r = Math.round(x);
    return r - x === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

/** osu!mania star rating at clock rate 1, as osu!lazer and the osu! website compute it: ppy/osu's
 * ManiaDifficultyCalculator, version 20241007, deployed 2024-10-28 and unchanged since. A port of
 * `compute_mania_star_rating_20241007` in ensomi-model's `src/ensomi_model/osu_core/difficulty.py` (commit 9731543),
 * the calculator that defines the star the model is asked for. */
export function maniaStar(objects: ChartObject[], columns = 4) {
    const raw: Raw[] = objects.map(o => ({ start: o.start_ms, end: o.end_ms ?? o.start_ms, column: o.lane }));
    legacySort(raw, (a, b) => roundEven(a.start) - roundEven(b.start));
    // The first object only gives the second its delta.
    const notes: Note[] = [], lastInColumn: (Note | undefined)[] = new Array(columns).fill(undefined);
    for (let i = 1; i < raw.length; i++) {
        const o = raw[i], prev = notes.at(-1), inColumn = lastInColumn[o.column];
        const previous = prev ? prev.previous.slice() : new Array(columns).fill(undefined);
        if (prev) previous[prev.column] = prev;
        const note = { ...o, delta: o.start - raw[i - 1].start, columnDelta: inColumn ? o.start - inColumn.start : o.start, previous };
        notes.push(note);
        lastInColumn[o.column] = note;
    }

    const individual = new Array<number>(columns).fill(0), peaks: number[] = [];
    let highest = 0, overall = 1, peak = 0, sectionEnd = 0;
    notes.forEach((note, i) => {
        if (i === 0) sectionEnd = Math.ceil(note.start / SECTION_MS) * SECTION_MS;
        while (note.start > sectionEnd) {
            peaks.push(peak);
            // A section opens with the strain decayed from the previous note; the first note lies in its own first section.
            const ms = sectionEnd - notes[i - 1].start;
            peak = decay(highest, ms, INDIVIDUAL_DECAY) + decay(overall, ms, OVERALL_DECAY);
            sectionEnd += SECTION_MS;
        }
        individual[note.column] = decay(individual[note.column], note.columnDelta, INDIVIDUAL_DECAY) + individualStrain(note);
        highest = note.delta <= 1 ? Math.max(highest, individual[note.column]) : individual[note.column];
        overall = decay(overall, note.delta, OVERALL_DECAY) + overallStrain(note);
        peak = Math.max(peak, highest + overall);
    });
    peaks.push(peak);

    let difficulty = 0, weight = 1;
    for (const strain of peaks.filter(p => p > 0).sort((a, b) => b - a)) {
        difficulty += strain * weight;
        weight *= DECAY_WEIGHT;
    }
    return difficulty * MULTIPLIER;
}

function individualStrain(note: Note) {
    const held = note.previous.some(p => p && bigger(p.end, note.end) && bigger(note.start, p.start));
    return 2 * (held ? 1.25 : 1);
}

function overallStrain(note: Note) {
    let overlapping = false, closestEnd = Math.abs(note.end - note.start), holdFactor = 1;
    for (const p of note.previous) {
        if (!p) continue;
        overlapping ||= bigger(p.end, note.start) && bigger(note.end, p.end) && bigger(note.start, p.start);
        if (bigger(p.end, note.end) && bigger(note.start, p.start)) holdFactor = 1.25;
        closestEnd = Math.min(closestEnd, Math.abs(note.end - p.end));
    }
    const holdAddition = overlapping ? 1 / (1 + Math.exp(0.27 * (RELEASE_THRESHOLD - closestEnd))) : 0;
    return (1 + holdAddition) * holdFactor;
}

/** osu!'s LegacySortHelper: .NET Framework's unstable introsort, which orders notes on one millisecond as osu! does. */
function legacySort<T>(keys: T[], compare: (a: T, b: T) => number) {
    if (keys.length) quickSort(keys, 0, keys.length - 1, compare, 32);
}

function swap<T>(keys: T[], i: number, j: number) {
    if (i !== j) [keys[i], keys[j]] = [keys[j], keys[i]];
}

function swapIfGreater<T>(keys: T[], compare: (a: T, b: T) => number, a: number, b: number) {
    if (a !== b && compare(keys[a], keys[b]) > 0) swap(keys, a, b);
}

function quickSort<T>(keys: T[], left: number, right: number, compare: (a: T, b: T) => number, depth: number) {
    while (left < right) {
        if (depth === 0) return heapSort(keys, left, right, compare);
        let i = left, j = right;
        const middle = i + ((j - i) >> 1);
        swapIfGreater(keys, compare, i, middle);
        swapIfGreater(keys, compare, i, j);
        swapIfGreater(keys, compare, middle, j);
        const x = keys[middle];
        while (i <= j) {
            while (compare(keys[i], x) < 0) i++;
            while (compare(x, keys[j]) < 0) j--;
            if (i > j) break;
            swap(keys, i, j);
            i++;
            j--;
        }
        depth--;
        if (j - left <= right - i) {
            if (left < j) quickSort(keys, left, j, compare, depth);
            left = i;
        }
        else {
            if (i < right) quickSort(keys, i, right, compare, depth);
            right = j;
        }
    }
}

function heapSort<T>(keys: T[], lo: number, hi: number, compare: (a: T, b: T) => number) {
    const n = hi - lo + 1;
    for (let i = n >> 1; i >= 1; i--) downHeap(keys, i, n, lo, compare);
    for (let i = n; i > 1; i--) {
        swap(keys, lo, lo + i - 1);
        downHeap(keys, 1, i - 1, lo, compare);
    }
}

function downHeap<T>(keys: T[], i: number, n: number, lo: number, compare: (a: T, b: T) => number) {
    const d = keys[lo + i - 1];
    while (i <= n >> 1) {
        let child = 2 * i;
        if (child < n && compare(keys[lo + child - 1], keys[lo + child]) < 0) child++;
        if (!(compare(d, keys[lo + child - 1]) < 0)) break;
        keys[lo + i - 1] = keys[lo + child - 1];
        i = child;
    }
    keys[lo + i - 1] = d;
}
