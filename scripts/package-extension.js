import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultOutput = path.join(projectRoot, "dist", "x-practice-copilot-extension");
const browserDirectories = ["background", "content", "core", "sidepanel"];

export async function buildExtension(outputDirectory = defaultOutput) {
  await fs.rm(outputDirectory, { recursive: true, force: true });
  await fs.mkdir(path.join(outputDirectory, "src"), { recursive: true });
  await fs.copyFile(path.join(projectRoot, "manifest.json"), path.join(outputDirectory, "manifest.json"));
  for (const directory of browserDirectories) {
    await fs.cp(
      path.join(projectRoot, "src", directory),
      path.join(outputDirectory, "src", directory),
      { recursive: true }
    );
  }
  return outputDirectory;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const output = await buildExtension();
  console.log(output);
}
