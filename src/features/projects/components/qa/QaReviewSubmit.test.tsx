import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkGroupSummary } from "../../domain/types";
import { browserQaReviewDraftStore } from "../../infrastructure/browserQaReviewDraftStore";
import { QaReviewSubmit } from "./QaReviewSubmit";

function feature(): WorkGroupSummary {
  return {
    fileName: "GROUP-A.md", id: "GROUP-A", title: "결제", status: "active", displayStatus: "qa_ready", revision: 3,
    qaMode: "user", sourceSpecId: "SPEC-A", sourceDecisionId: "D-A", sourceQaDecisionId: null,
    updatedAt: "2026-08-14T09:00:00Z", description: "결제 개선",
    scenarios: [{ id: "QA-01", title: "카드 추가", body: "카드를 추가합니다." }],
  };
}

beforeEach(() => {
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function store(outcome: "confirmed" | "revision_requested", expectedUpdatedAt = feature().updatedAt) {
  browserQaReviewDraftStore.save("wf", "GROUP-A", 3, {
    startedAt: "now", requestId: "request-1",
    entries: { "QA-01": { outcome, comment: outcome === "revision_requested" ? "다르게 보임" : "", expectedUpdatedAt } },
  });
}

function scopeProps() {
  return {
    onScopeOpenChange: vi.fn(),
    scopeOpen: false,
    scopePanel: <div>기능 설명 패널</div>,
  };
}

describe("QaReviewSubmit", () => {
  it("submits one group decision and clears the revision draft", async () => {
    const user = userEvent.setup();
    store("confirmed");
    const onRecorded = vi.fn();
    const onSubmit = vi.fn().mockResolvedValue({
      summary: {}, decisionFileName: "GROUP-QA.md", groupId: "GROUP-A", groupRevision: 3,
      outcome: "confirmed", status: "recorded",
    });
    render(<QaReviewSubmit {...scopeProps()} feature={feature()} onEditItem={vi.fn()} onRecorded={onRecorded} onSubmit={onSubmit} workflowDirectory="wf" />);
    await user.click(screen.getByRole("button", { name: "기능 승인 기록하기" }));
    expect(onSubmit).toHaveBeenCalledWith({
      workflowDirectory: "wf", fileName: "GROUP-A.md", expectedRevision: 3,
      expectedUpdatedAt: "2026-08-14T09:00:00Z", requestId: "request-1",
      entries: [{ scenarioId: "QA-01", outcome: "confirmed", comment: "" }],
    });
    expect(browserQaReviewDraftStore.load("wf", "GROUP-A", 3)).toBeNull();
    expect(onRecorded).toHaveBeenCalledTimes(1);
  });

  it("explains that one problem sends the whole group to rework", () => {
    store("revision_requested");
    render(<QaReviewSubmit {...scopeProps()} feature={feature()} onEditItem={vi.fn()} onRecorded={vi.fn()} onSubmit={vi.fn().mockResolvedValue(null)} workflowDirectory="wf" />);
    expect(screen.getByText("하나 이상의 문제가 있어 이 기능 전체가 재작업으로 돌아갑니다.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "재작업 요청 기록하기" })).toBeInTheDocument();
  });

  it("blocks a stale group before the backend call", async () => {
    const user = userEvent.setup();
    store("confirmed", "old");
    const onSubmit = vi.fn();
    render(<QaReviewSubmit {...scopeProps()} feature={feature()} onEditItem={vi.fn()} onRecorded={vi.fn()} onSubmit={onSubmit} workflowDirectory="wf" />);
    await user.click(screen.getByRole("button", { name: "기능 승인 기록하기" }));
    expect(screen.getByRole("alert")).toHaveTextContent("다시 보지 않은 항목이 1개");
    expect(screen.getByRole("button", { name: "이 항목 다시 보기" })).toHaveFocus();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("keeps the draft when the command fails", async () => {
    store("confirmed");
    const onEditItem = vi.fn();
    render(<QaReviewSubmit {...scopeProps()} feature={feature()} onEditItem={onEditItem} onRecorded={vi.fn()} onSubmit={vi.fn().mockResolvedValue(null)} workflowDirectory="wf" />);
    fireEvent.click(screen.getByRole("button", { name: "기능 승인 기록하기" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("기록하지 못했습니다");
    expect(onEditItem).toHaveBeenCalledWith("QA-01");
    expect(browserQaReviewDraftStore.load("wf", "GROUP-A", 3)).not.toBeNull();
  });

  it("orders the review before the final decision and controls the scope disclosure", async () => {
    const user = userEvent.setup();
    store("confirmed");
    const onScopeOpenChange = vi.fn();
    const common = {
      feature: feature(),
      onEditItem: vi.fn(),
      onRecorded: vi.fn(),
      onScopeOpenChange,
      onSubmit: vi.fn().mockResolvedValue(null),
      scopePanel: <div>기능 설명 패널</div>,
      workflowDirectory: "wf",
    };
    const view = render(<QaReviewSubmit {...common} scopeOpen={false} />);

    const review = screen.getByRole("region", { name: "제출 전 검토" });
    expect(review.firstElementChild).toHaveClass("qa-review-main");
    expect(review.lastElementChild).toHaveClass("qa-review-decision");
    const main = review.firstElementChild as HTMLElement;
    const decision = screen.getByRole("complementary", { name: "최종 결정" });
    expect(within(main).queryByLabelText("검토 결과 요약")).not.toBeInTheDocument();
    expect(within(decision).getByLabelText("검토 결과 요약")).toHaveTextContent("문제 0확인 1");
    expect(within(decision).getByText("모든 확인 결과를 이 기능의 승인으로 기록합니다.")).toBeInTheDocument();
    expect(screen.queryByText("기능 설명 패널")).not.toBeInTheDocument();

    await user.click(within(decision).getByRole("button", { name: "기능 설명 보기" }));
    expect(onScopeOpenChange).toHaveBeenLastCalledWith(true);
    view.rerender(<QaReviewSubmit {...common} scopeOpen />);
    expect(within(decision).getByText("기능 설명 패널")).toBeInTheDocument();
    await user.click(within(decision).getByRole("button", { name: "기능 설명 닫기" }));
    expect(onScopeOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("keeps problem items first and confirmed items muted and collapsed", () => {
    const mixed = feature();
    mixed.scenarios = [
      { id: "QA-01", title: "카드 추가", body: "카드를 추가합니다." },
      { id: "QA-02", title: "카드 삭제", body: "카드를 삭제합니다." },
    ];
    browserQaReviewDraftStore.save("wf", mixed.id, mixed.revision, {
      startedAt: "now",
      requestId: "request-1",
      entries: {
        "QA-01": { outcome: "revision_requested", comment: "다르게 보임", expectedUpdatedAt: mixed.updatedAt },
        "QA-02": { outcome: "confirmed", comment: "", expectedUpdatedAt: mixed.updatedAt },
      },
    });

    render(<QaReviewSubmit {...scopeProps()} feature={mixed} onEditItem={vi.fn()} onRecorded={vi.fn()} onSubmit={vi.fn().mockResolvedValue(null)} workflowDirectory="wf" />);

    const main = screen.getByRole("region", { name: "제출 전 검토" }).firstElementChild as HTMLElement;
    const sections = main.querySelectorAll<HTMLElement>(".qa-review-section");
    expect(sections).toHaveLength(2);
    expect(sections[0]).toHaveAttribute("aria-label", "문제가 있는 항목");
    expect(sections[0].querySelector("details")).toHaveAttribute("open");
    expect(sections[1]).toHaveAttribute("aria-label", "확인한 항목");
    expect(sections[1]).toHaveClass("qa-review-section-muted");
    expect(sections[1].querySelector("details")).not.toHaveAttribute("open");
  });
});
