import test from "node:test";
import assert from "node:assert/strict";
import { MemoryPracticeRepository } from "../src/core/repositories.js";

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
