/**
 * 문서 본문에서 절 하나를 잘라 낸다.
 *
 * 판정은 원문 문자열 위에서 한다. Markdown을 파싱해 트리로 만들지 않는 이유는 화면이 지금
 * `react-markdown`에 본문을 통째로 넘기는 구조이기 때문이다 — 잘라 낸 조각도 같은 경로로 그린다.
 *
 * 절의 경계는 같은 깊이의 다음 제목까지다. `## 요약` 다음의 `###`는 절 안이고 다음 `##`는 절 밖이다.
 * 코드 펜스 안의 `#`은 제목이 아니다. 문서 본문에 코드 블록이 흔해서 이 구분이 없으면 예제 안의
 * 제목 줄이 절을 끊는다.
 *
 * 찾는 제목은 부르는 쪽이 문자열 하나로 준다. 후보를 추측하지 않고 대소문자·공백 변형도 만들지
 * 않는다(SPEC-039 R2). 줄 끝의 공백만 무시한다 — 눈에 보이지 않는 차이라 문서마다 갈릴 자리다.
 */

export interface SectionSplit {
  /** 찾은 절. 제목 줄과 그 아래 본문을 원문 그대로 담는다. 절이 없으면 `null`이다. */
  section: string | null;
  /** 그 절을 뺀 나머지. 절을 찾지 못했으면 본문 그대로다. */
  rest: string;
}

/** 줄 앞의 공백 세 칸까지는 펜스로 인정한다. CommonMark가 그 자리까지를 들여쓴 코드로 보지 않는다. */
const FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})/;

const HEADING_PATTERN = /^(#{1,6})\s/;

/**
 * 본문에서 `heading` 절을 잘라 낸 결과를 돌려준다.
 *
 * 같은 제목이 두 번 나오면 첫 번째를 쓴다. 문서가 같은 절을 두 벌 갖는 것은 문서 쪽의 문제이고,
 * 화면이 고를 근거가 없다.
 */
export function splitSection(body: string, heading: string): SectionSplit {
  const depth = headingDepth(heading);
  if (depth === null) return { section: null, rest: body };

  const lines = body.split("\n");
  let openFence: string | null = null;
  let start = -1;
  let end = lines.length;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fence = FENCE_PATTERN.exec(line)?.[1];
    if (openFence) {
      // 닫는 펜스는 여는 것과 같은 문자로 그 길이 이상이고, 뒤에 아무것도 오지 않는다.
      // 정보 문자열이 붙은 줄(``` yaml 따위)은 여전히 코드 블록 안이다.
      if (fence && fence[0] === openFence[0] && fence.length >= openFence.length && line.trim() === fence) {
        openFence = null;
      }
      continue;
    }
    if (fence) {
      openFence = fence;
      continue;
    }
    if (start < 0) {
      if (line.trimEnd() === heading) start = index;
      continue;
    }
    const found = headingDepth(line);
    if (found !== null && found <= depth) {
      end = index;
      break;
    }
  }

  if (start < 0) return { section: null, rest: body };
  return {
    section: lines.slice(start, end).join("\n").trimEnd(),
    rest: [...lines.slice(0, start), ...lines.slice(end)].join("\n").trim(),
  };
}

function headingDepth(line: string) {
  const match = HEADING_PATTERN.exec(line);
  return match ? match[1].length : null;
}
