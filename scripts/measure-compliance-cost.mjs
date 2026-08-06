import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// 역할 세션 하나가 실제 구현과 무관하게 반복해서 읽는 고정 비용을 잰다.
// 인자를 주지 않으면 작업 트리를, 커밋 식별자를 주면 그 시점의 커밋 내용을 읽는다.

const BYTES_PER_TOKEN = 2;
const CONTROL_DIRECTORY = ".workflow";
const LEASE_DIRECTORY = `${CONTROL_DIRECTORY}/.runtime/leases`;

const ROLES = [
  {
    id: "planner",
    label: "기획자",
    contract: "planner.md",
    selectionSets: ["ideas", "specs", "decisions"],
  },
  {
    id: "architect",
    label: "아키텍트",
    contract: "architect.md",
    selectionSets: ["decisions", "tasks"],
  },
  {
    id: "developer",
    label: "개발자",
    contract: "developer.md",
    selectionSets: ["tasks", "leases"],
  },
];

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requestedRevision = process.argv[2] ?? null;

const source = requestedRevision
  ? commitSource(requestedRevision)
  : worktreeSource();

const manifestText = source.read(`${CONTROL_DIRECTORY}/project.yml`);
if (manifestText === null) {
  throw new Error(
    `${CONTROL_DIRECTORY}/project.yml을 ${source.description}에서 찾을 수 없습니다.`,
  );
}

const workflowDirectories = activeWorkflowDirectories(manifestText);
if (workflowDirectories.length === 0) {
  throw new Error(`활성 워크플로가 없어 측정할 대상이 없습니다: ${source.description}`);
}

const documentSets = collectDocumentSets(source, workflowDirectories);
const roles = ROLES.map((role) => measureRole(role, source, workflowDirectories, documentSets));
const report = {
  schema: "workflow-labs/compliance-cost@1",
  revision: {
    requested: requestedRevision,
    resolved: source.resolved,
    kind: source.kind,
  },
  bytesPerToken: BYTES_PER_TOKEN,
  documentSets,
  roles,
};

console.log(renderTables(report));
console.log("--- JSON ---");
console.log(JSON.stringify(report, null, 2));

function worktreeSource() {
  const sizes = new Map();
  walk(resolve(root, CONTROL_DIRECTORY), sizes);
  return {
    kind: "worktree",
    resolved: null,
    description: "작업 트리",
    sizes,
    read(path) {
      try {
        return readFileSync(resolve(root, path), "utf8");
      } catch {
        return null;
      }
    },
  };
}

function commitSource(revision) {
  let resolvedRevision;
  try {
    resolvedRevision = git(["rev-parse", "--verify", `${revision}^{commit}`]).trim();
  } catch {
    throw new Error(
      `커밋 식별자 ${revision}을 확인할 수 없습니다. 이 저장소에 있는 커밋인지 확인하세요.`,
    );
  }

  const sizes = new Map();
  const listing = git([
    "ls-tree",
    "-r",
    "-l",
    "-z",
    resolvedRevision,
    "--",
    CONTROL_DIRECTORY,
  ]);
  for (const record of listing.split("\0")) {
    if (!record) continue;
    const separator = record.indexOf("\t");
    const [, type, , size] = record.slice(0, separator).trim().split(/\s+/);
    if (type !== "blob") continue;
    sizes.set(record.slice(separator + 1), Number(size));
  }

  return {
    kind: "commit",
    resolved: resolvedRevision,
    description: `커밋 ${resolvedRevision.slice(0, 12)}`,
    sizes,
    read(path) {
      try {
        return git(["show", `${resolvedRevision}:${path}`]);
      } catch {
        return null;
      }
    },
  };
}

function git(args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** 작업 트리에서는 커밋되지 않은 문서와 lease도 함께 잡힌다. */
function walk(directory, sizes) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const absolute = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      walk(absolute, sizes);
    } else if (entry.isFile()) {
      sizes.set(relative(root, absolute), statSync(absolute).size);
    }
  }
}

/**
 * 등록 문서에서 활성 워크플로의 디렉터리 이름만 읽는다. 이 값은 표시 이름이 아니라 등록된
 * `directory` 값이어야 한다.
 */
