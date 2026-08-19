import { describe, expect, it } from "vitest";
import { featureIntroLead } from "./featureIntro";

describe("featureIntroLead", () => {
  it("cuts a long intro at the first sentence and leaves the second one out", () => {
    const intro = "품질 확인 목록의 기능 카드에는 기능 소개의 첫 문장 하나만 실린다. 지금은 소개 문단이 세 줄까지 잘려 나온다. 잘린 자리까지 읽어도 기능이 무엇인지 알기 어렵다. 그래서 사용자는 카드를 읽지 않고 지나친다.";

    const lead = featureIntroLead(intro);

    expect(lead).toBe("품질 확인 목록의 기능 카드에는 기능 소개의 첫 문장 하나만 실린다.");
    expect(lead).not.toContain("지금은");
  });

  it("hands a one-sentence intro back unchanged", () => {
    expect(featureIntroLead("결제 화면의 카드 등록 단계를 줄였습니다.")).toBe("결제 화면의 카드 등록 단계를 줄였습니다.");
  });

  it("takes the whole intro when it carries no sentence mark", () => {
    expect(featureIntroLead("카드 등록 흐름 정리")).toBe("카드 등록 흐름 정리");
  });

  it("does not break at a decimal point, because no space follows it", () => {
    expect(featureIntroLead("실측 3.5초가 나온다. 그다음 문장이다.")).toBe("실측 3.5초가 나온다.");
  });

  it("breaks at the last of several marks standing together", () => {
    expect(featureIntroLead("정말인가!? 그렇다.")).toBe("정말인가!?");
  });

  it("stops at the blank line when the first paragraph is one sentence", () => {
    expect(featureIntroLead("첫 문단은 한 문장이다.\n\n둘째 문단이 이어진다. 여기까지는 카드에 실리지 않는다.")).toBe("첫 문단은 한 문장이다.");
  });

  it("returns an empty string for an empty or blank intro", () => {
    expect(featureIntroLead("")).toBe("");
    expect(featureIntroLead("   \n\n  ")).toBe("");
  });

  it("trims the whitespace around the sentence it returns", () => {
    expect(featureIntroLead("  앞뒤에 공백이 있다.  둘째 문장이다.")).toBe("앞뒤에 공백이 있다.");
  });

  it("ends the sentence at a mark that closes the intro", () => {
    expect(featureIntroLead("마침표로 끝난다!")).toBe("마침표로 끝난다!");
  });
});
