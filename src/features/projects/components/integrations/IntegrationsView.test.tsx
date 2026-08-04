import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DreamIntegration,
  HeartbeatIntegration,
  HeartbeatJobRun,
  HeartbeatRoleStatus,
  HeartbeatRunControls,
  HeartbeatRunFailure,
  HeartbeatSetupStage,
  HeartbeatSetupState,
  HeartbeatSetupStep,
  HeartbeatUpdateGuide,
  IntegrationsSnapshot,
  IntegrationsState,
  JobDefaults,
  JobQuota,
  ManagedRoleJob,
  PendingRoleWork,
  RoleJobRequest,
} from "../../domain/types";
import { IntegrationsView } from "./IntegrationsView";

/**
 * 클립보드 모듈을 대신한다. 실제 플러그인을 부르면 Tauri 런타임이 필요하고, 여기서 확인할 것은
 * 화면이 무엇을 넘기고 결과를 어떻게 보이느냐이지 플러그인의 동작이 아니다.
 *
 * 이 파일의 첫 `vi.mock`이다. 다른 쓰기 액션은 `actions` prop으로 주입되지만 복사는 모듈 import라
 * 주입할 자리가 없다.
 */
const clipboard = vi.hoisted(() => ({ copy: vi.fn<(text: string) => Promise<boolean>>() }));

vi.mock("../../infrastructure/clipboard", () => clipboard);

/**
 * 펼침 상태는 브라우저 저장소에 남는다(SPEC-006 R6). 테스트 환경의 `localStorage`는 메서드가 없는
 * 빈 객체라 실제 저장 동작을 보려면 직접 세워야 한다. 매 테스트가 빈 저장소에서 시작해야 앞 테스트가
 * 펼쳐 둔 값이 다음 테스트의 시작 상태를 바꾸지 않는다.
 */
let storage: Map<string, string>;

beforeEach(() => {
  storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * 백엔드 잡 정의의 기본값(`heartbeat_roles.rs`의 `default_settings`)과 같은 값이다. 화면은 이 값을
 * 스냅샷에서 받아 폼을 시딩하고 재설정도 이 값으로 한다.
 */
const roleDefaults: Record<string, JobDefaults> = {
  planner: { interval: "30m", maxPer: "4/24h", model: "opus", timeout: "20m" },
  architect: { interval: "30m", maxPer: "4/24h", model: "opus", timeout: "20m" },
  developer: { interval: "20m", maxPer: "6/24h", model: "opus", timeout: "30m" },
};

/**
 * 관리 블록이 있는 정상 상태의 흔한 사용량. 기본값을 `unknown`으로 두면 새 표시가 대부분의 기존
 * 테스트에서 그려지지 않아 회귀를 놓친다.
 */
const roomyQuota: JobQuota = {
  kind: "counted",
  used: 2,
  limit: 6,
  window: "24h",
  exhausted: false,
  recoversAt: null,
};

/** 백엔드는 늘 역할 셋을 담아 보낸다. 실행 기록·사용량만 다르게 주고 나머지는 여기서 채운다. */
function roleStatuses(
  runs: Record<string, HeartbeatJobRun> = {},
  quotas: Record<string, JobQuota> = {},
): HeartbeatRoleStatus[] {
  return ["planner", "architect", "developer"].map((role) => ({
    role,
    jobName: `wf-${role}-projects-workflow-labs`,
    defaults: roleDefaults[role],
    lastRun: runs[role] ?? null,
    quota: quotas[role] ?? roomyQuota,
  }));
}

/**
 * 백엔드는 늘 네 단계를 고정 순서로 담아 보낸다. 설치 마법사가 이 값을 그린다. 3단계가 확인 불가라
 * 이 기본값만으로도 마법사가 보이는 상태다.
 */
function setupStages(): HeartbeatSetupStage[] {
  return [
    {
      step: "package",
      state: "done",
      required: true,
      command: "pip install claude-heartbeat",
      evidence: null,
    },
    {
      step: "init",
      state: "done",
      required: true,
      command: "heartbeat init",
      evidence: "/Users/catze/.claude/HEARTBEAT.md",
    },
    {
      step: "service",
      state: "unknown",
      required: true,
      command: "heartbeat install-service",
      evidence: "/Users/catze/Library/LaunchAgents/com.claude-heartbeat.plist",
    },
    {
      step: "dream",
      state: "not_done",
      required: false,
      command: "heartbeat install dream",
      evidence: "/Users/catze/.claude/skills/dream/SKILL.md",
    },
  ];
}

function heartbeat(overrides: Partial<HeartbeatIntegration> = {}): HeartbeatIntegration {
  return {
    installation: "installed",
    daemonRunning: true,
    setupStages: setupStages(),
    conditionScriptPath: ".workflow/rules/wf-eligible.sh",
    roles: roleStatuses(),
    managedJobs: [],
    duplicateJobs: [],
    readFailures: [],
    ...overrides,
  };
}

/** dream 카드 자체의 시나리오는 DreamCard.test.tsx가 덮는다. 여기서는 섹션에 얹히기만 하면 된다. */
function dream(overrides: Partial<DreamIntegration> = {}): DreamIntegration {
  return {
    installation: "not_installed",
    heartbeat: "installed",
    refinement: {
      totalTranscripts: 0,
      markedTranscripts: 0,
      unrefinedTranscripts: 0,
      lastDream: null,
      memoryTopics: 0,
    },
    skillPath: "/Users/catze/.claude/skills/dream/SKILL.md",
    conditionCommand: "dream-prep check-unprocessed --slug=-projects-workflow-labs",
    defaults: { interval: "2h", maxPer: "6/24h", model: "opus", timeout: "30m" },
    managedJob: null,
    lastRun: null,
    quota: roomyQuota,
    duplicateJobs: [],
    readFailures: [],
    ...overrides,
  };
}

/** 백엔드가 계산해 내려보내는 잡 파일 경로. 화면은 이 값을 그리기만 한다. */
const jobsFilePath = "/home/tester/.claude/heartbeat/jobs.d/-projects-workflow-labs.md";

/**
 * 갱신 안내의 명령 원문. 다섯 값을 실제 상수와 알아볼 수 있게 다르게 둔다 — 화면이 조각을
 * 조립하면 이 값이 그대로 나올 수 없으므로 그 사실이 검사가 된다(SPEC-034 R3).
 */
const updateGuide: HeartbeatUpdateGuide = {
  identifyCommand: "fixture-identify claude-heartbeat",
  packageCommand: "fixture-package -U claude-heartbeat",
  sourceCommand: "fixture-source pull",
  serviceLookupCommand: "fixture-lookup | grep heartbeat",
  serviceRestartCommand: "fixture-restart gui/$(id -u)/<라벨>",
};

function snapshot(overrides: Partial<IntegrationsSnapshot> = {}): IntegrationsSnapshot {
  return {
    supported: true,
    slug: "-projects-workflow-labs",
    managedBlockFailure: null,
    jobsFilePath,
    updateGuide,
    heartbeat: heartbeat(),
    dream: dream(),
    ...overrides,
  };
}

/** 카드 머리의 펼침 토글. 본문 버튼과 섞이지 않도록 토글의 두 문구로만 고른다. */
function toggleOf(name: string) {
  return within(screen.getByRole("article", { name })).getByRole("button", {
    name: /^(펼치기|접기)$/,
  });
}

/** 카드 하나를 펼치거나 접는다. 토글은 카드 머리에 있어 접혀 있어도 늘 눌린다. */
function toggleCard(name: string) {
  fireEvent.click(toggleOf(name));
}

/**
 * 카드는 접힌 채로 시작한다(SPEC-006 R6). 본문을 읽는 테스트가 대부분이므로 렌더 직후 전부 펼친다.
 * 접힘 자체를 보는 테스트는 `expand: false`로 이 준비 동작을 건너뛴다.
 */
/**
 * 실행 통로의 기본값. 진행 중인 잡도 실패도 없는 상태다. 실행 시나리오만 이 값을 갈아 끼운다.
 *
 * 실행 상태의 주인은 훅이라 카드에는 prop으로만 들어온다. 그래서 진행 중을 만드는 방법도 카드를
 * 조작하는 것이 아니라 이 값에 잡 이름을 담아 넘기는 것이다.
 */
function runControls(overrides: Partial<HeartbeatRunControls> = {}): HeartbeatRunControls {
  return { running: [], failure: null, run: vi.fn().mockResolvedValue(true), ...overrides };
}

function renderIntegrations(
  integrations: IntegrationsState,
  onInstall = vi.fn().mockResolvedValue(true),
  {
    expand = true,
    /** null은 "대기 물량을 모른다"이다. 화면에는 값 없이 내려간다. */
    pendingWork = { planner: false, architect: false, developer: false },
    heartbeatRuns = runControls(),
  }: {
    expand?: boolean;
    pendingWork?: PendingRoleWork | null;
    heartbeatRuns?: HeartbeatRunControls;
  } = {},
) {
  render(
    <IntegrationsView
      actions={{
        installHeartbeatJobs: onInstall,
        installDreamJob: vi.fn().mockResolvedValue(true),
      }}
      error={integrations.error}
      heartbeatRuns={heartbeatRuns}
      pendingWork={pendingWork ?? undefined}
      snapshot={integrations.snapshot}
      writeError={integrations.writeError}
    />,
  );
  if (expand) {
    // 앞선 렌더에서 펼쳐 둔 카드는 저장된 상태로 이미 펼쳐져 나온다. 아직 접힌 카드만 누른다.
    for (const toggle of screen.queryAllByRole("button", { name: "펼치기" })) {
      fireEvent.click(toggle);
    }
  }
  return onInstall;
}

/** 설치된 상태의 연동 스냅샷. 역할 잡 관리 UI가 보이는 최소 조건이다. */
function installed(managedJobs: ManagedRoleJob[] = []): IntegrationsState {
  return {
    snapshot: snapshot({ heartbeat: heartbeat({ managedJobs }) }),
    error: null,
    writeError: null,
  };
}

/** 소진 상태의 사용량. 대기 물량과 만나야 경고가 된다(R3). */
const exhaustedQuota: JobQuota = {
  kind: "counted",
  used: 24,
  limit: 24,
  window: "24h",
  exhausted: true,
  recoversAt: "2026-08-03T05:20:00Z",
};

/** 관리 블록에 개발자 잡만 있는 상태. 한도는 앱 기본값(6/24h)과 다른 값으로 둔다. */
const developerJob: ManagedRoleJob = {
  role: "developer",
  interval: "20m",
  maxPer: "24/24h",
  model: "opus",
  timeout: "30m",
  appOwnedDrift: [],
};

/**
 * 한도 시나리오의 기본 실행 기록. 한도를 세려면 그 잡이 이미 돌았어야 한다.
 *
 * 기본값으로 두는 이유는 이 시나리오가 검사하는 것이 한도 경고이기 때문이다. 실행 기록이 없는 잡에는
 * "하트비트가 이 잡을 실행한 기록이 없습니다" 경고가 따로 붙고(SPEC-024 R4), 그것이 한도 경고의
 * 있고 없음을 보는 단정을 흐린다. 기록 없는 상태를 다루는 시나리오는 `runs`를 직접 넘긴다.
 */
const ranOnce: HeartbeatJobRun = {
  at: "2026-08-03 05:00:00",
  result: "success",
  durationSeconds: 12,
};

function quotaState(
  quotas: Record<string, JobQuota>,
  {
    managedJobs = [developerJob],
    runs = { developer: ranOnce },
    managedBlockFailure = null,
  }: {
    managedJobs?: ManagedRoleJob[];
    runs?: Record<string, HeartbeatJobRun>;
    managedBlockFailure?: IntegrationsSnapshot["managedBlockFailure"];
  } = {},
): IntegrationsState {
  return {
    snapshot: snapshot({
      managedBlockFailure,
      heartbeat: heartbeat({ managedJobs, roles: roleStatuses(runs, quotas) }),
    }),
    error: null,
    writeError: null,
  };
}

/**
 * 건너뜀 안내의 원문. 두 카드가 이 문장을 글자까지 같이 써야 한다(R8). 카드 코드가 상수를
 * 공유하지 않으므로 테스트도 각자의 원문을 들고 대조한다.
 */
const skippedReasonNote =
  "건너뜀에는 조건을 충족하지 못한 경우와 조건 검사가 실행되지 못한 경우가 모두 들어갑니다. 앱은 둘 중 어느 쪽인지 알지 못하며, 실제 사유는 하트비트 로그 파일에 남습니다.";

/**
 * 건너뛴 개발자 잡 하나만 설치된 상태. 사유 표시 시나리오가 실행 기록의 두 값만 바꿔 가며 쓴다.
 * `conditionOutput`을 주지 않으면 그 키가 없는 기기와 같은 상태다.
 */
function skipped({
  conditionOutput,
  result = "skipped",
}: {
  conditionOutput?: string | null;
  result?: string;
}): IntegrationsState {
  return {
    snapshot: snapshot({
      heartbeat: heartbeat({
        managedJobs: [
          { role: "developer", interval: "20m", maxPer: "6/24h", model: "opus", timeout: "30m", appOwnedDrift: [] },
        ],
        roles: roleStatuses({
          developer: { at: "2026-08-02T02:42:25", result, durationSeconds: 0, conditionOutput },
        }),
      }),
    }),
    error: null,
    writeError: null,
  };
}

/** 잡 하나의 행. 역할 이름만 담은 요소에서 올라간다. */
function jobRow(label: string) {
  return screen.getByText(label).closest("li") as HTMLElement;
}

/** 세 역할 중 하나만 대기 중인 상태. */
function waitingFor(role: "planner" | "architect" | "developer"): PendingRoleWork {
  return { planner: false, architect: false, developer: false, [role]: true };
}

/** 화면에 보이는 선택지 이름으로 고른다. 테스트가 직접 입력 항목의 내부 값을 알 필요가 없다. */
function selectModel(label: string, option: string) {
  const select = screen.getByLabelText(label);
  const target = within(select).getByRole("option", { name: option }) as HTMLOptionElement;
  fireEvent.change(select, { target: { value: target.value } });
}

describe("IntegrationsView 연동 섹션", () => {
  it("draws one card per built-in integration", () => {
    renderIntegrations(installed());

    expect(screen.getAllByRole("article")).toHaveLength(2);
    expect(screen.getByRole("article", { name: "claude-heartbeat" })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "dream" })).toBeInTheDocument();
  });

  // 배지 문구는 연동 공통 설치 상태와 하트비트 부가 상태(데몬 실행 여부)의 조합으로 만든다.
  it.each([
    ["not_installed" as const, false, "미설치"],
    ["installed" as const, false, "설치됨 · 데몬 미실행"],
    ["installed" as const, true, "설치됨 · 데몬 실행 중"],
  ])("labels %s with daemonRunning=%s as %s", (installation, daemonRunning, label) => {
    renderIntegrations({
      snapshot: snapshot({ heartbeat: heartbeat({ installation, daemonRunning }) }),
      error: null,
      writeError: null,
    });

    expect(screen.getByRole("article", { name: "claude-heartbeat" })).toHaveTextContent(label);
  });

  it("guides the install and hides the role jobs while heartbeat is missing", () => {
    renderIntegrations({
      snapshot: snapshot({
        heartbeat: heartbeat({ installation: "not_installed", daemonRunning: false }),
      }),
      error: null,
      writeError: null,
    });

    const card = screen.getByRole("region", { name: "연동" });
    expect(card).toHaveTextContent("미설치");
    expect(card).toHaveTextContent("pip install claude-heartbeat");
    expect(card).toHaveTextContent("github.com/wooson00308/claude-heartbeat");
    expect(card).toHaveTextContent("앱이 하트비트를 대신 설치하지 않습니다");
    expect(card).not.toHaveTextContent("역할 잡 미설치");
  });

  it("tells a stopped daemon apart from a running one by its evidence", () => {
    renderIntegrations({
      snapshot: snapshot({ heartbeat: heartbeat({ daemonRunning: false }) }),
      error: null,
      writeError: null,
    });
    expect(screen.getByRole("region", { name: "연동" })).toHaveTextContent("설치됨 · 데몬 미실행");
    expect(screen.getByRole("region", { name: "연동" })).toHaveTextContent("heartbeat.pid가 없어");
    cleanup();

    renderIntegrations({ snapshot: snapshot(), error: null, writeError: null });
    expect(screen.getByRole("region", { name: "연동" })).toHaveTextContent("설치됨 · 데몬 실행 중");
    expect(screen.getByRole("region", { name: "연동" })).toHaveTextContent("heartbeat.pid가 있습니다");
  });

  it("shows the slug, the condition script path and the settings of every installed role job", () => {
    renderIntegrations({
      snapshot: snapshot({
        heartbeat: heartbeat({
          managedJobs: [
            { role: "developer", interval: "20m", maxPer: "6/24h", model: "opus", timeout: "30m", appOwnedDrift: [] },
          ],
          roles: roleStatuses({
            developer: { at: "2026-08-02T02:42:25", result: "skipped", durationSeconds: 0 },
          }),
        }),
      }),
      error: null,
      writeError: null,
    });

    const card = screen.getByRole("region", { name: "연동" });
    expect(card).toHaveTextContent("-projects-workflow-labs");
    expect(card).toHaveTextContent(".workflow/rules/wf-eligible.sh");
    expect(screen.getByLabelText("개발자 주기")).toHaveValue("20m");
    expect(screen.getByLabelText("개발자 실행 한도 값")).toHaveValue("6/24h");
    expect(screen.getByLabelText("개발자 모델")).toHaveValue("opus");
    expect(card).toHaveTextContent("2026-08-02T02:42:25 (로컬 시각)");
    // 라벨은 건너뛰었다는 사실만 적는다. 사유는 앱이 모른다(R8).
    expect(within(jobRow("개발자")).getByText("건너뜀")).toBeVisible();
    expect(card).not.toHaveTextContent("처리할 대상 없음");
    expect(card).not.toHaveTextContent("실행 기록 없음");
  });

  /**
   * 두 카드는 `runResultLabels`처럼 문구만 맞추고 코드는 공유하지 않는다. 한쪽만 고치는 실수를
   * 막는 것은 이 테스트뿐이라, 섹션이 두 카드를 함께 그리는 이 자리에서 같은 문장인지 대조한다.
   */
  it("explains a skip with one wording shared by the role job card and the dream card", () => {
    renderIntegrations({
      snapshot: snapshot({
        heartbeat: heartbeat({
          managedJobs: [
            { role: "developer", interval: "20m", maxPer: "6/24h", model: "opus", timeout: "30m", appOwnedDrift: [] },
          ],
          roles: roleStatuses({
            developer: { at: "2026-08-02T02:42:25", result: "skipped", durationSeconds: 0 },
          }),
        }),
        dream: dream({
          installation: "installed",
          managedJob: { interval: "2h", maxPer: "6/24h", model: "opus", timeout: "30m", appOwnedDrift: [] },
          lastRun: { at: "2026-08-02T03:42:25", result: "skipped", durationSeconds: 1 },
        }),
      }),
      error: null,
      writeError: null,
    });

    // 글자까지 같은 문장이 두 카드에 하나씩 있다. 한쪽만 고치면 개수가 1로 떨어져 실패한다.
    const notes = screen.getAllByText(skippedReasonNote);
    expect(notes).toHaveLength(2);
    expect(within(jobRow("개발자")).getByText(skippedReasonNote)).toBeVisible();
    // 안내가 담아야 하는 사실 셋: 두 경우가 섞여 있고, 앱은 모르며, 사유는 로그에 남는다.
    expect(skippedReasonNote).toContain("조건 검사가 실행되지 못한 경우");
    expect(skippedReasonNote).toContain("어느 쪽인지 알지 못하며");
    expect(skippedReasonNote).toContain("하트비트 로그 파일");
  });

  it("keeps the skip guidance out of jobs that have no run record", () => {
    renderIntegrations({
      snapshot: snapshot({
        heartbeat: heartbeat({
          managedJobs: [
            { role: "developer", interval: "20m", maxPer: "6/24h", model: "opus", timeout: "30m", appOwnedDrift: [] },
          ],
        }),
      }),
      error: null,
      writeError: null,
    });

    expect(screen.queryByText(skippedReasonNote)).toBeNull();
    expect(within(jobRow("개발자")).getByText("실행 기록 없음")).toBeVisible();
  });

  /** 상태 파일이 사유를 실어 오면 그 사유가 "모른다"는 안내를 대신한다(SPEC-023 R1·완료 조건 1). */
  it("replaces the skip guidance with the reason the condition reported", () => {
    renderIntegrations(skipped({ conditionOutput: "no-target" }));

    const row = jobRow("개발자");
    expect(within(row).getByText("처리할 대상이 없어 건너뛰었습니다.")).toBeVisible();
    // 사유를 알게 된 자리에 "앱은 알지 못한다"가 남으면 화면이 자기 모순이다.
    expect(screen.queryByText(skippedReasonNote)).toBeNull();
    // 라벨은 그대로다. 사유는 라벨을 바꾸지 않고 아래 줄에 붙는다.
    expect(within(row).getByText("건너뜀")).toBeVisible();
  });

  /**
   * 어휘 넷이 모두 문장을 갖는다(완료 조건 7). 코드가 날문자로 새면 사용자는 ASCII 토큰을 읽는다.
   * 조건 스크립트의 어휘가 늘어나면 이 표가 함께 늘어야 한다.
   */
  it("puts a sentence in front of every reason code the condition script can emit", () => {
    const sentences: Record<string, string> = {
      eligible: "조건 검사는 처리할 대상이 있다고 판정했습니다.",
      "no-target": "처리할 대상이 없어 건너뛰었습니다.",
      "migration-lock": "마이그레이션 잠금 때문에 판정을 멈췄습니다.",
      usage: "조건 문자열의 역할 인자가 잘못됐습니다.",
    };

    for (const [code, sentence] of Object.entries(sentences)) {
      renderIntegrations(skipped({ conditionOutput: code }));

      const row = jobRow("개발자");
      expect(within(row).getByText(sentence)).toBeVisible();
      expect(row).not.toHaveTextContent(code);
      cleanup();
    }
  });

  /**
   * 조건 검사가 시간을 넘기거나 실행에 실패하면 데몬이 코드가 아니라 문장을 직접 넣는다. 앱이 어휘로
   * 걸러내면 그 사유가 화면에서 사라진다(R1 세 번째 항목·완료 조건 6).
   */
  it("shows a reason the daemon wrote itself as it arrived", () => {
    renderIntegrations(skipped({ conditionOutput: "condition 타임아웃 (10s)" }));

    expect(within(jobRow("개발자")).getByText("condition 타임아웃 (10s)")).toBeVisible();
    expect(screen.queryByText(skippedReasonNote)).toBeNull();
  });

  /**
   * 사유가 없는 상태가 지금 대부분의 기기다. 이 키를 주는 데몬이 아직 출시본이 아니고, 사유를 내지
   * 않는 조건도 있다. 빈 자리나 "없음" 같은 새 표시를 만들지 않는다(R2·완료 조건 2·3).
   */
  it("keeps the current wording when no reason arrived", () => {
    for (const conditionOutput of [null, undefined, "", "   "]) {
      renderIntegrations(skipped({ conditionOutput }));

      const row = jobRow("개발자");
      expect(within(row).getByText(skippedReasonNote)).toBeVisible();
      // 빈 자리나 "없음" 같은 새 표시를 만들지 않는다. 안내 한 줄이 지금처럼 그 자리를 지킨다.
      expect(row.querySelectorAll(".integration-note")).toHaveLength(1);
      cleanup();
    }
  });

  /**
   * 데몬 계약이 첫 줄 200자를 보장하지만 앱이 그것을 믿고 깨지면 안 된다(완료 조건 3). 값은 화면의
   * 글자일 뿐이라 그리기가 실패할 이유가 없다는 것을 고정한다.
   */
  it("draws an unexpected reason string without breaking the card", () => {
    for (const conditionOutput of ["no-target".repeat(60), "가".repeat(500), "첫 줄\n둘째 줄", "제어문자", "<script>"]) {
      renderIntegrations(skipped({ conditionOutput }));

      // 사유가 그 자리를 차지했으므로 안내는 물러나 있고, 카드의 나머지 줄은 그대로다.
      const row = jobRow("개발자");
      expect(screen.queryByText(skippedReasonNote)).toBeNull();
      expect(row).toHaveTextContent("2026-08-02T02:42:25 (로컬 시각)");
      // 값은 글자일 뿐이다. 태그로 읽히는 경로가 없다.
      expect(row.querySelector("script")).toBeNull();
      cleanup();
    }
  });

  /**
   * 데몬의 한도 초과 분기가 이 키를 지우지 않아, `quota_skipped` 옆에는 이전 조건 검사의 사유가
   * 남아 있을 수 있다. 붙이면 낡은 문장이 이번 사유로 읽힌다(R3·완료 조건 4).
   */
  it("leaves a quota skip without a reason even when a stale one is still recorded", () => {
    renderIntegrations(
      skipped({ conditionOutput: "no-target", result: "quota_skipped" }),
    );

    const row = jobRow("개발자");
    expect(within(row).getByText("건너뜀 · 실행 한도 도달")).toBeVisible();
    expect(row).not.toHaveTextContent("처리할 대상이 없어 건너뛰었습니다.");
    // 사유를 아는 값이라 "모른다"는 안내도 붙지 않는다. 지금 동작 그대로다.
    expect(screen.queryByText(skippedReasonNote)).toBeNull();
  });

  /**
   * 사유 문장도 `skippedReasonNote`와 같이 두 카드가 글자까지 같아야 한다(완료 조건 8). 두 카드가
   * 상수를 공유하지 않으므로 한쪽만 고치는 실수를 막는 것은 이 테스트뿐이다.
   */
  it("shows one reason wording shared by the role job card and the dream card", () => {
    renderIntegrations({
      snapshot: snapshot({
        heartbeat: heartbeat({
          managedJobs: [
            { role: "developer", interval: "20m", maxPer: "6/24h", model: "opus", timeout: "30m", appOwnedDrift: [] },
          ],
          roles: roleStatuses({
            developer: { at: "2026-08-02T02:42:25", result: "skipped", durationSeconds: 0, conditionOutput: "no-target" },
          }),
        }),
        dream: dream({
          installation: "installed",
          managedJob: { interval: "2h", maxPer: "6/24h", model: "opus", timeout: "30m", appOwnedDrift: [] },
          lastRun: { at: "2026-08-02T03:42:25", result: "skipped", durationSeconds: 1, conditionOutput: "no-target" },
        }),
      }),
      error: null,
      writeError: null,
    });

    // 글자까지 같은 문장이 두 카드에 하나씩 있다. 한쪽만 고치면 개수가 1로 떨어져 실패한다.
    expect(screen.getAllByText("처리할 대상이 없어 건너뛰었습니다.")).toHaveLength(2);
    expect(screen.queryByText(skippedReasonNote)).toBeNull();
  });

  it("marks a job without a state record as having no run history", () => {
    renderIntegrations({
      snapshot: snapshot({
        heartbeat: heartbeat({
          managedJobs: [
            { role: "planner", interval: "30m", maxPer: "4/24h", model: "opus", timeout: "20m", appOwnedDrift: [] },
          ],
          roles: roleStatuses(),
        }),
      }),
      error: null,
      writeError: null,
    });

    expect(screen.getByRole("region", { name: "연동" })).toHaveTextContent("실행 기록 없음");
  });

  /**
   * 두 카드는 `runResultLabels`처럼 문구만 맞추고 코드는 공유하지 않는다. 중복 경고의 뒷문장은 잡
   * 종류와 무관한 사실(데몬 우선순위·정리 시점)이라 두 카드가 글자까지 같아야 하고, 한쪽만 고치는
   * 실수를 막는 것은 두 카드를 함께 그리는 이 테스트뿐이다.
   */
  it("explains a duplicate with one resolution wording shared by both cards", () => {
    renderIntegrations({
      snapshot: snapshot({
        heartbeat: heartbeat({
          duplicateJobs: [{ name: "wf-developer", integration: "heartbeat", role: "developer" }],
        }),
        dream: dream({
          installation: "installed",
          duplicateJobs: [{ name: "dream-labs", integration: "dream", role: null }],
        }),
      }),
      error: null,
      writeError: null,
    });

    const shared =
      "이름이 같으면 데몬이 이 프로젝트의 잡 파일을 우선하고 옛 정의는 무시합니다. 이름이 다르면 둘 다 실행됩니다. 앱이 전환 전에 옛 파일에 써 둔 정의는 이 카드에서 한 번 저장하면 앱이 치웁니다. 손으로 적은 잡은 앱이 지우지 않으므로 직접 정리해야 합니다.";
    // 앞 문장은 잡 종류마다 다르므로 뒷문장을 담은 문단을 센다. 한쪽만 고치면 1로 떨어져 실패한다.
    const notes = screen.getAllByText(
      (_, element) =>
        element?.tagName === "P" && (element.textContent ?? "").endsWith(shared),
    );
    expect(notes).toHaveLength(2);
  });

  it("warns about a duplicate job outside the managed block", () => {
    renderIntegrations({
      snapshot: snapshot({
        heartbeat: heartbeat({
          duplicateJobs: [
            { name: "wf-developer", integration: "heartbeat", role: "developer" },
          ],
        }),
      }),
      error: null,
      writeError: null,
    });

    const card = screen.getByRole("region", { name: "연동" });
    // 감지가 블록 안팎을 가리지 않으므로 문구도 자리를 전제하지 않는다.
    expect(card).toHaveTextContent("이 프로젝트의 역할 잡이 옛 전역 파일에도 있습니다");
    expect(card).not.toHaveTextContent("관리 블록 밖에");
    expect(card).toHaveTextContent("wf-developer");
    expect(card).toHaveTextContent("NO_ELIGIBLE_WORK");
    // 데몬 우선순위와 정리 시점이 함께 들어 있다.
    expect(card).toHaveTextContent("데몬이 이 프로젝트의 잡 파일을 우선하고 옛 정의는 무시합니다");
    expect(card).toHaveTextContent("이 카드에서 한 번 저장하면 앱이 치웁니다");
    expect(card).toHaveTextContent("직접 정리해야 합니다");
  });

  it("says the integration is unsupported on this platform", () => {
    renderIntegrations({ snapshot: snapshot({ supported: false }), error: null, writeError: null });

    expect(screen.getByRole("region", { name: "연동" })).toHaveTextContent(
      "이 플랫폼에서는 연동을 지원하지 않습니다",
    );
    // 카드마다 반복하지 않고 뷰 공통 위치에서 한 번만 그린다.
    expect(screen.getAllByText("이 플랫폼에서는 연동을 지원하지 않습니다")).toHaveLength(1);

    // 문구는 앱이 아는 사실까지만 말한다. OS 이름과 구현 이름을 하드코딩하지 않는다(R5).
    const banner = screen.getByRole("region", { name: "연동" }).textContent ?? "";
    for (const forbidden of ["Windows", "macOS", "Linux", "POSIX", "sh 스크립트"]) {
      expect(banner).not.toContain(forbidden);
    }
  });

  /**
   * 자산이 플랫폼별로 갈린 뒤로 연동을 막을 이유가 없어 payload의 `supported`는 항상 참이다.
   * 분기 자체는 섹션 공통 계약이라 화면에 남아 있고, 이 테스트가 "참이면 배너가 없다"를 지킨다.
   */
  it("shows no platform banner while the integration is supported", () => {
    renderIntegrations({ snapshot: snapshot({ supported: true }), error: null, writeError: null });

    expect(screen.queryByText("이 플랫폼에서는 연동을 지원하지 않습니다")).toBeNull();
    expect(
      screen.getByRole("button", { name: "이 프로젝트에 역할 잡 설치" }),
    ).toBeEnabled();
  });

  it("keeps a failed status read inside the card", () => {
    renderIntegrations({ snapshot: null, error: "홈 디렉터리를 찾지 못했습니다", writeError: null });

    const card = screen.getByRole("region", { name: "연동" });
    expect(card).toHaveTextContent("상태를 읽을 수 없음");
    expect(card).toHaveTextContent("홈 디렉터리를 찾지 못했습니다");
    // 설정 화면에 얹혀 있던 시절에는 프로젝트 이름 카드가 남는지로 확인하던 자리다. 전용 뷰에서
    // "실패가 카드 안에 머문다"를 보이는 화면 요소는 뷰 자신의 제목이다.
    expect(screen.getByRole("heading", { name: "연동" })).toBeInTheDocument();
  });
});

