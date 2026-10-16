import { ControlStatus, GenerationPhase, PatternKind, decodeAudio, type GenerateChartRequest, type GenerationResult, type ModelCapabilities, type SectionRequest } from '@ensomi/runtime';
import { decodeSong } from './audio.js';
import { maniaStar } from './star.js';
import { Player, RATES, VISUAL_SPEEDS } from './player.js';
import { t } from './i18n.js';

/** The generator page: model loading, song decoding, conditions, progress, result and inspector. */
// The model files at the release tag, not main. Pointing it at another revision also needs a new cache name in worker.ts.
const HUB = 'https://huggingface.co/sed-i/ensomi-r2/resolve/r2-1.0.1/onnx/';
// ?model=<url of a folder holding runtime.json> loads another copy; ?backend=wasm skips WebGPU.
const params = new URLSearchParams(location.search);
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const field = (id: string) => $<HTMLInputElement>(id);

const KINDS: Record<string, PatternKind | 'star'> = { jumpstream: PatternKind.JUMPSTREAM, chordstream: PatternKind.CHORDSTREAM, stream: PatternKind.STREAM, jack: PatternKind.JACK, chordjack: PatternKind.CHORDJACK, section_star: 'star' };
const RECEIPT_TIMES = ['rows', 'prior', 'arrangement', 'export'];
// The stages that read the conditions; they run together when Generate is pressed, without progress of their own.
const CHART_PHASES = [GenerationPhase.ROWS, GenerationPhase.ARRANGEMENT, GenerationPhase.EXPORT];

interface Song { file: File; buffer: ArrayBuffer; mel: Float32Array; beatthis: Float32Array; durationMs: number; decodeSeconds: number }
interface SectionDraft { start: string; end: string; kind: string; strength: number; star: number }
/** A song's audio stages, run in the worker as soon as the model and the song are ready. `posted` settles once the worker
 * has the request, `seconds` arrive when the stages are done. */
interface Prep { id: number; song: Song; exact: boolean; posted: Promise<void>; decode?: { rate: number; seconds: number }; seconds?: { pcm: number; timing: number }; failed?: boolean }
interface Job { song: Song; title: string; artist: string; seed: number | bigint; random: boolean; star: number; sections: SectionRequest[]; prep: Prep }

let worker: Worker | undefined, caps: ModelCapabilities | undefined, provider = '', threads = 1, loadSeconds = 0, loading = false;
let song: Song | undefined, prep: Prep | undefined, prepCount = 0, job: Job | undefined, generating = false, timer = 0;
let sections: SectionDraft[] = [], urls: string[] = [];
let phase = { active: [] as number[], started: 0, seconds: [] as number[] };
const downloaded = new Map<string, [number, number]>();

const mb = (bytes: number) => (bytes / 1e6).toFixed(1);
const providerName = (name: string) => name === 'webgpu' ? 'WebGPU' : threads > 1 ? t.wasmThreads(threads) : t.wasmOneThread;
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
        else if (data.type === 'phase') markPhase(data);
        else if (data.type === 'prepared') onPrepared(data);
        else if (data.type === 'result') showResult(data.result);
        else if (data.type === 'error') onError(data);
    };
    w.onerror = event => onError({ during: loading ? 'load' : 'generate', message: event.message || t.workerFailed });
    return w;
}

