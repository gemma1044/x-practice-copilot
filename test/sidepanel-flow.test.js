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

test("Demo 完成灵感、实践、证据、草稿与本机截帧主路径", { timeout: 30_000 }, async (t) => {
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
  await panel.getByText("AI Builder", { exact: false }).waitFor();

  assert.equal(await panel.locator("#draft-list .draft").count(), 0);
  await panel.getByLabel("回复语种").selectOption("en");
  await panel.getByRole("button", { name: "用 AI 生成 3 个角度" }).click();
  await panel.getByLabel("观点补充草稿").waitFor();
  assert.match(await panel.getByLabel("观点补充草稿").inputValue(), /The most useful signal/u);
  assert.equal(await panel.locator("#draft-list .draft").count(), 3);

  await panel.getByRole("button", { name: "灵感", exact: true }).click();
  assert.equal(await panel.locator("#inspiration-quiz").isHidden(), true);
  await panel.getByRole("button", { name: "AI 提炼" }).click();
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
  await panel.getByRole("button", { name: "灵感", exact: true }).click();
  await panel.getByText("已确认 · 本地运行日志").waitFor();
  assert.equal(await panel.getByLabel("实际结果（完成后填写）").inputValue(), "完成一次运行并保存了本地日志");

  await page.getByRole("button", { name: "拆解视频" }).click();
  await panel.getByRole("button", { name: "下载并本地截帧" }).click();
  await panel.getByText("6 个场景 · 18 帧 · 2 张九宫格").waitFor();
  assert.equal(await panel.locator(".contact-sheet").count(), 2);
  await panel.getByLabel("选择第 1 张九宫格").uncheck();
  assert.equal(await panel.getByRole("button", { name: "生成完整拆解稿" }).isEnabled(), true);
  await panel.getByLabel("替换说明").fill("把产品替换成我的银色耳机，场地换成海边日落");
  await panel.locator("#reference-assets").setInputFiles({
    name: "headphones.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")
  });
  await panel.getByText("headphones.png").waitFor();
  await panel.getByRole("button", { name: "生成完整拆解稿" }).click();
  await panel.getByText("模型 · MiniMax H3 + Midjourney v8.2 · 高").waitFor();
  assert.equal(await panel.locator("#clip-annotations li").count(), 6);
  assert.match(await panel.locator("#takeaway-prompt").textContent(), /30 秒竖屏时尚短片/u);
  assert.match(await panel.locator("#takeaway-prompt").textContent(), /银色耳机/u);
  await panel.getByRole("button", { name: "复制全部" }).click();
  await panel.getByText("完整拆解稿已复制。").waitFor();
  await panel.getByLabel("替换说明").fill("把产品替换成红色跑鞋");
  await panel.getByRole("button", { name: "更新拆解稿" }).click();
  await panel.getByText("完整拆解稿已生成。").waitFor();
  assert.match(await panel.locator("#takeaway-prompt").textContent(), /红色跑鞋/u);
});
