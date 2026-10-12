/**
 * Song decoding for exact timing. The song is decoded at its own sample rate, read from the file's header, so that
 * WebAudio only decodes; the runtime's core then converts the rate as the Python release does: the release's soxr
 * tables for BeatThis (22050 Hz) and linear interpolation for the Log-Mel stream (24000 Hz). Without exact timing the
 * page decodes at 22050 and 24000 Hz and WebAudio's resampler makes both streams, which moves Catch the Moment's beat
 * grid by 1.3 ms (packages/runtime/artifacts/browser-test/report.md). A file whose rate is not found is decoded at
 * 44100 Hz.
 */
const FALLBACK_RATE = 44100;

/** Mono PCM at the file's own rate, channels averaged. */
export async function decodeSong(buffer: ArrayBuffer) {
    const found = headerRate(new Uint8Array(buffer)), rate = found && found >= 8000 && found <= 192000 ? found : FALLBACK_RATE;
    const decoded = await new OfflineAudioContext(1, 1, rate).decodeAudioData(buffer.slice(0)), pcm = new Float32Array(decoded.length);
    for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
        const samples = decoded.getChannelData(channel);
        for (let i = 0; i < pcm.length; i++)
            pcm[i] += samples[i] / decoded.numberOfChannels;
    }
    return { pcm, rate };
}

/** The sample rate in the header of an MP3, Ogg (Vorbis or Opus), WAV, FLAC or MP4 (AAC) file. */
export function headerRate(b: Uint8Array): number | undefined {
    const is = (at: number, text: string) => [...text].every((c, i) => b[at + i] === c.charCodeAt(0));
    const u32 = (at: number) => (b[at] | b[at + 1] << 8 | b[at + 2] << 16 | b[at + 3] << 24) >>> 0;
    if (is(0, 'RIFF') && is(8, 'WAVE')) {
        for (let at = 12; at + 16 <= b.length; at += 8 + u32(at + 4) + (u32(at + 4) & 1))
            if (is(at, 'fmt ')) return u32(at + 12);
        return undefined;
    }
    if (is(0, 'fLaC')) return b[18] << 12 | b[19] << 4 | b[20] >> 4;
    if (is(0, 'OggS')) {
        const packet = 27 + b[26];
        return is(packet, '\x01vorbis') ? u32(packet + 12) : is(packet, 'OpusHead') ? 48000 : undefined;
    }
    if (is(4, 'ftyp')) {
        // The mp4a sample entry: its 16.16 sample rate is 28 bytes after the box type.
        for (let at = 8; at + 30 <= b.length; at++)
            if (b[at] === 0x6d && is(at, 'mp4a')) return b[at + 28] << 8 | b[at + 29];
        return undefined;
    }
    // MP3: the first frame header after an ID3v2 tag.
    let at = is(0, 'ID3') ? 10 + (b[6] << 21 | b[7] << 14 | b[8] << 7 | b[9]) + (b[5] & 0x10 ? 10 : 0) : 0;
    for (const end = Math.min(b.length - 3, at + 65536); at < end; at++) {
        const version = b[at + 1] >> 3 & 3, layer = b[at + 1] >> 1 & 3, bitrate = b[at + 2] >> 4, index = b[at + 2] >> 2 & 3;
        if (b[at] === 0xff && (b[at + 1] & 0xe0) === 0xe0 && version !== 1 && layer !== 0 && bitrate !== 15 && index !== 3)
            return [44100, 48000, 32000][index] / (version === 3 ? 1 : version === 2 ? 2 : 4);
    }
    return undefined;
}
