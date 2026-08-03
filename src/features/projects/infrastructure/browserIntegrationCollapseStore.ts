/** 연동 id를 키로 하는 펼침 여부. 값이 없는 id는 접힘이다. */
export type IntegrationCollapseState = Record<string, boolean>;

const STORAGE_KEY = "workflow-labs.integration-collapse.v1";

/**
 * 저장된 펼침 상태를 읽는다.
 *
 * 값 없음·JSON 파싱 실패·객체가 아님·`localStorage` 접근 실패를 전부 빈 맵으로 돌린다. 표시 상태라
 * 읽지 못해도 알릴 가치가 없고, 화면이 뜨지 않는 쪽이 훨씬 나쁘다. 던지지 않는다.
 */
function load(): IntegrationCollapseState {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (!value) return {};
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    // 항목 하나가 깨졌다고 나머지 선택까지 버리지 않는다.
    const expanded: IntegrationCollapseState = {};
    for (const [id, flag] of Object.entries(parsed)) {
      if (typeof flag === "boolean") expanded[id] = flag;
    }
    return expanded;
  } catch {
    return {};
  }
}

/**
 * 펼침 상태를 통째로 저장한다.
 *
 * 지금 없는 연동 id가 섞여 있어도 그대로 둔다. 연동이 잠시 빠졌다가 돌아오는 경우에 사용자의 선택을
 * 지우게 된다. 저장에 실패해도 화면의 펼침 동작은 그대로 동작해야 하므로 실패를 삼킨다.
 */
function save(expanded: IntegrationCollapseState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(expanded));
  } catch {
    return;
  }
}

export const browserIntegrationCollapseStore = { load, save };
