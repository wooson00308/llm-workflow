import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browserSetupGuideCollapseStore } from "./browserSetupGuideCollapseStore";

const STORAGE_KEY = "workflow-labs.heartbeat-setup-guide-collapse.v1";
const CARD_STORAGE_KEY = "workflow-labs.integration-collapse.v1";

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

describe("browserSetupGuideCollapseStore", () => {
  it.each([true, false])("reads back what it stored: %s", (open) => {
    browserSetupGuideCollapseStore.save(open);

    expect(browserSetupGuideCollapseStore.load()).toBe(open);
  });

  it("starts expanded when nothing was stored", () => {
    expect(browserSetupGuideCollapseStore.load()).toBe(true);
  });

  // 손상된 값은 전부 펼침으로 돌아간다. 표시 상태라 사용자에게 알릴 것이 없다.
  it.each([
    ["JSON이 아닌 문자열", "{not json"],
    ["문자열", '"true"'],
    ["숫자", "0"],
    ["객체", '{"open":true}'],
    ["배열", "[true]"],
    ["null", "null"],
  ])("falls back to expanded when the stored value is %s", (_case, stored) => {
    storage.set(STORAGE_KEY, stored);

    expect(() => browserSetupGuideCollapseStore.load()).not.toThrow();
    expect(browserSetupGuideCollapseStore.load()).toBe(true);
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

    expect(() => browserSetupGuideCollapseStore.save(false)).not.toThrow();
    expect(browserSetupGuideCollapseStore.load()).toBe(true);
  });

  // 이 저장소 자체가 없는 환경(메서드 없는 전역)에서도 읽기·쓰기가 던지지 않는다.
  it("swallows a storage that has no methods at all", () => {
    vi.stubGlobal("localStorage", {});

    expect(() => browserSetupGuideCollapseStore.save(false)).not.toThrow();
    expect(browserSetupGuideCollapseStore.load()).toBe(true);
  });

  // 축을 나눈 이유가 이 테스트다. 가이드 접힘이 카드 접힘 기억을 건드리면 안 된다.
  it("never reads or writes the integration collapse key", () => {
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

    browserSetupGuideCollapseStore.load();
    browserSetupGuideCollapseStore.save(false);

    expect(touched).not.toContain(CARD_STORAGE_KEY);
    expect(touched).toEqual([STORAGE_KEY, STORAGE_KEY]);
  });
});
