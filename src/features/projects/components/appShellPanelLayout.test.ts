/**
 * 사이드바 폭을 정하는 스타일 규칙과 도메인 표가 같은 값을 말하는지 확인한다 (SPEC-080 R11, R13).
 *
 * `.app-shell`은 기본 규칙과 창 폭 980px 이하 규칙 둘로 나뉘어 있어 `declarationsOf`로는 집히지 않는다.
 * `decisionSummaryBoardLayout.test.ts`처럼 미디어 본문을 먼저 잘라 내고 두 쪽을 각각 넘긴다.
 */
import { describe, expect, it } from "vitest";
import cssText from "../../../App.css?raw";
import { declarationsFrom } from "../../../test/cssRules";
import { PANEL_LIMITS } from "../domain/panelLayout";
import controlsCssText from "./PanelLayoutControls.css?raw";

const NARROW_MEDIA = /@media \(max-width: 980px\)\s*\{([\s\S]*?)\n\}/;

/** 창 폭 980px 이하 규칙의 본문과, 그 묶음을 걷어 낸 나머지. */
const narrowCss = NARROW_MEDIA.exec(cssText)?.[1] ?? "";
const wideCss = cssText.replace(NARROW_MEDIA, "");

describe("앱 껍데기 사이드바 폭", () => {
  it("기본 규칙의 첫 칸은 변수를 쓰고, 되돌림 값이 영역 표의 기본 너비와 같다", () => {
    expect(declarationsFrom(wideCss, ".app-shell", "App.css 기본 규칙").get("grid-template-columns"))
      .toBe(`var(--sidebar-width, ${PANEL_LIMITS.sidebar.defaultWidth}px) minmax(0, 1fr)`);
  });

  it("창 폭 980px 이하 규칙의 첫 칸은 되돌림 값이 영역 표의 좁은 창 기본 너비와 같다", () => {
    expect(declarationsFrom(narrowCss, ".app-shell", "App.css 980px 이하 규칙").get("grid-template-columns"))
      .toBe(`var(--sidebar-width, ${PANEL_LIMITS.sidebar.narrowDefaultWidth}px) minmax(0, 1fr)`);
  });

  it("같은 폭의 기존 배치 전환 규칙은 그대로 남는다", () => {
    expect(declarationsFrom(narrowCss, ".idea-inbox-layout").get("grid-template-columns")).toBe("1fr");
    expect(declarationsFrom(narrowCss, ".spec-workspace-layout").get("grid-template-columns"))
      .toBe("190px minmax(340px, 1fr)");
    expect(declarationsFrom(narrowCss, ".stage-grid").get("grid-template-columns")).toBe("repeat(2, 1fr)");
  });

  it("같은 폭에서 리사이즈 핸들이 그려지지 않는다", () => {
    const media = NARROW_MEDIA.exec(controlsCssText)?.[1] ?? "";
    expect(declarationsFrom(media, ".panel-resize-handle", "PanelLayoutControls.css 980px 이하 규칙").get("display"))
      .toBe("none");
  });
});

describe("접힌 사이드바 자리", () => {
  it("여백과 경계선을 걷어 세로 바가 28px 자리를 그대로 채운다", () => {
    const collapsed = declarationsFrom(wideCss, ".sidebar-collapsed", "App.css 기본 규칙");
    expect(collapsed.get("padding")).toBe("0");
    expect(collapsed.get("border-right")).toBe("0");
  });

  it("핸들은 사이드바 오른쪽 경계에 겹쳐 선다", () => {
    const handle = declarationsFrom(wideCss, ".sidebar > .panel-resize-handle", "App.css 기본 규칙");
    expect(handle.get("position")).toBe("absolute");
    expect(handle.get("right")).toBe("0");
    expect(declarationsFrom(wideCss, ".sidebar", "App.css 기본 규칙").get("position")).toBe("relative");
  });
});
