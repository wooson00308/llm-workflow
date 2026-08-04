/**
 * 워크플로 디렉터리를 키로 하는 아이디어 초안. 값이 없는 워크플로는 빈 초안이다.
 *
 * 키에 입력창 자리를 넣지 않는다. 빠른 입력과 인박스 입력창이 같은 초안을 보고, 둘이 동시에 보이는
 * 일이 없어 합쳐도 화면이 모순되지 않는다(SPEC-025 확인 필요 1번).
 *
 * 키에 프로젝트 식별자를 넣지 않는다. 워크플로 디렉터리는 `<이름 slug>--wf_<식별자>` 형태이고 그
 * 식별자가 uuid에서 나오므로, 서로 다른 워크플로가 같은 문자열을 갖는 경로가 없다. 프로젝트를 바꿔도
 * 같은 워크플로의 초안이 이어진다는 R3이 이것으로 성립한다.
 */
type IdeaDraftState = Record<string, string>;

const STORAGE_KEY = "workflow-labs.idea-draft.v1";

/** 저장된 값이 없거나 읽을 수 없을 때의 초안. */
const EMPTY_DRAFT = "";

/**
 * 저장된 초안 전체를 읽는다.
 *
 * 값 없음·JSON 파싱 실패·객체가 아님·배열·`localStorage` 접근 실패를 전부 빈 맵으로 돌리고 던지지
 * 않는다. 읽지 못한 순간에도 화면에 떠 있는 글은 그대로이고 제출도 되므로, 사용자가 할 수 있는 일이
 * 없는 오류를 띄우지 않는다. 이 자산은 앞선 저장소들과 달리 사용자가 직접 쓴 글이고 잃으면 되돌릴
 * 방법이 없다 — 그 한계를 인지한 채로 "알리지 않는다"가 승인됐다(확인 필요 3번).
 */
function readDrafts(): IdeaDraftState {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (!value) return {};
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    // 항목 하나가 깨졌다고 나머지 워크플로의 초안까지 버리지 않는다.
    const drafts: IdeaDraftState = {};
    for (const [directory, draft] of Object.entries(parsed)) {
      if (typeof draft === "string") drafts[directory] = draft;
    }
    return drafts;
  } catch {
    return {};
  }
}

/** 워크플로 하나의 초안을 읽는다. 저장된 것이 없으면 빈 초안이다. */
function load(workflowDirectory: string): string {
  return readDrafts()[workflowDirectory] ?? EMPTY_DRAFT;
}

/**
 * 워크플로 하나의 초안을 저장한다. 다른 워크플로의 초안은 그대로 둔다.
 *
 * 빈 초안은 항목을 지우는 것으로 다룬다. 빈 문자열이 맵에 쌓이지 않고, "빈 초안을 저장하는 것"과
 * "초안을 지우는 것"이 갈릴 수 없게 된다.
 *
 * 글자를 칠 때마다 불리는 자리다. 저장에 실패해도 삼킨다 — 입력 중에 오류 표시가 반복해서 뜨는 쪽이
 * 저장이 안 되는 것보다 나쁘고, 실패한 순간에도 쓰던 글과 제출은 멀쩡하다.
 */
function save(workflowDirectory: string, draft: string): void {
  try {
    const drafts = readDrafts();
    if (draft === EMPTY_DRAFT) delete drafts[workflowDirectory];
    else drafts[workflowDirectory] = draft;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
  } catch {
    return;
  }
}

/**
 * 워크플로 하나의 초안을 지운다. 제출이 성공했을 때와 사용자가 입력창을 비웠을 때 쓴다(R2).
 *
 * 빈 초안 저장에 맡겨 둘이 같은 경로를 타게 한다.
 */
function clear(workflowDirectory: string): void {
  save(workflowDirectory, EMPTY_DRAFT);
}

export const browserIdeaDraftStore = { load, save, clear };
