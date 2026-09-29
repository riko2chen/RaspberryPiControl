from __future__ import annotations
import base64
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

class Model(BaseModel):
    model_config = ConfigDict(extra='forbid')

class Point(Model):
    temperature: int = Field(ge=25, le=80)
    level: int = Field(ge=1, le=10)

class Fan(Model):
    mode: Literal['auto', 'manual'] = 'auto'
    level: int = Field(default=4, ge=0, le=10)
    curve: list[Point] = Field(default_factory=lambda: [Point(temperature=t,level=l) for t,l in [(35,2),(45,4),(55,6),(65,8),(75,10)]], min_length=2, max_length=8)
    @field_validator('curve')
    @classmethod
    def curve_order(cls, points):
        if any(a.temperature >= b.temperature or a.level > b.level for a,b in zip(points,points[1:])):
            raise ValueError('温控点的温度必须递增，档位不能递减')
        return points

class Lights(Model):
    enabled: bool = True
    effect: Literal['static', 'rainbow', 'chase', 'native_breathe'] = 'static'
    native_color: int = Field(default=1, ge=0, le=6)
    native_speed: int = Field(default=1, ge=1, le=3)
    brightness: int = Field(default=35, ge=0, le=100)
    speed: float = Field(default=1, ge=0.2, le=3, allow_inf_nan=False)
    colors: list[str] = Field(default_factory=lambda: ['#8cbaa8'] * 14, min_length=14, max_length=14)
    @field_validator('colors')
    @classmethod
    def colors_valid(cls, values):
        import re
        if any(not re.fullmatch(r'#[0-9a-fA-F]{6}',v) for v in values):
            raise ValueError('颜色必须是 #RRGGBB')
        return [v.lower() for v in values]

class Oled(Model):
    enabled: bool = True
    mode: Literal['system','clock','text','pixel','carousel'] = 'system'
    text: str = Field(default='你好，树莓派\nPI CONTROL', max_length=240)
    font_size: int = Field(default=12, ge=8, le=24)
    x: int = Field(default=0, ge=0, le=127)
    y: int = Field(default=0, ge=0, le=31)
    invert: bool = False
    contrast: int = Field(default=160, ge=0, le=255)
    pixels: str = Field(default='', max_length=684)
    @model_validator(mode='after')
    def pixels_valid(self):
        if self.pixels:
            try:
                if len(base64.b64decode(self.pixels,validate=True)) != 512: raise ValueError()
            except Exception:
                raise ValueError('像素数据必须是 128×32 单色位图（512 字节）')
        if self.mode=='pixel' and not self.pixels: raise ValueError('像素模式需要位图')
        return self

class Settings(Model):
    fan: Fan = Field(default_factory=Fan)
    lights: Lights = Field(default_factory=Lights)
    oled: Oled = Field(default_factory=Oled)
    labels: list[str] = Field(default_factory=lambda:[f'灯珠 {i+1:02}' for i in range(14)],min_length=14,max_length=14)
    @field_validator('labels')
    @classmethod
    def label_length(cls, values):
        if any(not x.strip() or len(x)>24 for x in values): raise ValueError('灯珠名称长度为 1–24 字符')
        return values

class Command(Model):
    expected_version: int = Field(ge=0)
    request_id: str = Field(min_length=8,max_length=80,pattern=r'^[a-zA-Z0-9_-]+$')
    value: dict

class Login(Model):
    username: str = Field(max_length=80)
    password: str = Field(max_length=200)

class TokenRequest(Model):
    name: str = Field(min_length=1,max_length=40)
    scope: Literal['read','control'] = 'read'
    days: int = Field(default=90,ge=1,le=365)

class SceneRequest(Model):
    name: str = Field(min_length=1,max_length=30)
    icon: Literal['leaf','sun','moon','sparkles','custom'] = 'custom'
    config: Settings


class HardwareConfig(Model):
    cube: str = 'auto'
    oled: str = 'auto'
    case_fan: bool = True
    lights: bool = True
    screen: bool = True

    @field_validator('cube', 'oled')
    @classmethod
    def target_valid(cls, value, info):
        import re
        address = '0e' if info.field_name == 'cube' else '(3c|3d)'
        if value not in ('auto', 'off') and not re.fullmatch(r'i2c-[0-9]{1,3}@0x' + address, value):
            raise ValueError('请选择扫描到的兼容部件')
        return value

class HardwareCommand(Model):
    expected_revision: int = Field(ge=0)
    value: HardwareConfig

class PeerAddress(Model):
    url: str = Field(min_length=1, max_length=255)
