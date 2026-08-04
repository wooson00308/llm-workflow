import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DreamIntegration,
  DreamJobRequest,
  DreamRefinement,
  IntegrationReadFailure,
  IntegrationsSnapshot,
  JobQuota,
  ManagedDreamJob,
} from "../../domain/types";
import { DreamCard } from "./DreamCard";
import type { IntegrationCardProps } from "./IntegrationCard";

afterEach(cleanup);

const SKILL_PATH = "/Users/catze/.claude/skills/dream/SKILL.md";
const CONDITION = "dream-prep check-unprocessed --slug=-projects-workflow-labs";

/** 역할 잡 카드와 글자까지 같아야 하는 문장(R8). 대조는 `IntegrationsView.test.tsx`가 한다. */
const skippedReasonNote =
  "건너뜀에는 조건을 충족하지 못한 경우와 조건 검사가 실행되지 못한 경우가 모두 들어갑니다. 앱은 둘 중 어느 쪽인지 알지 못하며, 실제 사유는 하트비트 로그 파일에 남습니다.";

/** dream 잡에만 있는 문장. 역할 잡의 조건은 앱 관리 자산이라 사실이 다르다(R11). */
const externalConditionNote =
  "이 잡의 조건은 앱이 관리하는 스크립트가 아니라 외부 명령입니다. 앱은 그 명령이 동작하는지 보증하지 않습니다.";

function refinement(overrides: Partial<DreamRefinement> = {}): DreamRefinement {
  return {
    totalTranscripts: 0,
    markedTranscripts: 0,
    unrefinedTranscripts: 0,
    lastDream: null,
    memoryTopics: 0,
    ...overrides,
  };
}

/**
 * 관리 블록이 있는 정상 상태의 흔한 사용량. 기본값을 `unknown`으로 두면 새 표시가 대부분의 기존
 * 테스트에서 그려지지 않아 회귀를 놓친다. 역할 잡 테스트와 같은 선택이다.
 */
const roomyQuota: JobQuota = {
  kind: "counted",
  used: 2,
  limit: 6,
  window: "24h",
  exhausted: false,
  recoversAt: null,
};

/** 소진 상태의 사용량. 미정제 트랜스크립트와 만나야 경고가 된다(R3). */
const exhaustedQuota: JobQuota = {
  kind: "counted",
  used: 24,
  limit: 24,
  window: "24h",
  exhausted: true,
  recoversAt: "2026-08-03T05:20:00Z",
};

/**
 * 한도 시나리오의 실행 기록. 한도를 세려면 그 잡이 이미 돌았어야 한다.
 *
 * 실행 기록이 없는 잡에는 "하트비트가 이 잡을 실행한 기록이 없습니다" 경고가 따로 붙으므로
 * (SPEC-024 R4), 한도 경고의 있고 없음을 보는 시나리오는 이 기록을 함께 넘긴다.
 */
const ranOnce = { at: "2026-08-03 05:00:00", result: "success", durationSeconds: 12 };

/** 관리 블록에 앱 기본값 그대로 적힌 잡. 되돌아갈 앱 소유 필드가 없는 상태다. */
function dreamJob(overrides: Partial<ManagedDreamJob> = {}): ManagedDreamJob {
  return { interval: "2h", maxPer: "6/24h", model: "opus", timeout: "30m", appOwnedDrift: [], ...overrides };
}

