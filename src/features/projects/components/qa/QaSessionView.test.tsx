import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkGroupSummary } from "../../domain/types";
import { browserQaReviewDraftStore } from "../../infrastructure/browserQaReviewDraftStore";
import { QaSessionView } from "./QaSessionView";

type AuxiliaryMode = "scope" | "list" | null;

function feature(overrides: Partial<WorkGroupSummary> = {}): WorkGroupSummary {
  return {
    fileName: "GROUP-A.md", id: "GROUP-A", title: "결제", status: "active", displayStatus: "qa_ready",
    revision: 1, qaMode: "user", sourceSpecId: "SPEC-A", sourceDecisionId: "D-A", sourceQaDecisionId: null,
    updatedAt: "2026-08-14T09:00:00Z", description: "결제 개선",
    scenarios: [
      { id: "QA-01", title: "카드 추가", body: "버튼을 누르면 카드가 보입니다." },
      { id: "QA-02", title: "카드 삭제", body: "삭제하면 카드가 사라집니다." },
    ],
    ...overrides,
  };
}

function SessionHarness({
  featureValue = feature(),
  initialAuxiliaryMode = null,
  onReview = vi.fn(),
  startScenarioId,
}: {
  featureValue?: WorkGroupSummary;
  initialAuxiliaryMode?: AuxiliaryMode;
  onReview?: () => void;
  startScenarioId?: string | null;
}) {
  const [auxiliaryMode, setAuxiliaryMode] = useState<AuxiliaryMode>(initialAuxiliaryMode);
  return (
    <QaSessionView
      auxiliaryMode={auxiliaryMode}
      feature={featureValue}
      onAuxiliaryModeChange={setAuxiliaryMode}
      onReview={onReview}
      scopePanel={<section aria-label="기능 설명 패널">결제 기능 설명</section>}
      startScenarioId={startScenarioId}
      workflowDirectory="wf"
    />
  );
}

function renderSession(props: Parameters<typeof SessionHarness>[0] = {}) {
  return render(<SessionHarness {...props} />);
}

beforeEach(() => {
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("QaSessionView", () => {
  it("renders scenario markdown and advances after confirmation", async () => {
    const user = userEvent.setup();
    renderSession({ startScenarioId: "QA-01" });
    const panel = screen.getByRole("article", { name: "현재 항목" });
    expect(within(panel).getByText("버튼을 누르면 카드가 보입니다.")).toBeInTheDocument();
    await user.click(within(panel).getByRole("button", { name: "확인하고 다음" }));
    expect(within(panel).getByRole("heading", { name: "카드 삭제" })).toBeInTheDocument();
    expect(browserQaReviewDraftStore.load("wf", "GROUP-A", 1)?.entries["QA-01"].outcome).toBe("confirmed");
  });

  it("requires a problem description before recording revision intent", async () => {
    const user = userEvent.setup();
    renderSession({ startScenarioId: "QA-01" });
    await user.click(screen.getByRole("button", { name: "문제 있음" }));
    expect(screen.getByText("문제를 기록하려면 설명이 필요합니다.")).toBeInTheDocument();
    expect(browserQaReviewDraftStore.load("wf", "GROUP-A", 1)?.entries["QA-01"].outcome).toBeNull();
    await user.type(screen.getByLabelText("문제 설명"), "목록이 갱신되지 않음");
    expect(browserQaReviewDraftStore.load("wf", "GROUP-A", 1)?.entries["QA-01"].outcome).toBe("revision_requested");
  });

  it("marks a saved scenario for recheck when the group changed", () => {
    browserQaReviewDraftStore.save("wf", "GROUP-A", 1, {
      startedAt: "now", requestId: "request-1",
      entries: { "QA-01": { outcome: "confirmed", comment: "", expectedUpdatedAt: "old" } },
    });
    renderSession({ startScenarioId: "QA-01" });
    expect(screen.getByText("다시 확인 필요")).toBeInTheDocument();
  });

  it("keeps stale saved outcomes out of the completed count", () => {
    browserQaReviewDraftStore.save("wf", "GROUP-A", 1, {
      startedAt: "now", requestId: "request-1",
      entries: {
        "QA-01": { outcome: "confirmed", comment: "", expectedUpdatedAt: "old" },
        "QA-02": { outcome: "confirmed", comment: "", expectedUpdatedAt: "old" },
      },
    });

    renderSession({ startScenarioId: "QA-01" });

    expect(screen.getByText("2개를 더 확인하면 최종 검토로 넘어갈 수 있습니다.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "최종 검토로 이동" })).not.toBeInTheDocument();
  });

  it("starts without an auxiliary panel and keeps the two disclosures at different emphasis", () => {
    renderSession();

    const scopeToggle = screen.getByRole("button", { name: "기능 설명 보기" });
    const listToggle = screen.getByRole("button", { name: "항목 목록 2" });
    expect(scopeToggle).toHaveAttribute("aria-expanded", "false");
    expect(scopeToggle).toHaveClass("text-button");
    expect(listToggle).toHaveAttribute("aria-expanded", "false");
    expect(listToggle).toHaveClass("secondary-button");
    expect(screen.queryByRole("region", { name: "기능 설명 패널" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "확인 항목" })).not.toBeInTheDocument();
  });

  it("keeps the scope and item list mutually exclusive in the auxiliary slot", () => {
    renderSession();

    fireEvent.click(screen.getByRole("button", { name: "기능 설명 보기" }));
    expect(screen.getByRole("region", { name: "기능 설명 패널" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "확인 항목" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "항목 목록 2" }));
    expect(screen.queryByRole("region", { name: "기능 설명 패널" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "확인 항목" })).toBeInTheDocument();

    const session = screen.getByRole("region", { name: "항목 확인" });
    expect(Array.from(session.children).map((child) => child.className)).toEqual([
      "qa-session-bar",
      "qa-session-auxiliary",
      "qa-session-body",
      "qa-session-footer",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "목록 닫기" }));
    expect(screen.queryByRole("region", { name: "확인 항목" })).not.toBeInTheDocument();
  });

  it("closes the compact list after selecting another item", () => {
    renderSession();
    fireEvent.click(screen.getByRole("button", { name: "항목 목록 2" }));
    expect(screen.getByRole("region", { name: "확인 항목" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /카드 삭제/ }));
    expect(screen.queryByRole("region", { name: "확인 항목" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("article", { name: "현재 항목" })).getByRole("heading", { name: "카드 삭제" })).toBeInTheDocument();
  });
});
