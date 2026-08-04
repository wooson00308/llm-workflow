/**
 * 하트비트 설치 가이드의 펼침 여부. 앱 전체에 하나이고 프로젝트마다 갈리지 않는다.
 *
 * 카드 접힘(`browserIntegrationCollapseStore`)과 키를 나눈다. 그쪽은 연동 id를 키로 하는 맵이라
 * 가이드 상태를 같은 자리에 넣으면 언젠가 생길 연동 id와 이름이 부딪힌다. 축을 나누면 가이드를
 * 접어도 카드 접힘 기억이 바뀌지 않는 성질이 저절로 성립한다.
 */
const STORAGE_KEY = "workflow-labs.heartbeat-setup-guide-collapse.v1";

/** 저장된 값이 없거나 쓸 수 없을 때의 펼침 여부. */
const DEFAULT_OPEN = true;

/**
 * 저장된 펼침 여부를 읽는다.
 *
 * 값 없음·JSON 파싱 실패·`boolean`이 아님·`localStorage` 접근 실패를 전부 펼침으로 돌린다. 표시
 * 상태라 읽지 못해도 알릴 가치가 없고, 가이드가 접힌 채로 뜨는 쪽이 훨씬 나쁘다. 던지지 않는다.
 */
function load(): boolean {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (!value) return DEFAULT_OPEN;
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "boolean") return DEFAULT_OPEN;
    return parsed;
  } catch {
    return DEFAULT_OPEN;
  }
}

/**
 * 펼침 여부를 저장한다.
 *
 * 저장에 실패해도 화면의 토글은 그대로 동작해야 하므로 실패를 삼킨다.
 */
function save(open: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(open));
  } catch {
    return;
  }
}

export const browserSetupGuideCollapseStore = { load, save };
