import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
      { id: "QA-01", title: "카드 추가", body: "카드 추가 버튼을 누르면 새 카드가 목록에 나타납니다." },
      { id: "QA-02", title: "카드 삭제", body: "삭제를 누르면 카드가 목록에서 사라집니다." },
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
    const readyButton = within(ready).getByRole("button", { name: /카드 등록 흐름/ });
    expect(readyButton).toHaveTextContent("직접 확인 2개");
    expect(readyButton).toHaveTextContent("시작");
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

  it("shows only architect-authored group scenarios without reading task documents", async () => {
    const user = userEvent.setup();
    render(<QaWorkbench onSubmit={vi.fn().mockResolvedValue(null)} workflow={workflow([group()])} />);

    await user.click(screen.getByRole("button", { name: /카드 등록 흐름/ }));
    expect(screen.getByRole("heading", { level: 1, name: "카드 등록 흐름" })).toBeInTheDocument();
    expect(within(screen.getByRole("article", { name: "현재 항목" })).getByText(/카드 추가 버튼/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "기능 설명 보기" }));
    expect(screen.getByRole("region", { name: "바뀐 점" })).toHaveTextContent("결제 화면의 카드 등록 단계를 줄였습니다.");
    expect(screen.getByRole("region", { name: "사용자가 확인할 결과" })).toHaveTextContent("카드 삭제");

    const featureHeader = screen.getByRole("heading", { level: 1, name: "카드 등록 흐름" }).closest("header");
    expect(featureHeader).not.toBeNull();
    expect(within(featureHeader as HTMLElement).queryByRole("button", { name: /기능 설명|항목 목록/ })).not.toBeInTheDocument();
  });

  it("closes auxiliary content when entering review and reopening an item", async () => {
    const user = userEvent.setup();
    render(<QaWorkbench onSubmit={vi.fn().mockResolvedValue(null)} workflow={workflow([group()])} />);

    await user.click(screen.getByRole("button", { name: /카드 등록 흐름/ }));
    await user.click(screen.getByRole("button", { name: "기능 설명 보기" }));
    expect(screen.getByRole("region", { name: "기능 설명과 전체 확인 범위" })).toBeInTheDocument();

    await user.click(within(screen.getByRole("article", { name: "현재 항목" })).getByRole("button", { name: "확인하고 다음" }));
    await user.click(within(screen.getByRole("article", { name: "현재 항목" })).getByRole("button", { name: "확인 완료" }));
    await user.click(screen.getByRole("button", { name: "최종 검토로 이동" }));
    expect(screen.queryByRole("region", { name: "기능 설명과 전체 확인 범위" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "기능 설명 보기" }));
    expect(screen.getByRole("region", { name: "기능 설명과 전체 확인 범위" })).toBeInTheDocument();
    const confirmed = screen.getByRole("region", { name: "확인한 항목" });
    const cardRow = within(confirmed).getByText("카드 추가").closest("details");
    expect(cardRow).not.toBeNull();
    await user.click(cardRow!.querySelector("summary")!);
    await user.click(within(cardRow as HTMLElement).getByRole("button", { name: "이 항목 다시 보기" }));
    expect(screen.getByRole("article", { name: "현재 항목" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "기능 설명과 전체 확인 범위" })).not.toBeInTheDocument();
  });

  it("submits one atomic decision for the group revision", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue({
      summary: { rootPath: "/tmp", initialized: true, projectId: "p", name: "P", compatibility: "current", activeLeases: [], workflows: [] },
      decisionFileName: "GROUP-QA-A.md",
      groupId: "GROUP-A",
      groupRevision: 2,
      outcome: "confirmed",
      status: "recorded",
    });
    render(<QaWorkbench onSubmit={onSubmit} workflow={workflow([group()])} />);

    await user.click(screen.getByRole("button", { name: /카드 등록 흐름/ }));
    await user.click(screen.getByRole("button", { name: "항목 목록 2" }));
    await user.click(within(screen.getByRole("region", { name: "확인 항목" })).getByRole("button", { name: /카드 추가/ }));
    await user.click(within(screen.getByRole("article", { name: "현재 항목" })).getByRole("button", { name: "확인하고 다음" }));
    await user.click(within(screen.getByRole("article", { name: "현재 항목" })).getByRole("button", { name: "확인 완료" }));
    await user.click(screen.getByRole("button", { name: "최종 검토로 이동" }));
    await user.click(screen.getByRole("button", { name: "기능 승인 기록하기" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      workflowDirectory: "feature--wf-1",
      fileName: "GROUP-A.md",
      expectedRevision: 2,
      expectedUpdatedAt: "2026-08-14T09:00:00Z",
      entries: [
        { scenarioId: "QA-01", outcome: "confirmed", comment: "" },
        { scenarioId: "QA-02", outcome: "confirmed", comment: "" },
      ],
    }));
    expect(onSubmit.mock.calls[0][0].requestId).toEqual(expect.any(String));
    expect(screen.getByRole("region", { name: "지금 확인할 기능" })).toBeInTheDocument();
  });

  it("opens a named group directly and returns to the queue", () => {
    const view = render(<QaWorkbench initialFeatureKey="GROUP-A" onSubmit={vi.fn().mockResolvedValue(null)} workflow={workflow([group()])} />);
    expect(screen.getByRole("heading", { level: 1, name: "카드 등록 흐름" })).toBeInTheDocument();
    view.rerender(<QaWorkbench initialFeatureKey={null} onSubmit={vi.fn().mockResolvedValue(null)} workflow={workflow([group()])} />);
    expect(screen.getByRole("region", { name: "지금 확인할 기능" })).toBeInTheDocument();

    view.rerender(<QaWorkbench initialFeatureKey="GROUP-A" onSubmit={vi.fn().mockResolvedValue(null)} workflow={workflow([group()])} />);
    fireEvent.click(screen.getByRole("button", { name: "← 대기열로 돌아가기" }));
    expect(screen.getByRole("region", { name: "지금 확인할 기능" })).toBeInTheDocument();
  });
});
