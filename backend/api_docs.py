"""OpenAPI metadata, examples and contracts for every public HTTP operation."""
from fastapi.openapi.utils import get_openapi
from fastapi.routing import APIRoute
from . import api_schemas as schemas
from .models import Fan, Lights, Oled, Settings, HardwareConfig

TAGS = [
    ('Status', '服务健康、设备标识与当前状态'), ('Fans', '机箱风扇控制；CPU 风扇由系统管理'),
    ('Lights', '14 颗 RGB 灯珠与原厂灯效'), ('OLED', 'OLED 画面、预览与历史帧'),
    ('History', '事件、性能指标与导出'), ('Scenes', '保存和应用完整配置'),
    ('Hardware', '本机部件发现和连接'), ('Devices', '发现并记住其他树莓派'),
    ('Auth', '网页登录会话'), ('Tokens', '为客户端创建和撤销访问令牌'),
]

# endpoint function -> tag, summary, minimum scope, response contract, details
OPERATIONS = {
 'health': ('Status', '检查进程健康', None, 'HealthResponse', '进程存活检查，不代表硬件已经连接。'),
 'ready': ('Status', '检查服务就绪状态', None, 'ReadyResponse', '硬件管理器已初始化且没有记录错误时返回 200；有通信错误时返回 503。未安装的可选部件不阻止服务就绪。'),
 'device_identity': ('Status', '获取公开设备标识', None, 'DeviceIdentity', '供局域网发现使用，不包含配置、地址或凭据。'),
 'status': ('Status', '获取当前完整状态', 'read', 'StateSnapshot', '`config` 为目标配置，`applied` 为最近成功写入状态。读取 `version` 后再提交控制操作。CPU 风扇转速位于 `metrics.cpu_fan_rpm`，系统温控阈值位于 `cpu_fan_policy`。'),
 'fan': ('Fans', '设置机箱风扇', 'control', 'StateSnapshot', '`value` 替换机箱风扇配置。`level=0` 关闭，1–10 从慢到快；自动模式使用 `curve`，温度递增且档位不递减。温度保护可覆盖手动档位，请查看 `safety_override` 和 `applied.fan`。CPU 散热风扇由内核管理，当前没有 CPU 风扇写入接口。'),
 'lights': ('Lights', '设置灯条', 'control', 'StateSnapshot', '`value` 替换完整灯光配置。常亮、彩虹流动、追光使用 `brightness` 和 `speed`。原厂呼吸由固件播放，使用 `native_color` 和 `native_speed`，不使用软件亮度、速度及逐灯颜色。原厂颜色：0 红、1 绿、2 蓝、3 黄、4 紫、5 青、6 白；速度 1 慢、2 中、3 快。'),
 'one_light': ('Lights', '修改一颗灯珠的颜色', 'control', 'StateSnapshot', '索引从 **0 到 13**。只接受 `value.color`，修改后灯效切换为常亮；其他灯珠、总开关和整体亮度保持原值。灯条关闭时，此操作不会自动打开灯条。'),
 'oled': ('OLED', '设置屏幕', 'control', 'StateSnapshot', '`value` 替换 OLED 配置。支持系统信息、时钟、文字、像素画布和轮播。像素模式要求 `pixels` 为 512 字节的 Base64 位图。坐标原点在左上角，按行排列，每行 16 字节，每字节高位对应左侧像素。'),
 'labels': ('Lights', '设置灯珠名称', 'control', 'StateSnapshot', '一次提交恰好 14 个名称，每个 1–24 字符且不能全为空白。此接口只修改名称，不改变灯光输出。'),
 'preview': ('OLED', '生成屏幕预览', 'read', 'PreviewFrame', '根据传入配置生成位图，不写入屏幕，也不修改设备配置。请求体直接使用 Oled 对象，无需命令封装。'),
 'frame': ('OLED', '获取最近写入的屏幕帧', 'read', 'OledFrame', '没有成功写入记录时返回 JSON `null`。画面是最近成功发送的位图，不是摄像头采集。'),
 'frames': ('OLED', '查询屏幕帧历史', 'read', 'FramePage', '按 id 倒序分页，只返回元信息；通过 `/frames/{frame_id}` 获取完整位图。记录最多保留 7 天或 100,000 帧，以先达到者为准。'),
 'historical_frame': ('OLED', '获取历史屏幕帧', 'read', 'HistoricalFrame', '不存在或已清理的帧返回 404。位图格式与当前帧相同。'),
 'events': ('History', '查询操作事件', 'read', 'EventPage', '按 id 倒序分页。将响应 `next` 传入下一次的 `before`，直到返回空页。最多保留 50,000 条。`before` / `after` 是配置快照或相应事件数据，结构取决于 `kind`。'),
 'metrics': ('History', '查询性能指标', 'read', 'MetricHistory', '时间升序，原始指标约每 10 秒记录，保留 7 天；长时间范围会抽样以减少响应体积，返回点数并非固定。'),
 'export': ('History', '导出事件 CSV', 'read', None, '导出当前保留的事件。UTF-8 CSV 带 BOM，列为 id、timestamp、kind、source、outcome、error。'),
 'scenes': ('Scenes', '列出场景', 'read', 'SceneList', '包含内置场景及用户保存的场景，内置场景优先。'),
 'save_scene': ('Scenes', '保存场景', 'control', 'CreatedId', '保存完整配置，不立即应用到设备。场景总数上限为 32。'),
 'apply_scene': ('Scenes', '应用场景', 'control', 'StateSnapshot', '请求 `value` 传 `{}`；读取已保存配置并应用到已连接部件。未安装或停用的部件跳过写入。'),
 'delete_scene': ('Scenes', '删除自定义场景', 'control', 'OkResponse', '内置场景无法删除（409），不存在的场景返回 404。'),
 'hardware_status': ('Hardware', '获取硬件连接状态', 'read', 'HardwareInventory', '返回候选设备、各部件状态及连接配置。扩展板不提供风扇和灯条的插接反馈，应结合实际安装情况配置。'),
 'hardware_scan': ('Hardware', '重新扫描兼容部件', 'control', 'HardwareInventory', '检查配置允许的 I²C 总线及兼容地址，并尝试恢复部件。请求完成不等于所有部件可用，请读取 components 和 scan_errors。'),
 'hardware_config': ('Hardware', '更新硬件连接配置', 'control', 'HardwareInventory', '使用本接口的 `expected_revision`，不是控制配置的 `expected_version`。先 GET `/hardware` 读取 revision，再提交完整 value。`auto` 自动连接，`off` 不连接，也可指定扫描结果中的设备 id。停用后停止管理并保留物理状态。'),
 'devices': ('Devices', '列出附近及已记住的设备', 'read', 'DeviceDirectory', '返回本机发现缓存和服务模式；记住的离线设备会保留，并定期检查。Docker 演示服务也能记住目标地址，选择后进入目标控制台。'),
 'scan_devices': ('Devices', '刷新设备发现', 'admin', 'DeviceDirectory', '通过本机 mDNS 发现数据检查其他 Pi Control 实例，并探测已记住地址。扫描正在进行时返回 409。'),
 'connect_device': ('Devices', '检查并记住设备地址', 'admin', 'PeerDevice', '仅支持局域网、Tailscale 和本机 IPv4 地址，或解析到这些地址的域名。返回目标控制台 URL；不会转发当前凭据，也不会代替用户登录目标设备。目标是当前设备时返回 current=true。'),
 'forget_device': ('Devices', '移除已记住的设备', 'admin', 'OkResponse', '只删除本机保存的记录，不修改目标设备。重复调用也返回成功。'),
 'login': ('Auth', '创建网页登录会话', None, 'LoginResponse', '账号密码正确时通过 Set-Cookie 设置 7 天有效的 HttpOnly / SameSite=Strict 会话；HTTPS 下附带 Secure。每个来源 IP 的 5 分钟窗口最多允许 8 次失败尝试，随后返回 429。'),
 'logout': ('Auth', '退出当前网页登录', 'read', 'OkResponse', '使用会话时撤销当前会话并清除 Cookie；使用 API 令牌调用不会撤销该令牌。'),
 'tokens': ('Tokens', '列出 API 访问令牌', 'admin', 'TokenList', '仅返回名称、权限、到期时间等元信息，不返回令牌原文或哈希。每个客户端可使用独立名称和权限的令牌。'),
 'create_token': ('Tokens', '创建访问令牌', 'admin', 'TokenCreated', '可创建 read 或 control 令牌，有效期 1–365 天，总数上限 32。完整 token 仅在本次响应中返回。admin 权限只由网页登录会话提供。'),
 'revoke_token': ('Tokens', '撤销访问令牌', 'admin', 'OkResponse', '撤销后该令牌无法继续调用；重复调用返回成功。'),
}