describe("IntegrationsView 역할 잡 설치", () => {
  const installAction = { name: "이 프로젝트에 역할 잡 설치" };

  it("does not write before the confirmation step", () => {
    const onInstall = renderIntegrations(installed());

    fireEvent.click(screen.getByRole("button", installAction));

    expect(onInstall).not.toHaveBeenCalled();
  });

  it("shows both target paths and the change summary before writing", async () => {
    const onInstall = renderIntegrations(installed());

    fireEvent.click(screen.getByRole("button", installAction));

    const confirm = screen.getByRole("group", { name: "역할 잡 설치 확인" });
    // 화면이 손으로 적은 경로가 아니라 payload가 준 값을 그린다.
    expect(confirm).toHaveTextContent(jobsFilePath);
    expect(confirm).not.toHaveTextContent("~/.claude/HEARTBEAT.md");
    expect(confirm).toHaveTextContent("이 프로젝트 전용 파일입니다. 다른 프로젝트의 잡은 각자의 파일에 있습니다.");
    expect(confirm).toHaveTextContent(".workflow/rules/wf-eligible.sh");
    expect(confirm).toHaveTextContent("프로젝트 로컬 파일입니다");
    expect(confirm).toHaveTextContent("wf-planner-projects-workflow-labs");
    expect(confirm).toHaveTextContent("wf-architect-projects-workflow-labs");
    expect(confirm).toHaveTextContent("wf-developer-projects-workflow-labs");
    expect(confirm).toHaveTextContent("이 파일 전체를 앱이 다시 씁니다. 손으로 덧붙인 줄은 남지 않습니다. 다른 프로젝트의 잡은 이 파일에 들어올 수 없어 영향을 받지 않습니다.");

    fireEvent.click(screen.getByRole("button", { name: "확인하고 쓰기" }));

    await waitFor(() => expect(onInstall).toHaveBeenCalledTimes(1));
    // 아무 필드도 건드리지 않았으므로 세 값은 전부 미지정이다. 파일에 적힌 값이 이긴다.
    // 관리 블록에 잡이 없던 상태를 읽었으므로 기준값은 빈 목록이다.
    expect(onInstall).toHaveBeenCalledWith(
      [
        { role: "planner", enabled: true, interval: null, maxPer: null, model: null, timeout: null },
        { role: "architect", enabled: true, interval: null, maxPer: null, model: null, timeout: null },
        { role: "developer", enabled: true, interval: null, maxPer: null, model: null, timeout: null },
      ],
      [],
    );
  });

  // R1. 폼에 파일 값이 차 있어도 그것을 명시로 보내지 않는다. 보내지 않은 필드는 백엔드가 파일에서
  // 가져오므로, 화면이 값을 잘못 채운 상태에서 저장이 일어나도 편집값이 살아남는다.
  it("sends only the fields the user actually changed", async () => {
    const onInstall = renderIntegrations(
      installed([
        { role: "developer", interval: "20m", maxPer: "8/24h", model: "opus", timeout: "30m", appOwnedDrift: [] },
      ]),
    );

    fireEvent.change(screen.getByLabelText("개발자 주기"), { target: { value: "45m" } });
    fireEvent.click(screen.getByRole("button", { name: "역할 잡 변경 사항 저장" }));
    fireEvent.click(screen.getByRole("button", { name: "확인하고 쓰기" }));

    await waitFor(() => expect(onInstall).toHaveBeenCalledTimes(1));
    // R3. 시딩에 쓴 관리 블록 값이 그대로 기준값으로 실려 나간다.
    expect(onInstall).toHaveBeenCalledWith(
      [
        { role: "planner", enabled: false, interval: null, maxPer: null, model: null, timeout: null },
        { role: "architect", enabled: false, interval: null, maxPer: null, model: null, timeout: null },
        { role: "developer", enabled: true, interval: "45m", maxPer: null, model: null, timeout: null },
      ],
      [{ role: "developer", interval: "20m", maxPer: "8/24h", model: "opus", timeout: "30m", appOwnedDrift: [] }],
    );
  });

  it("sends a role turned off as disabled and says the edited values are lost", () => {
    const onInstall = renderIntegrations(
      installed([
        { role: "architect", interval: "30m", maxPer: "4/24h", model: "opus", timeout: "20m", appOwnedDrift: [] },
      ]),
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "프로젝트 아키텍트" }));

    const card = screen.getByRole("region", { name: "연동" });
    expect(card).toHaveTextContent("다시 켜면 기본값으로 시작합니다");

    fireEvent.click(screen.getByRole("button", { name: "역할 잡 변경 사항 저장" }));
    const confirm = screen.getByRole("group", { name: "역할 잡 설치 확인" });
    expect(confirm).toHaveTextContent("제거: wf-architect-projects-workflow-labs");

    expect(onInstall).not.toHaveBeenCalled();
  });

  // R4. 확인 화면은 쓰게 될 값을 나열하는 대신 파일의 현재 값과 함께 보여준다. 나열은 사용자가
  // 파일 값을 외우고 있을 때만 검증 수단이 된다.
  it("marks the changed field and leaves the other two as unchanged", () => {
    renderIntegrations(
      installed([
        { role: "developer", interval: "20m", maxPer: "8/24h", model: "opus", timeout: "30m", appOwnedDrift: [] },
      ]),
    );

    fireEvent.change(screen.getByLabelText("개발자 주기"), { target: { value: "45m" } });
    fireEvent.click(screen.getByRole("button", { name: "역할 잡 변경 사항 저장" }));

    const confirm = screen.getByRole("group", { name: "역할 잡 설치 확인" });
    expect(confirm).toHaveTextContent("주기 20m → 45m — 바뀜");
    expect(confirm).toHaveTextContent("실행 한도 8/24h — 그대로");
    expect(confirm).toHaveTextContent("모델 opus — 그대로");
  });

  it("says the managed block does not change when nothing was edited", () => {
    renderIntegrations(
      installed([
        { role: "developer", interval: "20m", maxPer: "6/24h", model: "opus", timeout: "30m", appOwnedDrift: [] },
      ]),
    );

    fireEvent.click(screen.getByRole("button", { name: "역할 잡 변경 사항 저장" }));

    expect(screen.getByRole("group", { name: "역할 잡 설치 확인" })).toHaveTextContent(
      "관리 블록에서 달라지는 값이 없습니다",
    );
  });

  it("marks a role missing from the managed block as newly added", () => {
    renderIntegrations(
      installed([
        { role: "developer", interval: "20m", maxPer: "6/24h", model: "opus", timeout: "30m", appOwnedDrift: [] },
      ]),
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "기획자" }));
    fireEvent.click(screen.getByRole("button", { name: "역할 잡 변경 사항 저장" }));

    const confirm = screen.getByRole("group", { name: "역할 잡 설치 확인" });
    expect(confirm).toHaveTextContent(
      "wf-planner-projects-workflow-labs — 관리 블록에 없던 잡입니다. 새로 추가됩니다.",
    );
    expect(confirm).toHaveTextContent("주기 없음 → 30m — 바뀜");
  });

  /** R4. 값 자체는 보여주지 않는다. 요구는 되돌아간다는 사실과 그 대상이다. */
  it("names the app owned fields that go back to the app value", () => {
    renderIntegrations(
      installed([
        {
          role: "developer",
          interval: "20m",
          maxPer: "6/24h",
          model: "opus",
          timeout: "30m",
          appOwnedDrift: ["notify"],
        },
      ]),
    );

    fireEvent.click(screen.getByRole("button", { name: "역할 잡 변경 사항 저장" }));

    const confirm = screen.getByRole("group", { name: "역할 잡 설치 확인" });
    expect(confirm).toHaveTextContent("되돌아감: notify");
    expect(confirm).toHaveTextContent("앱 값으로 다시 쓰입니다");
  });

  it("shows the values that disappear with the role turned off", () => {
    renderIntegrations(
      installed([
        { role: "architect", interval: "30m", maxPer: "4/24h", model: "opus", timeout: "20m", appOwnedDrift: [] },
      ]),
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "프로젝트 아키텍트" }));
    fireEvent.click(screen.getByRole("button", { name: "역할 잡 변경 사항 저장" }));

    const confirm = screen.getByRole("group", { name: "역할 잡 설치 확인" });
    expect(confirm).toHaveTextContent("제거: wf-architect-projects-workflow-labs");
    expect(confirm).toHaveTextContent("주기 30m · 실행 한도 4/24h · 모델 opus · 시간 초과 20m 값이 함께 사라집니다");
    // 활성 역할이 하나도 남지 않으면 블록이 아니라 이 프로젝트의 잡 파일이 사라진다.
    expect(confirm).toHaveTextContent("활성 역할이 없어 이 프로젝트의 잡 파일을 지웁니다");
  });

  // 이 목록에 있던 ["개발자 모델", "claude opus", ...] 행은 아래 "모델 선택" describe의
  // "reports an invalid directly entered model ..." 로 옮겼다. 선택 컨트롤에는 목록 밖 문자열을
  // 넣을 수 없으므로, 잘못된 model 값이 도달할 수 있는 경로가 직접 입력 칸으로 바뀌었다.
  it.each([
    ["개발자 주기", "30분", "숫자 뒤에 s, m, h, d 중 하나를 붙여 주세요"],
    ["개발자 실행 한도 값", "4회", "<횟수>/<기간> 형태로 적어 주세요"],
  ])("reports %s at its own input and writes nothing", (label, value, reason) => {
    const onInstall = renderIntegrations(installed());

    fireEvent.change(screen.getByLabelText(label), { target: { value } });
    fireEvent.click(screen.getByRole("button", installAction));

    const input = screen.getByLabelText(label);
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(document.getElementById(input.getAttribute("aria-describedby") ?? "")).toHaveTextContent(
      reason,
    );
    expect(screen.queryByRole("group", { name: "역할 잡 설치 확인" })).not.toBeInTheDocument();
    expect(onInstall).not.toHaveBeenCalled();
  });

  it("disables the install action on an unsupported platform", () => {
    renderIntegrations({
      snapshot: snapshot({ supported: false }),
      error: null,
      writeError: null,
    });

    expect(screen.getByRole("button", installAction)).toBeDisabled();
  });

  it("hides the install action while heartbeat itself is missing", () => {
    renderIntegrations({
      snapshot: snapshot({
        heartbeat: heartbeat({ installation: "not_installed", daemonRunning: false }),
      }),
      error: null,
      writeError: null,
    });

    expect(screen.queryByRole("button", installAction)).not.toBeInTheDocument();
  });

  it("keeps a failed write visible with the reason", () => {
    renderIntegrations({
      snapshot: snapshot(),
      error: null,
      writeError: {
        integration: "heartbeat",
        message: "~/.claude/HEARTBEAT.md의 앱 관리 블록 마커가 손상되어 파일을 쓰지 않았습니다.",
      },
    });

    const card = screen.getByRole("region", { name: "연동" });
    expect(card).toHaveTextContent("역할 잡을 쓰지 못했습니다");
    expect(card).toHaveTextContent("마커가 손상되어 파일을 쓰지 않았습니다");
  });

  // 한 연동의 실패 문구가 다른 연동 카드에 나타나면 사용자가 해야 할 일을 잘못 읽는다.
  it("shows a failed write only in the card that asked for it", () => {
    renderIntegrations({
      snapshot: snapshot(),
      error: null,
      writeError: { integration: "dream", message: "dream 쓰기 실패" },
    });

    expect(screen.getByRole("article", { name: "claude-heartbeat" })).not.toHaveTextContent(
      "역할 잡을 쓰지 못했습니다",
    );
  });

  it("explains why the default interval is not shorter", () => {
    renderIntegrations(installed());

    expect(screen.getByRole("region", { name: "연동" })).toHaveTextContent(
      "조건 검사만 반복되고 중복 기동 위험만 늘어납니다",
    );
  });

  // R4. 두 연동은 관리 블록을 공유하지만 폼은 서로 독립이다. 한쪽 편집이 다른 쪽 입력을 되돌리면
  // 사용자는 저장 한 번에 다른 잡의 값을 잃는다.
  it("keeps the role job form untouched while the dream job is edited", async () => {
    renderIntegrations({
      snapshot: snapshot({
        heartbeat: heartbeat({
          managedJobs: [
            { role: "developer", interval: "20m", maxPer: "6/24h", model: "opus", timeout: "30m", appOwnedDrift: [] },
          ],
        }),
        dream: dream({
          installation: "installed",
          managedJob: { interval: "2h", maxPer: "6/24h", model: "opus", timeout: "30m", appOwnedDrift: [] },
        }),
      }),
      error: null,
      writeError: null,
    });

    await userEvent.clear(screen.getByLabelText("dream 정제 주기"));
    await userEvent.type(screen.getByLabelText("dream 정제 주기"), "6h");
    await userEvent.click(screen.getByLabelText("dream 정제"));

    expect(screen.getByLabelText("개발자 주기")).toHaveValue("20m");
    expect(screen.getByLabelText("개발자 실행 한도 값")).toHaveValue("6/24h");
    expect(screen.getByLabelText("dream 정제 주기")).toHaveValue("6h");
  });
});

