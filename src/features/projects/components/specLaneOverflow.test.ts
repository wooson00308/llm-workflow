/**
 * 레인 안 보드가 레인 상자 밖으로 나가지 않게 하는 CSS 선언의 회귀 검사 (SPEC-029 R6, QA-F25FD89E).
 *
 * 원인: `.task-board`가 `min-width: 950px`이라 창을 좁히면 그 상자가 레인의 테두리보다 넓어진다.
 * 묶기를 끈 보드는 눈에 보이는 상자가 없어 `.workspace-content`의 스크롤로 흡수되지만, 레인은
 * 테두리·배경이 있는 상자라 열(완료·QA 대기 등)이 그 테두리 오른쪽 밖으로 빠져나가 보인다.
 * 처방은 보드에만 가로 스크롤 상자를 씌우는 것이다. `.task-board`의 최소 폭 자체는 건드리지 않는다 —
 * 그 값은 `boardCardOverflow.test.ts`가 지키는 SPEC-021의 결정이다.
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
