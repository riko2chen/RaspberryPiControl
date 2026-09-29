"""Read the running kernel's fan policy; no sysfs writes or guessed thresholds."""
from pathlib import Path
import struct

FAN_PRESETS=[
    {'id':'quiet','name':'安静','description':'低温轻转，升温后逐步加强散热','curve':[(35,1),(45,2),(55,4),(65,7),(75,10)]},
    {'id':'balanced','name':'均衡','description':'日常使用，兼顾风量与噪声','curve':[(35,2),(45,4),(55,6),(65,8),(75,10)]},
    {'id':'cool','name':'散热优先','description':'更早提高风量，适合持续负载','curve':[(35,3),(45,5),(55,7),(65,9),(70,10)]},
]
FAN_PRESETS=[{**{k:v for k,v in p.items() if k!='curve'},'config':{'mode':'auto','level':4,'curve':[{'temperature':t,'level':l} for t,l in p['curve']]}} for p in FAN_PRESETS]

def cpu_fan_policy(sysroot:Path):
    result={'available':False,'steps':[],'state':None,'max_state':None}
    try:
        zone=next(p for p in (sysroot/'class/thermal').glob('thermal_zone*') if (p/'type').read_text().strip()=='cpu-thermal')
        device=next(p for p in (sysroot/'class/thermal').glob('cooling_device*') if (p/'type').read_text().strip()=='pwm-fan')
        result.update(state=int((device/'cur_state').read_text()),max_state=int((device/'max_state').read_text()))
        raw=(sysroot/'firmware/devicetree/base/cooling_fan/cooling-levels').read_bytes()
        levels=struct.unpack('>'+('I'*(len(raw)//4)),raw)
        trips=[]
        for p in zone.glob('trip_point_*_type'):
            if p.read_text().strip()!='active':continue
            stem=p.name.removesuffix('_type')
            temp=int((zone/(stem+'_temp')).read_text())/1000
            hyst=int((zone/(stem+'_hyst')).read_text())/1000
            trips.append((temp,hyst))
        trips.sort()
        if len(trips)+1!=len(levels):return result
        result['steps']=[{'temperature':t,'hysteresis':h,'pwm':levels[i+1],'percent':round(levels[i+1]/255*100)} for i,(t,h) in enumerate(trips)]
        result['available']=True
    except (OSError,ValueError,StopIteration,struct.error):pass
    return result
