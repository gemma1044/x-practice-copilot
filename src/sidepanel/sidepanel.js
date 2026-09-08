import { DemoMediaConnector, DemoTextConnector, DemoVisionConnector, LoopbackMediaConnector, LoopbackTextConnector, LoopbackVisionConnector } from "../core/connectors.js";
import { enforceEvidence } from "../core/evidence.js";
import { ChromeStoragePracticeRepository } from "../core/repositories.js";

const isDemo = new URLSearchParams(location.search).get("demo") === "1";
const textConnector = isDemo ? new DemoTextConnector() : new LoopbackTextConnector();
const mediaConnector = isDemo ? new DemoMediaConnector() : new LoopbackMediaConnector();
const visionConnector = isDemo ? new DemoVisionConnector() : new LoopbackVisionConnector();
const repository = new ChromeStoragePracticeRepository();
const state = {
  context: null,
  mode: "comment",
  scenes: [],
  contactSheets: [],
  referenceAssets: [],
  videoDurationSeconds: 0,
  commentsGeneratedFor: null,
  inspirationGeneratedFor: null,
  inspirationResult: null,
  currentInspiration: null,
  currentPractice: null
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => toast.classList.remove("show"), 2200);
}

function setMode(mode) {
  state.mode = mode;
  $$('[data-tab]').forEach((button) => button.classList.toggle("active", button.dataset.tab === mode));
  $$('[data-panel]').forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === mode));
}

function renderSource() {
  const context = state.context;
  $("#source-empty").hidden = Boolean(context);
  $("#source-content").hidden = !context;
  if (!context) return;
  $("#source-author").textContent = [context.authorName, context.authorHandle].filter(Boolean).join(" ") || "未知作者";
  $("#source-text").textContent = context.text || "未读取到正文；仅保留了来源链接。";
  $("#source-link").href = context.url;
  $("#source-scope").textContent = context.contextScope || "仅当前可见帖子";
  renderMedeoPrompt();
}

function renderDrafts(drafts) {
  const list = $("#draft-list");
  list.replaceChildren();
  drafts.forEach((draft) => {
    const safe = enforceEvidence(draft.text);
    const article = document.createElement("article");
    article.className = "draft";
    article.innerHTML = `<div class="draft-head"><span></span><span>${isDemo ? "DEMO AI" : "AI 草稿"}</span></div><textarea aria-label="${draft.title}草稿"></textarea><div class="draft-actions"><span class="evidence-badge">✓ 已过证据措辞检查</span><button class="text-button">复制草稿</button></div>`;
    article.querySelector(".draft-head span").textContent = draft.title;
    article.querySelector("textarea").value = safe.text;
    article.querySelector("button").addEventListener("click", () => copyText(article.querySelector("textarea").value, "草稿已复制，发布前请再次确认。"));
    list.append(article);
  });
}

async function runCommentGeneration() {
  const button = $("#generate-comments");
  const notice = $("#text-connector-notice");
  const status = $("#comment-ai-status");
  if (!state.context) return showToast("请先从一条 X 帖子打开侧栏。 ");
  button.disabled = true;
  button.textContent = "AI 正在生成…";
  notice.classList.remove("success");
  notice.textContent = isDemo ? "Demo AI 正在生成三个评论角度…" : "正在请求文字 AI…";
  try {
    const replyLanguage = $("#reply-language").value;
    const drafts = await textConnector.generateComments({ sourcePost: state.context, replyLanguage });
    renderDrafts(drafts);
    state.commentsGeneratedFor = `${state.context.id}:${replyLanguage}`;
    status.textContent = isDemo ? "DEMO AI 已生成" : "AI 已生成";
    status.className = "status local";
    notice.classList.add("success");
    notice.textContent = isDemo ? "固定的 Demo AI 模拟结果；不是一次真实模型调用。" : "AI 草稿已生成，请编辑后再复制。";
  } catch (error) {
    status.textContent = "AI 不可用";
    status.className = "status warning";
    notice.textContent = `${error.message}。${error.nextStep || ""}`;
  } finally {
    button.disabled = false;
    button.textContent = state.commentsGeneratedFor ? "重新用 AI 生成" : "用 AI 生成 3 个角度";
  }
}

