import { ControlStatus, PatternKind, decodeAudio, type GenerateChartRequest, type GenerationResult, type ModelCapabilities, type SectionRequest } from '../packages/runtime/src/index.js';
import { Player, RATES, VISUAL_SPEEDS } from './player.js';

/** The generator page: model loading, song decoding, conditions, progress, result and inspector. */
const HUB = 'https://huggingface.co/sed-i/ensomi-r2/resolve/main/onnx/';
// ?model=<url of a folder holding runtime.json> loads another copy; ?backend=wasm skips WebGPU.
const params = new URLSearchParams(location.search);
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const field = (id: string) => $<HTMLInputElement>(id);

const KINDS: Record<string, PatternKind | 'star'> = { jumpstream: PatternKind.JUMPSTREAM, chordstream: PatternKind.CHORDSTREAM, stream: PatternKind.STREAM, jack: PatternKind.JACK, chordjack: PatternKind.CHORDJACK, section_star: 'star' };
const PHASES = ['', 'Prepare', 'Timing', 'Rows', 'Arrangement', 'Export'];
const RECEIPT_TIMES: [string, string][] = [['pcm', 'Prepare PCM'], ['spectrogram', 'BeatThis spectrogram'], ['beatthis', 'BeatThis network'], ['mel', 'Log-Mel features'], ['grid', 'Timing grid'], ['rows', 'Rows model'], ['prior', 'Prior'], ['arrangement', 'R2 arrangement'], ['export', 'Export']];

interface Song { file: File; buffer: ArrayBuffer; mel: Float32Array; beatthis: Float32Array; durationMs: number; decodeSeconds: number }
interface SectionDraft { start: string; end: string; kind: string; strength: number; star: number }
interface Job { song: Song; title: string; artist: string; seed: number | bigint; random: boolean; star: number; sections: SectionRequest[] }

let worker: Worker | undefined, caps: ModelCapabilities | undefined, provider = '', threads = 1, loadSeconds = 0, loading = false;
let song: Song | undefined, job: Job | undefined, generating = false, timer = 0;
let sections: SectionDraft[] = [], urls: string[] = [];
let phase = { current: 0, started: 0, seconds: [] as number[] };
const downloaded = new Map<string, [number, number]>();

const mb = (bytes: number) => (bytes / 1e6).toFixed(1);
const providerName = (name: string) => name === 'webgpu' ? 'WebGPU' : threads > 1 ? `WebAssembly, ${threads} threads` : 'WebAssembly, one thread';
function clock(ms: number, millis = false) {
    const total = Math.max(0, ms) / 1000, minutes = Math.floor(total / 60), seconds = total - minutes * 60;
    return `${minutes}:${millis ? seconds.toFixed(3).padStart(6, '0') : String(Math.floor(seconds)).padStart(2, '0')}`;
}
function parseClock(text: string) {
    const m = /^(\d{1,3}):([0-5]\d)$/.exec(text.trim());
    return m ? Number(m[1]) * 60000 + Number(m[2]) * 1000 : undefined;
}
function showError(message: string) {
    $('error').textContent = message;
    $('error').hidden = false;
}
const clearError = () => { $('error').hidden = true; };

// 1. Model
const sourceIsFolder = () => document.querySelector<HTMLInputElement>('input[name="source"]:checked')!.value === 'folder';
for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="source"]'))
    radio.addEventListener('change', () => { $('folder-field').hidden = !sourceIsFolder(); });

function startWorker() {
    const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    w.onmessage = ({ data }) => {
        if (data.type === 'file') onFile(data);
        else if (data.type === 'loaded') onLoaded(data);
        else if (data.type === 'phase') markPhase(data.phase);
        else if (data.type === 'result') showResult(data.result);
        else if (data.type === 'error') onError(data);
    };
    w.onerror = event => onError({ during: loading ? 'load' : 'generate', message: event.message || 'the generator could not start' });
    return w;
}

