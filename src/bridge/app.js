import http from "node:http";
import { BridgeProtocolError, normalizeSourcePost, parseModelJson, validateComments, validateInspiration } from "./protocol.js";
import { commentMessages, inspirationMessages } from "./prompts.js";

const BODY_LIMIT = 64 * 1024;

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

async function readJson(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw new BridgeProtocolError("请求体过大", "PAYLOAD_TOO_LARGE", 413);
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
  extensionId = "",
  upstreamFetch = globalThis.fetch,
  timeoutMs = 30_000
} = {}) {
  const configured = Boolean(apiKey && baseUrl && extensionId);
  return http.createServer(async (request, response) => {
    const origin = request.headers.origin || "";
    if (!allowedOrigin(origin, extensionId)) {
      return json(response, 403, { error: { code: "ORIGIN_FORBIDDEN", message: "请求来源未获允许" } });
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
      return json(response, 200, {
        ok: true,
        configured,
        provider: "Merouter",
        model
      }, origin);
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
      const modelResult = await callModel({ apiKey, baseUrl, model, upstreamFetch, timeoutMs, messages: route.messages(sourcePost) });
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