function dream(overrides: Partial<DreamIntegration> = {}): DreamIntegration {
  return {
    installation: "installed",
    heartbeat: "installed",
    refinement: refinement(),
    skillPath: SKILL_PATH,
    conditionCommand: CONDITION,
    // 백엔드 `heartbeat_dream::default_settings`와 같은 값이다. 화면은 이 값으로 폼을 시딩하고
    // 재설정도 이 값으로 한다.
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

/** dream 카드는 스냅샷의 dream payload와 섹션 공통 값(slug, 잡 파일 경로·읽기 결과)만 읽는다. */
function snapshot(
  overrides: Partial<DreamIntegration> = {},
  managedBlockFailure: IntegrationReadFailure | null = null,
): IntegrationsSnapshot {
  return {
    supported: true,
    slug: "-projects-workflow-labs",
    managedBlockFailure,
    jobsFilePath,
    heartbeat: {
      installation: "installed",
      daemonRunning: true,
      setupStages: [],
      conditionScriptPath: ".workflow/rules/wf-eligible.sh",
      roles: [],
      managedJobs: [],
      duplicateJobs: [],
      readFailures: [],
    },
    dream: dream(overrides),
  };
}

/**
 * 펼침 상태의 주인은 연동 뷰다(SPEC-006 R4). 카드만 떼어 보는 이 파일에서는 이 껍데기가 그 자리를
 * 대신해, 카드가 그리는 실제 토글 버튼으로 접고 펼 수 있게 한다. 본문을 보는 테스트가 대부분이라
 * 시작은 펼침이다.
 */
function DreamCardHost(props: Omit<IntegrationCardProps, "expanded" | "onToggleExpanded">) {
  const [expanded, setExpanded] = useState(true);
  return (
    <DreamCard {...props} expanded={expanded} onToggleExpanded={() => setExpanded((it) => !it)} />
  );
}

function renderCard(
  overrides: Partial<DreamIntegration> = {},
  installDreamJob = vi.fn().mockResolvedValue(true),
  writeError: string | null = null,
  managedBlockFailure: IntegrationReadFailure | null = null,
) {
  render(
    <DreamCardHost
      actions={{ installHeartbeatJobs: vi.fn(), installDreamJob }}
      error={null}
      heartbeatRuns={{ running: [], failure: null, run: vi.fn().mockResolvedValue(true) }}
      snapshot={snapshot(overrides, managedBlockFailure)}
      writeError={writeError}
    />,
  );
  return screen.getByRole("article", { name: "dream" });
}

describe("dream 카드 설치 상태", () => {
  it("tells the three install states apart", () => {
    const labels = (
      [
        { heartbeat: "not_installed", installation: "not_installed" },
        { heartbeat: "installed", installation: "not_installed" },
        { heartbeat: "installed", installation: "installed" },
      ] as const
    ).map((state) => {
      const card = renderCard(state);
      const badge = card.textContent ?? "";
      cleanup();
      return badge;
    });

    expect(labels[0]).toContain("하트비트 필요");
    expect(labels[0]).toContain("하트비트가 먼저 있어야 합니다");
    expect(labels[1]).toContain("미설치");
    expect(labels[1]).not.toContain("하트비트 필요");
    expect(labels[2]).toContain("설치됨");
    expect(labels[2]).not.toContain("미설치");
  });

  it("shows the install command and the repository while the skill is missing", () => {
    const card = renderCard({ heartbeat: "installed", installation: "not_installed" });

    expect(card).toHaveTextContent("heartbeat install dream");
    expect(card).toHaveTextContent("github.com/wooson00308/claude-heartbeat");
    expect(card).toHaveTextContent("앱이 dream을 대신 설치하지 않습니다");
  });

  it("states the path behind the install decision and its limit", () => {
    const card = renderCard({ heartbeat: "installed", installation: "not_installed" });

    expect(card).toHaveTextContent(SKILL_PATH);
    expect(card).toHaveTextContent("--slug으로 다른 이름을 지정해 설치했다면");
  });

  it("shows the condition command as the backend built it, with the reason", () => {
    const card = renderCard();

    expect(card).toHaveTextContent(CONDITION);
    expect(card).toHaveTextContent("PATH를 알 수 없어");
    expect(card).toHaveTextContent("아무 일도 일어나지 않음");
    expect(card).toHaveTextContent("-projects-workflow-labs");
  });

  it("hides the refinement status and the condition command until both are installed", () => {
    const card = renderCard({ heartbeat: "installed", installation: "not_installed" });

    expect(card).not.toHaveTextContent(CONDITION);
    expect(card).not.toHaveTextContent("미정제");
  });
});

describe("dream 카드 정제 상태", () => {
  it("shows the counts and the last refinement from the payload", () => {
    const card = renderCard({
      refinement: refinement({
        totalTranscripts: 22,
        markedTranscripts: 5,
        unrefinedTranscripts: 17,
        lastDream: "2026-07-19T19:25:01",
        memoryTopics: 3,
      }),
    });

    expect(card).toHaveTextContent("22개");
    expect(card).toHaveTextContent("17개");
    expect(card).toHaveTextContent("2026-07-19T19:25:01");
    expect(card).toHaveTextContent("3개");
  });

  it("treats a missing refinement record as a normal state", () => {
    const card = renderCard({
      refinement: refinement({ totalTranscripts: 17, unrefinedTranscripts: 17 }),
    });

    expect(card).toHaveTextContent("정제 기록 없음");
    expect(card.querySelector(".integration-warning")).toBeNull();
  });

  it("treats a missing project directory as a normal state", () => {
    const card = renderCard();

    expect(card).toHaveTextContent("트랜스크립트 없음");
    expect(card.querySelector(".integration-warning")).toBeNull();
  });

  it("says the unrefined count is a marking based one", () => {
    const card = renderCard();

    expect(card).toHaveTextContent("dream_meta.md의 마킹 기준입니다");
    expect(card).toHaveTextContent("한 번에 처리되는 수는 이보다 적을 수 있습니다");
  });
});

describe("dream 잡 설치·토글·편집", () => {
  const installAction = { name: "이 프로젝트에 dream 잡 설치" };
  const confirmAction = { name: "확인하고 쓰기" };

  it("starts from the R5 defaults and explains the interval", () => {
    const card = renderCard();

    expect(screen.getByLabelText("dream 정제 주기")).toHaveValue("2h");
    expect(screen.getByLabelText("dream 정제 실행 한도 값")).toHaveValue("6/24h");
    expect(screen.getByLabelText("dream 정제 모델")).toHaveValue("opus");
    expect(card).toHaveTextContent("이 프로젝트의 dream 잡이 아직 없습니다");
    expect(card).toHaveTextContent("관측된 dream 실행이 15분 규모");
  });

  it("reads the installed values from the managed block", () => {
    renderCard({ managedJob: dreamJob({ interval: "4h", maxPer: "2/24h", model: "sonnet" }) });

    expect(screen.getByLabelText("dream 정제 주기")).toHaveValue("4h");
    expect(screen.getByLabelText("dream 정제 실행 한도 값")).toHaveValue("2/24h");
    expect(screen.getByLabelText("dream 정제 모델")).toHaveValue("sonnet");
    expect(
      screen.getByRole("button", { name: "dream 잡 변경 사항 저장" }),
    ).toBeInTheDocument();
  });

  it("does not call the gateway until the confirmation is accepted", async () => {
    const installDreamJob = vi.fn().mockResolvedValue(true);
    renderCard({}, installDreamJob);

    await userEvent.click(screen.getByRole("button", installAction));
    expect(installDreamJob).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", confirmAction));
    // 아무 필드도 건드리지 않았으므로 세 값은 전부 미지정이다. 파일에 적힌 값이 이긴다.
    // 관리 블록에 잡이 없던 상태를 읽었으므로 기준값은 null이다.
    expect(installDreamJob).toHaveBeenCalledWith(
      {
        enabled: true,
        interval: null,
        maxPer: null,
        model: null,
        timeout: null,
      },
      null,
    );
  });

  // R1. 역할 잡 카드와 같은 규칙이다. 폼에 파일 값이 차 있어도 그것을 명시로 보내지 않는다.
  it("sends only the fields the user actually changed", async () => {
    const installDreamJob = vi.fn().mockResolvedValue(true);
    renderCard(
      { managedJob: dreamJob({ maxPer: "2/24h" }) },
      installDreamJob,
    );

    await userEvent.clear(screen.getByLabelText("dream 정제 주기"));
    await userEvent.type(screen.getByLabelText("dream 정제 주기"), "6h");
    await userEvent.click(screen.getByRole("button", { name: "dream 잡 변경 사항 저장" }));
    await userEvent.click(screen.getByRole("button", confirmAction));

    // R3. 시딩에 쓴 관리 블록 값이 그대로 기준값으로 실려 나간다.
    expect(installDreamJob).toHaveBeenCalledWith(
      {
        enabled: true,
        interval: "6h",
        maxPer: null,
        model: null,
        timeout: null,
      },
      dreamJob({ maxPer: "2/24h" }),
    );
  });

  it("states the target file and that no project local file is written", async () => {
    renderCard();

    await userEvent.click(screen.getByRole("button", installAction));

    const confirm = screen.getByRole("group", { name: "dream 잡 설치 확인" });
    expect(confirm).toHaveTextContent(jobsFilePath);
    expect(confirm).not.toHaveTextContent("~/.claude/HEARTBEAT.md");
    expect(confirm).toHaveTextContent("이 프로젝트 전용 파일입니다. 다른 프로젝트의 잡은 각자의 파일에 있습니다.");
    expect(confirm).toHaveTextContent("이 파일 전체를 앱이 다시 씁니다. 이 파일의 역할 잡은 값 그대로 남고, 손으로 덧붙인 줄은 남지 않습니다. 다른 프로젝트의 잡은 이 파일에 들어올 수 없어 영향을 받지 않습니다.");
    expect(confirm).toHaveTextContent("프로젝트 로컬 파일을 쓰지 않습니다");
    // R4. 나열이 아니라 차이다. 블록에 없던 잡이라 세 값의 현재 자리가 모두 "없음"이다.
    expect(confirm).toHaveTextContent("wf-dream-projects-workflow-labs");
    expect(confirm).toHaveTextContent("관리 블록에 없던 잡입니다. 새로 추가됩니다");
    expect(confirm).toHaveTextContent("주기 없음 → 2h — 바뀜");
    expect(confirm).toHaveTextContent("실행 한도 없음 → 6/24h — 바뀜");
    expect(confirm).toHaveTextContent("모델 없음 → opus — 바뀜");
  });

  // R4. 역할 잡 카드와 같은 표시 요소를 쓴다. 두 카드가 각자 그리면 같은 화면이 갈라진다.
  it("marks the changed field and leaves the other two as unchanged", async () => {
    renderCard({ managedJob: dreamJob() });

    await userEvent.clear(screen.getByLabelText("dream 정제 주기"));
    await userEvent.type(screen.getByLabelText("dream 정제 주기"), "6h");
    await userEvent.click(screen.getByRole("button", { name: "dream 잡 변경 사항 저장" }));

    const confirm = screen.getByRole("group", { name: "dream 잡 설치 확인" });
    expect(confirm).toHaveTextContent("주기 2h → 6h — 바뀜");
    expect(confirm).toHaveTextContent("실행 한도 6/24h — 그대로");
    expect(confirm).toHaveTextContent("모델 opus — 그대로");
  });

  it("says the managed block does not change when nothing was edited", async () => {
    renderCard({ managedJob: dreamJob() });

    await userEvent.click(screen.getByRole("button", { name: "dream 잡 변경 사항 저장" }));

    expect(screen.getByRole("group", { name: "dream 잡 설치 확인" })).toHaveTextContent(
      "관리 블록에서 달라지는 값이 없습니다",
    );
  });

  /** R4. 값 자체는 보여주지 않는다. 요구는 되돌아간다는 사실과 그 대상이다. */
  it("names the app owned fields that go back to the app value", async () => {
    renderCard({ managedJob: dreamJob({ appOwnedDrift: ["timeout", "notify"] }) });

    await userEvent.click(screen.getByRole("button", { name: "dream 잡 변경 사항 저장" }));

    const confirm = screen.getByRole("group", { name: "dream 잡 설치 확인" });
    expect(confirm).toHaveTextContent("되돌아감: timeout, notify");
    expect(confirm).toHaveTextContent("앱 값으로 다시 쓰입니다");
  });

  it("shows the values that disappear with the job turned off", async () => {
    renderCard({ managedJob: dreamJob({ interval: "6h", maxPer: "2/24h" }) });

    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: "dream 잡 변경 사항 저장" }));

    const confirm = screen.getByRole("group", { name: "dream 잡 설치 확인" });
    expect(confirm).toHaveTextContent("제거: wf-dream-projects-workflow-labs");
    expect(confirm).toHaveTextContent("주기 6h · 실행 한도 2/24h · 모델 opus · 시간 초과 30m 값이 함께 사라집니다");
  });

  it("does not open the confirmation while an input is invalid", async () => {
    const installDreamJob = vi.fn().mockResolvedValue(true);
    renderCard({}, installDreamJob);

    await userEvent.clear(screen.getByLabelText("dream 정제 주기"));
    await userEvent.type(screen.getByLabelText("dream 정제 주기"), "2시간");
    await userEvent.click(screen.getByRole("button", installAction));

    expect(
      screen.queryByRole("group", { name: "dream 잡 설치 확인" }),
    ).not.toBeInTheDocument();
    expect(installDreamJob).not.toHaveBeenCalled();
    expect(screen.getByText("숫자 뒤에 s, m, h, d 중 하나를 붙여 주세요. 예: 2h")).toBeInTheDocument();
  });

  it("sends the job as disabled when the toggle is turned off", async () => {
    const installDreamJob = vi.fn().mockResolvedValue(true);
    renderCard(
      { managedJob: dreamJob() },
      installDreamJob,
    );

    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: "dream 잡 변경 사항 저장" }));
    const confirm = screen.getByRole("group", { name: "dream 잡 설치 확인" });
    expect(confirm).toHaveTextContent("제거: wf-dream-projects-workflow-labs");

    await userEvent.click(screen.getByRole("button", confirmAction));
    expect(installDreamJob).toHaveBeenCalledWith(
      {
        enabled: false,
        interval: null,
        maxPer: null,
        model: null,
        timeout: null,
      },
      dreamJob(),
    );
  });

  it("shows the write failure in this card with its reason", () => {
    const card = renderCard({}, undefined, "마커가 손상되어 파일을 쓰지 않았습니다.");

    expect(card).toHaveTextContent("dream 잡을 쓰지 못했습니다");
    expect(card).toHaveTextContent("마커가 손상되어 파일을 쓰지 않았습니다");
  });

  it("reports the last run and treats a missing record as normal", () => {
    const missing = renderCard({ managedJob: dreamJob() });
    expect(missing).toHaveTextContent("실행 기록 없음");
    cleanup();

    const card = renderCard({
      managedJob: dreamJob(),
      lastRun: { at: "2026-08-02T02:42:25", result: "skipped", durationSeconds: 12.5 },
    });

    // 라벨은 건너뛰었다는 사실만 적는다. 사유는 앱이 모른다(R8).
    expect(within(card).getByText("건너뜀")).toBeVisible();
    expect(card).not.toHaveTextContent("처리할 대상 없음");
    expect(card).toHaveTextContent("2026-08-02T02:42:25 (로컬 시각)");
    expect(card).toHaveTextContent("12.5초");
    expect(card.querySelector(".integration-warning")).toBeNull();
  });

  /** 역할 잡 카드와 같은 문장이어야 한다. 대조는 `IntegrationsView.test.tsx`가 함께 그려 놓고 한다. */
  it("says a skip may also mean the condition check never ran", () => {
    const card = renderCard({
      managedJob: dreamJob(),
      lastRun: { at: "2026-08-02T02:42:25", result: "skipped", durationSeconds: 12.5 },
    });

    expect(within(card).getByText(skippedReasonNote)).toBeVisible();
  });

  /**
   * dream 조건은 이 저장소 밖의 외부 명령이라 사유가 실제로 올지는 그 도구에 달려 있다. 통로는
   * 역할 잡 카드와 같게 열어 둔다(SPEC-023 R1).
   */
  it("shows the reason the condition reported instead of the guidance", () => {
    const card = renderCard({
      managedJob: dreamJob(),
      lastRun: { at: "2026-08-02T02:42:25", result: "skipped", durationSeconds: 12.5, conditionOutput: "no-target" },
    });

    expect(within(card).getByText("처리할 대상이 없어 건너뛰었습니다.")).toBeVisible();
    expect(within(card).queryByText(skippedReasonNote)).toBeNull();
  });

  /** 어휘 밖의 값은 받은 문자열 그대로다. 데몬이 직접 만드는 사유가 그 모양으로 온다. */
  it("shows a reason outside the vocabulary as it arrived", () => {
    const card = renderCard({
      managedJob: dreamJob(),
      lastRun: { at: "2026-08-02T02:42:25", result: "skipped", durationSeconds: 12.5, conditionOutput: "condition 실행 실패 (FileNotFoundError)" },
    });

    expect(within(card).getByText("condition 실행 실패 (FileNotFoundError)")).toBeVisible();
  });

  /** 값이 없거나 비어 있으면 지금 화면 그대로다(R2). 빈 자리나 "없음" 같은 새 표시를 만들지 않는다. */
  it("keeps the guidance when the reason is absent or empty", () => {
    for (const conditionOutput of [null, "", "   "]) {
      const card = renderCard({
        managedJob: dreamJob(),
        lastRun: { at: "2026-08-02T02:42:25", result: "skipped", durationSeconds: 12.5, conditionOutput },
      });

      expect(within(card).getByText(skippedReasonNote)).toBeVisible();
      cleanup();
    }
  });

  /** 한도 건너뜀 옆의 사유는 이번 실행의 것이 아니다(R3). */
  it("leaves a quota skip without a reason", () => {
    const card = renderCard({
      managedJob: dreamJob(),
      lastRun: { at: "2026-08-02T02:42:25", result: "quota_skipped", durationSeconds: 0, conditionOutput: "no-target" },
    });

    expect(within(card).getByText("건너뜀 · 실행 한도 도달")).toBeVisible();
    expect(card).not.toHaveTextContent("처리할 대상이 없어 건너뛰었습니다.");
  });

  it("does not explain a skip that did not happen", () => {
    const success = renderCard({
      managedJob: dreamJob(),
      lastRun: { at: "2026-08-02T02:42:25", result: "success", durationSeconds: 3 },
    });
    expect(within(success).queryByText(skippedReasonNote)).toBeNull();
    cleanup();

    const missing = renderCard({ managedJob: dreamJob() });
    expect(within(missing).queryByText(skippedReasonNote)).toBeNull();
  });

  /**
   * 조건이 앱 관리 자산이 아니라는 사실은 설치 상태와 무관하다(R11·D3). 문구에 OS 이름이 없는
   * 것도 함께 고정한다 — 화면은 실행 플랫폼을 알지 못한다(R5).
   */
  it("says the dream condition is an external command the app does not vouch for", () => {
    const installed = renderCard({ managedJob: dreamJob() });
    expect(within(installed).getByText(externalConditionNote)).toBeVisible();
    expect(externalConditionNote).not.toContain("Windows");
    cleanup();

    const notInstalled = renderCard({ installation: "not_installed" });
    expect(within(notInstalled).getByText(externalConditionNote)).toBeVisible();
  });

  it("hides the job UI until both are installed", () => {
    renderCard({ heartbeat: "installed", installation: "not_installed" });

    expect(screen.queryByRole("button", installAction)).not.toBeInTheDocument();
  });
});

