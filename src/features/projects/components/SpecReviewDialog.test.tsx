import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SpecReviewDialog } from "./SpecReviewDialog";
import type { SpecDocument } from "../domain/types";

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

describe("SpecReviewDialog", () => {
  it("records approval and shows the stamp", async () => {
    const onDecision = vi.fn().mockResolvedValue(true);
    render(
      <SpecReviewDialog
        busy={false}
        document={document}
        onClose={vi.fn()}
        onDecision={onDecision}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "승인 도장 찍기" }));

    await waitFor(() =>
      expect(onDecision).toHaveBeenCalledWith("approved", ""),
    );
    expect(screen.getByText("USER DECISION")).toBeInTheDocument();
    expect(screen.getByText("결정 Markdown을 안전하게 저장했습니다.")).toBeInTheDocument();
  });

  it("requires a comment before recording rejection", async () => {
    const onDecision = vi.fn().mockResolvedValue(true);
    render(
      <SpecReviewDialog
        busy={false}
        document={document}
        onClose={vi.fn()}
        onDecision={onDecision}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "폐기" }));
    const submit = screen.getByRole("button", { name: "코멘트와 함께 폐기" });
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
});
