import base64
import colorsys
from datetime import datetime, timezone, timedelta
from functools import lru_cache
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps

ASSETS=Path(__file__).resolve().parent.parent/'assets'
NATIVE_COLORS=['#ff0000','#00ff00','#0000ff','#ffff00','#ff00ff','#00ffff','#ffffff']

@lru_cache(maxsize=48)
def font(size, chinese=False):
    name='NotoSansCJKsc-Regular.otf' if chinese else 'DejaVuSansMono.ttf'
    return ImageFont.truetype(str(ASSETS/name),size)

def render_oled(config, metrics, now=None):
    now=now or datetime.now(timezone(timedelta(hours=8)))
    image=Image.new('1',(128,32))
    if not config['enabled']: return image.tobytes()
    draw=ImageDraw.Draw(image)
    mode=config['mode']
    if mode=='carousel': mode=['system','clock','text'][(int(now.timestamp())//10)%3]
    if mode=='pixel':
        image=Image.frombytes('1',(128,32),base64.b64decode(config['pixels']))
    elif mode=='text':
        text=config['text']
        f=font(config['font_size'],any(ord(c)>127 for c in text))
        for line_index,line in enumerate(text.split('\n')):
            draw.text((config['x'],config['y']+line_index*(config['font_size']+1)),line,font=f,fill=1,anchor='lt')
    elif mode=='clock':
        # Position by visible glyph bounds, keeping a two-pixel panel margin.
        for text,size,top in [(now.strftime('%H:%M:%S'),22,2),(now.strftime('%Y.%m.%d  %a'),8,24)]:
            f=font(size)
            left,upper,right,lower=draw.textbbox((0,0),text,font=f)
            x=(128-(right-left))//2-left
            draw.text((x,top-upper),text,font=f,fill=1)
    else:
        temp=metrics.get('temperature')
        rpm=metrics.get('cpu_fan_rpm')
        draw.text((0,0),'PI CONTROL',font=font(9),fill=1,anchor='lt')
        draw.text((0,11),f'CPU {temp:.1f} C' if temp is not None else 'CPU -- C',font=font(9),fill=1,anchor='lt')
        draw.text((0,22),f'FAN {rpm or 0} RPM',font=font(9),fill=1,anchor='lt')
        draw.text((86,0),now.strftime('%H:%M'),font=font(8),fill=1,anchor='lt')
    if config['invert']: image=ImageOps.invert(image.convert('L')).convert('1')
    return image.tobytes()

def light_frame(config, elapsed):
    if not config['enabled']: return ['#000000']*14
    # Firmware animation has no frame readback; return its selected palette only.
    if config['effect']=='native_breathe':return [NATIVE_COLORS[config['native_color']]]*14
    factor=config['brightness']/100
    phase=elapsed*config['speed']
    out=[]
    for i,color in enumerate(config['colors']):
        rgb=[int(color[p:p+2],16)/255 for p in (1,3,5)]
        gain=factor
        if config['effect']=='rainbow': rgb=colorsys.hsv_to_rgb((i/14+phase/12)%1,0.75,1)
        elif config['effect']=='chase': gain*=max(0.025,1-((phase*3-i)%14)/4)
        out.append('#'+''.join(f'{max(0,min(255,round(v*gain*255))):02x}' for v in rgb))
    return out
