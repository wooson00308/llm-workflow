import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MarkdownBody } from "./MarkdownBody";

afterEach(cleanup);

const body = [
  "# 기획서 제목",
  "",
  "**굵게**와 *기울임*과 `인라인 코드`를 지원한다.",
  "",
  "```ts",
  "const answer = 42;",
  "```",
  "",
  "> 인용문도 보여준다.",
  "",
  "| 항목 | 값 |",
  "| --- | --- |",
  "| 상태 | ~~취소~~ 진행 |",
  "",
  "- [ ] 남은 일",
  "",
  "[파일 계약](https://example.com/contract)",
].join("\n");

describe("MarkdownBody", () => {
  it("renders GitHub flavored markdown", () => {
    render(<MarkdownBody body={body} />);

    expect(screen.getByRole("heading", { name: "기획서 제목" })).toBeInTheDocument();
    expect(screen.getByText("굵게").tagName).toBe("STRONG");
    expect(screen.getByText("기울임").tagName).toBe("EM");
    expect(screen.getByText("인라인 코드").tagName).toBe("CODE");
    expect(screen.getByText("const answer = 42;").closest("pre")).not.toBeNull();
    expect(screen.getByText("인용문도 보여준다.").closest("blockquote")).not.toBeNull();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("취소").tagName).toBe("DEL");
    expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(screen.getByRole("link", { name: "파일 계약" })).toHaveAttribute("target", "_blank");
  });

  it("renders a single newline as a line break when preserveLineBreaks is on", () => {
    const { container } = render(
      <MarkdownBody body={"첫 줄\n둘째 줄\n셋째 줄"} preserveLineBreaks />,
    );

    expect(container.querySelectorAll("p")).toHaveLength(1);
    expect(container.querySelectorAll("br")).toHaveLength(2);
    expect(container.querySelector("p")).toHaveTextContent("첫 줄 둘째 줄 셋째 줄");
  });

  it("still starts a new paragraph on a blank line when preserveLineBreaks is on", () => {
    const { container } = render(
      <MarkdownBody body={"첫 줄\n둘째 줄\n\n새 문단"} preserveLineBreaks />,
    );

    const paragraphs = container.querySelectorAll("p");

    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0].querySelectorAll("br")).toHaveLength(1);
    expect(paragraphs[0]).toHaveTextContent("첫 줄 둘째 줄");
    expect(paragraphs[1].querySelectorAll("br")).toHaveLength(0);
    expect(paragraphs[1]).toHaveTextContent("새 문단");
  });

  it("swallows single newlines when preserveLineBreaks is not passed", () => {
    const { container } = render(<MarkdownBody body={"첫 줄\n둘째 줄\n\n새 문단"} />);

    expect(container.querySelectorAll("br")).toHaveLength(0);
    expect(container.querySelectorAll("p")).toHaveLength(2);
  });

  it("renders GitHub flavored markdown the same way when preserveLineBreaks is on", () => {
    render(<MarkdownBody body={body} preserveLineBreaks />);

    expect(screen.getByRole("heading", { name: "기획서 제목" })).toBeInTheDocument();
    expect(screen.getByText("굵게").tagName).toBe("STRONG");
    expect(screen.getByText("기울임").tagName).toBe("EM");
    expect(screen.getByText("인라인 코드").tagName).toBe("CODE");
    expect(screen.getByText("const answer = 42;").closest("pre")).not.toBeNull();
    expect(screen.getByText("인용문도 보여준다.").closest("blockquote")).not.toBeNull();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("취소").tagName).toBe("DEL");
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(screen.getByRole("link", { name: "파일 계약" })).toHaveAttribute("target", "_blank");
  });
});