DESCRIPTION = '''面向应用、脚本、家庭自动化和第三方集成的 HTTP / JSON API。

基础路径为 `/api/v1`，时间戳使用 Unix 秒。接口按资源分组，提供参数、响应结构与示例。

**认证**：在控制台「设置 → 开发者 API」创建令牌，通过 `Authorization: Bearer <token>` 调用。
`read` 可查询及生成 OLED 预览，`control` 可修改硬件配置和场景，`admin` 为网页登录会话，可管理令牌与设备目录。
当前已登录的浏览器可直接调试；也可点击 Authorize 输入完整令牌（不用再输入 Bearer 前缀）。

**控制请求**：先 GET `/status`，再提交 `expected_version`、唯一 `request_id` 和 `value`。
`value` 是对应资源的替换配置，省略字段使用默认值；保留其余配置时应基于 GET 返回值修改。
409 时重新读取并处理冲突；503 时目标配置可能已经持久化，应同时检查 `config`、`applied` 与 `hardware.errors`。

**实时数据**：WebSocket `/api/v1/live` 每约 0.5 秒推送完整状态，详见上方接入指南。
'''

COMMAND_MODELS = {'fan':'FanCommand','lights':'LightsCommand','one_light':'LightColorCommand',
                  'oled':'OledCommand','labels':'LabelsCommand','apply_scene':'SceneApplyCommand'}