$('load').addEventListener('click', () => {
    const folder = field('folder').files;
    if (sourceIsFolder() && !folder?.length)
        return showError('Choose the model folder first: the downloaded sed-i/ensomi-r2 folder or its onnx folder.');
    clearError();
    loading = true;
    caps = undefined;
    downloaded.clear();
    $('model-meter').hidden = false;
    setMeter(0);
    $('model-status').textContent = 'Starting…';
    update();
    worker ??= startWorker();
    worker.postMessage({ type: 'load', base: new URL(params.get('model') ?? HUB, location.href).href, files: sourceIsFolder() ? Array.from(folder!) : undefined, backend: params.get('backend') });
});

function setMeter(fraction: number) { $('model-meter').querySelector('span')!.style.width = `${Math.min(1, fraction) * 100}%`; }

function onFile(data: { path: string; loaded: number; size: number; cached: boolean }) {
    if (!loading) return;
    // Files download in parallel: the meter follows the bytes of every file started so far.
    downloaded.set(data.path, [data.loaded, data.size]);
    let loaded = 0, size = 0;
    for (const [bytes, total] of downloaded.values()) {
        loaded += bytes;
        size += total || bytes;
    }
    setMeter(size ? loaded / size : 0);
    $('model-status').textContent = data.cached
        ? `Reading the model from this browser's cache · ${mb(loaded)} MB so far`
        : `Downloading the model: ${mb(loaded)} of ${mb(size)} MB`;
}

function onLoaded(data: { capabilities: ModelCapabilities; provider: string; threads: number; seconds: number }) {
    caps = data.capabilities;
    provider = data.provider;
    threads = data.threads;
    loadSeconds = data.seconds;
    loading = false;
    $('model-meter').hidden = true;
    $('model-status').textContent = `${caps.model_name} ${caps.model_version} is ready on ${providerName(provider)}, loaded in ${loadSeconds.toFixed(1)} s.`;
    const star = field('star');
    star.min = String(caps.min_star);
    star.max = String(Math.round((caps.max_star_exclusive - 0.1) * 10) / 10);
    renderSections();
    update();
}

function onError(data: { during: string; message: string }) {
    if (data.during === 'load') {
        loading = false;
        $('model-meter').hidden = true;
        $('model-status').textContent = 'The model is not loaded.';
        showError(`Could not load the model: ${data.message}`);
    }
    else {
        finishRun();
        showError(`Generation failed: ${data.message}`);
    }
    update();
}

// 2. Song
field('song').addEventListener('change', async () => {
    const file = field('song').files?.[0];
    if (!file) return;
    clearError();
    song = undefined;
    update();
    $('song-status').textContent = `Decoding ${file.name}…`;
    try {
        const start = performance.now(), buffer = await file.arrayBuffer(), { pcm } = await decodeAudio(buffer);
        song = { file, buffer, mel: pcm.mel!, beatthis: pcm.beatthis!, durationMs: pcm.samples.length / 24000 * 1000, decodeSeconds: (performance.now() - start) / 1000 };
        $('song-status').textContent = `${file.name} · ${clock(song.durationMs)} long · decoded in ${song.decodeSeconds.toFixed(1)} s`;
        const title = field('title');
        if (!title.value || title.dataset.auto === 'true') {
            title.value = file.name.replace(/\.[^.]+$/, '');
            title.dataset.auto = 'true';
        }
    }
    catch {
        $('song-status').textContent = 'No song loaded.';
        showError(`This browser could not decode ${file.name}. Try an MP3, OGG or WAV file.`);
    }
    renderSections();
    update();
});
field('title').addEventListener('input', () => { field('title').dataset.auto = 'false'; });

// 3. Conditions
field('star').addEventListener('input', () => { $('star-value').textContent = Number(field('star').value).toFixed(1); });
field('seed').addEventListener('input', update);
$('new-seed').addEventListener('click', () => {
    field('seed').value = String(randomSeed());
    update();
});

/** A random seed for a seed of 0. Never 0 itself, so that the seed shown with the result reproduces the chart. The core
 * seeds its generators from the low 32 bits. */
function randomSeed() {
    let seed = 0;
    while (!seed) seed = crypto.getRandomValues(new Uint32Array(1))[0];
    return seed;
}

