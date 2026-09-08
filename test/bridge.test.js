import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createBridgeServer } from "../src/bridge/app.js";

async function withBridge(options, run) {
  const server = createBridgeServer(options);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

const sourcePost = {
  id: "1",
  url: "https://x.com/a/status/1",
  text: "用真实任务评估模型。",
  authorName: "作者"
};

function upstreamResponse(content) {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

test("未配置 bridge 只报告状态并拒绝模型请求", async () => {
  await withBridge({}, async (baseUrl) => {
    const health = await fetch(`${baseUrl}/health`).then((response) => response.json());
    assert.equal(health.configured, false);
    assert.equal("apiKey" in health, false);

    const response = await fetch(`${baseUrl}/v1/text/comments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourcePost })
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "BRIDGE_NOT_CONFIGURED");
  });
});

test("评论与灵感共用锁定模型的 OpenAI-compatible 上游", async () => {
  const requests = [];
  const upstreamFetch = async (url, init) => {
    requests.push({ url, authorization: init.headers.authorization, body: JSON.parse(init.body) });
    const system = JSON.parse(init.body).messages[0].content;
    if (system.includes("X 评论助手")) {
      return upstreamResponse({
        comments: [
          { title: "观点补充", text: "产物可复查比口头能力更重要。" },
          { title: "开放提问", text: "你会保留哪个判断信号？" },
          { title: "实践计划", text: "可以记录耗时和返工次数再比较。" }
        ]
      });
    }
    return upstreamResponse({
      sourceSummary: "真实任务评估",
      mechanisms: [1, 2, 3].map((index) => ({ id: `m${index}`, label: `机制 ${index}`, detail: `机制说明 ${index}` })),
      scriptIdeas: [1, 2, 3].map((index) => ({ id: `s${index}`, label: `脚本 ${index}`, detail: `脚本说明 ${index}` }))
    });
  };

  await withBridge({
    apiKey: "test-only-key",
    baseUrl: "https://upstream.invalid/v1",
    extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    upstreamFetch
  }, async (baseUrl) => {
    const comments = await fetch(`${baseUrl}/v1/text/comments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourcePost, replyLanguage: "en" })
    }).then((response) => response.json());
    const inspiration = await fetch(`${baseUrl}/v1/text/inspiration`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourcePost })
    }).then((response) => response.json());

    assert.equal(comments.length, 3);
    assert.equal(inspiration.mechanisms.length, 3);
    assert.equal(inspiration.scriptIdeas.length, 3);
    assert.equal(requests.length, 2);
    assert.ok(requests.every((request) => request.url === "https://upstream.invalid/v1/chat/completions"));
    assert.ok(requests.every((request) => request.authorization === "Bearer test-only-key"));
    assert.ok(requests.every((request) => request.body.model === "deepseek_v4_flash"));
    assert.match(requests[0].body.messages[0].content, /natural English/u);
  });
});

test("bridge 拒绝越界来源和不合法模型结构", async () => {
  await withBridge({
    apiKey: "test-only-key",
    baseUrl: "https://upstream.invalid/v1",
    extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    upstreamFetch: async () => upstreamResponse({ comments: [{ title: "少一条", text: "不合法" }] })
  }, async (baseUrl) => {
    const forbidden = await fetch(`${baseUrl}/health`, { headers: { origin: "https://example.com" } });
    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.headers.get("access-control-allow-origin"), "https://example.com");
    assert.equal((await forbidden.json()).error.code, "ORIGIN_FORBIDDEN");

    const invalid = await fetch(`${baseUrl}/v1/text/comments`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
      body: JSON.stringify({ sourcePost })
    });
    assert.equal(invalid.status, 502);
    assert.equal((await invalid.json()).error.code, "INVALID_MODEL_OUTPUT");

    const unsupportedLanguage = await fetch(`${baseUrl}/v1/text/comments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourcePost, replyLanguage: "unsupported" })
    });
    assert.equal(unsupportedLanguage.status, 400);
    assert.equal((await unsupportedLanguage.json()).error.code, "UNSUPPORTED_REPLY_LANGUAGE");
  });
});

test("bridge 将上游超时变成可判定错误", async () => {
  const upstreamFetch = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
  });
  await withBridge({
    apiKey: "test-only-key",
    baseUrl: "https://upstream.invalid/v1",
    extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    upstreamFetch,
    timeoutMs: 20
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/text/comments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourcePost })
    });
    assert.equal(response.status, 504);
    assert.equal((await response.json()).error.code, "UPSTREAM_TIMEOUT");
  });
});

test("视频端点复用本机 bridge 且不依赖文字模型配置", async () => {
  const mediaService = {
    async getStatus() { return { configured: true, hasYtDlp: true, hasFfmpeg: true, hasFfprobe: true }; },
    async prepare({ sourceUrl }) {
      return {
        taskId: "task-1",
        sourceUrl,
        durationSeconds: 12,
        scenes: [{ id: "scene-1", index: 1, startSeconds: 0, endSeconds: 12, frameTimes: [2, 6, 10] }],
        contactSheets: [{ id: "sheet-1", sceneIds: ["scene-1"], frameCount: 3, dataUrl: "data:image/jpeg;base64,AA==" }]
      };
    }
  };
  await withBridge({ extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", mediaService }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/video/frames`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
      body: JSON.stringify({ sourcePost })
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.sourceUrl, sourcePost.url);
    assert.equal(payload.scenes.length, 1);
    assert.equal(payload.contactSheets.length, 1);
  });
});

test("视觉端点固定使用 Gemini 3.7 Flash 并接收九宫格", async () => {
  const requests = [];
  const upstreamFetch = async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return upstreamResponse({
      summary: "人物位置在场景内发生变化。",
      structure: { hook: "人物开场", progression: "产品展示", ending: "字卡收束", pace: "快切" },
      scenes: [{ index: 1, timeRange: "0–12s", visibleChange: "远景到近景", visualStyle: "粉色", transition: "硬切" }],
      medeoPrompt: "生成一条竖屏时尚短片。"
    });
  };
  await withBridge({
    apiKey: "test-only-key",
    baseUrl: "https://upstream.invalid/v1",
    extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    upstreamFetch
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/vision/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
      body: JSON.stringify({
        sourcePost,
        analysisPrompt: "分析镜头并执行替换。",
        replacementBrief: "把原产品替换成银色耳机。",
        scenes: [{ id: "scene-1", index: 1, startSeconds: 0, endSeconds: 12, frameTimes: [2, 6, 10] }],
        contactSheets: [{ id: "sheet-1", sceneIds: ["scene-1"], frameCount: 3, dataUrl: "data:image/jpeg;base64,AA==" }],
        referenceImages: [{ name: "耳机.png", dataUrl: "data:image/png;base64,AA==" }]
      })
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).medeoPrompt, "生成一条竖屏时尚短片。");
    assert.equal(requests[0].model, "gemini-3.7-flash");
    assert.equal(requests[0].messages[1].content.filter((item) => item.type === "image_url").length, 2);
    assert.match(requests[0].messages[1].content[0].text, /银色耳机/u);
    assert.match(requests[0].messages[1].content[0].text, /分析镜头并执行替换/u);
  });
});