// R5. 역할 잡 카드와 같은 규칙이다. 되돌리는 것은 정당한 요구이고, 저장의 부작용이 아니라 사용자가
// 고르는 동작이어야 한다.
describe("dream 잡 기본값 재설정", () => {
  const resetAction = { name: "dream 잡 기본값으로 재설정" };
  const confirmReset = { name: "확인하고 되돌리기" };
  const confirmGroup = { name: "dream 잡 기본값 재설정 확인" };

  const edited = dreamJob({ interval: "6h", maxPer: "2/24h", model: "sonnet" });

  it("offers the action only for a job written in the managed block", () => {
    renderCard({ managedJob: edited });
    expect(screen.getByRole("button", resetAction)).toBeInTheDocument();
    cleanup();

    // 되돌릴 파일 값이 없는 잡이다. 폼은 이미 기본값에서 시작한다.
    renderCard();
    expect(screen.queryByRole("button", resetAction)).not.toBeInTheDocument();
  });

  it("does not write before the confirmation step", async () => {
    const installDreamJob = vi.fn().mockResolvedValue(true);
    renderCard({ managedJob: edited }, installDreamJob);

    await userEvent.click(screen.getByRole("button", resetAction));

    expect(installDreamJob).not.toHaveBeenCalled();
    expect(screen.getByRole("group", confirmGroup)).toBeInTheDocument();
  });

  it("shows the difference between the file values and the app defaults", async () => {
    renderCard({ managedJob: edited });

    await userEvent.click(screen.getByRole("button", resetAction));

    const confirm = screen.getByRole("group", confirmGroup);
    expect(confirm).toHaveTextContent("주기 6h → 2h — 바뀜");
    expect(confirm).toHaveTextContent("실행 한도 2/24h → 6/24h — 바뀜");
    expect(confirm).toHaveTextContent("모델 sonnet → opus — 바뀜");
    expect(confirm).toHaveTextContent(jobsFilePath);
    expect(confirm).not.toHaveTextContent("~/.claude/HEARTBEAT.md");
    expect(confirm).toHaveTextContent("잡의 활성·비활성 상태와 이 파일의 역할 잡은 그대로 둡니다. 다른 프로젝트의 잡은 이 파일에 들어올 수 없어 영향을 받지 않습니다.");
  });

  it("says nothing changes for a job already at the app defaults", async () => {
    renderCard({ managedJob: dreamJob() });

    await userEvent.click(screen.getByRole("button", resetAction));

    expect(screen.getByRole("group", confirmGroup)).toHaveTextContent(
      "관리 블록에서 달라지는 값이 없습니다",
    );
  });

  it("sends the app defaults as specified values with the seeded baseline", async () => {
    const installDreamJob = vi.fn().mockResolvedValue(true);
    renderCard({ managedJob: edited }, installDreamJob);

    await userEvent.click(screen.getByRole("button", resetAction));
    await userEvent.click(screen.getByRole("button", confirmReset));

    expect(installDreamJob).toHaveBeenCalledWith(
      {
        enabled: true,
        interval: "2h",
        maxPer: { kind: "limit", value: "6/24h" },
        model: "opus",
        timeout: "30m",
      },
      edited,
    );
  });

  // 기획서 완료 조건 12. 폼의 토글을 꺼 둔 상태에서 눌러도 잡이 관리 블록에서 빠지면 안 된다.
  it("sends the enabled state of the file, not the one of the form", async () => {
    const installDreamJob = vi.fn().mockResolvedValue(true);
    renderCard({ managedJob: edited }, installDreamJob);

    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", resetAction));
    await userEvent.click(screen.getByRole("button", confirmReset));

    expect(installDreamJob.mock.calls[0][0]).toEqual({
      enabled: true,
      interval: "2h",
      maxPer: { kind: "limit", value: "6/24h" },
      model: "opus",
      timeout: "30m",
    });
  });

  it("leaves the save action untouched", async () => {
    const installDreamJob = vi.fn().mockResolvedValue(true);
    renderCard({ managedJob: edited }, installDreamJob);

    await userEvent.click(screen.getByRole("button", { name: "dream 잡 변경 사항 저장" }));
    expect(screen.queryByRole("group", confirmGroup)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "확인하고 쓰기" }));

    expect(installDreamJob).toHaveBeenCalledWith(
      { enabled: true, interval: null, maxPer: null, model: null, timeout: null },
      edited,
    );
  });

  it("cancels without writing anything", async () => {
    const installDreamJob = vi.fn().mockResolvedValue(true);
    renderCard({ managedJob: edited }, installDreamJob);

    await userEvent.click(screen.getByRole("button", resetAction));
    await userEvent.click(screen.getByRole("button", { name: "취소" }));

    expect(screen.queryByRole("group", confirmGroup)).not.toBeInTheDocument();
    expect(installDreamJob).not.toHaveBeenCalled();
  });
});

