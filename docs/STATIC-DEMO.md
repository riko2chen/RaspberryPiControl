# 纯静态演示

公开预览：https://picontrol.rikolab.com

演示与 Docker 共用界面、三维模型和模拟逻辑。纯静态构建不访问设备后端，不扫描局域网，不创建真实 API 令牌。设置、历史和 OLED 帧仅保存在浏览器；“重置演示”可以清空。

## 构建与本地预览

需要 Node.js 22：

```sh
npm --prefix frontend ci
npm --prefix frontend run build:demo
python3 scripts/preview-demo.py
```

打开预览脚本打印的地址。发布目录只有 `frontend/dist-demo`；不应上传项目根目录、完整服务的 `dist` 或 Docker 数据卷。

资源路径为相对路径，支持根域名和仓库子目录。字体、模型和 API 文档都随站点打包。API 文档为只读参考，不提供在线执行入口。

演示还包含 `demo.html` 视频播放页与分享卡片。它们从 `docs/media/` 打包，只进入静态演示，Docker 服务不包含这些宣传媒体。若发布到自己的域名或 GitHub Pages，构建时设置公开站点地址，让分享图片和规范链接指向自己的站点：

```sh
PI_CONTROL_SITE_URL=https://example.github.io/RaspberryPiControl/ npm --prefix frontend run build:demo
```

默认地址是 `https://picontrol.rikolab.com/`。该变量只能填写公开网址，不要包含凭据或访问令牌。

## Cloudflare

当前站点使用 **Workers Static Assets**，没有自定义 Worker 业务代码、数据库绑定或设备代理。通过已登录的 `cf` CLI 部署：

```sh
python3 scripts/prepare-cloudflare.py --name pi-control-demo --domain your-demo.example.com
cf deploy --prebuilt --dry-run
cf deploy --prebuilt
```

将域名替换为自己在 Cloudflare 管理的子域名。自定义域名部署会配置对应 DNS 和 HTTPS。不要复用已有业务的 Worker 名称或域名。

准备脚本使用 `cf 1.0.0-beta.5` 支持的 v0 Build Output 格式，只复制静态演示目录。生成的 `.cloudflare/` 不进入 Git 或 Docker；认证由本机 `cf` 配置提供，无需将账户 ID 或令牌写入项目。CLI 升级后应先运行 dry-run。

演示通过 CSP 限制脚本、字体、模型和网络连接到本站；响应设置 `no-referrer` 与 `no-transform`，避免泄露来源参数或注入访问统计脚本。没有应用级访问统计或用户数据上传。托管服务仍会处理提供网页所必需的网络请求。

更新演示需重新构建并部署。仓库推送不会自动修改此 Cloudflare 站点；无需在 GitHub 保存 Cloudflare 令牌。

## GitHub Pages（可选）

保留 `.github/workflows/pages.yml` 供独立使用，默认不会自动发布：

1. 在仓库 Settings → Pages 中选择 GitHub Actions。
2. 在 Actions 中手动运行 **GitHub Pages demo**。
3. 工作流仅发布 `frontend/dist-demo`。

Pages 与 Cloudflare 使用同一份静态演示。HTML 内也包含 CSP 和 Referrer 策略，不依赖 Pages 对 `_headers` 的支持。GitHub Pages 不启用时，无需配置任何额外凭据。

参考：[Cloudflare 静态资源](https://developers.cloudflare.com/workers/static-assets/)、[静态响应头](https://developers.cloudflare.com/workers/static-assets/headers/)、[统计注入与 no-transform](https://developers.cloudflare.com/web-analytics/faq/)。
