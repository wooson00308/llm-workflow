import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = process.env.GITHUB_REPOSITORY;
const publicKey = process.env.TAURI_UPDATER_PUBLIC_KEY;

if (!repository) {
  throw new Error("GITHUB_REPOSITORY가 필요합니다. 예: owner/llm-workflow");
}
if (!publicKey) {
  throw new Error("TAURI_UPDATER_PUBLIC_KEY가 필요합니다.");
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const output = resolve(scriptDirectory, "../src-tauri/tauri.release.conf.json");
const config = {
  bundle: { createUpdaterArtifacts: true },
  plugins: {
    updater: {
      pubkey: publicKey,
      endpoints: [
        `https://github.com/${repository}/releases/latest/download/latest.json`,
      ],
      windows: { installMode: "passive" },
    },
  },
};

await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(config, null, 2)}\n`, "utf8");
console.log(`release config written: ${output}`);
