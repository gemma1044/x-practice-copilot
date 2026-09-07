import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("视频 MVP 只暴露截图输入，不承诺视频上传或自动抽帧", () => {
  const html = fs.readFileSync(new URL("../src/sidepanel/index.html", import.meta.url), "utf8");
  const videoPanel = html.match(/data-panel="video"[\s\S]*?<\/section>/u)?.[0] || "";
  assert.match(videoPanel, /image\/png,image\/jpeg,image\/webp/u);
  assert.doesNotMatch(videoPanel, /video\/|MP4|MOV|自动抽帧/u);
  assert.match(videoPanel, /3–8 张/u);
});
