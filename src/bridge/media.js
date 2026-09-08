import { spawn } from "node:child_process";
import { copyFile, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { BridgeProtocolError } from "./protocol.js";

const MAX_OUTPUT_BYTES = 1024 * 1024;

export function runCommand(command, args, { timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback(value);
    };
    const append = (current, chunk) => `${current}${chunk}`.slice(-MAX_OUTPUT_BYTES);
    child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk); });
    child.on("error", (error) => finish(reject, Object.assign(error, { stdout, stderr })));
    child.on("close", (code) => {
      if (code === 0) return finish(resolve, { stdout, stderr });
      const error = new Error(`${command} 退出码 ${code}`);
      finish(reject, Object.assign(error, { code, stdout, stderr }));
    });
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      const error = new Error(`${command} 执行超时`);
      finish(reject, Object.assign(error, { code: "COMMAND_TIMEOUT", stdout, stderr }));
    }, timeoutMs);
  });
}

export function buildScenePlan(durationSeconds, cutTimes = [], maxScenes = 15) {
  const cuts = [...new Set(cutTimes.map(Number).filter(Number.isFinite))]
    .filter((time) => time >= 0.5 && time <= durationSeconds - 0.5)
    .sort((a, b) => a - b)
    .filter((time, index, values) => index === 0 || time - values[index - 1] >= 0.75);
  const boundaries = [0, ...cuts, durationSeconds];
  let ranges = boundaries.slice(0, -1).map((start, index) => ({ start, end: boundaries[index + 1] }))
    .filter((range) => range.end - range.start >= 0.2);
  if (ranges.length > maxScenes) {
    ranges = Array.from({ length: maxScenes }, (_, index) => {
      const first = Math.floor((index * ranges.length) / maxScenes);
      const last = Math.max(first, Math.floor(((index + 1) * ranges.length) / maxScenes) - 1);
      return { start: ranges[first].start, end: ranges[last].end };
    });
  }
  return ranges.map((range, index) => {
    const length = range.end - range.start;
    return {
      id: `scene-${index + 1}`,
      index: index + 1,
      startSeconds: Number(range.start.toFixed(2)),
      endSeconds: Number(range.end.toFixed(2)),
      frameTimes: [1 / 6, 1 / 2, 5 / 6].map((ratio) => Number((range.start + length * ratio).toFixed(2)))
    };
  });
}

function commandError(error) {
  const detail = `${error?.message || ""}\n${error?.stderr || ""}`;
  if (error?.code === "ENOENT") {
    return new BridgeProtocolError("本机缺少视频处理工具", "MEDIA_TOOL_MISSING", 503);
  }
  if (/429|too many requests|rate.?limit/iu.test(detail)) {
    return new BridgeProtocolError("X 暂时限制了当前网络的请求，请停止重试并稍后再试", "MEDIA_RATE_LIMITED", 429);
  }
  if (/403|forbidden|unauthorized/iu.test(detail)) {
    return new BridgeProtocolError("X 拒绝了本次公开视频读取，不会尝试绕过限制", "MEDIA_FORBIDDEN", 403);
  }
  if (error?.code === "COMMAND_TIMEOUT") {
    return new BridgeProtocolError("本机视频处理超时", "MEDIA_TIMEOUT", 504);
  }
  return new BridgeProtocolError("无法下载或处理这个公开视频", "MEDIA_PREPARATION_FAILED", 502);
}

