import { clip, quantile } from './math.js';
import type { arrange } from './arrange.js';
type Arrangement = Awaited<ReturnType<typeof arrange>>;
export async function difficultyPasses(run: (multiplier: number, pass: number) => Promise<Arrangement>, cal: Record<string, any>, band: number, q: number, baseR: number) {
    const values = cal.difficulty[String(band)].values, target = quantile(values, q), fit = cal.difficulty_fit.by_band[String(band)], lo = cal.difficulty_fit.domain[0], hi = Math.min(cal.difficulty_fit.domain[1], 1.2);
    const raw = Math.exp((Math.log(target) - fit.alpha - fit.gamma * Math.log(baseR)) / fit.beta);
    let multiplier = clip(raw, lo, hi), result!: Arrangement;
    const passes = [];
    for (let attempt = 0; attempt < 2; attempt++) {
        const start = performance.now();
        result = await run(multiplier, attempt + 1);
        passes.push({ multiplier, achieved: result.r, fallback_count: result.fallbackCount, wall_seconds: (performance.now() - start) / 1000 });
        if (attempt || Math.abs(result.r - target) <= fit.seed_sd)
            break;
        const corrected = clip(multiplier * Math.exp((Math.log(target) - Math.log(result.r)) / fit.beta), lo, hi);
        if (corrected === multiplier)
            break;
        multiplier = corrected;
    }
    return { result, multiplier, info: { q, target_r: target, band: [quantile(values, 0.05), quantile(values, 0.95)], map_band: band, base_r: baseR, base_r_source: 'prior', fit, m_requested: raw, domain: [lo, hi], clamped: raw < lo || raw > hi, m_final: multiplier, achieved_r: result.r, error: result.r - target, within_seed_sd: Math.abs(result.r - target) <= fit.seed_sd, passes, tested_band_q: [0.1, 0.75], above_tested_band: q > 0.75 } };
}
