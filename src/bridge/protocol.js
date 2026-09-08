const MAX_SOURCE_TEXT = 12_000;
const REPLY_LANGUAGES = new Set(["zh-CN", "en", "ja", "ko", "es", "same-as-source"]);
const DEFAULT_VISION_ANALYSIS_PROMPT = "结合原帖正文分析内容和明确提到的生成模型；按每个 clip 输出内容、叙事作用、可见字幕、主体变化、画面风格和转场，并生成可直接交给 AI Video 模型的中文 Prompt；有替换要求时用用户内容替换原元素。";

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

export function normalizeReplyLanguage(value) {
  const language = String(value || "zh-CN");
  if (!REPLY_LANGUAGES.has(language)) {
    throw new BridgeProtocolError("不支持的回复语种", "UNSUPPORTED_REPLY_LANGUAGE");
  }
  return language;
}

export function normalizeVideoRequest(input) {
  const rawUrl = String(input?.sourcePost?.url || "").trim();
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BridgeProtocolError("来源帖子链接无效");
  }
  if (!new Set(["x.com", "www.x.com", "twitter.com", "www.twitter.com"]).has(url.hostname)) {
    throw new BridgeProtocolError("只支持 X / Twitter 帖子链接", "UNSUPPORTED_SOURCE");
  }
  if (!/^\/(?:[^/]+|i\/web)\/status\/\d+(?:\/|$)/u.test(url.pathname)) {
    throw new BridgeProtocolError("链接不是可识别的 X 帖子", "UNSUPPORTED_SOURCE");
  }
  url.search = "";
  url.hash = "";
  return { sourceUrl: url.toString() };
}

export function normalizeVisionRequest(input) {
  const sourcePost = normalizeSourcePost(input);
  const scenes = Array.isArray(input?.scenes) ? input.scenes : [];
  const contactSheets = Array.isArray(input?.contactSheets) ? input.contactSheets : [];
  const analysisPrompt = String(input?.analysisPrompt || DEFAULT_VISION_ANALYSIS_PROMPT).trim();
  const taskMode = input?.taskMode === "adapt" ? "adapt" : "replicate";
  const replacementBrief = String(input?.replacementBrief || "").trim();
  const referenceImages = Array.isArray(input?.referenceImages) ? input.referenceImages : [];
  if (!analysisPrompt || analysisPrompt.length > 6000) throw new BridgeProtocolError("分析 Prompt 为空或过长", "INVALID_VISION_INPUT");
  if (replacementBrief.length > 3000) throw new BridgeProtocolError("替换说明过长", "INVALID_VISION_INPUT");
  if (taskMode === "adapt" && !replacementBrief) throw new BridgeProtocolError("改编内容不能为空", "INVALID_VISION_INPUT");
  if (referenceImages.length > 4) throw new BridgeProtocolError("参考图最多 4 张", "INVALID_VISION_INPUT");
  if (!contactSheets.length || contactSheets.length > 5) {
    throw new BridgeProtocolError("视觉分析需要 1–5 张九宫格", "INVALID_VISION_INPUT");
  }
  const normalizedSheets = contactSheets.map((sheet, index) => {
    const dataUrl = String(sheet?.dataUrl || "");
    if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/u.test(dataUrl)) {
      throw new BridgeProtocolError(`第 ${index + 1} 张九宫格格式错误`, "INVALID_VISION_INPUT");
    }
    return {
      id: String(sheet.id || `sheet-${index + 1}`),
      sceneIds: Array.isArray(sheet.sceneIds) ? sheet.sceneIds.map(String) : [],
      frameCount: Number(sheet.frameCount || 0),
      dataUrl
    };
  });
  const selectedSceneIds = new Set(normalizedSheets.flatMap((sheet) => sheet.sceneIds));
  const normalizedScenes = scenes.slice(0, 15).map((scene, index) => ({
    id: String(scene?.id || `scene-${index + 1}`),
    index: Number(scene?.index || index + 1),
    startSeconds: Number(scene?.startSeconds || 0),
    endSeconds: Number(scene?.endSeconds || 0),
    frameTimes: Array.isArray(scene?.frameTimes) ? scene.frameTimes.slice(0, 3).map(Number) : []
  })).filter((scene) => selectedSceneIds.has(scene.id));
  if (!normalizedScenes.length) throw new BridgeProtocolError("九宫格没有对应的 clip 时间信息", "INVALID_VISION_INPUT");
  return {
    sourcePost,
    taskMode,
    analysisPrompt,
    replacementBrief,
    referenceImages: referenceImages.map((image, index) => {
      const dataUrl = String(image?.dataUrl || "");
      if (!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/u.test(dataUrl) || dataUrl.length > 7_000_000) {
        throw new BridgeProtocolError(`第 ${index + 1} 张参考图格式错误或过大`, "INVALID_VISION_INPUT");
      }
      return { name: String(image?.name || `参考图 ${index + 1}`), dataUrl };
    }),
    scenes: normalizedScenes,
    contactSheets: normalizedSheets
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

export function validateVisionAnalysis(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BridgeProtocolError("视觉模型结果必须是对象", "INVALID_MODEL_OUTPUT", 502);
  }
  const summary = String(value.summary || "").trim();
  const medeoPrompt = String(value.medeoPrompt || "").trim();
  const sourceAnalysis = value.sourceAnalysis;
  if (!summary || !medeoPrompt || !sourceAnalysis) {
    throw new BridgeProtocolError("视觉模型结果缺少来源分析或最终 Prompt", "INVALID_MODEL_OUTPUT", 502);
  }
  const claimedModel = String(sourceAnalysis.claimedModel || "未识别").trim() || "未识别";
  return {
    summary,
    sourceAnalysis: {
      postSummary: String(sourceAnalysis.postSummary || "").trim(),
      claimedModel,
      modelEvidence: String(sourceAnalysis.modelEvidence || "未发现明确模型信息").trim(),
      confidence: new Set(["高", "中", "低"]).has(sourceAnalysis.confidence) ? sourceAnalysis.confidence : "低"
    },
    medeoPrompt: `原贴模型：${claimedModel}\n${medeoPrompt}`
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
