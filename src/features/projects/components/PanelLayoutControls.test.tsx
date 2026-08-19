import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { declarationsFrom } from "../../../test/cssRules";
import {
  COLLAPSED_PANEL_WIDTH,
  NARROW_WINDOW_WIDTH,
  PANEL_KEYBOARD_STEP,
  PANEL_LIMITS,
} from "../domain/panelLayout";
import cssText from "./PanelLayoutControls.css?raw";
import { PanelCollapseButton, PanelCollapsedBar, PanelResizeHandle } from "./PanelLayoutControls";

afterEach(cleanup);

const limits = PANEL_LIMITS.specList;

function renderHandle(props: { width?: number; grabSide?: "left" | "right" } = {}) {
  const onWidthChange = vi.fn();
  const onReset = vi.fn();
  render(
    <PanelResizeHandle
      grabSide={props.grabSide}
      label="문서 목록"
      onReset={onReset}
      onWidthChange={onWidthChange}
      region="specList"
      width={props.width ?? 300}
    />,
  );
  return { handle: screen.getByRole("separator", { name: "문서 목록 너비 조절" }), onWidthChange, onReset };
}

/** 마지막으로 알린 너비. 드래그는 움직임마다 알리므로 그 마지막 값이 결과다. */
function lastWidth(onWidthChange: ReturnType<typeof vi.fn>) {
  const calls = onWidthChange.mock.calls;
  return calls[calls.length - 1]?.[0];
}

describe("리사이즈 핸들 드래그", () => {
  it("누른 채 움직인 만큼 더한 너비를 알린다", () => {
    const { handle, onWidthChange } = renderHandle();

    fireEvent.pointerDown(handle, { clientX: 500 });
    fireEvent.pointerMove(window, { clientX: 540 });

    expect(lastWidth(onWidthChange)).toBe(340);
  });

  it("왼쪽 경계에 선 핸들은 반대 방향으로 넓어진다", () => {
    const { handle, onWidthChange } = renderHandle({ grabSide: "left" });

    fireEvent.pointerDown(handle, { clientX: 500 });
    fireEvent.pointerMove(window, { clientX: 460 });

    expect(lastWidth(onWidthChange)).toBe(340);
  });

  it("최소값 아래와 최대값 위로 끌어도 한계값에서 멈춘다", () => {
    const { handle, onWidthChange } = renderHandle();

    fireEvent.pointerDown(handle, { clientX: 500 });
    fireEvent.pointerMove(window, { clientX: 100 });
    expect(lastWidth(onWidthChange)).toBe(limits.minWidth);

    fireEvent.pointerMove(window, { clientX: 1500 });
    expect(lastWidth(onWidthChange)).toBe(limits.maxWidth);
  });

  it("포인터가 핸들 밖으로 나갔다가 떼여도 드래그 상태가 남지 않는다", () => {
    const { handle, onWidthChange } = renderHandle();

    fireEvent.pointerDown(handle, { clientX: 500 });
    fireEvent.pointerMove(window, { clientX: -400 });
    fireEvent.pointerUp(window);
    onWidthChange.mockClear();

    fireEvent.pointerMove(window, { clientX: 560 });

    expect(onWidthChange).not.toHaveBeenCalled();
  });
});

describe("리사이즈 핸들 되돌리기와 방향키", () => {
  it("더블클릭하면 되돌리기 함수를 부른다", () => {
    const { handle, onReset, onWidthChange } = renderHandle();

    fireEvent.doubleClick(handle);

    expect(onReset).toHaveBeenCalledTimes(1);
    expect(onWidthChange).not.toHaveBeenCalled();
  });

  it("방향키 한 번에 한 걸음씩 늘리고 줄인다", () => {
    const { handle, onWidthChange } = renderHandle();

    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(onWidthChange).toHaveBeenLastCalledWith(300 + PANEL_KEYBOARD_STEP);

    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(onWidthChange).toHaveBeenLastCalledWith(300 - PANEL_KEYBOARD_STEP);
  });

  it("최소값에서 왼쪽, 최대값에서 오른쪽을 눌러도 너비가 움직이지 않는다", () => {
    const atMin = renderHandle({ width: limits.minWidth });
    fireEvent.keyDown(atMin.handle, { key: "ArrowLeft" });
    expect(atMin.onWidthChange).not.toHaveBeenCalled();

    cleanup();

    const atMax = renderHandle({ width: limits.maxWidth });
    fireEvent.keyDown(atMax.handle, { key: "ArrowRight" });
    expect(atMax.onWidthChange).not.toHaveBeenCalled();
  });
});

