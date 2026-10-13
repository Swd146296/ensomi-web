// Checks the translated pages against the English one: the same element ids in the same order (app.ts looks them
// up), and the statement and its Japanese line unchanged.   node site/check-pages.mjs
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../public/${path}`, import.meta.url), 'utf8');
const ids = html => [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
const statement = html => [/<h1[^>]*>([\s\S]*?)<\/h1>/, /<p class="jp" lang="ja">([\s\S]*?)<\/p>/].map(re => html.match(re)?.[1]);

const en = read('index.html');
let failed = false;
for (const path of ['ja/index.html', 'zh/index.html']) {
    const page = read(path), problems = [];
    if (ids(page).join() !== ids(en).join()) problems.push(`ids differ from index.html: ${ids(page).filter((id, i) => id !== ids(en)[i]).slice(0, 5).join(', ')}`);
    if (statement(page).join() !== statement(en).join()) problems.push('the statement or its Japanese line differs from index.html');
    console.log(problems.length ? `${path}: ${problems.join('; ')}` : `${path}: ok`);
    failed ||= problems.length > 0;
}
process.exitCode = failed ? 1 : 0;
