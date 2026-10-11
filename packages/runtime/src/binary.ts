/** Contiguous little-endian arrays from the release and reference manifests. */
export type NumericArray = Float32Array | Float64Array | BigInt64Array | Int32Array | Int16Array | Uint16Array | Uint8Array;
export interface ArraySpec {
    dtype: string;
    shape: number[];
    file?: string;
    path?: string;
}
export function arrayFromBytes(bytes: Uint8Array, dtype: string): NumericArray {
    const buffer = bytes.slice().buffer;
    switch (dtype) {
        case '<f4':
        case 'float32': return new Float32Array(buffer);
        case '<f8':
        case 'float64': return new Float64Array(buffer);
        case '<i8':
        case 'int64': return new BigInt64Array(buffer);
        case '<i4':
        case 'int32': return new Int32Array(buffer);
        case '<i2':
        case 'int16': return new Int16Array(buffer);
        case '<f2':
        case 'float16': return new Uint16Array(buffer);
        case '|u1':
        case '|b1':
        case 'uint8':
        case 'bool': return new Uint8Array(buffer);
        default: throw new Error(`Unsupported external array dtype: ${dtype}`);
    }
}
export function tensorType(dtype: string): string {
    return ({ '<f4': 'float32', '<f8': 'float64', '<i8': 'int64', '<i4': 'int32', '<i2': 'int16', '<f2': 'float16', '|u1': 'uint8', '|b1': 'bool' } as Record<string, string>)[dtype] ?? dtype;
}
