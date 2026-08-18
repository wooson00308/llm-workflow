/**
 * 워크플로 디렉터리 → 메뉴 키 → 그 메뉴를 마지막으로 확인한 시각.
 *
 * 키에 프로젝트 식별자를 넣지 않는다. 워크플로 디렉터리는 `<이름 slug>--wf_<식별자>` 형태이고 그
 * 식별자가 uuid에서 나오므로, 서로 다른 워크플로가 같은 문자열을 갖는 경로가 없다
 * (`browserSpecLaneCollapseStore`와 같은 근거다).
 */
type MenuLastSeenState = Record<string, Record<string, string>>;

const STORAGE_KEY = "workflow-labs.menu-last-seen.v1";

/**
 * 확인 시각을 남기는 메뉴의 키. 아이디어 메뉴와 개발 메뉴 둘뿐이다.
 *
 * 저장소가 정의해 내보낸다. 화면 쪽이 같은 문자열을 따로 적으면 둘이 갈렸을 때 확인 기록이 조용히
 * 새 키로 옮겨 간다.
 */
export const IDEAS_MENU_KEY = "ideas";
export const DEVELOPMENT_MENU_KEY = "tasks";
export const MENU_KEYS = [IDEAS_MENU_KEY, DEVELOPMENT_MENU_KEY] as const;
export type MenuKey = (typeof MENU_KEYS)[number];

/** 시각으로 읽을 수 있는 문자열만 기록으로 인정한다. 읽지 못하는 값은 기록이 없는 것과 같다. */
function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

/**
 * 저장된 확인 시각 전체를 읽는다.
 *
 * 값 없음·JSON 파싱 실패·객체가 아님·배열·시각이 아닌 값·`localStorage` 접근 실패를 전부 기록
 * 없음으로 돌리고 던지지 않는다. 표시 상태라 읽지 못해도 알릴 가치가 없고, 사이드 메뉴가 그려지지
 * 않는 쪽이 훨씬 나쁘다.
 */
function readAll(): MenuLastSeenState {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (!value) return {};
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    // 항목 하나가 깨졌다고 나머지 워크플로·메뉴의 기록까지 버리지 않는다.
    const state: MenuLastSeenState = {};
    for (const [directory, menus] of Object.entries(parsed)) {
      if (!menus || typeof menus !== "object" || Array.isArray(menus)) continue;
      const seen: Record<string, string> = {};
      for (const [menu, at] of Object.entries(menus)) {
        if (isTimestamp(at)) seen[menu] = at;
      }
      state[directory] = seen;
    }
    return state;
  } catch {
    return {};
  }
}

/** 워크플로 하나의 메뉴별 확인 시각을 읽는다. 기록이 없는 메뉴는 키 자체가 없다. */
function load(workflowDirectory: string): Record<string, string> {
  return readAll()[workflowDirectory] ?? {};
}

/**
 * 워크플로 하나의 메뉴 하나에 확인 시각을 남긴다. 다른 워크플로와 같은 워크플로의 다른 메뉴 값은
 * 그대로 둔다.
 *
 * 저장에 실패해도 삼킨다. 표시 상태라 사용자에게 띄울 가치가 없고, 실패한 순간에도 메뉴 전환은
 * 그대로 동작한다.
 */
function save(workflowDirectory: string, menuKey: MenuKey, seenAt: string): void {
  try {
    const state = readAll();
    state[workflowDirectory] = { ...state[workflowDirectory], [menuKey]: seenAt };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    return;
  }
}

export const browserMenuLastSeenStore = { load, save };
