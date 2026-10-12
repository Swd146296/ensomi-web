import type { Chart } from '../packages/runtime/src/index.js';

/**
 * Live chart inspector modelled on Beatmap Lens's falling-note viewport: chart time is the audio
 * element's clock with no offset, notes fall to a judgement line at 82% of the height, a click
 * seeks to the time under the pointer, a drag scrubs, the wheel and Up/Down navigate, and a
 * vertical overview (bottom = song start) shows note density, the visible window and the playhead.
 */
export const VISUAL_SPEEDS = [240, 480, 720, 960];
export const RATES = [0.5, 0.75, 1, 1.25, 1.5];
const JUDGE = 0.82, ARROW_STEP_PX = 40, DENSITY_BINS = 256;
/** Drawn heights in px of a note head and of a long note's tail cap, each centred on its time. */
export const NOTE_HEIGHT = 14, TAIL_HEIGHT = 6;
/**
 * A long note's tail cap and body end are drawn TAIL_SHORTEN_MS before its end time, but not before its head, so that a
 * tail close before the next head in its lane leaves a gap. Drawing only: the chart, the .osu and judgement keep the end
 * time. osu!lazer, osu!stable and Quaver draw the tail at the end time; Etterna's noteskins stop the hold body short of
 * the tail by a pixel offset. The rule is a time so that any renderer can apply it before mapping time to position.
 */
export const TAIL_SHORTEN_MS = 10;
export const tailTime = (start: number, end: number) => Math.max(start, end - TAIL_SHORTEN_MS);
const color = {
    ground: '#130e1a', laneA: '#1d1627', laneB: '#191220', beat: 'rgba(181, 179, 239, 0.12)', bar: 'rgba(181, 179, 239, 0.32)',
    tap: '#eaa0b7', hold: '#b5b3ef', holdBody: 'rgba(181, 179, 239, 0.42)', judge: '#ff879f', glow: 'rgba(255, 135, 159, 0.28)',
    section: 'rgba(149, 98, 215, 0.16)', sectionEdge: '#9562d7', density: 'rgba(181, 179, 239, 0.6)', window: 'rgba(255, 135, 159, 0.16)',
};

export interface Track {
    chart: Chart;
    /** Timing segments as written to the .osu: offset ms, beat length ms, meter. */
    segments: number[][];
    sections: { start_ms: number; end_ms: number }[];
}

function fit(canvas: HTMLCanvasElement) {
    const ratio = devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(h * ratio)) {
        canvas.width = Math.round(w * ratio);
        canvas.height = Math.round(h * ratio);
    }
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { ctx, w, h };
}

/** First index whose value is at least x. */
function lowerBound(values: number[], x: number) {
    let l = 0, r = values.length;
    while (l < r) {
        const m = (l + r) >>> 1;
        if (values[m] < x) l = m + 1;
        else r = m;
    }
    return l;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);

export class Player {
    speed = 720;
    private track?: Track;
    private starts: number[] = [];
    private longest = 0;
    private beats: number[] = [];
    private bars: boolean[] = [];
    private density: number[] = [];
    private drag?: { id: number; startY: number; startMs: number; moved: boolean };

