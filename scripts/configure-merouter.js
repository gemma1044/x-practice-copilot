import fs from "node:fs/promises";
import path from "node:path";

const outputPath = path.resolve(".env");
const baseUrl = "https://merouter.play.one2x.ai/v1";
const extensionId = "jbfkkddfjkpijkcefflefbaldjojanko";

if (!process.stdin.isTTY) {
  console.error("请在交互式终端运行 npm run setup:key");
  process.exit(1);
}

process.stdout.write("粘贴 Merouter Key（内容会显示为圆点），然后按回车：\n> ");
process.stdin.setRawMode(true);
process.stdin.setEncoding("utf8");
process.stdin.resume();

let value = "";
let saving = false;

async function finish() {
  if (saving) return;
  saving = true;
  const apiKey = value.trim();
  process.stdin.setRawMode(false);
  process.stdin.pause();
  if (!apiKey) {
    console.error("\n没有收到 Key，请重新运行 npm run setup:key");
    process.exitCode = 1;
    return;
  }
  const content = [
    "# 本文件只保存在本机并已被 Git 忽略。",
    `OPENAI_API_KEY=${JSON.stringify(apiKey)}`,
    `OPENAI_BASE_URL=${baseUrl}`,
    `XPC_EXTENSION_ID=${extensionId}`,
    ""
  ].join("\n");
  await fs.writeFile(outputPath, content, { encoding: "utf8", mode: 0o600 });
  console.log("\n已保存到 .env；Key 未显示，也不会进入 Git。");
}

process.stdin.on("data", (chunk) => {
  for (const character of chunk) {
    if (character === "\u0003") {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n已取消。\n");
      process.exitCode = 130;
      return;
    }
    if (character === "\r" || character === "\n") {
      finish().catch((error) => {
        console.error(`\n保存失败：${error.message}`);
        process.exitCode = 1;
      });
      return;
    }
    if (character === "\u007f" || character === "\b") {
      if (value.length) {
        value = value.slice(0, -1);
        process.stdout.write("\b \b");
      }
      continue;
    }
    value += character;
    process.stdout.write("•");
  }
});