// R5. 기본값으로 되돌리는 것은 정당한 요구다. 그것을 저장의 부작용으로 두면 정당한 요구와 사고를
// 구별할 수 없다. 명시적 액션으로 두면 둘 다 표현할 수 있다.
describe("IntegrationsView 역할 잡 기본값 재설정", () => {
  const resetAction = { name: "개발자 기본값으로 재설정" };
  const confirmReset = { name: "확인하고 되돌리기" };

  const edited = (overrides: Partial<ManagedRoleJob> = {}): ManagedRoleJob => ({
    role: "developer",
    interval: "45m",
    maxPer: "16/24h",
    model: "sonnet",
    timeout: "30m",
    appOwnedDrift: [],
    ...overrides,
  });

  it("offers the action only for a job written in the managed block", () => {
    renderIntegrations(installed([edited()]));

    expect(screen.getByRole("button", resetAction)).toBeInTheDocument();
    // 되돌릴 파일 값이 없는 잡이다. 폼은 이미 기본값에서 시작한다.
    expect(
      screen.queryByRole("button", { name: "기획자 기본값으로 재설정" }),
    ).not.toBeInTheDocument();
  });

  it("does not write before the confirmation step", () => {
    const onInstall = renderIntegrations(installed([edited()]));

    fireEvent.click(screen.getByRole("button", resetAction));

    expect(onInstall).not.toHaveBeenCalled();
    expect(screen.getByRole("group", { name: "개발자 기본값 재설정 확인" })).toBeInTheDocument();
  });

  it("shows the difference between the file values and the app defaults", () => {
    renderIntegrations(installed([edited()]));

    fireEvent.click(screen.getByRole("button", resetAction));

    const confirm = screen.getByRole("group", { name: "개발자 기본값 재설정 확인" });
    expect(confirm).toHaveTextContent("주기 45m → 20m — 바뀜");
    expect(confirm).toHaveTextContent("실행 한도 16/24h → 6/24h — 바뀜");
    expect(confirm).toHaveTextContent("모델 sonnet → opus — 바뀜");
    expect(confirm).toHaveTextContent(jobsFilePath);
    expect(confirm).not.toHaveTextContent("~/.claude/HEARTBEAT.md");
    expect(confirm).toHaveTextContent("잡의 활성·비활성 상태와 이 파일의 다른 잡은 그대로 둡니다. 다른 프로젝트의 잡은 이 파일에 들어올 수 없어 영향을 받지 않습니다.");
  });

  it("says nothing changes for a job already at the app defaults", () => {
    renderIntegrations(
      installed([
        { role: "developer", interval: "20m", maxPer: "6/24h", model: "opus", timeout: "30m", appOwnedDrift: [] },
      ]),
    );

    fireEvent.click(screen.getByRole("button", resetAction));

    expect(screen.getByRole("group", { name: "개발자 기본값 재설정 확인" })).toHaveTextContent(
      "관리 블록에서 달라지는 값이 없습니다",
    );
  });

  // R5. 재설정은 그 잡 하나에만 적용된다. 나머지 잡을 미지정으로 두어야 백엔드가 파일 값을 그대로
  // 다시 쓴다. 화면이 다른 잡의 값을 실어 보내면 이 기획서가 없애려는 패턴 그대로다.
  it("specifies the defaults for the target job and leaves the others unspecified", async () => {
    const onInstall = renderIntegrations(
      installed([
        edited(),
        { role: "planner", interval: "35m", maxPer: "9/24h", model: "haiku", timeout: "20m", appOwnedDrift: [] },
      ]),
    );

    fireEvent.click(screen.getByRole("button", resetAction));
    fireEvent.click(screen.getByRole("button", confirmReset));

    await waitFor(() => expect(onInstall).toHaveBeenCalledTimes(1));
    expect(onInstall).toHaveBeenCalledWith(
      [
        { role: "planner", enabled: true, interval: null, maxPer: null, model: null, timeout: null },
        { role: "architect", enabled: false, interval: null, maxPer: null, model: null, timeout: null },
        {
          role: "developer",
          enabled: true,
          interval: "20m",
          maxPer: { kind: "limit", value: "6/24h" },
          model: "opus",
          timeout: "30m",
        },
      ],
      [
        edited(),
        { role: "planner", interval: "35m", maxPer: "9/24h", model: "haiku", timeout: "20m", appOwnedDrift: [] },
      ],
    );
  });

  // 기획서 완료 조건 12. 재설정은 편집 가능 값만 되돌린다. 폼의 토글을 바꿔 둔 상태에서 눌러도
  // 관리 블록의 잡 목록이 그대로여야 한다.
  it("sends the enabled state of the file, not the one of the form", async () => {
    const onInstall = renderIntegrations(installed([edited()]));

    // 파일에 없는 역할을 켜고, 파일에 있는 대상 역할을 끈다. 둘 다 폼에서만 일어난 일이다.
    fireEvent.click(screen.getByRole("checkbox", { name: "기획자" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "개발자" }));
    fireEvent.click(screen.getByRole("button", resetAction));
    fireEvent.click(screen.getByRole("button", confirmReset));

    await waitFor(() => expect(onInstall).toHaveBeenCalledTimes(1));
    expect(onInstall.mock.calls[0][0]).toEqual([
      { role: "planner", enabled: false, interval: null, maxPer: null, model: null, timeout: null },
      { role: "architect", enabled: false, interval: null, maxPer: null, model: null, timeout: null },
      {
          role: "developer",
          enabled: true,
          interval: "20m",
          maxPer: { kind: "limit", value: "6/24h" },
          model: "opus",
          timeout: "30m",
        },
    ]);
  });

  // 저장의 부작용으로 일어나서는 안 되는 것이 이 액션의 요점이다. 반대 방향도 같다.
  it("leaves the save action untouched", async () => {
    const onInstall = renderIntegrations(installed([edited()]));

    fireEvent.click(screen.getByRole("button", { name: "역할 잡 변경 사항 저장" }));
    expect(
      screen.queryByRole("group", { name: "개발자 기본값 재설정 확인" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "확인하고 쓰기" }));

    await waitFor(() => expect(onInstall).toHaveBeenCalledTimes(1));
    expect(onInstall.mock.calls[0][0]).toEqual([
      { role: "planner", enabled: false, interval: null, maxPer: null, model: null, timeout: null },
      { role: "architect", enabled: false, interval: null, maxPer: null, model: null, timeout: null },
      { role: "developer", enabled: true, interval: null, maxPer: null, model: null, timeout: null },
    ]);
  });

  it("cancels without writing anything", () => {
    const onInstall = renderIntegrations(installed([edited()]));

    fireEvent.click(screen.getByRole("button", resetAction));
    fireEvent.click(screen.getByRole("button", { name: "취소" }));

    expect(
      screen.queryByRole("group", { name: "개발자 기본값 재설정 확인" }),
    ).not.toBeInTheDocument();
    expect(onInstall).not.toHaveBeenCalled();
  });

  it("disables the action on an unsupported platform", () => {
    renderIntegrations({
      snapshot: snapshot({ heartbeat: heartbeat({ managedJobs: [edited()] }), supported: false }),
      error: null,
      writeError: null,
    });

    expect(screen.getByRole("button", resetAction)).toBeDisabled();
  });
});

// R2. 잡 파일을 읽지 못한 상태는 "그 파일에 잡이 없다"와 다른 상태다. 두 상태가 같아 보이면
// 사용자는 기본값이 찬 폼을 파일의 값으로 읽고, 그대로 저장하면 앱이 모르는 값을 덮어쓴다.
describe("IntegrationsView 관리 블록 읽기 실패", () => {
  // 읽지 못한 파일은 앱이 이 프로젝트의 잡을 두는 파일이다(SPEC-024 R2).
  const failure = {
    path: jobsFilePath,
    message: "Permission denied (os error 13)",
  };

  function unreadable(): IntegrationsState {
    return {
      snapshot: snapshot({ managedBlockFailure: failure }),
      error: null,
      writeError: null,
    };
  }

  it("hides the role job form and blocks the save", () => {
    const onInstall = renderIntegrations(unreadable());

    expect(screen.queryByLabelText("개발자 주기")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("개발자 실행 한도")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("개발자 모델")).not.toBeInTheDocument();

    const save = screen.getByRole("button", { name: "역할 잡 저장" });
    expect(save).toBeDisabled();
    fireEvent.click(save);

    expect(screen.queryByRole("group", { name: "역할 잡 설치 확인" })).not.toBeInTheDocument();
    expect(onInstall).not.toHaveBeenCalled();
  });

  it("states the target path and the reason", () => {
    renderIntegrations(unreadable());

    const card = screen.getByRole("article", { name: "claude-heartbeat" });
    expect(card).toHaveTextContent("관리 블록을 읽지 못했습니다");
    expect(card).toHaveTextContent(failure.path);
    expect(card).toHaveTextContent(failure.message);
    expect(card).toHaveTextContent("앱이 모르는 값을 덮어쓰지 않도록 저장을 막았습니다");
  });

  it("tells the unreadable state apart from a block without role jobs", () => {
    renderIntegrations(installed());
    const withoutJobs = screen.getByRole("article", { name: "claude-heartbeat" }).textContent ?? "";
    cleanup();

    renderIntegrations(unreadable());
    const unread = screen.getByRole("article", { name: "claude-heartbeat" }).textContent ?? "";

    expect(withoutJobs).toContain("역할 잡 미설치");
    expect(withoutJobs).not.toContain("관리 블록을 읽지 못했습니다");
    expect(unread).toContain("관리 블록을 읽지 못했습니다");
    expect(unread).not.toContain("역할 잡 미설치");
  });
});

/**
 * SPEC-024 R4. 잡 파일에는 정의가 있는데 데몬이 집었다는 증거가 없는 상태.
 *
 * 증거는 `state.json`에서 온 `lastRun`이고 새 백엔드 값이 아니다. 화면이 "관리 잡 목록에 있다"와
 * "실행 기록이 없다" 두 사실을 겹쳐 이 상태를 만든다.
 */
describe("IntegrationsView 잡 파일에만 있는 잡", () => {
  const noRunTitle = "하트비트가 이 잡을 실행한 기록이 없습니다";

  /** 개발자 잡만 파일에 있고 세 역할 모두 실행 기록이 없는 상태. */
  function neverRan(overrides: Partial<HeartbeatIntegration> = {}): IntegrationsState {
    return {
      snapshot: snapshot({
        heartbeat: heartbeat({ managedJobs: [developerJob], roles: roleStatuses(), ...overrides }),
      }),
      error: null,
      writeError: null,
    };
  }

  it("names the state and both of its possible causes", () => {
    renderIntegrations(neverRan());

    const shown = within(jobRow("개발자")).getByText(noRunTitle).closest(".integration-warning");
    expect(shown).toBeVisible();
    // 사실 하나와 가능성 둘. 원인을 단정하지 않는다.
    expect(shown).toHaveTextContent("잡 파일에는 이 잡의 정의가 있는데 하트비트가 실행한 기록이 없습니다");
    expect(shown).toHaveTextContent("아직 첫 주기가 오지 않았을 수도 있고");
    expect(shown).toHaveTextContent("프로젝트별 잡 파일을 읽지 못하는 버전일 수도 있습니다");
    // 앱이 데몬 버전을 판정하지 않는다는 사실을 숨기지 않는다(확인 필요 3번의 대안 A는 부결).
    expect(shown).toHaveTextContent("앱은 하트비트 버전을 판정하지 않으므로");
    expect(shown).toHaveTextContent("하트비트를 갱신하세요");
  });

  it("leaves the jobs that are not in the file alone", () => {
    renderIntegrations(neverRan());

    // 파일에 없는 잡이 안 도는 것은 정상이라 알릴 것이 없다.
    expect(within(jobRow("기획자")).queryByText(noRunTitle)).toBeNull();
    expect(within(jobRow("프로젝트 아키텍트")).queryByText(noRunTitle)).toBeNull();
    expect(screen.getAllByText(noRunTitle)).toHaveLength(1);
  });

  it("drops the notice once the daemon has run the job", () => {
    renderIntegrations({
      snapshot: snapshot({
        heartbeat: heartbeat({
          managedJobs: [developerJob],
          roles: roleStatuses({ developer: ranOnce }),
        }),
      }),
      error: null,
      writeError: null,
    });

    expect(screen.queryByText(noRunTitle)).toBeNull();
    expect(within(jobRow("개발자")).getByText("성공")).toBeVisible();
  });

  it("stays quiet while the heartbeat is not installed", () => {
    // 잡 목록을 일부러 비우지 않는다. 비어 있으면 판정이 아니라 빈 목록 때문에 조용해진다.
    renderIntegrations(neverRan({ installation: "not_installed" }));

    expect(screen.queryByText(noRunTitle)).toBeNull();
  });

  it("stays quiet while the jobs file could not be read", () => {
    renderIntegrations({
      snapshot: snapshot({
        managedBlockFailure: { path: jobsFilePath, message: "Permission denied (os error 13)" },
        heartbeat: heartbeat({ managedJobs: [developerJob], roles: roleStatuses() }),
      }),
      error: null,
      writeError: null,
    });

    // 그 상태는 카드가 이미 다른 문구로 말한다. 같은 원인을 두 이름으로 부르면 별개의 문제로 읽힌다.
    expect(screen.queryByText(noRunTitle)).toBeNull();
    expect(screen.getByRole("article", { name: "claude-heartbeat" })).toHaveTextContent(
      "관리 블록을 읽지 못했습니다",
    );
  });

  it("blocks neither the save nor the reset", () => {
    renderIntegrations(neverRan());

    // 확인 필요 3번은 "막지 않고 알린다"로 승인됐다. 대안 A(저장 차단)는 부결됐다.
    expect(screen.getByRole("button", { name: "역할 잡 변경 사항 저장" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "개발자 기본값으로 재설정" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "역할 잡 변경 사항 저장" }));
    expect(screen.getByRole("group", { name: "역할 잡 설치 확인" })).toBeVisible();
  });

  it("marks the collapsed summary so the warning is not hidden by the fold", () => {
    renderIntegrations(neverRan(), undefined, { expand: false });

    const card = screen.getByRole("article", { name: "claude-heartbeat" });
    expect(within(card).getByText("확인할 경고가 있습니다")).toBeVisible();
  });

  it("shares one wording with the dream card", () => {
    renderIntegrations({
      snapshot: snapshot({
        heartbeat: heartbeat({ managedJobs: [developerJob], roles: roleStatuses() }),
        dream: dream({
          installation: "installed",
          managedJob: { interval: "2h", maxPer: "6/24h", model: "opus", timeout: "30m", appOwnedDrift: [] },
        }),
      }),
      error: null,
      writeError: null,
    });

    // 두 카드가 같은 사실을 다른 말로 부르면 사용자가 잡 종류마다 다른 규칙이 있다고 읽는다.
    expect(screen.getAllByText(noRunTitle)).toHaveLength(2);
    expect(
      screen.getAllByText(/잡 파일에는 이 잡의 정의가 있는데 하트비트가 실행한 기록이 없습니다/),
    ).toHaveLength(2);
  });
});

/**
 * SPEC-034. 084 경고가 "하트비트를 갱신하세요"로 끝나던 자리에서 그 갱신 방법까지 읽는다.
 *
 * 안내가 뜨는 조건은 084 경고의 조건 그대로다. 표시 조건을 새로 만들지 않는 것이 승인된 확인 필요
 * 4번이고, 그래서 이 시나리오들은 084 시나리오와 같은 픽스처 위에 선다.
 */
