#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REQUIRED_COMMANDS = [
  "logs.read",
  "plan.read",
  "project.pause",
  "project.resume",
  "provider.diagnose",
  "run.cancel",
  "run.retry",
  "run.start",
];
const TARGETS = new Set(["linux-x86_64", "macos-universal", "windows-x86_64"]);
const FORBIDDEN_SDKS = /(^|\/)(anthropic|claude_agent_sdk|openai|codex_sdk)(\/|$)/i;

function fail(message) {
  throw new Error(message);
}

function parseArguments(argv) {
  const options = { expectedTarget: null, runtimeRepo: null, runtimeRoot: null, selfTest: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--self-test") {
      options.selfTest = true;
      continue;
    }
    const key = {
      "--expected-target": "expectedTarget",
      "--runtime-repo": "runtimeRepo",
      "--runtime-root": "runtimeRoot",
    }[argument];
    if (!key || !argv[index + 1]) fail(`지원하지 않는 인자입니다: ${argument}`);
    options[key] = resolve(argv[++index]);
    if (key === "expectedTarget") options[key] = argv[index];
  }
  if (options.runtimeRepo && options.runtimeRoot) fail("runtime repo와 runtime root는 함께 지정할 수 없습니다");
  return options;
}

function appSupport() {
  const source = readFileSync(join(appRoot, "src-tauri/src/domain/agent_runtime.rs"), "utf8");
  const api = source.match(/SUPPORTED_API_MAJOR:\s*u32\s*=\s*(\d+)/)?.[1];
  const minimum = source.match(/MINIMUM_RUNTIME_VERSION:\s*&str\s*=\s*"([^"]+)"/)?.[1];
  const maximum = source.match(/MAXIMUM_RUNTIME_VERSION:\s*&str\s*=\s*"([^"]+)"/)?.[1];
  if (!api || !minimum || !maximum) fail("앱의 런타임 지원 범위를 읽지 못했습니다");
  return { apiMajor: Number(api), minimum, maximum };
}

function versionParts(version) {
  if (!/^\d+(\.\d+){0,2}$/.test(version)) fail(`숫자 버전이 아닙니다: ${version}`);
  return version.split(".").map(Number).concat([0, 0]).slice(0, 3);
}

function compareVersion(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function verifyManifestFiles(runtimeRoot, manifest) {
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) fail("runtime manifest에 파일 목록이 없습니다");
  const seen = new Set();
  for (const entry of manifest.files) {
    if (!entry || typeof entry.path !== "string" || !/^[A-Za-z0-9_.\-/]+$/.test(entry.path)) {
      fail("runtime manifest에 잘못된 파일 경로가 있습니다");
    }
    if (entry.path.split("/").includes("..") || seen.has(entry.path)) fail(`안전하지 않은 runtime 경로입니다: ${entry.path}`);
    seen.add(entry.path);
    if (FORBIDDEN_SDKS.test(entry.path)) fail(`provider SDK가 runtime에 포함됐습니다: ${entry.path}`);
    const path = resolve(runtimeRoot, entry.path);
    const fromRoot = relative(resolve(runtimeRoot), path);
    if (fromRoot.startsWith("..") || isAbsolute(fromRoot)) fail(`runtime 밖의 경로입니다: ${entry.path}`);
    const stats = statSync(path);
    if (!stats.isFile() || stats.size !== entry.size || sha256(path) !== entry.sha256) {
      fail(`runtime 파일 검증에 실패했습니다: ${entry.path}`);
    }
  }
}

function validate({ contractEnvelope, manifest, runtimeRoot, expectedTarget, support }) {
  if (manifest.schemaVersion !== 1) fail(`지원하지 않는 manifest schema입니다: ${manifest.schemaVersion}`);
  if (!TARGETS.has(manifest.target)) fail(`지원하지 않는 runtime target입니다: ${manifest.target}`);
  if (expectedTarget && manifest.target !== expectedTarget) fail(`runtime target ${manifest.target}이 기대값 ${expectedTarget}과 다릅니다`);
  if (manifest.apiMajor !== support.apiMajor) fail(`manifest API ${manifest.apiMajor}와 앱 API ${support.apiMajor}가 다릅니다`);
  if (compareVersion(manifest.runtimeVersion, support.minimum) < 0 || compareVersion(manifest.runtimeVersion, support.maximum) > 0) {
    fail(`runtime ${manifest.runtimeVersion}은 앱 지원 범위 ${support.minimum}..${support.maximum} 밖입니다`);
  }
  if (contractEnvelope.outcome !== "success" || contractEnvelope.command !== "contract.read") fail("runtime contract 응답이 성공 봉투가 아닙니다");
  const contract = contractEnvelope.data;
  if (!contract || contract.runtimeVersion !== manifest.runtimeVersion || contractEnvelope.runtimeVersion !== manifest.runtimeVersion) {
    fail("manifest와 실제 contract 응답의 runtime 버전이 다릅니다");
  }
  if (!contract.supportedApiVersions?.includes(String(support.apiMajor))) fail("runtime contract가 앱 API를 지원하지 않습니다");
  for (const command of REQUIRED_COMMANDS) {
    if (!contract.implementedCommands?.includes(command)) fail(`runtime contract에 필수 명령이 없습니다: ${command}`);
  }
  if (contract.reservedCommands?.length !== 0) fail("runtime contract에 아직 구현되지 않은 예약 명령이 있습니다");
  if (JSON.stringify(contract.providers) !== JSON.stringify(["claude", "codex"])) fail("provider 계약은 Claude와 Codex만 포함해야 합니다");
  if (JSON.stringify(contract.roles) !== JSON.stringify(["architect", "developer", "planner"])) fail("역할 계약이 앱과 다릅니다");
  if (runtimeRoot) verifyManifestFiles(runtimeRoot, manifest);
  return `${manifest.runtimeVersion} / API ${manifest.apiMajor} / ${manifest.target}`;
}