$('load').addEventListener('click', () => {
    const folder = field('folder').files;
    if (sourceIsFolder() && !folder?.length)
        return showError(t.chooseFolder);
    clearError();
    loading = true;
    caps = undefined;
    prep = undefined;
    downloaded.clear();
    $('model-meter').hidden = false;
    setMeter(0);
    $('model-status').textContent = t.starting;
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
        ? t.readingCache(mb(loaded))
        : t.downloading(mb(loaded), mb(size));
}

function onLoaded(data: { capabilities: ModelCapabilities; provider: string; threads: number; seconds: number }) {
    caps = data.capabilities;
    provider = data.provider;
    threads = data.threads;
    loadSeconds = data.seconds;
    loading = false;
    $('model-meter').hidden = true;
    $('model-status').textContent = t.modelReady(`${caps.model_name} ${caps.model_version}`, providerName(provider), loadSeconds.toFixed(1));
    const star = field('star');
    star.min = String(caps.min_star);
    star.max = String(Math.round((caps.max_star_exclusive - 0.1) * 10) / 10);
    renderSections();
    startPrepare();
    update();
}

function onError(data: { during: string; id?: number; message: string }) {
    if (data.during === 'load') {
        loading = false;
        $('model-meter').hidden = true;
        $('model-status').textContent = t.modelNotLoaded;
        showError(t.loadFailed(data.message));
    }
    else if (data.during === 'prepare') {
        // A generation waiting for these stages fails with them; Generate then runs them again.
        if (!prep || data.id !== prep.id) return;
        prep.failed = true;
        phase.active = [];
        ticking();
        showError(t.timingFailed(data.message));
    }
    else {
        finishRun();
        showError(t.generationFailed(data.message));
    }
    update();
}

// 2. Song
field('song').addEventListener('change', async () => {
    const file = field('song').files?.[0];
    if (!file) return;
    clearError();
    song = undefined;
    prep = undefined;
    update();
    $('song-status').textContent = t.decoding(file.name);
    try {
        const start = performance.now(), buffer = await file.arrayBuffer(), { pcm } = await decodeAudio(buffer);
        song = { file, buffer, mel: pcm.mel!, beatthis: pcm.beatthis!, durationMs: pcm.samples.length / 24000 * 1000, decodeSeconds: (performance.now() - start) / 1000 };
        $('song-status').textContent = t.decoded(file.name, clock(song.durationMs), song.decodeSeconds.toFixed(1));
        const title = field('title');
        if (!title.value || title.dataset.auto === 'true') {
            title.value = file.name.replace(/\.[^.]+$/, '');
            title.dataset.auto = 'true';
        }
    }
    catch {
        $('song-status').textContent = t.noSong;
        showError(t.cannotDecode(file.name));
    }
    renderSections();
    startPrepare();
    update();
});
field('title').addEventListener('input', () => { field('title').dataset.auto = 'false'; });
field('exact').addEventListener('change', () => { startPrepare(); update(); });

/** Runs the song's audio stages (PCM, BeatThis and the beat grid) as soon as the model and the song are both ready, so
 * that Generate runs only the stages that read the conditions. Exact timing decodes the song again at its own rate first
 * (site/audio.ts); toggling it prepares the song again. */
function startPrepare() {
    if (!caps || !song || song.durationMs < 3000) return;
    const current = song, exact = field('exact').checked, id = ++prepCount;
    const posted = (async () => {
        if (!exact)
            return worker!.postMessage({ type: 'prepare', id, mel: current.mel, beatthis: current.beatthis });
        try {
            const start = performance.now(), { pcm, rate } = await decodeSong(current.buffer);
            // A song or setting chosen during the decode has been sent since; this one is not.
            if (prep?.id !== id) return;
            prep.decode = { rate, seconds: (performance.now() - start) / 1000 };
            worker!.postMessage({ type: 'prepare', id, pcm, rate }, [pcm.buffer]);
        }
        catch {
            if (prep?.id !== id) return;
            prep.failed = true;
            showError(t.cannotDecode(current.file.name));
            update();
        }
    })();
    prep = { id, song: current, exact, posted };
    ticking();
}
const preparing = () => Boolean(prep && !prep.seconds && !prep.failed);

function onPrepared(data: { id: number; seconds: { pcm: number; timing: number } }) {
    if (data.id !== prep?.id) return;
    prep.seconds = data.seconds;
    phase.seconds[GenerationPhase.LOADING] = data.seconds.pcm;
    phase.seconds[GenerationPhase.TIMING] = data.seconds.timing;
    phase.active = generating ? CHART_PHASES : [];
    phase.started = performance.now();
    ticking();
    update();
}

// 3. Conditions
field('star').addEventListener('input', () => { $('star-value').textContent = Number(field('star').value).toFixed(1); });
field('seed').addEventListener('input', update);
$('new-seed').addEventListener('click', () => {
    field('seed').value = String(randomSeed());
    update();
});

/** A random seed for a blank seed field, shown with the result so that it reproduces the chart. The core seeds its
 * generators from the low 32 bits. */
const randomSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];

