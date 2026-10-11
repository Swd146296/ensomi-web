// system/arrange.py: legality, playability, restoring force, control tilts, releases and commit.
import type { Models } from './models.js';
import type { Grid } from './grid.js';
import type { RandomSource } from './random.js';
import type { Trace } from './rows.js';
import { f32, clip, mean } from './math.js';
import { actionTables, Playability, logNormalize, fallbackAction, rowRange, transition, CHANCE, chordFeature, logit, tilt, scopeStatistics, SUBTYPES, type PatternScope } from './controls.js';
import { ChartState, buildCandidates, type Candidates } from './r2/features.js';
import { R2Stepper } from './r2/stepper.js';
import { StrainState, referenceWorkload } from './strain.js';
function logSoftmax32(logits: Float32Array, support: boolean[]): Float32Array {
    let max = -Infinity;
    for (let i = 0; i < logits.length; i++)
        if (support[i])
            max = Math.max(max, logits[i]);
    let total = 0;
    for (let i = 0; i < logits.length; i++)
        if (support[i])
            total += f32(Math.exp(f32(logits[i] - max)));
    const z = f32(Math.log(f32(total)));
    return logits.map((x, i) => support[i] ? f32(f32(x - max) - z) : -Infinity);
}
export async function arrange(models: Models, headMs: number[], songMs: number, grid: Grid, random: RandomSource, options: {
    target: number[];
    kappa?: number[];
    lnFraction?: number;
    requests?: PatternScope[];
    masks: Record<string, any>;
    prefix: string;
    trace?: Trace;
}) {
    const K = headMs.length, actions = models.manifest.constants['r2.common'].ACTIONS as number[][], tables = actionTables(actions), chart = new ChartState(headMs, songMs, grid), stepper = new R2Stepper(models), guard = new Playability(options.masks);
    await stepper.initialize();
    const kappa = options.kappa ?? [3, 3, 3], lnFraction = options.lnFraction ?? 1, streamRows = new Uint8Array(K), trace = options.trace;
    const scopes = (options.requests ?? []).map(request => {
        const [lo, hi] = rowRange(headMs, request.a_ms, request.b_ms, songMs);
        if (request.concept === 'stream' || 'chord_target' in request)
            streamRows.fill(1, lo, hi);
        return { request, lo, hi, N: Math.max(0, hi - Math.max(1, lo)), n: 0, readout: 0, expected: 0, expectedChance: 0, chordN: hi - lo, chordNSeen: 0, chordSuccess: 0, chordProbability: 0, gains: [] as number[], chordGains: [] as number[], attainable: [] as number[], classError: 0, chordClassError: 0 };
    });
    const fallbacks: Record<string, any>[] = [], maskFirings = [0, 0, 0];
    let strain = new StrainState(), workload = 0;
    for (let k = 0; k <= K; k++) {
        const held = chart.held[k], pattern = held.reduce((s, h, l) => s + h * (1 << l), 0), table = tables[pattern], { heads, ln, features } = table;
        const support = actions.map((codes, i) => k === K ? codes.every((c, l) => c === (held[l] ? 2 : 0)) : codes.every((c, l) => held[l] || c <= 2) && heads[i].some(Boolean));
        const output = await stepper.predict(chart, k), plain = logSoftmax32(output.action_logits.data as Float32Array, support);
        await trace?.(`${options.prefix}/${k}/support`, { held, mask: support.map(Number), log_probability: plain });
        let logp: Float32Array | Float64Array = plain, fallback: number | null = null;
        if (k < K) {
            logp = Float64Array.from(plain);
            if (lnFraction === 0)
                for (let i = 0; i < logp.length; i++)
                    if (ln[i].some(Boolean))
                        logp[i] = -Infinity;
            const legal = logp.slice();
            await trace?.(`${options.prefix}/${k}/tap_mask`, { log_probability: logp });
            const rejected = guard.rejections(chart, k, heads), rejectArrays = Object.values(rejected);
            rejectArrays.forEach((bad, j) => { if (bad.some((v, i) => v && Number.isFinite(logp[i])))
                maskFirings[j]++; });
            for (let i = 0; i < logp.length; i++)
                if (rejectArrays.some(bad => bad[i]))
                    logp[i] = -Infinity;
            await trace?.(`${options.prefix}/${k}/playability`, { log_probability: logp, ...Object.fromEntries(Object.entries(rejected).map(([name, bad]) => [name, bad.map(Number)])) });
            if (!logp.some(Number.isFinite)) {
                const elapsed = chart.lastAttack[k].map(t => headMs[k] - t);
                fallback = fallbackAction(legal, heads, elapsed);
                const lane = heads[fallback].findIndex(Boolean);
                fallbacks.push({ row: k, time_ms: headMs[k], lane, elapsed_ms: elapsed[lane], floor_ms: options.masks.reattack_floor_ms, action_index: fallback, action: actions[fallback], held_on_entry: held.map(Boolean), selected_lane_held: Boolean(held[lane]), violated_masks: Object.keys(rejected).filter(name => rejected[name][fallback!]) });
                logp[fallback] = 0;
            }
            logp = logNormalize(logp);
        }
        await trace?.(`${options.prefix}/${k}/masked`, { log_probability: logp, fallback: fallback ?? -1 });
        if (k < K && k && kappa.some(Boolean)) {
            const start = Math.max(0, k - 64), n = k - start, running = [(chart.cumHeld[k] - chart.cumHeld[start]) / (4 * n), (chart.cumHeads[k] - chart.cumHeads[start]) / n, (chart.busy[k] - chart.busy[start]) / n], gains = kappa.slice();
            const include = Array.from({ length: n }, (_, j) => start + j).filter(j => !streamRows[j]);
            if (streamRows[k] || !include.length)
                gains[1] = 0;
            else if (include.length !== n)
                running[1] = mean(include.map(j => chart.attack[j].reduce((a, b) => a + b, 0)));
            const force = running.map((r, j) => gains[j] * (r - options.target[j]));
            logp = Float64Array.from(logp, (x, i) => x - features[i].reduce((s, v, j) => s + v * force[j], 0));
        }
        await trace?.(`${options.prefix}/${k}/force`, { log_probability: logp });
        let candidates: Candidates | undefined;
        const getCandidates = () => candidates ??= buildCandidates(headMs[k - 1], chart.time(k), grid);
        let active: typeof scopes[number] | undefined, conceptFeature: boolean[] | undefined, allowed: boolean[] | undefined;
        if (k < K)
            for (const scope of scopes) {
                if (k < scope.lo || k >= scope.hi)
                    continue;
                const r = scope.request, visible = !held.some(Boolean) || getCandidates().times[0] >= r.a_ms;
                let base = logNormalize(logp);
                if ('chord_target' in r) {
                    const cf = features.map(f => chordFeature(f[1], r.subtype!));
                    scope.chordProbability += Array.from(base, (x, i) => cf[i] ? Math.exp(x) : 0).reduce((a, b) => a + b, 0);
                    if (visible) {
                        const needed = (scope.chordN * r.chord_target - scope.chordSuccess) / (scope.chordN - scope.chordNSeen), weight = clip(logit(needed) - logit(scope.chordProbability / (scope.chordNSeen + 1)), -8, 8), changed = tilt(base, cf, table.groups.chord, weight);
                        scope.chordGains.push(weight);
                        scope.chordClassError = Math.max(scope.chordClassError, changed.error);
                        if (weight) {
                            base = changed.logp;
                            logp = base;
                        }
                    }
                    await trace?.(`${options.prefix}/${k}/chord`, { log_probability: logp });
                }
                if (k) {
                    const previous = chart.attack[k - 1], before = chart.attack[k - 2], previousCount = previous.reduce((a, b) => a + b, 0), eligible = heads.map(h => h.map((v, l) => Number(v && !held[l])));
                    conceptFeature = eligible.map(h => transition(h, previous, before)[r.concept === 'jack' ? 0 : 1] && h.some(Boolean));
                    allowed = Array.from(base, Number.isFinite);
                    const chance = features.map(f => CHANCE[previousCount][f[1]]), readout = heads.map((h, i) => { const [jack, stream] = transition(h, previous, before); return r.concept === 'jack' ? Number(jack) - chance[i] : Number(stream); });
                    let expected = 0, expectedChance = 0;
                    for (let i = 0; i < base.length; i++) {
                        const mass = Math.exp(base[i]);
                        expected += mass * readout[i];
                        expectedChance += mass * chance[i];
                    }
                    if (visible && !r.chord_only) {
                        let weight = 0;
                        if ('w' in r)
                            weight = r.w;
                        else if (scope.n) {
                            const offset = r.concept === 'jack' ? scope.expectedChance / scope.n : 0, needed = (scope.N * r.target - scope.readout) / (scope.N - scope.n);
                            weight = clip(logit(needed + offset) - logit(scope.expected / scope.n + offset), -8, 8);
                        }
                        const group = r.concept === 'stream' && r.subtype ? 'stream_subtype' : r.concept, changed = tilt(base, conceptFeature, table.groups[group], weight);
                        scope.gains.push(weight);
                        scope.classError = Math.max(scope.classError, changed.error);
                        if (weight)
                            logp = changed.logp;
                        await trace?.(`${options.prefix}/${k}/concept`, { log_probability: logp });
                    }
                    scope.expected += expected;
                    scope.expectedChance += expectedChance;
                }
                active = scope;
                break;
            }
        const normalized = logNormalize(logp);
        await trace?.(`${options.prefix}/${k}/final_probability`, { log_probability: normalized, probability: normalized.map(Math.exp) });
        const chosen = fallback ?? await random.gumbel(logp, `${options.prefix}/${k}/action`), codes = actions[chosen], orientation = await random.orientation(`${options.prefix}/${k}/orientation`), lanes = [0, 1, 2, 3].filter(l => held[l] && codes[l] >= 2), releases = [NaN, NaN, NaN, NaN];
        if (orientation)
            lanes.reverse();
        if (lanes.length) {
            const placed = new Map<number, [
                number,
                boolean
            ]>();
            for (let l = 0; l < 4; l++)
                if (held[l] && codes[l] === 1)
                    placed.set(l, [chart.time(k), true]);
            const cands = getCandidates();
            for (const lane of lanes) {
                const scores = await stepper.release(output.hands, chart, k, codes, lane, orientation, placed, cands), index = await random.gumbel(scores, `${options.prefix}/${k}/release_${lane}`), u = cands.times[index];
                releases[lane] = u;
                placed.set(lane, [u, false]);
                await trace?.(`${options.prefix}/${k}/release_${lane}`, { candidates: cands.times, scores, chosen: u });
            }
        }
        await trace?.(`${options.prefix}/${k}/chosen`, { index: chosen, codes, orientation, releases });
        chart.append(codes, releases);
        if (k < K) {
            const actual = chart.attack[k];
            guard.observe(actual);
            const [next, charge] = strain.append(headMs[k], actual);
            strain = next;
            workload += charge;
            if (active) {
                const r = active.request;
                if (k) {
                    const previous = chart.attack[k - 1], [jack, stream] = transition(actual, previous, chart.attack[k - 2]), chance = CHANCE[previous.reduce((a, b) => a + b, 0)][actual.reduce((a, b) => a + b, 0)];
                    active.readout += r.concept === 'jack' ? Number(jack) - chance : Number(stream);
                    active.n++;
                    active.attainable.push(Number(allowed!.some((v, i) => v && conceptFeature![i] && (r.concept !== 'stream' || features[i][1] === actual.reduce((a, b) => a + b, 0)))));
                }
                if ('chord_target' in r) {
                    active.chordSuccess += Number(chordFeature(actual.reduce((a, b) => a + b, 0), r.subtype!));
                    active.chordNSeen++;
                }
            }
            await stepper.commit(chart, k);
        }
    }
    const requests = scopes.map(s => {
        const r = s.request, stats = scopeStatistics(chart, r.a_ms, r.b_ms), achieved = stats[r.concept === 'stream' ? 'S' : 'J_ex'], inBand = r.band ? r.band[0] <= r.target && r.target <= r.band[1] && (r.preset_in_band ?? true) : null;
        const rec: any = { ...r, ...stats, achieved, loop: 'new', in_band: inBand, target_error: achieved === null ? null : achieved - r.target, attainable_maximum: s.attainable.length ? mean(s.attainable) : null, attainable_statistic: r.concept === 'jack' ? 'raw_J' : 'raw_S', bound_share: s.gains.length ? mean(s.gains.map(x => Number(Math.abs(x) >= 8))) : null, visible_decisions: s.gains.length, max_class_marginal_error: s.classError, fallback_count: fallbacks.filter(f => f.row >= s.lo && f.row < s.hi).length, stream_statistic: r.concept === 'stream' ? 'S_prime' : null, band_status: r.band ? (inBand ? 'in band' : 'out of band, playability not promised') : 'not resolved' };
        if ('chord_target' in r) {
            const chord = (stats as Record<string, any>)[SUBTYPES[r.subtype!].share];
            Object.assign(rec, { chord_achieved: chord, chord_error: chord === null ? null : chord - r.chord_target, chord_in_band: r.chord_band[0] <= r.chord_target && r.chord_target <= r.chord_band[1] && (r.preset_in_band ?? true), chord_bound_share: s.chordGains.length ? mean(s.chordGains.map(x => Number(Math.abs(x) >= 8))) : null, chord_visible_decisions: s.chordGains.length, in_scope_decisions: s.hi - s.lo, max_chord_class_marginal_error: s.chordClassError });
        }
        return rec;
    });
    return { chart, actions: chart.actions, gap: chart.gap, r: Math.sqrt(workload / referenceWorkload(headMs)), fallbackCount: fallbacks.length, fallbacks, maskFirings, requests };
}
