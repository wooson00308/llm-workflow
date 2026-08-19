import cssText from "../../../App.css?raw";
import { describe, expect, it } from "vitest";

function declarations(selector: string, css: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const body = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
  return new Map(
    body.split(";").flatMap((entry) => {
      const colon = entry.indexOf(":");
      return colon < 0 ? [] : [[entry.slice(0, colon).trim(), entry.slice(colon + 1).trim()]];
    }),
  );
}

describe("결정 보드 반응형 레이아웃", () => {
  it("넓은 화면에서는 현재와 변경 후를 화살표를 사이에 두고 나란히 놓는다", () => {
    expect(declarations(".decision-summary-compare", cssText).get("grid-template-columns"))
      .toBe("minmax(0, 1fr) auto minmax(0, 1fr)");
  });

  it("좁은 화면에서는 전후를 DOM 순서 그대로 한 열로 쌓는다", () => {
    const media = /@media \(max-width: 700px\)\s*\{([\s\S]*?)\n\}/.exec(cssText)?.[1] ?? "";
    expect(declarations(".decision-summary-compare", media).get("grid-template-columns"))
      .toBe("minmax(0, 1fr)");
  });

  it("보드와 값은 콘텐츠 최소 폭을 해제하고 긴 토큰을 접는다", () => {
    expect(declarations(".decision-summary-board", cssText).get("min-width")).toBe("0");
    expect(declarations(".decision-summary-board", cssText).get("overflow-wrap")).toBe("anywhere");
    expect(declarations(".decision-summary-before, .decision-summary-after", cssText).get("min-width")).toBe("0");
  });
});

const THREE_VALUES =
  ".decision-summary-before .markdown-body p, .decision-summary-after .markdown-body p, .decision-summary-risk .markdown-body p";

describe("결정 보드 본문 조판", () => {
  it("현재와 변경 후와 비용과 위험의 문단을 제안 문단과 같은 크기와 행간으로 그린다", () => {
    const proposal = declarations(".decision-summary-proposal .markdown-body p", cssText);
    const three = declarations(THREE_VALUES, cssText);

    expect(three.get("font-size")).toBe(proposal.get("font-size"));
    expect(three.get("line-height")).toBe(proposal.get("line-height"));
    expect(proposal.get("font-size")).toBe("15px");
  });

  it("비용과 위험은 원문 보기 본문과 같은 읽기 폭 안에서 왼쪽에 붙는다", () => {
    // 선택자 앞의 줄바꿈은 `.decision-summary-board .markdown-body` 같은 하위 규칙 대신
    // 줄 머리에 선 `.markdown-body` 규칙을 집기 위한 것이다.
    const reader = declarations("\n.markdown-body", cssText);
    const risk = declarations(".decision-summary-risk", cssText);
    // 읽기 폭은 되찾은 폭만큼 오르는 변수가 되었다(SPEC-080 R8). 비교 상대는 그 변수의 되돌림 값이며,
    // SPEC-076이 이 확인으로 지키려 한 "한 줄 길이가 본문과 같다"는 사실은 그 값에서 그대로 유지된다.
    const fallback = /^var\(--document-reading-width, (.+)\)$/.exec(reader.get("max-width") ?? "")?.[1];

    expect(risk.get("max-width")).toBe(fallback);
    expect(fallback).toBe("620px");
    expect(risk.get("justify-self")).toBe("start");
  });

  it("보드와 네 자리 어디에도 줄 수 상한이나 높이 상한이나 말줄임이 없다", () => {
    const boxes = [
      ".decision-summary-board",
      ".decision-summary-proposal",
      ".decision-summary-before, .decision-summary-after",
      ".decision-summary-risk",
      THREE_VALUES,
    ];

    for (const selector of boxes) {
      const rule = declarations(selector, cssText);
      expect(rule.size).toBeGreaterThan(0);
      for (const property of ["-webkit-line-clamp", "line-clamp", "max-height", "text-overflow"]) {
        expect(rule.has(property)).toBe(false);
      }
    }
  });
});
