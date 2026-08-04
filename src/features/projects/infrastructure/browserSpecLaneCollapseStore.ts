/**
 * 워크플로 디렉터리 → 레인 키 → 접혔는지. 값이 없는 레인은 펼침이다.
 *
 * 키에 프로젝트 식별자를 넣지 않는다. 워크플로 디렉터리는 `<이름 slug>--wf_<식별자>` 형태이고 그
 * 식별자가 uuid에서 나오므로, 서로 다른 워크플로가 같은 문자열을 갖는 경로가 없다
 * (`browserIdeaDraftStore`와 같은 근거다).
 */
type SpecLaneCollapseState = Record<string, Record<string, boolean>>;

const STORAGE_KEY = "workflow-labs.spec-lane-collapse.v1";

/**
 * 미분류 레인의 키. 기획서 레인의 키는 기획서 문서 id이고, 문서 id에 `#`이 들어가는 경로가 없어
 * 부딪히지 않는다.
 *
 * 저장소가 정의해 내보낸다. 화면 쪽이 같은 문자열을 따로 적으면 둘이 갈렸을 때 접힘 상태가 조용히
 * 새 키로 옮겨 간다.
 */
export const UNASSIGNED_LANE_KEY = "#unassigned";

/**
 * 저장된 접힘 상태 전체를 읽는다.
 *
 * 값 없음·JSON 파싱 실패·객체가 아님·배열·`localStorage` 접근 실패를 전부 빈 맵으로 돌리고 던지지
 * 않는다. 표시 상태라 읽지 못해도 알릴 가치가 없고, 화면이 뜨지 않는 쪽이 훨씬 나쁘다.
 */
function readAll(): SpecLaneCollapseState {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (!value) return {};
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    // 항목 하나가 깨졌다고 나머지 워크플로·레인의 상태까지 버리지 않는다.
    const state: SpecLaneCollapseState = {};
    for (const [directory, lanes] of Object.entries(parsed)) {
      if (!lanes || typeof lanes !== "object" || Array.isArray(lanes)) continue;
      const collapsed: Record<string, boolean> = {};
      for (const [lane, flag] of Object.entries(lanes)) {
        if (typeof flag === "boolean") collapsed[lane] = flag;
      }
      state[directory] = collapsed;
    }
    return state;
  } catch {
    return {};
  }
}

/**
 * 워크플로 하나의 접힘 맵을 읽는다. 저장된 것이 없는 레인은 펼침이다.
 *
 * 지금 없는 기획서를 가리키는 키도 그대로 돌려준다. 카드가 없어 목록에서 빠졌던 레인이 돌아왔을 때
 * 접힘 상태가 남아 있어야 한다(SPEC-029 확인 필요 3번의 비용 항목).
 */
function load(workflowDirectory: string): Record<string, boolean> {
  return readAll()[workflowDirectory] ?? {};
}

/**
 * 워크플로 하나의 접힘 맵을 저장한다. 다른 워크플로의 값은 그대로 둔다.
 *
 * 저장에 실패해도 삼킨다. 표시 상태라 사용자에게 띄울 가치가 없고, 실패한 순간에도 화면의 접기
 * 동작은 그대로 동작한다.
 */
function save(workflowDirectory: string, collapsed: Record<string, boolean>): void {
  try {
    const state = readAll();
    state[workflowDirectory] = collapsed;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    return;
  }
}

export const browserSpecLaneCollapseStore = { load, save };
