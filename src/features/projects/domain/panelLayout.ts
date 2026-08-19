/**
 * 사이드바와 문서 화면 패널 셋의 너비 규칙. 화면 코드도 브라우저 API도 부르지 않는 순수 계산이다.
 *
 * 리사이즈 핸들과 접기 버튼을 그리는 자리는 TASK-S080-02가, 이 규칙을 화면에 붙이는 자리는
 * TASK-S080-03과 TASK-S080-04가 맡는다. 이 파일은 값과 계산까지만 정한다.
 */

/** 리사이즈와 접기를 적용하는 네 영역 (SPEC-080 R1). */
export type PanelRegion = "sidebar" | "specList" | "specDecision" | "ideaList";

/** 영역 식별자를 늘어놓는 순서. 저장소와 시험이 이 순서를 따른다. */
export const PANEL_REGIONS: readonly PanelRegion[] = [
  "sidebar",
  "specList",
  "specDecision",
  "ideaList",
];

/**
 * 영역별 한계값.
 *
 * 최소값은 지금 배치가 이미 쓰고 있는 하한을 그대로 옮겨 적었다. 사이드바 250px은 `src/App.css`의
 * `.app-shell`에, 좁은 창의 210px은 같은 파일 980px 이하 규칙에, 기획서 화면 두 패널의 190px과
 * 아이디어 화면 목록 패널의 300px은 `.spec-workspace-layout`과 `.idea-inbox-layout`에 있다.
 *
 * 사이드바 밖의 세 패널에는 기본 px 너비가 없다. 그 셋의 기본은 스타일 파일의 비율 배치이며, 여기서
 * 값을 새로 만들면 SPEC-080 R11이 요구한 "지금과 같은 배치"가 깨진다.
 */
export type PanelLimits = {
  minWidth: number;
  maxWidth: number;
  /** 사이드바에만 있는 기본 px 너비. 나머지 셋은 비율 배치가 기본이라 값이 없다. */
  defaultWidth?: number;
  /** 창 폭이 좁을 때의 기본 px 너비. 사이드바에만 있다. */
  narrowDefaultWidth?: number;
};

export const PANEL_LIMITS: Record<PanelRegion, PanelLimits> = {
  sidebar: { minWidth: 190, maxWidth: 380, defaultWidth: 250, narrowDefaultWidth: 210 },
  specList: { minWidth: 190, maxWidth: 420 },
  specDecision: { minWidth: 190, maxWidth: 420 },
  ideaList: { minWidth: 300, maxWidth: 520 },
};

/** 접힌 영역이 남기는 세로 바의 폭 (SPEC-080 R4). */
export const COLLAPSED_PANEL_WIDTH = 28;

/** 어떤 조절에서도 가운데 본문이 이보다 좁아지지 않는다 (SPEC-080 R9). */
export const MAIN_CONTENT_MIN_WIDTH = 340;

/** 방향키 한 걸음이 움직이는 폭 (SPEC-080 R12). */
export const PANEL_KEYBOARD_STEP = 16;

/** 읽기 폭 상한의 시작값과 최대값 (SPEC-080 R8). 둘 다 `src/App.css`가 이미 쓰고 있는 값이다. */
export const READING_WIDTH_MIN = 620;
export const READING_WIDTH_MAX = 860;

/** 이 폭 이하에서 배치가 한 열로 바뀐다 (SPEC-080 R13). 사이드바 기본 너비가 여기서 갈린다. */
export const NARROW_WINDOW_WIDTH = 980;

/** 드래그로 들어온 너비를 그 영역의 한계 안으로 자른다 (SPEC-080 R2). */
export function clampPanelWidth(region: PanelRegion, width: number): number {
  const { minWidth, maxWidth } = PANEL_LIMITS[region];
  if (width < minWidth) return minWidth;
  if (width > maxWidth) return maxWidth;
  return width;
}

/**
 * 방향키 한 걸음. 지금 너비에서 16px 늘리거나 줄인 값을 한계 안으로 잘라 돌려준다.
 *
 * 최소값에서 더 줄이거나 최대값에서 더 늘리면 자르기가 같은 값을 돌려주므로 너비가 움직이지 않는다.
 */
export function stepPanelWidth(
  region: PanelRegion,
  width: number,
  direction: "grow" | "shrink",
): number {
  const moved = direction === "grow" ? width + PANEL_KEYBOARD_STEP : width - PANEL_KEYBOARD_STEP;
  return clampPanelWidth(region, moved);
}

/** 사이드바의 기본 너비. 창 폭이 980px 이하이면 210px, 그보다 넓으면 250px이다. */
export function defaultPanelWidth(region: PanelRegion, windowWidth: number): number | undefined {
  const { defaultWidth, narrowDefaultWidth } = PANEL_LIMITS[region];
  if (defaultWidth === undefined) return undefined;
  if (narrowDefaultWidth !== undefined && windowWidth <= NARROW_WINDOW_WIDTH) {
    return narrowDefaultWidth;
  }
  return defaultWidth;
}

