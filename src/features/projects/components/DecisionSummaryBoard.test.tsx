import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { DecisionSummary } from "../domain/documentSections";
import { DecisionSummaryBoard } from "./DecisionSummaryBoard";

afterEach(cleanup);

const summary: DecisionSummary = {
  proposal: "**구조화된** 요약을 결정 보드로 보여 준다.",
  current: "평문 요약만 보인다.",
  after: "변화 흐름을 세 칸으로 읽는다.",
  userResult: "결정할 내용을 더 빨리 찾는다.",
  changed: "기획서와 개발 작업의 기본 요약 화면",
  unchanged: "원문 Markdown과 보고서 표시",
  risk: "좁은 창에서는 한 열로 쌓인다.",
  decisionRequest: "정보 순서와 원문 전환을 확인한다.",
};

describe("DecisionSummaryBoard", () => {
  it("이름이 있는 영역에서 정해진 DOM 순서와 목록 구조로 값을 한 번씩 보여 준다", () => {
    render(<DecisionSummaryBoard summary={summary} />);

    const board = screen.getByRole("region", { name: "결정 보드" });
    const headings = within(board).getAllByRole("heading").map((heading) => heading.textContent);
    expect(headings).toEqual([
      "결정 보드",
      "제안",
      "현재",
      "변경 후",
      "사용자 결과",
      "영향 범위",
      "비용과 위험",
      "결정 요청",
    ]);
    expect(within(screen.getByRole("list", { name: "변화 흐름" })).getAllByRole("listitem")).toHaveLength(3);
    const renderedValues = [...board.querySelectorAll(".markdown-body")].map((value) => value.textContent);
    for (const value of Object.values(summary)) {
      const plainValue = value.replaceAll("**", "");
      expect(renderedValues.filter((rendered) => rendered === plainValue)).toHaveLength(1);
    }
  });

  it("영향 값은 변경과 유지 이름에 각각 연결한다", () => {
    render(<DecisionSummaryBoard summary={summary} />);

    expect(screen.getByText("변경").closest("div")).toHaveTextContent(`변경${summary.changed}`);
    expect(screen.getByText("유지").closest("div")).toHaveTextContent(`유지${summary.unchanged}`);
  });

  it("위험 값이 없으면 제목과 영역을 만들지 않는다", () => {
    const { container } = render(<DecisionSummaryBoard summary={{ ...summary, risk: undefined }} />);

    expect(screen.queryByRole("heading", { name: "비용과 위험" })).not.toBeInTheDocument();
    expect(container.querySelector(".decision-summary-risk")).not.toBeInTheDocument();
  });

  it("문서 Markdown은 기존 안전한 렌더러를 거쳐 raw HTML을 DOM으로 만들지 않는다", () => {
    const { container } = render(
      <DecisionSummaryBoard summary={{ ...summary, current: "<script>window.bad = true</script>" }} />,
    );

    expect(container.querySelector("script")).not.toBeInTheDocument();
    expect(screen.getByText("<script>window.bad = true</script>")).toBeInTheDocument();
  });
});