function renderChoiceGroup(containerId, name, options, multiple = false) {
  const nodes = options.map((option, index) => {
    const label = document.createElement("label");
    label.className = "choice";
    const input = document.createElement("input");
    input.type = multiple ? "checkbox" : "radio";
    input.name = name;
    input.value = option.id || option;
    input.checked = index === 0 || multiple;
    input.dataset.label = option.label || option;
    input.setAttribute("aria-label", [option.label || option, option.detail].filter(Boolean).join("："));
    const content = document.createElement("span");
    content.textContent = option.label || option;
    if (option.detail) content.title = option.detail;
    label.append(input, content);
    return label;
  });
  $(`#${containerId}`).replaceChildren(...nodes);
}

async function runInspirationGeneration() {
  const button = $("#generate-inspiration");
  const status = $("#inspiration-ai-status");
  if (!state.context) return showToast("请先从一条 X 帖子打开侧栏。 ");
  button.disabled = true;
  button.textContent = "生成中…";
  status.textContent = "AI 生成中";
  try {
    const result = await textConnector.generateInspiration({ sourcePost: state.context });
    state.inspirationResult = result;
    renderChoiceGroup("mechanism-choices", "mechanism", result.mechanisms);
    renderChoiceGroup("script-idea-choices", "script-idea", result.scriptIdeas);
    $("#inspiration-quiz").hidden = false;
    state.inspirationGeneratedFor = state.context.id;
    status.textContent = isDemo ? "DEMO AI" : "AI 已生成";
    status.className = "status local";
  } catch (error) {
    status.textContent = "AI 不可用";
    status.className = "status warning";
    showToast(`${error.message}。${error.nextStep || ""}`);
  } finally {
    button.disabled = false;
    button.textContent = state.inspirationGeneratedFor === state.context?.id ? "换一组" : "AI 提炼";
  }
}

function selectedLabel(name) {
  return $(`input[name="${name}"]:checked`)?.dataset.label || "";
}

function renderPracticeWorkspace() {
  const inspiration = state.currentInspiration;
  $("#practice-workspace").hidden = !inspiration;
  if (!inspiration) return;
  const status = $("#practice-status");
  status.textContent = inspiration.status;
  status.className = `status ${inspiration.status === "有证据" ? "local" : "warning"}`;
  const list = $("#evidence-list");
  list.replaceChildren(...inspiration.evidence.map((evidence) => {
    const item = document.createElement("div");
    item.className = "evidence-item";
    item.textContent = `已确认 · ${evidence.summary || evidence.url}`;
    return item;
  }));
  $("#build-evidence-draft").disabled = inspiration.evidence.length === 0;
}

async function restorePracticeWorkspace() {
  const inspirations = await repository.listInspirations();
  state.currentInspiration = inspirations.find((item) => item.sourceUrl === state.context?.url) || null;
  state.currentPractice = null;
  if (state.currentInspiration) {
    const practices = await repository.listPractices(state.currentInspiration.id);
    state.currentPractice = practices[0] || null;
  }
  $("#practice-hypothesis").value = state.currentPractice?.hypothesis || "";
  $("#practice-steps").value = state.currentPractice?.steps || "";
  $("#practice-result").value = state.currentPractice?.result || "";
  $("#evidence-draft").value = "";
  renderPracticeWorkspace();
}

