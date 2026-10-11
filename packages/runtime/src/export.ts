import { zipSync, strToU8 } from 'fflate';
import { round, clip } from './math.js';
import type { Chart, ChartObject, EncodedAudio } from './types.js';
import type { TimingSegment } from './fitter/types.js';
export function chartFromDecisions(headMs: number[], songMs: number, actions: number[][], gap: number[][]): Chart {
    const objects: ChartObject[] = [], open: (ChartObject | undefined)[] = new Array(4);
    for (let k = 0; k < actions.length; k++) {
        const time = k < headMs.length ? headMs[k] : songMs;
        for (let lane = 0; lane < 4; lane++) {
            const code = actions[k][lane], wasHeld = open[lane] !== undefined;
            if (wasHeld && code !== 0) {
                const end = code === 1 ? time : clip(round(gap[k][lane]), headMs[k - 1] + 1, (k < headMs.length ? headMs[k] : Math.ceil(songMs)) - 1);
                open[lane]!.end_ms = end;
                open[lane] = undefined;
            }
            const tap = wasHeld ? code === 3 : code === 1, hold = wasHeld ? code === 4 : code === 2;
            if (tap || hold) {
                const object: ChartObject = { lane, start_ms: time };
                if (hold) {
                    object.end_ms = NaN;
                    open[lane] = object;
                }
                objects.push(object);
            }
        }
    }
    objects.sort((a, b) => a.start_ms - b.start_ms || a.lane - b.lane);
    return { duration_ms: round(songMs), objects };
}
export function validateChart(chart: Chart): void {
    if (!Number.isInteger(chart.duration_ms) || chart.duration_ms < 0)
        throw new Error('Chart duration must be nonnegative whole milliseconds');
    const end = [-1, -1, -1, -1];
    let previous: ChartObject | undefined;
    for (const object of chart.objects) {
        const { lane, start_ms: start, end_ms: release } = object;
        if (!Number.isInteger(lane) || lane < 0 || lane > 3 || !Number.isInteger(start) || start < 0 || start > chart.duration_ms)
            throw new Error(`Invalid chart object: ${JSON.stringify(object)}`);
        if (previous && (start < previous.start_ms || start === previous.start_ms && lane <= previous.lane))
            throw new Error('Chart objects must be sorted by start then lane, with no duplicate heads');
        if (start < end[lane])
            throw new Error(`Head inside an open hold in lane ${lane} at ${start}`);
        if (release !== undefined && (!Number.isInteger(release) || release <= start || release > chart.duration_ms))
            throw new Error(`Invalid hold release in lane ${lane} at ${start}`);
        end[lane] = release ?? start;
        previous = object;
    }
}
export function audioFilename(name: string): string { const ext = /\.([a-zA-Z0-9]+)$/.exec(name)?.[1].toLowerCase() ?? 'bin'; return `audio.${ext}`; }
const metadata = (value: string) => value.replace(/[\r\n]/g, ' ');
const pythonFloat = (value: number) => Number.isInteger(value) ? `${value}.0` : String(value);
export function osuText(chart: Chart, segments: TimingSegment[], options: {
    title: string;
    artist: string;
    setting: string;
    seed: number | bigint;
    audioName: string;
    bookmarks?: number[];
    randomAlgorithm: string;
}): string {
    const lines = ['osu file format v14', '[General]', `AudioFilename:${options.audioName}`, 'Mode:3', '[Metadata]', `Title:${metadata(options.title)}`, `Artist:${metadata(options.artist)}`, 'Creator:Ensomi', `Version:Ensomi ${options.setting} s${options.seed}`, 'BeatmapID:0', 'BeatmapSetID:-1'];
    if (options.bookmarks?.length)
        lines.push('[Editor]', `Bookmarks:${options.bookmarks.map(Math.trunc).join(',')}`);
    lines.push('[Difficulty]', 'CircleSize:4', '[TimingPoints]');
    for (const segment of segments)
        lines.push(`${round(segment.offset_ms)},${pythonFloat(segment.beat_length_ms)},4,2,0,100,1,0`);
    lines.push(`// @ensomi/runtime 0.1.0 seed=${options.seed} random=${options.randomAlgorithm}`, '[HitObjects]');
    for (const object of chart.objects) {
        const prefix = `${64 + 128 * object.lane},192,${object.start_ms}`;
        lines.push(object.end_ms === undefined ? `${prefix},1,0,0:0:0:0:` : `${prefix},128,0,${object.end_ms}:0:0:0:0:`);
    }
    return lines.join('\n') + '\n';
}
export function exportOsz(osu: string, audio: EncodedAudio, receiptJson: string): Uint8Array {
    return zipSync({ 'generated.osu': strToU8(osu), [audioFilename(audio.name)]: [audio.bytes, { level: 0 }], 'receipt.json': strToU8(receiptJson + '\n') }, { level: 6 });
}
