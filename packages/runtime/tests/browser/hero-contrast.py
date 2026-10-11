"""Use CSS foreground colors and text-free screenshot backgrounds, not antialiased text RGB."""
import json,math,re
from pathlib import Path
from PIL import Image
root=Path(__file__).resolve().parents[2]/'artifacts'/'browser-test'
def luminance(c):
    q=[v/255 for v in c]
    q=[v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in q]
    return sum(v*w for v,w in zip(q,[.2126,.7152,.0722]))
def contrast(a,b):
    a,b=luminance(a),luminance(b)
    return (max(a,b)+.05)/(min(a,b)+.05)
results=[]
for page in json.loads((root/'bulk/hero-contrast-layout.json').read_text()):
    im=Image.open(root/page['original']).convert('RGB');bg=Image.open(root/page['background']).convert('RGB');scale=im.width/page['width'];nodes=[]
    for node in page['nodes']:
        fg=tuple(map(int,re.findall(r'\d+',node['color'])[:3]));minimum=99;sample=None;count=0
        for r in node['rects']:
            for y in range(max(0,math.floor(r['y']*scale)),min(im.height,math.ceil((r['y']+r['height'])*scale))):
                for x in range(max(0,math.floor(r['x']*scale)),min(im.width,math.ceil((r['x']+r['width'])*scale))):
                    # Locate solid ink pixels, then calculate contrast using CSS color against the hidden-text background.
                    if max(abs(a-b) for a,b in zip(im.getpixel((x,y)),fg))>10:continue
                    count+=1;background=bg.getpixel((x,y));value=contrast(fg,background)
                    if value<minimum:minimum=value;sample=dict(x=x,y=y,background=background,char=r['char'])
        required=3 if node['fontSize']>=24 or node['fontSize']>=18.6667 and node['fontWeight']>=700 else 4.5
        nodes.append({k:v for k,v in node.items() if k!='rects'}|dict(minimum=minimum,required=required,pass_=minimum>=required,pixels=count,worst=sample))
    results.append(dict(name=page['name'],nodes=nodes))
(root/'hero-contrast.json').write_text(json.dumps(results,ensure_ascii=False,indent=2)+'\n')
for page in results:
    print(page['name'],[(n['class'],round(n['minimum'],3),n['required'],n['worst']) for n in page['nodes'] if not n['pass_']])