function renderMedeoPrompt() {
  const source = state.context?.url || "[来源帖子链接]";
  const timepoints = state.scenes.flatMap((scene) => scene.frameTimes).map((time) => `${time.toFixed(1)}s`).join("、") || "[待本机截帧]";
  $("#medeo-prompt").value = `请根据用户确认的代表帧复刻一条短视频。\n\n来源：${source}\n本机截帧时间点：${timepoints}\n\n【创意目标】\n[待视觉分析后填写：核心信息与观看动机]\n\n【画面与版式】\n[待填写：画幅、字体层级、字幕安全区、色彩与构图]\n\n【镜头顺序】\n[待填写：每张代表帧对应的画面、字幕、动效与素材]\n\n【成片要求】\n只依据确认帧描述可见画面；不推断音频；生成前由用户确认最终 prompt。`;
}

function renderContactSheets() {
  const selectedCount = state.contactSheets.filter((sheet) => sheet.selected).length;
  const frameCount = state.scenes.length * 3;
  $("#frame-summary").textContent = state.contactSheets.length
    ? `${state.scenes.length} 个场景 · ${frameCount} 帧 · ${state.contactSheets.length} 张九宫格`
    : "尚未生成九宫格";
  $("#analyze-video").disabled = selectedCount < 1;
  const items = state.contactSheets.map((sheet, index) => {
    const item = document.createElement("li");
    item.className = "file-item contact-sheet";
    const preview = document.createElement("img");
    preview.src = sheet.dataUrl;
    preview.alt = `第 ${index + 1} 张九宫格，包含场景 ${sheet.sceneIds.join("、")}`;
    const toggle = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = sheet.selected;
    input.setAttribute("aria-label", `选择第 ${index + 1} 张九宫格`);
    input.addEventListener("change", () => {
      sheet.selected = input.checked;
      renderContactSheets();
    });
    const name = document.createElement("span");
    name.textContent = `九宫格 ${index + 1} · ${sheet.frameCount} 帧`;
    toggle.append(input, name);
    item.append(preview, toggle);
    return item;
  });
  $("#frame-list").replaceChildren(...items);
}

async function refreshTextStatus() {
  if (isDemo) return;
  const statusNodes = [$("#comment-ai-status"), $("#inspiration-ai-status")];
  try {
    const status = await textConnector.getStatus();
    statusNodes.forEach((node) => {
      node.textContent = status.configured ? "AI 已连接" : "AI 待配置";
      node.className = `status ${status.configured ? "local" : "warning"}`;
    });
  } catch {
    statusNodes.forEach((node) => {
      node.textContent = "Bridge 未启动";
      node.className = "status warning";
    });
  }
}

async function refreshMediaStatus() {
  const node = $("#media-status");
  try {
    const status = await mediaConnector.getStatus();
    node.textContent = status.configured ? (isDemo ? "DEMO 本机工具" : "本机工具就绪") : "需安装 yt-dlp";
    node.className = `status ${status.configured ? "local" : "warning"}`;
  } catch {
    node.textContent = "Bridge 未启动";
    node.className = "status warning";
  }
}

async function copyText(value, successMessage) {
  await navigator.clipboard.writeText(value);
  showToast(successMessage);
}

async function loadContext() {
  const data = await chrome.storage.local.get(["xpc_current_context", "xpc_current_mode"]);
  const nextContext = data.xpc_current_context || null;
  if (state.context?.id && state.context.id !== nextContext?.id) {
    state.commentsGeneratedFor = null;
    state.inspirationGeneratedFor = null;
    state.inspirationResult = null;
    $("#draft-list").replaceChildren();
    $("#inspiration-quiz").hidden = true;
    $("#text-connector-notice").classList.remove("success");
    $("#text-connector-notice").textContent = "尚未调用 AI，不会用本地模板冒充模型结果。";
    state.referenceAssets = [];
    $("#replacement-brief").value = "";
    renderReferenceAssets();
  }
  state.context = nextContext;
  renderSource();
  await restorePracticeWorkspace();
  setMode(data.xpc_current_mode || "comment");
}

