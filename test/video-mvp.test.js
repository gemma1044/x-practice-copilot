import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("视频 MVP 只从当前帖子进入本机下载与截帧", () => {
  const html = fs.readFileSync(new URL("../src/sidepanel/index.html", import.meta.url), "utf8");
  const videoPanel = html.match(/data-panel="video"[\s\S]*?<\/section>/u)?.[0] || "";
  assert.doesNotMatch(videoPanel, /video\/mp4|MP4|MOV/u);
  assert.match(videoPanel, /下载并本地截帧/u);
  assert.match(videoPanel, /默认不读取登录 Cookie/u);
  assert.match(videoPanel, /frame-list/u);
  assert.match(videoPanel, /九宫格/u);
  assert.match(videoPanel, /Gemini 3\.7 Flash/u);
  assert.match(videoPanel, /替换说明|reference-assets/u);
  assert.match(videoPanel, /编辑 Gemini 分析 Prompt/u);
});