// R2. 두 연동이 이 프로젝트의 잡 파일 하나를 공유하므로 역할 잡 카드와 같은 규칙으로 막혀야 한다.
// 한쪽만 막으면 다른 쪽 저장이 같은 사고를 그대로 낸다.
describe("dream 카드 관리 블록 읽기 실패", () => {
  const failure = {
    path: jobsFilePath,
    message: "Permission denied (os error 13)",
  };

  it("hides the dream job form and blocks the save", async () => {
    const installDreamJob = vi.fn().mockResolvedValue(true);
    renderCard({}, installDreamJob, null, failure);

    expect(screen.queryByLabelText("dream 정제 주기")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("dream 정제 실행 한도")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("dream 정제 모델")).not.toBeInTheDocument();

    const save = screen.getByRole("button", { name: "dream 잡 저장" });
    expect(save).toBeDisabled();
    await userEvent.click(save);

    expect(screen.queryByRole("group", { name: "dream 잡 설치 확인" })).not.toBeInTheDocument();
    expect(installDreamJob).not.toHaveBeenCalled();
  });

  it("states the target path and the reason", () => {
    const card = renderCard({}, vi.fn(), null, failure);

    expect(card).toHaveTextContent("관리 블록을 읽지 못했습니다");
    expect(card).toHaveTextContent(failure.path);
    expect(card).toHaveTextContent(failure.message);
    expect(card).toHaveTextContent("앱이 모르는 값을 덮어쓰지 않도록 저장을 막았습니다");
  });

  it("tells the unreadable state apart from a block without the dream job", () => {
    const withoutJob = renderCard().textContent ?? "";
    cleanup();

    const unread = renderCard({}, vi.fn(), null, failure).textContent ?? "";

    expect(withoutJob).toContain("dream 잡이 아직 없습니다");
    expect(withoutJob).not.toContain("관리 블록을 읽지 못했습니다");
    expect(unread).toContain("관리 블록을 읽지 못했습니다");
    expect(unread).not.toContain("dream 잡이 아직 없습니다");
  });
});

/**
 * SPEC-024 R4의 dream 몫. 판정과 문구는 역할 잡 카드와 같고, 두 카드의 문장이 글자까지 같은지는
 * `IntegrationsView.test.tsx`가 두 카드를 함께 그려 센다.
 */
