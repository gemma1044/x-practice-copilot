import test from "node:test";
import assert from "node:assert/strict";
import { auditDraft, downgradeUnsupportedClaim, enforceEvidence, requiresUserEvidence } from "../src/core/evidence.js";

test("识别需要用户证据的第一人称实践事实", () => {
  assert.equal(requiresUserEvidence("我刚测试了三个模型，结果很明显。"), true);
  assert.equal(requiresUserEvidence("我用了这个方法。"), true);
  assert.equal(requiresUserEvidence("我的数据显示速度提升了 30%。"), true);
  assert.equal(requiresUserEvidence("我计划测试三个模型。"), false);
  assert.equal(requiresUserEvidence("这个判断标准值得继续讨论。"), false);
});

test("没有证据时阻止事实主张", () => {
  const result = auditDraft("我跑了 3 次，速度提升了 20%。这是一个值得验证的方向。", []);
  assert.equal(result.allowed, false);
  assert.equal(result.unsupportedClaims.length, 1);
});

test("存在证据引用时允许用户实践事实并建立映射", () => {
  const result = auditDraft("我测试了三个模型。", ["evidence-1"]);
  assert.equal(result.allowed, true);
  assert.deepEqual(result.claims[0].evidenceIds, ["evidence-1"]);
});

test("无证据事实可降级为计划或待验证措辞", () => {
  assert.equal(downgradeUnsupportedClaim("我测试了三个模型。"), "我计划测试三个模型。");
  const result = enforceEvidence("我跑了 3 次。数据显示速度提升了 20%。");
  assert.equal(result.changed, true);
  assert.equal(result.audit.allowed, true);
  assert.doesNotMatch(result.text, /我跑了|数据显示/u);
});