$$('[data-tab]').forEach((button) => button.addEventListener("click", () => setMode(button.dataset.tab)));
$("#generate-comments").addEventListener("click", runCommentGeneration);
$("#reply-language").addEventListener("change", () => {
  state.commentsGeneratedFor = null;
  $("#generate-comments").textContent = "用 AI 生成 3 个角度";
});
$("#generate-inspiration").addEventListener("click", runInspirationGeneration);

$("#save-inspiration").addEventListener("click", async () => {
  if (!state.context?.url) return showToast("请先从一条 X 帖子打开侧栏。 ");
  if (!state.inspirationResult) return showToast("请先让 AI 生成灵感选项。 ");
  const record = await repository.saveInspiration({
    sourceUrl: state.context.url,
    sourceText: state.context.text,
    mechanism: selectedLabel("mechanism"),
    scriptIdea: selectedLabel("script-idea"),
    additionalNote: $("#additional-note").value.trim(),
    status: "待验证"
  });
  state.currentInspiration = record;
  state.currentPractice = null;
  renderPracticeWorkspace();
  showToast(`灵感已保存 · ${record.status}`);
});

$("#save-practice").addEventListener("click", async () => {
  if (!state.currentInspiration) return showToast("请先保存灵感。 ");
  try {
    state.currentPractice = await repository.savePractice({
      id: state.currentPractice?.id,
      inspirationId: state.currentInspiration.id,
      hypothesis: $("#practice-hypothesis").value,
      steps: $("#practice-steps").value,
      result: $("#practice-result").value
    });
    state.currentInspiration.status = state.currentInspiration.evidence.length ? "有证据" : "实践中";
    renderPracticeWorkspace();
    showToast("实践记录已保存。 ");
  } catch (error) {
    showToast(error.message);
  }
});

$("#add-evidence").addEventListener("click", async () => {
  if (!state.currentInspiration) return showToast("请先保存灵感。 ");
  try {
    const saved = await repository.addEvidence(state.currentInspiration.id, {
      summary: $("#evidence-summary").value,
      url: $("#evidence-url").value,
      userConfirmed: $("#evidence-confirmed").checked
    });
    state.currentInspiration = saved.inspiration;
    $("#evidence-summary").value = "";
    $("#evidence-url").value = "";
    $("#evidence-confirmed").checked = false;
    renderPracticeWorkspace();
    showToast("证据已确认并关联。 ");
  } catch (error) {
    showToast(error.message);
  }
});

$("#build-evidence-draft").addEventListener("click", async () => {
  const result = $("#practice-result").value.trim();
  if (!result) return showToast("请先填写真实实践结果。 ");
  try {
    const evidenceIds = state.currentInspiration.evidence.map((evidence) => evidence.id);
    const draft = await repository.saveDraft({
      inspirationId: state.currentInspiration.id,
      text: `我完成了这次实践，记录结果：${result}`,
      evidenceIds
    });
    $("#evidence-draft").value = `${draft.text}\n\n证据映射：${draft.evidenceIds.join("、")}`;
    showToast("可追溯草稿已生成。 ");
  } catch (error) {
    showToast(error.message);
  }
});

$("#prepare-video").addEventListener("click", async () => {
  if (!state.context?.url) return showToast("请先从一条 X 帖子打开侧栏。 ");
  if (!state.context.media?.hasVideo) return showToast("当前帖子没有检测到可处理的视频。 ");
  const button = $("#prepare-video");
  button.disabled = true;
  button.textContent = "正在下载并截帧…";
  $("#media-notice").textContent = "正在本机串行处理；请勿连续触发。";
  try {
    const result = await mediaConnector.prepareVideo({ sourcePost: state.context });
    state.scenes = result.scenes;
    state.contactSheets = result.contactSheets.map((sheet) => ({ ...sheet, selected: true }));
    state.videoDurationSeconds = result.durationSeconds;
    renderContactSheets();
    renderMedeoPrompt();
    $("#media-status").textContent = isDemo ? "DEMO 已截帧" : "本机已截帧";
    $("#media-status").className = "status local";
    $("#media-notice").classList.add("success");
    $("#media-notice").textContent = `已识别 ${result.scenes.length} 个场景，每场景 3 帧，合成 ${result.contactSheets.length} 张九宫格。`;
  } catch (error) {
    $("#media-notice").classList.remove("success");
    $("#media-notice").textContent = `${error.message}。${error.nextStep || ""}`;
    showToast(error.code === "MEDIA_RATE_LIMITED" ? "X 已限流，请停止重试。" : "本机截帧未完成。 ");
  } finally {
    button.disabled = false;
    button.textContent = state.contactSheets.length ? "重新下载并截帧" : "下载并本地截帧";
  }
});

