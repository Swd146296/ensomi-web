import { argmax, round } from './math.js';
import type { TimingSegment } from './fitter/types.js';
export function canonicalLength(length: number): number { const bpm = 60000 / length, fold = Math.ceil(Math.log2(80 / bpm)); return length / 2 ** fold; }
/** audio_rows/grid.corrected_grid: chart clock, longest-tempo collapse and 80/160 boundary. */
export function correctedGrid(segments: TimingSegment[], songMs: number): TimingSegment[] {
    let sorted = segments.slice().sort((a, b) => a.offset_ms - b.offset_ms).map(s => ({ ...s, offset_ms: s.offset_ms - 30 }));
    const ends = sorted.map((s, i) => sorted[i + 1]?.offset_ms ?? Math.max(songMs, s.offset_ms + 1));
    const longest = argmax(sorted.map((s, i) => ends[i] - s.offset_ms));
    const canonical = sorted.map(s => canonicalLength(s.beat_length_ms)), aligned = canonical.map(x => x * 2 ** round(Math.log2(canonical[longest] / x)));
    if (aligned.every(x => Math.abs(x / aligned[longest] - 1) < 0.003)) {
        let { offset_ms: offset, beat_length_ms: length } = sorted[longest];
        const bpm = 60000 / length;
        if (Math.abs(bpm - round(bpm)) <= 0.25) {
            const next = 60000 / round(bpm);
            offset += round((ends[longest] - offset) / (2 * length)) * (length - next);
            length = next;
        }
        sorted = [{ offset_ms: offset, beat_length_ms: length }];
    }
    return sorted.map(s => { let length = canonicalLength(s.beat_length_ms); const bpm = 60000 / length; if (Math.abs(bpm / 80 - 1) < 0.003 || Math.abs(bpm / 160 - 1) < 0.003)
        length = 750; return { offset_ms: s.offset_ms, beat_length_ms: length }; });
}
export class Grid {
    readonly offsets: number[];
    readonly lengths: number[];
    readonly origins: number[];
    readonly meters: number[];
    constructor(segments: TimingSegment[]) {
        this.offsets = segments.map(s => s.offset_ms);
        this.lengths = segments.map(s => canonicalLength(s.beat_length_ms));
        this.meters = segments.map(() => 4);
        this.origins = [0];
        for (let i = 1; i < segments.length; i++)
            this.origins.push(this.origins[i - 1] + (this.offsets[i] - this.offsets[i - 1]) / this.lengths[i - 1]);
    }
    private index(values: number[], x: number) { let l = 0, r = values.length; while (l < r) {
        const m = (l + r) >>> 1;
        if (values[m] <= x)
            l = m + 1;
        else
            r = m;
    } return Math.max(0, l - 1); }
    segment(time: number) { return this.index(this.offsets, time); }
    beat(time: number) { const s = this.segment(time); return this.origins[s] + (time - this.offsets[s]) / this.lengths[s]; }
    time(beat: number) { const s = this.index(this.origins, beat); return this.offsets[s] + (beat - this.origins[s]) * this.lengths[s]; }
    bpm(time: number) { return 60000 / this.lengths[this.segment(time)]; }
    meter(time: number) { return this.meters[this.segment(time)]; }
    localBeat(time: number) { const s = this.segment(time); return (time - this.offsets[s]) / this.lengths[s]; }
}
