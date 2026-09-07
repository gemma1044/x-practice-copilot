# CHANGELOG

本文件是 X Practice Copilot 的唯一实现变更入口；每轮同时登记唯一用户入口与数据通道路标。

## 2026-09-07 · M0 基线与 M1 浏览器壳验收

- 初始化本地 Git 仓库，并补充依赖锁文件与忽略规则；未配置或调用任何外部 connector。
- 新增 Playwright MV3 浏览器验收：用本地十帖夹具覆盖 30 个入口、三种帖子上下文、重复注入、站内换页、刷新及误触回复防护。
- 修复 `service-worker.js` 延后调用 `chrome.sidePanel.open()` 导致 Chrome 丢失用户手势、侧栏实际无法打开的问题。
- 内容脚本现在保留侧栏打开失败状态，避免入口点击失败时静默吞错。
- 生产入口仍只有 `src/content/content-script.js`；上下文仍只走 `XPC_OPEN_PANEL → Service Worker → chrome.storage.local → Side Panel`；没有新增 connector 或业务数据通道。
- 统一个人飞书口径为“候选配置尚未核验”；确认前远程 repository 继续拒绝读写，公司租户零接入。

## 2026-09-07 · 视频 MVP 收敛

- 双写更新方案层与实现层：视频 MVP 改为用户手动上传 3–8 张关键截图，视觉连接器只分析截图顺序并整理 Medeo prompt。
- 自动抽帧、视频解码、标签页录制、音频分析与精确时间码整体后置；Demo 同步移除 MP4 / MOV 入口与相关承诺。
- 继续复用唯一 `VisionAnalysisConnector`，没有新增媒体处理或业务数据通道。

## 2026-09-07 · 技术里程碑与管家机制

- 新增从现有 Demo 到可用扩展的 M0–M6 技术路线，先交付文字 Alpha，再完成本地 MVP 与可用发布候选。
- 明确本机 bridge 承载密钥和外部调用；评论与灵感继续共用唯一文字连接器，截图分析与业务数据也分别保持单一接口。
- MVP 继续排除视频抽帧和商店上架；管家只维护基线、依赖与验收，不复制实现。

## 2026-09-07 · 灵感 AI 选择题

- 评论与“收为灵感”复用唯一 `TextGenerationConnector`；Demo 由明确标注的 `Demo AI` 生成内容，真实扩展未配置 Merouter 时不再展示本地模板冒充 AI。
- 灵感卡由 AI 生成机制、个人角度、实践规模与建议证据候选；界面改为四组选择题，只保留一个可选补充框。
- 选择卡视觉收紧为单行文字；AI 的解释保留在悬停提示与无障碍名称中，不占第二行。
- 灵感页移除状态流程、生成说明和飞书说明，只保留选项、一个可选补充框与“保存灵感”。
- 灵感选择区改为轻量工具样式：AI 刷新降级为紧凑次级按钮，选项使用自适应单行胶囊与深色选中态，橙色主按钮只留给最终保存。
- 灵感提问从四题收敛为两题：第一题选复用机制，第二题直接选择包含具体对象、实验结构与叙事钩子的脚本 idea；实践规模和证据不再拆成独立问题。
- 保存仍走唯一 `PracticeRepository`。AI 建议证据写入 `evidencePlan`，不进入用户证据字段，也不会自动推进为“有证据”。

## 2026-09-07 · 可交互本地 Demo

- 新增 `demo/index.html`，模拟 X 帖子并复用真实 `src/sidepanel/index.html`，无需安装扩展即可查看三条主流程。
- Demo 只增加浏览器 API shim：上下文仍沿用 `xpc_current_context / xpc_current_mode`，灵感数据落在 Demo 页的 `localStorage`；没有新增生产入口或第二条业务数据通道。
- Demo 不调用 Merouter、飞书、视觉模型或 Medeo，也不会自动发布、上传文件或消耗额度。

## 2026-09-07 · MVP 骨架

- 新增 Manifest V3 扩展骨架，可在 Chrome / Edge 以“加载已解压的扩展程序”运行。
- 唯一帖子入口：`src/content/content-script.js` 在 X 帖子操作区注入“AI 评论 / 收为灵感 / 拆解视频”，统一打开 `src/sidepanel/index.html`。
- 唯一上下文通道：Content Script → `XPC_OPEN_PANEL` → Service Worker → `chrome.storage.local` → Side Panel。
- 唯一业务数据通道：`PracticeRepository`；当前使用 `ChromeStoragePracticeRepository` 本地开发适配器。个人飞书身份与连接方式未确认，因此远程适配器拒绝写入，公司表没有接入。
- 文字与视觉能力分别由 `TextGenerationConnector`、`VisionAnalysisConnector` 承载；当前均为明确的未配置适配器，没有真实外部调用。
- Medeo 首版只生成并复制完整 prompt 框架；没有调用本机 skill，也没有真实出片。
- 新增证据约束纯函数及 Repository 去重、状态推进测试。
