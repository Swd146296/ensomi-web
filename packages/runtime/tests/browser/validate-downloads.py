"""Independent .osz CRC and .osu hit-object validation, using Python's zip reader."""
import json
from pathlib import Path
from zipfile import ZipFile
root = Path(__file__).resolve().parents[2] / 'artifacts' / 'browser-test'
results = []
for path in sorted((root / 'bulk').glob('*.osz')):
    chart_path = path.with_name(path.stem + '-chart.json')
    if not chart_path.exists():
        continue
    chart = json.loads(chart_path.read_text())
    with ZipFile(path) as archive:
        bad_crc = archive.testzip()
        text = archive.read('generated.osu').decode()
        receipt = json.loads(archive.read('receipt.json'))
        objects = []
        for line in text.split('[HitObjects]\n')[1].strip().splitlines():
            fields = line.split(',')
            obj = dict(lane=(int(fields[0]) - 64) // 128, start_ms=int(fields[2]))
            if int(fields[3]) & 128:
                obj['end_ms'] = int(fields[5].split(':')[0])
            objects.append(obj)
        row = dict(file=str(path.relative_to(root)), crc_ok=bad_crc is None,
                   chart_equal=objects == chart['objects'],
                   direct_osu_equal=text == path.with_suffix('.osu').read_text(),
                   mania_mode='Mode:3' in text, four_keys='CircleSize:4' in text,
                   finalized=receipt['export']['replay_finalized'], objects=len(objects))
        results.append(row)
(root / 'download-validation.json').write_text(json.dumps(results, indent=2) + '\n')
failures = [r for r in results if any(r[k] is False for k in r)]
print(f'{len(results)} archives checked; {len(failures)} failures')
raise SystemExit(bool(failures))
