import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkGroupSummary, WorkflowSummary } from "../../domain/types";
import { browserQaReviewDraftStore } from "../../infrastructure/browserQaReviewDraftStore";
import { QaWorkbench } from "./QaWorkbench";

function stubStorage() {
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
  });
  return stored;
}

function group(overrides: Partial<WorkGroupSummary> = {}): WorkGroupSummary {
  return {
    fileName: "GROUP-A.md",
    id: "GROUP-A",
    title: "카드 등록 흐름",
    status: "active",
    displayStatus: "qa_ready",
    revision: 2,
    qaMode: "user",
    sourceSpecId: "SPEC-A",
    sourceDecisionId: "DECISION-A",
    sourceQaDecisionId: null,
    updatedAt: "2026-08-14T09:00:00Z",
    description: "결제 화면의 카드 등록 단계를 줄였습니다.",
    scenarios: [
      { id: "QA-01", title: "카드 등록 확인 플로우", body: "카드 추가 버튼을 누르면 새 카드가 목록에 나타나고, 삭제하면 목록에서 사라지는지 확인합니다." },
    ],
    ...overrides,
  };
}

function workflow(groups: WorkGroupSummary[]): WorkflowSummary {
  return {
    id: "wf-1",
    directory: "feature--wf-1",
    name: "Feature",
    status: "active",
    createdAt: "2026-08-01T00:00:00Z",
    counts: { ideas: 0, specs: 1, decisions: 1, workGroups: groups.length, tasks: 0, reports: 0 },
    items: { ideas: [], specs: [], workGroups: groups, tasks: [] },
  };
}

function recordedResult() {
  return {
    summary: { rootPath: "/tmp", initialized: true, projectId: "p", name: "P", compatibility: "current" as const, activeLeases: [], workflows: [] },
    decisionFileName: "GROUP-QA-A.md",
    groupId: "GROUP-A",
    groupRevision: 2,
    outcome: "confirmed" as const,
    status: "recorded" as const,
  };
}

