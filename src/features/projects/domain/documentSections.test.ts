/**
 * 절 찾기의 경계 검사 (SPEC-039 R2·R6, TASK-120 고정값 2).
 *
 * 픽스처는 두 벌로 갈린다 — 찾는 절을 가진 문서와 다른 이름의 절만 가진 문서. 뒤쪽이 폴백의
 * 근거이고, 화면이 후보를 추측하지 않는다는 것도 그 픽스처가 지킨다.
 */
import { describe, expect, it } from "vitest";
import { parseBlockedReason, parseDecisionSummary, splitSection } from "./documentSections";

const HEADING = "## 결정권자 요약";
const BLOCKED_HEADING = "## 막힌 사유";

function structuredSummary({
  risk = "호환성 확인이 필요하다.",
  impact = ["- 변경: 결정 보드", "- 유지: 원문 Markdown"],
}: {
  risk?: string | null;
  impact?: string[];
} = {}) {
  return [
    HEADING,
    "",
    "### 제안",
    "구조화된 요약을 읽는다.",
    "",
    "### 현재",
    "평문 요약만 보인다.",
    "",
    "### 변경 후",
    "고정된 카드로 보인다.",
    "",
    "### 사용자 결과",
    "판단할 내용을 빨리 찾는다.",
    "",
    "### 영향 범위",
    ...impact,
    ...(risk === null ? [] : ["", "### 비용과 위험", risk]),
    "",
    "### 결정 요청",
    "형식을 확인한다.",
  ].join("\n");
}

function blockedReason({
  blockedPoint = "배포 **토큰**: 값이 없다.",
  requiredResolution = "운영자가 토큰을 발급한다.",
  resumeCondition = "토큰 확인 검사가 통과한다.",
  relatedTargets = "TASK-100, TASK-없는-작업, 외부 공급자 승인",
}: {
  blockedPoint?: string;
  requiredResolution?: string;
  resumeCondition?: string;
  relatedTargets?: string;
} = {}) {
  return [
    "# 작업",
    "",
    BLOCKED_HEADING,
    "",
    `- 막힌 지점: ${blockedPoint}`,
    `- 필요한 해결: ${requiredResolution}`,
    `- 재개 조건: ${resumeCondition}`,
    `- 관련 대상: ${relatedTargets}`,
    "",
    "## 다음 절",
    "",
    "나머지 본문이다.",
  ].join("\n");
}

