import type { FileSource, Models } from './models.js';
import { FFT } from './fft.js';
import { f32, round, half } from './math.js';
export interface Resampler {
    numerator: number;
    phases: number;
    radius: number;
    boundary_frames: number;
    boundary_samples: number;
    coefficients: Float64Array;
    boundary: Float64Array;
}
export async function loadResampler(sampleRate: number, read: FileSource): Promise<Resampler> {
    const spec = JSON.parse(new TextDecoder().decode(await read(`resample-${sampleRate}.json`)));
    return { ...spec, coefficients: new Float64Array((await read(spec.file)).slice().buffer), boundary: new Float64Array((await read(spec.boundary_file)).slice().buffer) };
}
export function mono(pcm: Float32Array | Float64Array, channels: number) {
    const out = new Float64Array(pcm.length / channels);
    for (let i = 0; i < out.length; i++) {
        let v = 0;
        for (let c = 0; c < channels; c++)
            v += pcm[i * channels + c];
        out[i] = v / channels;
    }
    return out;
}
export function resample(pcm: Float64Array, kernel: Resampler): Float32Array {
    const { numerator: p, phases: q, radius: r, coefficients: k, boundary_frames: bf, boundary_samples: bs, boundary: b } = kernel;
    const out = new Float32Array(round(pcm.length * q / p)), width = 2 * r + 1;
    for (let m = 0; m < out.length; m++) {
        let v = 0;
        if (m < bf) {
            for (let j = 0; j < Math.min(bs, pcm.length); j++)
                v += pcm[j] * b[m * bs + j];
        }
        else {
            const i = Math.floor(m * p / q), phase = m * p % q;
            for (let j = Math.max(-r, -i); j <= Math.min(r, pcm.length - 1 - i); j++)
                v += pcm[i + j] * k[phase * width + j + r];
        }
        out[m] = v;
    }
    return out;
}
export async function spectrogram(pcm: Float32Array, models: Models, kind: 'beatthis' | 'rows'): Promise<Float32Array> {
    const arrays = models.manifest.frontend_arrays[kind];
    const window = await models.array(arrays.hann_window) as Float32Array;
    const filter = await models.array(arrays.mel_filter) as Float32Array;
    const n = window.length, bins = n / 2 + 1, hop = kind === 'beatthis' ? 441 : 240;
    const frames = kind === 'beatthis' ? 1 + Math.floor(pcm.length / hop) : Math.ceil(pcm.length / hop);
    const out = new Float32Array(frames * 128), input = new Float64Array(n), fft = new FFT(n), power = new Float32Array(bins);
    // Only nonzero Mel weights contribute. Preserve ascending FFT-bin reduction order.
    const weights = Array.from({ length: 128 }, (_, m) => Array.from({ length: bins }, (_, k) => [k, filter[kind === 'beatthis' ? k * 128 + m : m * bins + k]]).filter(x => x[1] !== 0));
    for (let f = 0; f < frames; f++) {
        const start = f * hop - (kind === 'beatthis' ? n / 2 : 0);
        for (let j = 0; j < n; j++) {
            let i = start + j;
            if (kind === 'beatthis') {
                if (i < 0)
                    i = -i;
                if (i >= pcm.length)
                    i = 2 * pcm.length - 2 - i;
            }
            input[j] = f32((pcm[i] ?? 0) * window[j]);
        }
        fft.run(input);
        for (let k = 0; k < bins; k++) {
            const re = f32(fft.re[k] * (kind === 'beatthis' ? 1 / 32 : 1)), im = f32(fft.im[k] * (kind === 'beatthis' ? 1 / 32 : 1));
            const mag = f32(Math.sqrt(f32(f32(re * re) + f32(im * im))));
            power[k] = kind === 'beatthis' ? mag : f32(mag * mag);
        }
        for (let m = 0; m < 128; m++) {
            let v = 0;
            for (const [k, w] of weights[m])
                v += power[k] * w;
            out[f * 128 + m] = kind === 'beatthis' ? Math.log1p(f32(1000 * f32(v))) : Math.log(Math.max(f32(v), 1e-5));
        }
    }
    return out;
}
export async function beatActivations(spect: Float32Array, models: Models) {
    const frames = spect.length / 128, starts: number[] = [];
    for (let s = -6; s < frames - 6; s += 1488)
        starts.push(s);
    if (frames > 1488)
        starts[starts.length - 1] = frames - 1494;
    const outputs = [];
    for (const start of starts) {
        const left = Math.max(0, -start), lo = Math.max(start, 0), hi = Math.min(start + 1500, frames), right = Math.max(0, Math.min(6, start + 1500 - frames));
        const data = new Float32Array((left + hi - lo + right) * 128);
        data.set(spect.subarray(lo * 128, hi * 128), left * 128);
        outputs.push(await models.run('beatthis', { spect: new models.ort.Tensor('float32', data, [1, data.length / 128, 128]) }));
    }
    const beat = new Float32Array(frames).fill(-1000), downbeat = new Float32Array(frames).fill(-1000);
    for (let c = starts.length - 1; c >= 0; c--) {
        const start = starts[c], len = Math.min(frames, start + 1494) - (start + 6);
        beat.set((outputs[c].beat_logits.data as Float32Array).subarray(6, 6 + len), start + 6);
        downbeat.set((outputs[c].downbeat_logits.data as Float32Array).subarray(6, 6 + len), start + 6);
    }
    return { beat, downbeat, beatProbability: beat.map(x => 1 / (1 + Math.exp(-x))), downbeatProbability: downbeat.map(x => 1 / (1 + Math.exp(-x))) };
}
export function features(logMel: Float32Array, beat: Float32Array, downbeat: Float32Array) {
    let mean = 0;
    for (const x of logMel)
        mean += x;
    mean = f32(mean / logMel.length);
    let variance = 0;
    for (const x of logMel)
        variance += f32(f32(x - mean) ** 2);
    const sd = f32(Math.sqrt(f32(variance / logMel.length)));
    const frames = logMel.length / 128, out = new Float32Array(frames * 130);
    for (let f = 0; f < frames; f++) {
        for (let m = 0; m < 128; m++)
            out[f * 130 + m] = half(f32(f32(logMel[f * 128 + m] - mean) / f32(sd + 1e-6)));
        const at = (f + 2) / 2, i = Math.min(Math.floor(at), beat.length - 1), j = Math.min(i + 1, beat.length - 1), t = at - Math.floor(at);
        out[f * 130 + 128] = half(beat[i] + t * (beat[j] - beat[i]));
        out[f * 130 + 129] = half(downbeat[i] + t * (downbeat[j] - downbeat[i]));
    }
    return out;
}
/** PCM input has no decoder quantization: use pydub's linear rate-conversion convention for Mel. */
export function melPcm(pcm: Float64Array, sampleRate: number): Float32Array {
    const length = Math.floor((pcm.length - 1) * 24000 / sampleRate) + 1, out = new Float32Array(length);
    let peak = 0;
    for (let i = 0; i < length; i++) {
        const at = i * sampleRate / 24000, lo = Math.floor(at), hi = Math.min(lo + 1, pcm.length - 1), v = pcm[lo] + (at - lo) * (pcm[hi] - pcm[lo]);
        out[i] = v;
        peak = Math.max(peak, Math.abs(out[i]));
    }
    if (peak)
        for (let i = 0; i < length; i++)
            out[i] = f32(out[i] / peak);
    return out;
}
/** Windowed-sinc conversion for PCM rates outside the release's soxr table rates. */
export function sincResample(pcm: Float64Array, sampleRate: number, targetRate: number): Float32Array {
    const ratio = sampleRate / targetRate, scale = Math.min(1, 1 / ratio) * 0.95, radius = Math.ceil(128 / scale), out = new Float32Array(round(pcm.length / ratio));
    for (let m = 0; m < out.length; m++) {
        const at = m * ratio, lo = Math.ceil(at - radius), hi = Math.floor(at + radius);
        let value = 0, weight = 0;
        for (let j = lo; j <= hi; j++) {
            const x = at - j, z = Math.PI * x * scale, sinc = z === 0 ? 1 : Math.sin(z) / z, window = 0.42 + 0.5 * Math.cos(Math.PI * x / radius) + 0.08 * Math.cos(2 * Math.PI * x / radius), w = sinc * window * scale;
            value += (pcm[j] ?? 0) * w;
            weight += w;
        }
        out[m] = value / weight;
    }
    return out;
}
