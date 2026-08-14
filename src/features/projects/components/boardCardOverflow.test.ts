/**
 * 개발 보드 카드가 자기 컬럼을 넘지 않게 하는 CSS 선언의 회귀 검사 (SPEC-021 R5).
 *
 * 이 검사가 보장하는 것: `src/App.css`의 지정한 규칙 안에 지정한 선언이 들어 있다는 것까지다.
 * 이 검사가 보장하지 못하는 것: "그래서 카드가 컬럼을 넘지 않는다". 레이아웃을 전혀 재지 않는다.
 *
 * 재는 검증을 두지 않은 이유는 지금 스택에서 그것이 성립하지 않기 때문이다. 테스트 환경이 jsdom이라
 * 레이아웃을 계산하지 않고(상자 크기를 물으면 전부 0이 돌아온다), 컴포넌트 테스트 트리에는 스타일시트가
 * 실리지도 않는다. 대신 이 결함의 실제 재발 경로 — 그 선언이 지워지거나 규칙이 다시 쓰이는 것 — 을
 * 정확히 겨눈다. 카드가 실제로 넘치는지는 사용자 QA의 눈 확인이 판정한다.
 *
 * 검사는 파일 전체에서 문자열을 찾지 않는다. 규칙 하나를 선택자로 집어 그 본문 안에서만 확인한다.
 * 다른 규칙에 같은 선언이 있어도 통과하지 않게 하기 위해서다. 같은 선택자의 규칙이 둘 이상이면
 * 실패시킨다. 규칙이 다시 쓰이거나 뒤에서 덮이는 것도 이 결함의 재발 경로이기 때문이다.
 *
 * 카드에는 기술 요약문을 더 이상 표시하지 않으므로 제목과 상자 폭만 검사한다.
 */
import { describe, expect, it } from "vitest";
import { declarationsOf } from "../../../test/cssRules";

describe("개발 보드 카드 넘침 방지 선언", () => {
  it("스택에 명시 트랙이 있어 암시적 auto 트랙이 만들어지지 않는다", () => {
    // 트랙 정의가 없으면 암시적 `auto` 열 트랙이 생기고, 그 트랙의 최소 크기가 카드의 min-content가 된다.
    expect(declarationsOf(".task-stack").get("grid-template-columns")).toMatch(/^minmax\(\s*0\s*,\s*1fr\s*\)$/);
  });

  it("카드와 컬럼의 콘텐츠 기반 최소 크기가 해제되어 있다", () => {
    // 그리드 아이템의 `min-width` 초기값 `auto`는 콘텐츠 기반 최소 크기로 해석된다.
    expect(declarationsOf(".task-card").get("min-width")).toBe("0");
    expect(declarationsOf(".task-column").get("min-width")).toBe("0");
  });

  it("카드 제목이 긴 토큰을 접는다", () => {
    // `break-word` 계열이 만드는 줄바꿈 기회는 min-content 내재 크기 계산에 반영되지 않고 `anywhere`만
    // 반영된다. R2가 요구하는 것이 "긴 토큰이 카드의 최소 폭을 정하지 않는다"이므로 `anywhere`여야 한다.
    expect(declarationsOf(".task-card > strong").get("overflow-wrap")).toBe("anywhere");
  });
});

describe("개발 보드에서 깨지면 안 되는 선언", () => {
  it("보드가 고정 최소 폭 없이 창 너비에 맞춰 열을 다시 배치한다", () => {
    const board = declarationsOf(".task-board");
    expect(board.get("min-width")).toBe("0");
    expect(board.get("grid-template-columns")).toMatch(/auto-fit/);
    expect(board.has("overflow-x")).toBe(false);
  });

  it("한글 줄바꿈을 지키는 두 자리가 그대로다", () => {
    expect(declarationsOf(".launch-hero h1, .setup-card h1").get("word-break")).toBe("keep-all");
    expect(declarationsOf(".help-view").get("word-break")).toBe("keep-all");
  });
});
