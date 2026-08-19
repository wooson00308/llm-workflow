import { PANEL_REGIONS, type PanelRegion } from "../domain/panelLayout";

/**
 * 영역 하나의 저장 상태.
 *
 * `width`는 사용자가 조절해 정한 px 너비이고, `baselineWidth`는 그 영역을 처음 조작하기 직전에 비율
 * 배치로 그려져 있던 너비다. 둘 다 없는 영역은 한 번도 조작하지 않은 영역이라 항목 자체가 없다.
 */
export type PanelLayoutEntry = {
  width?: number;
  collapsed?: boolean;
  baselineWidth?: number;
};

export type PanelLayoutState = Partial<Record<PanelRegion, PanelLayoutEntry>>;

/**
 * 저장 단위는 이 컴퓨터의 앱 전체다(SPEC-080 R6). 키에 프로젝트 식별자도 워크플로 디렉터리도 넣지
 * 않는다. 패널 너비는 문서의 성질이 아니라 지금 보고 있는 창과 사용자 습관에 딸린 값이므로,
 * 워크플로를 바꿨다고 화면 배치가 달라지면 사용자를 놀라게 한다.
 */
const STORAGE_KEY = "workflow-labs.panel-layout.v1";

const KNOWN_REGIONS = new Set<string>(PANEL_REGIONS);

/** 저장된 너비 값. 숫자가 아니거나 유한하지 않은 값은 버린다. */
function readWidth(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readEntry(value: unknown): PanelLayoutEntry | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const entry: PanelLayoutEntry = {};
  const width = readWidth(source.width);
  if (width !== undefined) entry.width = width;
  if (typeof source.collapsed === "boolean") entry.collapsed = source.collapsed;
  const baselineWidth = readWidth(source.baselineWidth);
  if (baselineWidth !== undefined) entry.baselineWidth = baselineWidth;
  return entry;
}

/**
 * 저장된 패널 배치 상태를 읽는다.
 *
 * 값 없음, JSON 파싱 실패, 객체가 아님, 배열, 숫자가 아닌 너비, 참거짓이 아닌 접힘값,
 * `localStorage` 접근 실패를 전부 빈 상태로 돌리고 던지지 않는다. 표시 상태라 읽지 못해도 알릴
 * 가치가 없고, 저장 실패가 화면 렌더링을 막는 것을 방지한다(SPEC-080 R7).
 */
function load(): PanelLayoutState {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (!value) return {};
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    // 영역 하나의 값이 깨졌다고 나머지 영역의 값까지 버리지 않는다.
    const state: PanelLayoutState = {};
    for (const [region, stored] of Object.entries(parsed)) {
      if (!KNOWN_REGIONS.has(region)) continue;
      const entry = readEntry(stored);
      if (entry) state[region as PanelRegion] = entry;
    }
    return state;
  } catch {
    return {};
  }
}

/**
 * 패널 배치 상태 전체를 저장한다.
 *
 * 저장에 실패해도 삼킨다. 표시 상태라 사용자에게 띄울 가치가 없고, 실패한 순간에도 화면의 리사이즈와
 * 접기 동작은 그대로 동작한다(SPEC-080 R7).
 */
function save(state: PanelLayoutState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    return;
  }
}

/**
 * 접힌 영역을 다시 펼칠 때 쓰는 너비. 조절한 너비가 있으면 그 값이고, 조절한 적이 없으면 기준
 * 너비다. 둘 다 없으면 값이 없고, 그 영역은 비율 배치로 돌아간다.
 */
export function expandedPanelWidth(entry: PanelLayoutEntry | undefined): number | undefined {
  return entry?.width ?? entry?.baselineWidth;
}

export const browserPanelLayoutStore = { load, save };
