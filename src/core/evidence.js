const FIRST_PERSON_FACT_PATTERNS = [
  /我(?:刚|已经|曾经|实际)?(?:测试|跑|试|使用|完成|做|观察|验证)(?:了|过)/u,
  /我(?:刚|已经|曾经|实际)?用了/u,
  /我(?:的)?(?:测试|实验|实践|结果|数据)(?:显示|表明|证明)/u,
  /(?:我的|我们)(?:数据|结果)(?:显示|表明|证明)/u,
  /数据显示/u
];

const NUMBER_RESULT_PATTERN = /(?:提升|降低|减少|增加|快|慢|节省)(?:了)?\s*\d+(?:\.\d+)?\s*(?:%|倍|分钟|小时|次|个)/u;

export function splitClaims(text) {
  return String(text ?? "")
    .split(/(?<=[。！？!?\n])/u)
    .map((claim) => claim.trim())
    .filter(Boolean);
}

export function requiresUserEvidence(claim) {
  const value = String(claim ?? "");
  return (
    FIRST_PERSON_FACT_PATTERNS.some((pattern) => pattern.test(value)) ||
    (/(?:我|我们|我的)/u.test(value) && NUMBER_RESULT_PATTERN.test(value))
  );
}

export function auditDraft(text, evidenceIds = []) {
  const evidenceAvailable = evidenceIds.filter(Boolean).length > 0;
  const claims = splitClaims(text).map((claim, index) => {
    const needsEvidence = requiresUserEvidence(claim);
    return {
      id: `claim-${index + 1}`,
      text: claim,
      type: needsEvidence ? "user-practice-fact" : "observation-or-opinion",
      status: needsEvidence && !evidenceAvailable ? "unsupported" : "allowed",
      evidenceIds: needsEvidence && evidenceAvailable ? [...evidenceIds] : []
    };
  });

  return {
    allowed: claims.every((claim) => claim.status === "allowed"),
    claims,
    unsupportedClaims: claims.filter((claim) => claim.status === "unsupported")
  };
}

export function downgradeUnsupportedClaim(claim) {
  let value = String(claim ?? "").trim();

  value = value
    .replace(/我(?:刚|已经|曾经|实际)?测试(?:了|过)/gu, "我计划测试")
    .replace(/我(?:刚|已经|曾经|实际)?跑(?:了|过)/gu, "我计划运行")
    .replace(/我(?:刚|已经|曾经|实际)?用了/gu, "我计划尝试")
    .replace(/我(?:刚|已经|曾经|实际)?(?:试|使用|用了)(?:了|过)?/gu, "我计划尝试")
    .replace(/我(?:刚|已经|曾经|实际)?(?:完成|做)(?:了|过)/gu, "我计划完成")
    .replace(/我(?:刚|已经|曾经|实际)?(?:观察|验证)(?:了|过)/gu, "我想验证")
    .replace(/(?:我的|我们)(?:数据|结果)(?:显示|表明|证明)/gu, "可以通过记录来验证")
    .replace(/我(?:的)?(?:测试|实验|实践|结果|数据)(?:显示|表明|证明)/gu, "我想通过实践验证")
    .replace(/数据显示/gu, "可以通过数据验证");

  if (requiresUserEvidence(value)) {
    return `待验证：${value.replace(/[。！？!?]+$/u, "")}。`;
  }

  return value;
}

export function enforceEvidence(text, evidenceIds = []) {
  const audit = auditDraft(text, evidenceIds);
  if (audit.allowed) return { text, audit, changed: false };

  const unsupported = new Set(audit.unsupportedClaims.map((claim) => claim.id));
  const safeText = audit.claims
    .map((claim) => (unsupported.has(claim.id) ? downgradeUnsupportedClaim(claim.text) : claim.text))
    .join("");

  return { text: safeText, audit: auditDraft(safeText, evidenceIds), changed: true };
}