/** The seed entered, 'random' for a blank field, or undefined for text that is not a seed. */
function seedValue(): number | bigint | 'random' | undefined {
    const text = field('seed').value.trim();
    if (!text) return 'random';
    if (!/^\d{1,20}$/.test(text) || BigInt(text) > 0xffffffffffffffffn) return undefined;
    const n = BigInt(text);
    return n <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(n) : n;
}

const sectionOptions = () => (caps?.controls ?? []).filter(c => c.name in KINDS && c.status !== ControlStatus.NOT_WORKING);
function kindLabel(name: string, status: ControlStatus) {
    const label = name === 'section_star' ? t.starTarget : name[0].toUpperCase() + name.slice(1);
    return status === ControlStatus.EXPERIMENTAL ? t.experimental(label) : label;
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
        row.innerHTML = `<label>${t.start} <input type="text" class="start" spellcheck="false" autocomplete="off"></label>
<label>${t.end} <input type="text" class="end" spellcheck="false" autocomplete="off"></label>
<label>${t.kind} <select class="kind"></select></label>
<label class="value-label"><span><span class="value-name"></span><output></output></span><input type="range" class="value"></label>
<button type="button" class="remove">×</button>
<p class="note"></p>`;
        const q = <T extends Element>(selector: string) => row.querySelector(selector) as T;
        const start = q<HTMLInputElement>('.start'), end = q<HTMLInputElement>('.end'), kind = q<HTMLSelectElement>('.kind'), value = q<HTMLInputElement>('.value'), output = q<HTMLOutputElement>('output');
        start.value = section.start;
        end.value = section.end;
        for (const option of options) kind.add(new Option(kindLabel(option.name, option.status), option.name, false, option.name === section.kind));
        q('.value-name').textContent = isStar ? t.star : t.strength;
        Object.assign(value, isStar ? { min: String(caps!.min_star), max: field('star').max, step: '0.1' } : { min: '0', max: '1', step: '0.05' });
        value.value = String(isStar ? section.star : section.strength);
        output.textContent = isStar ? section.star.toFixed(1) : section.strength.toFixed(2);
        q('.note').textContent = options.find(o => o.name === section.kind)?.note ?? '';
        q('.remove').setAttribute('aria-label', t.removeSection(i + 1));
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
        const name = t.section(i + 1), start = parseClock(section.start), end = parseClock(section.end), target = KINDS[section.kind];
        if (start === undefined || end === undefined) return t.sectionClock(name);
        if (end <= start) return t.sectionOrder(name);
        if (end > song!.durationMs) return t.sectionInside(name, clock(song!.durationMs));
        if (end - start < 8000 || end - start > 32000) return t.sectionLength(name);
        requests.push(target === 'star' ? { start_ms: start, end_ms: end, star: section.star } : { start_ms: start, end_ms: end, pattern: { kind: target, strength: section.strength } });
    }
    const sorted = requests.slice().sort((a, b) => a.start_ms - b.start_ms);
    for (let i = 1; i < sorted.length; i++)
        if (sorted[i].start_ms < sorted[i - 1].end_ms) return t.sectionOverlap;
    return requests;
}

function update() {
    const checked = caps && song ? sectionRequests() : [], sectionError = typeof checked === 'string' ? checked : '';
    $('section-error').textContent = sectionError;
    $('section-error').hidden = !sectionError;
    const blocker = !caps ? (loading ? t.loadingModel : t.loadToStart)
        : !song ? t.chooseSong
            : song.durationMs < 3000 ? t.songTooShort
                : seedValue() === undefined ? t.badSeed
                    : sectionError ? t.fixSections : '';
    $<HTMLButtonElement>('generate-button').disabled = generating || Boolean(blocker);
    $<HTMLButtonElement>('add-section').disabled = generating || !caps || !song || !sectionOptions().length;
    $<HTMLButtonElement>('load').disabled = loading || generating;
    // A generation starts from the stages prepared when it was asked for; another song or setting waits until it is done.
    field('song').disabled = field('exact').disabled = generating;
    if (!generating) $('run-status').textContent = blocker || (preparing() ? t.timing : prep?.seconds ? t.timingReady : t.readyToGenerate);
}

