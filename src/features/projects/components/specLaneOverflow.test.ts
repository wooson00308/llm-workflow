/**
 * 레인 안 보드가 레인 상자 밖으로 나가지 않게 하는 CSS 선언의 회귀 검사 (SPEC-029 R6, QA-F25FD89E).
 *
 * 과거 원인은 `.task-board`의 고정 최소 폭이었다. 현재 보드는 창 너비에 맞춰 열을 다시 배치하지만,
 * 기획서 레인의 스크롤 경계는 별도 안전망으로 유지한다. 이후 카드나 열에 다시 최소 폭이 생겨도
 * 레인 헤더까지 함께 밀리지 않게 보드만 스크롤 상자 안에 둔다.
 *
 * 이 검사가 보장하는 것: `src/App.css`의 지정한 규칙 안에 지정한 선언이 들어 있다는 것까지다.
 * 이 검사가 보장하지 못하는 것: "그래서 열이 레인 밖으로 나가지 않는다". 레이아웃을 전혀 재지 않는다.
 * 테스트 환경이 jsdom이라 상자 크기를 물으면 전부 0이 돌아오기 때문이고, 이유와 한계는
 * `boardCardOverflow.test.ts`가 적은 것과 같다. 실제로 넘치는지는 사용자 QA의 눈 확인이 판정한다.
 *
 * 스크롤 상자가 레인 안 보드를 실제로 감싸는지(마크업 쪽)는 `DevelopmentBoard.test.tsx`가 확인한다.
 */
import { describe, expect, it } from "vitest";
import { declarationsOf } from "../../../test/cssRules";

describe("레인 안 보드 넘침 방지 선언", () => {
  it("레인 안 보드에 가로 스크롤 상자가 씌워져 있다", () => {
    expect(declarationsOf(".task-lane-scroll").get("overflow-x")).toBe("auto");
  });

  it("스크롤 상자의 콘텐츠 기반 최소 크기가 해제되어 있다", () => {
    // `min-width`의 초기값 `auto`는 콘텐츠 기반 최소 크기로 해석되어, 상자가 950px 보드만큼
    // 넓어지고 스크롤이 생기지 않는 경로가 남는다.
    expect(declarationsOf(".task-lane-scroll").get("min-width")).toBe("0");
  });

  it("레인 자신은 스크롤 상자가 아니다", () => {
    // 레인 전체가 스크롤 상자가 되면 오른쪽으로 밀 때 헤더까지 함께 밀려 집계와 QA 신호가 화면에서
    // 사라진다. 접혀도 헤더는 남는다는 R6의 결정과 같은 이유로 스크롤은 보드에만 씌운다.
    const lane = declarationsOf(".task-lane");
    expect(lane.has("overflow-x")).toBe(false);
    expect(lane.has("overflow")).toBe(false);
  });
});
