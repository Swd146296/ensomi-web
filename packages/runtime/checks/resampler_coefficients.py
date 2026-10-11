"""Build the polyphase FIR tables used by the reference's soxr HQ resampling.
Run with ensomi-model's Python environment. No reference song data enters these tables.
"""
import json, math
from pathlib import Path
import numpy as np
import soxr

root = Path(__file__).resolve().parents[1] / 'assets'
for sr in [11025, 16000, 24000, 32000, 44100, 48000, 88200, 96000, 192000]:
    target = 22050
    divisor = math.gcd(sr, target)
    p, q = sr // divisor, target // divisor
    radius = math.ceil(max(1, sr / target) * 128)
    center = p * math.ceil((radius * 2 + 256) / p)
    samples = center * 2 + p
    impulses = np.zeros((samples, p), dtype=np.float64)
    impulses[center + np.arange(p), np.arange(p)] = 1
    response = soxr.resample(impulses, sr, target, quality='HQ')
    kernels = np.empty((q, 2 * radius + 1), np.float64)
    for m in range(q):
        integral, phase = divmod(m * p, q)
        for j in range(-radius, radius + 1):
            periods, channel = divmod(integral + j, p)
            kernels[phase, j + radius] = response[center * q // p + m - periods * q, channel]
    (root / f'resample-{sr}.bin').write_bytes(kernels.astype('<f8').tobytes())
    boundary_frames = 128
    boundary_samples = math.ceil(boundary_frames * p / q) + radius
    impulses = np.zeros((max(samples, boundary_samples * 2), boundary_samples), dtype=np.float64)
    impulses[np.arange(boundary_samples), np.arange(boundary_samples)] = 1
    boundary = soxr.resample(impulses, sr, target, quality='HQ')[:boundary_frames]
    (root / f'resample-{sr}-boundary.bin').write_bytes(boundary.astype('<f8').tobytes())
    spec = dict(sample_rate=sr, target_rate=target, numerator=p, phases=q, radius=radius,
                dtype='float64', shape=list(kernels.shape), file=f'resample-{sr}.bin',
                boundary_frames=boundary_frames, boundary_samples=boundary_samples, boundary_file=f'resample-{sr}-boundary.bin',
                algorithm='soxr HQ polyphase FIR', soxr_version=soxr.__version__)
    (root / f'resample-{sr}.json').write_text(json.dumps(spec, indent=2) + '\n')
    # Independent broadband input, including zero padding at both ends.
    x=np.random.default_rng(10).normal(size=10000)
    expected=soxr.resample(x,sr,target,quality='HQ'); actual=np.zeros_like(expected)
    for m in range(len(actual)):
        integral,phase=divmod(m*p,q)
        js=np.arange(max(-radius,-integral),min(radius,len(x)-1-integral)+1)
        actual[m]=np.dot(x[:boundary_samples],boundary[m]) if m<boundary_frames else np.dot(x[integral+js],kernels[phase,js+radius])
    print(sr, kernels.shape, 'max_abs', np.max(np.abs(actual-expected)), flush=True)