// Generate
$('generate-button').addEventListener('click', async () => {
    if (!song || !caps) return;
    const requests = sectionRequests(), entered = seedValue();
    if (typeof requests === 'string' || entered === undefined) return;
    clearError();
    // Stages that failed run again first.
    if (!prep || prep.failed) startPrepare();
    // A blank seed draws a new seed for each generation, as in the app; the result shows the seed used.
    const title = field('title').value.trim() || song.file.name.replace(/\.[^.]+$/, ''), artist = field('artist').value.trim(), seed = entered === 'random' ? randomSeed() : entered;
    job = { song, title, artist, seed, random: entered === 'random', star: Number(field('star').value), sections: requests, prep: prep! };
    generating = true;
    phase.seconds.length = GenerationPhase.ROWS;
    if (job.prep.seconds) {
        phase.active = CHART_PHASES;
        phase.started = performance.now();
    }
    ticking();
    update();
    $('run-status').textContent = t.generating(providerName(provider));
    const request: GenerateChartRequest = { audio: { asset_id: song.file.name }, star: job.star, seed, controls: { sections: requests }, title, ...(artist ? { artist } : {}) };
    await job.prep.posted;
    if (job.prep.failed) {
        finishRun();
        return update();
    }
    worker!.postMessage({ type: 'generate', request, audio: { name: song.file.name, bytes: new Uint8Array(song.buffer) } });
});

/** Progress of the audio stages: Prepare, then Timing. */
function markPhase(data: { id: number; phase: number }) {
    if (data.id !== prep?.id) return;
    const now = performance.now();
    if (data.phase === GenerationPhase.LOADING) phase = { active: [], started: now, seconds: [] };
    for (const p of phase.active) phase.seconds[p] = (now - phase.started) / 1000;
    phase.active = [data.phase];
    phase.started = now;
    renderPhases();
}

function renderPhases() {
    for (const item of $('phases').querySelectorAll<HTMLElement>('li')) {
        const p = Number(item.dataset.phase), active = phase.active.includes(p);
        // A phase running alone counts its seconds; the stages after timing get theirs from the receipt.
        const seconds = active ? (phase.active.length === 1 ? (performance.now() - phase.started) / 1000 : undefined) : phase.seconds[p];
        item.className = active ? 'active' : seconds !== undefined ? 'done' : '';
        item.textContent = t.phases[p] + (seconds !== undefined ? ` · ${seconds.toFixed(1)} s` : '');
    }
}

/** Redraws the phases, every 200 ms while a song is being prepared or a chart generated. */
function ticking() {
    const busy = generating || preparing();
    if (busy && !timer) timer = window.setInterval(renderPhases, 200);
    if (!busy && timer) {
        clearInterval(timer);
        timer = 0;
    }
    renderPhases();
}

function finishRun() {
    generating = false;
    phase.active = phase.active.filter(p => !CHART_PHASES.includes(p));
    ticking();
}

// Result
const player = new Player($<HTMLCanvasElement>('lanes'), $<HTMLCanvasElement>('overview'), $<HTMLAudioElement>('audio'), ms => {
    $('clock').textContent = `${clock(ms, true)} / ${clock(player.duration)}`;
});

