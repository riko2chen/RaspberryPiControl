export type FanConfig={mode:'auto'|'manual';level:number;curve:{temperature:number;level:number}[]};
export type LightsConfig={enabled:boolean;effect:'static'|'rainbow'|'chase'|'native_breathe';native_color:number;native_speed:number;brightness:number;speed:number;colors:string[]};
export type OledConfig={enabled:boolean;mode:'system'|'clock'|'text'|'pixel'|'carousel';text:string;font_size:number;x:number;y:number;invert:boolean;contrast:number;pixels:string};
export type Configuration={fan:FanConfig;lights:LightsConfig;oled:OledConfig;labels:string[]};
export type Frame={id?:number;pixels:string;pixel_hash?:string;hardware_hash?:string;written_at?:number;ts?:number;mode?:string};
export type State={demo?:boolean;device?:DeviceIdentity;version:number;config:Configuration;applied:{fan:null|{level:number;protocol_code:number;written_at:number};lights:null|{colors:string[];written_at:number;frame:number;engine:'firmware'|'software';color_source:string;parameters:LightsConfig;phase_seconds:number};oled:Frame|null};metrics:{temperature:number|null;cpu_fan_rpm:number|null;cpu_fan_pwm:number|null;cpu_percent:number|null;memory_percent:number|null;storage_used_percent:number;storage_free_gb:number;sampled_at:number};hardware:{connected:boolean;errors:Record<string,string>;simulate:boolean;connection?:HardwareConnection};cpu_fan_policy:{available:boolean;state:number|null;max_state:number|null;steps:{temperature:number;hysteresis:number;pwm:number;percent:number}[]};fan_presets:{id:string;name:string;description:string;config:FanConfig}[];animation:{write_fps:number;target_fps:number};safety_override:boolean;server_time:number;identity?:{name:string;scope:string}};
export type Scene={id:string;name:string;icon:string;config:Configuration;builtin:number};
export type Event={id:number;ts:number;kind:string;source:string;outcome:string;error?:string;before:unknown;after:unknown};
export type Metric={ts:number;temperature:number|null;cpu_fan_rpm:number|null;case_level:number|null};

export type DeviceIdentity={id:string;name:string;version:string;product:string;protocol:number};
export type HardwareConfig={cube:string;oled:string;case_fan:boolean;lights:boolean;screen:boolean};
export type HardwarePart={status:'connected'|'not-installed'|'disabled'|'disconnected'|'ambiguous'|'error';device:null|HardwareCandidate;physical_feedback:boolean};
export type HardwareCandidate={id:string;bus:number;address:string;kind:'cube'|'oled';name:string;firmware?:number};
export type HardwareConnection={revision:number;config:HardwareConfig;scanned_at:number|null;buses:number[];candidates:HardwareCandidate[];components:Record<string,HardwarePart>;scan_errors:{bus:number;error:string}[]};
export type PeerDevice={id:string;name:string;version:string;url:string;online:boolean;last_seen:number;saved:boolean};
export type DeviceDirectory={service_mode?:'demo'|'hardware'|'static-demo';current:DeviceIdentity;items:PeerDevice[];scanned_at:number|null;discovery_error:string|null};
