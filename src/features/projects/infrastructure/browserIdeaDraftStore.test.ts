import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browserIdeaDraftStore } from "./browserIdeaDraftStore";

const STORAGE_KEY = "workflow-labs.idea-draft.v1";
const COLLAPSE_STORAGE_KEY = "workflow-labs.integration-collapse.v1";
const GUIDE_STORAGE_KEY = "workflow-labs.heartbeat-setup-guide-collapse.v1";
const RECENT_STORAGE_KEY = "workflow-labs.recent-projects.v1";
const JOB_VALUE_STORAGE_KEY = "workflow-labs.job-value-memory.v1";

const feature = "feature--wf_1";
const other = "other--wf_2";

/**
 * 테스트 환경의 `localStorage`는 메서드가 없는 빈 객체다. 실제 저장 동작을 보려면 직접 세워야 한다.
 * `browserIntegrationCollapseStore.test.ts`의 방식을 따른다.
 */
function stubStorage() {
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => {
      stored.set(key, value);
    },
  });
  return stored;
}

let storage: Map<string, string>;

beforeEach(() => {
  storage = stubStorage();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("browserIdeaDraftStore", () => {
  it("reads back the draft it stored", () => {
    browserIdeaDraftStore.save(feature, "쓰다 만 아이디어");

    expect(browserIdeaDraftStore.load(feature)).toBe("쓰다 만 아이디어");
  });

  it("starts from an empty draft when nothing was stored", () => {
    expect(browserIdeaDraftStore.load(feature)).toBe("");
  });

  // 손상된 값은 전부 빈 초안으로 돌아간다. 사용자가 할 수 있는 일이 없어 알리지 않는다.
  it.each([
    ["JSON이 아닌 문자열", "{not json"],
    ["배열", '["초안"]'],
    ["null", "null"],
    ["숫자", "42"],
    ["문자열", '"초안"'],
  ])("falls back to an empty draft when the stored value is %s", (_case, stored) => {
    storage.set(STORAGE_KEY, stored);

    expect(() => browserIdeaDraftStore.load(feature)).not.toThrow();
    expect(browserIdeaDraftStore.load(feature)).toBe("");
  });

  it("drops only the entries whose draft is not a string", () => {
    storage.set(
      STORAGE_KEY,
      JSON.stringify({ [feature]: "살아남는 초안", [other]: 42 }),
    );

    expect(browserIdeaDraftStore.load(feature)).toBe("살아남는 초안");
    expect(browserIdeaDraftStore.load(other)).toBe("");
  });

  it("empties the draft it cleared", () => {
    browserIdeaDraftStore.save(feature, "제출하면 사라질 글");
    browserIdeaDraftStore.clear(feature);

    expect(browserIdeaDraftStore.load(feature)).toBe("");
  });

  // 빈 초안을 저장하는 것과 지우는 것이 갈리면, 입력창을 비운 상태가 초안으로 남는다(R2).
  it("treats saving an empty draft as clearing it", () => {
    browserIdeaDraftStore.save(feature, "지우려고 비운 글");
    browserIdeaDraftStore.save(feature, "");

    expect(browserIdeaDraftStore.load(feature)).toBe("");
    expect(JSON.parse(storage.get(STORAGE_KEY) ?? "{}")).toEqual({});
  });

  it("keeps one workflow's draft out of another's", () => {
    browserIdeaDraftStore.save(feature, "A 워크플로의 글");
    browserIdeaDraftStore.save(other, "B 워크플로의 글");

    expect(browserIdeaDraftStore.load(feature)).toBe("A 워크플로의 글");
    expect(browserIdeaDraftStore.load(other)).toBe("B 워크플로의 글");
  });

  it("leaves other workflows alone when one is cleared", () => {
    browserIdeaDraftStore.save(feature, "남아야 하는 글");
    browserIdeaDraftStore.save(other, "지워질 글");
    browserIdeaDraftStore.clear(other);

    expect(browserIdeaDraftStore.load(feature)).toBe("남아야 하는 글");
    expect(browserIdeaDraftStore.load(other)).toBe("");
  });

  it("swallows a storage that throws on every access", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("접근이 차단되었습니다");
      },
      setItem: () => {
        throw new Error("접근이 차단되었습니다");
      },
    });

    expect(() => browserIdeaDraftStore.save(feature, "초안")).not.toThrow();
    expect(() => browserIdeaDraftStore.clear(feature)).not.toThrow();
    expect(browserIdeaDraftStore.load(feature)).toBe("");
  });

  // 이 저장소 자체가 없는 환경(메서드 없는 전역)에서도 읽기·쓰기가 던지지 않는다.
  it("swallows a storage that has no methods at all", () => {
    vi.stubGlobal("localStorage", {});

    expect(() => browserIdeaDraftStore.save(feature, "초안")).not.toThrow();
    expect(() => browserIdeaDraftStore.clear(feature)).not.toThrow();
    expect(browserIdeaDraftStore.load(feature)).toBe("");
  });

  // 저장소 다섯이 한 `localStorage`를 나눠 쓴다. 초안이 남의 키를 건드리면 다른 기억이 지워진다.
  it("never reads or writes another store's key", () => {
    const touched: string[] = [];
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => {
        touched.push(key);
        return null;
      },
      setItem: (key: string) => {
        touched.push(key);
      },
    });

    browserIdeaDraftStore.load(feature);
    browserIdeaDraftStore.save(feature, "초안");
    browserIdeaDraftStore.clear(feature);

    expect(touched).not.toContain(COLLAPSE_STORAGE_KEY);
    expect(touched).not.toContain(GUIDE_STORAGE_KEY);
    expect(touched).not.toContain(RECENT_STORAGE_KEY);
    expect(touched).not.toContain(JOB_VALUE_STORAGE_KEY);
    expect(new Set(touched)).toEqual(new Set([STORAGE_KEY]));
  });
});
