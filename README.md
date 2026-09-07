# X Practice Copilot

一个给 Gemma 单人使用的浏览器扩展项目：在浏览 X（Twitter）时，通过 Merouter 的 `deepseek_v4_flash` 辅助生成评论、沉淀灵感、设计真实小实践，并把视频拆解结果转成 Medeo 复刻提示词。当前业务数据保存在 Chrome Storage；个人飞书配置核验后才允许同步，始终禁止写入公司租户。

当前阶段：M1 已完成；M2–M3 的本机实现及 M5 的截图管理骨架已具备。扩展可直接以“加载已解压的扩展程序”运行；真实模型、个人飞书和视觉连接器仍需外部配置与验收。

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

扩展不会自动发布评论。真实 AI 未配置时会明确显示未配置；灵感只写入浏览器 `chrome.storage.local`。视频 MVP 只接受用户手动选择的关键截图，不上传视频、不自动抽帧、不录制标签页。修改文件后，在扩展管理页点击“重新加载”再刷新 X 页面。

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

1. 在扩展管理页读取 X Practice Copilot 的扩展 ID。
2. 只在启动 bridge 的终端环境中设置以下变量，不要写入项目文件：

```bash
export OPENAI_API_KEY="你的本机密钥"
export OPENAI_BASE_URL="https://merouter.play.one2x.ai/v1"
export XPC_EXTENSION_ID="扩展管理页显示的 ID"
npm run bridge
```

bridge 只监听 `127.0.0.1:4317`。启动后重新打开 Side Panel，状态会显示“AI 已连接”；缺少任一变量时只提供健康状态并拒绝模型请求。可用 `XPC_BRIDGE_PORT` 改端口，但同时需要同步修改扩展的 connector 与 host permission，当前不建议改动。

## 连接器与密钥边界

- 文字能力入口为 `TextGenerationConnector`，目标是由本机安全桥接通过 OpenAI-compatible 接口访问 Merouter `deepseek_v4_flash`。
- 本机既有约定使用 `OPENAI_API_KEY` 与 `OPENAI_BASE_URL=https://merouter.play.one2x.ai/v1`。真实 key 只能由本机桥接环境读取，不能写入扩展包、源码或提交记录。
- 本机桥接的具体 HTTP contract 尚未在本项目确认，因此本轮没有臆造地址或伪装调用成功；`UnconfiguredTextConnector` 会稳定返回未配置状态。
- 视觉分析使用独立 `VisionAnalysisConnector`，不交给 `deepseek_v4_flash` 假装识图。
- 业务数据只有 `PracticeRepository` 一个入口。当前为本地开发适配器；个人飞书连接身份未确认前，`UnconfiguredPersonalFeishuRepository` 拒绝远程读写，禁止接入公司租户。
- 本地状态统一保存在版本化的 `xpc_practice_state`；首次写入会迁移旧 `xpc_inspirations`。同步队列与业务实体同处这一状态，不形成第二条数据通道。
- Medeo 只产出可复制的完整 prompt 框架，未调用 `/Users/gemma/Projects/medeo-video-skill`。

实现入口和数据通道路标统一记录在 `CHANGELOG.md`。