export type RenderedPanelWidthInput = {
  windowWidth: number;
  /**
   * 영역별로 조절해 저장해 둔 너비. 저장 단위는 앱 전체지만, 이 계산에는 지금 화면에 나란히 서는
   * 영역만 넣는다. 다른 화면의 패널까지 넣으면 본문 폭 계산이 그리지도 않는 자리를 빼게 된다.
   */
  storedWidths: Partial<Record<PanelRegion, number>>;
  collapsed: readonly PanelRegion[];
};

/**
 * 화면에 그릴 px 너비를 영역별로 돌려준다 (SPEC-080 R9, R10, R11).
 *
 * 저장된 너비도 없고 접히지도 않은 영역은 결과에 담기지 않는다. 그 영역은 스타일 파일의 비율 배치로
 * 그려져야 하며, 여기서 값을 만들어 내면 한 번도 조절하지 않은 화면이 지금과 달라진다.
 *
 * 창이 좁아 저장된 너비를 그대로 그리면 본문이 340px보다 좁아질 때는, 저장된 값은 그대로 두고
 * 돌려주는 너비만 각 영역의 최소값까지 줄인다. 창을 다시 넓히면 같은 저장된 값에서 원래 너비가 다시
 * 나온다. 이 함수는 받은 값을 고치지 않는다.
 */
export function resolveRenderedPanelWidths(
  input: RenderedPanelWidthInput,
): Partial<Record<PanelRegion, number>> {
  const collapsed = new Set(input.collapsed);
  const rendered: Partial<Record<PanelRegion, number>> = {};
  /** 줄일 수 있는 영역과 그 여유. 접힌 영역은 이미 28px이라 더 줄이지 않는다. */
  const shrinkable: { region: PanelRegion; width: number; room: number }[] = [];
  let occupied = 0;

  for (const region of PANEL_REGIONS) {
    if (collapsed.has(region)) {
      rendered[region] = COLLAPSED_PANEL_WIDTH;
      occupied += COLLAPSED_PANEL_WIDTH;
      continue;
    }
    const stored = input.storedWidths[region];
    if (stored === undefined) continue;
    // 저장소는 값의 자료형만 보고 범위는 보지 않는다. 한계 밖의 값이 들어오면 여유가 음수가 되므로
    // 여기서 한 번 자른다.
    const width = clampPanelWidth(region, stored);
    rendered[region] = width;
    occupied += width;
    shrinkable.push({ region, width, room: width - PANEL_LIMITS[region].minWidth });
  }

  const deficit = MAIN_CONTENT_MIN_WIDTH - (input.windowWidth - occupied);
  if (deficit <= 0) return rendered;

  const totalRoom = shrinkable.reduce((sum, entry) => sum + entry.room, 0);
  if (totalRoom <= 0) return rendered;

  if (deficit >= totalRoom) {
    // 최소값까지 줄여도 340px을 지킬 수 없다. 각 영역의 최소값을 돌려준다.
    for (const entry of shrinkable) rendered[entry.region] = PANEL_LIMITS[entry.region].minWidth;
    return rendered;
  }

  // 여유에 비례해 줄인다. 내림이라 합계가 모자라는 쪽으로 떨어지지 않고, 여유가 정수이므로 결과는
  // 언제나 최소값 이상이다.
  for (const entry of shrinkable) {
    rendered[entry.region] = Math.floor(entry.width - (deficit * entry.room) / totalRoom);
  }
  return rendered;
}

export type PanelReclaimInput = {
  /** 사용자가 그 영역을 처음 조작하기 직전에 비율 배치로 그려져 있던 너비. 모르면 비운다. */
  baselineWidth?: number;
  /** 지금 그리는 px 너비. 아직 조절하지 않아 비율 배치로 그려지고 있으면 비운다. */
  renderedWidth?: number;
  collapsed: boolean;
};

/**
 * 본문이 되찾은 폭 (SPEC-080 R8). 한 화면에 속한 영역들의 기준 너비에서 지금 그리는 너비를 뺀 값을
 * 더한다.
 *
 * 접힌 영역의 그리는 너비는 28px이다. 기준 너비를 아직 모르는 영역은 0을 보탠다. 그 영역이 얼마나
 * 좁아졌는지 잴 기준이 없고, 재지 못한 값을 0이 아닌 무엇으로 추정하면 본문 폭이 근거 없이 넓어진다.
 */
export function measureReclaimedWidth(regions: readonly PanelReclaimInput[]): number {
  return regions.reduce((sum, region) => {
    if (region.baselineWidth === undefined) return sum;
    const rendered = region.collapsed
      ? COLLAPSED_PANEL_WIDTH
      : (region.renderedWidth ?? region.baselineWidth);
    return sum + (region.baselineWidth - rendered);
  }, 0);
}

/**
 * 문서 본문의 읽기 폭 상한 (SPEC-080 R8). 620px에서 시작해 되찾은 만큼 오르고 860px에서 멈춘다.
 *
 * 되찾은 폭이 0 이하이면 620px이다. 패널을 넓힌 사용자의 본문을 지금보다 좁게 만들지 않는다.
 */
export function resolveReadingWidth(reclaimedWidth: number): number {
  if (reclaimedWidth <= 0) return READING_WIDTH_MIN;
  return Math.min(READING_WIDTH_MIN + reclaimedWidth, READING_WIDTH_MAX);
}
