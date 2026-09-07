import test from "node:test";
import assert from "node:assert/strict";
import { ConnectorNotConfiguredError, DemoTextConnector, UnconfiguredTextConnector } from "../src/core/connectors.js";

test("真实灵感 AI 未配置时不会伪装成功", async () => {
  const connector = new UnconfiguredTextConnector();
  await assert.rejects(() => connector.generateInspiration({}), ConnectorNotConfiguredError);
});

test("Demo AI 只生成机制与具体脚本两道选择题，不生成用户证据", async () => {
  const connector = new DemoTextConnector();
  const result = await connector.generateInspiration({ sourcePost: { text: "给模型一个真实任务" } });
  assert.ok(result.mechanisms.length >= 3);
  assert.ok(result.scriptIdeas.length >= 3);
  assert.match(result.scriptIdeas[0].label, /20 分钟|海报/u);
  assert.equal("angles" in result, false);
  assert.equal("practices" in result, false);
  assert.equal("evidence" in result, false);
});

test("Demo AI 生成三个评论角度", async () => {
  const result = await new DemoTextConnector().generateComments({ sourcePost: {} });
  assert.equal(result.length, 3);
});