describe("IntegrationsView 갱신 안내", () => {
  const guideTitle = "하트비트를 갱신하는 방법";
  const principle = "설치한 방법 그대로 갱신합니다";
  /** 084 경고의 제목. 안내가 그 경고 안에 있다는 것을 이 제목으로 확인한다. */
  const warningTitle = "하트비트가 이 잡을 실행한 기록이 없습니다";

  /** 갱신 안내의 명령 원문 다섯. 화면이 조립하면 이 값이 그대로 나올 수 없다. */
  const commands = [
    updateGuide.identifyCommand,
    updateGuide.packageCommand,
    updateGuide.sourceCommand,
    updateGuide.serviceLookupCommand,
    updateGuide.serviceRestartCommand,
  ];

  const plannerJob: ManagedRoleJob = {
    role: "planner",
    interval: "30m",
    maxPer: "4/24h",
    model: "opus",
    timeout: "20m",
    appOwnedDrift: [],
  };

  /** 084 경고가 뜬 상태. 개발자 잡만 파일에 있고 실행 기록이 없다. */
  function warned(
    overrides: Partial<HeartbeatIntegration> = {},
    snapshotOverrides: Partial<IntegrationsSnapshot> = {},
  ): IntegrationsState {
    return {
      snapshot: snapshot({
        heartbeat: heartbeat({ managedJobs: [developerJob], roles: roleStatuses(), ...overrides }),
        ...snapshotOverrides,
      }),
      error: null,
      writeError: null,
    };
  }

  /** 안내 하나의 DOM. 역할 잡 행 안에서 고르므로 다른 역할의 안내와 섞이지 않는다. */
  function guideIn(label: string) {
    return within(jobRow(label)).getByText(guideTitle).closest(".heartbeat-update-guide") as HTMLElement;
  }

  beforeEach(() => {
    clipboard.copy.mockReset();
    clipboard.copy.mockResolvedValue(true);
  });

  // 완료 조건 1. 다른 탭이나 외부 문서로 보내지 않는다.
  it("puts the update steps inside the very warning that asks for the update", () => {
    renderIntegrations(warned());

    const warning = within(jobRow("개발자")).getByText(warningTitle).closest(
      ".integration-warning",
    ) as HTMLElement;
    expect(within(warning).getByText(guideTitle)).toBeVisible();
    expect(warning).toHaveTextContent(principle);
    // 084 문구가 그대로 남고 안내가 그 뒤에 온다. 원인을 단정하는 문장이 새로 생기지 않는다.
    expect(warning).toHaveTextContent("앱은 하트비트 버전을 판정하지 않으므로");
    expect(warning).not.toHaveTextContent("업데이트가 필요합니다");
  });

  // 완료 조건 9·승인된 확인 필요 4번. 상시 표시가 아니다.
  it("stays out of sight wherever the warning itself is out of sight", () => {
    const quiet: [string, IntegrationsState][] = [
      [
        "실행 기록이 있는 잡",
        warned({ roles: roleStatuses({ developer: ranOnce }) }),
      ],
      ["잡이 꺼진 역할", warned({ managedJobs: [] })],
      ["미설치", warned({ installation: "not_installed" })],
      [
        "잡 파일 읽기 실패",
        warned({}, { managedBlockFailure: { path: jobsFilePath, message: "Permission denied" } }),
      ],
    ];

    for (const [name, state] of quiet) {
      renderIntegrations(state);
      expect(screen.queryByText(guideTitle), name).toBeNull();
      expect(screen.queryByText(updateGuide.packageCommand), name).toBeNull();
      cleanup();
    }
  });

  // 완료 조건 5·6. 갈래 판별·pip·소스·재시작 넷이 모두 있고, 원문은 payload 값 그대로다.
  it("shows every command the payload carries and assembles none of them", () => {
    renderIntegrations(warned());

    const guide = guideIn("개발자");
    for (const command of commands) {
      expect(within(guide).getByText(command as string)).toBeVisible();
    }
    // 명령 하나로 단정하지 않는다. 갈래를 고르는 방법이 그 앞에 온다.
    expect(guide).toHaveTextContent("Editable project location 줄이 있으면 소스 체크아웃");
    expect(guide).toHaveTextContent("pip으로 설치했다면");
    expect(guide).toHaveTextContent("소스 체크아웃으로 설치했다면");
    // R4. 재시작이 필요한 이유가 함께 있다.
    expect(guide).toHaveTextContent("이미 돌고 있는 프로세스는 갱신 전 코드를 그대로 들고 있어서");
  });

  // 완료 조건 2. 걸음마다 복사 수단이 있고 원문 그대로 넘어간다.
  it("copies each command exactly as it arrived", async () => {
    renderIntegrations(warned());

    const guide = guideIn("개발자");
    const buttons = within(guide).getAllByRole("button", { name: /명령 복사$/ });
    expect(buttons).toHaveLength(commands.length);

    for (const [index, button] of buttons.entries()) {
      await userEvent.click(button);
      expect(clipboard.copy).toHaveBeenNthCalledWith(index + 1, commands[index]);
    }
    // 마지막으로 복사한 명령 하나만 표시한다. 마법사와 같은 어법이다.
    expect(within(guide).getAllByText("복사됨")).toHaveLength(1);
  });

  // 완료 조건 2. 복사에 실패해도 원문은 화면에 남는다.
  it("keeps the command on screen when the copy fails", async () => {
    clipboard.copy.mockResolvedValue(false);
    renderIntegrations(warned());

    const guide = guideIn("개발자");
    await userEvent.click(
      within(guide).getByRole("button", { name: "pip 설치 갱신 명령 복사" }),
    );

    expect(
      within(guide).getByText("복사하지 못했습니다 — 위 명령을 직접 선택해 복사하세요."),
    ).toBeVisible();
    expect(within(guide).getByText(updateGuide.packageCommand)).toBeVisible();
  });

  // 완료 조건 4·7. 앱이 모르는 것을 지어내지 않는다.
  it("says it does not know how to restart instead of inventing a command", () => {
    renderIntegrations(
      warned({}, {
        updateGuide: { ...updateGuide, serviceLookupCommand: null, serviceRestartCommand: null },
      }),
    );

    const guide = guideIn("개발자");
    expect(guide).toHaveTextContent("이 플랫폼에서 하트비트를 재시작하는 방법을 알지 못합니다");
    // 재시작 명령 자리에 지어낸 값이 오지 않는다. 라벨도 launchctl도 화면에 없다.
    expect(within(guide).queryByText(updateGuide.serviceLookupCommand as string)).toBeNull();
    expect(within(guide).queryByText(updateGuide.serviceRestartCommand as string)).toBeNull();
    expect(guide.textContent).not.toContain("<라벨>");
    expect(guide.textContent).not.toContain("launchctl");
    // 재시작이 필요하다는 사실 자체는 플랫폼과 무관하게 남는다.
    expect(guide).toHaveTextContent("갱신한 뒤에는 하트비트를 재시작합니다");
  });

  /**
   * 경고가 역할별이라 한 화면에 안내가 여럿 뜬다. 복사 결과를 카드가 들면 한 번의 복사가 모든
   * 자리에 "복사됨"을 띄운다. 인스턴스가 각자 들면 그 분리가 구조로 보장된다.
   */
  it("keeps one guide's copy result out of the other's", async () => {
    renderIntegrations(warned({ managedJobs: [developerJob, plannerJob] }));

    await userEvent.click(
      within(guideIn("개발자")).getByRole("button", { name: "pip 설치 갱신 명령 복사" }),
    );

    expect(within(guideIn("개발자")).getByText("복사됨")).toBeVisible();
    expect(within(guideIn("기획자")).queryByText("복사됨")).toBeNull();
  });

  // 완료 조건 8. 갱신을 실행하는 버튼이 없다.
  it("adds copy buttons and nothing else", () => {
    renderIntegrations(warned());

    const guide = guideIn("개발자");
    const buttons = within(guide).getAllByRole("button");
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "설치 갈래 확인 명령 복사",
      "pip 설치 갱신 명령 복사",
      "소스 체크아웃 갱신 명령 복사",
      "서비스 라벨 확인 명령 복사",
      "하트비트 재시작 명령 복사",
    ]);
    for (const button of buttons) {
      expect(button.textContent).toBe("명령 복사");
      expect(button.getAttribute("aria-label")).not.toContain("실행");
    }
  });

  // 완료 조건 12. 안내가 어떤 버튼도 비활성화하지 않는다(R8).
  it("disables no button that the warning left enabled", () => {
    renderIntegrations(warned());

    expect(screen.getByRole("button", { name: "역할 잡 변경 사항 저장" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "개발자 기본값으로 재설정" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "개발자 잡 지금 실행" })).toBeEnabled();
  });
});

/** SPEC-009 R1~R5의 하트비트 카드 몫. */
describe("IntegrationsView 실행 한도 사용량", () => {
  const warningTitle = "개발자 잡이 대기 중인 일을 처리하지 못하고 있습니다";

  /** 화면이 회복 시각을 로컬로 바꾸는 방식. 테스트가 실행 환경의 타임존을 고정하지 않는다. */
  function localOf(value: string) {
    return new Intl.DateTimeFormat("ko-KR", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  }

  it("puts the usage beside the last run of a managed job", () => {
    renderIntegrations(
      quotaState(
        {
          developer: {
            kind: "counted",
            used: 3,
            limit: 24,
            window: "24h",
            exhausted: false,
            recoversAt: null,
          },
        },
        { runs: { developer: { at: "2026-08-03 05:00:00", result: "success", durationSeconds: 12 } } },
      ),
    );

    const row = jobRow("개발자");
    expect(within(row).getByText("3/24 · 24h 기준")).toBeVisible();
    // 사용량은 실행 기록을 대체하지 않는다.
    expect(within(row).getByText("성공")).toBeVisible();
    expect(within(row).getByText("2026-08-03 05:00:00 (로컬 시각)")).toBeVisible();
  });

  it("takes the limit from the managed block instead of the app default", () => {
    renderIntegrations(
      quotaState({
        developer: {
          kind: "counted",
          used: 3,
          limit: 24,
          window: "24h",
          exhausted: false,
          recoversAt: null,
        },
      }),
    );

    const row = jobRow("개발자");
    expect(within(row).getByText("3/24 · 24h 기준")).toBeVisible();
    // 앱 기본값은 6/24h다. 그 값으로 계산한 표시가 있으면 안 된다.
    expect(row).not.toHaveTextContent("3/6 ·");
  });

  it("marks an exhausted job and estimates the recovery in local time", () => {
    renderIntegrations(quotaState({ developer: exhaustedQuota }));

    const row = jobRow("개발자");
    expect(within(row).getByText("24/24 · 24h 기준")).toBeVisible();
    expect(within(row).getByText("실행 한도 도달")).toBeVisible();
    expect(
      within(row).getByText(`${localOf(exhaustedQuota.recoversAt as string)}에 1회 여유 (예상)`),
    ).toBeVisible();
  });

  it("warns only while the exhausted job has work waiting", () => {
    renderIntegrations(quotaState({ developer: exhaustedQuota }), undefined, {
      pendingWork: waitingFor("developer"),
    });
    expect(screen.getByText(warningTitle)).toBeVisible();
    cleanup();

    renderIntegrations(quotaState({ developer: exhaustedQuota }));
    // 대기 물량이 없으면 소진은 사실 표시에 그친다.
    expect(screen.queryByText(warningTitle)).toBeNull();
    expect(screen.getByText("실행 한도 도달")).toBeVisible();
  });

  it("names what waits, why it stalls, when it clears and where to raise the limit", () => {
    renderIntegrations(quotaState({ developer: exhaustedQuota }), undefined, {
      pendingWork: waitingFor("developer"),
    });

    const warning = jobRow("개발자").querySelector(".integration-warning") as HTMLElement;
    expect(warning).toHaveTextContent("구현할 todo 작업이");
    expect(warning).toHaveTextContent("조건 검사 전에 이 잡을 건너뜁니다");
    expect(warning).toHaveTextContent(`${localOf(exhaustedQuota.recoversAt as string)}에 1회 여유 (예상)`);
    expect(warning).toHaveTextContent("실행 한도 칸에서 한도를 올리고");
    expect(warning).toHaveTextContent("저장 버튼");
    // 어느 문서가 밀려 있는지는 열거하지 않는다(기획서 제외 범위).
    expect(warning).not.toHaveTextContent("TASK-");
  });

  it("does not read quota_skipped as evidence that work is waiting", () => {
    renderIntegrations(
      quotaState(
        { developer: exhaustedQuota },
        {
          runs: {
            developer: { at: "2026-08-03 05:00:00", result: "quota_skipped", durationSeconds: 0 },
          },
        },
      ),
    );

    const row = jobRow("개발자");
    expect(within(row).getByText("건너뜀 · 실행 한도 도달")).toBeVisible();
    expect(row.querySelector(".integration-warning")).toBeNull();
  });

  it("stays quiet while the pending work is unknown", () => {
    renderIntegrations(quotaState({ developer: exhaustedQuota }), undefined, {
      pendingWork: null,
    });

    expect(jobRow("개발자").querySelector(".integration-warning")).toBeNull();
    expect(screen.getByText("실행 한도 도달")).toBeVisible();
  });

  // 마이그레이션 락에서 백엔드가 만드는 값이다. 화면에 락 분기를 따로 두지 않아도 경고가 사라진다.
  it("drops every warning when no role has work waiting", () => {
    renderIntegrations(
      quotaState(
        { planner: exhaustedQuota, architect: exhaustedQuota, developer: exhaustedQuota },
        {
          managedJobs: [
            { role: "planner", interval: "30m", maxPer: "8/24h", model: "opus", timeout: "20m", appOwnedDrift: [] },
            { role: "architect", interval: "30m", maxPer: "8/24h", model: "opus", timeout: "20m", appOwnedDrift: [] },
            developerJob,
          ],
          // 세 잡이 모두 소진 상태이므로 셋 다 돌았다. 기본값은 개발자 잡 하나만 채운다.
          runs: { planner: ranOnce, architect: ranOnce, developer: ranOnce },
        },
      ),
    );

    const card = screen.getByRole("article", { name: "claude-heartbeat" });
    expect(card.querySelectorAll(".integration-warning")).toHaveLength(0);
    expect(card.querySelectorAll(".heartbeat-job-quota")).toHaveLength(3);
  });

  it("says there is no run record instead of counting it as zero", () => {
    renderIntegrations(quotaState({ developer: { kind: "noRuns", limit: 24, window: "24h" } }));

    const row = jobRow("개발자");
    expect(within(row).getByText("실행 기록 없음 · 한도 24회/24h")).toBeVisible();
    expect(row.textContent).not.toContain("0/24");
  });

  // 잡 목록 자체가 대체되는 경로라 사용량에 새 분기를 두지 않는다. 그대로 성립하는지만 못 박는다.
  it("draws no usage while the managed block is unreadable", () => {
    renderIntegrations(
      quotaState(
        { developer: exhaustedQuota },
        {
          managedBlockFailure: {
            path: "/Users/catze/.claude/HEARTBEAT.md",
            message: "Permission denied (os error 13)",
          },
        },
      ),
      undefined,
      { pendingWork: waitingFor("developer") },
    );

    const card = screen.getByRole("article", { name: "claude-heartbeat" });
    expect(card.querySelector(".heartbeat-job-quota")).toBeNull();
    expect(card).not.toHaveTextContent("실행 한도 도달");
    expect(screen.queryByText(warningTitle)).toBeNull();
  });

  // SPEC-017 완료 조건 13. 사용자가 고른 제한 없음은 정상 상태다. 숫자를 보여주지 않는다 —
  // 데몬이 무제한 잡의 실행을 기록하지 않으므로 남은 값은 한도가 있던 시절의 이력뿐이다.
  it("shows the chosen unlimited without any usage count", () => {
    renderIntegrations(
      quotaState(
        { developer: { kind: "unlimited" } },
        { runs: { developer: { at: "2026-08-03 05:00:00", result: "success", durationSeconds: 12 } } },
      ),
    );

    const row = jobRow("개발자");
    expect(within(row).getByText("제한 없음 — 실행 횟수 제한 없이 주기마다 실행됩니다.")).toBeVisible();
    // 사용 횟수를 그리는 표기가 없다. `n/m · 창 기준`도 `한도 n회`도 없다.
    expect(row.textContent).not.toMatch(/\d+\/\d+ ·/);
    expect(row).not.toHaveTextContent("한도 없음");
    // 완료 조건 14. 마지막 실행 기록은 한도와 무관하므로 그대로 남는다.
    expect(within(row).getByText("성공")).toBeVisible();
    expect(within(row).getByText("2026-08-03 05:00:00 (로컬 시각)")).toBeVisible();
  });

  // SPEC-017 완료 조건 11. 제한 없음인 잡은 막을 한도가 없으므로 대기 물량이 있어도 경고가 아니다.
  it("raises no quota warning for the chosen unlimited even with pending work", () => {
    renderIntegrations(quotaState({ developer: { kind: "unlimited" } }), undefined, {
      pendingWork: waitingFor("developer"),
    });

    const row = jobRow("개발자");
    expect(within(row).queryByText("실행 한도 도달")).toBeNull();
    expect(row.querySelector(".integration-warning")).toBeNull();
    // 카드 접힘 요약에도 올라가지 않는다.
    expect(screen.queryByText(warningTitle)).toBeNull();
  });

  // SPEC-017 완료 조건 12. 두 무제한이 서로 다른 문구로 보인다. 앞은 정상 상태이고 뒤는 손볼 곳이다.
  it("words the chosen unlimited and an ignored limit differently", () => {
    renderIntegrations(quotaState({ developer: { kind: "unlimited" } }));
    const chosen = within(jobRow("개발자")).getByText(/제한 없음 —/).textContent;
    cleanup();

    renderIntegrations(quotaState({ developer: { kind: "ignoredLimit", value: "0/24h" } }));
    const ignored = within(jobRow("개발자")).getByText(/^한도 없음 —/).textContent;

    expect(ignored).not.toEqual(chosen);
    // 어긋난 값 쪽만 원문과 고쳐야 한다는 사실을 밝힌다.
    expect(ignored).toContain('"0/24h"');
    expect(ignored).toContain("저장할 수 없습니다");
    // 형식이 맞는 값이므로 "형식이 올바르지 않아"라고 단정하지 않는다.
    expect(ignored).not.toContain("형식이 올바르지 않아");
    expect(chosen).not.toContain("max_per");
  });

  it("shows a broken max_per as unlimited with no exhausted mark and no warning", () => {
    renderIntegrations(quotaState({ developer: { kind: "ignoredLimit", value: "24" } }), undefined, {
      pendingWork: waitingFor("developer"),
    });

    const row = jobRow("개발자");
    expect(within(row).getByText(/^한도 없음 —/)).toBeVisible();
    expect(within(row).queryByText("실행 한도 도달")).toBeNull();
    expect(row.querySelector(".integration-warning")).toBeNull();
  });

  it("draws a usage above the limit as exhausted without failing", () => {
    renderIntegrations(
      quotaState({
        developer: {
          kind: "counted",
          used: 30,
          limit: 24,
          window: "24h",
          exhausted: true,
          recoversAt: null,
        },
      }),
    );

    const row = jobRow("개발자");
    expect(within(row).getByText("30/24 · 24h 기준")).toBeVisible();
    expect(within(row).getByText("실행 한도 도달")).toBeVisible();
    // recoversAt이 없으면 시각 문장만 빠진다.
    expect(row).not.toHaveTextContent("예상");
  });

  it("draws no usage for a role job that is not in the managed block", () => {
    renderIntegrations(quotaState({ planner: exhaustedQuota }), undefined, {
      pendingWork: waitingFor("planner"),
    });

    expect(jobRow("기획자").querySelector(".heartbeat-job-quota")).toBeNull();
    expect(jobRow("기획자").querySelector(".integration-warning")).toBeNull();
    expect(jobRow("개발자").querySelector(".heartbeat-job-quota")).not.toBeNull();
  });
});

describe("IntegrationsView 모델 선택", () => {
  const installAction = { name: "이 프로젝트에 역할 잡 설치" };

  it("offers the supported aliases as their own values plus a direct input path", () => {
    renderIntegrations(installed());

    const select = screen.getByLabelText("개발자 모델");
    expect(within(select).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "opus",
      "sonnet",
      "haiku",
      "fable",
      "직접 입력",
    ]);
    // 화면에 보이는 표기와 파일에 기록되는 값이 같아야 사용자가 HEARTBEAT.md와 대조할 수 있다.
    for (const alias of ["opus", "sonnet", "haiku", "fable"]) {
      const option = within(select).getByRole("option", { name: alias }) as HTMLOptionElement;
      expect(option.value).toBe(alias);
    }
  });

  it("carries a picked model into the install request without any typing", async () => {
    const onInstall = renderIntegrations(installed());

    selectModel("개발자 모델", "sonnet");
    fireEvent.click(screen.getByRole("button", installAction));
    fireEvent.click(screen.getByRole("button", { name: "확인하고 쓰기" }));

    await waitFor(() => expect(onInstall).toHaveBeenCalledTimes(1));
    expect(onInstall).toHaveBeenCalledWith(
      [
        { role: "planner", enabled: true, interval: null, maxPer: null, model: null, timeout: null },
        { role: "architect", enabled: true, interval: null, maxPer: null, model: null, timeout: null },
        { role: "developer", enabled: true, interval: null, maxPer: null, model: "sonnet", timeout: null },
      ],
      [],
    );
  });

  it("carries a directly entered model name into the install request unchanged", async () => {
    const onInstall = renderIntegrations(installed());

    selectModel("개발자 모델", "직접 입력");
    fireEvent.change(screen.getByLabelText("개발자 모델 직접 입력"), {
      target: { value: "claude-opus-5" },
    });
    fireEvent.click(screen.getByRole("button", installAction));
    fireEvent.click(screen.getByRole("button", { name: "확인하고 쓰기" }));

    await waitFor(() => expect(onInstall).toHaveBeenCalledTimes(1));
    expect(onInstall).toHaveBeenCalledWith(
      [
        { role: "planner", enabled: true, interval: null, maxPer: null, model: null, timeout: null },
        { role: "architect", enabled: true, interval: null, maxPer: null, model: null, timeout: null },
        { role: "developer", enabled: true, interval: null, maxPer: null, model: "claude-opus-5", timeout: null },
      ],
      [],
    );
  });

  it.each([
    ["a value with a space", "claude opus"],
    ["an empty value", ""],
  ])("reports %s in the direct input and writes nothing", (_case, value) => {
    const onInstall = renderIntegrations(installed());

    selectModel("개발자 모델", "직접 입력");
    fireEvent.change(screen.getByLabelText("개발자 모델 직접 입력"), { target: { value } });
    fireEvent.click(screen.getByRole("button", installAction));

    const input = screen.getByLabelText("개발자 모델 직접 입력");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(document.getElementById(input.getAttribute("aria-describedby") ?? "")).toHaveTextContent(
      "공백 없는 한 줄 값이어야 합니다",
    );
    expect(screen.queryByRole("group", { name: "역할 잡 설치 확인" })).not.toBeInTheDocument();
    expect(onInstall).not.toHaveBeenCalled();
  });

  it("opens a model value outside the list in the direct input and keeps it", async () => {
    const onInstall = renderIntegrations(
      installed([
        {
          role: "developer",
          interval: "20m",
          maxPer: "6/24h",
          model: "claude-opus-5",
          timeout: "30m",
          appOwnedDrift: [],
        },
      ]),
    );

    expect(screen.getByLabelText("개발자 모델 직접 입력")).toHaveValue("claude-opus-5");
    // 목록 안 값을 쓰는 잡은 선택 컨트롤만 보인다.
    expect(screen.queryByLabelText("기획자 모델 직접 입력")).not.toBeInTheDocument();

    // 앱이 그 값을 목록 안의 값으로 바꾸지 않는다.
    fireEvent.click(screen.getByRole("button", { name: "역할 잡 변경 사항 저장" }));
    fireEvent.click(screen.getByRole("button", { name: "확인하고 쓰기" }));

    await waitFor(() => expect(onInstall).toHaveBeenCalledTimes(1));
    // 값을 건드리지 않았으므로 미지정으로 나간다. 목록 안의 값으로 바꿔 보내지 않는다는 보장은
    // 그대로다. 파일의 값이 남는 것은 이제 요청 payload가 아니라 쓰기 계약이 지킨다
    // (heartbeat_service.rs의 an_unlisted_model_survives_a_save_that_does_not_specify_it).
    expect(onInstall.mock.calls[0][0]).toContainEqual(
      expect.objectContaining({ role: "developer", model: null }),
    );
  });

  it("states the risk of a directly entered model name next to the input", () => {
    renderIntegrations(installed());

    expect(screen.getByRole("region", { name: "연동" })).not.toHaveTextContent(
      "확인하지 못합니다",
    );

    selectModel("개발자 모델", "직접 입력");

    const card = screen.getByRole("region", { name: "연동" });
    expect(card).toHaveTextContent("실제로 있는 모델인지 확인하지 못합니다");
    expect(card).toHaveTextContent("매 주기 실패");
    expect(card).toHaveTextContent("실행 쿼터는 실패해도 이미 차감된 뒤입니다");
  });

  it("keeps the model field of each job independent", () => {
    renderIntegrations(installed());

    selectModel("개발자 모델", "직접 입력");
    fireEvent.change(screen.getByLabelText("개발자 모델 직접 입력"), {
      target: { value: "claude-opus-5" },
    });

    expect(screen.getByLabelText("기획자 모델")).toHaveValue("opus");
    expect(screen.queryByLabelText("기획자 모델 직접 입력")).not.toBeInTheDocument();

    selectModel("기획자 모델", "haiku");

    expect(screen.getByLabelText("기획자 모델")).toHaveValue("haiku");
    expect(screen.getByLabelText("개발자 모델 직접 입력")).toHaveValue("claude-opus-5");
  });
});

