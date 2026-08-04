/**
 * 상태 배지가 좁은 자리에서 접히지 않게 하는 CSS 선언의 회귀 검사 (SPEC-026 R4).
 *
 * 이 검사가 보장하는 것: `src/App.css`의 지정한 규칙 안에 지정한 선언이 들어 있다는 것까지다.
 * 이 검사가 보장하지 못하는 것: "그래서 배지가 안 접힌다". 레이아웃을 재지 않는다. 선언을 남긴 채
 * 다른 규칙이 그것을 덮으면 검사는 통과하고 화면은 깨진다. 기획서 확인 필요 2번이 그 한계를 명시적으로
 * 안고 승인한 것이므로 여기에 그대로 적어 둔다. 배지가 실제로 한 줄로 보이는지는 사용자 QA의 눈 확인이
 * 판정한다.
 *
 * 판독기는 `src/test/cssRules.ts`를 `boardCardOverflow.test.ts`(SPEC-021)와 나눠 쓴다. 같은 계열
 * 결함의 검사가 서로 다른 어법으로 갈라지지 않게 하기 위해서다.
 */
import { describe, expect, it } from "vitest";
import { declarationsOf } from "../../../test/cssRules";

// 확인 사실 5·6의 파생 제목 상한. 본문 첫 줄을 60자에서 자르고 `…`을 붙이므로 61자가 된다.
// 이 결함을 신고한 IDEA-7BCB8947의 파생 제목 실측값이고, 워크플로우의 아이디어 26건 중 10건이 이 길이다.
const derivedTitleCap = "아이디어 인박스에서 아이디어노트(문서뷰)의 상태 우측상단 “채택, 반영중, 수집됨”의 ui가 제목의 길이에 …";

// `ideas/`에서 실측한 가장 긴 줄바꿈 불가 런(IDEA-CAB890F1 본문). 제목이 본문 첫 줄에서 파생되므로
// 코드 경로 표기가 그대로 제목이 될 수 있다. 다만 이 문서에서는 60자 절단이 런 한가운데에 떨어져
// 지금 파생 제목에 남는 것은 앞 20자(`~/.claude/heartbeat…`)뿐이다. 이 런이 통째로 제목에 실리는
// 경우를 헤드리스 크롬으로 재보면 `overflow-wrap: anywhere` 없이는 헤더가 110px 가로로 넘치고
// 있으면 0이 된다. 즉 아래 상수는 지금 화면의 재현값이 아니라 그 선언이 막는 입력의 실측값이다.
const unbreakableRun = "~/.claude/heartbeat/jobs.d/<slug>.md";

describe("상태 배지 접힘 방지 선언", () => {
  it("배지 문구가 한 줄을 지킨다", () => {
    // 플렉스·그리드·표 아이템의 자동 최소 크기는 min-content다. 한국어는 글자 사이 어디서나 줄바꿈이
    // 허용되므로 nowrap이 없으면 그 바닥이 "한 글자"까지 내려가고, 폭이 줄면 줄어드는 대신 접힌다.
    expect(declarationsOf(".status-pill").get("white-space")).toBe("nowrap");
  });

  it("아이디어 노트 제목이 긴 토큰을 접는다", () => {
    // 배지가 폭을 지키기 시작하면 제목에 남는 폭이 줄어든다. `break-word` 계열이 만드는 줄바꿈 기회는
    // min-content 계산에 반영되지 않고 `anywhere`만 반영되므로, 긴 런이 제목 쪽의 최소 폭을 정하지
    // 않게 하려면 `anywhere`여야 한다.
    expect(declarationsOf(".idea-preview h2").get("overflow-wrap")).toBe("anywhere");
  });

  it("재현 데이터가 실측값 그대로다", () => {
    // 위 두 선언이 왜 필요한지를 데이터 쪽에서 고정한다. 제목이 실제로 그 길이인지를 재지는 못한다.
    expect(derivedTitleCap).toHaveLength(61);
    expect(unbreakableRun).toHaveLength(36);
    expect(unbreakableRun).not.toMatch(/\s/);
  });
});

describe("상태 배지 주변에서 깨지면 안 되는 선언", () => {
  it("목록 행의 상태 태그가 여전히 한 줄을 지킨다", () => {
    // R5. 목록 쪽은 이미 막혀 있었고 이 작업이 그것을 바꾸지 않는다.
    expect(declarationsOf(".idea-state-tag").get("white-space")).toBe("nowrap");
  });

  it("아이디어 노트 헤더의 배치가 그대로다", () => {
    // 배지를 지키는 처방이 헤더 배치를 바꾸는 방식으로 들어오지 않았음을 고정한다.
    const header = declarationsOf(".idea-preview > header");
    expect(header.get("display")).toBe("flex");
    expect(header.get("justify-content")).toBe("space-between");
  });

  it("작업 상세 제목 옆 배지의 최소 폭이 그대로다", () => {
    // `.view-heading > span`(특이도 0-1-1)이 `.status-pill`(0-1-0)을 이겨 이 자리의 배지는 92px 밑으로
    // 눌리지 않는다. 그 자리가 지금도 접히지 않는다는 판정이 이 값에 기대고 있으므로, 값이 사라지면
    // 판정이 무효가 된다는 사실을 검사로 못 박는다.
    expect(declarationsOf(".view-heading > span").get("min-width")).toBe("92px");
  });
});
