import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contentTypes = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };

async function startStaticServer() {
  const server = http.createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
    const relative = pathname === "/" || pathname === "/demo/" ? "demo/index.html" : pathname.replace(/^\/+/, "");
    const filePath = path.resolve(projectRoot, relative);
    if (!filePath.startsWith(`${projectRoot}${path.sep}`)) {
      response.writeHead(403).end();
      return;
    }
    try {
      const body = await fs.readFile(filePath);
      response.writeHead(200, { "content-type": contentTypes[path.extname(filePath)] || "application/octet-stream" });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server;
}

test("Demo 完成灵感、实践、证据、草稿与截图排序主路径", { timeout: 30_000 }, async (t) => {
  const server = await startStaticServer();
  const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), "xpc-sidepanel-test-"));
  const context = await chromium.launchPersistentContext(profileDir, {
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true
  });
  t.after(async () => {
    await context.close();
    server.close();
    await once(server, "close");
    await fs.rm(profileDir, { recursive: true, force: true });
  });
  const { port } = server.address();
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${port}/demo/`);
  const panel = page.frameLocator("#copilot");

  await page.getByRole("button", { name: "收为灵感" }).click();
  await panel.getByText("3 个 AI 同做 20 分钟海报", { exact: false }).waitFor();
  await panel.getByRole("button", { name: "保存灵感" }).click();
  await panel.getByText("实践与证据").waitFor();

  await panel.getByLabel("实践假设").fill("限时任务是否更容易留下可复查产物");
  await panel.getByLabel("执行步骤").fill("完成一次任务并保存日志");
  await panel.getByLabel("实际结果（完成后填写）").fill("完成一次运行并保存了本地日志");
  await panel.getByRole("button", { name: "保存实践记录" }).click();
  await panel.getByLabel("证据说明").fill("本地运行日志");
  await panel.getByLabel("这是我实际产生并核对过的记录").check();
  await panel.getByRole("button", { name: "加入证据" }).click();
  await panel.getByText("已确认 · 本地运行日志").waitFor();
  await panel.getByRole("button", { name: "生成可追溯草稿" }).click();
  await assert.doesNotReject(async () => {
    const value = await panel.getByLabel("可追溯草稿").inputValue();
    assert.match(value, /我完成了这次实践/u);
    assert.match(value, /证据映射/u);
  });

  await page.reload();
  await panel.getByText("已确认 · 本地运行日志").waitFor();
  assert.equal(await panel.getByLabel("实际结果（完成后填写）").inputValue(), "完成一次运行并保存了本地日志");

  await page.getByRole("button", { name: "拆解视频" }).click();
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  await panel.locator("#video-file").setInputFiles([
    { name: "01.png", mimeType: "image/png", buffer: png },
    { name: "02.png", mimeType: "image/png", buffer: png },
    { name: "03.png", mimeType: "image/png", buffer: png }
  ]);
  assert.equal(await panel.locator(".file-item").count(), 3);
  await panel.getByRole("button", { name: "下移 01.png" }).click();
  assert.match(await panel.locator(".file-item").first().innerText(), /02\.png/u);
  await panel.getByRole("button", { name: "移除 03.png" }).click();
  assert.equal(await panel.locator(".file-item").count(), 2);
  await panel.getByText("请选择 3–8 张").waitFor();
});