// R3. 앱이 화면과 파일 중 한쪽을 임의로 고르지 않는다. 자동 새로고침이 편집 중인 입력을 알림 없이
// 대체하지도, 화면이 읽은 뒤 바뀐 파일을 확인 없이 덮어쓰지도 않는다.
describe("IntegrationsView 관리 블록 변화", () => {
  const installAction = { name: "이 프로젝트에 역할 잡 설치" };

  /** 2.5초 조회가 새 스냅샷을 주는 상황을 다시 그려 재현한다. */
  function renderPolling(
    integrations: IntegrationsState,
    onInstall = vi.fn().mockResolvedValue(true),
  ) {
    const view = (state: IntegrationsState) => (
      <IntegrationsView
        actions={{
          installHeartbeatJobs: onInstall,
          installDreamJob: vi.fn().mockResolvedValue(true),
        }}
        error={state.error}
        heartbeatRuns={runControls()}
        snapshot={state.snapshot}
        writeError={state.writeError}
      />
    );
    const { rerender } = render(view(integrations));
    for (const toggle of screen.getAllByRole("button", { name: "펼치기" })) {
      fireEvent.click(toggle);
    }
    return { onInstall, poll: (next: IntegrationsState) => rerender(view(next)) };
  }

  const developer = (overrides: Partial<ManagedRoleJob> = {}): ManagedRoleJob => ({
    role: "developer",
    interval: "20m",
    maxPer: "6/24h",
    model: "opus",
    timeout: "30m",
    appOwnedDrift: [],
    ...overrides,
  });

  const fileChange = { name: "역할 잡 파일 변경" };

  it("keeps the edited value and shows what changed in the file", () => {
    const { poll } = renderPolling(installed([developer()]));
    fireEvent.change(screen.getByLabelText("개발자 주기"), { target: { value: "45m" } });

    poll(installed([developer({ maxPer: "9/24h" })]));

    expect(screen.getByLabelText("개발자 주기")).toHaveValue("45m");
    const notice = screen.getByRole("group", fileChange);
    expect(notice).toHaveTextContent("화면이 읽은 뒤 관리 블록이 바뀌었습니다");
    expect(notice).toHaveTextContent("실행 한도 6/24h → 9/24h — 바뀜");
    expect(notice).toHaveTextContent("주기 20m — 그대로");
  });

  it("takes the file values when the user asks for them", () => {
    const { poll } = renderPolling(installed([developer()]));
    fireEvent.change(screen.getByLabelText("개발자 주기"), { target: { value: "45m" } });
    poll(installed([developer({ interval: "30m", maxPer: "9/24h" })]));

    fireEvent.click(screen.getByRole("button", { name: "파일 값 불러오기" }));

    expect(screen.getByLabelText("개발자 주기")).toHaveValue("30m");
    expect(screen.getByLabelText("개발자 실행 한도 값")).toHaveValue("9/24h");
    expect(screen.queryByRole("group", fileChange)).not.toBeInTheDocument();
  });

  // 사용자가 무엇을 덮어쓰는지 이미 봤으므로 다음 저장은 파일의 현재 값을 기준값으로 삼는다.
  it("sends the refreshed baseline after the user keeps the edits", async () => {
    const changed = developer({ maxPer: "9/24h" });
    const { onInstall, poll } = renderPolling(installed([developer()]));
    fireEvent.change(screen.getByLabelText("개발자 주기"), { target: { value: "45m" } });
    poll(installed([changed]));

    fireEvent.click(screen.getByRole("button", { name: "편집 유지" }));
    expect(screen.getByLabelText("개발자 주기")).toHaveValue("45m");
    expect(screen.queryByRole("group", fileChange)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "역할 잡 변경 사항 저장" }));
    fireEvent.click(screen.getByRole("button", { name: "확인하고 쓰기" }));

    await waitFor(() => expect(onInstall).toHaveBeenCalledTimes(1));
    expect(onInstall.mock.calls[0][1]).toEqual([changed]);
  });

  // 편집 중이 아닐 때의 반영은 현행 동작이다. 이 요구는 입력을 지키는 것이지 화면을 낡은 채로
  // 두는 것이 아니다.
  it("reseeds silently while no field is specified", () => {
    const { poll } = renderPolling(installed([developer()]));

    poll(installed([developer({ interval: "30m" })]));

    expect(screen.getByLabelText("개발자 주기")).toHaveValue("30m");
    expect(screen.queryByRole("group", fileChange)).not.toBeInTheDocument();
  });

  // 2.5초 조회가 같은 값을 반복해서 준다. 그때마다 알림이 뜨면 화면을 쓸 수 없다.
  it("says nothing while the read keeps returning the same block", () => {
    const { poll } = renderPolling(installed([developer()]));
    fireEvent.change(screen.getByLabelText("개발자 주기"), { target: { value: "45m" } });

    poll(installed([developer()]));
    poll(installed([developer()]));

    expect(screen.getByLabelText("개발자 주기")).toHaveValue("45m");
    expect(screen.queryByRole("group", fileChange)).not.toBeInTheDocument();
  });

  it("sends the managed block it seeded from as the baseline", async () => {
    const seeded = developer({ maxPer: "8/24h" });
    const { onInstall } = renderPolling(installed([seeded]));

    fireEvent.change(screen.getByLabelText("개발자 주기"), { target: { value: "45m" } });
    fireEvent.click(screen.getByRole("button", { name: "역할 잡 변경 사항 저장" }));
    fireEvent.click(screen.getByRole("button", { name: "확인하고 쓰기" }));

    await waitFor(() => expect(onInstall).toHaveBeenCalledTimes(1));
    expect(onInstall.mock.calls[0][1]).toEqual([seeded]);
  });

  // 백엔드가 불일치로 거부한 뒤 새 값이 들어오면 두 경로가 같은 화면으로 수렴해야 한다.
  it("shows the rejection reason and the same choice screen after a refused write", () => {
    const { poll } = renderPolling(installed([developer()]));
    fireEvent.change(screen.getByLabelText("개발자 주기"), { target: { value: "45m" } });

    poll({
      snapshot: snapshot({ heartbeat: heartbeat({ managedJobs: [developer({ maxPer: "9/24h" })] }) }),
      error: null,
      writeError: {
        integration: "heartbeat",
        message: "화면이 읽은 뒤 관리 블록이 바뀌어 아무 파일도 쓰지 않았습니다.",
      },
    });

    const card = screen.getByRole("article", { name: "claude-heartbeat" });
    expect(card).toHaveTextContent("역할 잡을 쓰지 못했습니다");
    expect(card).toHaveTextContent("아무 파일도 쓰지 않았습니다");
    expect(screen.getByRole("group", fileChange)).toHaveTextContent(
      "실행 한도 6/24h → 9/24h — 바뀜",
    );
  });

  it("reports a job that appeared and one that disappeared in the file", () => {
    const { poll } = renderPolling(installed([developer()]));
    fireEvent.change(screen.getByLabelText("개발자 주기"), { target: { value: "45m" } });

    poll(
      installed([
        { role: "planner", interval: "30m", maxPer: "4/24h", model: "opus", timeout: "20m", appOwnedDrift: [] },
      ]),
    );

    const notice = screen.getByRole("group", fileChange);
    expect(notice).toHaveTextContent("wf-planner-projects-workflow-labs");
    expect(notice).toHaveTextContent("관리 블록에 없던 잡입니다");
    expect(notice).toHaveTextContent("제거: wf-developer-projects-workflow-labs");
  });

  it("does not block the save so the backend can refuse the write", () => {
    const { poll } = renderPolling(installed([developer()]));
    fireEvent.change(screen.getByLabelText("개발자 주기"), { target: { value: "45m" } });
    poll(installed([developer({ maxPer: "9/24h" })]));

    expect(screen.getByRole("button", { name: "역할 잡 변경 사항 저장" })).toBeEnabled();
  });

  // 첫 설치 화면에도 같은 규칙이 붙는다. 기준값은 빈 목록이고, 그 사이 잡이 생기면 알린다.
  it("treats a first install as a changed block once a job appears", () => {
    const { poll } = renderPolling(installed());
    fireEvent.change(screen.getByLabelText("개발자 주기"), { target: { value: "45m" } });
    expect(screen.getByRole("button", installAction)).toBeInTheDocument();

    poll(installed([developer()]));

    expect(screen.getByLabelText("개발자 주기")).toHaveValue("45m");
    expect(screen.getByRole("group", fileChange)).toHaveTextContent(
      "관리 블록에 없던 잡입니다",
    );
  });
});

/**
 * 접기·펼치기(SPEC-006 R4~R7). 상태의 주인은 뷰이므로 여기서 실제 배선 그대로 확인한다.
 * 이 블록만 `expand: false`로 렌더해 기본값인 접힘에서 시작한다.
 */
describe("연동 카드 접기·펼치기", () => {
  const heartbeatCard = { name: "claude-heartbeat" };
  const dreamCard = { name: "dream" };
  const alert = "확인할 경고가 있습니다";

  /** 접힘 여부는 본문 컨테이너 하나로 정해진다. 토글이 가리키는 그 요소를 그대로 본다. */
  function bodyOf(name: string) {
    return document.getElementById(toggleOf(name).getAttribute("aria-controls") ?? "");
  }

  function renderCollapsed(
    integrations: IntegrationsState = installed(),
    pendingWork?: PendingRoleWork,
  ) {
    return renderIntegrations(integrations, undefined, { expand: false, pendingWork });
  }

  it("starts every untouched card collapsed", () => {
    renderCollapsed();

    expect(bodyOf("claude-heartbeat")).not.toBeVisible();
    expect(bodyOf("dream")).not.toBeVisible();
  });

  it("expands and collapses only the card whose toggle was used", () => {
    renderCollapsed();

    toggleCard("claude-heartbeat");
    expect(bodyOf("claude-heartbeat")).toBeVisible();
    expect(bodyOf("dream")).not.toBeVisible();

    toggleCard("dream");
    expect(bodyOf("claude-heartbeat")).toBeVisible();
    expect(bodyOf("dream")).toBeVisible();

    toggleCard("claude-heartbeat");
    expect(bodyOf("claude-heartbeat")).not.toBeVisible();
    expect(bodyOf("dream")).toBeVisible();
  });

  it("exposes the expanded state on the toggle and moves it with the keyboard", async () => {
    renderCollapsed();
    const toggle = toggleOf("claude-heartbeat");
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    toggle.focus();
    await userEvent.keyboard("{Enter}");
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    await userEvent.keyboard(" ");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps the name and the status badge readable while collapsed", () => {
    renderCollapsed({
      snapshot: snapshot({ heartbeat: heartbeat({ daemonRunning: false }) }),
      error: null,
      writeError: null,
    });

    const card = screen.getByRole("article", heartbeatCard);
    expect(within(card).getByText("claude-heartbeat")).toBeVisible();
    expect(within(card).getByText("설치됨 · 데몬 미실행")).toBeVisible();
  });

  // 골격이 아는 경고 신호 다섯. 어느 하나라도 있으면 접힌 채로도 그 사실이 보여야 한다.
  // 다섯 번째는 본문만 아는 경고이고, 골격은 불리언 하나로만 받는다.
  it.each<[string, IntegrationsState, PendingRoleWork?]>([
    [
      "조회 실패",
      { snapshot: null, error: "연동 상태를 읽지 못했습니다", writeError: null },
    ],
    [
      "중복 잡",
      {
        snapshot: snapshot({
          heartbeat: heartbeat({
            duplicateJobs: [{ name: "wf-developer", integration: "heartbeat", role: "developer" }],
          }),
        }),
        error: null,
        writeError: null,
      },
    ],
    [
      "읽기 실패",
      {
        snapshot: snapshot({
          heartbeat: heartbeat({
            readFailures: [{ path: "~/.claude/HEARTBEAT.md", message: "권한이 없습니다" }],
          }),
        }),
        error: null,
        writeError: null,
      },
    ],
    [
      "저장 실패",
      {
        snapshot: snapshot(),
        error: null,
        writeError: { integration: "heartbeat", message: "관리 블록 마커가 손상되었습니다" },
      },
    ],
    [
      "한도 소진과 대기 물량",
      quotaState({ developer: exhaustedQuota }),
      waitingFor("developer"),
    ],
  ])("says a collapsed card has a warning when %s happened", (_case, integrations, pendingWork) => {
    renderCollapsed(integrations, pendingWork);

    const card = screen.getByRole("article", heartbeatCard);
    const mark = within(card).getByText(alert);
    expect(mark).toBeVisible();
    // 상태 배지와 다른 요소이고 문구도 다르다. 색만으로 나뉘지 않는다.
    expect(mark).not.toBe(card.querySelector(".integration-status"));
    expect(card.querySelector(".integration-status")).not.toHaveTextContent(alert);
  });

  it("leaves the warning mark off a collapsed card that has none", () => {
    renderCollapsed();

    expect(within(screen.getByRole("article", heartbeatCard)).queryByText(alert)).toBeNull();
    expect(within(screen.getByRole("article", dreamCard)).queryByText(alert)).toBeNull();
  });

  // 소진만으로는 경고가 아니므로 요약도 켜지지 않는다(R3).
  it("leaves the summary clean when an exhausted job has nothing waiting", () => {
    renderCollapsed(quotaState({ developer: exhaustedQuota }));

    expect(within(screen.getByRole("article", heartbeatCard)).queryByText(alert)).toBeNull();
  });

  // 한 연동의 저장 실패가 다른 연동의 요약을 켜지 않는다. 카드에는 자기 실패만 내려간다.
  it("marks only the integration whose write failed", () => {
    renderCollapsed({
      snapshot: snapshot(),
      error: null,
      writeError: { integration: "dream", message: "dream 쓰기 실패" },
    });

    expect(within(screen.getByRole("article", heartbeatCard)).queryByText(alert)).toBeNull();
    expect(within(screen.getByRole("article", dreamCard)).getByText(alert)).toBeVisible();
  });

  // R7. 접기는 표시를 바꾸는 동작이지 편집을 취소하는 동작이 아니다.
  it("keeps the unsaved heartbeat form values across a collapse", () => {
    renderCollapsed();
    toggleCard("claude-heartbeat");
    fireEvent.change(screen.getByLabelText("개발자 주기"), { target: { value: "45m" } });
    fireEvent.change(screen.getByLabelText("개발자 실행 한도 값"), { target: { value: "9/24h" } });

    toggleCard("claude-heartbeat");
    toggleCard("claude-heartbeat");

    expect(screen.getByLabelText("개발자 주기")).toHaveValue("45m");
    expect(screen.getByLabelText("개발자 실행 한도 값")).toHaveValue("9/24h");
  });

  /**
   * 펼침 상태의 기억(SPEC-006 R6). 뷰 전환은 이 컴포넌트의 언마운트·재마운트라서 다른 화면을
   * 다녀오는 것과 앱을 다시 여는 것이 같은 경로다. 여기서는 언마운트 뒤 재렌더로 그 경로를 밟는다.
   */
  describe("펼침 상태 기억", () => {
    const COLLAPSE_KEY = "workflow-labs.integration-collapse.v1";

    /** 다른 화면에 갔다 오는 것과 앱을 다시 여는 것이 같은 경로다. */
    function reopenView() {
      cleanup();
      renderCollapsed();
    }

    it("starts collapsed when nothing was remembered", () => {
      renderCollapsed();

      expect(bodyOf("claude-heartbeat")).not.toBeVisible();
      expect(bodyOf("dream")).not.toBeVisible();
    });

    it("remembers only the card that was expanded across a remount", () => {
      renderCollapsed();
      toggleCard("claude-heartbeat");

      reopenView();

      expect(bodyOf("claude-heartbeat")).toBeVisible();
      expect(bodyOf("dream")).not.toBeVisible();
    });

    it("forgets a card that was collapsed again", () => {
      renderCollapsed();
      toggleCard("dream");
      toggleCard("dream");

      reopenView();

      expect(bodyOf("dream")).not.toBeVisible();
    });

    it("renders normally and stays collapsed when the remembered value is corrupted", () => {
      storage.set(COLLAPSE_KEY, "{not json");

      renderCollapsed();

      expect(screen.getByRole("region", { name: "연동" })).toBeInTheDocument();
      expect(bodyOf("claude-heartbeat")).not.toBeVisible();
      expect(bodyOf("dream")).not.toBeVisible();
      // 표시 상태를 읽지 못한 것은 사용자에게 알릴 가치가 없다. 경고 자리도 그대로 비어 있다.
      expect(screen.queryByText(alert)).toBeNull();
      expect(document.querySelector(".integration-warning")).toBeNull();
    });

    it("renders normally when the remembered value names no current integration", () => {
      storage.set(COLLAPSE_KEY, JSON.stringify({ "gone-integration": true }));

      renderCollapsed();

      expect(bodyOf("claude-heartbeat")).not.toBeVisible();
      expect(bodyOf("dream")).not.toBeVisible();
    });

    it("keeps the toggle working when the storage throws on every access", () => {
      vi.stubGlobal("localStorage", {
        getItem: () => {
          throw new Error("접근이 차단되었습니다");
        },
        setItem: () => {
          throw new Error("접근이 차단되었습니다");
        },
      });

      renderCollapsed();

      expect(bodyOf("claude-heartbeat")).not.toBeVisible();
      toggleCard("claude-heartbeat");
      expect(bodyOf("claude-heartbeat")).toBeVisible();
    });
  });
});

// 끈 잡의 편집값은 사라지지 않는다. 마지막 파일 값이 브라우저 저장소에 남았다가 다시 켤 때 폼과
// 요청으로 돌아온다. "비활성화하고 저장하면 초기화"되던 동작의 회귀 테스트다.
describe("IntegrationsView 잡 값 기억", () => {
  const plannerJob: ManagedRoleJob = {
    role: "planner",
    interval: "30m",
    maxPer: "4/24h",
    model: "opus",
    timeout: "20m",
    appOwnedDrift: [],
  };

  const editedDeveloper: ManagedRoleJob = {
    role: "developer",
    interval: "45m",
    maxPer: "16/24h",
    model: "sonnet",
    timeout: "30m",
    appOwnedDrift: [],
  };

  it("seeds a re-enabled role job from its last file values and sends them as specified", async () => {
    // 편집된 개발자 잡이 설치된 화면에서 토글을 끈다 → 마지막 파일 값이 기억된다.
    renderIntegrations(installed([plannerJob, editedDeveloper]));
    fireEvent.click(screen.getByRole("checkbox", { name: "개발자" }));
    cleanup();

    // 저장을 거쳐 개발자 잡이 블록에서 빠진 상태. 다시 켜면 기본값이 아니라 기억한 값으로 돌아온다.
    const onInstall = renderIntegrations(installed([plannerJob]));
    fireEvent.click(screen.getByRole("checkbox", { name: "개발자" }));

    expect(screen.getByLabelText("개발자 주기")).toHaveValue("45m");
    expect(screen.getByLabelText("개발자 실행 한도 값")).toHaveValue("16/24h");
    expect(screen.getByLabelText("개발자 시간 초과")).toHaveValue("30m");

    fireEvent.click(screen.getByRole("button", { name: "역할 잡 변경 사항 저장" }));
    await userEvent.click(screen.getByRole("button", { name: "확인하고 쓰기" }));

    // 기억한 값은 파일에 없으므로 지정 값으로 실려야 저장에 반영된다.
    expect(onInstall.mock.calls[0][0]).toContainEqual({
      role: "developer",
      enabled: true,
      interval: "45m",
      maxPer: { kind: "limit", value: "16/24h" },
      model: "sonnet",
      timeout: "30m",
    });
  });

  it("seeds the re-enabled dream job from its last file values", async () => {
    renderIntegrations({
      snapshot: snapshot({
        dream: dream({
          installation: "installed",
          managedJob: { interval: "6h", maxPer: "2/24h", model: "opus", timeout: "45m", appOwnedDrift: [] },
        }),
      }),
      error: null,
      writeError: null,
    });
    await userEvent.click(screen.getByLabelText("dream 정제"));
    cleanup();

    // 첫 설치 폼은 켬으로 시작하므로 끔→켬으로 재활성 경로를 태운다.
    renderIntegrations({
      snapshot: snapshot({ dream: dream({ installation: "installed", managedJob: null }) }),
      error: null,
      writeError: null,
    });
    await userEvent.click(screen.getByLabelText("dream 정제"));
    await userEvent.click(screen.getByLabelText("dream 정제"));

    expect(screen.getByLabelText("dream 정제 주기")).toHaveValue("6h");
    expect(screen.getByLabelText("dream 정제 실행 한도 값")).toHaveValue("2/24h");
    expect(screen.getByLabelText("dream 정제 시간 초과")).toHaveValue("45m");
  });
});

/**
 * SPEC-017 R1·R3·R4·R5의 역할 잡 몫. 실행 한도가 "한도 지정 / 제한 없음" 선택과 값 입력의 조합이
 * 되고(확인 필요 1번의 승인된 제안), 데몬이 한도로 인정하지 않는 값을 화면이 먼저 막는다.
 */