function seedValue(): number | bigint | undefined {
    const text = field('seed').value.trim();
    if (!/^\d{1,20}$/.test(text) || BigInt(text) > 0xffffffffffffffffn) return undefined;
    const n = BigInt(text);
    return n <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(n) : n;
}

const sectionOptions = () => (caps?.controls ?? []).filter(c => c.name in KINDS && c.status !== ControlStatus.NOT_WORKING);
function kindLabel(name: string, status: ControlStatus) {
    const label = name === 'section_star' ? 'Star target' : name[0].toUpperCase() + name.slice(1);
    return status === ControlStatus.EXPERIMENTAL ? `${label} (experimental)` : label;
}

$('add-section').addEventListener('click', () => {
    sections.push({ start: '00:00', end: '00:08', kind: sectionOptions()[0].name, strength: 0.5, star: Number(field('star').value) });
    renderSections();
    update();
});

function renderSections() {
    const list = $('section-list'), options = sectionOptions();
    list.replaceChildren();
    sections.forEach((section, i) => {
        const row = document.createElement('div'), isStar = section.kind === 'section_star';
        row.className = 'section-row';
        row.innerHTML = `<label>Start <input type="text" class="start" spellcheck="false" autocomplete="off"></label>
<label>End <input type="text" class="end" spellcheck="false" autocomplete="off"></label>
<label>Kind <select class="kind"></select></label>
<label class="value-label"><span><span class="value-name"></span><output></output></span><input type="range" class="value"></label>
<button type="button" class="remove">×</button>
<p class="note"></p>`;
        const q = <T extends Element>(selector: string) => row.querySelector(selector) as T;
        const start = q<HTMLInputElement>('.start'), end = q<HTMLInputElement>('.end'), kind = q<HTMLSelectElement>('.kind'), value = q<HTMLInputElement>('.value'), output = q<HTMLOutputElement>('output');
        start.value = section.start;
        end.value = section.end;
        for (const option of options) kind.add(new Option(kindLabel(option.name, option.status), option.name, false, option.name === section.kind));
        q('.value-name').textContent = isStar ? 'Star' : 'Strength';
        Object.assign(value, isStar ? { min: String(caps!.min_star), max: field('star').max, step: '0.1' } : { min: '0', max: '1', step: '0.05' });
        value.value = String(isStar ? section.star : section.strength);
        output.textContent = isStar ? section.star.toFixed(1) : section.strength.toFixed(2);
        q('.note').textContent = options.find(o => o.name === section.kind)?.note ?? '';
        q('.remove').setAttribute('aria-label', `Remove section ${i + 1}`);
        start.addEventListener('input', () => { section.start = start.value; update(); });
        end.addEventListener('input', () => { section.end = end.value; update(); });
        kind.addEventListener('change', () => { section.kind = kind.value; renderSections(); update(); });
        value.addEventListener('input', () => {
            if (isStar) section.star = Number(value.value);
            else section.strength = Number(value.value);
            output.textContent = isStar ? section.star.toFixed(1) : section.strength.toFixed(2);
        });
        q('.remove').addEventListener('click', () => { sections.splice(i, 1); renderSections(); update(); });
        list.append(row);
    });
}

/** The section requests, or the first problem in plain words. Same rules as the runtime and the macOS app. */
function sectionRequests(): SectionRequest[] | string {
    const requests: SectionRequest[] = [];
    for (const [i, section] of sections.entries()) {
        const name = `Section ${i + 1}`, start = parseClock(section.start), end = parseClock(section.end), target = KINDS[section.kind];
        if (start === undefined || end === undefined) return `${name}: enter start and end as mm:ss, with seconds from 00 to 59.`;
        if (end <= start) return `${name}: end must be after start.`;
        if (end > song!.durationMs) return `${name}: keep the span inside the song (${clock(song!.durationMs)}).`;
        if (end - start < 8000 || end - start > 32000) return `${name}: a section must last 8–32 seconds.`;
        requests.push(target === 'star' ? { start_ms: start, end_ms: end, star: section.star } : { start_ms: start, end_ms: end, pattern: { kind: target, strength: section.strength } });
    }
    const sorted = requests.slice().sort((a, b) => a.start_ms - b.start_ms);
    for (let i = 1; i < sorted.length; i++)
        if (sorted[i].start_ms < sorted[i - 1].end_ms) return 'Sections must not overlap. One may start where another ends.';
    return requests;
}

