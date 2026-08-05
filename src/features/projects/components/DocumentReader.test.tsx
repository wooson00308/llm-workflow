/**
 * 두 양식과 폴백의 검사 (SPEC-039 R1·R2·R6, TASK-120 완료 조건 1·2·4·5).
 *
 * 픽스처는 두 벌이다 — 요약 절을 가진 문서와 다른 이름의 절만 가진 문서. 뒤쪽이 폴백의 근거이고,
 * 화면이 절 이름의 후보를 추측하지 않는다는 것도 그 픽스처가 지킨다.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DocumentReader } from "./DocumentReader";

afterEach(cleanup);

const withSummary = [
  "# 문서 제목",
  "",
  "## 결정권자 요약",
  "",
  "이 작업이 끝나면 평문이 먼저 열립니다.",
  "",
  "### 딸린 절",
  "",
  "요약 안의 더 깊은 절입니다.",
  "",
  "## 기획 내용",
  "",
  "작업자가 작업자에게 쓴 본문입니다.",
].join("\n");

const withoutSummary = [
  "# 문서 제목",
  "",
  "## 요약",
  "",
  "이름이 다른 절입니다.",
  "",
  "## 기획 내용",
  "",
  "작업자가 작업자에게 쓴 본문입니다.",
].join("\n");

describe("DocumentReader", () => {
  it("문서를 열면 요약 절만 그린다", () => {
    render(<DocumentReader body={withSummary} />);

    expect(screen.getByText("이 작업이 끝나면 평문이 먼저 열립니다.")).toBeInTheDocument();
    expect(screen.getByText("요약 안의 더 깊은 절입니다.")).toBeInTheDocument();
    expect(screen.queryByText("작업자가 작업자에게 쓴 본문입니다.")).not.toBeInTheDocument();
  });

  it("토글 한 번으로 원문 전문에 닿고 요약 절도 함께 보인다", () => {
    render(<DocumentReader body={withSummary} />);

    fireEvent.click(screen.getByRole("button", { name: "원문 전문 보기" }));

    expect(screen.getByText("작업자가 작업자에게 쓴 본문입니다.")).toBeInTheDocument();
    // 기본 뷰에서 보이던 절이 원문에서도 전부 보인다. 원문은 자르지 않은 본문 그대로다.
    expect(screen.getByText("이 작업이 끝나면 평문이 먼저 열립니다.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "기획 내용" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "문서 제목" })).toBeInTheDocument();
  });

  it("토글을 다시 누르면 요약으로 돌아온다", () => {
    render(<DocumentReader body={withSummary} />);

    fireEvent.click(screen.getByRole("button", { name: "원문 전문 보기" }));
    fireEvent.click(screen.getByRole("button", { name: "요약만 보기" }));

    expect(screen.queryByText("작업자가 작업자에게 쓴 본문입니다.")).not.toBeInTheDocument();
  });

  it("토글의 펼침 상태를 보조 기술에 알린다", () => {
    render(<DocumentReader body={withSummary} />);

    expect(screen.getByRole("button", { name: "원문 전문 보기" })).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByRole("button", { name: "원문 전문 보기" }));
    expect(screen.getByRole("button", { name: "요약만 보기" })).toHaveAttribute("aria-expanded", "true");
  });

  it("요약 절이 없는 문서는 원문 전문이 그대로 열린다", () => {
    render(<DocumentReader body={withoutSummary} />);

    expect(screen.getByText("이름이 다른 절입니다.")).toBeInTheDocument();
    expect(screen.getByText("작업자가 작업자에게 쓴 본문입니다.")).toBeInTheDocument();
  });

  it("요약 절이 없어도 어떤 문구도 붙지 않는다", () => {
    const { container } = render(<DocumentReader body={withoutSummary} />);

    expect(screen.queryByText(/요약이 없/)).not.toBeInTheDocument();
    expect(screen.queryByText(/읽지 못/)).not.toBeInTheDocument();
    // 폴백은 오류가 아니다. 원문 하나만 남고 토글도 서지 않는다 — 눌러도 같은 것이 다시 나온다.
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(container.querySelectorAll(".markdown-body")).toHaveLength(1);
  });

  it("이름이 다른 절을 요약으로 오인하지 않는다", () => {
    render(<DocumentReader body={withoutSummary} />);

    expect(screen.queryByRole("button", { name: "원문 전문 보기" })).not.toBeInTheDocument();
  });

  it("빈 본문에도 문구를 지어내지 않는다", () => {
    const { container } = render(<DocumentReader body="" />);

    expect(container.querySelectorAll(".markdown-body")).toHaveLength(1);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
