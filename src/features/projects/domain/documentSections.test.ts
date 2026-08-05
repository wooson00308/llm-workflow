/**
 * 절 찾기의 경계 검사 (SPEC-039 R2·R6, TASK-120 고정값 2).
 *
 * 픽스처는 두 벌로 갈린다 — 찾는 절을 가진 문서와 다른 이름의 절만 가진 문서. 뒤쪽이 폴백의
 * 근거이고, 화면이 후보를 추측하지 않는다는 것도 그 픽스처가 지킨다.
 */
import { describe, expect, it } from "vitest";
import { splitSection } from "./documentSections";

const HEADING = "## 결정권자 요약";

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
