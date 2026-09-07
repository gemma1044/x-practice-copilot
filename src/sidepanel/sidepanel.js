import { DemoTextConnector, UnconfiguredTextConnector, UnconfiguredVisionConnector } from "../core/connectors.js";
import { enforceEvidence } from "../core/evidence.js";
import { ChromeStoragePracticeRepository } from "../core/repositories.js";

const isDemo = new URLSearchParams(location.search).get("demo") === "1";
const textConnector = isDemo ? new DemoTextConnector() : new UnconfiguredTextConnector();
const visionConnector = new UnconfiguredVisionConnector();
const repository = new ChromeStoragePracticeRepository();
const state = { context: null, mode: "comment", files: [], commentsGeneratedFor: null, inspirationGeneratedFor: null, inspirationResult: null };

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
  if (!state.context) return;
  if (mode === "comment" && state.commentsGeneratedFor !== state.context.id) runCommentGeneration();
  if (mode === "inspiration" && state.inspirationGeneratedFor !== state.context.id) runInspirationGeneration();
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
    const drafts = await textConnector.generateComments({ sourcePost: state.context });
    renderDrafts(drafts);
    state.commentsGeneratedFor = state.context.id;
    status.textContent = isDemo ? "DEMO AI 已生成" : "AI 已生成";
    status.className = "status local";
    notice.classList.add("success");
    notice.textContent = isDemo ? "固定的 Demo AI 模拟结果；不是一次真实模型调用。" : "AI 草稿已生成，请编辑后再复制。";
  } catch (error) {
    status.textContent = "AI 未配置";
    status.className = "status warning";
    notice.textContent = `${error.message}。${error.nextStep || ""}`;
  } finally {
    button.disabled = false;
    button.textContent = state.commentsGeneratedFor === state.context?.id ? "重新用 AI 生成" : "用 AI 生成 3 个角度";
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
    status.textContent = "AI 未配置";
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

function renderMedeoPrompt() {
  const source = state.context?.url || "[来源帖子链接]";
  $("#medeo-prompt").value = `请根据用户按顺序提供的关键截图复刻一条短视频。\n\n来源：${source}\n素材：用户确认的关键截图\n\n【创意目标】\n[待视觉分析后填写：核心信息与观看动机]\n\n【画面与版式】\n[待填写：画幅、字体层级、字幕安全区、色彩与构图]\n\n【镜头顺序】\n[待填写：每张截图代表的画面、字幕、动效与素材]\n\n【成片要求】\n只依据截图描述可见画面；不推断音频或精确时间码；生成前由用户确认最终 prompt。`;
}

async function copyText(value, successMessage) {
  await navigator.clipboard.writeText(value);
  showToast(successMessage);
}

async function loadContext() {
  const data = await chrome.storage.local.get(["xpc_current_context", "xpc_current_mode"]);
  state.context = data.xpc_current_context || null;
  renderSource();
  setMode(data.xpc_current_mode || "comment");
}

$$('[data-tab]').forEach((button) => button.addEventListener("click", () => setMode(button.dataset.tab)));
$("#generate-comments").addEventListener("click", runCommentGeneration);
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
    evidence: [],
    status: "待验证"
  });
  showToast(`灵感已保存 · ${record.status}`);
});

$("#video-file").addEventListener("change", (event) => {
  state.files = [...event.target.files];
  $("#file-summary").textContent = state.files.length
    ? `已选择 ${state.files.length} 张截图${state.files.length < 3 || state.files.length > 8 ? "，请选择 3–8 张" : ""}`
    : "尚未选择截图";
});

$("#analyze-video").addEventListener("click", async () => {
  if (!state.files.length) return showToast("请先选择关键截图。 ");
  if (state.files.length < 3 || state.files.length > 8) return showToast("请选择 3–8 张关键截图。 ");
  try {
    await visionConnector.analyzeVideo({ files: state.files, sourcePost: state.context });
  } catch (error) {
    $("#vision-notice").textContent = `${error.message}。${error.nextStep || ""}`;
    showToast("未上传文件：视觉连接器尚未配置。 ");
  }
});

$("#copy-medeo").addEventListener("click", () => copyText($("#medeo-prompt").value, "Medeo prompt 框架已复制。"));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.xpc_current_context || changes.xpc_current_mode)) loadContext();
});

loadContext();
