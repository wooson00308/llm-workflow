import { describe, expect, it } from "vitest";
import { declarationsFrom } from "../../../../test/cssRules";
import qaCss from "./QaWorkbench.css?raw";

const wideStart = qaCss.indexOf("@container qa-canvas (min-width: 1040px)");
const compactStart = qaCss.indexOf("@container qa-canvas (max-width: 720px)");
const fallbackStart = qaCss.indexOf("@media (max-width: 980px)");
const baseCss = qaCss.slice(0, wideStart);
const wideCss = qaCss.slice(wideStart, compactStart);
const compactCss = qaCss.slice(compactStart, fallbackStart);

describe("품질 확인 적응형 작업대", () => {
  it("대기열은 전체 폭을 쓰고 검수 작업대만 균형 폭을 갖는 안전한 한 열을 기본값으로 둔다", () => {
    expect(wideStart).toBeGreaterThan(0);
    expect(compactStart).toBeGreaterThan(wideStart);

    const workbench = declarationsFrom(baseCss, ".qa-workbench", "QaWorkbench.css base rules");
    expect(workbench.get("width")).toBe("100%");
    expect(workbench.get("max-width")).toBe("none");
    expect(workbench.get("margin")).toBe("0");
    expect(workbench.get("container-name")).toBe("qa-canvas");
    expect(workbench.get("container-type")).toBe("inline-size");

    const featureScope = declarationsFrom(baseCss, ".qa-feature-scope-session", "QaWorkbench.css base rules");
    expect(featureScope.get("max-width")).toBe("1280px");
    expect(featureScope.get("margin")).toBe("0 auto");
    expect(featureScope.get("container-name")).toBe("qa-canvas");
    expect(featureScope.get("container-type")).toBe("inline-size");

    const featureHead = declarationsFrom(baseCss, ".qa-feature-session-head", "QaWorkbench.css base rules");
    expect(featureHead.get("max-width")).toBe("760px");
    expect(featureHead.get("margin")).toBe("0 auto");

    const session = declarationsFrom(baseCss, ".qa-session", "QaWorkbench.css base rules");
    expect(session.get("max-width")).toBe("760px");
    expect(session.get("margin")).toBe("0 auto");
    expect(session.get("grid-template-areas")).toContain('"progress"');
    expect(session.get("grid-template-areas")).toContain('"main"');

    const review = declarationsFrom(baseCss, ".qa-review", "QaWorkbench.css base rules");
    expect(review.get("max-width")).toBe("760px");
    expect(review.get("margin")).toBe("0 auto");
  });

  it("1040px 이상에서만 주 검수 영역과 컨텍스트 레일을 나눈다", () => {
    const queue = declarationsFrom(wideCss, ".qa-queue-layout", "QaWorkbench.css wide rules");
    expect(queue.get("grid-template-columns")).toBe("minmax(0, 1fr) minmax(280px, 300px)");

    const session = declarationsFrom(wideCss, ".qa-session", "QaWorkbench.css wide rules");
    expect(session.get("height")).toBe("clamp(480px, calc(100vh - 285px), 650px)");
    expect(session.get("max-width")).toBe("1098px");
    expect(session.get("grid-template-columns")).toBe("minmax(0, 760px) minmax(280px, 320px)");
    expect(session.get("grid-template-areas")).toContain('"main progress"');
    expect(session.get("grid-template-areas")).toContain('"main auxiliary"');
    expect(session.get("grid-template-areas")).toContain('"main footer"');
    expect(declarationsFrom(wideCss, ".qa-session-body", "QaWorkbench.css wide rules").get("height")).toBe("100%");

    const featureHead = declarationsFrom(wideCss, ".qa-feature-session-head", "QaWorkbench.css wide rules");
    expect(featureHead.get("max-width")).toBe("1098px");

    const review = declarationsFrom(wideCss, ".qa-review", "QaWorkbench.css wide rules");
    expect(review.get("max-width")).toBe("1098px");
    expect(review.get("grid-template-columns")).toBe("minmax(0, 760px) minmax(280px, 320px)");
    expect(declarationsFrom(wideCss, ".qa-review-decision", "QaWorkbench.css wide rules").get("position")).toBe("sticky");
  });

  it("QA Markdown은 읽기 폭을 지키며 카드 왼쪽선에 맞춘다", () => {
    const markdown = declarationsFrom(baseCss, ".qa-current-walkthrough .markdown-body", "QaWorkbench.css base rules");
    expect(markdown.get("max-width")).toBe("620px");
    expect(markdown.get("margin")).toBe("0");

    const reviewScope = declarationsFrom(baseCss, ".qa-review-scope-panel .qa-scope-overview", "QaWorkbench.css base rules");
    expect(reviewScope.get("max-height")).toBe("260px");
  });

  it("실제 콘텐츠가 720px 이하이면 카드 내부 스크롤을 해제한다", () => {
    const body = declarationsFrom(compactCss, ".qa-session-body, .qa-session-current", "QaWorkbench.css compact rules");
    expect(body.get("height")).toBe("auto");

    const current = declarationsFrom(compactCss, ".qa-session-current", "QaWorkbench.css compact rules");
    expect(current.get("grid-template-rows")).toBe("auto");
    expect(current.get("overflow")).toBe("visible");

    const scrollingRegions = declarationsFrom(
      compactCss,
      ".qa-current-content, .qa-session-index, .qa-scope-overview, .qa-session-auxiliary",
      "QaWorkbench.css compact rules",
    );
    expect(scrollingRegions.get("max-height")).toBe("none");
    expect(scrollingRegions.get("overflow")).toBe("visible");
  });
});
