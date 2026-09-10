import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("视频 MVP 只从当前帖子进入本机下载与截帧", () => {
  const html = fs.readFileSync(new URL("../src/sidepanel/index.html", import.meta.url), "utf8");
  const script = fs.readFileSync(new URL("../src/sidepanel/sidepanel.js", import.meta.url), "utf8");
  const videoPanel = html.match(/data-panel="video"[\s\S]*?<div class="toast"/u)?.[0] || "";
  assert.doesNotMatch(videoPanel, /video\/mp4|MP4|MOV/u);
  assert.match(videoPanel, /下载并本地截帧/u);
  assert.match(videoPanel, /不读取登录 Cookie/u);
  assert.match(videoPanel, /frame-list/u);
  assert.match(videoPanel, /九宫格/u);
  assert.match(videoPanel, /Gemini 3\.7 Flash/u);
  assert.match(videoPanel, /复刻原片/u);
  assert.match(videoPanel, /改编成我的/u);
  assert.match(videoPanel, /你想把它改成什么视频/u);
  assert.doesNotMatch(videoPanel, /type="checkbox"|type="radio"|reference-assets/u);
  assert.match(videoPanel, /高级设置 · Gemini Prompt/u);
  assert.match(videoPanel, /视频处理说明/u);
  assert.match(html, /id="video-takeaway" hidden/u);
  assert.doesNotMatch(videoPanel, /clip-annotations|source-analysis-summary/u);
  assert.match(html, /复制复刻 Prompt/u);
  assert.doesNotMatch(html, /id="copy-medeo"|id="output-shell"/u);
  assert.doesNotMatch(videoPanel, /action-with-help/u);
  assert.doesNotMatch(script, /if \(!state\.context\.media\?\.hasVideo\)/u);
  assert.doesNotMatch(script, /当前帖子没有检测到可处理的视频/u);
});