FIELD_NOTES = {
 'Fan': {'mode':'auto 自动温控，manual 手动档位。','level':'手动模式档位：0 关闭，1–10 从慢到快。','curve':'2–8 个温控点，温度严格递增，档位不递减；自动模式使用。'},
 'Lights': {'brightness':'软件灯效整体亮度，0–100%；原厂呼吸不使用此字段。','speed':'软件动画速度倍数；原厂呼吸使用 native_speed。','colors':'恰好 14 个 #RRGGBB 颜色，对应索引 0–13。','native_color':'原厂颜色编号：0 红、1 绿、2 蓝、3 黄、4 紫、5 青、6 白。','native_speed':'原厂呼吸速度：1 慢、2 中、3 快。'},
 'Oled': {'pixels':'Base64 编码的 512 字节行优先单色位图；每行 16 字节，高位在左。pixel 模式必填，其他模式可传空字符串。','contrast':'屏幕对比度 0–255。','text':'最多 240 字符，支持换行。','x':'左上角水平偏移，单位像素。','y':'左上角垂直偏移，单位像素。'},
 'TokenRequest': {'name':'可识别的客户端名称，例如 Home Assistant 或个人脚本。','days':'有效期天数，默认 90。','scope':'read 只读；control 包含查询和控制权限。'},
 'HardwareCommand': {'expected_revision':'GET /hardware 返回的 revision，与控制配置版本独立。'},
 'HardwareConfig': {'cube':'auto、off 或扫描到的 i2c-N@0x0e。','oled':'auto、off 或扫描到的 i2c-N@0x3c / i2c-N@0x3d。','case_fan':'是否管理机箱风扇。','lights':'是否管理 RGB 灯条。','screen':'是否管理 OLED 屏幕。'},
}

def ref(name): return {'$ref':'#/components/schemas/'+name}

