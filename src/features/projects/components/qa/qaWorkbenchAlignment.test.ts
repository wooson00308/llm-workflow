import { describe, expect, it } from "vitest";
import { declarationsFrom } from "../../../../test/cssRules";
import qaCss from "./QaWorkbench.css?raw";

const wideStart = qaCss.indexOf("@container qa-canvas (min-width: 1000px)");
const baseCss = qaCss.slice(0, wideStart);
const wideCss = qaCss.slice(wideStart);

describe("품질 확인 작업대 레이아웃", () => {
  it("기본은 전체 폭 한 열이고 높이를 고정하지 않는다", () => {
    expect(wideStart).toBeGreaterThan(0);

    const workbench = declarationsFrom(baseCss, ".qa-workbench", "QaWorkbench.css base rules");
    expect(workbench.get("width")).toBe("100%");
    expect(workbench.get("container-name")).toBe("qa-canvas");
    expect(workbench.get("container-type")).toBe("inline-size");

    const featureScope = declarationsFrom(baseCss, ".qa-feature-scope-session", "QaWorkbench.css base rules");
    expect(featureScope.get("max-width")).toBe("none");
    expect(featureScope.get("container-name")).toBe("qa-canvas");
    expect(featureScope.get("container-type")).toBe("inline-size");

    const layout = declarationsFrom(baseCss, ".qa-flow-layout", "QaWorkbench.css base rules");
    expect(layout.get("grid-template-columns")).toBeUndefined();
    expect(qaCss).not.toContain("100vh");
  });

  it("넓은 컨테이너에서만 플로우 옆에 결정 패널이 붙고 본문은 읽기 폭에서 멈춘다", () => {
    // 본문 열 상한 820px: 공간을 채우려고 카드가 끝까지 늘어나는 것 방지 (2026-08-14 피드백)
    const layout = declarationsFrom(wideCss, ".qa-flow-layout", "QaWorkbench.css wide rules");
    expect(layout.get("grid-template-columns")).toBe("minmax(0, 820px) 290px");
    expect(declarationsFrom(wideCss, ".qa-review-decision", "QaWorkbench.css wide rules").get("position")).toBe("sticky");
  });

  it("QA Markdown은 읽기 폭을 지키며 카드 왼쪽선에 맞춘다", () => {
    const markdown = declarationsFrom(baseCss, ".qa-flow-section .markdown-body", "QaWorkbench.css base rules");
    expect(markdown.get("max-width")).toBe("640px");
    expect(markdown.get("margin")).toBe("0");
  });
});