describe("dream 카드 잡 파일에만 있는 잡", () => {
  const noRunTitle = "하트비트가 이 잡을 실행한 기록이 없습니다";

  it("names the state and both of its possible causes", () => {
    const card = renderCard({ managedJob: dreamJob() });

    expect(card).toHaveTextContent(noRunTitle);
    expect(card).toHaveTextContent("잡 파일에는 이 잡의 정의가 있는데 하트비트가 실행한 기록이 없습니다");
    expect(card).toHaveTextContent("아직 첫 주기가 오지 않았을 수도 있고");
    expect(card).toHaveTextContent("프로젝트별 잡 파일을 읽지 못하는 버전일 수도 있습니다");
    expect(card).toHaveTextContent("앱은 하트비트 버전을 판정하지 않으므로");
    expect(card).toHaveTextContent("하트비트를 갱신하세요");
  });

  it("drops the notice once the daemon has run the job", () => {
    const card = renderCard({ managedJob: dreamJob(), lastRun: ranOnce });

    expect(card).not.toHaveTextContent(noRunTitle);
    expect(screen.getByText("성공")).toBeVisible();
  });

  it("says nothing about a job that is not in the file", () => {
    // 잡 파일에 없는 잡이 안 도는 것은 정상이다.
    const card = renderCard({ managedJob: null });

    expect(card).not.toHaveTextContent(noRunTitle);
  });

  it("stays quiet while the prerequisites are missing", () => {
    // 잡 목록을 일부러 비우지 않는다. 비어 있으면 판정이 아니라 빈 잡 때문에 조용해진다.
    const card = renderCard({ managedJob: dreamJob(), heartbeat: "not_installed" });

    expect(card).not.toHaveTextContent(noRunTitle);
  });

  it("stays quiet while the jobs file could not be read", () => {
    const card = renderCard({ managedJob: dreamJob() }, vi.fn(), null, {
      path: jobsFilePath,
      message: "Permission denied (os error 13)",
    });

    expect(card).not.toHaveTextContent(noRunTitle);
    expect(card).toHaveTextContent("관리 블록을 읽지 못했습니다");
  });

  it("blocks neither the save nor the reset", () => {
    renderCard({ managedJob: dreamJob() });

    expect(screen.getByRole("button", { name: "dream 잡 변경 사항 저장" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "dream 잡 기본값으로 재설정" })).toBeEnabled();
  });

  it("marks the collapsed summary so the warning is not hidden by the fold", () => {
    renderCard({ managedJob: dreamJob() });

    fireEvent.click(screen.getByRole("button", { name: /^(펼치기|접기)$/ }));

    expect(screen.getByText("확인할 경고가 있습니다")).toBeVisible();
  });
});

describe("dream 카드 중복 잡 경고", () => {
  it("warns about a duplicate dream job with its concrete risk", () => {
    const card = renderCard({
      duplicateJobs: [{ name: "dream-labs", integration: "dream", role: null }],
    });

    expect(card).toHaveTextContent("이 프로젝트의 dream 잡이 옛 전역 파일에도 있습니다");
    expect(card).not.toHaveTextContent("관리 블록 밖에");
    expect(card).toHaveTextContent("dream-labs");
    expect(card).toHaveTextContent("같은 메모리 파일을 서로 덮어쓸 수 있습니다");
    // 역할 잡 카드와 같은 뒷문장이다. 대조는 두 카드를 함께 그리는 `IntegrationsView.test.tsx`가 한다.
    expect(card).toHaveTextContent("데몬이 이 프로젝트의 잡 파일을 우선하고 옛 정의는 무시합니다");
    expect(card).toHaveTextContent("이 카드에서 한 번 저장하면 앱이 치웁니다");
    expect(card).toHaveTextContent("손으로 적은 잡은 앱이 지우지 않으므로 직접 정리해야 합니다");
  });
});