def example_state():
    ts=1790596800.0
    device={'id':'00000000-0000-4000-8000-000000000001','name':'pi-example','product':'pi-control','protocol':1,'version':'1.4.0'}
    return {'version':12,'config':Settings().model_dump(),'applied':{'fan':None,'lights':None,'oled':None},
        'metrics':{'temperature':38.5,'cpu_fan_rpm':0,'cpu_fan_pwm':0,'cpu_percent':2.4,'memory_percent':8.1,'storage_used_percent':12.0,'storage_free_gb':210.5,'sampled_at':ts},
        'hardware':{'connected':True,'errors':{},'simulate':False,'rgb_count':14,'oled_size':[128,32],'connection':{'revision':1,'config':HardwareConfig().model_dump(),'scanned_at':ts,'buses':[1],'candidates':[],'components':{},'scan_errors':[]}},
        'cpu_fan_policy':{'available':False,'state':None,'max_state':None,'steps':[]},'fan_presets':[],
        'animation':{'write_fps':0.0,'target_fps':30},'safety_override':False,'server_time':ts,'started_at':ts-3600,'frames_sent':100,
        'retention':{'metrics_days':7,'oled_max_frames':100000,'oled_max_days':7,'events_max':50000},'device':device,'identity':{'name':'example-client','scope':'read'}}