    constructor(private lanes: HTMLCanvasElement, private overview: HTMLCanvasElement, readonly audio: HTMLAudioElement, private onFrame: (ms: number) => void) {
        audio.preservesPitch = true;
        lanes.addEventListener('pointerdown', e => {
            if (e.button !== 0 || !this.track) return;
            e.preventDefault();
            lanes.focus({ preventScroll: true });
            lanes.setPointerCapture(e.pointerId);
            this.drag = { id: e.pointerId, startY: e.clientY, startMs: this.time, moved: false };
        });
        lanes.addEventListener('pointermove', e => {
            const drag = this.drag;
            if (!drag || drag.id !== e.pointerId) return;
            drag.moved ||= Math.abs(e.clientY - drag.startY) >= 2;
            if (drag.moved) this.seek(drag.startMs + (drag.startY - e.clientY) / this.speed * 1000);
        });
        lanes.addEventListener('pointerup', e => {
            const drag = this.drag;
            if (!drag || drag.id !== e.pointerId) return;
            this.drag = undefined;
            if (!drag.moved) {
                const judge = lanes.getBoundingClientRect().top + lanes.clientHeight * JUDGE;
                this.seek(drag.startMs + (judge - e.clientY) / this.speed * 1000);
            }
        });
        lanes.addEventListener('pointercancel', () => { this.drag = undefined; });
        lanes.addEventListener('wheel', e => {
            if (!this.track || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || !e.deltaY) return;
            e.preventDefault();
            const pixels = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * lanes.clientHeight : e.deltaY;
            this.seek(this.time - pixels / this.speed * 1000);
        }, { passive: false });
        lanes.addEventListener('keydown', e => {
            if (!this.track || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
            e.preventDefault();
            this.seek(this.time + (e.key === 'ArrowUp' ? 1 : -1) * ARROW_STEP_PX / this.speed * 1000);
        });
        const overviewSeek = (e: PointerEvent) => {
            const rect = overview.getBoundingClientRect();
            this.seek((1 - (e.clientY - rect.top) / rect.height) * this.duration);
        };
        overview.addEventListener('pointerdown', e => {
            if (e.button !== 0 || !this.track) return;
            overview.setPointerCapture(e.pointerId);
            overviewSeek(e);
        });
        overview.addEventListener('pointermove', e => { if (overview.hasPointerCapture(e.pointerId)) overviewSeek(e); });
        requestAnimationFrame(this.frame);
    }

    get duration() { return this.track?.chart.duration_ms ?? 0; }
    get time() { return this.audio.currentTime * 1000; }
    seek(ms: number) { this.audio.currentTime = clamp(ms, 0, this.duration) / 1000; }
    toggle() {
        if (this.audio.paused) void this.audio.play();
        else this.audio.pause();
    }

    load(track: Track) {
        this.track = track;
        const objects = track.chart.objects, end = track.chart.duration_ms;
        this.starts = objects.map(o => o.start_ms);
        this.longest = Math.max(0, ...objects.map(o => (o.end_ms ?? o.start_ms) - o.start_ms));
        // Beat and bar lines from the timing points; the first segment also extends back to 0.
        this.beats = [];
        this.bars = [];
        track.segments.forEach(([offset, length, meter], i) => {
            const until = track.segments[i + 1]?.[0] ?? end;
            for (let k = i === 0 ? -Math.floor(offset / length) : 0; offset + k * length < until; k++) {
                this.beats.push(offset + k * length);
                this.bars.push(((k % meter) + meter) % meter === 0);
            }
        });
        this.density = new Array(DENSITY_BINS).fill(0);
        for (const o of objects) this.density[Math.min(DENSITY_BINS - 1, Math.floor(o.start_ms / end * DENSITY_BINS))]++;
        this.audio.pause();
        this.seek(0);
    }

    private frame = () => {
        requestAnimationFrame(this.frame);
        if (!this.track || !this.lanes.clientHeight) return;
        const now = this.time;
        this.drawLanes(now);
        this.drawOverview(now);
        this.onFrame(now);
    };

    private drawLanes(now: number) {
        const { ctx, w, h } = fit(this.lanes), pps = this.speed / 1000, judge = h * JUDGE, objects = this.track!.chart.objects;
        const y = (t: number) => judge - (t - now) * pps, lo = now - (h - judge) / pps, hi = now + judge / pps;
        const laneW = Math.min(80, (w - 32) / 4), x0 = (w - 4 * laneW) / 2, width = 4 * laneW;
        ctx.fillStyle = color.ground;
        ctx.fillRect(0, 0, w, h);
        for (let lane = 0; lane < 4; lane++) {
            ctx.fillStyle = lane % 2 ? color.laneB : color.laneA;
            ctx.fillRect(x0 + lane * laneW, 0, laneW, h);
        }
        for (const s of this.track!.sections) {
            if (s.end_ms < lo || s.start_ms > hi) continue;
            const top = y(s.end_ms), bottom = y(s.start_ms);
            ctx.fillStyle = color.section;
            ctx.fillRect(x0, top, width, bottom - top);
            ctx.fillStyle = color.sectionEdge;
            ctx.fillRect(x0 - 8, top, 4, bottom - top);
        }
        for (let i = lowerBound(this.beats, lo); i < this.beats.length && this.beats[i] <= hi; i++) {
            ctx.fillStyle = this.bars[i] ? color.bar : color.beat;
            ctx.fillRect(x0, Math.round(y(this.beats[i])), width, 1);
        }
        const lit = [false, false, false, false];
        for (let i = lowerBound(this.starts, lo - this.longest); i < objects.length && objects[i].start_ms <= hi; i++) {
            const o = objects[i], x = x0 + o.lane * laneW + 4, nw = laneW - 8, head = y(o.start_ms);
            if (o.start_ms <= now && (now - o.start_ms < 90 || (o.end_ms ?? 0) >= now)) lit[o.lane] = true;
            if (o.end_ms === undefined) {
                if (o.start_ms < lo) continue;
                ctx.fillStyle = color.tap;
                ctx.beginPath();
                ctx.roundRect(x, head - NOTE_HEIGHT / 2, nw, NOTE_HEIGHT, NOTE_HEIGHT / 2);
                ctx.fill();
                continue;
            }
            if (o.end_ms < lo) continue;
            const tail = y(tailTime(o.start_ms, o.end_ms));
            ctx.fillStyle = color.holdBody;
            ctx.beginPath();
            ctx.roundRect(x + nw * 0.14, tail, nw * 0.72, head - tail, 6);
            ctx.fill();
            ctx.fillStyle = color.hold;
            ctx.beginPath();
            ctx.roundRect(x, head - NOTE_HEIGHT / 2, nw, NOTE_HEIGHT, NOTE_HEIGHT / 2);
            ctx.roundRect(x + nw * 0.14, tail - TAIL_HEIGHT / 2, nw * 0.72, TAIL_HEIGHT, TAIL_HEIGHT / 2);
            ctx.fill();
        }
        ctx.fillStyle = color.glow;
        lit.forEach((on, lane) => { if (on) ctx.fillRect(x0 + lane * laneW, judge - 26, laneW, 26); });
        ctx.fillStyle = color.judge;
        ctx.fillRect(0, judge - 1.5, w, 3);
    }

    private drawOverview(now: number) {
        const { ctx, w, h } = fit(this.overview), end = this.duration, Y = (t: number) => h - t / end * h;
        ctx.fillStyle = color.ground;
        ctx.fillRect(0, 0, w, h);
        for (const s of this.track!.sections) {
            ctx.fillStyle = color.section;
            ctx.fillRect(0, Y(s.end_ms), w, Y(s.start_ms) - Y(s.end_ms));
        }
        const peak = Math.max(1, ...this.density), bin = h / DENSITY_BINS;
        ctx.fillStyle = color.density;
        this.density.forEach((count, i) => { if (count) ctx.fillRect(4, h - (i + 1) * bin, (w - 8) * count / peak, bin + 0.5); });
        const viewHeight = this.lanes.clientHeight / this.speed * 1000, top = Y(now + viewHeight * JUDGE), bottom = Y(now - viewHeight * (1 - JUDGE));
        ctx.fillStyle = color.window;
        ctx.fillRect(0, top, w, bottom - top);
        ctx.fillStyle = color.judge;
        ctx.fillRect(0, Y(now) - 1, w, 2);
    }
}
