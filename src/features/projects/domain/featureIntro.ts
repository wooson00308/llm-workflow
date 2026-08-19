/**
 * 기능 소개에서 카드에 실을 첫 문장 하나를 잘라 낸다.
 *
 * 이 판정을 프론트에 둔 이유는 소개 값을 쓰는 자리가 셋이기 때문이다(SPEC-075 R5). 확인 화면의
 * 머리말과 완료 기록 화면의 기능 상세는 소개 전체를 계속 보여줘야 하므로, 앱이 내려 주는 값을
 * 좁히면 그 두 자리가 함께 좁아진다. 값은 지금대로 전부 내려보내고 대기열 카드가 그릴 때만
 * 좁힌다.
 */

/** 문장을 끝낼 수 있는 부호. */
const SENTENCE_MARKS = new Set([".", "?", "!"]);

/**
 * 부호 뒤에 이것이 오면 문장이 끝난 자리다.
 *
 * 소개 값에 실제로 들어오는 공백은 이 셋뿐이다. 한 문단 안에서 나뉜 줄은 앱이 공백 하나로 잇고
 * 문단 사이는 빈 줄 하나로 남기며, 줄 끝의 나머지 공백 문자는 그 과정에서 이미 잘려 나간다.
 */
const SENTENCE_BREAKS = new Set([" ", "\n", "\t"]);

/**
 * 소개의 첫 문장. 문장 부호가 하나도 없으면 소개 전체가 첫 문장이고, 앞뒤 공백은 없앤다.
 *
 * 부호 뒤가 공백이 아니면 문장 끝으로 보지 않는다. 소수점이 그 경우라 "실측 3.5초가 나온다."는
 * 통째로 첫 문장이 되고, 부호가 잇달아 붙은 자리는 공백이 따라오는 마지막 부호에서 끊긴다.
 */
export function featureIntroLead(description: string): string {
  for (let index = 0; index < description.length; index += 1) {
    if (!SENTENCE_MARKS.has(description[index])) continue;
    const next = description[index + 1];
    if (next !== undefined && !SENTENCE_BREAKS.has(next)) continue;
    return description.slice(0, index + 1).trim();
  }
  return description.trim();
}