function update() {
    const checked = caps && song ? sectionRequests() : [], sectionError = typeof checked === 'string' ? checked : '';
    $('section-error').textContent = sectionError;
    $('section-error').hidden = !sectionError;
    const blocker = !caps ? (loading ? 'Loading the model…' : 'Load the model to start.')
        : !song ? 'Choose a song.'
            : song.durationMs < 3000 ? 'The song must be at least 3 seconds long.'
                : seedValue() === undefined ? 'The seed must be a whole number from 0 to 18446744073709551615.'
                    : sectionError ? 'Fix the sections above.' : '';
    $<HTMLButtonElement>('generate-button').disabled = generating || Boolean(blocker);
    $<HTMLButtonElement>('add-section').disabled = generating || !caps || !song || !sectionOptions().length;
    $<HTMLButtonElement>('load').disabled = loading || generating;
    if (!generating) $('run-status').textContent = blocker || 'Ready to generate.';
}

// Generate
$('generate-button').addEventListener('click', () => {
    if (!song || !caps) return;
    const requests = sectionRequests(), entered = seedValue();
    if (typeof requests === 'string' || entered === undefined) return;
    clearError();
    // A seed of 0 draws a new seed for each generation; the result shows the seed used.
    const title = field('title').value.trim() || song.file.name.replace(/\.[^.]+$/, ''), artist = field('artist').value.trim(), seed = entered === 0 ? randomSeed() : entered;
    job = { song, title, artist, seed, random: entered === 0, star: Number(field('star').value), sections: requests };
    generating = true;
    phase = { current: 0, started: performance.now(), seconds: [] };
    renderPhases();
    timer = window.setInterval(renderPhases, 200);
    update();
    $('run-status').textContent = `Generating on ${providerName(provider)}…`;
    const request: GenerateChartRequest = { audio: { asset_id: song.file.name }, star: job.star, seed, controls: { sections: requests }, title, ...(artist ? { artist } : {}) };
    worker!.postMessage({ type: 'generate', mel: song.mel, beatthis: song.beatthis, request, audio: { name: song.file.name, bytes: new Uint8Array(song.buffer) } });
});

function markPhase(next: number) {
    const now = performance.now();
    if (phase.current) phase.seconds[phase.current] = (now - phase.started) / 1000;
    phase.current = next;
    phase.started = now;
    renderPhases();
}

function renderPhases() {
    for (const item of $('phases').querySelectorAll<HTMLElement>('li')) {
        const p = Number(item.dataset.phase), active = generating && p === phase.current;
        const seconds = active ? (performance.now() - phase.started) / 1000 : phase.seconds[p];
        item.className = active ? 'active' : seconds !== undefined ? 'done' : '';
        item.textContent = PHASES[p] + (seconds !== undefined ? ` · ${seconds.toFixed(1)} s` : '');
    }
}

function finishRun() {
    if (generating && phase.current) phase.seconds[phase.current] = (performance.now() - phase.started) / 1000;
    generating = false;
    clearInterval(timer);
    renderPhases();
}

// Result
const player = new Player($<HTMLCanvasElement>('lanes'), $<HTMLCanvasElement>('overview'), $<HTMLAudioElement>('audio'), ms => {
    $('clock').textContent = `${clock(ms, true)} / ${clock(player.duration)}`;
});

