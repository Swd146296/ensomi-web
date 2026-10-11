"""Read-only intermediate oracle for diagnosing the TypeScript grid fitter."""
import json, os, time
from pathlib import Path
import numpy as np
from ensomi_model.export.recording import Recording
from ensomi_model.audio_rows.fitter import GridFitterConfig
from ensomi_model.audio_rows.fitter.segment_fit import _fit_segment_range
from ensomi_model.audio_rows.fitter.splitting import _split_segment_range
from ensomi_model.audio_rows.fitter.alias import _canonicalize_tempo_aliases
from ensomi_model.audio_rows.fitter.segments import _timing_segments_from_fits
from ensomi_model.audio_rows.fitter.refinement import _refine_timing_segments
from ensomi_model.audio_rows.fitter.peaks import refine_segments, downbeat_phase
from ensomi_model.audio_rows.fitter.mel_phase import mel_phase, mel_tempo
from dataclasses import asdict
root=Path(os.environ.get('ENSOMI_REFERENCE_DIR','../ensomi-model/artifacts/runtime-ref'))
report={}
for song in ['hesitation-snow','saigetsu','catch-the-moment','adventure']:
    r=Recording(root/'bulk'/song);e=r.event('listener');c=GridFitterConfig()
    s=e['beat_probability'].astype(np.float64);d=e['downbeat_probability'].astype(np.float64);t=np.arange(len(s))/50*1000
    f=_fit_segment_range(s,frame_times_ms=t,downbeat_signal=d,start_frame=0,end_frame=len(s),config=c)
    splits=_split_segment_range(s,frame_times_ms=t,downbeat_signal=d,fit=f,config=c,remaining_splits=c.max_segments-1)
    aliases=_canonicalize_tempo_aliases(splits,s,frame_times_ms=t,downbeat_signal=d,config=c)
    raw=_timing_segments_from_fits(aliases,t,config=c)
    legacy=_refine_timing_segments(raw,t,beat_signal=s,config=c)
    peaks=refine_segments(legacy,e['beat_logits'],50)
    down=downbeat_phase(peaks,e['beat_logits'],e['downbeat_logits'],50)
    phase=mel_phase(down,e['log_mel'],e['beat_logits'],50,float(e['song_ms']))
    tempo=mel_tempo(phase,e['log_mel'],e['beat_logits'],50,float(e['song_ms']))
    report[song]=dict(initial=asdict(f),**{k:[asdict(x) for x in v] for k,v in dict(splits=splits,aliases=aliases,raw=raw,legacy=legacy,peaks=peaks,downbeat=down,mel_phase=phase,mel_tempo=tempo).items()})
    print(song,report[song]['mel_tempo'],flush=True)
Path('packages/runtime/artifacts/python-grid.json').write_text(json.dumps(report,indent=2)+'\n')
