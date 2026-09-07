import { DemoTextConnector, LoopbackTextConnector, UnconfiguredVisionConnector } from "../core/connectors.js";
import { enforceEvidence } from "../core/evidence.js";
import { ChromeStoragePracticeRepository } from "../core/repositories.js";

const isDemo = new URLSearchParams(location.search).get("demo") === "1";
const textConnector = isDemo ? new DemoTextConnector() : new LoopbackTextConnector();
const visionConnector = new UnconfiguredVisionConnector();
const repository = new ChromeStoragePracticeRepository();
const state = {
  context: null,
  mode: "comment",
  files: [],
  commentsGeneratedFor: null,
  inspirationGeneratedFor: null,
  inspirationResult: null,
  currentInspiration: null,
  currentPractice: null
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
let previewUrls = [];

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
    status.textContent = "AI 不可用";
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
  $("#medeo-prompt").value = `请根据用户按顺序提供的关键截图复刻一条短视频。\n\n来源：${source}\n素材：用户确认的关键截图\n\n【创意目标】\n[待视觉分析后填写：核心信息与观看动机]\n\n【画面与版式】\n[待填写：画幅、字体层级、字幕安全区、色彩与构图]\n\n【镜头顺序】\n[待填写：每张截图代表的画面、字幕、动效与素材]\n\n【成片要求】\n只依据截图描述可见画面；不推断音频或精确时间码；生成前由用户确认最终 prompt。`;
}

function renderFiles() {
  previewUrls.forEach((url) => URL.revokeObjectURL(url));
  previewUrls = [];
  $("#file-summary").textContent = state.files.length
    ? `已选择 ${state.files.length} 张截图${state.files.length < 3 || state.files.length > 8 ? "，请选择 3–8 张" : "，将按下列顺序分析"}`
    : "尚未选择截图";
  const items = state.files.map((file, index) => {
    const item = document.createElement("li");
    item.className = "file-item";
    const preview = document.createElement("img");
    const previewUrl = URL.createObjectURL(file);
    previewUrls.push(previewUrl);
    preview.src = previewUrl;
    preview.alt = `第 ${index + 1} 张：${file.name}`;
    preview.addEventListener("error", () => {
      item.classList.add("error");
      preview.alt = `无法读取：${file.name}`;
    });
    const name = document.createElement("span");
    name.textContent = `${index + 1}. ${file.name}`;
    const actions = document.createElement("div");
    actions.className = "file-actions";
    for (const [label, delta] of [["上移", -1], ["下移", 1]]) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = delta < 0 ? "↑" : "↓";
      button.setAttribute("aria-label", `${label} ${file.name}`);
      button.disabled = index + delta < 0 || index + delta >= state.files.length;
      button.addEventListener("click", () => {
        [state.files[index], state.files[index + delta]] = [state.files[index + delta], state.files[index]];
        renderFiles();
      });
      actions.append(button);
    }
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `移除 ${file.name}`);
    remove.addEventListener("click", () => {
      state.files.splice(index, 1);
      renderFiles();
    });
    actions.append(remove);
    item.append(preview, name, actions);
    return item;
  });
  $("#file-list").replaceChildren(...items);
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

async function copyText(value, successMessage) {
  await navigator.clipboard.writeText(value);
  showToast(successMessage);
}

async function loadContext() {
  const data = await chrome.storage.local.get(["xpc_current_context", "xpc_current_mode"]);
  state.context = data.xpc_current_context || null;
  renderSource();
  await restorePracticeWorkspace();
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

$("#video-file").addEventListener("change", (event) => {
  state.files = [...event.target.files];
  renderFiles();
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
refreshTextStatus();