describe("splitSection", () => {
  it("잘라 낸 절이 제목 줄과 그 아래 본문을 원문 그대로 담는다", () => {
    const body = ["# 제목", "", HEADING, "", "이 작업이 끝나면 평문이 먼저 열린다.", "", "## 기획 내용", "", "본문이다."].join("\n");

    expect(splitSection(body, HEADING).section).toBe(
      [HEADING, "", "이 작업이 끝나면 평문이 먼저 열린다."].join("\n"),
    );
  });

  it("절의 경계가 같은 깊이의 다음 제목이고 더 깊은 제목은 절 안이다", () => {
    const body = [HEADING, "", "첫 줄이다.", "", "### 딸린 절", "", "이 줄도 요약 안이다.", "", "## 다음 절", "", "여기부터는 밖이다."].join("\n");

    const { section } = splitSection(body, HEADING);
    expect(section).toContain("### 딸린 절");
    expect(section).toContain("이 줄도 요약 안이다.");
    expect(section).not.toContain("여기부터는 밖이다.");
  });

  it("더 얕은 제목도 절을 끊는다", () => {
    const body = [HEADING, "", "첫 줄이다.", "", "# 새 문서 제목", "", "밖이다."].join("\n");

    expect(splitSection(body, HEADING).section).toBe([HEADING, "", "첫 줄이다."].join("\n"));
  });

  it("문서 끝까지 다음 제목이 없으면 끝까지가 절이다", () => {
    const body = ["# 제목", "", HEADING, "", "마지막 줄이다."].join("\n");

    expect(splitSection(body, HEADING).section).toBe([HEADING, "", "마지막 줄이다."].join("\n"));
  });

  it("코드 펜스 안의 제목 줄을 제목으로 읽지 않는다", () => {
    const body = [HEADING, "", "예시는 이렇다.", "", "```md", "## 다른 절", "```", "", "펜스 뒤에도 요약 안이다.", "", "## 진짜 다음 절", "", "밖이다."].join("\n");

    const { section } = splitSection(body, HEADING);
    expect(section).toContain("## 다른 절");
    expect(section).toContain("펜스 뒤에도 요약 안이다.");
    expect(section).not.toContain("밖이다.");
  });

  it("물결 펜스도 코드 블록으로 읽는다", () => {
    const body = [HEADING, "", "~~~", "## 펜스 안", "~~~", "", "요약 안이다.", "", "## 다음 절", "", "밖이다."].join("\n");

    const { section } = splitSection(body, HEADING);
    expect(section).toContain("## 펜스 안");
    expect(section).toContain("요약 안이다.");
    expect(section).not.toContain("밖이다.");
  });

  it("펜스 안에서 시작하는 제목은 절의 시작으로도 읽지 않는다", () => {
    const body = ["# 제목", "", "```md", HEADING, "", "예시 문장이다.", "```", ""].join("\n");

    expect(splitSection(body, HEADING).section).toBeNull();
  });

  it("다른 이름의 절만 가진 문서에서는 아무것도 찾지 못한다", () => {
    const body = ["# 제목", "", "## 요약", "", "이름이 다르다.", "", "## 결정권자요약", "", "공백도 다르다."].join("\n");

    const { rest, section } = splitSection(body, HEADING);
    expect(section).toBeNull();
    expect(rest).toBe(body);
  });

  it("절 이름의 대소문자와 공백 변형을 만들지 않는다", () => {
    const body = ["#  결정권자 요약", "", "깊이도 이름도 다르다."].join("\n");

    expect(splitSection(body, HEADING).section).toBeNull();
  });

  it("줄 끝의 공백은 무시한다", () => {
    const body = [`${HEADING}   `, "", "본문이다."].join("\n");

    expect(splitSection(body, HEADING).section).toBe("## 결정권자 요약   \n\n본문이다.");
  });

  it("여는 펜스 안쪽의 정보 문자열 줄은 닫는 줄이 아니다", () => {
    const body = [HEADING, "", "```", "```md", "## 안쪽", "```", "", "요약 안이다.", "", "## 다음 절", "", "밖이다."].join("\n");

    const { section } = splitSection(body, HEADING);
    expect(section).toContain("## 안쪽");
    expect(section).toContain("요약 안이다.");
    expect(section).not.toContain("밖이다.");
  });

  it("나머지는 그 절만 빠진 본문이다", () => {
    const body = ["# 제목", "", HEADING, "", "요약이다.", "", "## 기획 내용", "", "본문이다."].join("\n");

    expect(splitSection(body, HEADING).rest).toBe(["# 제목", "", "## 기획 내용", "", "본문이다."].join("\n"));
  });

  it("같은 제목이 두 번 나오면 첫 번째를 쓴다", () => {
    const body = [HEADING, "", "첫 번째다.", "", "## 사이", "", "가운데다.", "", HEADING, "", "두 번째다."].join("\n");

    expect(splitSection(body, HEADING).section).toBe([HEADING, "", "첫 번째다."].join("\n"));
  });

  it("제목이 아닌 문자열을 찾으라고 하면 아무것도 찾지 못한다", () => {
    const body = ["결정권자 요약", "", "제목 표시가 없다."].join("\n");

    expect(splitSection(body, "결정권자 요약").section).toBeNull();
  });
});

