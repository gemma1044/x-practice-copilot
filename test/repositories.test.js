import test from "node:test";
import assert from "node:assert/strict";
import { ChromeStoragePracticeRepository, MemoryPracticeRepository } from "../src/core/repositories.js";

test("同一来源链接只保留一条灵感数据通道", async () => {
  const repository = new MemoryPracticeRepository();
  await repository.saveInspiration({ sourceUrl: "https://x.com/a/status/1", mechanism: "旧机制" });
  await repository.saveInspiration({ sourceUrl: "https://x.com/a/status/1", mechanism: "新机制" });
  const records = await repository.listInspirations();
  assert.equal(records.length, 1);
  assert.equal(records[0].mechanism, "新机制");
});

test("只有用户确认的证据记录才推进到有证据", async () => {
  const repository = new MemoryPracticeRepository();
  const withoutEvidence = await repository.saveInspiration({ sourceUrl: "a", status: "待验证" });
  const withEvidence = await repository.saveInspiration({ sourceUrl: "b", evidence: [{ userConfirmed: true }] });
  const inferredEvidence = await repository.saveInspiration({ sourceUrl: "c", evidence: [{ userConfirmed: false }] });
  assert.equal(withoutEvidence.status, "待验证");
  assert.equal(withEvidence.status, "有证据");
  assert.equal(inferredEvidence.status, "待验证");
});

test("重复保存灵感保留稳定 ID、创建时间和已确认事实", async () => {
  const repository = new MemoryPracticeRepository();
  const first = await repository.saveInspiration({ sourceUrl: "a", mechanism: "旧机制", evidence: [{ id: "e1", userConfirmed: true }] });
  const second = await repository.saveInspiration({ sourceUrl: "a", mechanism: "新机制", status: "待验证" });
  assert.equal(second.id, first.id);
  assert.equal(second.createdAt, first.createdAt);
  assert.equal(second.evidence.length, 1);
  assert.equal(second.status, "有证据");
});

test("实践、用户证据和草稿主张形成可追溯闭环", async () => {
  const repository = new MemoryPracticeRepository();
  const inspiration = await repository.saveInspiration({ sourceUrl: "a" });
  const practice = await repository.savePractice({
    inspirationId: inspiration.id,
    hypothesis: "限时任务比口头问答更可靠",
    steps: "运行一次并保存输出",
    result: "完成一次运行"
  });
  assert.equal(practice.status, "实践中");
  assert.equal((await repository.listInspirations())[0].status, "实践中");
  await assert.rejects(
    () => repository.addEvidence(inspiration.id, { summary: "AI 建议的截图", userConfirmed: false }),
    /必须由用户明确确认/u
  );
  const { evidence, inspiration: evidenced } = await repository.addEvidence(inspiration.id, {
    summary: "本地运行日志",
    userConfirmed: true
  });
  assert.equal(evidenced.status, "有证据");
  const draft = await repository.saveDraft({
    inspirationId: inspiration.id,
    text: "我完成了这次实践，结果可复查。",
    evidenceIds: [evidence.id]
  });
  assert.deepEqual(draft.claims[0].evidenceIds, [evidence.id]);
});

test("Chrome Storage 从旧灵感键迁移到单一版本化状态", async () => {
  const values = { xpc_inspirations: [{ id: "legacy", sourceUrl: "legacy-url", evidence: [], status: "待验证" }] };
  const storage = {
    async get(keys) { return Object.fromEntries(keys.filter((key) => key in values).map((key) => [key, values[key]])); },
    async set(next) { Object.assign(values, next); },
    async remove(key) { delete values[key]; }
  };
  const repository = new ChromeStoragePracticeRepository(storage);
  assert.equal((await repository.listInspirations())[0].id, "legacy");
  await repository.saveInspiration({ sourceUrl: "new-url" });
  assert.equal(values.xpc_practice_state.version, 2);
  assert.equal(values.xpc_practice_state.inspirations.length, 2);
  assert.equal("xpc_inspirations" in values, false);
});

test("远程配置启用前可验证同一状态内的去重队列与失败重试", async () => {
  const values = {};
  const storage = {
    async get(keys) { return Object.fromEntries(keys.filter((key) => key in values).map((key) => [key, values[key]])); },
    async set(next) { Object.assign(values, next); },
    async remove(key) { delete values[key]; }
  };
  const repository = new ChromeStoragePracticeRepository(storage, { queueRemoteWrites: true });
  const first = await repository.saveInspiration({ sourceUrl: "a", mechanism: "旧机制" });
  await repository.saveInspiration({ sourceUrl: "a", mechanism: "新机制" });
  const pending = await repository.listPendingSync();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].entityId, first.id);
  assert.equal(pending[0].payload.mechanism, "新机制");
  const failed = await repository.markSyncAttempt(pending[0].id, { ok: false, error: "offline" });
  assert.equal(failed.attempts, 1);
  assert.equal(failed.lastError, "offline");
  await repository.markSyncAttempt(pending[0].id, { ok: true });
  assert.equal((await repository.listPendingSync()).length, 0);
});
