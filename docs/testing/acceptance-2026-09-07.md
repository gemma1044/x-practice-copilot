# 自动验收记录｜2026-09-07

## 结论

`npm test`：25 项通过，0 项失败。

## 已覆盖

- M1：真实 MV3 Chromium 运行时加载扩展；十帖共 30 个入口、正确上下文、重复注入、站内换页、刷新和误触防护。
- M2：未配置状态、唯一 loopback connector、锁定模型、扩展来源、请求大小、上游超时、断网和脏 JSON；上游全部为 mock。
- M3：旧数据迁移、灵感 upsert、实践状态、用户证据确认、主张映射、刷新回读及完整 Demo 流程。
- M4 基础：同一版本化状态内的待同步队列去重、失败计数和成功移除；未连接飞书。
- M5 基础：3–8 张限制、图片预览、排序、单张移除及无视频上传承诺；未连接视觉模型。
- M6 基础：最小权限、扩展前端无密钥/无 Merouter 直连、隐私与人工回归文档。
- 打包：`npm run package:extension` 生成独立扩展目录；该目录再次通过 MV3 Chromium 验收，并确认不包含 bridge 或测试文件。

## 额外检查

- 所有 `src/**/*.js` 与 `test/**/*.js` 已通过 `node --check`。
- `git diff --check` 无空白错误。
- 未启动真实 Merouter、飞书、视觉模型或 Medeo 请求。
- 本机 bridge 无配置启动后，`GET /health` 返回 `configured: false`，且未泄露密钥。

## 尚不能记为通过

- Merouter 真实生成：缺少本轮授权使用的凭据与真实请求证据。
- 个人飞书读写：身份、权限、Base 和表结构尚未核验。
- 视觉分析：模型与凭据未选择。
- 真实 X、Chrome 与 Edge 人工发布回归：当前自动测试使用本地 X 夹具，本机未安装 Edge。

## 真实 X 匿名核对

带界面的隔离 Chromium 已访问 `https://x.com/OpenAI`，HTTP 200，标题为 `OpenAI (@OpenAI) / X`。匿名页面显示登录墙，帖子正文虽出现在页面文本中，但没有渲染扩展当前依赖的 `article[data-testid="tweet"]` 节点，因此 Copilot 入口为 0。截图见 `docs/testing/real-x-headed.png`。

这只证明 X 可达及匿名登录墙行为；不能替代在用户已登录的日常 Chrome 中加载扩展后的验收。
