/**
 * 네 영역이 함께 쓰는 조작 요소 셋 (SPEC-080 R1~R5, R12, R13).
 *
 * 리사이즈 핸들과 접기 버튼과 접힌 자리의 세로 바다. 셋 다 어느 영역에 붙을지는 부르는 쪽이 값으로
 * 넘기고, 여기에는 영역별 분기가 없다. 너비를 저장하거나 읽지 않으며, 바뀐 값을 부르는 쪽에 알릴 뿐이다.
 *
 * 한계값과 보정은 `domain/panelLayout`이 정한 것을 그대로 쓴다. 영역 식별자를 값으로 받는 이유가 이것이다.
 * 그 표의 최소·최대값을 부르는 쪽이 다시 적어 넘기면 R2의 한계가 두 곳에 갈라져 적히고, 뒤이은 세 자리가
 * 서로 다른 값을 넘길 여지가 생긴다.
 */
import { useEffect, useState, type KeyboardEvent } from "react";
import { PANEL_LIMITS, clampPanelWidth, stepPanelWidth, type PanelRegion } from "../domain/panelLayout";
import "./PanelLayoutControls.css";

interface PanelResizeHandleProps {
  /** 조절할 영역. 이 값으로 한계값과 보정 함수를 고른다. */
  region: PanelRegion;
  /** 영역 이름. 보조 기술이 읽는 이름을 이 값으로 만든다. */
  label: string;
  /** 지금 너비. */
  width: number;
  /**
   * 핸들이 선 경계. 영역의 오른쪽 경계에 서면 오른쪽으로 끌수록 넓어지고, 왼쪽 경계에 서면 반대다.
   *
   * 기획서 완료 판정 A2의 결정 패널은 본문 오른쪽에 있어 핸들이 그 영역의 왼쪽 경계에 선다. 그 자리를
   * 붙이는 TASK-S080-04는 이 파일을 범위로 선언하지 않으므로, 부호를 여기서 받아 둔다.
   */
  grabSide?: "left" | "right";
  onWidthChange(width: number): void;
  onReset(): void;
}

/**
 * 영역과 본문 사이의 경계에 서는 리사이즈 핸들 (SPEC-080 R1, R2, R3, R12).
 *
 * 드래그 중에는 누른 순간의 너비와 x좌표를 기준으로 삼는다. 직전 값에 움직인 만큼을 더해 나가면 한계에서
 * 잘린 값이 다음 계산의 기준이 되어, 한계에 닿았다가 되돌아올 때 포인터와 경계가 어긋난다.
 */
export function PanelResizeHandle({
  region,
  label,
  width,
  grabSide = "right",
  onWidthChange,
  onReset,
}: PanelResizeHandleProps) {
  const { minWidth, maxWidth } = PANEL_LIMITS[region];
  const [drag, setDrag] = useState<{ startX: number; startWidth: number } | null>(null);

  // 창에 붙이는 이유는 포인터가 핸들 밖으로, 나아가 창 밖으로 나간 뒤 떼여도 드래그를 끝내기 위해서다.
  useEffect(() => {
    if (drag === null) return;

    const move = (event: PointerEvent) => {
      const moved = grabSide === "left" ? drag.startX - event.clientX : event.clientX - drag.startX;
      onWidthChange(clampPanelWidth(region, drag.startWidth + moved));
    };
    const end = () => setDrag(null);

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [drag, grabSide, onWidthChange, region]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const grows = (event.key === "ArrowRight") === (grabSide === "right");
    const next = stepPanelWidth(region, width, grows ? "grow" : "shrink");
    // 한계에서 한 걸음 함수가 같은 값을 돌려주면 너비가 움직이지 않는다. 부르는 쪽을 깨우지 않는다.
    if (next !== width) onWidthChange(next);
  }

  return (
    <div
      aria-label={`${label} 너비 조절`}
      aria-orientation="vertical"
      aria-valuemax={maxWidth}
      aria-valuemin={minWidth}
      aria-valuenow={width}
      className="panel-resize-handle"
      onDoubleClick={onReset}
      onKeyDown={handleKeyDown}
      onPointerDown={(event) => setDrag({ startX: event.clientX, startWidth: width })}
      role="separator"
      tabIndex={0}
    />
  );
}

interface PanelCollapseButtonProps {
  /** 영역 이름. 보조 기술이 읽는 이름을 이 값으로 만든다. */
  label: string;
  onCollapse(): void;
}

/** 헤더 오른쪽 끝에 서는 접기 버튼 (SPEC-080 R4). */
export function PanelCollapseButton({ label, onCollapse }: PanelCollapseButtonProps) {
  return (
    <button aria-label={`${label} 접기`} className="panel-collapse-button" onClick={onCollapse} type="button">
      <span aria-hidden="true">‹</span>
    </button>
  );
}

interface PanelCollapsedBarProps {
  /** 영역 이름. 툴팁과 보조 기술이 읽는 이름을 이 값으로 만든다. */
  label: string;
  /**
   * 접힌 자리의 방향. 좁은 창에서 위아래로 쌓이는 자리는 가로 막대로 그린다 (SPEC-080 R13).
   */
  orientation?: "vertical" | "horizontal";
  onExpand(): void;
}

/**
 * 접힌 영역이 남기는 막대 (SPEC-080 R4, R5).
 *
 * 화살표만 그리고 영역 이름은 글자로 쓰지 않는다. 세로로 눕힌 한글을 읽게 만들지 않으려는 것이므로,
 * 이름은 툴팁과 보조 기술이 읽는 이름에만 담는다. 화살표는 방향과 무관하게 같은 것을 쓴다.
 */
export function PanelCollapsedBar({ label, orientation = "vertical", onExpand }: PanelCollapsedBarProps) {
  const name = `${label} 펼치기`;
  return (
    <button
      aria-label={name}
      className={orientation === "horizontal" ? "panel-collapsed-bar panel-collapsed-bar-horizontal" : "panel-collapsed-bar"}
      onClick={onExpand}
      title={name}
      type="button"
    >
      <span aria-hidden="true">›</span>
    </button>
  );
}
