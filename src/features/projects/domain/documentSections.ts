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

/**
 * 결정 보드가 추측 없이 표시할 수 있는 고정 요약 값이다.
 *
 * 현행 규격은 제안·현재·변경 후에 선택인 비용과 위험까지 네 항목이다. 이전 일곱 항목 규격
 * (사용자 결과·영향 범위·결정 요청 포함)으로 쓰인 문서도 그대로 유효하며, 보드는 그 문서에서도
 * 같은 네 값만 읽는다. 나머지는 원문 보기가 맡는다.
 */
export interface DecisionSummary {
  proposal: string;
  current: string;
  after: string;
  risk?: string;
}

/** 막힌 작업 문서가 명시한 현재 사유를 화면에서 그대로 사용할 수 있게 분리한 값이다. */
export interface BlockedReason {
  blockedPoint: string;
  requiredResolution: string;
  resumeCondition: string;
  relatedTargetsRaw: string;
  relatedTargets: string[];
}

/** 줄 앞의 공백 세 칸까지는 펜스로 인정한다. CommonMark가 그 자리까지를 들여쓴 코드로 보지 않는다. */
const FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})/;

const HEADING_PATTERN = /^(#{1,6})\s/;

const DECISION_SUMMARY_HEADING = "## 결정권자 요약";
const BLOCKED_REASON_HEADING = "## 막힌 사유";
const BLOCKED_REASON_MARKERS = ["- 막힌 지점: ", "- 필요한 해결: ", "- 재개 조건: ", "- 관련 대상: "] as const;
const STRUCTURED_SUMMARY_HEADINGS = [
  "### 제안",
  "### 현재",
  "### 변경 후",
  "### 사용자 결과",
  "### 영향 범위",
  "### 비용과 위험",
  "### 결정 요청",
] as const;

/** 제목 배열이 이 순서들 가운데 하나와 정확히 일치할 때만 구조화 요약으로 인정한다. */
const ACCEPTED_HEADING_SEQUENCES: readonly (readonly string[])[] = [
  // 현행 규격
  ["### 제안", "### 현재", "### 변경 후"],
  ["### 제안", "### 현재", "### 변경 후", "### 비용과 위험"],
  // 이전 일곱 항목 규격 — 문서는 유효하고, 보드는 공통 네 값만 읽는다.
  ["### 제안", "### 현재", "### 변경 후", "### 사용자 결과", "### 영향 범위", "### 결정 요청"],
  ["### 제안", "### 현재", "### 변경 후", "### 사용자 결과", "### 영향 범위", "### 비용과 위험", "### 결정 요청"],
];

const MARKDOWN_HEADING_PATTERN = /^ {0,3}(#{1,6})\s/;

interface SummaryPart {
  heading: (typeof STRUCTURED_SUMMARY_HEADINGS)[number];
  lines: string[];
}

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

/**
 * `splitSection`으로 분리한 결정권자 요약이 고정 계약을 만족할 때만 보드용 값을 돌려준다.
 *
 * 문장 뜻이나 비슷한 제목을 보완하지 않는다. 구조가 한 곳이라도 어긋나면 `null`을 돌려 기존
 * Markdown 표시가 원문을 그대로 맡도록 한다.
 */
export function parseDecisionSummary(section: string | null): DecisionSummary | null {
  if (section === null) return null;

  const lines = section.split("\n");
  if (lines[0]?.trimEnd() !== DECISION_SUMMARY_HEADING) return null;

  const parts = splitStructuredSummary(lines.slice(1));
  if (parts === null) return null;

  const headings = parts.map((part) => part.heading as string);
  const matched = ACCEPTED_HEADING_SEQUENCES.find(
    (sequence) => sequence.length === headings.length && sequence.every((heading, index) => heading === headings[index]),
  );
  if (!matched) return null;

  // 어느 규격이든 모든 항목이 값을 가져야 구조화 요약이다. 영향 범위는 옛 규격의 표식 형태를 지킨다.
  for (const part of parts) {
    if (part.heading === "### 영향 범위") {
      if (impactValues(part) === null) return null;
    } else if (!partValue(part)) {
      return null;
    }
  }

  const byHeading = new Map(parts.map((part) => [part.heading as string, part]));
  const proposal = partValue(byHeading.get("### 제안"));
  const current = partValue(byHeading.get("### 현재"));
  const after = partValue(byHeading.get("### 변경 후"));
  const risk = partValue(byHeading.get("### 비용과 위험")) ?? undefined;
  if (!proposal || !current || !after) return null;

  return { proposal, current, after, ...(risk ? { risk } : {}) };
}

/**
 * 문서 전체에서 정확한 막힌 사유 절 하나를 찾아 네 필수 값을 분리한다.
 *
 * 비슷한 제목이나 불완전한 목록을 보완하지 않는다. 구조가 모두 유효할 때만 전체 값을 돌려주며,
 * 코드 펜스 안의 예시는 제목이나 라벨로 세지 않는다.
 */
export function parseBlockedReason(body: string): BlockedReason | null {
  const sectionLines = blockedReasonSectionLines(body);
  if (sectionLines === null) return null;

  const contentLines = sectionLines.filter((line) => line.trim().length > 0);
  if (contentLines.length !== BLOCKED_REASON_MARKERS.length) return null;

  const values = BLOCKED_REASON_MARKERS.map((marker, index) => markedValue(contentLines[index], marker));
  if (values.some((value) => value === null)) return null;

  const [blockedPoint, requiredResolution, resumeCondition, relatedTargetsRaw] = values as [string, string, string, string];
  const relatedTargets = parseRelatedTargets(relatedTargetsRaw);
  if (relatedTargets === null) return null;

  return {
    blockedPoint,
    requiredResolution,
    resumeCondition,
    relatedTargetsRaw,
    relatedTargets,
  };
}

function blockedReasonSectionLines(body: string) {
  const lines = body.split("\n");
  const headingIndexes: number[] = [];
  let openFence: string | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fence = FENCE_PATTERN.exec(line)?.[1];
    if (openFence) {
      if (closesFence(line, fence, openFence)) openFence = null;
      continue;
    }
    if (fence) {
      openFence = fence;
      continue;
    }
    if (line === BLOCKED_REASON_HEADING) headingIndexes.push(index);
  }

  if (headingIndexes.length !== 1) return null;

  const start = headingIndexes[0];
  const depth = headingDepth(BLOCKED_REASON_HEADING);
  let end = lines.length;
  openFence = null;

  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    const fence = FENCE_PATTERN.exec(line)?.[1];
    if (openFence) {
      if (closesFence(line, fence, openFence)) openFence = null;
      continue;
    }
    if (fence) {
      openFence = fence;
      continue;
    }
    const foundDepth = headingDepth(line);
    if (foundDepth !== null && depth !== null && foundDepth <= depth) {
      end = index;
      break;
    }
  }

  return lines.slice(start + 1, end);
}

