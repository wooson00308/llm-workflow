/**
 * 잡 하나에서 기억해 두는 편집 가능 값. 없는 필드는 그 값을 기억하지 못한 것이다.
 *
 * `maxPer`만 `null`을 받는다. **키가 없으면 "기억하지 못함", `null`은 "제한 없음"이다.** 한도 줄이
 * 없는 잡을 껐다 켤 때 앱 기본값으로 시작하지 않으려면 그 두 상태가 갈려야 한다(SPEC-017 R3).
 * 나머지 세 필드의 "줄 없음"은 이 기획서의 대상이 아니라 그대로 문자열이다.
 */
export type RememberedJobValues = Partial<
  Record<"interval" | "model" | "timeout", string> & { maxPer: string | null }
>;

const STORAGE_KEY = "workflow-labs.job-value-memory.v1";

/**
 * 저장된 기억 전체를 읽는다.
 *
 * 값 없음·JSON 파싱 실패·객체가 아님·`localStorage` 접근 실패를 전부 빈 맵으로 돌린다. 화면 편의
 * 기억이라 읽지 못해도 알릴 가치가 없고, 그때는 기본값 시딩이라는 기존 동작이 그대로 남는다.
 */
function load(): Record<string, RememberedJobValues> {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (!value) return {};
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const remembered: Record<string, RememberedJobValues> = {};
    for (const [name, values] of Object.entries(parsed)) {
      if (!values || typeof values !== "object" || Array.isArray(values)) continue;
      const entry: RememberedJobValues = {};
      for (const field of ["interval", "model", "timeout"] as const) {
        const candidate = (values as Record<string, unknown>)[field];
        if (typeof candidate === "string") entry[field] = candidate;
      }
      // `maxPer`만 `null`을 값으로 받는다. 다른 필드의 `null`은 지금처럼 버린다. 저장 형태가 넓어질
      // 뿐이라 기존 저장분(문자열)은 그대로 읽힌다.
      const quota = (values as Record<string, unknown>).maxPer;
      if (typeof quota === "string" || quota === null) entry.maxPer = quota;
      remembered[name] = entry;
    }
    return remembered;
  } catch {
    return {};
  }
}

/**
 * 잡 하나의 값을 기억한다. 값이 없는 필드는 이전 기억을 지우지 않고 그대로 둔다.
 *
 * 관리 블록에서 빠지는(꺼지는) 잡의 마지막 파일 값을 담아 두는 용도다. 저장에 실패해도 끄기
 * 자체는 동작해야 하므로 실패를 삼킨다.
 */
function remember(jobName: string, values: RememberedJobValues): void {
  try {
    const remembered = load();
    remembered[jobName] = { ...remembered[jobName], ...values };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(remembered));
  } catch {
    return;
  }
}

/** 잡 하나의 기억을 꺼낸다. 없으면 `null`이다. */
function recall(jobName: string): RememberedJobValues | null {
  const values = load()[jobName];
  if (!values || Object.keys(values).length === 0) return null;
  return values;
}

export const browserJobValueMemoryStore = { remember, recall };