describe("리사이즈 핸들 접근성", () => {
  it("세로 분할 막대로서 지금 값과 한계값과 영역 이름을 내보낸다", () => {
    const { handle } = renderHandle();

    expect(handle).toHaveAttribute("aria-orientation", "vertical");
    expect(handle).toHaveAttribute("aria-valuenow", "300");
    expect(handle).toHaveAttribute("aria-valuemin", String(limits.minWidth));
    expect(handle).toHaveAttribute("aria-valuemax", String(limits.maxWidth));
    expect(handle).toHaveAccessibleName("문서 목록 너비 조절");
  });

  it("키보드 포커스를 받는다", () => {
    const { handle } = renderHandle();

    handle.focus();

    expect(handle).toHaveFocus();
  });
});

describe("접기 버튼", () => {
  it("어느 영역을 접는지 이름으로 알리고 누르면 접기 함수를 부른다", () => {
    const onCollapse = vi.fn();
    render(<PanelCollapseButton label="결정" onCollapse={onCollapse} />);

    fireEvent.click(screen.getByRole("button", { name: "결정 접기" }));

    expect(onCollapse).toHaveBeenCalledTimes(1);
  });
});

describe("접힌 막대", () => {
  it("영역 이름을 글자로 쓰지 않고 툴팁과 보조 기술이 읽는 이름으로만 알린다", () => {
    render(<PanelCollapsedBar label="아이디어 목록" onExpand={vi.fn()} />);

    const bar = screen.getByRole("button", { name: "아이디어 목록 펼치기" });

    expect(bar).toHaveAttribute("title", "아이디어 목록 펼치기");
    expect(bar.textContent).not.toContain("아이디어 목록");
    expect(bar.textContent).toBe("›");
  });

  it("누르면 펼치기 함수를 부른다", () => {
    const onExpand = vi.fn();
    render(<PanelCollapsedBar label="아이디어 목록" onExpand={onExpand} />);

    fireEvent.click(screen.getByRole("button", { name: "아이디어 목록 펼치기" }));

    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  it("가로 방향에서도 같은 이름과 같은 화살표를 유지한다", () => {
    render(<PanelCollapsedBar label="결정" onExpand={vi.fn()} orientation="horizontal" />);

    const bar = screen.getByRole("button", { name: "결정 펼치기" });

    expect(bar).toHaveAttribute("title", "결정 펼치기");
    expect(bar.textContent).toBe("›");
    expect(bar.className.split(" ")).toContain("panel-collapsed-bar-horizontal");
  });
});

/** 미디어 질의 본문. 같은 선택자가 기본 규칙과 여기에 함께 있으므로 판독기에 따로 넘긴다. */
const narrowMedia = new RegExp(`@media \\(max-width: ${NARROW_WINDOW_WIDTH}px\\)\\s*\\{([\\s\\S]*?)\\n\\}`);

describe("조작 요소 스타일", () => {
  it("핸들에 좌우 리사이즈 커서를 지정한다", () => {
    const base = cssText.replace(narrowMedia, "");

    expect(declarationsFrom(base, ".panel-resize-handle").get("cursor")).toBe("col-resize");
  });

  it("좁은 창에서는 핸들만 숨기고 접기 버튼과 접힌 막대는 남긴다", () => {
    const media = narrowMedia.exec(cssText)?.[1] ?? "";

    expect(declarationsFrom(media, ".panel-resize-handle").get("display")).toBe("none");
    expect(media).not.toContain("panel-collapse-button");
    expect(media).not.toContain("panel-collapsed-bar");
  });

  it("접힌 막대의 두께가 도메인 표의 폭과 같고 가로 방향에서는 높이로 옮겨진다", () => {
    const base = cssText.replace(narrowMedia, "");

    expect(declarationsFrom(base, ".panel-collapsed-bar").get("width")).toBe(`${COLLAPSED_PANEL_WIDTH}px`);
    expect(declarationsFrom(base, ".panel-collapsed-bar-horizontal").get("height")).toBe(`${COLLAPSED_PANEL_WIDTH}px`);
  });

  it("접기 버튼이 헤더 오른쪽 끝에 선다", () => {
    const base = cssText.replace(narrowMedia, "");

    expect(declarationsFrom(base, ".panel-collapse-button").get("margin-left")).toBe("auto");
  });
});
