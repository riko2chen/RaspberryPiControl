# 开发与测试

需要 Python 3.13+、Node.js 22，以及 Docker / Compose。

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
npm --prefix frontend ci
npm --prefix frontend run build
npm --prefix frontend run build:demo
.venv/bin/python -m pytest -q
node --experimental-strip-types --test tests/*.test.mjs
```

前端模拟开发：`npm --prefix frontend run dev:demo`。完整服务开发使用 `npm --prefix frontend run dev`，代理本机 18080 端口。

默认 `docker compose up -d --build --wait` 运行独立演示服务。启动后可执行：

```sh
.venv/bin/python scripts/smoke-service.py http://localhost:8080
.venv/bin/python scripts/smoke-auth-container.py
```

控制检查只允许访问标记为演示的服务。真实设备上的浏览器演示有独立存储，硬件控制保持原配置；设备目录仍需原服务的登录状态。

修改 API 后运行 `.venv/bin/python scripts/export-openapi.py` 更新公开接口定义。

## 自动化

- `test.yml`：推送和 Pull Request 时运行测试、构建与 Docker 检查。
- `pages.yml`：按需手动发布纯静态演示。
- `image.yml`：构建 ARM64 / AMD64 镜像；手动选择 publish 或发布 Release 时上传 GHCR，使用 GitHub 的内置令牌。

镜像名从仓库生成，默认本地 Compose 从源码构建。发布镜像前需检查对应架构上的实际运行结果。

## 发布内容

提交前检查 Git 暂存区；`.env`、`.secrets`、数据库、私钥、构建产物、测试截图和 Cloudflare 本地输出均不纳入版本管理。测试中的设备地址与密码是合成数据。

不要把真实设备数据库或 bootstrap 文件复制到源码目录，也不要将含设备信息的截图用于公开文档。第三方模型与字体的许可见 [THIRD_PARTY.md](../THIRD_PARTY.md)。
