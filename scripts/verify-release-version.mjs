import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const tauriConfig = JSON.parse(
  await readFile(resolve(root, "src-tauri/tauri.conf.json"), "utf8"),
);
const cargoToml = await readFile(resolve(root, "src-tauri/Cargo.toml"), "utf8");
const cargoVersion = cargoToml.match(/^version\s*=\s*"([^"]+)"/m)?.[1];

const versions = [packageJson.version, tauriConfig.version, cargoVersion];
if (versions.some((version) => !version) || new Set(versions).size !== 1) {
  throw new Error(`버전이 일치하지 않습니다: ${versions.join(", ")}`);
}

const tag = process.env.GITHUB_REF_NAME;
if (tag && tag.replace(/^v/, "") !== packageJson.version) {
  throw new Error(`태그 ${tag}와 앱 버전 ${packageJson.version}이 일치하지 않습니다.`);
}

console.log(`release version verified: ${packageJson.version}`);