beforeEach(() => { stubStorage(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("QaWorkbench work-group flow", () => {
  it("uses backend group status for the ready and upcoming queues", () => {
    const view = render(<QaWorkbench onSubmit={vi.fn().mockResolvedValue(null)} workflow={workflow([
      group(),
      group({ id: "GROUP-B", fileName: "GROUP-B.md", title: "알림 재설계", displayStatus: "developing" }),
      group({ id: "GROUP-C", fileName: "GROUP-C.md", title: "내부 정리", displayStatus: "automatic_completed", qaMode: "automatic" }),
    ])} />);

    const ready = screen.getByRole("region", { name: "지금 확인할 기능" });
    const upcoming = screen.getByRole("region", { name: "준비 중인 기능" });
    const layout = view.container.querySelector(".qa-queue-layout");
    expect(layout).toContainElement(ready);
    expect(layout).toContainElement(upcoming);
    expect(within(ready).getByRole("button", { name: /카드 등록 흐름/ })).toHaveTextContent("시작");
    expect(within(upcoming).getByText("알림 재설계")).toBeInTheDocument();
    expect(screen.queryByText("내부 정리")).not.toBeInTheDocument();
  });

  it("labels a ready group with a saved draft as continue", () => {
    browserQaReviewDraftStore.save("feature--wf-1", "GROUP-A", 2, {
      startedAt: "2026-08-14T09:30:00Z",
      requestId: "request-a",
      entries: {
        "QA-01": { outcome: "confirmed", comment: "", expectedUpdatedAt: "2026-08-14T09:00:00Z", qaBaseCommit: null },
      },
    });

    render(<QaWorkbench onSubmit={vi.fn().mockResolvedValue(null)} workflow={workflow([group()])} />);

    expect(within(screen.getByRole("region", { name: "지금 확인할 기능" })).getByRole("button", { name: /카드 등록 흐름/ })).toHaveTextContent("계속");
  });

  it("shows the whole flow at once with a single decision and no per-item stepper", async () => {
    const user = userEvent.setup();
    render(<QaWorkbench onSubmit={vi.fn().mockResolvedValue(null)} workflow={workflow([group()])} />);

    await user.click(screen.getByRole("button", { name: /카드 등록 흐름/ }));
    expect(screen.getByRole("heading", { level: 1, name: "카드 등록 흐름" })).toBeInTheDocument();
    expect(screen.getByText("결제 화면의 카드 등록 단계를 줄였습니다.")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "확인 플로우" })).toHaveTextContent(/카드 추가 버튼을 누르면/);

    // 항목별 확인·최종 검토 단계가 없다. 결정은 하나다.
    expect(screen.queryByRole("button", { name: /확인하고 다음|최종 검토로 이동|항목 목록/ })).not.toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "최종 결정" })).toBeInTheDocument();
  });

  it("records one approval for the whole group", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(recordedResult());
    render(<QaWorkbench onSubmit={onSubmit} workflow={workflow([group()])} />);

    await user.click(screen.getByRole("button", { name: /카드 등록 흐름/ }));
    await user.click(screen.getByRole("button", { name: "기대대로 동작함" }));
    await user.click(screen.getByRole("button", { name: "기능 승인 기록하기" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      workflowDirectory: "feature--wf-1",
      fileName: "GROUP-A.md",
      expectedRevision: 2,
      expectedUpdatedAt: "2026-08-14T09:00:00Z",
      entries: [{ scenarioId: "QA-01", outcome: "confirmed", comment: "" }],
    }));
    expect(onSubmit.mock.calls[0][0].requestId).toEqual(expect.any(String));
    await waitFor(() => expect(screen.getByRole("region", { name: "지금 확인할 기능" })).toBeInTheDocument());
    expect(browserQaReviewDraftStore.load("feature--wf-1", "GROUP-A", 2)).toBeNull();
  });

  it("requires a problem description before recording a rework request", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue({ ...recordedResult(), outcome: "revision_requested" });
    render(<QaWorkbench onSubmit={onSubmit} workflow={workflow([group()])} />);

    await user.click(screen.getByRole("button", { name: /카드 등록 흐름/ }));
    await user.click(screen.getByRole("button", { name: "문제 있음" }));
    await user.click(screen.getByRole("button", { name: "재작업 요청 기록하기" }));
    expect(screen.getByRole("alert")).toHaveTextContent("설명이 필요합니다");
    expect(onSubmit).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("문제 설명"), "카드가 목록에 나타나지 않음");
    await user.click(screen.getByRole("button", { name: "재작업 요청 기록하기" }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      entries: [{ scenarioId: "QA-01", outcome: "revision_requested", comment: "카드가 목록에 나타나지 않음" }],
    }));
  });

  it("drops a stale draft when the group changed and says so", async () => {
    const user = userEvent.setup();
    browserQaReviewDraftStore.save("feature--wf-1", "GROUP-A", 2, {
      startedAt: "2026-08-14T09:30:00Z",
      requestId: "request-a",
      entries: {
        "QA-01": { outcome: "confirmed", comment: "이전 메모", expectedUpdatedAt: "old", qaBaseCommit: null },
      },
    });
    render(<QaWorkbench onSubmit={vi.fn().mockResolvedValue(null)} workflow={workflow([group()])} />);

    await user.click(screen.getByRole("button", { name: /카드 등록 흐름/ }));
    expect(screen.getByText(/기능 내용이 바뀌어/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "기대대로 동작함" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "기능 승인 기록하기" })).toBeDisabled();
  });

  it("submits the base commit the reviewer was looking at", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(recordedResult());
    render(<QaWorkbench onSubmit={onSubmit} workflow={workflow([group({ qaBaseCommit: "commit-reviewed" })])} />);

    await user.click(screen.getByRole("button", { name: /카드 등록 흐름/ }));
    await user.click(screen.getByRole("button", { name: "기대대로 동작함" }));
    await user.click(screen.getByRole("button", { name: "기능 승인 기록하기" }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ qaBaseCommit: "commit-reviewed" }));
  });

  it("drops a saved draft when the reviewed code changed and says so", async () => {
    const user = userEvent.setup();
    browserQaReviewDraftStore.save("feature--wf-1", "GROUP-A", 2, {
      startedAt: "2026-08-14T09:30:00Z",
      requestId: "request-a",
      entries: {
        "QA-01": { outcome: "confirmed", comment: "이전 메모", expectedUpdatedAt: "2026-08-14T09:00:00Z", qaBaseCommit: "commit-before" },
      },
    });
    render(<QaWorkbench onSubmit={vi.fn().mockResolvedValue(null)} workflow={workflow([group({ qaBaseCommit: "commit-after" })])} />);

    await user.click(screen.getByRole("button", { name: /카드 등록 흐름/ }));
    expect(screen.getByText(/기능 내용이 바뀌어/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "기대대로 동작함" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "기능 승인 기록하기" })).toBeDisabled();
  });

  it("keeps the draft when the command fails", async () => {
    const user = userEvent.setup();
    render(<QaWorkbench onSubmit={vi.fn().mockResolvedValue(null)} workflow={workflow([group()])} />);

    await user.click(screen.getByRole("button", { name: /카드 등록 흐름/ }));
    await user.click(screen.getByRole("button", { name: "기대대로 동작함" }));
    await user.click(screen.getByRole("button", { name: "기능 승인 기록하기" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("기록하지 못했습니다");
    expect(browserQaReviewDraftStore.load("feature--wf-1", "GROUP-A", 2)).not.toBeNull();
    // 실패해도 플로우 화면에 그대로 남는다.
    expect(screen.getByRole("region", { name: "확인 플로우" })).toBeInTheDocument();
  });

  it("opens a named group directly and returns to the queue", () => {
    const view = render(<QaWorkbench initialFeatureKey="GROUP-A" onSubmit={vi.fn().mockResolvedValue(null)} workflow={workflow([group()])} />);
    expect(screen.getByRole("heading", { level: 1, name: "카드 등록 흐름" })).toBeInTheDocument();
    view.rerender(<QaWorkbench initialFeatureKey={null} onSubmit={vi.fn().mockResolvedValue(null)} workflow={workflow([group()])} />);
    expect(screen.getByRole("region", { name: "지금 확인할 기능" })).toBeInTheDocument();

    view.rerender(<QaWorkbench initialFeatureKey="GROUP-A" onSubmit={vi.fn().mockResolvedValue(null)} workflow={workflow([group()])} />);
    fireEvent.click(screen.getByRole("button", { name: "← 목록으로 돌아가기" }));
    expect(screen.getByRole("region", { name: "지금 확인할 기능" })).toBeInTheDocument();
  });
});

/** `DevelopmentBoard.test.tsx`가 쓰는 것과 같은 목록. 세 화면이 같은 기준으로 C11을 확인한다. */
const internalNames = [
  "configuration_error", "preparing_stalled", "human_judgment_required", "qa_ready",
  "metadata_invalid", "tasks_missing", "task_link_mismatch", "user_scenario_unusable",
  "automatic_scenario_present", "task_not_verified",
  "configurationIssues", "humanJudgmentNote", "displayStatus",
  "QaWorkbench.tsx", "src/features",
];

describe("QaWorkbench attention notes", () => {
  it("explains the problem, the owner and the absent user action in the upcoming queue", () => {
    render(<QaWorkbench onSubmit={vi.fn().mockResolvedValue(null)} workflow={workflow([
      group({
        id: "GROUP-B", fileName: "GROUP-B.md", title: "알림 재설계",
        displayStatus: "configuration_error",
        configurationIssues: ["tasks_missing", "user_scenario_unusable"],
      }),
    ])} />);

    const upcoming = screen.getByRole("region", { name: "준비 중인 기능" });
    const note = within(upcoming).getByRole("note", { name: "상태 설명" });
    expect(within(upcoming).getByText("알림 재설계")).toBeInTheDocument();
    expect(within(upcoming).getByText("구성 확인 필요")).toBeInTheDocument();
    expect(note).toHaveTextContent("품질 확인을 열 수 없습니다");
    expect(note).toHaveTextContent("아키텍트가 구성을 다시 맞춥니다.");
    expect(note).toHaveTextContent("지금 사용자가 할 일은 없습니다.");
    expect(within(note).getAllByRole("listitem")).toHaveLength(2);
  });

  it("names the architect for a stalled preparation and the developer for blocked development", () => {
    render(<QaWorkbench onSubmit={vi.fn().mockResolvedValue(null)} workflow={workflow([
      group({ id: "GROUP-B", fileName: "GROUP-B.md", title: "검색 개편", displayStatus: "preparing_stalled" }),
      group({ id: "GROUP-C", fileName: "GROUP-C.md", title: "알림 재설계", displayStatus: "blocked" }),
    ])} />);

    const notes = within(screen.getByRole("region", { name: "준비 중인 기능" })).getAllByRole("note", { name: "상태 설명" });
    expect(notes[0]).toHaveTextContent("아키텍트가 이어서 구성을 마칩니다.");
    expect(notes[1]).toHaveTextContent("개발자가 막힌 곳을 풀어 갑니다.");
  });

  it("adds no attention note beside the quality-check entry", () => {
    render(<QaWorkbench onSubmit={vi.fn().mockResolvedValue(null)} workflow={workflow([group()])} />);

    const ready = screen.getByRole("region", { name: "지금 확인할 기능" });
    expect(within(ready).getByRole("button", { name: /카드 등록 흐름/ })).toBeInTheDocument();
    expect(screen.queryByRole("note", { name: "상태 설명" })).not.toBeInTheDocument();
  });

  it("keeps a group in the upcoming queue when no reason came down with the status", () => {
    render(<QaWorkbench onSubmit={vi.fn().mockResolvedValue(null)} workflow={workflow([
      group({ id: "GROUP-B", fileName: "GROUP-B.md", title: "알림 재설계", displayStatus: "configuration_error" }),
    ])} />);

    const upcoming = screen.getByRole("region", { name: "준비 중인 기능" });
    const note = within(upcoming).getByRole("note", { name: "상태 설명" });
    expect(within(upcoming).getByText("알림 재설계")).toBeInTheDocument();
    expect(note).toHaveTextContent("아키텍트가 구성을 다시 맞춥니다.");
    expect(within(note).queryAllByRole("listitem")).toHaveLength(0);
  });

  it("shows the same explanation on a feature that can no longer be opened", () => {
    render(<QaWorkbench initialFeatureKey="GROUP-A" onSubmit={vi.fn().mockResolvedValue(null)} workflow={workflow([
      group({
        displayStatus: "human_judgment_required",
        configurationIssues: ["task_link_mismatch"],
        humanJudgmentNote: "작업 둘이 서로 다른 구성 버전을 가리켜 어느 쪽을 살릴지 정해야 합니다.",
      }),
    ])} />);

    const held = screen.getByRole("region", { name: "준비 중인 이유" });
    const note = within(held).getByRole("note", { name: "상태 설명" });
    expect(within(held).getByRole("heading", { name: "지금은 확인할 수 없습니다" })).toBeInTheDocument();
    expect(note).toHaveTextContent("사용자가 판단할 차례입니다.");
    expect(note).toHaveTextContent("어느 쪽을 살릴지 정해야 합니다");
    expect(within(note).getByText("판단할 내용")).toBeInTheDocument();
  });

  it("keeps the note a reading place and hides internal names", () => {
    const view = render(<QaWorkbench onSubmit={vi.fn().mockResolvedValue(null)} workflow={workflow([
      group({
        id: "GROUP-B", fileName: "GROUP-B.md", title: "알림 재설계",
        displayStatus: "configuration_error",
        configurationIssues: ["metadata_invalid", "tasks_missing", "task_link_mismatch", "user_scenario_unusable", "automatic_scenario_present", "task_not_verified"],
      }),
    ])} />);

    const note = screen.getByRole("note", { name: "상태 설명" });
    expect(within(note).queryByRole("button")).not.toBeInTheDocument();
    expect(within(note).queryByRole("link")).not.toBeInTheDocument();
    expect(note.querySelector(".qa-queue-state, .qa-queue-row")).toBeNull();

    const shown = view.container.textContent ?? "";
    for (const name of internalNames) expect(shown).not.toContain(name);
  });
});
