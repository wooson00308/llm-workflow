import type { TaskEvent } from "./types";

/**
 * 기획서 결정의 화면 이름을 정하는 단일 출처.
 *
 * 한 `outcome` 값에 화면 이름이 둘이다. 아직 결정되지 않은 기획서의 `revision_requested`는 그
 * 문서를 다시 쓰라는 "수정 요청"이고, 이미 승인된 기획서의 같은 값은 승인과 파생 작업을 그대로
 * 두고 후속 기획을 요청하는 "후속 기획 요청"이다(SPEC-042 R3·확인 필요 4번).
 *
 * 그 둘을 가르는 근거는 그 결정 앞에 승인이 있었는가 하나뿐이고, 시각순 결정 목록이 그 답을 이미
 * 갖고 있다. 앱에서 새 값을 받아 올 필요가 없다.
 *
 * 규칙이 이 모듈 하나에만 있는 이유는 기획서 화면의 조작·이력과 활동 뷰가 같은 사실을 서로 다른
 * 말로 부르지 않게 하기 위해서다(R5).
 */

/** 결정 종류 그 자체의 이름. 앞선 승인을 보지 않는 쪽이다. */
const outcomeLabels: Record<string, string> = {
  approved: "승인",
  revision_requested: "수정 요청",
  rejected: "폐기",
};

/** 승인된 기획서에 보내는 수정 요청의 이름. 기록되는 값은 `revision_requested` 그대로다. */
export const FOLLOW_UP_LABEL = "후속 기획 요청";

/** 시각순 결정 목록의 한 항목에 이름을 붙인 값. */
export interface LabeledSpecDecision extends TaskEvent {
  label: string;
}

/**
 * 결정 하나의 화면 이름. `afterApproval`은 이 결정보다 앞에 승인이 있었는가다.
 *
 * 계약 밖의 종류는 값을 그대로 돌려준다. 활동 뷰가 지금 하는 것과 같은 처리이고, 모르는 값을
 * 조용히 빠뜨리지 않는다.
 */
export function specDecisionLabel(kind: string, afterApproval: boolean): string {
  if (kind === "revision_requested" && afterApproval) return FOLLOW_UP_LABEL;
  return outcomeLabels[kind] ?? kind;
}

/**
 * 한 기획서의 시각순 결정 목록에 이름을 붙인다. 입력 순서를 그대로 지킨다 — 정렬은 목록을 만드는
 * 쪽이 이미 했다.
 */
export function labelSpecDecisions(events: TaskEvent[]): LabeledSpecDecision[] {
  let approvalSeen = false;
  return events.map((event) => {
    // 이름은 자기 앞의 사실로만 정한다. 승인 자신은 자기 뒤부터 근거가 된다.
    const label = specDecisionLabel(event.kind, approvalSeen);
    if (event.kind === "approved") approvalSeen = true;
    return { ...event, label };
  });
}