export function createLocalMediaService({
  execute = runCommand,
  ytDlp = "yt-dlp",
  ffmpeg = "ffmpeg",
  ffprobe = "ffprobe",
  maxScenes = 15,
  maxDurationSeconds = 300,
  maxBytes = 250 * 1024 * 1024,
  commandTimeoutMs = 120_000
} = {}) {
  let active = false;
  let rateLimitedUntil = 0;
  let cachedStatus = null;
  let statusCheckedAt = 0;

  async function toolAvailable(command) {
    try {
      await execute(command, [command === ytDlp ? "--version" : "-version"], { timeoutMs: 5_000 });
      return true;
    } catch {
      return false;
    }
  }

  return {
    async getStatus() {
      if (cachedStatus && Date.now() - statusCheckedAt < 30_000) return cachedStatus;
      const [hasYtDlp, hasFfmpeg, hasFfprobe] = await Promise.all([
        toolAvailable(ytDlp), toolAvailable(ffmpeg), toolAvailable(ffprobe)
      ]);
      cachedStatus = { configured: hasYtDlp && hasFfmpeg && hasFfprobe, hasYtDlp, hasFfmpeg, hasFfprobe };
      statusCheckedAt = Date.now();
      return cachedStatus;
    },

    async prepare({ sourceUrl }) {
      if (Date.now() < rateLimitedUntil) {
        throw new BridgeProtocolError("X 刚刚返回过限流，请至少等待 15 分钟", "MEDIA_COOLDOWN", 429);
      }
      if (active) throw new BridgeProtocolError("已有视频正在处理，请等待完成", "MEDIA_BUSY", 409);
      active = true;
      const workDir = await mkdtemp(path.join(os.tmpdir(), "xpc-video-"));
      try {
        const outputTemplate = path.join(workDir, "source.%(ext)s");
        let downloaded;
        try {
          downloaded = await execute(ytDlp, [
            "--no-playlist", "--no-progress", "--no-warnings", "--force-ipv4",
            "--max-filesize", "250M", "--socket-timeout", "20",
            "--retries", "0", "--fragment-retries", "0", "--sleep-requests", "1",
            "--format", "best[ext=mp4]/best", "--output", outputTemplate,
            "--print", "after_move:filepath", sourceUrl
          ], { timeoutMs: commandTimeoutMs });
        } catch (error) {
          const normalized = commandError(error);
          if (normalized.code === "MEDIA_RATE_LIMITED") rateLimitedUntil = Date.now() + 15 * 60 * 1000;
          throw normalized;
        }
        const sourcePath = downloaded.stdout.trim().split(/\r?\n/u).filter(Boolean).at(-1);
        if (!sourcePath || !sourcePath.startsWith(`${workDir}${path.sep}`)) {
          throw new BridgeProtocolError("下载工具没有返回安全的本地文件", "MEDIA_PREPARATION_FAILED", 502);
        }
        const sourceStat = await stat(sourcePath);
        if (!sourceStat.isFile() || sourceStat.size > maxBytes) {
          throw new BridgeProtocolError("视频超过本机 MVP 的 250 MB 限制", "MEDIA_TOO_LARGE", 413);
        }
        let metadata;
        try {
          const probe = await execute(ffprobe, [
            "-v", "error", "-select_streams", "v:0",
            "-show_entries", "format=duration:stream=width,height", "-of", "json", sourcePath
          ], { timeoutMs: 15_000 });
          metadata = JSON.parse(probe.stdout);
        } catch (error) {
          throw commandError(error);
        }
        const durationSeconds = Number(metadata?.format?.duration);
        if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
          throw new BridgeProtocolError("无法读取视频时长", "MEDIA_METADATA_INVALID", 422);
        }
        if (durationSeconds > maxDurationSeconds) {
          throw new BridgeProtocolError("视频超过本机 MVP 的 5 分钟限制", "MEDIA_TOO_LONG", 413);
        }
        const sourceWidth = Number(metadata?.streams?.[0]?.width);
        const sourceHeight = Number(metadata?.streams?.[0]?.height);
        const portrait = Number.isFinite(sourceWidth) && Number.isFinite(sourceHeight) && sourceHeight > sourceWidth;
        const cellWidth = portrait ? 270 : 480;
        const cellHeight = portrait ? 480 : 270;
        const cellSize = `${cellWidth}:${cellHeight}`;
        let cutTimes = [];
        try {
          const detected = await execute(ffmpeg, [
            "-hide_banner", "-loglevel", "info", "-i", sourcePath,
            "-vf", "select='gt(scene,0.32)',showinfo", "-an", "-f", "null", "-"
          ], { timeoutMs: commandTimeoutMs });
          cutTimes = [...detected.stderr.matchAll(/pts_time:([0-9.]+)/gu)].map((match) => Number(match[1]));
        } catch {
          cutTimes = [];
        }
        const plannedScenes = buildScenePlan(durationSeconds, cutTimes, maxScenes);
        const scenes = [];
        for (const scene of plannedScenes) {
          const pattern = path.join(workDir, `${scene.id}-frame-%02d.jpg`);
          const sceneDuration = scene.endSeconds - scene.startSeconds;
          try {
            await execute(ffmpeg, [
              "-hide_banner", "-loglevel", "error", "-ss", String(scene.startSeconds),
              "-t", String(sceneDuration), "-i", sourcePath,
              "-vf", `fps=3/${sceneDuration},scale=${cellSize}:force_original_aspect_ratio=decrease,pad=${cellSize}:(ow-iw)/2:(oh-ih)/2:black`,
              "-frames:v", "3", "-q:v", "3", pattern
            ], { timeoutMs: commandTimeoutMs });
          } catch {
            continue;
          }
          const names = (await readdir(workDir)).filter((name) => new RegExp(`^${scene.id}-frame-\\d+\\.jpg$`, "u").test(name)).sort();
          if (names.length !== 3) continue;
          scenes.push({ ...scene, framePaths: names.map((name) => path.join(workDir, name)) });
        }
        if (!scenes.length) throw new BridgeProtocolError("没有场景成功截取 3 张画面", "MEDIA_TOO_FEW_FRAMES", 422);
        const blankPath = path.join(workDir, "blank.jpg");
        try {
          await execute(ffmpeg, [
            "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `color=c=black:s=${cellWidth}x${cellHeight}`,
            "-frames:v", "1", "-q:v", "3", blankPath
          ], { timeoutMs: 15_000 });
        } catch (error) {
          throw commandError(error);
        }
        const contactSheets = [];
        for (let groupIndex = 0; groupIndex < scenes.length; groupIndex += 3) {
          const group = scenes.slice(groupIndex, groupIndex + 3);
          const framePaths = group.flatMap((scene) => scene.framePaths);
          const sheetNumber = contactSheets.length + 1;
          const cellPattern = path.join(workDir, `sheet-${String(sheetNumber).padStart(2, "0")}-cell-%02d.jpg`);
          for (let cell = 0; cell < 9; cell += 1) {
            await copyFile(framePaths[cell] || blankPath, cellPattern.replace("%02d", String(cell + 1).padStart(2, "0")));
          }
          const sheetPath = path.join(workDir, `sheet-${String(sheetNumber).padStart(2, "0")}.jpg`);
          try {
            await execute(ffmpeg, [
              "-hide_banner", "-loglevel", "error", "-framerate", "1", "-start_number", "1",
              "-i", cellPattern, "-vf", "tile=3x3:padding=6:margin=6:color=black",
              "-frames:v", "1", "-q:v", "3", sheetPath
            ], { timeoutMs: 30_000 });
          } catch (error) {
            throw commandError(error);
          }
          contactSheets.push({
            id: `sheet-${sheetNumber}`,
            sceneIds: group.map((scene) => scene.id),
            frameCount: framePaths.length,
            dataUrl: `data:image/jpeg;base64,${(await readFile(sheetPath)).toString("base64")}`
          });
        }
        return {
          taskId: randomUUID(),
          sourceUrl,
          durationSeconds,
          scenes: scenes.map(({ framePaths, ...scene }) => scene),
          contactSheets
        };
      } finally {
        active = false;
        await rm(workDir, { recursive: true, force: true });
      }
    }
  };
}
