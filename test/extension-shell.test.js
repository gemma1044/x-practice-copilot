import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const projectRoot = process.env.XPC_EXTENSION_PATH
  ? path.resolve(process.env.XPC_EXTENSION_PATH)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function resolveChromiumExecutable() {
  const preferred = chromium.executablePath();
  try {
    await fs.access(preferred);
    return preferred;
  } catch {
    const cacheRoot = path.join(os.homedir(), "Library", "Caches", "ms-playwright");
    const entries = await fs.readdir(cacheRoot, { withFileTypes: true });
    const cached = entries
      .filter((entry) => entry.isDirectory() && /^chromium-\d+$/u.test(entry.name))
      .sort((left, right) => Number(right.name.split("-")[1]) - Number(left.name.split("-")[1]));
    for (const entry of cached) {
      const executable = path.join(
        cacheRoot,
        entry.name,
        "chrome-mac-arm64",
        "Google Chrome for Testing.app",
        "Contents",
        "MacOS",
        "Google Chrome for Testing"
      );
      try {
        await fs.access(executable);
        return executable;
      } catch {
        // Continue to the next locally cached Chromium revision.
      }
    }
    throw new Error("未找到支持侧载扩展的 Playwright Chromium；请运行 npx playwright install chromium");
  }
}

function tweet(index) {
  return `
    <article data-testid="tweet" data-fixture-index="${index}">
      <div data-testid="User-Name">作者 ${index} @author_${index} · ${index}m</div>
      <div data-testid="tweetText">第 ${index} 条用于扩展真机壳验收的帖子。</div>
      <a href="/author_${index}/status/${100000 + index}">时间</a>
      <div role="group"><button data-testid="reply">回复</button></div>
    </article>`;
}

function fixtureHtml(start = 1) {
  return `<!doctype html><html><body><main id="feed">${Array.from(
    { length: 10 },
    (_, offset) => tweet(start + offset)
  ).join("")}</main><script>globalThis.replyClicks = 0; document.addEventListener("click", (event) => { if (event.target.closest('[data-testid="reply"]')) globalThis.replyClicks += 1; });</script></body></html>`;
}

async function waitForWorker(context) {
  const current = context.serviceWorkers()[0];
  return current || context.waitForEvent("serviceworker");
}

async function storedSelection(worker) {
  return worker.evaluate(() => chrome.storage.local.get(["xpc_current_context", "xpc_current_mode"]));
}

async function waitForSelection(worker, expectedMode, expectedId) {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const stored = await storedSelection(worker);
    if (stored.xpc_current_mode === expectedMode && stored.xpc_current_context?.id === expectedId) return stored;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`没有等到 ${expectedMode}/${expectedId} 写入扩展存储`);
}

test("MV3 真机壳在十帖、刷新与站内换页后保持单一入口和正确上下文", { timeout: 30_000 }, async (t) => {
  const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), "xpc-browser-test-"));
  const executablePath = await resolveChromiumExecutable();
  const context = await chromium.launchPersistentContext(profileDir, {
    executablePath,
    headless: true,
    args: [`--disable-extensions-except=${projectRoot}`, `--load-extension=${projectRoot}`]
  });
  t.after(async () => {
    await context.close();
    await fs.rm(profileDir, { recursive: true, force: true });
  });

  await context.route("https://x.com/**", (route) =>
    route.fulfill({ status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body: fixtureHtml() })
  );

  const page = await context.newPage();
  await page.goto("https://x.com/home");
  const worker = await waitForWorker(context);
  const articles = page.locator('article[data-testid="tweet"]');

  await articles.nth(9).locator(".xpc-actions").waitFor();
  assert.equal(await articles.count(), 10);
  assert.equal(await page.locator(".xpc-actions").count(), 10);
  assert.equal(await page.locator(".xpc-action").count(), 30);

  const actions = [
    { label: "AI 评论", mode: "comment", articleIndex: 1, postIndex: 2 },
    { label: "收为灵感", mode: "inspiration", articleIndex: 5, postIndex: 6 },
    { label: "拆解视频", mode: "video", articleIndex: 9, postIndex: 10 }
  ];

  for (const action of actions) {
    const button = articles.nth(action.articleIndex).getByRole("button", { name: action.label });
    await button.click();
    const stored = await waitForSelection(worker, action.mode, String(100000 + action.postIndex));
    await page.waitForFunction((node) => !node.dataset.loading, await button.elementHandle());
    await assert.doesNotReject(() => button.evaluate((node) => {
      if (node.dataset.error) throw new Error(node.title);
    }));
    assert.equal(stored.xpc_current_context.url, `https://x.com/author_${action.postIndex}/status/${100000 + action.postIndex}`);
    assert.equal(stored.xpc_current_context.text, `第 ${action.postIndex} 条用于扩展真机壳验收的帖子。`);
  }
  assert.equal(await page.evaluate(() => globalThis.replyClicks), 0);

  await articles.nth(0).locator('[data-testid="tweetText"]').evaluate((node) => node.append(" 更新"));
  await page.waitForTimeout(50);
  assert.equal(await articles.nth(0).locator(".xpc-actions").count(), 1);

  const replacementFeed = Array.from({ length: 10 }, (_, offset) => tweet(11 + offset)).join("");
  await page.evaluate((html) => {
    history.pushState({}, "", "/explore");
    document.querySelector("#feed").innerHTML = html;
  }, replacementFeed);
  await page.locator(".xpc-actions").nth(9).waitFor();
  assert.equal(await page.locator(".xpc-actions").count(), 10);
  await page.locator('article[data-fixture-index="20"]').getByRole("button", { name: "AI 评论" }).click();
  const afterNavigation = await waitForSelection(worker, "comment", "100020");
  assert.equal(afterNavigation.xpc_current_context.url, "https://x.com/author_20/status/100020");

  await page.reload();
  await page.locator(".xpc-actions").nth(9).waitFor();
  assert.equal(await page.locator(".xpc-actions").count(), 10);

});
