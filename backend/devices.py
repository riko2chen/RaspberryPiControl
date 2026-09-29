"""Discover only supported I2C addresses; never run a blind bus-wide write scan."""
import errno
import os
import re
import time
from pathlib import Path
from .hardware import Hardware


class DeviceHardware(Hardware):
    def __init__(self, state_dir, simulate=False):
        super().__init__(state_dir, simulate, deferred=True)
        self.handles = {}
        self.targets = {}
        self.failed = set()
        self.inventory = {'scanned_at': None, 'buses': [], 'candidates': [], 'components': {}, 'scan_errors': []}

    def scan(self, config, seen):
        from smbus2 import SMBus, i2c_msg
        candidates, buses, errors, handles = [], [], [], {}
        root = Path(os.getenv('PC_I2C_ROOT', '/dev'))
        # Raspberry Pi's display/camera buses are not scanned. Installers may opt
        # additional external buses in explicitly; the default GPIO HAT bus is 1.
        allowed = {int(n) for n in os.getenv('PC_I2C_BUSES', '1').split(',') if n.strip().isdigit()}
        if self.simulate:
            buses = [1]
            candidates = [dict(id='i2c-1@0x0e', bus=1, address='0x0e', kind='cube', name='CUBE 扩展板', firmware=1),
                          dict(id='i2c-1@0x3c', bus=1, address='0x3c', kind='oled', name='SSD1306 OLED')]
        else:
            for path in sorted(root.glob('i2c-*')):
                match = re.fullmatch(r'i2c-(\d+)', path.name)
                if not match or int(match[1]) not in allowed: continue
                number = int(match[1]); buses.append(number)
                try:
                    bus = SMBus(str(path)); handles[number] = bus
                except OSError as exc:
                    errors.append({'bus': number, 'error': str(exc)}); continue
                for address, kind, name in [(0x0e, 'cube', 'CUBE 扩展板'), (0x3c, 'oled', 'SSD1306 OLED'), (0x3d, 'oled', 'SSD1306 OLED')]:
                    try:
                        version = None
                        if kind == 'cube':
                            # The vendor's get_Version operation. It does not set
                            # a light effect or a fan speed.
                            bus.write_byte(address, 0)
                            version = bus.read_byte(address)
                            if not 0 < version < 255: continue
                        else:
                            # Address-only write: acknowledge without OLED data.
                            bus.i2c_rdwr(i2c_msg.write(address, []))
                        item = dict(id=f'i2c-{number}@0x{address:02x}', bus=number, address=f'0x{address:02x}', kind=kind, name=name)
                        if version is not None: item['firmware'] = version
                        candidates.append(item)
                    except OSError as exc:
                        if exc.errno not in (errno.ENXIO, getattr(errno,'EREMOTEIO',121), errno.ENODEV, errno.EIO):
                            errors.append({'bus': number, 'address': f'0x{address:02x}', 'error': str(exc)})
        chosen, components = {}, {}
        for kind in ('cube', 'oled'):
            target = config[kind]
            matches = [c for c in candidates if c['kind'] == kind and (target == 'auto' or c['id'] == target)]
            if target == 'off': status = 'disabled'
            elif len(matches) > 1: status = 'ambiguous'
            elif matches: status = 'connected'; chosen[kind] = matches[0]
            elif errors: status = 'error'
            elif seen.get(kind) or target != 'auto': status = 'disconnected'
            else: status = 'not-installed'
            components[kind] = {'status': status, 'device': chosen.get(kind), 'physical_feedback': False}
        for kind, parent, enabled in [('fan', 'cube', config['case_fan']), ('lights', 'cube', config['lights'])]:
            components[kind] = {**components[parent], 'status': components[parent]['status'] if enabled else 'disabled'}
        if not config['screen']: components['oled']['status'] = 'disabled'
        # Never reinitialize a continuing native animation just because we scan.
        changed = {k for k in ('cube', 'oled') if self.targets.get(k, {}).get('id') != chosen.get(k, {}).get('id')} | self.failed
        if 'cube' in changed:
            self.last_lights = None; self.rgb_ready = False; self.native_effect = None
        if 'oled' in changed: self.oled_ready = False
        for handle in self.handles.values(): handle.close()
        self.handles, self.targets, self.failed = handles, chosen, set()
        self.inventory = dict(scanned_at=time.time(), buses=buses, candidates=candidates, components=components, scan_errors=errors)
        return self.inventory

    def available(self, component):
        parent = 'cube' if component in ('fan', 'lights') else 'oled'
        return parent not in self.failed and self.inventory['components'].get(component, {}).get('status') == 'connected'

    def mark_failed(self, component):
        parent = 'cube' if component in ('fan', 'lights') else 'oled'
        self.failed.add(parent)
        for kind in (('cube', 'fan', 'lights') if parent == 'cube' else ('oled',)):
            item = self.inventory['components'].get(kind)
            if item and item['status'] != 'disabled': item['status'] = 'disconnected'

    def _use(self, kind):
        target = self.targets.get(kind)
        if not target or kind in self.failed: raise OSError(errno.ENODEV, '部件未连接')
        self.bus = self.handles.get(target['bus'])
        if not self.simulate and self.bus is None: raise OSError(errno.ENODEV, 'I2C 总线未连接')

    def fan(self, level):
        self._use('cube'); return super().fan(level)

    def lights(self, colors):
        self._use('cube'); return super().lights(colors)

    def native_breathe(self, color, speed, force=False):
        self._use('cube'); return super().native_breathe(color, speed, force)

    def command(self, *values):
        if self.bus:
            address = int(self.targets['oled']['address'], 16)
            for value in values: self.bus.write_byte_data(address, 0, value)

    def oled(self, rows, contrast=160, enabled=True):
        self._use('oled')
        # The base encoder uses 0x3c for data; configure its address too.
        self.oled_address = int(self.targets['oled']['address'], 16)
        return super().oled(rows, contrast, enabled)

    def close(self):
        for handle in self.handles.values(): handle.close()
        self.handles.clear(); self.bus = None; self.lockfile.close()
