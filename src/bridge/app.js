import http from "node:http";
import { BridgeProtocolError, normalizeReplyLanguage, normalizeSourcePost, normalizeVideoRequest, normalizeVisionRequest, parseModelJson, validateComments, validateInspiration, validateVisionAnalysis } from "./protocol.js";
import { commentMessages, inspirationMessages, visionMessages } from "./prompts.js";
import { createLocalMediaService } from "./media.js";

const BODY_LIMIT = 64 * 1024;
const VISION_BODY_LIMIT = 40 * 1024 * 1024;

function json(response, status, payload, origin) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...(origin ? { "access-control-allow-origin": origin, vary: "origin" } : {})
  });
  response.end(JSON.stringify(payload));
}

function allowedOrigin(origin, extensionId) {
  if (!origin) return true;
  if (extensionId) return origin === `chrome-extension://${extensionId}`;
  return /^chrome-extension:\/\/[a-p]{32}$/u.test(origin);
}

async function readJson(request, limit = BODY_LIMIT) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new BridgeProtocolError("请求体过大", "PAYLOAD_TOO_LARGE", 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new BridgeProtocolError("请求体不是合法 JSON");
  }
}

async function callModel({ apiKey, baseUrl, model, upstreamFetch, timeoutMs, messages }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await upstreamFetch(`${baseUrl.replace(/\/$/u, "")}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model, messages, temperature: 0.4, response_format: { type: "json_object" } }),
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new BridgeProtocolError(payload.error?.message || `Merouter 返回 ${response.status}`, "UPSTREAM_ERROR", 502);
    }
    return parseModelJson(payload.choices?.[0]?.message?.content);
  } catch (error) {
    if (error instanceof BridgeProtocolError) throw error;
    if (error.name === "AbortError") throw new BridgeProtocolError("Merouter 请求超时", "UPSTREAM_TIMEOUT", 504);
    throw new BridgeProtocolError("无法连接 Merouter", "UPSTREAM_UNAVAILABLE", 502);
  } finally {
    clearTimeout(timeout);
  }
}

export function createBridgeServer({
  apiKey = "",
  baseUrl = "",
  model = "deepseek_v4_flash",
  visionModel = "gemini-3.7-flash",
  extensionId = "",
  upstreamFetch = globalThis.fetch,
  timeoutMs = 30_000,
  mediaService = createLocalMediaService()
} = {}) {
  const configured = Boolean(apiKey && baseUrl && extensionId);
  return http.createServer(async (request, response) => {
    const origin = request.headers.origin || "";
    if (!allowedOrigin(origin, extensionId)) {
      return json(response, 403, {
        error: {
          code: "ORIGIN_FORBIDDEN",
          message: "当前扩展 ID 与本机 bridge 配置不一致",
          nextStep: "把 chrome://extensions 显示的扩展 ID 写入 .env 的 XPC_EXTENSION_ID，然后重启 bridge。"
        }
      }, origin);
    }
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "access-control-allow-origin": origin,
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type",
        vary: "origin"
      });
      return response.end();
    }
    if (request.method === "GET" && request.url === "/health") {
      const media = await mediaService.getStatus();
      return json(response, 200, {
        ok: true,
        configured,
        provider: "Merouter",
        model,
        vision: { configured, provider: "Merouter", model: visionModel },
        media
      }, origin);
    }
    if (request.method === "POST" && request.url === "/v1/video/frames") {
      if (!extensionId) {
        return json(response, 503, {
          error: { code: "BRIDGE_NOT_CONFIGURED", message: "本机 bridge 尚未绑定扩展 ID" }
        }, origin);
      }
      try {
        const input = normalizeVideoRequest(await readJson(request));
        return json(response, 200, await mediaService.prepare(input), origin);
      } catch (error) {
        const normalized = error instanceof BridgeProtocolError
          ? error
          : new BridgeProtocolError("bridge 内部错误", "INTERNAL_ERROR", 500);
        return json(response, normalized.status, {
          error: { code: normalized.code, message: normalized.message, nextStep: "保留当前帖子，不要连续重试。" }
        }, origin);
      }
    }
    if (request.method === "POST" && request.url === "/v1/vision/analyze") {
      if (!configured) {
        return json(response, 503, {
          error: { code: "BRIDGE_NOT_CONFIGURED", message: "本机 bridge 尚未配置 Merouter" }
        }, origin);
      }
      try {
        const input = normalizeVisionRequest(await readJson(request, VISION_BODY_LIMIT));
        const modelResult = await callModel({
          apiKey,
          baseUrl,
          model: visionModel,
          upstreamFetch,
          timeoutMs: Math.max(timeoutMs, 60_000),
          messages: visionMessages(input)
        });
        return json(response, 200, validateVisionAnalysis(modelResult), origin);
      } catch (error) {
        const normalized = error instanceof BridgeProtocolError
          ? error
          : new BridgeProtocolError("bridge 内部错误", "INTERNAL_ERROR", 500);
        return json(response, normalized.status, {
          error: { code: normalized.code, message: normalized.message, nextStep: "保留九宫格，检查 bridge 日志后手动重试。" }
        }, origin);
      }
    }
    const routes = {
      "/v1/text/comments": { messages: commentMessages, validate: validateComments },
      "/v1/text/inspiration": { messages: inspirationMessages, validate: validateInspiration }
    };
    const route = request.method === "POST" ? routes[request.url] : null;
    if (!route) return json(response, 404, { error: { code: "NOT_FOUND", message: "接口不存在" } }, origin);
    if (!configured) {
      return json(response, 503, {
        error: {
          code: "BRIDGE_NOT_CONFIGURED",
          message: "本机 bridge 尚未配置 Merouter",
          nextStep: "在启动 bridge 的终端环境设置 OPENAI_API_KEY、OPENAI_BASE_URL 与 XPC_EXTENSION_ID。"
        }
      }, origin);
    }
    try {
      const body = await readJson(request);
      const sourcePost = normalizeSourcePost(body);
      const replyLanguage = request.url === "/v1/text/comments" ? normalizeReplyLanguage(body.replyLanguage) : undefined;
      const modelResult = await callModel({ apiKey, baseUrl, model, upstreamFetch, timeoutMs, messages: route.messages(sourcePost, replyLanguage) });
      return json(response, 200, route.validate(modelResult), origin);
    } catch (error) {
      const normalized = error instanceof BridgeProtocolError
        ? error
        : new BridgeProtocolError("bridge 内部错误", "INTERNAL_ERROR", 500);
      return json(response, normalized.status, {
        error: { code: normalized.code, message: normalized.message, nextStep: "保留当前帖子上下文，检查 bridge 日志后重试。" }
      }, origin);
    }
  });
}