describe("IntegrationsView 역할 잡 실행 한도", () => {
  const saveAction = { name: "역할 잡 변경 사항 저장" };
  const confirmSave = { name: "확인하고 쓰기" };
  const quotaSelect = { name: "개발자 실행 한도" };

  /** 관리 블록에 개발자 잡만 있고 그 잡에 한도 줄이 없는 상태. 사용자가 고른 제한 없음이다. */
  const unlimitedJob: ManagedRoleJob = { ...developerJob, maxPer: null };

  /**
   * 개발자 잡이 빠진 뒤에도 블록이 비지 않게 남겨 두는 잡. 블록이 비면 첫 설치로 읽혀 세 역할이
   * 모두 켠 상태로 열리고, 껐다 켜는 경로를 태울 수 없다.
   */
  const plannerJob: ManagedRoleJob = {
    role: "planner",
    interval: "30m",
    maxPer: "4/24h",
    model: "opus",
    timeout: "20m",
    appOwnedDrift: [],
  };

  /** 선택 컨트롤을 화면에 보이는 이름으로 고른다. 테스트가 내부 값을 알 필요가 없다. */
  function chooseQuota(option: "한도 지정" | "제한 없음") {
    const select = screen.getByRole("combobox", quotaSelect);
    const target = within(select).getByRole("option", { name: option }) as HTMLOptionElement;
    fireEvent.change(select, { target: { value: target.value } });
  }

  function developerRequest(onInstall: ReturnType<typeof vi.fn>) {
    return (onInstall.mock.calls[0][0] as RoleJobRequest[]).find(
      (request) => request.role === "developer",
    );
  }

  // 완료 조건 1. 고른 값이 요청까지 그대로 간다. 다른 역할은 지정하지 않은 채로 남는다.
  it("sends unlimited for the job the user set it on and leaves the others unspecified", async () => {
    const onInstall = renderIntegrations(installed([developerJob]));

    chooseQuota("제한 없음");
    fireEvent.click(screen.getByRole("button", saveAction));
    fireEvent.click(screen.getByRole("button", confirmSave));

    await waitFor(() => expect(onInstall).toHaveBeenCalledTimes(1));
    const requests = onInstall.mock.calls[0][0] as RoleJobRequest[];
    expect(requests.find((request) => request.role === "developer")?.maxPer).toEqual({
      kind: "unlimited",
    });
    expect(requests.find((request) => request.role === "planner")?.maxPer).toBeNull();
    expect(requests.find((request) => request.role === "architect")?.maxPer).toBeNull();
  });

  // R1. 고른 상태가 무엇을 뜻하는지 필드 안에서 밝힌다. 값 칸은 그 상태에서 사라진다.
  it("explains what unlimited means and hides the value input", () => {
    renderIntegrations(installed([developerJob]));

    expect(screen.getByLabelText("개발자 실행 한도 값")).toBeVisible();

    chooseQuota("제한 없음");

    expect(screen.queryByLabelText("개발자 실행 한도 값")).not.toBeInTheDocument();
    expect(jobRow("개발자")).toHaveTextContent("실행 횟수 제한 없이 주기마다 실행됩니다");
  });

  // 되돌아갈 길이 있어야 한다. 필드는 값을 스스로 지우지 않는다.
  it("keeps the typed value when switching back to a limit", async () => {
    const onInstall = renderIntegrations(installed([developerJob]));

    fireEvent.change(screen.getByLabelText("개발자 실행 한도 값"), { target: { value: "9/24h" } });
    chooseQuota("제한 없음");
    chooseQuota("한도 지정");

    expect(screen.getByLabelText("개발자 실행 한도 값")).toHaveValue("9/24h");

    fireEvent.click(screen.getByRole("button", saveAction));
    fireEvent.click(screen.getByRole("button", confirmSave));

    await waitFor(() => expect(onInstall).toHaveBeenCalledTimes(1));
    expect(developerRequest(onInstall)?.maxPer).toEqual({ kind: "limit", value: "9/24h" });
  });

  // 완료 조건 2. 한도 줄이 없는 잡은 제한 없음으로 열린다. 앱 기본값이 그 자리에 보이지 않는다.
  it("opens a job without a quota line as unlimited and seeds no app default", () => {
    renderIntegrations(installed([unlimitedJob]));

    expect(screen.getByRole("combobox", quotaSelect)).toHaveDisplayValue("제한 없음");
    expect(screen.queryByLabelText("개발자 실행 한도 값")).not.toBeInTheDocument();
    // 앱 기본값은 6/24h다. 그 값이 화면 어디에도 없어야 한다.
    expect(jobRow("개발자")).not.toHaveTextContent("6/24h");
  });

  // 완료 조건 3. 아무것도 바꾸지 않은 저장은 그 필드를 지정하지 않는다. 파일 값이 이긴다.
  it("specifies nothing when an unlimited job is saved untouched", async () => {
    const onInstall = renderIntegrations(installed([unlimitedJob]));

    fireEvent.click(screen.getByRole("button", saveAction));
    fireEvent.click(screen.getByRole("button", confirmSave));

    await waitFor(() => expect(onInstall).toHaveBeenCalledTimes(1));
    expect(developerRequest(onInstall)?.maxPer).toBeNull();
  });

  // 완료 조건 4. 다른 필드만 편집해도 제한 없음이 유지된다.
  it("leaves the quota unspecified when only another field is edited", async () => {
    const onInstall = renderIntegrations(installed([unlimitedJob]));

    selectModel("개발자 모델", "sonnet");
    fireEvent.click(screen.getByRole("button", saveAction));
    fireEvent.click(screen.getByRole("button", confirmSave));

    await waitFor(() => expect(onInstall).toHaveBeenCalledTimes(1));
    const request = developerRequest(onInstall);
    expect(request?.model).toBe("sonnet");
    expect(request?.maxPer).toBeNull();
  });

  // 완료 조건 5·6. 데몬이 한도로 인정하지 않는 값은 화면이 먼저 막고, 문구가 갈 곳을 밝힌다.
  it.each(["0/24h", "4/0h", "0/1s", "4/0d"])(
    "blocks %s and names both the job toggle and unlimited",
    (value) => {
      const onInstall = renderIntegrations(installed([developerJob]));

      fireEvent.change(screen.getByLabelText("개발자 실행 한도 값"), { target: { value } });
      fireEvent.click(screen.getByRole("button", saveAction));

      const input = screen.getByLabelText("개발자 실행 한도 값");
      expect(input).toHaveAttribute("aria-invalid", "true");
      const message = document.getElementById(input.getAttribute("aria-describedby") ?? "");
      expect(message).toHaveTextContent("제한 없이 실행됩니다");
      expect(message).toHaveTextContent("잡을 끄고");
      expect(message).toHaveTextContent("제한 없음으로 지정");
      // 확인 화면이 열리지 않고 게이트웨이도 불리지 않는다.
      expect(screen.queryByRole("group", { name: "역할 잡 설치 확인" })).not.toBeInTheDocument();
      expect(onInstall).not.toHaveBeenCalled();
    },
  );

  // 경계값이다. 백엔드가 받는 값을 화면도 받아야 한다.
  it("accepts the smallest quota the daemon honours", async () => {
    const onInstall = renderIntegrations(installed([developerJob]));

    fireEvent.change(screen.getByLabelText("개발자 실행 한도 값"), { target: { value: "1/1s" } });
    fireEvent.click(screen.getByRole("button", saveAction));
    fireEvent.click(screen.getByRole("button", confirmSave));

    await waitFor(() => expect(onInstall).toHaveBeenCalledTimes(1));
    expect(developerRequest(onInstall)?.maxPer).toEqual({ kind: "limit", value: "1/1s" });
  });

  // 완료 조건 7. 파일의 어긋난 값은 그대로 보이고, 고치기 전에는 다른 필드 편집도 막힌다(R5).
  it.each(["0/24h", "4/0h"])("shows %s from the file and blocks the save until it is fixed", (value) => {
    const onInstall = renderIntegrations(installed([{ ...developerJob, maxPer: value }]));

    // 앱이 몰래 앱 기본값이나 제한 없음으로 갈아치우지 않는다.
    expect(screen.getByRole("combobox", quotaSelect)).toHaveDisplayValue("한도 지정");
    expect(screen.getByLabelText("개발자 실행 한도 값")).toHaveValue(value);

    selectModel("개발자 모델", "sonnet");
    fireEvent.click(screen.getByRole("button", saveAction));

    expect(screen.getByLabelText("개발자 실행 한도 값")).toHaveAttribute("aria-invalid", "true");
    expect(onInstall).not.toHaveBeenCalled();
  });

  // 그 잡을 끄면 블록에서 빠지므로 검증할 값도 사라진다. 기존 "끄면 사라진다" 규약 그대로다.
  it("stops blocking once the job with a broken quota is turned off", async () => {
    const onInstall = renderIntegrations(installed([{ ...developerJob, maxPer: "0/24h" }]));

    fireEvent.click(screen.getByRole("checkbox", { name: "개발자" }));
    fireEvent.click(screen.getByRole("button", saveAction));
    fireEvent.click(screen.getByRole("button", confirmSave));

    await waitFor(() => expect(onInstall).toHaveBeenCalledTimes(1));
    expect(developerRequest(onInstall)?.enabled).toBe(false);
  });

  // 완료 조건 8. 확인 화면이 "제한 없음"과 "없음"을 구분한다.
  //
  // 아무것도 바꾸지 않으면 한도 칸도 그대로이므로 `JobChanges`가 통째로 "달라지는 값이 없습니다"로
  // 접는다. 그 접힘 자체가 이 작업의 성과다 — 고치기 전에는 `current`가 `null`이고 `next`가 앱
  // 기본값이라 손대지 않은 잡이 바뀌는 것처럼 보였다.
  it("reads an untouched unlimited job as changing nothing", () => {
    renderIntegrations(installed([unlimitedJob]));

    fireEvent.click(screen.getByRole("button", saveAction));

    expect(screen.getByRole("group", { name: "역할 잡 설치 확인" })).toHaveTextContent(
      "관리 블록에서 달라지는 값이 없습니다",
    );
  });

  it("labels the quota of an unlimited job as 제한 없음 and not as 없음", () => {
    renderIntegrations(installed([unlimitedJob]));

    // 다른 필드를 바꿔 차이 목록이 펼쳐지게 한다. 한도 칸은 그대로여야 한다.
    selectModel("개발자 모델", "sonnet");
    fireEvent.click(screen.getByRole("button", saveAction));

    const confirm = screen.getByRole("group", { name: "역할 잡 설치 확인" });
    expect(confirm).toHaveTextContent("실행 한도 제한 없음 — 그대로");
    expect(confirm).not.toHaveTextContent("실행 한도 없음");
  });

  it("shows the switch from a limit to unlimited as a change", () => {
    renderIntegrations(installed([developerJob]));

    chooseQuota("제한 없음");
    fireEvent.click(screen.getByRole("button", saveAction));

    expect(screen.getByRole("group", { name: "역할 잡 설치 확인" })).toHaveTextContent(
      "실행 한도 24/24h → 제한 없음 — 바뀜",
    );
  });

  // 블록에 없던 잡이 새로 켜지는 경우는 지금과 같다. 그 "없음"은 잡 자체가 없다는 뜻이다.
  it("still reads a job absent from the block as a missing value", () => {
    renderIntegrations(installed([developerJob]));

    fireEvent.click(screen.getByRole("checkbox", { name: "기획자" }));
    fireEvent.click(screen.getByRole("button", saveAction));

    const confirm = screen.getByRole("group", { name: "역할 잡 설치 확인" });
    expect(confirm).toHaveTextContent("관리 블록에 없던 잡입니다");
    expect(confirm).toHaveTextContent("실행 한도 없음 → 4/24h — 바뀜");
  });

  // 완료 조건 9. 제한 없음인 잡을 껐다 켜면 그 상태가 돌아온다. 앱 기본값으로 시작하지 않는다.
  it("recalls the chosen unlimited after the job is turned off and on", async () => {
    renderIntegrations(installed([plannerJob, unlimitedJob]));
    fireEvent.click(screen.getByRole("checkbox", { name: "개발자" }));
    cleanup();

    // 저장을 거쳐 개발자 잡이 블록에서 빠진 상태. 다시 켜면 앱 기본값이 아니라 기억한 상태다.
    const onInstall = renderIntegrations(installed([plannerJob]));
    fireEvent.click(screen.getByRole("checkbox", { name: "개발자" }));

    expect(screen.getByRole("combobox", quotaSelect)).toHaveDisplayValue("제한 없음");
    expect(screen.queryByLabelText("개발자 실행 한도 값")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", saveAction));
    fireEvent.click(screen.getByRole("button", confirmSave));

    // 기억한 값은 파일에 없으므로 지정 필드로 실려야 저장에 반영된다.
    await waitFor(() => expect(onInstall).toHaveBeenCalledTimes(1));
    expect(developerRequest(onInstall)?.maxPer).toEqual({ kind: "unlimited" });
  });

  // 한도가 있던 잡은 지금과 같이 그 값으로 돌아온다. 위 경로가 이 동작을 깨지 않는다.
  it("still recalls a limit after the job is turned off and on", () => {
    renderIntegrations(installed([plannerJob, developerJob]));
    fireEvent.click(screen.getByRole("checkbox", { name: "개발자" }));
    cleanup();

    renderIntegrations(installed([plannerJob]));
    fireEvent.click(screen.getByRole("checkbox", { name: "개발자" }));

    expect(screen.getByRole("combobox", quotaSelect)).toHaveDisplayValue("한도 지정");
    expect(screen.getByLabelText("개발자 실행 한도 값")).toHaveValue("24/24h");
  });

  // 재설정은 앱 기본값으로 되돌리는 것이고 기본값은 언제나 한도 값이다(R1).
  it("resets an unlimited job back to the app default limit", async () => {
    const onInstall = renderIntegrations(installed([unlimitedJob]));

    fireEvent.click(screen.getByRole("button", { name: "개발자 기본값으로 재설정" }));
    fireEvent.click(screen.getByRole("button", { name: "확인하고 되돌리기" }));

    await waitFor(() => expect(onInstall).toHaveBeenCalledTimes(1));
    expect(developerRequest(onInstall)?.maxPer).toEqual({ kind: "limit", value: "6/24h" });
  });
});

/**
 * SPEC-016의 설치 마법사. 단계 상태는 전부 payload에서 오고 화면은 다시 판정하지 않는다. 그래서 이
 * 테스트들은 스냅샷의 단계 목록만 갈아 끼우고 화면이 그것을 그대로 그리는지 본다.
 */
describe("IntegrationsView 하트비트 설치 마법사", () => {
  /** 단계 하나씩의 상태만 갈아 끼운 목록. 나머지 단계는 픽스처의 값 그대로다. */
  function stagesWith(
    states: Partial<Record<HeartbeatSetupStep, HeartbeatSetupState>>,
  ): HeartbeatSetupStage[] {
    return setupStages().map((stage) => ({ ...stage, state: states[stage.step] ?? stage.state }));
  }

  function withStages(
    stages: HeartbeatSetupStage[],
    overrides: Partial<HeartbeatIntegration> = {},
  ): IntegrationsState {
    return {
      snapshot: snapshot({ heartbeat: heartbeat({ setupStages: stages, ...overrides }) }),
      error: null,
      writeError: null,
    };
  }

  /** 마법사의 단계 행. 순서가 고정이므로 위치로 고른다. 마법사가 접히면 빈 배열이다. */
  function steps(): HTMLElement[] {
    return Array.from(
      screen
        .getByRole("article", { name: "claude-heartbeat" })
        .querySelectorAll(".heartbeat-setup-step"),
    );
  }

  /** 필수 3단계가 모두 끝난 상태. dream 단계는 픽스처의 미완료 그대로 둔다(R9). */
  const requiredDone = { package: "done", init: "done", service: "done" } as const;

  it("lists the four steps in a fixed order while heartbeat is missing", () => {
    renderIntegrations(
      withStages(stagesWith({ package: "unknown", init: "not_done" }), {
        installation: "not_installed",
        daemonRunning: false,
      }),
    );

    const rows = steps();
    expect(rows.map((row) => row.querySelector("strong")?.textContent)).toEqual([
      "패키지 설치",
      "heartbeat init",
      "heartbeat install-service",
      "dream 스킬",
    ]);
    expect(within(rows[0]).getByText("확인 불가")).toBeVisible();
    expect(within(rows[1]).getByText("남은 일")).toBeVisible();
    // 넷째만 선택 표기를 갖는다(R9).
    expect(within(rows[3]).getByText("선택")).toBeVisible();
    expect(rows.filter((row) => within(row).queryByText("선택"))).toHaveLength(1);
    // 기획서 확인 필요 1번이 절충의 조건으로 건 안내. 앱이 확인하지 않는 이유와 넘어가도 된다는 사실.
    expect(rows[0]).toHaveTextContent("PATH가 달라");
    expect(rows[0]).toHaveTextContent("이미 설치했다면 이 단계는 넘어가도 됩니다");
  });

  /**
   * 완료 조건 2·3. `HEARTBEAT.md`만 있고 서비스 등록이 확인되지 않은 상태다. `installation`이
   * `installed`이므로 마법사가 미설치 분기에 묶여 있지 않다는 확인이기도 하다(R8).
   */
  it("keeps guiding an installed heartbeat that still has a required step left", () => {
    renderIntegrations(withStages(stagesWith({ service: "unknown" }), { daemonRunning: false }));

    const rows = steps();
    expect(rows).toHaveLength(4);
    expect(screen.getByRole("region", { name: "연동" })).toHaveTextContent("설치됨 · 데몬 미실행");
    expect(within(rows[2]).getByText("확인 불가")).toBeVisible();
    // 판정 근거 경로가 그 단계 안에 있다.
    expect(rows[2]).toHaveTextContent("판정 근거: /Users/catze/Library/LaunchAgents/com.claude-heartbeat.plist");
    // R5. 1단계는 함의한 것이지 확인한 것이 아니다.
    expect(rows[0]).toHaveTextContent("다음 단계가 끝나 있어");
    expect(rows[0]).not.toHaveTextContent("확인했습니다");
    // R8이 겨냥한 화면. 마법사와 역할 잡 폼이 함께 보인다.
    expect(screen.getByRole("button", { name: "이 프로젝트에 역할 잡 설치" })).toBeInTheDocument();
  });

  // 기획서 완료 조건 8. 확인 불가를 미완료로 그리면 사용자는 이미 끝낸 일을 다시 한다.
  it("never draws an unconfirmed step as an unfinished one", () => {
    renderIntegrations(withStages(stagesWith({ package: "unknown", init: "not_done" })));

    const unfinished = steps()[1];
    const unconfirmed = steps()[2];
    expect(within(unfinished).getByText("남은 일")).toBeVisible();
    expect(within(unconfirmed).getByText("확인 불가")).toBeVisible();
    // 표식이 서로 다른 수식 클래스를 갖는다. 색이 갈리는 자리다.
    expect(unfinished.querySelector(".mark-not_done")).not.toBeNull();
    expect(unconfirmed.querySelector(".mark-not_done")).toBeNull();
    expect(unconfirmed.querySelector(".mark-unknown")).not.toBeNull();
    // 문구도 다르다. 한쪽은 실행하라고 하고 다른 쪽은 단정하지 않는다고 말한다.
    expect(unfinished).toHaveTextContent("아래 명령을 터미널에서 실행하세요");
    expect(unconfirmed).not.toHaveTextContent("아래 명령을 터미널에서 실행하세요");
    expect(unconfirmed).toHaveTextContent("단정하지 않습니다");
  });

  // DECISION-4F1083FF. 다른 라벨로 등록해 데몬이 실제로 도는 설치가 실존한다.
  it("says a service registered under another name already finishes the step", () => {
    renderIntegrations(withStages(stagesWith({ service: "unknown" }), { daemonRunning: true }));

    expect(steps()[2]).toHaveTextContent("표준 등록물을 아래 경로에서 찾지 못했습니다");
    expect(steps()[2]).toHaveTextContent("데몬은 이미 돌고 있는 것으로 보이며");
    expect(steps()[2]).toHaveTextContent("다른 이름으로 등록했다면 이 단계는 끝난 것입니다");
    cleanup();

    renderIntegrations(withStages(stagesWith({ service: "unknown" }), { daemonRunning: false }));

    expect(steps()[2]).toHaveTextContent("다른 이름으로 등록해 데몬이 이미 돌고 있다면 이 단계는 끝난 것입니다");
    expect(steps()[2]).not.toHaveTextContent("이미 돌고 있는 것으로 보이며");
  });

  // R10. 감지 수단이 없는 플랫폼. 앱은 OS 이름을 알지 못하므로 적지 않는다.
  it("says the platform offers no way to confirm the service step", () => {
    renderIntegrations(
      withStages(
        stagesWith({ service: "unknown" }).map((stage) =>
          stage.step === "service" ? { ...stage, evidence: null } : stage,
        ),
      ),
    );

    const row = steps()[2];
    expect(row).toHaveTextContent("이 플랫폼에서는 앱이 등록 여부를 확인할 방법이 없습니다");
    expect(row).not.toHaveTextContent("다른 이름으로 등록");
    expect(row).not.toHaveTextContent("판정 근거");
    // 명령은 여전히 안내한다. 감지하지 못하는 것과 안내하지 못하는 것은 다르다.
    expect(row).toHaveTextContent("heartbeat install-service");
  });

  // 완료 조건 2. dream 미완료는 접힘을 막지 않는다(R9).
  it("folds once the three required steps are done, dream or not", () => {
    renderIntegrations(withStages(stagesWith(requiredDone)));

    expect(steps()).toHaveLength(0);
    const card = screen.getByRole("article", { name: "claude-heartbeat" });
    expect(card).not.toHaveTextContent("앱이 하트비트를 대신 설치하지 않습니다");
    // 그 뒤의 화면은 지금과 같다.
    expect(screen.getByRole("button", { name: "이 프로젝트에 역할 잡 설치" })).toBeInTheDocument();
    expect(card).toHaveTextContent(".workflow/rules/wf-eligible.sh");
  });

  /**
   * 기획서 완료 조건 6. 사용자가 터미널에서 명령을 치고 앱으로 돌아오면 자동 재조회가 다음 스냅샷을
   * 준다. 화면은 그 스냅샷을 그리기만 하고 사용자 조작을 요구하지 않는다.
   */
  it("fills the check on the next snapshot without any user action", () => {
    const view = (stages: HeartbeatSetupStage[]) => (
      <IntegrationsView
        actions={{
          installHeartbeatJobs: vi.fn().mockResolvedValue(true),
          installDreamJob: vi.fn().mockResolvedValue(true),
        }}
        error={null}
        heartbeatRuns={runControls()}
        snapshot={snapshot({ heartbeat: heartbeat({ setupStages: stages }) })}
        writeError={null}
      />
    );

    const { rerender } = render(view(stagesWith({ package: "unknown", init: "not_done" })));
    for (const toggle of screen.getAllByRole("button", { name: "펼치기" })) {
      fireEvent.click(toggle);
    }
    expect(within(steps()[1]).getByText("남은 일")).toBeVisible();

    rerender(view(stagesWith({ package: "done", init: "done" })));

    expect(within(steps()[1]).getByText("완료")).toBeVisible();
    expect(steps()[1].querySelector(".mark-not_done")).toBeNull();
    // 3단계가 아직 확인 불가라 마법사는 그대로 있다.
    expect(steps()).toHaveLength(4);
  });

  // R11·완료 조건 7. 체크리스트가 되면서 "앱이 알아서 해 줄 것 같은" 인상이 생긴다.
  it("offers no button but the copy one and keeps saying the app does not install for you", () => {
    renderIntegrations(withStages(stagesWith({ package: "unknown", init: "not_done" })));

    const wizard = screen
      .getByRole("article", { name: "claude-heartbeat" })
      .querySelector(".heartbeat-setup") as HTMLElement;
    const buttons = within(wizard).queryAllByRole("button");
    // 첫 버튼은 가이드를 접는 토글이다. 표시를 바꿀 뿐이라는 것이 이름에 있다.
    const [foldToggle, ...copyButtons] = buttons;
    expect(foldToggle).toHaveTextContent("설치 가이드 접기");
    // 나머지는 단계마다 하나씩인 명령 복사 버튼이 전부다. 그 밖의 버튼은 없다.
    expect(copyButtons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "패키지 설치 명령 복사",
      "heartbeat init 명령 복사",
      "heartbeat install-service 명령 복사",
      "dream 스킬 명령 복사",
    ]);
    // 복사 버튼이 실행처럼 읽히지 않는다. 단계의 조작은 명령 복사까지다.
    for (const button of copyButtons) {
      expect(button.textContent).toBe("명령 복사");
      expect(button.getAttribute("aria-label")).toContain("복사");
      expect(button.getAttribute("aria-label")).not.toContain("실행");
    }
    // 마법사의 어느 버튼도 단계를 실행해 주는 것처럼 읽히지 않는다.
    for (const button of buttons) {
      expect(button.textContent).not.toContain("실행");
      expect(button.getAttribute("aria-label") ?? "").not.toContain("실행");
    }
    expect(wizard).toHaveTextContent("앱이 하트비트를 대신 설치하지 않습니다");
    // R7. 자동으로 다시 확인한다는 사실은 있고, 재확인 버튼과 주기의 숫자는 없다.
    expect(wizard).toHaveTextContent("자동으로 다시 확인해 이 목록을 채웁니다");
    expect(wizard).not.toHaveTextContent("다시 확인하세요");
    expect(wizard.textContent).not.toMatch(/\d+(\.\d+)?초/);
    expect(wizard).toHaveTextContent("github.com/wooson00308/claude-heartbeat");
    // R10. 명령과 경로는 payload에서 온 값뿐이다. 화면은 앱이 도는 플랫폼을 알지 못한다.
    for (const forbidden of ["macOS", "Windows", "Linux"]) {
      expect(wizard.textContent).not.toContain(forbidden);
    }
  });

  /**
   * 가이드 접기. 연동 카드의 접기와 같은 성질의 조작이라 같은 속성(`aria-expanded`)으로 확인한다.
   * 표시만 바꾸는 조작이므로 단계 상태·자동 재확인과 얽히지 않아야 한다.
   */
  describe("설치 가이드 접기", () => {
    function wizard(): HTMLElement {
      return screen
        .getByRole("article", { name: "claude-heartbeat" })
        .querySelector(".heartbeat-setup") as HTMLElement;
    }

    /** 가이드의 접기 토글. 카드 머리의 토글(`펼치기`·`접기`)과 이름이 겹치지 않는다. */
    function foldToggle(): HTMLElement {
      return within(wizard()).getByRole("button", { name: /^설치 가이드 (접기|펼치기)$/ });
    }

    it("starts expanded and counts only the finished required steps", () => {
      renderIntegrations(withStages(stagesWith({ package: "unknown", init: "not_done" })));

      expect(foldToggle()).toHaveAttribute("aria-expanded", "true");
      expect(steps()[0]).toBeVisible();
      // 확인 불가는 미완료가 아니다(R4). 요약은 끝난 단계만 세고 남은 개수를 말하지 않는다.
      expect(within(wizard()).getByText("필수 단계 0/3 완료")).toBeVisible();
    });

    it("folds the steps away but keeps the head line to open it again", async () => {
      renderIntegrations(withStages(stagesWith({ package: "unknown", init: "not_done" })));

      await userEvent.click(foldToggle());

      expect(foldToggle()).toHaveAttribute("aria-expanded", "false");
      expect(foldToggle()).toHaveTextContent("설치 가이드 펼치기");
      expect(steps()[0]).not.toBeVisible();
      // 접힌 채로도 다시 펼 수 있는 줄은 남는다.
      expect(within(wizard()).getByText("설치 가이드")).toBeVisible();
      expect(within(wizard()).getByText("필수 단계 0/3 완료")).toBeVisible();

      await userEvent.click(foldToggle());

      expect(foldToggle()).toHaveAttribute("aria-expanded", "true");
      expect(steps()[0]).toBeVisible();
    });

    /**
     * 완료 조건 6의 자동 재확인은 그대로다. 접어 둔 가이드를 다음 스냅샷이 다시 펼치지 않고, 갱신은
     * 접힌 채로도 들어와 있다.
     */
    it("stays folded while the next snapshot refreshes the checks", async () => {
      const view = (stages: HeartbeatSetupStage[]) => (
        <IntegrationsView
          actions={{
            installHeartbeatJobs: vi.fn().mockResolvedValue(true),
            installDreamJob: vi.fn().mockResolvedValue(true),
          }}
          error={null}
          heartbeatRuns={runControls()}
          snapshot={snapshot({ heartbeat: heartbeat({ setupStages: stages }) })}
          writeError={null}
        />
      );

      const { rerender } = render(view(stagesWith({ package: "unknown", init: "not_done" })));
      for (const toggle of screen.getAllByRole("button", { name: "펼치기" })) {
        fireEvent.click(toggle);
      }
      await userEvent.click(foldToggle());
      expect(foldToggle()).toHaveAttribute("aria-expanded", "false");

      rerender(view(stagesWith({ package: "done", init: "done" })));

      expect(foldToggle()).toHaveAttribute("aria-expanded", "false");
      expect(steps()[1]).not.toBeVisible();
      expect(within(wizard()).getByText("필수 단계 2/3 완료")).toBeVisible();

      await userEvent.click(foldToggle());

      expect(within(steps()[1]).getByText("완료")).toBeVisible();
    });

    /**
     * SPEC-019 완료 조건 12. 접기는 표시만 바꾼다. 접힌 채로도 단계가 DOM에 남아 복사가 그대로
     * 동작하고, 카드 머리의 배지·경고 표시는 가이드의 접힘과 무관하다.
     */
    it("keeps the copy and the card head unchanged while folded", async () => {
      clipboard.copy.mockReset();
      clipboard.copy.mockResolvedValue(true);
      renderIntegrations(withStages(stagesWith({ package: "unknown", init: "not_done" })));
      const head = () =>
        screen
          .getByRole("article", { name: "claude-heartbeat" })
          .querySelector(".integration-item-head") as HTMLElement;
      const headBefore = head().textContent;

      await userEvent.click(foldToggle());

      expect(head().textContent).toBe(headBefore);
      // 감춰진 자리라 보조 기술의 트리 밖이고(`hidden`), 클릭 대신 이벤트를 직접 보낸다. 확인할
      // 것은 접혔다고 복사 경로가 달라지지 않는다는 것이다.
      fireEvent.click(
        within(steps()[1]).getByRole("button", { hidden: true, name: /명령 복사$/ }),
      );

      await waitFor(() => expect(clipboard.copy).toHaveBeenCalledWith("heartbeat init"));

      await userEvent.click(foldToggle());

      expect(within(steps()[1]).getByText("복사됨")).toBeVisible();
    });

    /**
     * 접힘의 기억(SPEC-019 R1). 연동 뷰는 조건부 렌더라 다른 화면을 다녀오는 것과 앱을 다시 여는
     * 것이 같은 경로다. 카드 접힘 기억과 같이 여기서도 언마운트 뒤 재렌더로 그 경로를 밟는다.
     */
    describe("접힘 기억", () => {
      const GUIDE_KEY = "workflow-labs.heartbeat-setup-guide-collapse.v1";
      const COLLAPSE_KEY = "workflow-labs.integration-collapse.v1";

      /** 필수 단계가 남아 마법사가 보이는 뷰. */
      function openView() {
        renderIntegrations(withStages(stagesWith({ package: "unknown", init: "not_done" })));
      }

      function reopenView() {
        cleanup();
        openView();
      }

      // 완료 조건 2. 저장된 값이 접힘이면 처음 그릴 때부터 접혀 있다.
      it("opens folded when the remembered value says folded", () => {
        storage.set(GUIDE_KEY, "false");

        openView();

        expect(foldToggle()).toHaveAttribute("aria-expanded", "false");
        expect(steps()[0]).not.toBeVisible();
        expect(within(wizard()).getByText("필수 단계 0/3 완료")).toBeVisible();
      });

      // 완료 조건 1. 접어 둔 상태가 뷰를 떠났다 돌아와도 남는다.
      it("stays folded after leaving the view and coming back", async () => {
        openView();
        await userEvent.click(foldToggle());

        reopenView();

        expect(foldToggle()).toHaveAttribute("aria-expanded", "false");
        expect(steps()[0]).not.toBeVisible();
      });

      /**
       * 완료 조건 3. 펼침도 같게 기억한다. 접힘을 저장해 둔 상태에서 시작해야, 다시 편 선택이 남은
       * 것과 기본값이 펼침이라 펼쳐진 것이 갈린다.
       */
      it("remembers the guide that was opened again", async () => {
        storage.set(GUIDE_KEY, "false");
        openView();

        await userEvent.click(foldToggle());
        expect(storage.get(GUIDE_KEY)).toBe("true");

        reopenView();

        expect(foldToggle()).toHaveAttribute("aria-expanded", "true");
        expect(steps()[0]).toBeVisible();
      });

      // 완료 조건 5. 두 접힘은 다른 축이다. 카드를 접었다 펴도 가이드의 상태는 그대로다.
      it("keeps its own state while the heartbeat card folds and opens", async () => {
        openView();
        await userEvent.click(foldToggle());

        toggleCard("claude-heartbeat");
        toggleCard("claude-heartbeat");

        expect(foldToggle()).toHaveAttribute("aria-expanded", "false");

        await userEvent.click(foldToggle());
        toggleCard("claude-heartbeat");
        toggleCard("claude-heartbeat");

        expect(foldToggle()).toHaveAttribute("aria-expanded", "true");
        expect(steps()[0]).toBeVisible();
      });

      // 완료 조건 6. 키가 갈려 있어 가이드를 접어도 카드 접힘 기억은 손대지 않는다.
      it("leaves the integration collapse memory untouched", async () => {
        openView();
        const remembered = storage.get(COLLAPSE_KEY);

        await userEvent.click(foldToggle());

        expect(storage.get(COLLAPSE_KEY)).toBe(remembered);
        expect(storage.get(GUIDE_KEY)).toBe("false");
      });

      /**
       * 완료 조건 7. 읽을 수 없는 값이면 기본값(펼침)으로 그린다. 표시 상태 하나를 못 읽은 것은
       * 사용자에게 알릴 일이 아니라 오류 문구도 나오지 않는다.
       */
      it("renders expanded and shows no error when the remembered value cannot be used", () => {
        // JSON으로 읽히지 않는 값과 형식이 다른 값(문자열) 둘 다 같은 자리로 떨어진다.
        for (const broken of ["{not json", JSON.stringify("folded")]) {
          storage.set(GUIDE_KEY, broken);

          openView();

          expect(foldToggle()).toHaveAttribute("aria-expanded", "true");
          expect(steps()[0]).toBeVisible();
          expect(wizard().querySelector(".integration-warning")).toBeNull();
          expect(screen.queryByText("확인할 경고가 있습니다")).toBeNull();
          cleanup();
        }
      });

      // 완료 조건 8. 읽기·쓰기가 던져도 화면은 그려지고 이번에 고른 상태는 화면에 반영된다.
      it("keeps the guide toggle working when the storage throws on every access", async () => {
        vi.stubGlobal("localStorage", {
          getItem: () => {
            throw new Error("접근이 차단되었습니다");
          },
          setItem: () => {
            throw new Error("접근이 차단되었습니다");
          },
        });

        openView();

        expect(foldToggle()).toHaveAttribute("aria-expanded", "true");

        await userEvent.click(foldToggle());

        expect(foldToggle()).toHaveAttribute("aria-expanded", "false");
        expect(steps()[0]).not.toBeVisible();
      });

      /**
       * 완료 조건 9. 마법사가 사라지는 것은 사용자의 선택과 다른 일이다. 보이지 않는 동안 기억을
       * 지우면 필수 단계가 잠시 완료로 보였다 돌아오는 것만으로 선택이 사라진다(R3).
       */
      it("comes back folded after the finished wizard disappears and returns", async () => {
        openView();
        await userEvent.click(foldToggle());

        cleanup();
        renderIntegrations(withStages(stagesWith(requiredDone)));
        expect(
          screen.getByRole("article", { name: "claude-heartbeat" }).querySelector(".heartbeat-setup"),
        ).toBeNull();

        reopenView();

        expect(foldToggle()).toHaveAttribute("aria-expanded", "false");
        expect(steps()[0]).not.toBeVisible();
      });
    });
  });

  /**
   * SPEC-016 R6의 복사. 클립보드 모듈을 대신했으므로 여기서 고정되는 것은 화면이 무엇을 넘기고
   * 결과를 어디에 보이느냐까지다. 실제로 터미널에 붙여 넣어지는지는 사용자 QA의 몫이다.
   */
  describe("명령 복사", () => {
    beforeEach(() => {
      clipboard.copy.mockReset();
      clipboard.copy.mockResolvedValue(true);
    });

    /** 마법사가 보이는 상태로 그린다. 단계 상태는 복사와 무관하므로 픽스처 그대로 쓴다. */
    function renderWizard() {
      renderIntegrations(withStages(stagesWith({ package: "unknown", init: "not_done" })));
    }

    function copyButton(index: number) {
      return within(steps()[index]).getByRole("button", { name: /명령 복사$/ });
    }

    // R6. 화면이 조각을 다시 조립하지 않는다는 확인이다. 넘어가는 값이 그 단계의 명령 원문 그대로다.
    it("hands the step's own command to the clipboard untouched", async () => {
      renderWizard();

      await userEvent.click(copyButton(1));

      expect(clipboard.copy).toHaveBeenCalledTimes(1);
      expect(clipboard.copy).toHaveBeenCalledWith("heartbeat init");
      expect(steps()[1].querySelector("pre code")?.textContent).toBe("heartbeat init");
    });

    // 완료 조건 1. 어느 단계의 명령이 복사됐는지 그 단계 안에서 보인다.
    it("marks the copied step and no other", async () => {
      renderWizard();

      await userEvent.click(copyButton(2));

      expect(await within(steps()[2]).findByText("복사됨")).toBeVisible();
      expect(screen.getAllByText("복사됨")).toHaveLength(1);
    });

    /**
     * 완료 조건 2. 복사는 편의이고, 그것이 안 되는 환경에서도 마법사는 제 일을 해야 한다. 실패를
     * 전역 오류 통로로 보내지 않는다 — `writeError`는 관리 블록 쓰기 실패의 자리다.
     */
    it("keeps the command on screen and stays local when the copy fails", async () => {
      clipboard.copy.mockResolvedValue(false);
      renderWizard();

      await userEvent.click(copyButton(2));

      const row = steps()[2];
      expect(await within(row).findByText(/복사하지 못했습니다/)).toBeVisible();
      expect(within(row).getByText(/직접 선택해 복사하세요/)).toBeVisible();
      // 명령 원문은 그대로 남는다. 버튼이 원문을 대체하지 않는다.
      expect(row.querySelector("pre code")?.textContent).toBe("heartbeat install-service");
      expect(within(row).queryByText("복사됨")).toBeNull();
      // 실패는 그 단계 안에서만 알린다.
      expect(screen.getByRole("article", { name: "claude-heartbeat" })).not.toHaveTextContent(
        "역할 잡을 쓰지 못했습니다",
      );
    });

    /**
     * 두 단계에 동시에 "복사됨"이 떠 있으면 사용자는 무엇이 클립보드에 있는지 알 수 없다. 마지막에
     * 복사한 단계에만 표시가 남는다.
     */
    it("moves the mark to the step copied last", async () => {
      renderWizard();

      await userEvent.click(copyButton(1));
      expect(await within(steps()[1]).findByText("복사됨")).toBeVisible();
      await userEvent.click(copyButton(3));

      expect(await within(steps()[3]).findByText("복사됨")).toBeVisible();
      expect(within(steps()[1]).queryByText("복사됨")).toBeNull();
      expect(screen.getAllByText("복사됨")).toHaveLength(1);
      expect(clipboard.copy).toHaveBeenNthCalledWith(2, "heartbeat install dream");
    });
  });
});

