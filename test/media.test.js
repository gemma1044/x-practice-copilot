import test from "node:test";
import assert from "node:assert/strict";
import { access, writeFile } from "node:fs/promises";
import path from "node:path";
import { createLocalMediaService } from "../src/bridge/media.js";
import { normalizeVideoRequest } from "../src/bridge/protocol.js";

test("只接受规范的 X 帖子链接", () => {
  assert.equal(
    normalizeVideoRequest({ sourcePost: { url: "https://x.com/example/status/123?ref=test" } }).sourceUrl,
    "https://x.com/example/status/123"
  );
  assert.throws(
    () => normalizeVideoRequest({ sourcePost: { url: "https://example.com/video" } }),
    (error) => error.code === "UNSUPPORTED_SOURCE"
  );
});

test("本机媒体服务串行下载、等距截帧并清理临时视频", async () => {
  let workDir;
  const execute = async (command, args) => {
    if (args.includes("--version") || args.includes("-version")) return { stdout: "ok", stderr: "" };
    if (command === "yt-dlp") {
      const template = args[args.indexOf("--output") + 1];
      const sourcePath = template.replace("%(ext)s", "mp4");
      workDir = path.dirname(sourcePath);
      await writeFile(sourcePath, Buffer.alloc(32));
      return { stdout: `${sourcePath}\n`, stderr: "" };
    }
    if (command === "ffprobe") return { stdout: JSON.stringify({ format: { duration: "24" }, streams: [{ width: 1080, height: 1920 }] }), stderr: "" };
    if (command === "ffmpeg") {
      if (args.includes("select='gt(scene,0.32)',showinfo")) {
        return { stdout: "", stderr: "pts_time:8.0 pts_time:16.0" };
      }
      const output = args.at(-1);
      if (output.includes("scene-") && output.includes("%02d")) {
        await Promise.all([1, 2, 3].map((index) => writeFile(output.replace("%02d", String(index).padStart(2, "0")), Buffer.from([index]))));
      } else {
        await writeFile(output, Buffer.from([9]));
      }
      return { stdout: "", stderr: "" };
    }
    throw new Error(`unexpected command ${command}`);
  };
  const service = createLocalMediaService({ execute });
  const result = await service.prepare({ sourceUrl: "https://x.com/example/status/123" });
  assert.equal(result.scenes.length, 3);
  assert.deepEqual(result.scenes[0].frameTimes, [1.33, 4, 6.67]);
  assert.equal(result.contactSheets.length, 1);
  assert.equal(result.contactSheets[0].frameCount, 9);
  assert.match(result.contactSheets[0].dataUrl, /^data:image\/jpeg;base64,/u);
  await assert.rejects(() => access(workDir));
});

test("429 会停止处理并返回明确限流错误", async () => {
  let attempts = 0;
  const service = createLocalMediaService({
    execute: async () => {
      attempts += 1;
      throw Object.assign(new Error("failed"), { stderr: "HTTP Error 429: Too Many Requests" });
    }
  });
  await assert.rejects(
    () => service.prepare({ sourceUrl: "https://x.com/example/status/123" }),
    (error) => error.code === "MEDIA_RATE_LIMITED" && error.status === 429
  );
  await assert.rejects(
    () => service.prepare({ sourceUrl: "https://x.com/example/status/123" }),
    (error) => error.code === "MEDIA_COOLDOWN" && error.status === 429
  );
  assert.equal(attempts, 1);
});
