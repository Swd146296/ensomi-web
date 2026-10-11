import { open, readFile, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { arrayFromBytes, tensorType, type ArraySpec } from '../src/binary.js';
import type { Ort } from '../src/models.js';
interface RecordedArray extends ArraySpec {
    name: string;
    file: string;
    byte_offset: number;
    nbytes: number;
}
export interface GraphCall {
    name: string;
    scope: string;
    step: number;
    inputs: Record<string, number>;
    outputs: Record<string, number>;
}
export interface Draw {
    name: string;
    kind: string;
    values: number;
    chosen: number;
    scores: number;
}
export class Recording {
    constructor(readonly index: {
        arrays: RecordedArray[];
        graphs: GraphCall[];
        events: {
            name: string;
            arrays: Record<string, number>;
        }[];
        draws: Draw[];
    }, readonly file: FileHandle) { }
    static async open(directory: string) {
        const index = JSON.parse(await readFile(join(directory, 'index.json'), 'utf8'));
        if (index.format !== 'ensomi-runtime-reference-v1')
            throw new Error('Unsupported reference format');
        return new Recording(index, await open(join(directory, 'arrays.bin'), 'r'));
    }
    async get(id: number) {
        const e = this.index.arrays[id], bytes = new Uint8Array(e.nbytes);
        await this.file.read(bytes, 0, e.nbytes, e.byte_offset);
        return arrayFromBytes(bytes, e.dtype);
    }
    async tensor(id: number, ort: Ort) {
        const e = this.index.arrays[id];
        return new ort.Tensor(tensorType(e.dtype) as any, await this.get(id) as any, e.shape);
    }
    async event(name: string) {
        const e = this.index.events.find(x => x.name === name)!;
        return Object.fromEntries(await Promise.all(Object.entries(e.arrays).map(async ([k, v]) => [k, await this.get(v)])));
    }
    close() { return this.file.close(); }
}