/**
 * SPEC-020 R1·R2·R3·R7. 역할마다 그 잡 하나를 지금 실행하는 액션과, 되돌릴 수 없는 조작임을 밝히는
 * 확인 단계.
 *
 * 진행 중 여부의 주인은 훅이라 카드에는 `heartbeatRuns`로만 들어온다. 그래서 여기서 진행 중을 만드는
 * 방법도 카드를 조작하는 것이 아니라 실행 통로에 잡 이름을 담아 넘기는 것이다.
 */
describe("IntegrationsView 하트비트 잡 지금 실행", () => {
  const roleJob = (role: string): ManagedRoleJob => ({
    role,
    interval: "30m",
    maxPer: "4/24h",
    model: "opus",
    timeout: "20m",
    appOwnedDrift: [],
  });

  /** 세 역할 모두가 관리 블록에 있는 상태. 실행 액션이 전부 눌리는 최소 조건이다. */
  const allJobs = ["planner", "architect", "developer"].map(roleJob);

  /** 백엔드가 아는 개발자 잡 이름. 기본 스냅샷에서는 화면 표기와 같은 값이다. */
  const developerJobName = "wf-developer-projects-workflow-labs";

  function state({
    managedJobs = allJobs,
    jobNames = {},
    runs = {},
    quotas = {},
    daemonRunning = true,
  }: {
    managedJobs?: ManagedRoleJob[];
    jobNames?: Record<string, string>;
    runs?: Record<string, HeartbeatJobRun>;
    quotas?: Record<string, JobQuota>;
    daemonRunning?: boolean;
  } = {}): IntegrationsState {
    return {
      snapshot: snapshot({
        heartbeat: heartbeat({
          daemonRunning,
          managedJobs,
          roles: roleStatuses(runs, quotas).map((status) => ({
            ...status,
            jobName: jobNames[status.role] ?? status.jobName,
          })),
        }),
      }),
      error: null,
      writeError: null,
    };
  }

  /**
   * 쓰기 액션 둘과 실행 통로를 모두 붙잡은 렌더. 실행 경로가 쓰기를 부르지 않는다는 것과, 조회 갱신이
   * 실행을 부르지 않는다는 것을 같은 자리에서 볼 수 있어야 해서 이 describe는 자기 렌더를 갖는다.
   */
  function renderRuns(
    integrations: IntegrationsState = state(),
    controls: HeartbeatRunControls = runControls(),
  ) {
    const install = vi.fn().mockResolvedValue(true);
    const dream = vi.fn().mockResolvedValue(true);
    const view = (next: IntegrationsState, runs: HeartbeatRunControls) => (
      <IntegrationsView
        actions={{ installHeartbeatJobs: install, installDreamJob: dream }}
        error={next.error}
        heartbeatRuns={runs}
        snapshot={next.snapshot}
        writeError={next.writeError}
      />
    );
    const { rerender, unmount } = render(view(integrations, controls));
    for (const toggle of screen.queryAllByRole("button", { name: "펼치기" })) {
      fireEvent.click(toggle);
    }
    return {
      install,
      dream,
      run: controls.run,
      unmount,
      poll: (next: IntegrationsState, runs: HeartbeatRunControls = controls) =>
        rerender(view(next, runs)),
    };
  }

  const runAction = (label: string) => screen.getByRole("button", { name: `${label} 잡 지금 실행` });
  const confirmRun = () => screen.getByRole("button", { name: "확인하고 지금 실행" });

  /** 확인 화면을 열고 확인 버튼까지 누른다. 실행은 이 두 조작으로만 나간다. */
  function pressRun(label: string) {
    fireEvent.click(runAction(label));
    fireEvent.click(confirmRun());
  }

  // 완료 조건 1. 세 역할 모두의 자리에 그 역할 잡을 지금 실행하는 액션이 있다.
  it("puts a run action on every role", () => {
    renderRuns();

    for (const label of ["기획자", "프로젝트 아키텍트", "개발자"]) {
      expect(within(jobRow(label)).getByRole("button", { name: `${label} 잡 지금 실행` })).toBeEnabled();
    }
  });

  /**
   * 완료 조건 2. 실행은 백엔드가 아는 이름으로 나가야 한다. 행에 그려지는 `wf-{role}{slug}` 표기는
   * 차이 표시용이라 그 값과 다를 수 있고, 다를 때 따라가는 쪽은 스냅샷이다.
   */
  it("sends the job name from the snapshot, not the one drawn on the row", async () => {
    const { run } = renderRuns(state({ jobNames: { developer: "wf-dev-renamed-by-user" } }));

    pressRun("개발자");

    await waitFor(() => expect(run).toHaveBeenCalledWith("wf-dev-renamed-by-user"));
    expect(run).toHaveBeenCalledTimes(1);
    // 화면 표기는 여전히 다른 값이다. 두 값이 갈라져 있어야 이 확인이 뜻을 갖는다.
    expect(jobRow("개발자")).toHaveTextContent(developerJobName);
  });

  // 완료 조건 3. 관리 블록에 없는 역할은 실행할 수 없고, 먼저 잡을 설치해야 한다는 것이 그 자리에 있다.
  it("cannot run a role that has no job in the managed block", () => {
    const { run } = renderRuns(state({ managedJobs: [roleJob("developer")] }));

    const planner = jobRow("기획자");
    expect(within(planner).getByRole("button", { name: "기획자 잡 지금 실행" })).toBeDisabled();
    expect(planner).toHaveTextContent("관리 블록에 없어 지금 실행할 수 없습니다");
    expect(planner).toHaveTextContent("잡을 설치한 뒤에 실행할 수 있습니다");
    expect(runAction("개발자")).toBeEnabled();
    expect(run).not.toHaveBeenCalled();
  });

  /**
   * 완료 조건 4. 실행 액션은 폼과 무관하다. 저장하지 않은 편집이 있어도 대상과 호출 인자가 달라지지
   * 않고, 편집한 값도 실행 때문에 사라지지 않는다.
   */
  it("keeps the call arguments after an unsaved form edit", async () => {
    const { run } = renderRuns();

    fireEvent.change(screen.getByLabelText("개발자 주기"), { target: { value: "5m" } });
    pressRun("개발자");

    await waitFor(() => expect(run).toHaveBeenCalledWith(developerJobName));
    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("개발자 주기")).toHaveValue("5m");
  });

  // 완료 조건 5. 실행 경로에서는 어떤 쓰기 액션도 부르지 않는다.
  it("writes nothing on the run path", async () => {
    const { install, dream, run } = renderRuns();

    pressRun("개발자");

    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(install).not.toHaveBeenCalled();
    expect(dream).not.toHaveBeenCalled();
  });

  /**
   * 완료 조건 6. 확인 화면이 밝히는 셋과, 이 화면이 파일을 쓰지 않는다는 것. 같은 자리의 저장·재설정
   * 확인 화면이 "확인 후 아래 두 파일을 씁니다"로 시작하므로 첫 줄에서 갈라 준다.
   */
  it("says what the run does before it starts", () => {
    const { run } = renderRuns();

    fireEvent.click(runAction("개발자"));

    const confirm = screen.getByRole("group", { name: "개발자 잡 지금 실행 확인" });
    expect(confirm).toHaveTextContent(developerJobName);
    expect(confirm).toHaveTextContent("모델 세션 하나를 지금 띄웁니다");
    expect(confirm).toHaveTextContent("되돌릴 수 없습니다");
    expect(confirm).toHaveTextContent("조건과 실행 한도는 그대로 적용됩니다");
    expect(confirm).toHaveTextContent("이 조작은 어떤 파일도 쓰지 않습니다");
    // 확인 전에는 아직 아무것도 나가지 않았다.
    expect(run).not.toHaveBeenCalled();
  });

  /**
   * 완료 조건 7. 확인 버튼을 두 번 눌러도 실행은 한 번이다. 누르는 순간 확인 화면이 닫히므로 두 번째
   * 조작이 닿을 버튼이 남지 않는다.
   */
  it("runs once when the confirm button is pressed twice", async () => {
    const { run } = renderRuns();

    fireEvent.click(runAction("개발자"));
    const confirm = confirmRun();
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("group", { name: "개발자 잡 지금 실행 확인" })).toBeNull();
  });

  /**
   * 완료 조건 7. 진행 중에는 그 역할의 버튼을 다시 누를 수 없고, 진행 중이라는 것이 화면에 남는다.
   * 실측에서 세션 하나가 206초였으므로 이 표시가 없으면 사용자는 눌리지 않았다고 판단한다.
   */
  it("marks the running role and blocks a second press", () => {
    renderRuns(state(), runControls({ running: [developerJobName] }));

    expect(runAction("개발자")).toBeDisabled();
    expect(within(jobRow("개발자")).getByRole("status")).toHaveTextContent("실행하고 있습니다");
  });

  // 완료 조건 8. 한 역할이 진행 중이어도 다른 역할의 실행 액션은 그대로 눌린다.
  it("leaves the other roles runnable while one job is running", () => {
    renderRuns(state(), runControls({ running: [developerJobName] }));

    expect(runAction("개발자")).toBeDisabled();
    expect(runAction("기획자")).toBeEnabled();
    expect(runAction("프로젝트 아키텍트")).toBeEnabled();
    expect(within(jobRow("기획자")).queryByRole("status")).toBeNull();
  });

  /**
   * 완료 조건 9. 실행이 끝나면 `running`에서 이름이 빠지므로 액션이 저절로 되돌아온다. 성공·실패·
   * 건너뜀 어느 결과로 끝나도 같다 — 화면은 결과가 아니라 진행 중 목록을 보고 판정한다.
   */
  it.each(["success", "failure", "skipped"])(
    "returns the action when a %s run ends",
    (result) => {
      const { poll } = renderRuns(state(), runControls({ running: [developerJobName] }));
      expect(runAction("개발자")).toBeDisabled();

      poll(
        state({ runs: { developer: { at: "2026-08-04 09:00:00", result, durationSeconds: 206 } } }),
        runControls({ running: [] }),
      );

      expect(runAction("개발자")).toBeEnabled();
      expect(within(jobRow("개발자")).queryByRole("status")).toBeNull();
    },
  );

  /**
   * 완료 조건 10. 진행 중 표시의 주인은 카드가 아니라 훅이다. 연동 뷰는 조건부 렌더라 다른 메뉴를
   * 다녀오면 언마운트되는데, 카드가 상태를 들고 있었다면 그 순간 표시가 사라진다.
   */
  it("keeps the running mark across a remount", () => {
    const controls = runControls({ running: [developerJobName] });
    const { unmount } = renderRuns(state(), controls);
    expect(runAction("개발자")).toBeDisabled();

    unmount();
    renderRuns(state(), controls);

    expect(runAction("개발자")).toBeDisabled();
    expect(within(jobRow("개발자")).getByRole("status")).toHaveTextContent("실행하고 있습니다");
  });

  /**
   * 완료 조건 11(기획서 완료 조건 20). 2.5초 조회가 스냅샷을 몇 번을 갈아 끼워도 실행은 나가지 않는다.
   * 실행 호출은 확인 화면의 버튼에서만 나온다(R7).
   */
  it("never runs on snapshot refreshes alone", () => {
    const { poll, run } = renderRuns();

    poll(state({ runs: { developer: { at: "2026-08-04 09:00:00", result: "success", durationSeconds: 206 } } }));
    poll(state({ managedJobs: [roleJob("developer")] }));
    poll(state());

    expect(run).not.toHaveBeenCalled();
  });

  /**
   * 완료 조건 12(기획서 완료 조건 19). 데몬이 도는 상태에서도 막지 않는다. 데몬과 겹칠 수 있다는
   * 것이 실행을 막을 이유는 아니라서 `daemonRunning`을 실행 가능 판정에 쓰지 않는다.
   */
  it("runs while the daemon is running", async () => {
    const { run } = renderRuns(state({ daemonRunning: true }));

    expect(runAction("개발자")).toBeEnabled();
    pressRun("개발자");

    await waitFor(() => expect(run).toHaveBeenCalledWith(developerJobName));
  });

  // 완료 조건 15. 저장·재설정 확인 화면과 실행 확인 화면은 같은 자리를 쓰므로 한 번에 하나만 연다.
  it("opens only one confirm at a time", () => {
    renderRuns();
    const saveConfirm = { name: "역할 잡 설치 확인" };
    const resetConfirm = { name: "개발자 기본값 재설정 확인" };
    const runConfirm = { name: "개발자 잡 지금 실행 확인" };

    fireEvent.click(screen.getByRole("button", { name: "역할 잡 변경 사항 저장" }));
    expect(screen.getByRole("group", saveConfirm)).toBeInTheDocument();

    fireEvent.click(runAction("개발자"));
    expect(screen.queryByRole("group", saveConfirm)).toBeNull();
    expect(screen.getByRole("group", runConfirm)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "개발자 기본값으로 재설정" }));
    expect(screen.queryByRole("group", runConfirm)).toBeNull();
    expect(screen.getByRole("group", resetConfirm)).toBeInTheDocument();

    fireEvent.click(runAction("개발자"));
    expect(screen.queryByRole("group", resetConfirm)).toBeNull();
    expect(screen.getByRole("group", runConfirm)).toBeInTheDocument();
  });

  // 폼을 건드리면 실행 확인도 닫힌다. 기존 두 확인 화면이 이미 그렇게 동작한다.
  it("closes the run confirm when the form is edited", () => {
    renderRuns();
    fireEvent.click(runAction("개발자"));
    expect(screen.getByRole("group", { name: "개발자 잡 지금 실행 확인" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("개발자 주기"), { target: { value: "45m" } });

    expect(screen.queryByRole("group", { name: "개발자 잡 지금 실행 확인" })).toBeNull();
  });

  // 취소는 아무것도 부르지 않고 확인 화면만 닫는다.
  it("cancels without running", () => {
    const { run } = renderRuns();

    fireEvent.click(runAction("개발자"));
    fireEvent.click(within(screen.getByRole("group", { name: "개발자 잡 지금 실행 확인" })).getByRole("button", { name: "취소" }));

    expect(screen.queryByRole("group", { name: "개발자 잡 지금 실행 확인" })).toBeNull();
    expect(run).not.toHaveBeenCalled();
    expect(runAction("개발자")).toBeEnabled();
  });

  /**
   * SPEC-020 R4·R5·R6. 구분해야 하는 상태가 셋이다. 앱이 실행을 시작하지 못한 것, 실행은 됐는데
   * 세션이 뜨지 않은 것(정상 동작), 세션이 떠서 결과가 남은 것. 앱이 아는 것은 첫째뿐이다.
   */
  describe("실행 실패와 실행 종료", () => {
    /** 백엔드가 준 실패 값. 명령 원문도 백엔드의 것이라 화면이 다시 조립하지 않는다(R6). */
    function runFailure(jobName = developerJobName): HeartbeatRunFailure {
      return {
        jobName,
        message: "heartbeat 실행 파일을 찾지 못했습니다.",
        command: `heartbeat once -j ${jobName}`,
      };
    }

    /** 실행을 시작하지 못하는 실행 통로. 훅이 거짓을 돌려주는 자리다. */
    const failing = () => runControls({ run: vi.fn().mockResolvedValue(false) });

    /** 설치 마법사의 단계 상태 표식. 실행 실패가 이 값을 바꾸지 않는다는 것을 이 목록으로 본다. */
    function stepMarks(): (string | null)[] {
      return Array.from(
        screen
          .getByRole("article", { name: "claude-heartbeat" })
          .querySelectorAll(".heartbeat-setup-mark"),
      ).map((mark) => mark.textContent);
    }

    const copyButton = (label: string) =>
      within(jobRow(label)).getByRole("button", { name: `${label} 잡 실행 명령 복사` });

    beforeEach(() => {
      clipboard.copy.mockReset();
      clipboard.copy.mockResolvedValue(true);
    });

    /**
     * 완료 조건 1(기획서 완료 조건 15). 앱의 조작 실패이지 잡의 실행 결과가 아니다. 하트비트는 이런
     * 일이 있었는지 모르므로 마지막 실행 기록은 그대로이고, 실행이 끝났다는 안내도 뜨지 않는다.
     */
    it("shows a failed start as the app's own failure and leaves the run record alone", async () => {
      const before = state({
        runs: { developer: { at: "2026-08-04 09:00:00", result: "success", durationSeconds: 206 } },
      });
      const controls = failing();
      const { poll } = renderRuns(before, controls);

      pressRun("개발자");
      await waitFor(() => expect(controls.run).toHaveBeenCalledTimes(1));
      poll(before, runControls({ failure: runFailure() }));

      const row = jobRow("개발자");
      expect(row).toHaveTextContent("앱이 개발자 잡 실행을 시작하지 못했습니다");
      expect(row).toHaveTextContent("하트비트는 이 실패를 모릅니다");
      expect(row).toHaveTextContent("heartbeat 실행 파일을 찾지 못했습니다.");
      // 실행 기록은 앱이 쓰지 않는다. 실패 전의 값이 그대로 있다.
      expect(within(row).getByText("성공")).toBeVisible();
      expect(row).toHaveTextContent("206.0초");
      // 실행이 끝났다는 안내는 그 자리를 실패 표시에 내준다.
      expect(row).not.toHaveTextContent("실행 요청이 끝났습니다");
    });

    /**
     * 완료 조건 2(기획서 완료 조건 16). 사용자가 직접 같은 일을 할 수 있어야 한다. 복사에 넘어가는
     * 값은 백엔드가 준 명령 원문 그대로다.
     */
    it("hands the backend's command to the clipboard untouched", async () => {
      renderRuns(state(), runControls({ failure: runFailure() }));

      const row = jobRow("개발자");
      expect(row.querySelector(".heartbeat-run-failure-command code")?.textContent).toBe(
        `heartbeat once -j ${developerJobName}`,
      );

      await userEvent.click(copyButton("개발자"));

      expect(clipboard.copy).toHaveBeenCalledTimes(1);
      expect(clipboard.copy).toHaveBeenCalledWith(`heartbeat once -j ${developerJobName}`);
      expect(await within(jobRow("개발자")).findByText("복사됨")).toBeVisible();
    });

    /**
     * 완료 조건 3. 복사는 편의이고 그것이 안 되는 환경에서도 사용자가 할 일은 남아야 한다. 명령
     * 원문이 화면에 남고, 직접 선택하라는 말을 마법사와 같은 어법으로 한다.
     */
    it("keeps the command on screen and says so when the copy fails", async () => {
      clipboard.copy.mockResolvedValue(false);
      renderRuns(state(), runControls({ failure: runFailure() }));

      await userEvent.click(copyButton("개발자"));

      const row = jobRow("개발자");
      expect(await within(row).findByText(/복사하지 못했습니다/)).toBeVisible();
      expect(within(row).getByText(/직접 선택해 복사하세요/)).toBeVisible();
      expect(row.querySelector(".heartbeat-run-failure-command code")?.textContent).toBe(
        `heartbeat once -j ${developerJobName}`,
      );
      expect(within(row).queryByText("복사됨")).toBeNull();
    });

    /**
     * 완료 조건 4(기획서 완료 조건 17). 실패 문구는 사용자가 읽을 시간을 갖는다. 2.5초 조회가 몇 번을
     * 돌아도 지워지지 않는다 — 카드는 이 값을 들지 않고 훅이 준 것을 그리기만 한다.
     */
    it("keeps the failure through repeated snapshot refreshes", () => {
      const controls = runControls({ failure: runFailure() });
      const { poll } = renderRuns(state(), controls);

      poll(
        state({
          runs: { developer: { at: "2026-08-04 09:00:00", result: "skipped", durationSeconds: 1 } },
        }),
        controls,
      );
      poll(state({ daemonRunning: false }), controls);
      poll(state(), controls);

      expect(jobRow("개발자")).toHaveTextContent("앱이 개발자 잡 실행을 시작하지 못했습니다");
    });

    /**
     * 완료 조건 5(기획서 완료 조건 18). 실행 파일을 못 찾은 것이 미설치 판정으로 번역되지 않는다.
     * SPEC-016 R5의 "PATH로 설치를 판정하지 않는다"가 그대로 유지되는지 단계 상태로 본다.
     */
    it("leaves the setup wizard untouched when the run cannot start", async () => {
      const controls = failing();
      const { poll } = renderRuns(state(), controls);
      const before = stepMarks();

      pressRun("개발자");
      await waitFor(() => expect(controls.run).toHaveBeenCalledTimes(1));
      poll(state(), runControls({ failure: runFailure() }));

      expect(jobRow("개발자")).toHaveTextContent("앱이 개발자 잡 실행을 시작하지 못했습니다");
      // 비교가 뜻을 가지려면 애초에 읽을 표식이 있어야 한다.
      expect(before).toContain("완료");
      expect(stepMarks()).toEqual(before);
    });

    /**
     * 완료 조건 6. 잡 이름에 프로젝트 slug가 들어 있어 다른 프로젝트·다른 역할의 실패가 이 자리에
     * 새지 않는다. 판정은 이름 대조 하나다.
     */
    it("shows the failure only in the row of the job that failed", () => {
      renderRuns(state(), runControls({ failure: runFailure("wf-planner-projects-workflow-labs") }));

      expect(jobRow("기획자")).toHaveTextContent("앱이 기획자 잡 실행을 시작하지 못했습니다");
      expect(jobRow("개발자")).not.toHaveTextContent("실행을 시작하지 못했습니다");
      expect(jobRow("프로젝트 아키텍트")).not.toHaveTextContent("실행을 시작하지 못했습니다");
    });

    /**
     * 완료 조건 7(기획서 완료 조건 13). 말할 수 있는 것은 셋뿐이다. 실행 요청이 끝났다는 것, 세션이
     * 뜨지 않았을 수 있다는 것, 결과는 마지막 실행 기록에 나온다는 것. "성공했습니다"라고 적지 않는다.
     */
    it("says the run request ended without claiming a result", async () => {
      renderRuns();

      pressRun("개발자");

      const note = await within(jobRow("개발자")).findByText(/실행 요청이 끝났습니다/);
      expect(note).toHaveAttribute("role", "status");
      expect(note).toHaveTextContent("세션이 뜨지 않았을 수 있습니다");
      expect(note).toHaveTextContent("마지막 실행 기록에 나옵니다");
      expect(note).not.toHaveTextContent("성공");
      expect(within(jobRow("기획자")).queryByText(/실행 요청이 끝났습니다/)).toBeNull();
    });

    /**
     * 완료 조건 8(기획서 완료 조건 13). 세션이 뜨지 않은 것은 실패가 아니다. 실행 뒤에 온 스냅샷이
     * 그 둘 중 하나여도 결과 낱말은 지금 쓰는 것 그대로다.
     */
    it.each([
      ["skipped", "건너뜀"],
      ["quota_skipped", "건너뜀 · 실행 한도 도달"],
    ])("keeps the %s wording for a run that raised no session", async (result, label) => {
      const { poll } = renderRuns();

      pressRun("개발자");
      await within(jobRow("개발자")).findByText(/실행 요청이 끝났습니다/);
      poll(state({ runs: { developer: { at: "2026-08-04 09:00:00", result, durationSeconds: 1 } } }));

      const row = jobRow("개발자");
      expect(within(row).getByText(label)).toBeVisible();
      expect(within(row).queryByText("실패")).toBeNull();
    });

    /**
     * 완료 조건 10(기획서 완료 조건 11). 갱신은 지금의 조회 주기를 타고 온다. 실행이 끝났다고 카드가
     * 별도 조회를 부르지 않으므로, 확인하는 방법은 갱신된 스냅샷을 넣어 보는 것이다.
     */
    it("shows the refreshed run record and quota from the next snapshot", async () => {
      const { poll, run } = renderRuns();

      pressRun("개발자");
      await waitFor(() => expect(run).toHaveBeenCalledTimes(1));

      poll(
        state({
          runs: {
            developer: { at: "2026-08-04 09:03:26", result: "success", durationSeconds: 206 },
          },
          quotas: {
            developer: {
              kind: "counted",
              used: 3,
              limit: 6,
              window: "24h",
              exhausted: false,
              recoversAt: null,
            },
          },
        }),
      );

      const row = jobRow("개발자");
      expect(within(row).getByText("성공")).toBeVisible();
      expect(row).toHaveTextContent("2026-08-04 09:03:26 (로컬 시각)");
      expect(row).toHaveTextContent("206.0초");
      expect(row).toHaveTextContent("3/6 · 24h 기준");
      // 갱신을 얻으려고 다시 실행하지 않는다.
      expect(run).toHaveBeenCalledTimes(1);
    });

    /** 완료 조건 12. 지난 실행의 안내가 새 실행 위에 남으면 안 된다. */
    it("clears the finished note when the next run of that role starts", async () => {
      let finishSecondRun: (started: boolean) => void = () => {};
      const run = vi
        .fn()
        .mockResolvedValueOnce(true)
        .mockImplementationOnce(
          () => new Promise<boolean>((resolve) => { finishSecondRun = resolve; }),
        );
      renderRuns(state(), runControls({ run }));

      pressRun("개발자");
      await within(jobRow("개발자")).findByText(/실행 요청이 끝났습니다/);

      pressRun("개발자");

      expect(within(jobRow("개발자")).queryByText(/실행 요청이 끝났습니다/)).toBeNull();
      finishSecondRun(true);
      expect(await within(jobRow("개발자")).findByText(/실행 요청이 끝났습니다/)).toBeVisible();
    });
  });
});
