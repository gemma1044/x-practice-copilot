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
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8"
};

async function startStaticServer() {
  const server = http.createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
    const filePath = path.resolve(projectRoot, pathname.replace(/^\/+/, ""));
    if (!filePath.startsWith(`${projectRoot}${path.sep}`)) return response.writeHead(403).end();
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

async function dispatchTwice(page, selector) {
  await page.locator("#toast").evaluate((node) => {
    node.textContent = "";
    node.classList.remove("show");
  });
  await page.locator(selector).evaluate((node) => {
    const click = () => node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    click();
    click();
  });
  await page.getByText("相同操作正在处理中。", { exact: true }).waitFor();
}

test("侧栏四个耗时按钮均拦截重复在途操作，成功后进入冷却", { timeout: 30_000 }, async (t) => {
  const server = await startStaticServer();
  const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), "xpc-action-guards-"));
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
  await page.goto(`http://127.0.0.1:${port}/src/sidepanel/index.html?demo=1`);
  await page.getByText("AI Builder", { exact: false }).waitFor();

  await dispatchTwice(page, "#generate-comments");
  await page.getByLabel("观点补充草稿").waitFor();

  await page.locator("#toast").evaluate((node) => {
    node.textContent = "";
    node.classList.remove("show");
  });
  await page.locator("#generate-comments").dispatchEvent("click");
  await page.getByText("相同操作刚刚已完成，请稍后再试。", { exact: true }).waitFor();
  assert.equal(await page.locator("#draft-list .draft").count(), 3);

  await page.getByRole("button", { name: "灵感", exact: true }).click();
  await dispatchTwice(page, "#generate-inspiration");
  await page.getByText("3 个 AI 同做 20 分钟海报", { exact: false }).waitFor();

  await page.getByRole("button", { name: "视频", exact: true }).click();
  await dispatchTwice(page, "#prepare-video");
  await page.getByText("6 个场景 · 18 帧 · 2 张九宫格").waitFor();

  await dispatchTwice(page, "#analyze-video");
  await page.getByText("模型 · MiniMax H3 + Midjourney v8.2 · 高").waitFor();
});