function showResult(result: GenerationResult) {
    const done = job!, detail = JSON.parse(result.receipt.receipt_json), objects = result.chart.objects, holds = objects.filter(o => o.end_ms !== undefined).length;
    phase.seconds[GenerationPhase.ROWS] = detail.seconds.rows;
    phase.seconds[GenerationPhase.ARRANGEMENT] = detail.seconds.prior + detail.seconds.arrangement;
    phase.seconds[GenerationPhase.EXPORT] = detail.seconds.export;
    finishRun();
    for (const url of urls) URL.revokeObjectURL(url);
    const name = `${done.artist ? `${done.artist} - ` : ''}${done.title} (ensomi R2 s${done.seed})`.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim().slice(0, 120);
    const osz = URL.createObjectURL(new Blob([result.osz! as BlobPart], { type: 'application/zip' })), osu = URL.createObjectURL(new Blob([result.osu], { type: 'text/plain' })), audio = URL.createObjectURL(done.song.file);
    urls = [osz, osu, audio];
    Object.assign($<HTMLAnchorElement>('get-osz'), { href: osz, download: `${name}.osz` });
    Object.assign($<HTMLAnchorElement>('get-osu'), { href: osu, download: `${name}.osu` });

    const facts: [string, string][] = [
        [t.receipt.model, `${result.receipt.model_name} ${result.receipt.model_version}`],
        [t.receipt.provider, providerName(provider)],
        [t.receipt.song, `${done.song.file.name} · ${clock(done.song.durationMs)}`],
        [t.receipt.star, t.starResult(maniaStar(objects).toFixed(2), done.star.toFixed(1))],
        [t.receipt.seed, done.random ? t.randomSeed(String(done.seed)) : String(done.seed)],
        [t.receipt.notes, t.noteCounts(objects.length.toLocaleString('en'), (objects.length - holds).toLocaleString('en'), holds.toLocaleString('en'))],
        [t.receipt.headRows, Number(detail.rows.K).toLocaleString('en')],
        [t.receipt.tempo, detail.rows.segments.map((s: number[]) => (60000 / s[1]).toFixed(1)).join(', ') + ' BPM'],
        [t.receipt.sections, done.sections.length ? String(done.sections.length) : t.none],
    ];
    if (done.prep.decode) facts.push([t.receipt.timing, t.exactFrom(done.prep.decode.rate)]);
    $('receipt').replaceChildren(...facts.flatMap(([label, value]) => {
        const dt = document.createElement('dt'), dd = document.createElement('dd');
        dt.textContent = label;
        dd.textContent = value;
        return [dt, dd];
    }));
    // The audio stages ran when the song was chosen; the receipt times the stages after them, and its total is theirs.
    const { decode } = done.prep, stages = done.prep.seconds!;
    const rows: [string, number, boolean?][] = [[t.modelLoad, loadSeconds], [t.audioDecode, done.song.decodeSeconds], ...(decode ? [[t.exactDecode, decode.seconds] as [string, number]] : []), [t.times.pcm, stages.pcm], [t.times.timing, stages.timing], ...RECEIPT_TIMES.map((key): [string, number] => [t.times[key], detail.seconds[key]]), [t.total, detail.seconds.total, true]];
    $('times').replaceChildren(...rows.map(([label, seconds, total]) => {
        const tr = document.createElement('tr'), th = document.createElement('th'), td = document.createElement('td');
        th.scope = 'row';
        th.textContent = label;
        td.textContent = `${seconds.toFixed(2)} s`;
        if (total) tr.className = 'total';
        tr.append(th, td);
        return tr;
    }));
    $('times-total').textContent = t.generatedIn(detail.seconds.total.toFixed(1));

    player.audio.src = audio;
    player.load({ chart: result.chart, segments: detail.rows.segments, sections: done.sections });
    $('identity').textContent = [done.title, done.artist, `ensomi R2 s${done.seed}`].filter(Boolean).join(' · ');
    $('result').hidden = false;
    $('run-status').textContent = t.doneIn(detail.seconds.total.toFixed(1));
    update();
    $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Inspector controls
$('play').addEventListener('click', () => player.toggle());
$('restart').addEventListener('click', () => player.restart());
// A new result's audio stops playback without a pause event (the media element load algorithm fires emptied instead).
function showPlaying() {
    const playing = !player.audio.paused;
    $('play').textContent = playing ? t.pause : t.play;
    $('play').setAttribute('aria-pressed', String(playing));
}
for (const type of ['play', 'pause', 'emptied']) player.audio.addEventListener(type, showPlaying);

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
// Volume only scales the file down: the slider runs 0 to 100% and an audio element's volume tops out at 1.
const volume = field('volume');
function setVolume() {
    const percent = Number(volume.value), text = `${percent}%`;
    player.audio.volume = percent / 100;
    $('volume-value').textContent = text;
    volume.setAttribute('aria-valuetext', text);
}
volume.addEventListener('input', setVolume);
setVolume();

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
