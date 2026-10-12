/** Prints load, generation wall and receipt phase seconds, the chart hash and the session's peak renderer RSS from page-matrix JSON files: node tests/browser/speed-summary.mjs <files...> */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
const phases = ['spectrogram', 'beatthis', 'mel', 'grid', 'rows', 'arrangement', 'total'];
console.log(['file', 'song', 'cache', 'provider', 'load', 'wall', ...phases, 'objects', 'chart', 'renderer GiB'].join('\t'));
for (const file of process.argv.slice(2)) {
    const report = JSON.parse(readFileSync(file, 'utf8'));
    for (const run of report.runs) {
        const load = report.loads[run.warm ? 1 : 0];
        const s = run.detail?.seconds ?? {}, loaded = load?.events.find(e => e.type === 'loaded');
        console.log([basename(file, '.json'), run.song, run.warm ? 'warm' : 'cold', `${loaded?.provider}/${loaded?.threads ?? 1}`, load?.wallSeconds.toFixed(2), run.wallSeconds.toFixed(2), ...phases.map(p => s[p]?.toFixed(3)), run.detail?.export.objects, (run.chartSha256 ?? run.error ?? '').slice(0, 16), (report.memory.rendererPeakKiB / 2 ** 20).toFixed(2)].join('\t'));
    }
    if (report.failure) console.log(basename(file), 'FAILURE', report.failure);
}
