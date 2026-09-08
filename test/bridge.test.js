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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

async function postJson(baseUrl, pathname, body) {
  return fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function waitFor(predicate, message, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
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
      sourceAnalysis: { postSummary: "原帖展示模型评测。", claimedModel: "GPT-6", modelEvidence: "原帖正文明确提到 GPT-6", confidence: "高" },
      medeoPrompt: "[00:00–00:12] 人物从远景走到近景，粉色画面硬切收束。"
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
        taskMode: "adapt",
        analysisPrompt: "分析镜头并执行替换。",
        replacementBrief: "把原产品替换成银色耳机。",
        scenes: [{ id: "scene-1", index: 1, startSeconds: 0, endSeconds: 12, frameTimes: [2, 6, 10] }],
        contactSheets: [{ id: "sheet-1", sceneIds: ["scene-1"], frameCount: 3, dataUrl: "data:image/jpeg;base64,AA==" }],
        referenceImages: [{ name: "耳机.png", dataUrl: "data:image/png;base64,AA==" }]
      })
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.medeoPrompt, "原贴模型：GPT-6\n[00:00–00:12] 人物从远景走到近景，粉色画面硬切收束。");
    assert.equal(payload.sourceAnalysis.claimedModel, "GPT-6");
    assert.equal("clips" in payload, false);
    assert.equal(requests[0].model, "gemini-3.7-flash");
    assert.equal(requests[0].messages[1].content.filter((item) => item.type === "image_url").length, 2);
    assert.match(requests[0].messages[1].content[0].text, /银色耳机/u);
    assert.match(requests[0].messages[1].content[0].text, /任务类型：改编成用户的视频/u);
    assert.match(requests[0].messages[1].content[0].text, /分析镜头并执行替换/u);
    assert.match(requests[0].messages[0].content, /内部按每个 clip/u);
    assert.match(requests[0].messages[0].content, /不要在响应中返回 clips/u);
  });
});

test("bridge 合并相同规范化输入的在途请求并在成功后短期复用", async () => {
  const gate = deferred();
  let upstreamCalls = 0;
  const comments = {
    comments: [
      { title: "观点补充", text: "第一条" },
      { title: "开放提问", text: "第二条" },
      { title: "实践计划", text: "第三条" }
    ]
  };
  await withBridge({
    apiKey: "test-only-key",
    baseUrl: "https://upstream.invalid/v1",
    extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    idempotencyTtlMs: 40,
    upstreamFetch: async () => {
      upstreamCalls += 1;
      if (upstreamCalls === 1) await gate.promise;
      return upstreamResponse(comments);
    }
  }, async (baseUrl) => {
    const first = postJson(baseUrl, "/v1/text/comments", {
      sourcePost: { ...sourcePost, text: `  ${sourcePost.text}  ` },
      ignoredClientField: "不参与规范化"
    });
    const second = postJson(baseUrl, "/v1/text/comments", {
      sourcePost,
      replyLanguage: "zh-CN"
    });

    try {
      await waitFor(() => upstreamCalls === 1, "没有等到首个上游请求");
      assert.equal(upstreamCalls, 1, "相同规范化输入的在途请求应只调用一次上游");
    } finally {
      gate.resolve();
    }
    const [firstResponse, secondResponse] = await Promise.all([first, second]);
    assert.equal(firstResponse.status, 200);
    assert.equal(secondResponse.status, 200);
    assert.deepEqual(await firstResponse.json(), await secondResponse.json());

    const cached = await postJson(baseUrl, "/v1/text/comments", { sourcePost });
    assert.equal(cached.status, 200);
    assert.equal(upstreamCalls, 1, "成功结果在 TTL 内应直接复用");

    await new Promise((resolve) => setTimeout(resolve, 55));
    const afterTtl = await postJson(baseUrl, "/v1/text/comments", { sourcePost });
    assert.equal(afterTtl.status, 200);
    assert.equal(upstreamCalls, 2, "TTL 到期后应重新调用上游");
  });
});

test("bridge 失败后立即释放相同请求并允许重试", async () => {
  let upstreamCalls = 0;
  await withBridge({
    apiKey: "test-only-key",
    baseUrl: "https://upstream.invalid/v1",
    extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    upstreamFetch: async () => {
      upstreamCalls += 1;
      if (upstreamCalls === 1) {
        return new Response(JSON.stringify({ error: { message: "temporary" } }), {
          status: 502,
          headers: { "content-type": "application/json" }
        });
      }
      return upstreamResponse({
        comments: [
          { title: "观点补充", text: "重试成功一" },
          { title: "开放提问", text: "重试成功二" },
          { title: "实践计划", text: "重试成功三" }
        ]
      });
    }
  }, async (baseUrl) => {
    const failed = await postJson(baseUrl, "/v1/text/comments", { sourcePost });
    assert.equal(failed.status, 502);
    const retried = await postJson(baseUrl, "/v1/text/comments", { sourcePost });
    assert.equal(retried.status, 200);
    assert.equal(upstreamCalls, 2, "失败结果不得进入成功复用窗口");
  });
});

test("bridge 不会让不同输入或不同接口互相拦截", async () => {
  const gate = deferred();
  const requestBodies = [];
  await withBridge({
    apiKey: "test-only-key",
    baseUrl: "https://upstream.invalid/v1",
    extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    upstreamFetch: async (_url, init) => {
      const body = JSON.parse(init.body);
      requestBodies.push(body);
      await gate.promise;
      const system = body.messages[0].content;
      if (system.includes("X 评论助手")) {
        return upstreamResponse({
          comments: [
            { title: "观点补充", text: "不同输入一" },
            { title: "开放提问", text: "不同输入二" },
            { title: "实践计划", text: "不同输入三" }
          ]
        });
      }
      return upstreamResponse({
        sourceSummary: "不同接口",
        mechanisms: [1, 2, 3].map((index) => ({ id: `m${index}`, label: `机制 ${index}`, detail: `说明 ${index}` })),
        scriptIdeas: [1, 2, 3].map((index) => ({ id: `s${index}`, label: `脚本 ${index}`, detail: `说明 ${index}` }))
      });
    }
  }, async (baseUrl) => {
    const requests = [
      postJson(baseUrl, "/v1/text/comments", { sourcePost, replyLanguage: "en" }),
      postJson(baseUrl, "/v1/text/comments", { sourcePost, replyLanguage: "ja" }),
      postJson(baseUrl, "/v1/text/inspiration", { sourcePost })
    ];
    try {
      await waitFor(() => requestBodies.length === 3, "没有等到三个独立上游请求");
      assert.equal(requestBodies.length, 3, "不同输入以及不同接口应各自调用上游");
    } finally {
      gate.resolve();
    }
    const responses = await Promise.all(requests);
    assert.ok(responses.every((response) => response.status === 200));
  });
});
