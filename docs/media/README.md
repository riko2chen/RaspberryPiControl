# 项目媒体

- `pi-control-og.png`：1280 × 640 分享封面，用于仓库与在线演示。
- `pi-control-demo.mp4`：25 秒、1920 × 994、60 fps 的 H.264 演示，无音频。
- `pi-control-demo-poster.jpg`：视频封面。

视频来自项目演示设备的录屏，裁掉了结尾的录屏工具栏，移除了作者、录制时间等来源元数据。只展示模拟数据，不包含真实设备连接信息。媒体通过同源静态文件提供，不依赖第三方播放器或访问统计。

OG 排版参考 [OGimage.gallery](https://www.ogimage.gallery/) 中的简洁产品封面，图中文字与布局为项目原创，机箱来自本项目实际使用的模型。第三方模型许可见根目录的 `THIRD_PARTY.md`。

## 更新封面

启动 `npm --prefix frontend run dev:demo`，打开 `/og-card.html`。设计源文件是 `frontend/og-card.html` 与 `frontend/promo/og-card.ts`。它们用固定的模拟数据渲染现有三维模型，不读取浏览器里的设备或配置。

以 1280 × 640、设备像素比 1 截图导出 PNG。等待 `body[data-render="ready"]` 且模型绘制完成，确认图片没有浏览器扩展的浮层。该设计页面不进入生产构建。