function renderReferenceAssets() {
  const items = state.referenceAssets.map((asset, index) => {
    const item = document.createElement("li");
    item.className = "file-item reference-asset";
    const preview = document.createElement("img");
    preview.src = asset.dataUrl;
    preview.alt = asset.name;
    const name = document.createElement("span");
    name.textContent = asset.name;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "text-button";
    remove.textContent = "移除";
    remove.addEventListener("click", () => {
      state.referenceAssets.splice(index, 1);
      renderReferenceAssets();
    });
    item.append(preview, name, remove);
    return item;
  });
  $("#reference-asset-list").replaceChildren(...items);
}

$("#reference-assets").addEventListener("change", async (event) => {
  const files = [...event.target.files].slice(0, 4);
  if ([...event.target.files].length > 4) showToast("最多使用前 4 张参考图。 ");
  const allowed = new Set(["image/png", "image/jpeg", "image/webp"]);
  const valid = files.filter((file) => allowed.has(file.type) && file.size <= 5 * 1024 * 1024);
  if (valid.length !== files.length) showToast("已忽略格式不支持或超过 5 MB 的图片。 ");
  try {
    state.referenceAssets = await Promise.all(valid.map((file) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => resolve({ name: file.name, dataUrl: reader.result }));
      reader.addEventListener("error", () => reject(reader.error));
      reader.readAsDataURL(file);
    })));
    renderReferenceAssets();
  } catch {
    showToast("参考图读取失败，请重新选择。 ");
  }
  event.target.value = "";
});

$("#analyze-video").addEventListener("click", async () => {
  const contactSheets = state.contactSheets.filter((sheet) => sheet.selected);
  if (!contactSheets.length) return showToast("请至少选择 1 张九宫格。 ");
  const button = $("#analyze-video");
  button.disabled = true;
  button.textContent = "Gemini 正在分析…";
  try {
    const result = await visionConnector.analyzeVideo({
      contactSheets,
      scenes: state.scenes,
      sourcePost: state.context,
      analysisPrompt: $("#analysis-prompt").value,
      replacementBrief: $("#replacement-brief").value,
      referenceImages: state.referenceAssets
    });
    $("#vision-notice").classList.add("success");
    $("#vision-notice").textContent = `Gemini 3.7 Flash：${result.summary}`;
    $("#medeo-prompt").value = result.medeoPrompt;
    showToast("视觉拆解与 Medeo prompt 已生成。 ");
  } catch (error) {
    $("#vision-notice").classList.remove("success");
    $("#vision-notice").textContent = `${error.message}。${error.nextStep || ""}`;
    showToast("视觉分析未完成，九宫格仍保留。 ");
  } finally {
    button.disabled = false;
    button.textContent = "用选中的九宫格分析";
  }
});

$("#copy-medeo").addEventListener("click", () => copyText($("#medeo-prompt").value, "Medeo prompt 框架已复制。"));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.xpc_current_context || changes.xpc_current_mode)) loadContext();
});

loadContext();
function refreshConnectorStatuses() {
  refreshTextStatus();
  refreshMediaStatus();
}

refreshConnectorStatuses();
window.addEventListener("focus", refreshConnectorStatuses);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshConnectorStatuses();
});
setInterval(() => {
  if (!document.hidden) refreshConnectorStatuses();
}, 5_000);
