import { PracticeRepository } from "./contracts.js";
import { auditDraft } from "./evidence.js";

const STATE_KEY = "xpc_practice_state";
const LEGACY_INSPIRATIONS_KEY = "xpc_inspirations";
const STATE_VERSION = 2;

function emptyState(seed = []) {
  return { version: STATE_VERSION, inspirations: [...seed], practices: [], drafts: [], outbox: [] };
}

export class MemoryPracticeRepository extends PracticeRepository {
  constructor(seed = []) {
    super();
    this.state = emptyState(seed);
  }

  async saveInspiration(record) { return saveInspirationInState(this.state, record); }
  async listInspirations() { return [...this.state.inspirations]; }
  async savePractice(record) { return savePracticeInState(this.state, record); }
  async listPractices(inspirationId) { return this.state.practices.filter((item) => item.inspirationId === inspirationId); }
  async addEvidence(inspirationId, evidence) { return addEvidenceToState(this.state, inspirationId, evidence); }
  async saveDraft(record) { return saveDraftInState(this.state, record); }
  async listPendingSync() { return [...this.state.outbox]; }
  async markSyncAttempt(operationId, result) { return markSyncAttemptInState(this.state, operationId, result); }
}

export class ChromeStoragePracticeRepository extends PracticeRepository {
  constructor(storageArea = globalThis.chrome?.storage?.local, { queueRemoteWrites = false } = {}) {
    super();
    this.storageArea = storageArea;
    this.queueRemoteWrites = queueRemoteWrites;
  }

  async saveInspiration(record) {
    const state = await this.#readState();
    const saved = saveInspirationInState(state, record);
    if (this.queueRemoteWrites) enqueueSync(state, "inspiration", saved);
    await this.#writeState(state);
    return saved;
  }