describe("parseDecisionSummary", () => {
  it("현행 세 항목 규격을 보드 값으로 분리한다", () => {
    const section = [
      HEADING, "",
      "### 제안", "요약을 세 덩어리로 줄인다.", "",
      "### 현재", "일곱 항목이 다 보인다.", "",
      "### 변경 후", "제안과 전후만 보여 결정이 빨라진다.",
    ].join("\n");

    expect(parseDecisionSummary(section)).toEqual({
      proposal: "요약을 세 덩어리로 줄인다.",
      current: "일곱 항목이 다 보인다.",
      after: "제안과 전후만 보여 결정이 빨라진다.",
    });
  });

  it("현행 규격의 선택 위험 항목을 함께 분리한다", () => {
    const section = [
      HEADING, "",
      "### 제안", "요약을 줄인다.", "",
      "### 현재", "정보가 많다.", "",
      "### 변경 후", "핵심만 남는다.", "",
      "### 비용과 위험", "옛 문서는 원문 보기로만 전체가 보인다.",
    ].join("\n");

    expect(parseDecisionSummary(section)?.risk).toBe("옛 문서는 원문 보기로만 전체가 보인다.");
  });

  it("정확한 구조의 Markdown 조각을 명시적 보드 값으로 분리한다", () => {
    const section = structuredSummary().replace("구조화된 요약을 읽는다.", "  **구조화된** 요약을\n읽는다.  ");

    expect(parseDecisionSummary(section)).toEqual({
      proposal: "**구조화된** 요약을\n읽는다.",
      current: "평문 요약만 보인다.",
      after: "고정된 카드로 보인다.",
      risk: "호환성 확인이 필요하다.",
    });
  });

  it("선택 위험 항목이 없으면 빈 값 대신 필드를 만들지 않는다", () => {
    const summary = parseDecisionSummary(structuredSummary({ risk: null }));

    expect(summary).toEqual({
      proposal: "구조화된 요약을 읽는다.",
      current: "평문 요약만 보인다.",
      after: "고정된 카드로 보인다.",
    });
    expect(summary).not.toHaveProperty("risk");
  });

  it("값 안의 코드 펜스는 원문 Markdown으로 보존한다", () => {
    const section = structuredSummary().replace(
      "구조화된 요약을 읽는다.",
      ["예시는 다음과 같다.", "", "```md", "### 제안", "```"].join("\n"),
    );

    expect(parseDecisionSummary(section)?.proposal).toBe(["예시는 다음과 같다.", "", "```md", "### 제안", "```"].join("\n"));
  });

  it.each([
    ["제안", "### 제안"],
    ["현재", "### 현재"],
    ["변경 후", "### 변경 후"],
    ["사용자 결과", "### 사용자 결과"],
    ["영향 범위", "### 영향 범위"],
    ["결정 요청", "### 결정 요청"],
  ])("필수 제목 %s이 빠지면 평문 폴백을 쓴다", (_name, heading) => {
    expect(parseDecisionSummary(structuredSummary().replace(`${heading}\n`, ""))).toBeNull();
  });

  it.each([
    ["제안", "구조화된 요약을 읽는다."],
    ["현재", "평문 요약만 보인다."],
    ["변경 후", "고정된 카드로 보인다."],
    ["사용자 결과", "판단할 내용을 빨리 찾는다."],
    ["비용과 위험", "호환성 확인이 필요하다."],
    ["결정 요청", "형식을 확인한다."],
  ])("%s 값이 비어 있으면 일부 값을 돌려주지 않는다", (_name, value) => {
    expect(parseDecisionSummary(structuredSummary().replace(value, ""))).toBeNull();
  });

  it.each([
    ["변경 표식 누락", ["- 유지: 원문 Markdown"]],
    ["유지 표식 누락", ["- 변경: 결정 보드"]],
    ["별표 목록", ["* 변경: 결정 보드", "- 유지: 원문 Markdown"]],
    ["표식 순서 변경", ["- 유지: 원문 Markdown", "- 변경: 결정 보드"]],
    ["변경 표식 중복", ["- 변경: 결정 보드", "- 변경: 원문 Markdown"]],
    ["변경 값 비어 있음", ["- 변경:   ", "- 유지: 원문 Markdown"]],
    ["유지 값 비어 있음", ["- 변경: 결정 보드", "- 유지:   "]],
    ["추가 평문", ["- 변경: 결정 보드", "- 유지: 원문 Markdown", "추가 설명"]],
  ])("영향 범위에 %s이 있으면 구조 전체를 거절한다", (_name, impact) => {
    expect(parseDecisionSummary(structuredSummary({ impact }))).toBeNull();
  });

  it.each([
    ["제목 철자 변경", structuredSummary().replace("### 제안", "### 제 안")],
    ["제목 깊이 변경", structuredSummary().replace("### 현재", "#### 현재")],
    ["알 수 없는 제목", structuredSummary().replace("### 현재", "### 배경")],
    ["값 안의 알 수 없는 제목", structuredSummary().replace("평문 요약만 보인다.", "평문 요약만 보인다.\n\n#### 보충")],
    ["제목 중복", structuredSummary().replace("### 현재", "### 제안")],
    [
      "제목 순서 변경",
      structuredSummary().replace(
        ["### 제안", "구조화된 요약을 읽는다.", "", "### 현재", "평문 요약만 보인다."].join("\n"),
        ["### 현재", "평문 요약만 보인다.", "", "### 제안", "구조화된 요약을 읽는다."].join("\n"),
      ),
    ],
    [
      "비용과 위험 위치 변경",
      structuredSummary().replace(
        ["### 비용과 위험", "호환성 확인이 필요하다.", "", "### 결정 요청", "형식을 확인한다."].join("\n"),
        ["### 결정 요청", "형식을 확인한다.", "", "### 비용과 위험", "호환성 확인이 필요하다."].join("\n"),
      ),
    ],
  ])("%s은 제목을 추측하지 않는다", (_name, section) => {
    expect(parseDecisionSummary(section)).toBeNull();
  });

  it("평문과 불완전한 요약은 splitSection의 원문을 바꾸지 않고 폴백한다", () => {
    const body = ["# 제목", "", HEADING, "", "평문 요약이다.", "", "## 본문", "", "원문이다."].join("\n");
    const split = splitSection(body, HEADING);

    expect(parseDecisionSummary(split.section)).toBeNull();
    expect(split.section).toBe([HEADING, "", "평문 요약이다."].join("\n"));
    expect(split.rest).toBe(["# 제목", "", "## 본문", "", "원문이다."].join("\n"));
    expect(parseDecisionSummary(null)).toBeNull();
  });
});