function activeWorkflowDirectories(manifestText) {
  const workflows = [];
  let current = null;
  for (const rawLine of manifestText.split("\n")) {
    const listItem = rawLine.match(/^-\s+(\w+):\s*(.*)$/);
    if (listItem) {
      current = { [listItem[1]]: unquote(listItem[2]) };
      workflows.push(current);
      continue;
    }
    const field = rawLine.match(/^\s+(\w+):\s*(.*)$/);
    if (field && current) current[field[1]] = unquote(field[2]);
  }
  return workflows
    .filter((workflow) => workflow.status === "active" && workflow.directory)
    .map((workflow) => workflow.directory);
}

function unquote(value) {
  return value.trim().replace(/^['"]|['"]$/g, "");
}

function collectDocumentSets(source, workflowDirectories) {
  const perWorkflow = (name, extension) =>
    workflowDirectories.flatMap((directory) =>
      filesIn(source, `${CONTROL_DIRECTORY}/${directory}/${name}`, extension),
    );
  return {
    ideas: summarize(perWorkflow("ideas", ".md")),
    specs: summarize(perWorkflow("specs", ".md")),
    decisions: summarize(perWorkflow("decisions", ".md")),
    tasks: summarize(perWorkflow("tasks", ".md")),
    reports: summarize(perWorkflow("reports", ".md")),
    leases: summarize(filesIn(source, LEASE_DIRECTORY, ".yml")),
  };
}

/** 하위 디렉터리는 세지 않는다. 세션이 대조하는 것은 그 디렉터리의 문서 목록이다. */
function filesIn(source, directory, extension) {
  const prefix = `${directory}/`;
  return [...source.sizes]
    .filter(([path]) => {
      if (!path.startsWith(prefix) || !path.endsWith(extension)) return false;
      return !path.slice(prefix.length).includes("/");
    })
    .sort(([left], [right]) => (left < right ? -1 : 1))
    .map(([path, bytes]) => ({ path, bytes }));
}

function summarize(files) {
  return {
    files: files.length,
    bytes: files.reduce((total, file) => total + file.bytes, 0),
  };
}

function measureRole(role, source, workflowDirectories, documentSets) {
  const startupPaths = [
    `${CONTROL_DIRECTORY}/project.yml`,
    `${CONTROL_DIRECTORY}/rules/workflow.md`,
    `${CONTROL_DIRECTORY}/rules/roles/${role.contract}`,
    ...workflowDirectories.flatMap((directory) => [
      `${CONTROL_DIRECTORY}/${directory}/workflow.yml`,
      `${CONTROL_DIRECTORY}/${directory}/README.md`,
    ]),
  ];
  const startup = summarize(
    startupPaths
      .filter((path) => source.sizes.has(path))
      .map((path) => ({ path, bytes: source.sizes.get(path) })),
  );
  const selection = role.selectionSets.reduce(
    (total, name) => ({
      files: total.files + documentSets[name].files,
      bytes: total.bytes + documentSets[name].bytes,
    }),
    { files: 0, bytes: 0 },
  );

  const files = startup.files + selection.files;
  const bytes = startup.bytes + selection.bytes;
  return {
    role: role.id,
    label: role.label,
    startup: { ...startup, paths: startupPaths },
    selection: { ...selection, sets: role.selectionSets },
    files,
    bytes,
    tokens: Math.round(bytes / BYTES_PER_TOKEN),
  };
}

function renderTables(report) {
  const lines = [
    `# 규격 준수 비용 측정`,
    ``,
    `- 측정 시점: ${describeRevision(report.revision)}`,
    `- 환산 기준: ${report.bytesPerToken}바이트 = 1토큰 (한국어 문서 근사)`,
    ``,
    `| 역할 | 착수 문서 | 착수 바이트 | 대조 문서 | 대조 바이트 | 합계 문서 | 합계 바이트 | 추정 토큰 |`,
    `| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |`,
  ];
  for (const role of report.roles) {
    lines.push(
      `| ${role.label} | ${role.startup.files} | ${role.startup.bytes} | ${role.selection.files} | ${role.selection.bytes} | ${role.files} | ${role.bytes} | ${role.tokens} |`,
    );
  }
  lines.push(``, `| 문서군 | 문서 수 | 바이트 |`, `| --- | ---: | ---: |`);
  for (const [name, set] of Object.entries(report.documentSets)) {
    lines.push(`| ${name} | ${set.files} | ${set.bytes} |`);
  }
  return lines.join("\n");
}

function describeRevision(revision) {
  if (revision.kind === "worktree") return "작업 트리 (커밋되지 않은 문서 포함)";
  return `커밋 ${revision.resolved}${revision.requested === revision.resolved ? "" : ` (${revision.requested})`}`;
}