def install_openapi(app):
    def build():
        if app.openapi_schema:return app.openapi_schema
        result=get_openapi(title='Pi Control API',version=app.version,description=DESCRIPTION,routes=app.routes,openapi_version='3.1.0',tags=[{'name':n,'description':d} for n,d in TAGS])
        result['servers']=[{'url':'/','description':'当前 Pi Control 实例（LAN 或 Tailscale）'}]
        components=result.setdefault('components',{}); definitions=components.setdefault('schemas',{})
        for model in schemas.DOC_MODELS:
            document=model.model_json_schema(ref_template='#/components/schemas/{model}')
            definitions.update(document.pop('$defs',{}));definitions[model.__name__]=document
        for model,notes in FIELD_NOTES.items():
            for field,note in notes.items():definitions[model]['properties'][field]['description']=note
        definitions['Lights']['properties']['colors']['items']['pattern']=r'^#[0-9a-fA-F]{6}$'
        definitions['Login']['properties']['password'].update(format='password',writeOnly=True)
        for name in COMMAND_MODELS.values():
            definitions[name]['properties']['expected_version']['description']='最近 GET /status 返回的 version；冲突返回 409。'
            definitions[name]['properties']['request_id']['description']='8–80 个字母、数字、下划线或连字符。推荐 UUID。历史保留期内，同一调用者重试相同资源和配置可复用；不同操作必须使用新值。'
        components['securitySchemes']={
            'BearerAuth':{'type':'http','scheme':'bearer','description':'在设置中创建的 pc_ 令牌。Authorize 输入完整令牌，无需 Bearer 前缀。'},
            'SessionCookie':{'type':'apiKey','in':'cookie','name':'pi_control_session','description':'通过 /auth/login 创建的网页登录会话，浏览器自动携带。写请求同时需要 X-Pi-Control: 1。'},
        }
        result['security']=[{'BearerAuth':[]},{'SessionCookie':[]}]
        for route in app.routes:
            if not isinstance(route,APIRoute) or route.name not in OPERATIONS:continue
            tag,summary,scope,response,details=OPERATIONS[route.name]
            for method in route.methods:
                op=result['paths'][route.path][method.lower()]
                op.update(tags=[tag],summary=summary,operationId=route.name,description=('**最低权限：'+(scope or '无需认证')+'。**\n\n'+details),security=[] if scope is None else result['security'])
                op['x-required-scope']=scope or 'public'
                responses=op['responses']
                success_schema=ref(response) if response else {'type':'string'}
                if route.name=='frame':success_schema={'anyOf':[ref('OledFrame'),{'type':'null'}]}
                media='text/csv' if route.name=='export' else 'application/json'
                responses['200']={'description':'成功','content':{media:{'schema':success_schema}}}
                if route.name=='status':responses['200']['content'][media]['example']=example_state()
                if route.name in ('health','ready'):responses['200']['content'][media]['example']={'status':'ok','version':app.version} if route.name=='health' else {'status':'ready'}
                if route.name=='export':responses['200']['content'][media]['example']='id,timestamp,kind,source,outcome,error\n1,1790596800.0,fan,example-client,success,\n'
                if route.name=='login':responses['200']['headers']={'Set-Cookie':{'description':'HttpOnly 登录会话，7 天有效。','schema':{'type':'string'}}}
                codes={400:'Host 不被允许。'}
                if scope:codes.update({401:'凭据缺失、无效或已过期。',403:'权限不足，或浏览器来源 / 校验头不符合要求。'})
                if method not in ('GET','HEAD'):
                    codes.update({403:'权限不足、跨来源写入，或 Cookie 请求缺少 X-Pi-Control: 1。',413:'声明的请求体超过 32 KiB。'})
                    op.setdefault('parameters',[]).append({'name':'X-Pi-Control','in':'header','required':False,'schema':{'type':'string','enum':['1']},'description':'请求带有网页登录 Cookie 时，写操作必须提供；仅 Bearer 认证时无需此头。'})
                if '422' in responses or route.name in ('connect_device','one_light','labels'):codes[422]='参数、请求体结构或业务字段校验失败。'
                if route.name in (*COMMAND_MODELS,'hardware_config','scan_devices','save_scene','delete_scene','create_token'):codes[409]='配置版本冲突、部件不可用、操作过于频繁或资源限制；请阅读 detail。'
                if route.name in ('historical_frame','apply_scene','delete_scene'):codes[404]='资源不存在或已清理。'
                if route.name=='login':codes.update({401:'用户名或密码不正确。',429:'登录失败次数过多，五分钟后重试。'})
                if route.name in ('fan','lights','one_light','oled','apply_scene'):codes[503]='硬件写入失败；配置可能已保存，请检查返回 state 和最新状态后决定重试。'
                for code,description in codes.items():responses[str(code)]={'description':description,'content':{'application/json':{'schema':ref('ErrorResponse'),'example':{'detail':description}}}}
                if route.name=='ready':responses['503']={'description':'硬件管理器未就绪或有通信错误。','content':{'application/json':{'schema':ref('ReadyResponse'),'example':{'status':'hardware-unavailable'}}}}
                for param in op.get('parameters',[]):
                    key=param['name']
                    if key=='before':param['description']='首轮传 0；后续使用上一页 next，只返回 id 小于该值的记录。'
                    elif key=='limit':param['description']='每页条数，服务端限制在 1–100；超出范围会被截取到边界。'
                    elif key=='kind':param['description']='事件类型前缀，例如 lights、fan、hardware。底层使用 SQL LIKE，% 和 _ 具有通配语义。'
                    elif key=='hours':param['description']='最近多少小时，服务端限制在 0.05–168。'
                    elif key=='index':param['description']='灯珠索引，0–13。';param['schema'].update(minimum=0,maximum=13)
                if route.name in COMMAND_MODELS:
                    body=op['requestBody']['content']['application/json'];body['schema']=ref(COMMAND_MODELS[route.name])
                    value={'fan':Fan(mode='manual',level=3).model_dump(),'lights':Lights(effect='native_breathe',native_color=4,native_speed=1).model_dump(),'one_light':{'color':'#ff8800'},'oled':Oled(mode='text',text='Hello, Pi Control').model_dump(),'labels':{'labels':[f'LED {i+1:02}' for i in range(14)]},'apply_scene':{}}[route.name]
                    body['example']={'expected_version':12,'request_id':'2b126436-4ddc-4f01-83ec-60c062974827','value':value}
                examples={'hardware_config':{'expected_revision':1,'value':HardwareConfig().model_dump()},'connect_device':{'url':'192.168.1.100:8080'},'create_token':{'name':'Home Assistant','scope':'control','days':90},'save_scene':{'name':'阅读','icon':'leaf','config':Settings().model_dump()},'preview':Oled(mode='text',text='Hello, Pi Control').model_dump()}
                if route.name in examples:op['requestBody']['content']['application/json']['example']=examples[route.name]
        # WebSocket is documented as an extension, never as a fake HTTP GET.
        result['x-websocket']={'url':'/api/v1/live','message':ref('StateSnapshot'),'interval_seconds':0.5,'authentication':'Bearer header or same-origin session cookie','close_codes':{'1008':'未认证、认证已失效，或来源 / Host 不被允许。'}}
        app.openapi_schema=result
        return result
    app.openapi=build
