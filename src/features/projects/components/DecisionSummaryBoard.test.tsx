import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { DecisionSummary } from "../domain/documentSections";
import { DecisionSummaryBoard } from "./DecisionSummaryBoard";

afterEach(cleanup);

const summary: DecisionSummary = {
  proposal: "**구조화된** 요약을 결정 보드로 보여 준다.",
  current: "일곱 항목이 전부 보인다.",
  after: "제안과 전후, 위험만 남아 결정이 빨라진다.",
  risk: "옛 문서의 나머지 항목은 원문 보기로만 보인다.",
};

describe("DecisionSummaryBoard", () => {
  it("제안·전후·위험 세 덩어리를 정해진 순서로 한 번씩 보여 준다", () => {
    render(<DecisionSummaryBoard summary={summary} />);

    const board = screen.getByRole("region", { name: "결정 보드" });
    const headings = within(board).getAllByRole("heading").map((heading) => heading.textContent);
    expect(headings).toEqual(["결정 보드", "제안", "현재", "변경 후", "비용과 위험"]);

    // 비포/애프터 한 쌍이 핵심 시각이다. 현재와 변경 후가 같은 묶음 안에 나란히 선다.
    const compare = within(board).getByRole("group", { name: "변화 전후" });
    expect(within(compare).getByRole("heading", { name: "현재" })).toBeInTheDocument();
    expect(within(compare).getByRole("heading", { name: "변경 후" })).toBeInTheDocument();

    const renderedValues = [...board.querySelectorAll(".markdown-body")].map((value) => value.textContent);
    for (const value of Object.values(summary)) {
      const plainValue = value.replaceAll("**", "");
      expect(renderedValues.filter((rendered) => rendered === plainValue)).toHaveLength(1);
    }
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

describe("DecisionSummaryBoard — 불릿형", () => {
  it("바뀌는 것 행들을 지금·앞으로 라벨과 함께 그리고 전후 상자는 그리지 않는다", () => {
    const { container } = render(
      <DecisionSummaryBoard
        summary={{
          proposal: "세션 표시가 일하는 세션과 끊긴 세션을 구분한다.",
          changes: [
            { before: "신호만 뜸해도 경고 카드", after: "실행이 살아 있으면 온화한 표시" },
            { whole: "카드마다 판단 근거 한 줄이 붙는다" },
          ],
          riskItems: ["화면이 실행 기록을 더 자주 읽는다"],
        }}
      />,
    );

    expect(screen.getByText("바뀌는 것")).toBeInTheDocument();
    expect(screen.getByText("신호만 뜸해도 경고 카드")).toBeInTheDocument();
    expect(screen.getByText("실행이 살아 있으면 온화한 표시")).toBeInTheDocument();
    expect(screen.getByText("카드마다 판단 근거 한 줄이 붙는다")).toBeInTheDocument();
    expect(screen.getByText("화면이 실행 기록을 더 자주 읽는다")).toBeInTheDocument();
    expect(container.querySelector(".decision-summary-compare")).toBeNull();
    expect(screen.queryByText("현재")).toBeNull();
    expect(screen.queryByText("변경 후")).toBeNull();
  });
});
