"""Public API contracts used by OpenAPI. Runtime handlers remain unchanged."""
from typing import Annotated, Any, Literal
from pydantic import BaseModel, ConfigDict, Field
from .models import Command, Fan, Lights, Oled, Settings, HardwareConfig

Timestamp = Annotated[float, Field(description='Unix 时间戳，单位为秒，可含小数。')]

class ResponseModel(BaseModel):
    model_config = ConfigDict(extra='allow')

class FanCommand(Command):
    value: Fan

class LightsCommand(Command):
    value: Lights

class OledCommand(Command):
    value: Oled

class LightColor(BaseModel):
    model_config = ConfigDict(extra='forbid')
    color: str = Field(pattern=r'^#[0-9a-fA-F]{6}$', examples=['#ff8800'])

class LightColorCommand(Command):
    value: LightColor

class LabelsValue(BaseModel):
    model_config = ConfigDict(extra='forbid')
    labels: list[Annotated[str, Field(min_length=1, max_length=24)]] = Field(min_length=14, max_length=14)

class LabelsCommand(Command):
    value: LabelsValue

class SceneApplyCommand(Command):
    value: dict = Field(description='传入空对象 {}；配置从已保存的场景读取。', examples=[{}])

class DeviceIdentity(ResponseModel):
    id: str = Field(description='设备持久化 UUID。')
    name: str
    version: str = Field(description='服务版本。')
    product: Literal['pi-control']
    protocol: Literal[1]

class HardwareCandidate(ResponseModel):
    id: str = Field(examples=['i2c-1@0x0e'])
    bus: int
    address: str = Field(examples=['0x0e'])
    kind: Literal['cube', 'oled']
    name: str
    firmware: int | None = None

class HardwarePart(ResponseModel):
    status: Literal['connected', 'not-installed', 'disabled', 'disconnected', 'ambiguous', 'error']
    device: HardwareCandidate | None
    physical_feedback: bool = Field(description='是否支持实际传感器反馈；连接到扩展板不等于能检测其风扇或灯条是否插好。')

class ScanError(ResponseModel):
    bus: int
    error: str
    address: str | None = None

class HardwareInventory(ResponseModel):
    revision: int = Field(description='硬件连接配置版本，与 status.version 独立。')
    config: HardwareConfig
    scanned_at: Timestamp | None
    buses: list[int]
    candidates: list[HardwareCandidate]
    components: dict[str, HardwarePart] = Field(description='部件键：cube、fan、lights、oled、cpu_fan。')
    scan_errors: list[ScanError]

class PeerDevice(ResponseModel):
    id: str
    name: str
    version: str
    url: str
    online: bool
    last_seen: Timestamp
    saved: bool | None = None
    current: bool | None = Field(default=None, description='连接结果为当前设备时返回 true。')

class DeviceDirectory(ResponseModel):
    service_mode: Literal['demo', 'hardware'] = Field(description='本服务控制模拟硬件或宿主硬件；设备目录可在两种模式下记住其他 Pi Control。')
    current: DeviceIdentity
    items: list[PeerDevice]
    scanned_at: Timestamp | None
    discovery_error: str | None

class AppliedFan(ResponseModel):
    level: int = Field(ge=0, le=10, description='0 关闭，1–10 从慢到快。')
    protocol_code: int = Field(description='底层协议代码；业务集成请使用 level。')
    written_at: Timestamp
    rpm: int | None = Field(description='机箱风扇无转速反馈，当前为 null。')

class AppliedLights(ResponseModel):
    colors: list[str] = Field(min_length=14, max_length=14, description='软件效果为最近写入颜色；原厂呼吸为固件调色板颜色示意。')
    written_at: Timestamp
    frame: int
    engine: Literal['firmware', 'software']
    color_source: Literal['firmware-palette', 'written-frame']
    parameters: Lights
    phase_seconds: float

class OledFrame(ResponseModel):
    id: int
    width: Literal[128]
    height: Literal[32]
    pixels: str = Field(description='512 字节的行优先单色位图，Base64 编码，每字节高位对应左侧像素。')
    pixel_hash: str
    hardware_hash: str
    written_at: Timestamp
    mode: str

class PreviewFrame(ResponseModel):
    pixels: str = Field(description='与 OledFrame.pixels 相同的行优先位图。')
    width: Literal[128]
    height: Literal[32]
    preview: Literal[True]

class AppliedState(ResponseModel):
    fan: AppliedFan | None
    lights: AppliedLights | None
    oled: OledFrame | None

