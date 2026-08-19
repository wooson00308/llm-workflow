/**
 * 문서 화면 두 곳의 격자와 읽기 폭을 정하는 스타일 규칙이 도메인 표와 같은 값을 말하는지 확인한다
 * (SPEC-080 R8, R11, R13).
 *
 * `.spec-workspace-layout`과 `.idea-inbox-layout`은 기본 규칙과 창 폭 980px 이하 규칙 둘로 나뉘어 있어
 * `declarationsOf`로는 집히지 않는다. `appShellPanelLayout.test.ts`처럼 미디어 본문을 먼저 잘라 내고
 * 두 쪽을 각각 넘긴다.
 */
import { describe, expect, it } from "vitest";
import cssText from "../../../App.css?raw";
import { declarationsFrom } from "../../../test/cssRules";
import blockedTaskCssText from "./BlockedTaskPanel.css?raw";
import { COLLAPSED_PANEL_WIDTH, PANEL_LIMITS, READING_WIDTH_MIN } from "../domain/panelLayout";
import controlsCssText from "./PanelLayoutControls.css?raw";
import qaCssText from "./qa/QaWorkbench.css?raw";

const NARROW_MEDIA = /@media \(max-width: 980px\)\s*\{([\s\S]*?)\n\}/;

/** 결정 보드는 이 폭에서도 자기 규칙을 다시 쓴다. 기본 규칙만 집으려면 이 묶음도 함께 걷어야 한다. */
const BOARD_MEDIA = /@media \(max-width: 700px\)\s*\{([\s\S]*?)\n\}/;

/** 창 폭 980px 이하 규칙의 본문과, 두 미디어 묶음을 모두 걷어 낸 나머지. */
const narrowCss = NARROW_MEDIA.exec(cssText)?.[1] ?? "";
const wideCss = cssText.replace(NARROW_MEDIA, "").replace(BOARD_MEDIA, "");

const readingWidth = (selector: string) =>
  declarationsFrom(wideCss, selector, "App.css 기본 규칙").get("max-width");

describe("문서 화면 패널 격자", () => {
  it("기획서 화면의 목록 칸과 결정 칸은 변수를 쓰고, 되돌림 값이 지금 배치와 같다", () => {
    const list = PANEL_LIMITS.specList.minWidth;
    const decision = PANEL_LIMITS.specDecision.minWidth;

    expect(declarationsFrom(wideCss, ".spec-workspace-layout", "App.css 기본 규칙").get("grid-template-columns"))
      .toBe(
        `var(--spec-list-width, minmax(${list}px, .72fr))` +
          " minmax(340px, 1.45fr)" +
          ` var(--spec-decision-width, minmax(${decision}px, .68fr))`,
      );
  });

  it("아이디어 화면의 목록 칸도 같은 방식이고 되돌림 값이 지금 배치와 같다", () => {
    expect(declarationsFrom(wideCss, ".idea-inbox-layout", "App.css 기본 규칙").get("grid-template-columns"))
      .toBe(`var(--idea-list-width, minmax(${PANEL_LIMITS.ideaList.minWidth}px, .85fr)) minmax(360px, 1.15fr)`);
  });

  it("접힌 패널 자리는 상자 장식을 걷어 세로 바가 28px 자리를 그대로 채운다", () => {
    const slot = declarationsFrom(wideCss, ".panel-collapsed-slot", "App.css 기본 규칙");
    expect(slot.get("padding")).toBe("0");
    expect(slot.get("border")).toBe("0");
    expect(declarationsFrom(controlsCssText, ".panel-collapsed-bar", "PanelLayoutControls.css").get("width"))
      .toBe(`${COLLAPSED_PANEL_WIDTH}px`);
  });

  it("핸들은 각 패널의 경계에 겹쳐 서고, 결정 패널만 왼쪽 경계를 잡는다", () => {
    const right = declarationsFrom(
      wideCss,
      ".spec-list-panel > .panel-resize-handle, .idea-list-panel > .panel-resize-handle",
      "App.css 기본 규칙",
    );
    const left = declarationsFrom(wideCss, ".decision-panel > .panel-resize-handle", "App.css 기본 규칙");

    expect(right.get("position")).toBe("absolute");
    expect(right.get("right")).toBe("0");
    expect(left.get("left")).toBe("0");
    expect(declarationsFrom(wideCss, ".spec-list-panel, .decision-panel, .idea-list-panel", "App.css 기본 규칙").get("position"))
      .toBe("relative");
  });
});

describe("창 폭 980px 이하 배치", () => {
  it("결정 패널이 아래쪽 전체 폭으로 내려가고 아이디어 화면이 한 칸이 된다", () => {
    expect(declarationsFrom(narrowCss, ".decision-panel", "App.css 980px 이하 규칙").get("grid-column"))
      .toBe("1 / -1");
    expect(declarationsFrom(narrowCss, ".idea-inbox-layout", "App.css 980px 이하 규칙").get("grid-template-columns"))
      .toBe("1fr");
  });

  it("같은 폭에서 리사이즈 핸들이 그려지지 않고 접힌 자리는 높이 28px의 가로 막대가 된다", () => {
    const media = NARROW_MEDIA.exec(controlsCssText)?.[1] ?? "";
    expect(declarationsFrom(media, ".panel-resize-handle", "PanelLayoutControls.css 980px 이하 규칙").get("display"))
      .toBe("none");
    expect(declarationsFrom(controlsCssText, ".panel-collapsed-bar-horizontal", "PanelLayoutControls.css").get("height"))
      .toBe(`${COLLAPSED_PANEL_WIDTH}px`);
  });
});

describe("문서 본문의 읽기 폭", () => {
  it("본문과 토글 줄이 같은 변수를 쓰고 되돌림 값이 읽기 폭 시작값과 같다", () => {
    const fallback = `var(--document-reading-width, ${READING_WIDTH_MIN}px)`;
    expect(readingWidth(".markdown-body")).toBe(fallback);
    expect(readingWidth(".document-reader-bar")).toBe(fallback);
  });

  it("결정 보드와 비용과 위험 상자의 폭은 그대로 남는다", () => {
    expect(readingWidth(".decision-summary-board .markdown-body")).toBe("none");
    expect(readingWidth(".decision-summary-board")).toBe("860px");
    expect(readingWidth(".decision-summary-risk")).toBe(`${READING_WIDTH_MIN}px`);
    expect(readingWidth(".document-reader.structured .document-reader-bar")).toBe("860px");
  });

  it("개발 화면과 품질 확인 화면의 본문 폭이 이 변수에 닿지 않는다", () => {
    expect(readingWidth(".task-detail-brief .markdown-body")).toBe("640px");
    expect(declarationsFrom(qaCssText, ".qa-flow-section .markdown-body", "QaWorkbench.css").get("max-width"))
      .toBe("640px");
    // 막힌 작업 상자는 최대 폭을 정하지 않아 `.markdown-body`의 되돌림 값을 그대로 받는다. 변수를
    // 싣는 자리가 문서 본문 둘뿐이므로 이 화면의 폭은 변경 전과 같다.
    for (const selector of [".blocked-task-field .markdown-body", ".blocked-task-summary .markdown-body"]) {
      expect(declarationsFrom(blockedTaskCssText, selector, "BlockedTaskPanel.css").has("max-width")).toBe(false);
    }
  });
});
