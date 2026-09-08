# X Practice Copilot

一个给 Gemma 单人使用的浏览器扩展项目：在浏览 X（Twitter）时，通过 Merouter 的 `deepseek_v4_flash` 辅助生成评论、沉淀灵感、设计真实小实践，并把视频拆解结果转成 Medeo 复刻提示词。当前业务数据保存在 Chrome Storage；个人飞书配置核验后才允许同步，始终禁止写入公司租户。

当前阶段：M1 已完成；M2–M3 的本机实现及 M5 的公开视频下载与本机截帧骨架已具备。扩展可直接以“加载已解压的扩展程序”运行；真实模型、个人飞书和视觉连接器仍需外部配置与验收。

`demo/` 只是交互预览，不是浏览器插件。运行 `npm run package:extension` 后生成的 `dist/x-practice-copilot-extension/` 才是交给 Chrome / Edge“加载已解压的扩展程序”的目录。

- PRD：`docs/prd/index.html`
- 方案层：`docs/plans/twitter-ai-copilot/solution.md`
- 实现层：`docs/plans/twitter-ai-copilot/implementation.md`
- 隐私与数据边界：`docs/privacy.md`
- Chrome / Edge 回归清单：`docs/testing/browser-regression.md`

## 本地运行

### 先看交互 Demo

```bash
python3 -m http.server 4173
```

然后打开 `http://127.0.0.1:4173/demo/`。这是复用真实 Side Panel 的本地模拟页，不需要安装扩展；不会调用 AI、写入飞书、上传文件或发布评论。

### 加载真实扩展

先生成只包含浏览器运行文件的扩展目录：

```bash
npm run package:extension
```

1. 打开 Chrome 的 `chrome://extensions` 或 Edge 的 `edge://extensions`。
2. 开启“开发者模式”，点击“加载已解压的扩展程序”。
3. 选择生成目录：`/Users/gemma/Projects/x-practice-copilot/dist/x-practice-copilot-extension`。
4. 打开 `https://x.com`，在任一已渲染帖子的操作区点击“AI 评论 / 收为灵感 / 拆解视频”。

扩展不会自动发布评论。真实 AI 未配置时会明确显示未配置；灵感只写入浏览器 `chrome.storage.local`。视频 MVP 只处理用户主动确认的单条公开视频：本机 `yt-dlp` 临时下载，FFmpeg 识别场景并在每个场景均匀截取早、中、晚 3 帧，每 3 个场景合成一张九宫格；用户确认后由 Merouter `gemini-3.7-flash` 分析。原视频和单帧不上传且处理后立即清理；默认不读取登录 Cookie，不批量抓取。修改文件后，在扩展管理页点击“重新加载”再刷新 X 页面。

## 测试

需要 Node.js 20 或更高版本：

```bash
npm test
```

测试包含纯函数/Repository 单测，以及使用本地十帖夹具运行的 MV3 浏览器验收；不会访问真实 X、AI、飞书、视觉模型或 Medeo。单独运行浏览器验收可使用：

```bash
npm run test:browser
```

## 启动本机文字 AI bridge

1. 打开项目根目录的 `.env`，只填写 `OPENAI_API_KEY`。该文件已被 Git 忽略；Base URL 和当前打包目录对应的扩展 ID 已预填。
2. 启动 bridge：

```bash
npm run bridge
```

bridge 只监听 `127.0.0.1:4317`。启动后重新打开 Side Panel，状态会显示“AI 已连接”；缺少任一变量时只提供健康状态并拒绝模型请求。如果扩展不是从 README 所述打包目录加载，请把 `chrome://extensions` 显示的实际扩展 ID 写入 `XPC_EXTENSION_ID`。可用 `XPC_BRIDGE_PORT` 改端口，但同时需要同步修改扩展的 connector 与 host permission，当前不建议改动。

当前开发机已通过 macOS LaunchAgent `ai.one2x.x-practice-copilot.bridge` 托管 bridge：登录时自动启动，异常退出后自动拉起。日志位于 `/Users/gemma/Library/Logs/XPracticeCopilot/`。Side Panel 在可见时每 5 秒刷新一次本机连接状态，bridge 恢复后无需重新打开面板。

## 连接器与密钥边界

- 文字能力入口为 `TextGenerationConnector`，目标是由本机安全桥接通过 OpenAI-compatible 接口访问 Merouter `deepseek_v4_flash`。
- 本机既有约定使用 `OPENAI_API_KEY` 与 `OPENAI_BASE_URL=https://merouter.play.one2x.ai/v1`。真实 key 只能由本机桥接环境读取，不能写入扩展包、源码或提交记录。
- 本机桥接已提供 `/health`、`/v1/text/comments`、`/v1/text/inspiration`、`/v1/video/frames` 与 `/v1/vision/analyze`；模型返回会经过结构校验，未配置、超时或异常时不会用本地模板伪装成功。
- 视觉分析使用独立 `VisionAnalysisConnector`，经 Merouter 固定调用 `gemini-3.7-flash`，不交给 `deepseek_v4_flash` 假装识图。
- 业务数据只有 `PracticeRepository` 一个入口。当前为本地开发适配器；个人飞书连接身份未确认前，`UnconfiguredPersonalFeishuRepository` 拒绝远程读写，禁止接入公司租户。
- 本地状态统一保存在版本化的 `xpc_practice_state`；首次写入会迁移旧 `xpc_inspirations`。同步队列与业务实体同处这一状态，不形成第二条数据通道。
- Medeo 只产出可复制的完整 prompt 框架，未调用 `/Users/gemma/Projects/medeo-video-skill`。

## 本机视频工具

视频拆解依赖 `yt-dlp`、`ffmpeg` 和 `ffprobe`。bridge 会先检查工具是否存在；缺少时只提示安装，不会退回浏览器 Cookie 抓取。默认单任务串行、IPv4、请求间隔 1 秒、最多 5 分钟/250 MB；X 返回 429 后进入 15 分钟本机冷却，403 也会停止处理，不自动密集重试或轮换代理。

实现入口和数据通道路标统一记录在 `CHANGELOG.md`。