// SPEC-009. 잡 종류별로 다른 규칙을 만들지 않는다. 표시·소진 판정·회복 시각은 역할 잡과 같고,
// 다른 것은 "무엇이 대기 중인가"의 근거(미정제 트랜스크립트 수)뿐이다.
describe("dream 잡 실행 한도 사용량", () => {
  const warningTitle = "dream 잡이 대기 중인 일을 처리하지 못하고 있습니다";

  /** 화면과 같은 로케일 규칙으로 만든 기대값. 실행 환경의 시간대를 테스트가 고정하지 않는다. */
  function localOf(value: string): string {
    return new Intl.DateTimeFormat("ko-KR", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  }

  function warning() {
    const card = screen.getByRole("article", { name: "dream" });
    return card.querySelector(".integration-warning") as HTMLElement | null;
  }

  it("puts the usage beside the last run of a managed job", () => {
    const card = renderCard({
      managedJob: dreamJob(),
      lastRun: { at: "2026-08-03 05:00:00", result: "success", durationSeconds: 12 },
      quota: { kind: "counted", used: 3, limit: 24, window: "24h", exhausted: false, recoversAt: null },
    });

    expect(screen.getByText("3/24 · 24h 기준")).toBeVisible();
    // 사용량은 실행 기록을 대체하지 않는다.
    expect(screen.getByText("성공")).toBeVisible();
    expect(card).toHaveTextContent("2026-08-03 05:00:00 (로컬 시각)");
  });

  it("takes the limit from the managed block instead of the app default", () => {
    const card = renderCard({
      managedJob: dreamJob({ maxPer: "24/24h" }),
      quota: { kind: "counted", used: 3, limit: 24, window: "24h", exhausted: false, recoversAt: null },
    });

    expect(screen.getByText("3/24 · 24h 기준")).toBeVisible();
    // 앱 기본값은 6/24h다. 그 값으로 계산한 표시가 있으면 안 된다.
    expect(card).not.toHaveTextContent("3/6 ·");
  });

  it("marks an exhausted job and estimates the recovery in local time", () => {
    renderCard({ managedJob: dreamJob(), quota: exhaustedQuota });

    expect(screen.getByText("24/24 · 24h 기준")).toBeVisible();
    expect(screen.getByText("실행 한도 도달")).toBeVisible();
    expect(
      screen.getByText(`${localOf(exhaustedQuota.recoversAt as string)}에 1회 여유 (예상)`),
    ).toBeVisible();
  });

  it("warns only while an unrefined transcript waits behind the exhausted job", () => {
    renderCard({
      managedJob: dreamJob(),
      quota: exhaustedQuota,
      refinement: refinement({ totalTranscripts: 4, unrefinedTranscripts: 2 }),
    });
    expect(screen.getByText(warningTitle)).toBeVisible();
    cleanup();

    renderCard({ managedJob: dreamJob(), quota: exhaustedQuota });
    // 미정제가 없으면 소진은 사실 표시에 그친다.
    expect(screen.queryByText(warningTitle)).toBeNull();
    expect(screen.getByText("실행 한도 도달")).toBeVisible();
  });

  it("names what waits, why it stalls, when it clears and where to raise the limit", () => {
    renderCard({
      managedJob: dreamJob(),
      lastRun: ranOnce,
      quota: exhaustedQuota,
      refinement: refinement({ totalTranscripts: 4, unrefinedTranscripts: 2 }),
    });

    const shown = warning() as HTMLElement;
    expect(shown).toHaveTextContent("정제하지 않은 트랜스크립트가 2개 남아 있는데");
    expect(shown).toHaveTextContent("조건 검사 전에 이 잡을 건너뜁니다");
    expect(shown).toHaveTextContent(`${localOf(exhaustedQuota.recoversAt as string)}에 1회 여유 (예상)`);
    expect(shown).toHaveTextContent("실행 한도 칸에서 한도를 올리고");
    expect(shown).toHaveTextContent("저장 버튼");
  });

  it("does not read quota_skipped as evidence that a transcript waits", () => {
    renderCard({
      managedJob: dreamJob(),
      quota: exhaustedQuota,
      lastRun: { at: "2026-08-03 05:00:00", result: "quota_skipped", durationSeconds: 0 },
    });

    expect(screen.getByText("건너뜀 · 실행 한도 도달")).toBeVisible();
    expect(warning()).toBeNull();
  });

  it("says there is no run instead of counting it as zero", () => {
    const card = renderCard({
      managedJob: dreamJob(),
      quota: { kind: "noRuns", limit: 24, window: "24h" },
    });

    expect(screen.getByText("실행 기록 없음 · 한도 24회/24h")).toBeVisible();
    expect(card).not.toHaveTextContent("0/24");
  });

  it("draws no usage while the managed block is unreadable", () => {
    const card = renderCard({ managedJob: dreamJob(), quota: exhaustedQuota }, vi.fn(), null, {
      path: "/Users/catze/.claude/HEARTBEAT.md",
      message: "Permission denied (os error 13)",
    });

    expect(card.querySelector(".heartbeat-job-quota")).toBeNull();
    expect(card).not.toHaveTextContent("실행 한도 도달");
  });

  // SPEC-017 완료 조건 13·14. dream 잡도 역할 잡과 같은 규칙이다.
  it("shows the chosen unlimited without any usage count and keeps the last run", () => {
    const card = renderCard({
      managedJob: dreamJob({ maxPer: null }),
      quota: { kind: "unlimited" },
      lastRun: { at: "2026-08-03 05:00:00", result: "success", durationSeconds: 12.5 },
    });

    expect(screen.getByText("제한 없음 — 실행 횟수 제한 없이 주기마다 실행됩니다.")).toBeVisible();
    expect(card.textContent).not.toMatch(/\d+\/\d+ ·/);
    expect(card).not.toHaveTextContent("한도 없음");
    // 마지막 실행 기록은 `lastRun`에서 오고 한도와 무관하다.
    expect(screen.getByText("성공")).toBeVisible();
    expect(screen.getByText("2026-08-03 05:00:00 (로컬 시각)")).toBeVisible();
  });

  // SPEC-017 완료 조건 11. 막을 한도가 없으므로 미정제 트랜스크립트가 남아도 경고가 아니다.
  it("raises no quota warning for the chosen unlimited even with unrefined transcripts", () => {
    renderCard({
      managedJob: dreamJob({ maxPer: null }),
      lastRun: ranOnce,
      quota: { kind: "unlimited" },
      refinement: refinement({ totalTranscripts: 4, unrefinedTranscripts: 2 }),
    });

    expect(warning()).toBeNull();
    expect(screen.queryByText(warningTitle)).toBeNull();
  });

  // SPEC-017 완료 조건 12. 두 무제한의 문구가 서로 다르다.
  it("words the chosen unlimited and an ignored limit differently", () => {
    renderCard({ managedJob: dreamJob({ maxPer: null }), quota: { kind: "unlimited" } });
    const chosen = screen.getByText(/제한 없음 —/).textContent;
    cleanup();

    renderCard({
      managedJob: dreamJob({ maxPer: "0/24h" }),
      quota: { kind: "ignoredLimit", value: "0/24h" },
    });
    const ignored = screen.getByText(/^한도 없음 —/).textContent;

    expect(ignored).not.toEqual(chosen);
    expect(ignored).toContain('"0/24h"');
    expect(ignored).not.toContain("형식이 올바르지 않아");
  });

  it("treats a malformed max_per as a job without a limit", () => {
    const card = renderCard({
      managedJob: dreamJob({ maxPer: "24" }),
      lastRun: ranOnce,
      quota: { kind: "ignoredLimit", value: "24" },
      refinement: refinement({ totalTranscripts: 4, unrefinedTranscripts: 2 }),
    });

    expect(screen.getByText(/^한도 없음 —/)).toBeVisible();
    expect(card).not.toHaveTextContent("실행 한도 도달");
    expect(warning()).toBeNull();
  });

  it("reads a used count above the limit as exhausted", () => {
    renderCard({
      managedJob: dreamJob({ maxPer: "2/24h" }),
      quota: { kind: "counted", used: 5, limit: 2, window: "24h", exhausted: true, recoversAt: null },
      refinement: refinement({ totalTranscripts: 4, unrefinedTranscripts: 2 }),
    });

    expect(screen.getByText("5/2 · 24h 기준")).toBeVisible();
    expect(screen.getByText("실행 한도 도달")).toBeVisible();
    expect(screen.getByText(warningTitle)).toBeVisible();
  });

  it("draws no usage while the managed block has no dream job", () => {
    const card = renderCard({ quota: exhaustedQuota });

    expect(card.querySelector(".heartbeat-job-quota")).toBeNull();
    expect(card).not.toHaveTextContent("실행 한도 도달");
  });
});

// R3. 역할 잡 카드와 같은 규칙이다. 두 연동이 한 파일을 공유하므로 한쪽만 지키면 다른 쪽이 같은
// 사고를 그대로 낸다.
describe("dream 카드 관리 블록 변화", () => {
  const fileChange = { name: "dream 잡 파일 변경" };

  /** 2.5초 조회가 새 스냅샷을 주는 상황을 다시 그려 재현한다. */
  function renderPolling(
    overrides: Partial<DreamIntegration> = {},
    installDreamJob = vi.fn().mockResolvedValue(true),
  ) {
    const view = (next: Partial<DreamIntegration>) => (
      <DreamCardHost
        actions={{ installHeartbeatJobs: vi.fn(), installDreamJob }}
        error={null}
        heartbeatRuns={{ running: [], failure: null, run: vi.fn().mockResolvedValue(true) }}
        snapshot={snapshot(next)}
        writeError={null}
      />
    );
    const { rerender } = render(view(overrides));
    return {
      installDreamJob,
      poll: (next: Partial<DreamIntegration>) => rerender(view(next)),
    };
  }

  it("keeps the edited value and shows what changed in the file", () => {
    const { poll } = renderPolling({ managedJob: dreamJob() });
    fireEvent.change(screen.getByLabelText("dream 정제 주기"), { target: { value: "6h" } });

    poll({ managedJob: dreamJob({ maxPer: "9/24h" }) });

    expect(screen.getByLabelText("dream 정제 주기")).toHaveValue("6h");
    const notice = screen.getByRole("group", fileChange);
    expect(notice).toHaveTextContent("화면이 읽은 뒤 관리 블록이 바뀌었습니다");
    expect(notice).toHaveTextContent("실행 한도 6/24h → 9/24h — 바뀜");
  });

  it("takes the file values when the user asks for them", () => {
    const { poll } = renderPolling({ managedJob: dreamJob() });
    fireEvent.change(screen.getByLabelText("dream 정제 주기"), { target: { value: "6h" } });
    poll({ managedJob: dreamJob({ interval: "3h" }) });

    fireEvent.click(screen.getByRole("button", { name: "파일 값 불러오기" }));

    expect(screen.getByLabelText("dream 정제 주기")).toHaveValue("3h");
    expect(screen.queryByRole("group", fileChange)).not.toBeInTheDocument();
  });

  it("sends the refreshed baseline after the user keeps the edits", async () => {
    const changed = dreamJob({ maxPer: "9/24h" });
    const { installDreamJob, poll } = renderPolling({ managedJob: dreamJob() });
    fireEvent.change(screen.getByLabelText("dream 정제 주기"), { target: { value: "6h" } });
    poll({ managedJob: changed });

    fireEvent.click(screen.getByRole("button", { name: "편집 유지" }));
    expect(screen.getByLabelText("dream 정제 주기")).toHaveValue("6h");

    fireEvent.click(screen.getByRole("button", { name: "dream 잡 변경 사항 저장" }));
    fireEvent.click(screen.getByRole("button", { name: "확인하고 쓰기" }));

    await waitFor(() => expect(installDreamJob).toHaveBeenCalledTimes(1));
    expect(installDreamJob.mock.calls[0][1]).toEqual(changed);
  });

  it("reseeds silently while no field is specified", () => {
    const { poll } = renderPolling({ managedJob: dreamJob() });

    poll({ managedJob: dreamJob({ interval: "3h" }) });

    expect(screen.getByLabelText("dream 정제 주기")).toHaveValue("3h");
    expect(screen.queryByRole("group", fileChange)).not.toBeInTheDocument();
  });

  it("says nothing while the read keeps returning the same block", () => {
    const { poll } = renderPolling({ managedJob: dreamJob() });
    fireEvent.change(screen.getByLabelText("dream 정제 주기"), { target: { value: "6h" } });

    poll({ managedJob: dreamJob() });
    poll({ managedJob: dreamJob() });

    expect(screen.getByLabelText("dream 정제 주기")).toHaveValue("6h");
    expect(screen.queryByRole("group", fileChange)).not.toBeInTheDocument();
  });

  it("reports a job that disappeared from the file", () => {
    const { poll } = renderPolling({ managedJob: dreamJob() });
    fireEvent.change(screen.getByLabelText("dream 정제 주기"), { target: { value: "6h" } });

    poll({ managedJob: null });

    expect(screen.getByRole("group", fileChange)).toHaveTextContent(
      "제거: wf-dream-projects-workflow-labs",
    );
  });
});

/**
 * SPEC-006 R7. 접기는 표시를 바꾸는 동작이지 편집을 취소하는 동작이 아니다. 본문이 언마운트되면
 * 폼 상태가 통째로 사라지므로, 이 카드의 폼으로 그 성질을 직접 확인한다.
 */
describe("dream 카드 접기", () => {
  const toggle = () =>
    screen.getByRole("button", { name: /^(펼치기|접기)$/ });

  it("keeps the unsaved form values across a collapse", () => {
    renderCard({ managedJob: dreamJob() });
    fireEvent.change(screen.getByLabelText("dream 정제 주기"), { target: { value: "6h" } });
    fireEvent.change(screen.getByLabelText("dream 정제 실행 한도 값"), { target: { value: "9/24h" } });

    fireEvent.click(toggle());
    fireEvent.click(toggle());

    expect(screen.getByLabelText("dream 정제 주기")).toHaveValue("6h");
    expect(screen.getByLabelText("dream 정제 실행 한도 값")).toHaveValue("9/24h");
  });

  // R4. 본문만 아는 경고를 골격이 요약으로 올린다. 역할 잡 카드가 연 통로를 그대로 쓴다.
  it("keeps the body warning visible in the collapsed summary", () => {
    renderCard({
      managedJob: dreamJob(),
      quota: exhaustedQuota,
      refinement: refinement({ totalTranscripts: 4, unrefinedTranscripts: 2 }),
    });
    fireEvent.click(toggle());

    expect(screen.getByText("확인할 경고가 있습니다")).toBeVisible();
  });

  it("stays quiet in the collapsed summary while the exhausted job has nothing waiting", () => {
    renderCard({ managedJob: dreamJob(), lastRun: ranOnce, quota: exhaustedQuota });
    fireEvent.click(toggle());

    expect(screen.queryByText("확인할 경고가 있습니다")).toBeNull();
  });
});

/**
 * SPEC-017 R1의 "잡 종류별로 다른 규칙을 만들지 않는다"의 dream 몫. 역할 잡 카드(TASK-053)에서
 * 확인한 것과 같은 사실을 dream 잡으로 확인한다. 여기서 규칙이 갈리면 R1이 깨진다.
 */
describe("dream 잡 실행 한도", () => {
  const saveAction = { name: "dream 잡 변경 사항 저장" };
  const confirmAction = { name: "확인하고 쓰기" };
  const quotaSelect = { name: "dream 정제 실행 한도" };

  /**
   * 끈 잡의 값 기억은 브라우저 저장소를 쓴다. 테스트 환경의 `localStorage`는 메서드가 없는 빈
   * 객체라 실제 저장 동작을 보려면 직접 세워야 한다(연동 뷰 테스트와 같은 형태). 매 테스트가 빈
   * 저장소에서 시작해야 앞 테스트가 기억한 값이 다음 테스트의 시작 상태를 바꾸지 않는다.
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
    vi.unstubAllGlobals();
  });

  /** 관리 블록에 dream 잡이 있고 그 잡에 한도 줄이 없는 상태. 사용자가 고른 제한 없음이다. */
  const unlimitedJob = dreamJob({ maxPer: null });

  function chooseQuota(option: "한도 지정" | "제한 없음") {
    const select = screen.getByRole("combobox", quotaSelect);
    const target = within(select).getByRole("option", { name: option }) as HTMLOptionElement;
    fireEvent.change(select, { target: { value: target.value } });
  }

  function requestOf(installDreamJob: ReturnType<typeof vi.fn>) {
    return installDreamJob.mock.calls[0][0] as DreamJobRequest;
  }

  // 완료 조건 1. 고른 값이 요청까지 그대로 간다.
  it("sends unlimited when the user chooses it", async () => {
    const installDreamJob = vi.fn().mockResolvedValue(true);
    renderCard({ managedJob: dreamJob() }, installDreamJob);

    chooseQuota("제한 없음");
    await userEvent.click(screen.getByRole("button", saveAction));
    await userEvent.click(screen.getByRole("button", confirmAction));

    expect(requestOf(installDreamJob).maxPer).toEqual({ kind: "unlimited" });
  });

  // R1. 고른 상태가 무엇을 뜻하는지 필드 안에서 밝힌다. 역할 잡 카드와 같은 문장이다.
  it("explains what unlimited means and hides the value input", () => {
    const card = renderCard({ managedJob: dreamJob() });

    expect(screen.getByLabelText("dream 정제 실행 한도 값")).toBeVisible();

    chooseQuota("제한 없음");

    expect(screen.queryByLabelText("dream 정제 실행 한도 값")).not.toBeInTheDocument();
    expect(card).toHaveTextContent("실행 횟수 제한 없이 주기마다 실행됩니다");
  });

  it("keeps the typed value when switching back to a limit", async () => {
    const installDreamJob = vi.fn().mockResolvedValue(true);
    renderCard({ managedJob: dreamJob() }, installDreamJob);

    fireEvent.change(screen.getByLabelText("dream 정제 실행 한도 값"), {
      target: { value: "9/24h" },
    });
    chooseQuota("제한 없음");
    chooseQuota("한도 지정");

    expect(screen.getByLabelText("dream 정제 실행 한도 값")).toHaveValue("9/24h");

    await userEvent.click(screen.getByRole("button", saveAction));
    await userEvent.click(screen.getByRole("button", confirmAction));

    expect(requestOf(installDreamJob).maxPer).toEqual({ kind: "limit", value: "9/24h" });
  });

  // 완료 조건 2. 한도 줄이 없는 잡은 제한 없음으로 열린다. 앱 기본값이 그 자리에 보이지 않는다.
  it("opens a job without a quota line as unlimited and seeds no app default", () => {
    const card = renderCard({ managedJob: unlimitedJob });

    expect(screen.getByRole("combobox", quotaSelect)).toHaveDisplayValue("제한 없음");
    expect(screen.queryByLabelText("dream 정제 실행 한도 값")).not.toBeInTheDocument();
    // dream 잡의 앱 기본값은 6/24h다. 그 값이 화면 어디에도 없어야 한다.
    expect(card).not.toHaveTextContent("6/24h");
  });

  // 완료 조건 3. 아무것도 바꾸지 않은 저장은 그 필드를 지정하지 않는다.
  it("specifies nothing when an unlimited job is saved untouched", async () => {
    const installDreamJob = vi.fn().mockResolvedValue(true);
    renderCard({ managedJob: unlimitedJob }, installDreamJob);

    await userEvent.click(screen.getByRole("button", saveAction));
    await userEvent.click(screen.getByRole("button", confirmAction));

    expect(requestOf(installDreamJob).maxPer).toBeNull();
  });

  // 완료 조건 4. 다른 필드만 편집해도 제한 없음이 유지된다.
  it("leaves the quota unspecified when only another field is edited", async () => {
    const installDreamJob = vi.fn().mockResolvedValue(true);
    renderCard({ managedJob: unlimitedJob }, installDreamJob);

    fireEvent.change(screen.getByLabelText("dream 정제 주기"), { target: { value: "6h" } });
    await userEvent.click(screen.getByRole("button", saveAction));
    await userEvent.click(screen.getByRole("button", confirmAction));

    const request = requestOf(installDreamJob);
    expect(request.interval).toBe("6h");
    expect(request.maxPer).toBeNull();
  });

  // 완료 조건 5·6. 거부 문구가 역할 잡 카드·백엔드와 같다. 같은 상수를 함께 쓰므로 글자가 같다.
  it.each(["0/24h", "4/0h", "0/1s", "4/0d"])(
    "blocks %s and names both the job toggle and unlimited",
    async (value) => {
      const installDreamJob = vi.fn().mockResolvedValue(true);
      renderCard({ managedJob: dreamJob() }, installDreamJob);

      fireEvent.change(screen.getByLabelText("dream 정제 실행 한도 값"), { target: { value } });
      await userEvent.click(screen.getByRole("button", saveAction));

      const input = screen.getByLabelText("dream 정제 실행 한도 값");
      expect(input).toHaveAttribute("aria-invalid", "true");
      const message = document.getElementById(input.getAttribute("aria-describedby") ?? "");
      expect(message).toHaveTextContent("제한 없이 실행됩니다");
      expect(message).toHaveTextContent("잡을 끄고");
      expect(message).toHaveTextContent("제한 없음으로 지정");
      expect(screen.queryByRole("group", { name: "dream 잡 설치 확인" })).not.toBeInTheDocument();
      expect(installDreamJob).not.toHaveBeenCalled();
    },
  );

  it("accepts the smallest quota the daemon honours", async () => {
    const installDreamJob = vi.fn().mockResolvedValue(true);
    renderCard({ managedJob: dreamJob() }, installDreamJob);

    fireEvent.change(screen.getByLabelText("dream 정제 실행 한도 값"), { target: { value: "1/1s" } });
    await userEvent.click(screen.getByRole("button", saveAction));
    await userEvent.click(screen.getByRole("button", confirmAction));

    expect(requestOf(installDreamJob).maxPer).toEqual({ kind: "limit", value: "1/1s" });
  });

  // 완료 조건 7. 파일의 어긋난 값은 그대로 보이고, 고치기 전에는 다른 필드 편집도 막힌다(R5).
  it.each(["0/24h", "4/0h"])("shows %s from the file and blocks the save until it is fixed", async (value) => {
    const installDreamJob = vi.fn().mockResolvedValue(true);
    renderCard({ managedJob: dreamJob({ maxPer: value }) }, installDreamJob);

    expect(screen.getByRole("combobox", quotaSelect)).toHaveDisplayValue("한도 지정");
    expect(screen.getByLabelText("dream 정제 실행 한도 값")).toHaveValue(value);

    fireEvent.change(screen.getByLabelText("dream 정제 주기"), { target: { value: "6h" } });
    await userEvent.click(screen.getByRole("button", saveAction));

    expect(screen.getByLabelText("dream 정제 실행 한도 값")).toHaveAttribute("aria-invalid", "true");
    expect(installDreamJob).not.toHaveBeenCalled();
  });

  // 끄면 블록에서 빠지므로 검증할 값도 사라진다. 역할 잡 카드와 같은 규약이다.
  it("stops blocking once the job with a broken quota is turned off", async () => {
    const installDreamJob = vi.fn().mockResolvedValue(true);
    renderCard({ managedJob: dreamJob({ maxPer: "0/24h" }) }, installDreamJob);

    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", saveAction));
    await userEvent.click(screen.getByRole("button", confirmAction));

    expect(requestOf(installDreamJob).enabled).toBe(false);
  });

  // 완료 조건 8. 확인 화면이 "제한 없음"과 "없음"을 구분한다.
  it("reads an untouched unlimited job as changing nothing", async () => {
    renderCard({ managedJob: unlimitedJob });

    await userEvent.click(screen.getByRole("button", saveAction));

    expect(screen.getByRole("group", { name: "dream 잡 설치 확인" })).toHaveTextContent(
      "관리 블록에서 달라지는 값이 없습니다",
    );
  });

  it("labels the quota of an unlimited job as 제한 없음 and not as 없음", async () => {
    renderCard({ managedJob: unlimitedJob });

    // 다른 필드를 바꿔 차이 목록이 펼쳐지게 한다. 한도 칸은 그대로여야 한다.
    fireEvent.change(screen.getByLabelText("dream 정제 주기"), { target: { value: "6h" } });
    await userEvent.click(screen.getByRole("button", saveAction));

    const confirm = screen.getByRole("group", { name: "dream 잡 설치 확인" });
    expect(confirm).toHaveTextContent("실행 한도 제한 없음 — 그대로");
    expect(confirm).not.toHaveTextContent("실행 한도 없음");
  });

  it("shows the switch from a limit to unlimited as a change", async () => {
    renderCard({ managedJob: dreamJob() });

    chooseQuota("제한 없음");
    await userEvent.click(screen.getByRole("button", saveAction));

    expect(screen.getByRole("group", { name: "dream 잡 설치 확인" })).toHaveTextContent(
      "실행 한도 6/24h → 제한 없음 — 바뀜",
    );
  });

  // 블록에 없던 잡이 새로 켜지는 경우의 "없음"은 잡 자체가 없다는 뜻이다. 지금과 같다.
  it("still reads a job absent from the block as a missing value", async () => {
    renderCard({ managedJob: null });

    await userEvent.click(screen.getByRole("button", { name: "이 프로젝트에 dream 잡 설치" }));

    const confirm = screen.getByRole("group", { name: "dream 잡 설치 확인" });
    expect(confirm).toHaveTextContent("관리 블록에 없던 잡입니다");
    expect(confirm).toHaveTextContent("실행 한도 없음 → 6/24h — 바뀜");
  });

  // 완료 조건 9. 제한 없음인 잡을 껐다 켜면 그 상태가 돌아온다.
  it("recalls the chosen unlimited after the job is turned off and on", async () => {
    const installDreamJob = vi.fn().mockResolvedValue(true);
    renderCard({ managedJob: unlimitedJob });
    await userEvent.click(screen.getByRole("checkbox"));
    cleanup();

    // 저장을 거쳐 dream 잡이 블록에서 빠진 상태. 첫 설치 폼은 켬으로 시작하므로 끔→켬으로 태운다.
    renderCard({ managedJob: null }, installDreamJob);
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("checkbox"));

    expect(screen.getByRole("combobox", quotaSelect)).toHaveDisplayValue("제한 없음");
    expect(screen.queryByLabelText("dream 정제 실행 한도 값")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "이 프로젝트에 dream 잡 설치" }));
    await userEvent.click(screen.getByRole("button", confirmAction));

    // 기억한 값은 파일에 없으므로 지정 필드로 실려야 저장에 반영된다.
    expect(requestOf(installDreamJob).maxPer).toEqual({ kind: "unlimited" });
  });

  // 한도가 있던 잡은 지금과 같이 그 값으로 돌아온다. 위 경로가 이 동작을 깨지 않는다.
  it("still recalls a limit after the job is turned off and on", async () => {
    renderCard({ managedJob: dreamJob({ maxPer: "9/24h" }) });
    await userEvent.click(screen.getByRole("checkbox"));
    cleanup();

    renderCard({ managedJob: null });
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("checkbox"));

    expect(screen.getByRole("combobox", quotaSelect)).toHaveDisplayValue("한도 지정");
    expect(screen.getByLabelText("dream 정제 실행 한도 값")).toHaveValue("9/24h");
  });

  // 재설정은 앱 기본값으로 되돌리는 것이고 기본값은 언제나 한도 값이다(R1).
  it("resets an unlimited job back to the app default limit", async () => {
    const installDreamJob = vi.fn().mockResolvedValue(true);
    renderCard({ managedJob: unlimitedJob }, installDreamJob);

    await userEvent.click(screen.getByRole("button", { name: "dream 잡 기본값으로 재설정" }));
    await userEvent.click(screen.getByRole("button", { name: "확인하고 되돌리기" }));

    expect(requestOf(installDreamJob).maxPer).toEqual({ kind: "limit", value: "6/24h" });
  });
});
