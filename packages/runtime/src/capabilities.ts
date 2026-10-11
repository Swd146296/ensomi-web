import { ControlStatus as S, type ModelCapabilities } from './types.js';
export function capabilities(paths: string[]): ModelCapabilities {
    return { model_name: 'Ensomi R2', model_version: 'r2-1.0', files: paths.map(path => ({ path, sha256_hex: '' })), min_star: 2, max_star_exclusive: 6, controls: [
            { name: 'star', status: S.WORKS, note: 'Whole-song star rating; both blind pairs called the right way.' },
            { name: 'jumpstream', status: S.WORKS, note: 'A span of 8 to 32 seconds in that style; works in blind pairs.' },
            { name: 'chordstream', status: S.WORKS, note: 'A span of 8 to 32 seconds in that style; works in blind pairs.' },
            { name: 'stream', status: S.EXPERIMENTAL, note: 'Reaches its target band in measurement (48 of 48 runs); not screened on its own.' },
            { name: 'jack', status: S.EXPERIMENTAL, note: 'Reaches its target band in measurement (35 of 48 runs); not screened on its own.' },
            { name: 'section_star', status: S.EXPERIMENTAL, note: 'An absolute star target for one span; not screened, and easier spans land short.' },
            { name: 'chordjack', status: S.NOT_WORKING, note: 'Out of band on generated rows (18 of 28 runs).' },
            { name: 'long_notes', status: S.NOT_WORKING, note: 'Tap only, half or natural; half removes about a third and a blind pair could not tell.' },
        ] };
}
