import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildExtension } from "../scripts/package-extension.js";

test("浏览器扩展包只包含 Manifest 与浏览器运行文件", async (t) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "xpc-package-test-"));
  const output = path.join(temporaryRoot, "extension");
  t.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  await buildExtension(output);
  const manifest = JSON.parse(await fs.readFile(path.join(output, "manifest.json"), "utf8"));
  await fs.access(path.join(output, manifest.background.service_worker));
  await fs.access(path.join(output, manifest.side_panel.default_path));
  await fs.access(path.join(output, manifest.content_scripts[0].js[0]));
  await assert.rejects(() => fs.access(path.join(output, "src", "bridge", "server.js")));
  await assert.rejects(() => fs.access(path.join(output, "test")));
});
