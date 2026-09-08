import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildExtension } from "./package-extension.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const watchedPaths = [path.join(projectRoot, "src"), path.join(projectRoot, "manifest.json")];
let timer;
let building = false;
let queued = false;

async function rebuild() {
  if (building) {
    queued = true;
    return;
  }
  building = true;
  try {
    const output = await buildExtension();
    console.log(`[extension-sync] ${new Date().toISOString()} → ${output}`);
  } catch (error) {
    console.error("[extension-sync] build failed", error);
  } finally {
    building = false;
    if (queued) {
      queued = false;
      rebuild();
    }
  }
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(rebuild, 120);
}

await rebuild();
const watchers = watchedPaths.map((target) => fs.watch(target, { recursive: fs.statSync(target).isDirectory() }, schedule));
console.log("[extension-sync] watching src/ and manifest.json; refresh the unpacked extension to load changes");

function close() {
  clearTimeout(timer);
  watchers.forEach((watcher) => watcher.close());
  process.exit(0);
}

process.on("SIGINT", close);
process.on("SIGTERM", close);