function showResult(result: GenerationResult) {
    finishRun();
    const done = job!, detail = JSON.parse(result.receipt.receipt_json), objects = result.chart.objects, holds = objects.filter(o => o.end_ms !== undefined).length;
    for (const url of urls) URL.revokeObjectURL(url);
    const name = `${done.artist ? `${done.artist} - ` : ''}${done.title} (ensomi R2 s${done.seed})`.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim().slice(0, 120);
    const osz = URL.createObjectURL(new Blob([result.osz! as BlobPart], { type: 'application/zip' })), osu = URL.createObjectURL(new Blob([result.osu], { type: 'text/plain' })), audio = URL.createObjectURL(done.song.file);
    urls = [osz, osu, audio];
    Object.assign($<HTMLAnchorElement>('get-osz'), { href: osz, download: `${name}.osz` });
    Object.assign($<HTMLAnchorElement>('get-osu'), { href: osu, download: `${name}.osu` });

    const facts: [string, string][] = [
        ['Model', `${result.receipt.model_name} ${result.receipt.model_version}`],
        ['Provider', providerName(provider)],
        ['Song', `${done.song.file.name} · ${clock(done.song.durationMs)}`],
        ['Star', done.star.toFixed(1)],
        ['Seed', done.random ? `${done.seed} (drawn at random)` : String(done.seed)],
        ['Notes', `${objects.length.toLocaleString('en')}: ${(objects.length - holds).toLocaleString('en')} taps, ${holds.toLocaleString('en')} long notes`],
        ['Head rows', Number(detail.rows.K).toLocaleString('en')],
        ['Tempo', detail.rows.segments.map((s: number[]) => (60000 / s[1]).toFixed(1)).join(', ') + ' BPM'],
        ['Sections', done.sections.length ? String(done.sections.length) : 'none'],
    ];
    $('receipt').replaceChildren(...facts.flatMap(([label, value]) => {
        const dt = document.createElement('dt'), dd = document.createElement('dd');
        dt.textContent = label;
        dd.textContent = value;
        return [dt, dd];
    }));
    const rows: [string, number, boolean?][] = [['Model load', loadSeconds], ['Audio decode', done.song.decodeSeconds], ...RECEIPT_TIMES.map(([key, label]): [string, number] => [label, detail.seconds[key]]), ['Generation total', detail.seconds.total, true]];
    $('times').replaceChildren(...rows.map(([label, seconds, total]) => {
        const tr = document.createElement('tr'), th = document.createElement('th'), td = document.createElement('td');
        th.scope = 'row';
        th.textContent = label;
        td.textContent = `${seconds.toFixed(2)} s`;
        if (total) tr.className = 'total';
        tr.append(th, td);
        return tr;
    }));

    player.audio.src = audio;
    player.load({ chart: result.chart, segments: detail.rows.segments, sections: done.sections });
    $('identity').textContent = [done.title, done.artist, `ensomi R2 s${done.seed}`].filter(Boolean).join(' · ');
    $('result').hidden = false;
    $('run-status').textContent = `Done in ${detail.seconds.total.toFixed(1)} s.`;
    update();
    $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Inspector controls
$('play').addEventListener('click', () => player.toggle());
$('restart').addEventListener('click', () => player.seek(0));
player.audio.addEventListener('play', () => { $('play').textContent = 'Pause'; $('play').setAttribute('aria-pressed', 'true'); });
player.audio.addEventListener('pause', () => { $('play').textContent = 'Play'; $('play').setAttribute('aria-pressed', 'false'); });

function presets(id: string, values: number[], initial: number, label: (v: number) => string, apply: (v: number) => void) {
    const box = $(id), buttons = values.map(v => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label(v);
        button.setAttribute('aria-pressed', String(v === initial));
        button.addEventListener('click', () => {
            for (const b of buttons) b.setAttribute('aria-pressed', String(b === button));
            apply(v);
        });
        return button;
    });
    box.append(...buttons);
}
presets('rates', RATES, 1, v => `${v}×`, v => { player.audio.defaultPlaybackRate = v; player.audio.playbackRate = v; });
presets('speeds', VISUAL_SPEEDS, player.speed, String, v => { player.speed = v; });

// Space plays or pauses; Left and Right seek 5 s. Typing targets and focused buttons keep their own keys.
document.addEventListener('keydown', event => {
    if ($('result').hidden || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target instanceof Element ? event.target : document.body;
    if (target.closest('textarea, select, [contenteditable="true"], input:not([type="range"])')) return;
    if (event.key === ' ' && !target.closest('button, a, summary')) {
        event.preventDefault();
        player.toggle();
    }
    else if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !target.closest('input')) {
        event.preventDefault();
        player.seek(player.time + (event.key === 'ArrowLeft' ? -5000 : 5000));
    }
});

update();
