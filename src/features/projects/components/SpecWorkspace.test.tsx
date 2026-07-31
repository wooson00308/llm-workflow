import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SpecDocument, WorkflowSummary } from "../domain/types";
import { SpecWorkspace } from "./SpecWorkspace";

const document: SpecDocument = {
  summary: {
    fileName: "SPEC-001.md",
    id: "SPEC-001",
    title: "승인 흐름",
    status: "user_review",
    updatedAt: "2026-07-30T00:00:00Z",
    excerpt: "사용자가 기획서를 검토한다.",
  },
  body: "# 승인 흐름\n\n## 기획 내용\n\n사용자가 기획서를 검토한다.",
};

const workflow: WorkflowSummary = {
  id: "wf_1",
  directory: "feature--wf_1",
  name: "Feature",
  status: "active",
  createdAt: "2026-07-30T00:00:00Z",
  counts: { ideas: 0, specs: 1, decisions: 1, tasks: 0, reports: 0 },
  items: { ideas: [], specs: [document.summary], tasks: [] },
};

describe("SpecWorkspace", () => {
  it("records approval inside the review workspace", async () => {
    const onDecision = vi.fn().mockResolvedValue(true);
    render(
      <SpecWorkspace
        busy={false}
        document={document}
        loading={false}
        onDecision={onDecision}
        onSelect={vi.fn()}
        workflow={workflow}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "승인 도장 찍기" }));

    await waitFor(() => expect(onDecision).toHaveBeenCalledWith("approved", ""));
    expect(screen.getByText("USER DECISION")).toBeInTheDocument();
    expect(screen.getByText("결정 Markdown을 안전하게 저장했습니다.")).toBeInTheDocument();
  });

  it("requires a comment before recording rejection", async () => {
    const onDecision = vi.fn().mockResolvedValue(true);
    render(
      <SpecWorkspace
        busy={false}
        document={document}
        loading={false}
        onDecision={onDecision}
        onSelect={vi.fn()}
        workflow={workflow}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "기획서 폐기" }));
    const submit = screen.getByRole("button", { name: "폐기 기록" });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("폐기 사유"), {
      target: { value: "성공 조건이 불명확합니다." },
    });
    fireEvent.click(submit);

    await waitFor(() =>
      expect(onDecision).toHaveBeenCalledWith(
        "rejected",
        "성공 조건이 불명확합니다.",
      ),
    );
  });

  it("records a revision request with user guidance", async () => {
    const onDecision = vi.fn().mockResolvedValue(true);
    render(
      <SpecWorkspace
        busy={false}
        document={document}
        loading={false}
        onDecision={onDecision}
        onSelect={vi.fn()}
        workflow={workflow}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "수정 요청" }));
    const submit = screen.getByRole("button", { name: "수정 요청 기록" });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("수정 요청 내용"), {
      target: { value: "성공 조건을 수치로 구체화해 주세요." },
    });
    fireEvent.click(submit);

    await waitFor(() =>
      expect(onDecision).toHaveBeenCalledWith(
        "revision_requested",
        "성공 조건을 수치로 구체화해 주세요.",
      ),
    );
    expect(screen.getByText("수정 요청")).toBeInTheDocument();
  });
});
