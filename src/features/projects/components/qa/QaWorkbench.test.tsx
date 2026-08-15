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
        "QA-01": { outcome: "confirmed", comment: "", expectedUpdatedAt: "2026-08-14T09:00:00Z" },
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
        "QA-01": { outcome: "confirmed", comment: "이전 메모", expectedUpdatedAt: "old" },
      },
    });
    render(<QaWorkbench onSubmit={vi.fn().mockResolvedValue(null)} workflow={workflow([group()])} />);

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