  async listInspirations() { return [...(await this.#readState()).inspirations]; }

  async savePractice(record) {
    const state = await this.#readState();
    const saved = savePracticeInState(state, record);
    if (this.queueRemoteWrites) enqueueSync(state, "practice", saved);
    await this.#writeState(state);
    return saved;
  }

  async listPractices(inspirationId) {
    return (await this.#readState()).practices.filter((item) => item.inspirationId === inspirationId);
  }

  async addEvidence(inspirationId, evidence) {
    const state = await this.#readState();
    const saved = addEvidenceToState(state, inspirationId, evidence);
    if (this.queueRemoteWrites) enqueueSync(state, "inspiration", saved.inspiration);
    await this.#writeState(state);
    return saved;
  }

  async saveDraft(record) {
    const state = await this.#readState();
    const saved = saveDraftInState(state, record);
    if (this.queueRemoteWrites) enqueueSync(state, "draft", saved);
    await this.#writeState(state);
    return saved;
  }

  async listPendingSync() {
    return [...(await this.#readState()).outbox];
  }

  async markSyncAttempt(operationId, result) {
    const state = await this.#readState();
    const operation = markSyncAttemptInState(state, operationId, result);
    await this.#writeState(state);
    return operation;
  }

  async #readState() {
    if (!this.storageArea) return emptyState();
    const data = await this.storageArea.get([STATE_KEY, LEGACY_INSPIRATIONS_KEY]);
    const current = data[STATE_KEY];
    if (current?.version === 1 || current?.version === STATE_VERSION) {
      return {
        version: STATE_VERSION,
        inspirations: Array.isArray(current.inspirations) ? current.inspirations : [],
        practices: Array.isArray(current.practices) ? current.practices : [],
        drafts: Array.isArray(current.drafts) ? current.drafts : [],
        outbox: Array.isArray(current.outbox) ? current.outbox : []
      };
    }
    return emptyState(Array.isArray(data[LEGACY_INSPIRATIONS_KEY]) ? data[LEGACY_INSPIRATIONS_KEY] : []);
  }

  async #writeState(state) {
    if (!this.storageArea) throw new Error("Chrome 本地存储不可用");
    await this.storageArea.set({ [STATE_KEY]: state });
    if (typeof this.storageArea.remove === "function") await this.storageArea.remove(LEGACY_INSPIRATIONS_KEY);
  }
}

export class UnconfiguredPersonalFeishuRepository extends PracticeRepository {
  async saveInspiration() { throw new Error("个人飞书连接尚未确认，已拒绝远程写入"); }
  async listInspirations() { throw new Error("个人飞书连接尚未确认，无法回读远程数据"); }
}

function saveInspirationInState(state, record) {
  const sourceUrl = String(record.sourceUrl || "");
  const index = state.inspirations.findIndex((item) => item.sourceUrl === sourceUrl);
  const existing = index >= 0 ? state.inspirations[index] : null;
  const next = normalizeInspiration({ ...existing, ...record }, existing);
  if (index >= 0) state.inspirations[index] = next;
  else state.inspirations.unshift(next);
  return next;
}

function savePracticeInState(state, record) {
  const inspiration = state.inspirations.find((item) => item.id === record.inspirationId);
  if (!inspiration) throw new Error("关联灵感不存在");
  const index = state.practices.findIndex((item) => item.id === record.id);
  const existing = index >= 0 ? state.practices[index] : null;
  const now = new Date().toISOString();
  const next = {
    id: record.id || makeId("practice"),
    inspirationId: record.inspirationId,
    hypothesis: String(record.hypothesis || "").trim(),
    steps: String(record.steps || "").trim(),
    result: String(record.result || "").trim(),
    status: "实践中",
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };
  if (!next.hypothesis && !next.steps) throw new Error("请填写实践假设或步骤");
  if (index >= 0) state.practices[index] = next;
  else state.practices.unshift(next);
  if (!inspiration.evidence.length) inspiration.status = "实践中";
  inspiration.updatedAt = now;
  return next;
}

function addEvidenceToState(state, inspirationId, evidence) {
  const inspiration = state.inspirations.find((item) => item.id === inspirationId);
  if (!inspiration) throw new Error("关联灵感不存在");
  if (evidence?.userConfirmed !== true) throw new Error("证据必须由用户明确确认");
  const summary = String(evidence.summary || "").trim();
  const url = String(evidence.url || "").trim();
  if (!summary && !url) throw new Error("证据说明和链接至少填写一项");
  const next = {
    id: evidence.id || makeId("evidence"),
    kind: String(evidence.kind || "记录"),
    summary,
    url,
    userConfirmed: true,
    createdAt: evidence.createdAt || new Date().toISOString()
  };
  inspiration.evidence = [...inspiration.evidence.filter((item) => item.id !== next.id), next];
  inspiration.status = "有证据";
  inspiration.updatedAt = new Date().toISOString();
  return { inspiration, evidence: next };
}

function saveDraftInState(state, record) {
  const inspiration = state.inspirations.find((item) => item.id === record.inspirationId);
  if (!inspiration) throw new Error("关联灵感不存在");
  const evidenceIds = Array.isArray(record.evidenceIds) ? record.evidenceIds.filter(Boolean) : [];
  const confirmedIds = new Set(inspiration.evidence.filter((item) => item.userConfirmed).map((item) => item.id));
  if (evidenceIds.some((id) => !confirmedIds.has(id))) throw new Error("草稿引用了未确认或不存在的证据");
  const text = String(record.text || "").trim();
  const audit = auditDraft(text, evidenceIds);
  if (!text || !audit.allowed) throw new Error("草稿包含没有证据支持的事实主张");
  const next = {
    id: record.id || makeId("draft"),
    inspirationId: record.inspirationId,
    text,
    evidenceIds,
    claims: audit.claims,
    createdAt: record.createdAt || new Date().toISOString()
  };
  state.drafts.unshift(next);
  return next;
}

function enqueueSync(state, entityType, payload) {
  const existing = state.outbox.find((item) => item.entityType === entityType && item.entityId === payload.id);
  if (existing) {
    existing.payload = payload;
    existing.updatedAt = new Date().toISOString();
    return existing;
  }
  const operation = {
    id: makeId("sync"),
    operation: "upsert",
    entityType,
    entityId: payload.id,
    payload,
    attempts: 0,
    lastError: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  state.outbox.push(operation);
  return operation;
}

function markSyncAttemptInState(state, operationId, result) {
  const index = state.outbox.findIndex((item) => item.id === operationId);
  if (index < 0) throw new Error("同步任务不存在");
  const operation = state.outbox[index];
  if (result?.ok === true) {
    state.outbox.splice(index, 1);
    return { ...operation, completed: true };
  }
  operation.attempts += 1;
  operation.lastError = String(result?.error || "同步失败");
  operation.updatedAt = new Date().toISOString();
  return operation;
}

function normalizeInspiration(record, existing) {
  const now = new Date().toISOString();
  const confirmedEvidence = Array.isArray(record.evidence)
    ? record.evidence.filter((item) => item?.userConfirmed === true)
    : [];
  const allowedWithoutEvidence = new Set(["已收集", "待验证", "实践中"]);
  return {
    id: existing?.id || record.id || makeId("inspiration"),
    sourceUrl: String(record.sourceUrl || ""),
    sourceText: String(record.sourceText || ""),
    mechanism: String(record.mechanism || ""),
    angle: String(record.angle || ""),
    scriptIdea: String(record.scriptIdea || ""),
    practice: String(record.practice || ""),
    evidencePlan: Array.isArray(record.evidencePlan) ? record.evidencePlan : [],
    additionalNote: String(record.additionalNote || ""),
    evidence: confirmedEvidence,
    status: confirmedEvidence.length
      ? "有证据"
      : allowedWithoutEvidence.has(record.status) ? record.status : "待验证",
    createdAt: existing?.createdAt || record.createdAt || now,
    updatedAt: now,
    sync: "local-only"
  };
}

function makeId(prefix) {
  return globalThis.crypto?.randomUUID?.() || `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
