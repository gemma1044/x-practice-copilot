import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("发布基线保持最小权限和单一本机 bridge 地址", () => {
  const manifest = JSON.parse(fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
  assert.deepEqual(manifest.permissions, ["storage", "sidePanel"]);
  assert.deepEqual(manifest.host_permissions, [
    "https://x.com/*",
    "https://twitter.com/*",
    "http://127.0.0.1:4317/*"
  ]);
  assert.equal(manifest.host_permissions.some((permission) => permission.includes("merouter")), false);
});

test("仓库不包含真实密钥或扩展前端直连 Merouter", () => {
  const manifest = fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8");
  const connector = fs.readFileSync(new URL("../src/core/connectors.js", import.meta.url), "utf8");
  assert.doesNotMatch(manifest, /OPENAI_API_KEY|merouter\.play/u);
  assert.doesNotMatch(connector, /process\.env|merouter\.play|authorization\s*:/u);
  assert.match(connector, /http:\/\/127\.0\.0\.1:4317/u);
});

test("本机 Key 只从被忽略的 env 文件进入 bridge", () => {
  const gitignore = fs.readFileSync(new URL("../.gitignore", import.meta.url), "utf8");
  const example = fs.readFileSync(new URL("../.env.example", import.meta.url), "utf8");
  const packageJson = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(gitignore, /^\.env$/mu);
  assert.match(example, /^OPENAI_API_KEY=$/mu);
  assert.match(example, /^OPENAI_BASE_URL=https:\/\/merouter\.play\.one2x\.ai\/v1$/mu);
  assert.match(example, /^XPC_EXTENSION_ID=[a-p]{32}$/mu);
  assert.match(packageJson.scripts.bridge, /--env-file-if-exists=\.env/u);
});
