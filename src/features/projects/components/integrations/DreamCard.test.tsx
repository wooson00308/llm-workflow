import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  DreamIntegration,
  DreamRefinement,
  IntegrationReadFailure,
  IntegrationsSnapshot,
  ManagedDreamJob,
} from "../../domain/types";
import { DreamCard } from "./DreamCard";
import type { IntegrationCardProps } from "./IntegrationCard";

afterEach(cleanup);

const SKILL_PATH = "/Users/catze/.claude/skills/dream/SKILL.md";
const CONDITION = "dream-prep check-unprocessed --slug=-projects-workflow-labs";

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

/** 관리 블록에 앱 기본값 그대로 적힌 잡. 되돌아갈 앱 소유 필드가 없는 상태다. */
function dreamJob(overrides: Partial<ManagedDreamJob> = {}): ManagedDreamJob {
  return { interval: "2h", maxPer: "6/24h", model: "opus", appOwnedDrift: [], ...overrides };
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
    defaults: { interval: "2h", maxPer: "6/24h", model: "opus" },
    managedJob: null,
    lastRun: null,
    duplicateJobs: [],
    readFailures: [],
    ...overrides,
  };
}

/** dream 카드는 스냅샷의 dream payload와 섹션 공통 값(slug, 관리 블록 읽기 결과)만 읽는다. */
function snapshot(
  overrides: Partial<DreamIntegration> = {},
  managedBlockFailure: IntegrationReadFailure | null = null,
): IntegrationsSnapshot {
  return {
    supported: true,
    slug: "-projects-workflow-labs",
    managedBlockFailure,
    heartbeat: {
      installation: "installed",
      daemonRunning: true,
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
    expect(screen.getByLabelText("dream 정제 실행 한도")).toHaveValue("6/24h");
    expect(screen.getByLabelText("dream 정제 모델")).toHaveValue("opus");
    expect(card).toHaveTextContent("이 프로젝트의 dream 잡이 아직 없습니다");
    expect(card).toHaveTextContent("관측된 dream 실행이 15분 규모");
  });

  it("reads the installed values from the managed block", () => {
    renderCard({ managedJob: dreamJob({ interval: "4h", maxPer: "2/24h", model: "sonnet" }) });

    expect(screen.getByLabelText("dream 정제 주기")).toHaveValue("4h");
    expect(screen.getByLabelText("dream 정제 실행 한도")).toHaveValue("2/24h");
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
      },
      dreamJob({ maxPer: "2/24h" }),
    );
  });

  it("states the target file and that no project local file is written", async () => {
    renderCard();

    await userEvent.click(screen.getByRole("button", installAction));

    const confirm = screen.getByRole("group", { name: "dream 잡 설치 확인" });
    expect(confirm).toHaveTextContent("~/.claude/HEARTBEAT.md");
    expect(confirm).toHaveTextContent("전역 파일입니다");
    expect(confirm).toHaveTextContent("앱 관리 블록만 다시 씁니다");
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
    expect(confirm).toHaveTextContent("주기 6h · 실행 한도 2/24h · 모델 opus 값이 함께 사라집니다");
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

    expect(card).toHaveTextContent("건너뜀 · 처리할 대상 없음");
    expect(card).toHaveTextContent("2026-08-02T02:42:25 (로컬 시각)");
    expect(card).toHaveTextContent("12.5초");
    expect(card.querySelector(".integration-warning")).toBeNull();
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
    expect(confirm).toHaveTextContent("~/.claude/HEARTBEAT.md");
    expect(confirm).toHaveTextContent("잡의 활성·비활성 상태와 같은 블록의 역할 잡은 그대로 둡니다");
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
      { enabled: true, interval: "2h", maxPer: "6/24h", model: "opus" },
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
      maxPer: "6/24h",
      model: "opus",
    });
  });

  it("leaves the save action untouched", async () => {
    const installDreamJob = vi.fn().mockResolvedValue(true);
    renderCard({ managedJob: edited }, installDreamJob);

    await userEvent.click(screen.getByRole("button", { name: "dream 잡 변경 사항 저장" }));
    expect(screen.queryByRole("group", confirmGroup)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "확인하고 쓰기" }));

    expect(installDreamJob).toHaveBeenCalledWith(
      { enabled: true, interval: null, maxPer: null, model: null },
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

// R2. 두 연동이 HEARTBEAT.md 한 파일을 공유하므로 역할 잡 카드와 같은 규칙으로 막혀야 한다.
// 한쪽만 막으면 다른 쪽 저장이 같은 사고를 그대로 낸다.
describe("dream 카드 관리 블록 읽기 실패", () => {
  const failure = {
    path: "/Users/catze/.claude/HEARTBEAT.md",
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

describe("dream 카드 중복 잡 경고", () => {
  it("warns about a duplicate dream job with its concrete risk", () => {
    const card = renderCard({
      duplicateJobs: [{ name: "dream-labs", integration: "dream", role: null }],
    });

    expect(card).toHaveTextContent("관리 블록 밖에 같은 프로젝트의 dream 잡이 있습니다");
    expect(card).toHaveTextContent("dream-labs");
    expect(card).toHaveTextContent("같은 메모리 파일을 서로 덮어쓸 수 있습니다");
    expect(card).toHaveTextContent("앱은 사용자 잡을 지우지 않으므로");
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
    fireEvent.change(screen.getByLabelText("dream 정제 실행 한도"), { target: { value: "9/24h" } });

    fireEvent.click(toggle());
    fireEvent.click(toggle());

    expect(screen.getByLabelText("dream 정제 주기")).toHaveValue("6h");
    expect(screen.getByLabelText("dream 정제 실행 한도")).toHaveValue("9/24h");
  });
});
