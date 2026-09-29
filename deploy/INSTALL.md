# 在树莓派安装完整服务

适用 Raspberry Pi OS 64 位、Docker Engine 与 Compose 插件。当前适配 CUBE 扩展板（14 颗 RGB、顶部风扇）、SSD1306 128×32 OLED 和树莓派内核 CPU 风扇接口。组件可缺省。

## 驱动在哪里

镜像已经包含 CUBE 顶部风扇、RGB 灯条、SSD1306 OLED 的控制协议、初始化代码及 Python 依赖，无需另装厂商 `CubeRaspberry` 库。树莓派宿主仍提供 I²C 内核接口；安装器负责开启 I²C、加载模块和配置容器权限。CPU 风扇使用 Raspberry Pi OS 的内核驱动和温控，服务读取其状态。

默认 Compose 是可连接其他 Pi Control 的演示控制台。若要控制装有容器的这台树莓派的物理部件，使用下方硬件安装流程。局域网扫描只能发现已运行 Pi Control 的系统，不能向一台裸系统远程安装驱动。

## 推荐安装

在树莓派下载项目源码，进入根目录：

```sh
sudo python3 deploy/install.py --name "客厅树莓派"
```

安装器会要求设置新的网页密码（至少 12 字符），仅保存加盐哈希；配置 I²C 设备导出、mDNS 发现、Docker 服务和风扇看护。完整镜像在构建时打入前后端和字体，无需宿主 Node.js，也不再把宿主源码挂载覆盖镜像。

安装需要能够访问系统包源、容器镜像仓库、npm 和 PyPI。镜像和业务数据的位置分别沿用 Docker 的存储设置以及 `/var/lib/pi-control`，不要求 `/data`。安装器发现已有 `/opt/pi-control/app` 会停止，避免覆盖现有系统。首次启用 I²C 后如果看不到总线，重启树莓派。

安装前关闭直接控制同一 I²C 部件的其他程序。安装后访问输出的地址，在“设备连接”中检查本机部件；未安装的顶部风扇和灯条可以停用。

## 地址、Tailscale 和发现

- 同一局域网通过 Avahi/mDNS 发现其他 Pi Control。隔离 Wi-Fi、跨 VLAN 和禁用组播时，使用手动地址。
- Tailscale 在宿主单独安装授权；可以通过 100.x.x.x 或 MagicDNS 访问。设备间不共享密码。
- 安装器绑定回环和安装时的局域网、Tailscale IPv4 地址。地址变更后更新 `/opt/pi-control/compose.yaml` 中的 `ports`。建议固定 DHCP 租约。
- 默认只扫描总线 1。额外外部适配器需要同时更新 `/etc/pi-control/hardware.json` 和 Compose 的 `PC_I2C_BUSES`。
- 宿主辅助任务将允许的设备节点导出到 `/dev/pi-control`。未出现 I²C 节点时容器仍可启动；不使用 privileged 或整个 `/dev` 挂载。

## 手动部署模板

`compose.hardware.yaml` 是独立配置文件。使用前准备 `/dev/pi-control`、`/run/pi-control-discovery`，设置实际的 I²C 组号 `PC_I2C_GID`，并建立 `.secrets/bootstrap.json`。系统辅助任务和看护应按安装器部署；直接运行 Compose 不会替你启用 I²C 或安装 Avahi。

可以用镜像提供的工具创建私有 bootstrap 文件：

```sh
docker build -t pi-control:1.5.0 .
mkdir -p .secrets
docker run --rm -it --user "$(id -u):$(id -g)" \
  -v "$PWD/.secrets:/secrets" pi-control:1.5.0 \
  python -m backend.bootstrap
sudo chown 10002:10002 .secrets/bootstrap.json
sudo chmod 600 .secrets/bootstrap.json
docker compose -f compose.hardware.yaml up -d --wait
```

私有文件和 `.env` 已由 `.gitignore` 与 `.dockerignore` 排除。镜像不会包含已配置密码、API 令牌、数据库或个人设备地址。两种 Compose 使用不同的数据卷；请勿让演示服务使用真实设备的数据目录。

## 升级与验证

升级前对 SQLite 做一致性快照并保留旧镜像；构建新版镜像后重新创建容器，保留业务卷。不要用运行中数据库文件的简单覆盖作为恢复方案。

```sh
sudo systemctl status pi-control
sudo systemctl status pi-control-devices.timer pi-control-discovery.timer
sudo docker logs --tail 50 pi-control
```

`/healthz` 检查服务，`/readyz` 检查当前已管理部件。页面能够在缺少部件时运行；恢复连接后重新应用保存设置。

新硬件镜像已在本地无 I²C 的 Linux 容器中验证认证和启动；完整宿主安装器仍需在另一台实体树莓派上进行端到端验证。当前正在使用的树莓派不会因构建本项目而被升级。
