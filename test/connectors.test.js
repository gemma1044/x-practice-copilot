import test from "node:test";
import assert from "node:assert/strict";
import {
  ConnectorNotConfiguredError,
  ConnectorRequestError,
  DemoTextConnector,
  LoopbackTextConnector,
  UnconfiguredTextConnector
} from "../src/core/connectors.js";

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

test("生产文字 connector 只请求本机 bridge", async () => {
  const requests = [];
  const connector = new LoopbackTextConnector({
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return new Response(JSON.stringify([{ title: "A", text: "B" }]), { status: 200 });
    }
  });
  await connector.generateComments({ sourcePost: { text: "帖子" } });
  assert.equal(requests[0].url, "http://127.0.0.1:4317/v1/text/comments");
  assert.equal(JSON.parse(requests[0].init.body).sourcePost.text, "帖子");
  assert.equal("authorization" in requests[0].init.headers, false);
});

test("生产文字 connector 将断网与超时归一为可恢复错误", async () => {
  const unavailable = new LoopbackTextConnector({ fetchImpl: async () => { throw new Error("offline"); } });
  await assert.rejects(
    () => unavailable.generateInspiration({ sourcePost: { text: "帖子" } }),
    (error) => error instanceof ConnectorRequestError && error.code === "BRIDGE_UNAVAILABLE"
  );

  const timeout = new LoopbackTextConnector({
    timeoutMs: 10,
    fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
    })
  });
  await assert.rejects(
    () => timeout.generateComments({ sourcePost: { text: "帖子" } }),
    (error) => error instanceof ConnectorRequestError && error.code === "BRIDGE_TIMEOUT"
  );
});
