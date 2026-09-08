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
  actionGuards: new Map(),
  videoTaskMode: "replicate",
  videoResults: { replicate: null, adapt: null },
  videoTakeawayTexts: { replicate: "", adapt: "" },
  videoOutputDirty: { replicate: false, adapt: false },
  videoDurationSeconds: 0,
  commentsGeneratedFor: null,
  inspirationGeneratedFor: null,
  inspirationResult: null,
  currentInspiration: null,
  currentPractice: null
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const ACTION_COOLDOWN_MS = 3_000;

function actionFingerprint(value) {
  const textValue = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < textValue.length; index += 1) {
    hash ^= textValue.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function beginAction(action, input) {
  const signature = actionFingerprint(input);
  const previous = state.actionGuards.get(action);
  if (previous?.running || (previous?.signature === signature && Date.now() - previous.completedAt < ACTION_COOLDOWN_MS)) {
    showToast(previous.running ? "相同操作正在处理中。" : "相同操作刚刚已完成，请稍后再试。 ");
    return null;
  }
  const token = { action, signature };
  state.actionGuards.set(action, { signature, running: true, completedAt: 0 });
  return token;
}

function finishAction(token, successful) {
  if (!token) return;
  const current = state.actionGuards.get(token.action);
  if (current?.signature !== token.signature) return;
  if (!successful) {
    state.actionGuards.delete(token.action);
    return;
  }
  state.actionGuards.set(token.action, { signature: token.signature, running: false, completedAt: Date.now() });
}

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
  const replyLanguage = $("#reply-language").value;
  const action = beginAction("comments", { sourceId: state.context.id, replyLanguage });
  if (!action) return;
  let successful = false;
  button.disabled = true;
  button.textContent = "AI 正在生成…";
  notice.classList.remove("success");
  notice.textContent = isDemo ? "Demo AI 正在生成三个评论角度…" : "正在请求文字 AI…";
  try {
    const drafts = await textConnector.generateComments({ sourcePost: state.context, replyLanguage });
    renderDrafts(drafts);
    state.commentsGeneratedFor = `${state.context.id}:${replyLanguage}`;
    status.textContent = isDemo ? "DEMO AI 已生成" : "AI 已生成";
    status.className = "status local";
    notice.classList.add("success");
    notice.textContent = isDemo ? "固定的 Demo AI 模拟结果；不是一次真实模型调用。" : "AI 草稿已生成，请编辑后再复制。";
    successful = true;
  } catch (error) {
    status.textContent = "AI 不可用";
    status.className = "status warning";
    notice.textContent = `${error.message}。${error.nextStep || ""}`;
  } finally {
    finishAction(action, successful);
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
  const action = beginAction("inspiration", { sourceId: state.context.id });
  if (!action) return;
  let successful = false;
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
    successful = true;
  } catch (error) {
    status.textContent = "AI 不可用";
    status.className = "status warning";
    showToast(`${error.message}。${error.nextStep || ""}`);
  } finally {
    finishAction(action, successful);
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

function renderContactSheets() {
  const selectedCount = state.contactSheets.filter((sheet) => sheet.selected).length;
  const frameCount = state.scenes.length * 3;
  $("#frame-summary").textContent = state.contactSheets.length
    ? `${state.scenes.length} 个场景 · ${frameCount} 帧 · ${state.contactSheets.length} 张九宫格`
    : "尚未生成九宫格";
  updateVideoTaskUI();
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
      markVideoOutputDirty("both");
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

function formatTime(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function modelAwarePrompt(result) {
  const claimedModel = result.sourceAnalysis?.claimedModel || "未识别";
  return `原贴声明使用的模型：${claimedModel}。\n${result.medeoPrompt}`.trim();
}

function buildVideoTakeawayText(result, taskMode) {
  const source = result.sourceAnalysis;
  const adaptationBrief = $("#adaptation-brief").value.trim();
  const clipText = result.clips.map((clip) => [
    `[${formatTime(clip.startSeconds)}–${formatTime(clip.endSeconds)}] ${clip.narrativeRole}`,
    `画面：${clip.whatHappens}`,
    clip.visibleText ? `字幕：${clip.visibleText}` : "",
    clip.visibleChange ? `变化：${clip.visibleChange}` : "",
    clip.visualStyle ? `风格：${clip.visualStyle}` : "",
    clip.transition ? `转场：${clip.transition}` : ""
  ].filter(Boolean).join("\n")).join("\n\n");
  return [
    "【来源分析】",
    `来源：${state.context?.url || "未记录"}`,
    `摘要：${source.postSummary || result.summary}`,
    `模型：${source.claimedModel}（置信度：${source.confidence}）`,
    `依据：${source.modelEvidence}`,
    "",
    "【时间轴分镜】",
    clipText,
    "",
    taskMode === "adapt" ? "【改编要求】" : "",
    taskMode === "adapt" ? adaptationBrief : "",
    "",
    "【生成 Prompt】",
    modelAwarePrompt(result)
  ].filter((line, index, lines) => line !== "" || lines[index - 1] !== "").join("\n").trim();
}

function updateAnalyzeButtonLabel() {
  const button = $("#analyze-video");
  if (button.getAttribute("aria-busy") === "true") return;
  const mode = state.videoTaskMode;
  const noun = mode === "adapt" ? "我的视频 Prompt" : "复刻 Prompt";
  button.textContent = state.videoOutputDirty[mode] ? `更新${noun}` : state.videoResults[mode] ? `重新生成${noun}` : `生成${noun}`;
}

function markVideoOutputDirty(scope = state.videoTaskMode) {
  const modes = scope === "both" ? ["replicate", "adapt"] : [scope];
  modes.forEach((mode) => {
    if (state.videoResults[mode]) state.videoOutputDirty[mode] = true;
  });
  updateVideoTaskUI();
}

function renderVideoTakeaway(result, taskMode = state.videoTaskMode, persist = true) {
  const shell = $("#video-takeaway");
  if (!result) {
    shell.hidden = true;
    return;
  }
  const source = result.sourceAnalysis;
  const isAdapt = taskMode === "adapt";
  $("#takeaway-title").textContent = isAdapt ? "我的视频 Prompt" : "复刻 Prompt";
  $("#copy-takeaway").textContent = isAdapt ? "复制我的视频 Prompt" : "复制复刻 Prompt";
  $("#takeaway-model").textContent = `模型 · ${source.claimedModel} · ${source.confidence}`;
  $("#takeaway-model").title = source.modelEvidence;
  $("#source-analysis-summary").textContent = source.postSummary || result.summary;
  const items = result.clips.map((clip) => {
    const item = document.createElement("li");
    const time = document.createElement("time");
    time.textContent = `${formatTime(clip.startSeconds)}–${formatTime(clip.endSeconds)}`;
    const content = document.createElement("div");
    const title = document.createElement("b");
    title.textContent = clip.whatHappens;
    const meta = document.createElement("span");
    meta.textContent = [clip.narrativeRole, clip.visibleText ? `字幕：${clip.visibleText}` : ""].filter(Boolean).join(" · ");
    content.append(title, meta);
    item.append(time, content);
    return item;
  });
  $("#clip-annotations").replaceChildren(...items);
  $("#takeaway-prompt").textContent = modelAwarePrompt(result);
  if (persist) {
    state.videoResults[taskMode] = result;
    state.videoTakeawayTexts[taskMode] = buildVideoTakeawayText(result, taskMode);
    state.videoOutputDirty[taskMode] = false;
  }
  shell.hidden = false;
  updateAnalyzeButtonLabel();
}

function updateVideoTaskUI() {
  const mode = state.videoTaskMode;
  $$('[data-video-task]').forEach((button) => {
    const active = button.dataset.videoTask === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  $$('[data-video-task-panel]').forEach((panel) => panel.classList.toggle("active", panel.dataset.videoTaskPanel === mode));
  const hasSheets = state.contactSheets.some((sheet) => sheet.selected);
  const hasBrief = $("#adaptation-brief").value.trim().length > 0;
  $("#analyze-video").disabled = !hasSheets || (mode === "adapt" && !hasBrief);
  updateAnalyzeButtonLabel();
  renderVideoTakeaway(state.videoResults[mode], mode, false);
}

function setVideoTaskMode(mode) {
  state.videoTaskMode = mode;
  updateVideoTaskUI();
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
    $("#adaptation-brief").value = "";
    state.videoTaskMode = "replicate";
    state.videoResults = { replicate: null, adapt: null };
    state.videoTakeawayTexts = { replicate: "", adapt: "" };
    state.videoOutputDirty = { replicate: false, adapt: false };
    $("#video-takeaway").hidden = true;
    updateVideoTaskUI();
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
  const action = beginAction("prepare-video", { sourceUrl: state.context.url });
  if (!action) return;
  let successful = false;
  const button = $("#prepare-video");
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.textContent = "正在下载并截帧…";
  $("#media-notice").hidden = false;
  $("#media-notice").textContent = "正在本机串行处理；请勿连续触发。";
  try {
    const result = await mediaConnector.prepareVideo({ sourcePost: state.context });
    state.scenes = result.scenes;
    state.contactSheets = result.contactSheets.map((sheet) => ({ ...sheet, selected: true }));
    state.videoDurationSeconds = result.durationSeconds;
    markVideoOutputDirty("both");
    renderContactSheets();
    $("#media-status").textContent = isDemo ? "DEMO 已截帧" : "本机已截帧";
    $("#media-status").className = "status local";
    $("#media-notice").hidden = true;
    successful = true;
  } catch (error) {
    $("#media-notice").classList.remove("success");
    $("#media-notice").hidden = false;
    $("#media-notice").textContent = `${error.message}。${error.nextStep || ""}`;
    showToast(error.code === "MEDIA_RATE_LIMITED" ? "X 已限流，请停止重试。" : "本机截帧未完成。 ");
  } finally {
    finishAction(action, successful);
    button.removeAttribute("aria-busy");
    button.disabled = false;
    button.textContent = state.contactSheets.length ? "重新下载并截帧" : "下载并本地截帧";
  }
});

$("#analyze-video").addEventListener("click", async () => {
  const contactSheets = state.contactSheets.filter((sheet) => sheet.selected);
  if (!contactSheets.length) return showToast("请至少选择 1 张九宫格。 ");
  const taskMode = state.videoTaskMode;
  const adaptationBrief = $("#adaptation-brief").value.trim();
  if (taskMode === "adapt" && !adaptationBrief) return showToast("请先写下你想改编成什么视频。 ");
  const analysisInput = {
    taskMode,
    sheetIds: contactSheets.map((sheet) => sheet.id),
    analysisPrompt: $("#analysis-prompt").value,
    replacementBrief: taskMode === "adapt" ? adaptationBrief : ""
  };
  const action = beginAction(`analyze-video-${taskMode}`, analysisInput);
  if (!action) return;
  let successful = false;
  const button = $("#analyze-video");
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.textContent = taskMode === "adapt" ? "正在生成我的视频 Prompt…" : "正在生成复刻 Prompt…";
  $("#vision-notice").hidden = true;
  try {
    const result = await visionConnector.analyzeVideo({
      contactSheets,
      scenes: state.scenes,
      sourcePost: state.context,
      taskMode,
      analysisPrompt: $("#analysis-prompt").value,
      replacementBrief: taskMode === "adapt" ? adaptationBrief : "",
      referenceImages: []
    });
    renderVideoTakeaway(result, taskMode);
    showToast(taskMode === "adapt" ? "我的视频 Prompt 已生成。 " : "复刻 Prompt 已生成。 ");
    successful = true;
  } catch (error) {
    $("#vision-notice").classList.remove("success");
    $("#vision-notice").hidden = false;
    $("#vision-notice").textContent = `${error.message}。${error.nextStep || ""}`;
    showToast("视觉分析未完成，九宫格仍保留。 ");
  } finally {
    finishAction(action, successful);
    button.removeAttribute("aria-busy");
    button.disabled = false;
    updateAnalyzeButtonLabel();
  }
});

$$('[data-video-task]').forEach((button) => button.addEventListener("click", () => setVideoTaskMode(button.dataset.videoTask)));
$("#adaptation-brief").addEventListener("input", () => markVideoOutputDirty("adapt"));
$("#analysis-prompt").addEventListener("input", () => markVideoOutputDirty("both"));
$("#copy-takeaway").addEventListener("click", () => {
  const mode = state.videoTaskMode;
  copyText(state.videoTakeawayTexts[mode], mode === "adapt" ? "我的视频 Prompt 已复制。" : "复刻 Prompt 已复制。");
});

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
