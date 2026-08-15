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
