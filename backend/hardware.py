"""Single-owner I2C adapter. Every error propagates; no inferred readback."""
import fcntl
import os
import time
from pathlib import Path

FAN_CODES = [0,2,3,4,5,6,7,8,9,10,1]

def page_bytes(rows: bytes) -> bytes:
    if len(rows) != 512: raise ValueError('Expected 512 bytes')
    return bytes(sum(((rows[(page*8+bit)*16+x//8] >> (7-x%8)) & 1) << bit for bit in range(8)) for page in range(4) for x in range(128))

class Hardware:
    def __init__(self, state_dir: Path, simulate=False, deferred=False):
        self.simulate=simulate
        self.lockfile=open(state_dir/'i2c.lock','a+')
        try:fcntl.flock(self.lockfile,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except Exception:
            self.lockfile.close()
            raise
        self.bus=None
        self.oled_ready=False
        self.rgb_ready=False
        self.last_lights=None
        self.native_effect=None
        if not simulate and not deferred:
            try:
                from smbus2 import SMBus
                self.bus=SMBus(1)
            except Exception:
                self.lockfile.close()
                raise

    def register(self, reg, value):
        if self.bus:
            self.bus.write_byte_data(0x0e,reg,value)
            time.sleep(0.002)

    def fan(self, level):
        if type(level) is not int or not 0<=level<=10: raise ValueError('Invalid fan level')
        self.register(0x08, int(level>0))
        if level: self.register(0x09,FAN_CODES[level])

    def lights(self, colors):
        if not self.rgb_ready:
            self.register(0x04,0)
            self.rgb_ready=True
            self.native_effect=None
        previous=self.last_lights
        self.last_lights=None
        try:
            # The documented 0xff index broadcasts a color to the complete strip.
            # A uniform frame needs four writes, instead of 14 * four writes.
            updates=[(255,colors[0])] if len(set(colors))==1 else enumerate(colors)
            for i,color in updates:
                if previous and ((i==255 and previous==colors) or (i!=255 and previous[i]==color)): continue
                rgb=[int(color[p:p+2],16) for p in (1,3,5)]
                for reg,val in zip((0,1,2,3),(i,*rgb)): self.register(reg,val)
            self.last_lights=list(colors)
        except OSError:
            self.rgb_ready=False
            raise

    def native_breathe(self, color, speed, force=False):
        if not force and self.native_effect==(color,speed):return
        self.last_lights=None
        self.rgb_ready=False
        self.native_effect=None
        # Stop first; write all parameters before starting the firmware animation.
        self.register(0x04,0)
        self.register(0x06,color)
        self.register(0x05,speed)
        self.register(0x04,1)
        self.native_effect=(color,speed)

    def command(self, *values):
        if self.bus:
            for value in values: self.bus.write_byte_data(0x3c,0x00,value)

    def oled(self, rows, contrast=160, enabled=True):
        data=page_bytes(rows)
        if not self.oled_ready:
            self.command(0xae,0xd5,0x80,0xa8,0x1f,0xd3,0x00,0x40,0x8d,0x14,0x20,0x00,0xa1,0xc8,0xda,0x02,0x81,contrast,0xd9,0xf1,0xdb,0x40,0xa4,0xa6,0x2e)
            self.oled_ready=True
        try:
            self.command(0x81,contrast,0x21,0,127,0x22,0,3)
            if self.bus:
                for i in range(0,len(data),32): self.bus.write_i2c_block_data(getattr(self,'oled_address',0x3c),0x40,list(data[i:i+32]))
            self.command(0xaf if enabled else 0xae)
        except OSError:
            self.oled_ready=False
            raise
        return data

    def close(self):
        if self.bus: self.bus.close()
        self.lockfile.close()
