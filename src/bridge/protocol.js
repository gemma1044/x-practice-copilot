const MAX_SOURCE_TEXT = 12_000;

export class BridgeProtocolError extends Error {
  constructor(message, code = "INVALID_REQUEST", status = 400) {
    super(message);
    this.name = "BridgeProtocolError";
    this.code = code;
    this.status = status;
  }
}

export function normalizeSourcePost(input) {
  const sourcePost = input?.sourcePost;
  if (!sourcePost || typeof sourcePost !== "object") {
    throw new BridgeProtocolError("缺少 sourcePost");
  }
  const text = String(sourcePost.text || "").trim();
  if (!text) throw new BridgeProtocolError("来源帖子正文为空");
  if (text.length > MAX_SOURCE_TEXT) throw new BridgeProtocolError("来源帖子正文过长", "PAYLOAD_TOO_LARGE", 413);
  return {
    id: String(sourcePost.id || ""),
    url: String(sourcePost.url || ""),
    text,
    authorName: String(sourcePost.authorName || ""),
    authorHandle: String(sourcePost.authorHandle || ""),
    contextScope: String(sourcePost.contextScope || "仅当前可见帖子")
  };
}

function normalizeOption(option, index, kind) {
  if (!option || typeof option !== "object") {
    throw new BridgeProtocolError(`${kind} 第 ${index + 1} 项格式错误`, "INVALID_MODEL_OUTPUT", 502);
  }
  const label = String(option.label || "").trim();
  const detail = String(option.detail || "").trim();
  if (!label || !detail) {
    throw new BridgeProtocolError(`${kind} 第 ${index + 1} 项缺少 label 或 detail`, "INVALID_MODEL_OUTPUT", 502);
  }
  return { id: String(option.id || `${kind}-${index + 1}`), label, detail };
}

export function validateComments(value) {
  const comments = Array.isArray(value) ? value : value?.comments;
  if (!Array.isArray(comments) || comments.length !== 3) {
    throw new BridgeProtocolError("模型必须返回 3 条评论", "INVALID_MODEL_OUTPUT", 502);
  }
  return comments.map((comment, index) => {
    const title = String(comment?.title || "").trim();
    const text = String(comment?.text || "").trim();
    if (!title || !text) {
      throw new BridgeProtocolError(`第 ${index + 1} 条评论缺少 title 或 text`, "INVALID_MODEL_OUTPUT", 502);
    }
    return { title, text };
  });
}

export function validateInspiration(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BridgeProtocolError("灵感结果必须是对象", "INVALID_MODEL_OUTPUT", 502);
  }
  if ("evidence" in value || "practices" in value || "angles" in value) {
    throw new BridgeProtocolError("灵感结果包含越界字段", "INVALID_MODEL_OUTPUT", 502);
  }
  const mechanisms = Array.isArray(value.mechanisms) ? value.mechanisms : [];
  const scriptIdeas = Array.isArray(value.scriptIdeas) ? value.scriptIdeas : [];
  if (mechanisms.length < 3 || mechanisms.length > 5 || scriptIdeas.length < 3 || scriptIdeas.length > 5) {
    throw new BridgeProtocolError("灵感结果必须包含 3–5 个机制和 3–5 个脚本 idea", "INVALID_MODEL_OUTPUT", 502);
  }
  return {
    sourceSummary: String(value.sourceSummary || "").trim(),
    mechanisms: mechanisms.map((option, index) => normalizeOption(option, index, "mechanism")),
    scriptIdeas: scriptIdeas.map((option, index) => normalizeOption(option, index, "script-idea"))
  };
}

export function parseModelJson(content) {
  const cleaned = String(content || "").trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new BridgeProtocolError("模型没有返回合法 JSON", "INVALID_MODEL_OUTPUT", 502);
  }
}