function run(command, arguments_, options = {}) {
  const result = spawnSync(command, arguments_, { encoding: "utf8", ...options });
  if (result.error || result.status !== 0) {
    fail(`${command} 실행 실패: ${result.error?.message ?? result.stderr.trim() ?? `exit ${result.status}`}`);
  }
  return result.stdout.trim();
}

function python(runtimeRepo, arguments_) {
  const environment = { ...process.env, PYTHONPATH: join(runtimeRepo, "src") };
  for (const executable of [process.env.PYTHON, "python", "python3"].filter(Boolean)) {
    const result = spawnSync(executable, arguments_, { cwd: runtimeRepo, env: environment, encoding: "utf8" });
    if (!result.error && result.status === 0) return result.stdout.trim();
    if (result.error?.code !== "ENOENT") fail(`${executable} 실행 실패: ${result.stderr.trim() || result.error.message}`);
  }
  fail("Python 실행 파일을 찾지 못했습니다");
}

function sourceInputs(runtimeRepo, expectedTarget) {
  const root = mkdtempSync(join(tmpdir(), "agent-runtime-contract-"));
  try {
    const target = expectedTarget || ({ darwin: "macos-universal", linux: "linux-x86_64", win32: "windows-x86_64" }[process.platform]);
    const executable = join(root, target === "windows-x86_64" ? "heartbeat.exe" : "heartbeat");
    writeFileSync(executable, "contract fixture\n");
    const script = [
      "from pathlib import Path",
      "from heartbeat.legacy_migration import write_runtime_manifest",
      `print(write_runtime_manifest(Path(${JSON.stringify(root)}), target=${JSON.stringify(target)}).read_text())`,
    ].join("; ");
    const manifest = JSON.parse(python(runtimeRepo, ["-c", script]));
    const contractEnvelope = JSON.parse(python(runtimeRepo, ["-m", "heartbeat.cli", "agent", "contract"]));
    return { contractEnvelope, manifest, runtimeRoot: root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

function packagedInputs(runtimeRoot) {
  const manifest = JSON.parse(readFileSync(join(runtimeRoot, "runtime-manifest.json"), "utf8"));
  const executable = join(runtimeRoot, process.platform === "win32" ? "heartbeat.exe" : "heartbeat");
  run(executable, ["runtime", "verify-manifest", "--root", runtimeRoot]);
  const contractEnvelope = JSON.parse(run(executable, ["agent", "contract"]));
  return { contractEnvelope, manifest, runtimeRoot, cleanup: () => {} };
}

function selfTest(support) {
  const root = mkdtempSync(join(tmpdir(), "agent-runtime-self-test-"));
  try {
    const binary = join(root, "heartbeat");
    writeFileSync(binary, "fixture\n");
    const manifest = {
      schemaVersion: 1,
      target: "linux-x86_64",
      runtimeVersion: support.minimum,
      apiMajor: support.apiMajor,
      files: [{ path: "heartbeat", size: statSync(binary).size, sha256: sha256(binary) }],
    };
    const contractEnvelope = {
      apiVersion: String(support.apiMajor), runtimeVersion: support.minimum, command: "contract.read", outcome: "success",
      data: {
        runtimeVersion: support.minimum,
        supportedApiVersions: [String(support.apiMajor)],
        implementedCommands: REQUIRED_COMMANDS,
        reservedCommands: [],
        providers: ["claude", "codex"],
        roles: ["architect", "developer", "planner"],
      },
    };
    validate({ contractEnvelope, manifest, runtimeRoot: root, expectedTarget: "linux-x86_64", support });
    for (const mutate of [
      (copy) => { copy.manifest.apiMajor += 1; },
      (copy) => { copy.manifest.target = "wrong-target"; },
      (copy) => { copy.contractEnvelope.data.providers = ["claude", "codex", "dream"]; },
    ]) {
      const copy = structuredClone({ contractEnvelope, manifest });
      mutate(copy);
      let rejected = false;
      try { validate({ ...copy, runtimeRoot: root, expectedTarget: "linux-x86_64", support }); } catch { rejected = true; }
      if (!rejected) fail("계약 불일치 self-test가 실패를 놓쳤습니다");
    }
    return "정상 fixture 1건과 불일치 fixture 3건";
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

try {
  const options = parseArguments(process.argv.slice(2));
  const support = appSupport();
  if (options.selfTest) {
    console.log(`agent runtime contract self-test 통과: ${selfTest(support)}`);
  } else {
    const runtimeRepo = options.runtimeRepo || process.env.AGENT_RUNTIME_REPOSITORY || resolve(appRoot, "../../Git/claude-heartbeat");
    const inputs = options.runtimeRoot ? packagedInputs(options.runtimeRoot) : sourceInputs(runtimeRepo, options.expectedTarget);
    try {
      console.log(`agent runtime contract 검증 통과: ${validate({ ...inputs, expectedTarget: options.expectedTarget, support })}`);
    } finally {
      inputs.cleanup();
    }
  }
} catch (error) {
  console.error(`agent runtime contract 검증 실패: ${error.message}`);
  process.exitCode = 1;
}
