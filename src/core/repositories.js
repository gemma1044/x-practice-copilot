import { PracticeRepository } from "./contracts.js";

const STORAGE_KEY = "xpc_inspirations";

export class MemoryPracticeRepository extends PracticeRepository {
  constructor(seed = []) {
    super();
    this.records = [...seed];
  }

  async saveInspiration(record) {
    const next = normalizeRecord(record);
    const index = this.records.findIndex((item) => item.sourceUrl === next.sourceUrl);
    if (index >= 0) this.records[index] = next;
    else this.records.unshift(next);
    return next;
  }

  async listInspirations() {
    return [...this.records];
  }
}

export class ChromeStoragePracticeRepository extends PracticeRepository {
  constructor(storageArea = globalThis.chrome?.storage?.local) {
    super();
    this.storageArea = storageArea;
  }

  async saveInspiration(record) {
    if (!this.storageArea) throw new Error("Chrome 本地存储不可用");
    const next = normalizeRecord(record);
    const current = await this.listInspirations();
    const withoutDuplicate = current.filter((item) => item.sourceUrl !== next.sourceUrl);
    await this.storageArea.set({ [STORAGE_KEY]: [next, ...withoutDuplicate] });
    return next;
  }

  async listInspirations() {
    if (!this.storageArea) return [];
    const data = await this.storageArea.get(STORAGE_KEY);
    return Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
  }
}

export class UnconfiguredPersonalFeishuRepository extends PracticeRepository {
  async saveInspiration() {
    throw new Error("个人飞书连接尚未确认，已拒绝远程写入");
  }

  async listInspirations() {
    throw new Error("个人飞书连接尚未确认，无法回读远程数据");
  }
}

function normalizeRecord(record) {
  const now = new Date().toISOString();
  const confirmedEvidence = Array.isArray(record.evidence)
    ? record.evidence.filter((item) => item?.userConfirmed === true)
    : [];
  return {
    id: record.id || globalThis.crypto?.randomUUID?.() || `inspiration-${Date.now()}`,
    sourceUrl: String(record.sourceUrl || ""),
    sourceText: String(record.sourceText || ""),
    mechanism: String(record.mechanism || ""),
    angle: String(record.angle || ""),
    scriptIdea: String(record.scriptIdea || ""),
    practice: String(record.practice || ""),
    evidencePlan: Array.isArray(record.evidencePlan) ? record.evidencePlan : [],
    additionalNote: String(record.additionalNote || ""),
    evidence: confirmedEvidence,
    status: confirmedEvidence.length ? "有证据" : record.status === "已收集" ? "已收集" : "待验证",
    createdAt: record.createdAt || now,
    updatedAt: now,
    sync: "local-only"
  };
}