function markedValue(line: string, marker: string) {
  if (!line.startsWith(marker)) return null;
  const value = line.slice(marker.length).trim();
  return value || null;
}

function parseRelatedTargets(raw: string) {
  if (raw === "없음") return [];
  if (raw.endsWith(",")) return null;

  const targets = raw.split(/,\s+/).map((target) => target.trim());
  return targets.some((target) => target.length === 0) ? null : targets;
}

function closesFence(line: string, fence: string | undefined, openFence: string) {
  return Boolean(fence && fence[0] === openFence[0] && fence.length >= openFence.length && line.trim() === fence);
}

function splitStructuredSummary(lines: string[]): SummaryPart[] | null {
  const parts: SummaryPart[] = [];
  let openFence: string | null = null;

  for (const line of lines) {
    const fence = FENCE_PATTERN.exec(line)?.[1];
    if (openFence) {
      parts[parts.length - 1].lines.push(line);
      if (fence && fence[0] === openFence[0] && fence.length >= openFence.length && line.trim() === fence) {
        openFence = null;
      }
      continue;
    }
    if (fence) {
      if (parts.length === 0) return null;
      parts[parts.length - 1].lines.push(line);
      openFence = fence;
      continue;
    }

    const depth = markdownHeadingDepth(line);
    if (depth !== null) {
      const heading = line.trimEnd();
      if (depth !== 3 || !isStructuredSummaryHeading(heading)) return null;
      parts.push({ heading, lines: [] });
      continue;
    }

    if (parts.length === 0) {
      if (line.trim().length > 0) return null;
      continue;
    }
    parts[parts.length - 1].lines.push(line);
  }

  return parts;
}

function isStructuredSummaryHeading(heading: string): heading is SummaryPart["heading"] {
  return (STRUCTURED_SUMMARY_HEADINGS as readonly string[]).includes(heading);
}

function partValue(part: SummaryPart | undefined) {
  const value = part?.lines.join("\n").trim();
  return value || null;
}

function impactValues(part: SummaryPart | undefined) {
  const lines = part?.lines.filter((line) => line.trim().length > 0);
  if (!lines || lines.length !== 2) return null;

  const changed = impactValue(lines[0], "- 변경:");
  const unchanged = impactValue(lines[1], "- 유지:");
  return changed && unchanged ? { changed, unchanged } : null;
}

function impactValue(line: string, marker: string) {
  if (!line.startsWith(marker)) return null;
  const value = line.slice(marker.length).trim();
  return value || null;
}

function headingDepth(line: string) {
  const match = HEADING_PATTERN.exec(line);
  return match ? match[1].length : null;
}

function markdownHeadingDepth(line: string) {
  const match = MARKDOWN_HEADING_PATTERN.exec(line);
  return match ? match[1].length : null;
}