class LiveMetrics(ResponseModel):
    temperature: float | None = Field(description='CPU 温度，摄氏度。')
    cpu_fan_rpm: int | None
    cpu_fan_pwm: int | None
    cpu_percent: float | None
    memory_percent: float | None
    storage_used_percent: float
    storage_free_gb: float
    sampled_at: Timestamp

class CpuFanStep(ResponseModel):
    temperature: float
    hysteresis: float
    pwm: int
    percent: int

class CpuFanPolicy(ResponseModel):
    available: bool
    state: int | None
    max_state: int | None
    steps: list[CpuFanStep]

class FanPreset(ResponseModel):
    id: str
    name: str
    description: str
    config: Fan

class AnimationState(ResponseModel):
    write_fps: float
    target_fps: int

class HardwareState(ResponseModel):
    connected: bool
    errors: dict[str, str]
    simulate: bool
    connection: HardwareInventory
    rgb_count: Literal[14]
    oled_size: list[int]

class Identity(ResponseModel):
    name: str
    scope: Literal['read', 'control', 'admin']

class Retention(ResponseModel):
    metrics_days: int
    oled_max_frames: int
    oled_max_days: int
    events_max: int

class StateSnapshot(ResponseModel):
    demo: bool = Field(default=False, description='服务是否使用免登录演示模式；硬件是否模拟以 hardware.simulate 为准。')
    version: int = Field(description='控制配置版本；提交新操作时传入 expected_version。')
    config: Settings = Field(description='已持久化的目标配置。')
    applied: AppliedState = Field(description='最近成功写入硬件的状态；不等同于所有物理效果的传感器反馈。')
    metrics: LiveMetrics
    hardware: HardwareState
    cpu_fan_policy: CpuFanPolicy
    fan_presets: list[FanPreset]
    animation: AnimationState
    safety_override: bool
    server_time: Timestamp
    started_at: Timestamp
    frames_sent: int
    retention: Retention
    device: DeviceIdentity | None = None
    identity: Identity | None = None

class ErrorResponse(ResponseModel):
    detail: str | list[dict[str, Any]] = Field(description='错误说明；请求结构校验失败时为 FastAPI 校验错误数组。')
    state: StateSnapshot | None = Field(default=None, description='部分硬件写入失败返回当前状态；其他错误可不包含此字段。')

class EventRecord(ResponseModel):
    id: int
    ts: Timestamp
    kind: str
    source: str
    outcome: str
    error: str | None
    before: Any
    after: Any

class EventPage(ResponseModel):
    items: list[EventRecord]
    next: int | None = Field(description='下一次请求的 before；空页返回 null。')

class MetricRecord(ResponseModel):
    ts: Timestamp
    temperature: float | None
    cpu_fan_rpm: int | None
    cpu_percent: float | None
    memory_percent: float | None
    case_level: int | None

class MetricHistory(ResponseModel):
    items: list[MetricRecord]

class FrameRecord(ResponseModel):
    id: int
    ts: Timestamp
    pixel_hash: str
    mode: str

class HistoricalFrame(FrameRecord):
    pixels: str = Field(description='128×32 单色位图，格式同 OledFrame.pixels。')

class FramePage(ResponseModel):
    items: list[FrameRecord]
    next: int | None

class Scene(ResponseModel):
    id: str
    name: str
    icon: str
    config: Settings
    builtin: Literal[0, 1]

class SceneList(ResponseModel):
    items: list[Scene]

class TokenMetadata(ResponseModel):
    id: str
    name: str
    scope: Literal['read', 'control']
    created: Timestamp
    expires: Timestamp
    last_used: Timestamp | None

class TokenList(ResponseModel):
    items: list[TokenMetadata]

class TokenCreated(ResponseModel):
    id: str
    token: str = Field(description='完整令牌，只在创建响应中返回一次。')

class CreatedId(ResponseModel):
    id: str

class OkResponse(ResponseModel):
    ok: Literal[True]

class LoginResponse(ResponseModel):
    username: str

class HealthResponse(ResponseModel):
    status: Literal['ok']
    version: str

class ReadyResponse(ResponseModel):
    status: Literal['ready', 'hardware-unavailable']

DOC_MODELS = [FanCommand, LightsCommand, OledCommand, LightColorCommand, LabelsCommand,
              SceneApplyCommand, StateSnapshot, ErrorResponse, HardwareInventory, DeviceDirectory,
              DeviceIdentity, PeerDevice, PreviewFrame, OledFrame, EventPage, MetricHistory,
              FramePage, HistoricalFrame, SceneList, TokenList, TokenCreated, CreatedId,
              OkResponse, LoginResponse, HealthResponse, ReadyResponse]
