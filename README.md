# X Practice Copilot

一个给 Gemma 单人使用的浏览器扩展项目：在浏览 X（Twitter）时，通过 Merouter 的 `deepseek_v4_flash` 辅助生成评论、沉淀灵感、设计真实小实践，并把视频拆解结果转成 Medeo 复刻提示词。业务数据暂存 Gemma 个人飞书账号下的独立多维表格，禁止写入公司租户。

当前阶段：M1 浏览器壳已通过 Chromium MV3 自动验收。扩展可直接以“加载已解压的扩展程序”运行；模型、个人飞书和视觉连接器仍处于明确的未配置状态。

- PRD：`docs/prd/index.html`
- 方案层：`docs/plans/twitter-ai-copilot/solution.md`
- 实现层：`docs/plans/twitter-ai-copilot/implementation.md`

## 本地运行

### 先看交互 Demo

```bash
python3 -m http.server 4173
```

然后打开 `http://127.0.0.1:4173/demo/`。这是复用真实 Side Panel 的本地模拟页，不需要安装扩展；不会调用 AI、写入飞书、上传文件或发布评论。

### 加载真实扩展

1. 打开 Chrome 的 `chrome://extensions` 或 Edge 的 `edge://extensions`。
2. 开启“开发者模式”，点击“加载已解压的扩展程序”。
3. 选择本项目根目录：`/Users/gemma/Projects/x-practice-copilot`。
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

## 连接器与密钥边界

- 文字能力入口为 `TextGenerationConnector`，目标是由本机安全桥接通过 OpenAI-compatible 接口访问 Merouter `deepseek_v4_flash`。
- 本机既有约定使用 `OPENAI_API_KEY` 与 `OPENAI_BASE_URL=https://merouter.play.one2x.ai/v1`。真实 key 只能由本机桥接环境读取，不能写入扩展包、源码或提交记录。
- 本机桥接的具体 HTTP contract 尚未在本项目确认，因此本轮没有臆造地址或伪装调用成功；`UnconfiguredTextConnector` 会稳定返回未配置状态。
- 视觉分析使用独立 `VisionAnalysisConnector`，不交给 `deepseek_v4_flash` 假装识图。
- 业务数据只有 `PracticeRepository` 一个入口。当前为本地开发适配器；个人飞书连接身份未确认前，`UnconfiguredPersonalFeishuRepository` 拒绝远程读写，禁止接入公司租户。
- Medeo 只产出可复制的完整 prompt 框架，未调用 `/Users/gemma/Projects/medeo-video-skill`。

实现入口和数据通道路标统一记录在 `CHANGELOG.md`。