describe("parseBlockedReason", () => {
  it("정확한 절을 원문 값과 작성 순서의 관련 대상 목록으로 분리한다", () => {
    expect(parseBlockedReason(blockedReason())).toEqual({
      blockedPoint: "배포 **토큰**: 값이 없다.",
      requiredResolution: "운영자가 토큰을 발급한다.",
      resumeCondition: "토큰 확인 검사가 통과한다.",
      relatedTargetsRaw: "TASK-100, TASK-없는-작업, 외부 공급자 승인",
      relatedTargets: ["TASK-100", "TASK-없는-작업", "외부 공급자 승인"],
    });
  });

  it("관련 대상 없음은 원문을 보존하면서 빈 목록으로 분리한다", () => {
    expect(parseBlockedReason(blockedReason({ relatedTargets: "없음" }))).toEqual({
      blockedPoint: "배포 **토큰**: 값이 없다.",
      requiredResolution: "운영자가 토큰을 발급한다.",
      resumeCondition: "토큰 확인 검사가 통과한다.",
      relatedTargetsRaw: "없음",
      relatedTargets: [],
    });
  });

  it("각 값의 양끝 공백만 제거하고 내부 Markdown과 콜론은 보존한다", () => {
    const parsed = parseBlockedReason(
      blockedReason({
        blockedPoint: "  **배포 토큰**: 값이 없다.  ",
        requiredResolution: "  운영자: 토큰을 발급한다.  ",
      }),
    );

    expect(parsed?.blockedPoint).toBe("**배포 토큰**: 값이 없다.");
    expect(parsed?.requiredResolution).toBe("운영자: 토큰을 발급한다.");
  });

  it.each([
    ["제목 없음", blockedReason().replace(`${BLOCKED_HEADING}\n`, "")],
    ["제목 중복", `${blockedReason()}\n\n${BLOCKED_HEADING}\n\n- 막힌 지점: 다시 막힘`],
    ["제목 철자 변경", blockedReason().replace(BLOCKED_HEADING, "## 막힘 사유")],
    ["제목 깊이 변경", blockedReason().replace(BLOCKED_HEADING, "### 막힌 사유")],
    ["제목 띄어쓰기 변경", blockedReason().replace(BLOCKED_HEADING, "##  막힌 사유")],
  ])("%s을 유효한 절로 보정하지 않는다", (_name, body) => {
    expect(parseBlockedReason(body)).toBeNull();
  });

  it.each([
    ["막힌 지점 누락", blockedReason().replace("- 막힌 지점: 배포 **토큰**: 값이 없다.\n", "")],
    [
      "필요한 해결 중복",
      blockedReason().replace("- 필요한 해결: 운영자가 토큰을 발급한다.", "- 필요한 해결: 첫째\n- 필요한 해결: 둘째"),
    ],
    [
      "순서 변경",
      blockedReason().replace(
        "- 필요한 해결: 운영자가 토큰을 발급한다.\n- 재개 조건: 토큰 확인 검사가 통과한다.",
        "- 재개 조건: 토큰 확인 검사가 통과한다.\n- 필요한 해결: 운영자가 토큰을 발급한다.",
      ),
    ],
    ["라벨 철자 변경", blockedReason().replace("- 재개 조건:", "- 재개조건:")],
    ["목록 표식 변경", blockedReason().replace("- 관련 대상:", "* 관련 대상:")],
    ["추가 평문", blockedReason().replace("\n\n## 다음 절", "\n추가 설명\n\n## 다음 절")],
    ["추가 목록", blockedReason().replace("\n\n## 다음 절", "\n- 참고: 추가 값\n\n## 다음 절")],
  ])("%s이 있으면 부분 결과를 돌려주지 않는다", (_name, body) => {
    expect(parseBlockedReason(body)).toBeNull();
  });

  it.each([
    ["막힌 지점", blockedReason({ blockedPoint: "" })],
    ["필요한 해결", blockedReason({ requiredResolution: "" })],
    ["재개 조건", blockedReason({ resumeCondition: "" })],
    ["관련 대상", blockedReason({ relatedTargets: "" })],
  ])("빈 %s 값은 절 전체를 무효로 만든다", (_name, body) => {
    expect(parseBlockedReason(body)).toBeNull();
  });

  it.each([
    ["가운데", "TASK-100, , 외부 승인"],
    ["처음", ", TASK-100"],
    ["마지막", "TASK-100, "],
  ])("관련 대상의 %s 빈 조각을 거절한다", (_name, relatedTargets) => {
    expect(parseBlockedReason(blockedReason({ relatedTargets }))).toBeNull();
  });

  it("두 종류의 코드 펜스 안에 있는 제목과 라벨 예시는 판정에 포함하지 않는다", () => {
    const example = [
      "# 작업",
      "",
      "```markdown",
      BLOCKED_HEADING,
      "- 막힌 지점: 예시",
      "```",
      "",
      "~~~markdown",
      BLOCKED_HEADING,
      "- 관련 대상: TASK-예시",
      "~~~",
      "",
      blockedReason(),
    ].join("\n");

    expect(parseBlockedReason(example)?.relatedTargets).toEqual(["TASK-100", "TASK-없는-작업", "외부 공급자 승인"]);
  });
});
