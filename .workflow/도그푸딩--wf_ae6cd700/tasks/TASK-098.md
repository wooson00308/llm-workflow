---
schema: workflow-labs/task@1
id: TASK-098
title: 계약에서 기획자 분기 임시 불릿을 걷어내고 rules_version을 올린다
status: completed
source_spec_id: SPEC-030
source_decision_id: DECISION-4B917B03
depends_on: [TASK-097]
updated_at: 2026-08-04T15:29:46.439588+00:00
history:
  - { at: 2026-08-04T11:32:00Z, kind: created }
  - { at: 2026-08-04T15:12:00Z, kind: in_progress }
  - { at: 2026-08-04T15:18:30Z, kind: qa_waiting }
  - { at: 2026-08-04T15:29:46.439588+00:00, kind: completed }
---

# 계약에서 기획자 분기 임시 불릿을 걷어내고 rules_version을 올린다

SPEC-030의 R4와 R5(규칙 자산 축)를 닫는다. 공통 규칙이 자기 결함을 명시해 둔 임시 문장 하나를 지우고
`WORKFLOW_RULES_VERSION`을 올린다.

지울 문장은 `### Ratifying a delegated decision` 절의 세 번째 불릿이다(확인 사실 7).

> The condition script's planner branch does not read `created_by`. It compares `created_at` across
> every decision document of the specification, so a delegated decision later than a pending
> `revision_requested` hides that revision request from the heartbeat while the app still counts it.
> Until that branch reads `created_by` too, the app and the heartbeat disagree about such a
> specification.

TASK-088이 "실측해 보니 참이라 참인 만큼만 적었다"며 넣은 문장이다. **결함이 닫히면 계약에 남을 이유가
없다.**

## 왜 이 작업이 뒤인가

**계약 문언이 구현을 앞지르지 않아야 한다.** 이 불릿이 말하는 상태는 TASK-097이 판정을 고친 뒤에야
거짓이 된다. 먼저 지우면 계약이 거짓말을 한다 — 반대 방향으로, 이번에는 "닫혔다"고 읽히는 침묵으로.

TASK-088이 SPEC-028에서 같은 자리에 같은 순서를 세웠고("문언이 구현을 앞지르지 않아야 한다"),
SPEC-022가 확인 화면 문구를 보존 구현 뒤에 둔 것과도 같은 원칙이다. 이 저장소의 사고는 화면이 지키지
못할 약속을 먼저 적어서 났고, 계약 문서도 같은 성질의 자산이다.

## 의존성

- **선행 필수: TASK-097.** 위 이유. **파일은 겹치지 않는다** — 그쪽은 `heartbeat_condition.rs`·
  `role_eligibility.rs`, 이쪽은 `project_instructions.rs`다. 순서의 근거는 코드 충돌이 아니라 문언과
  사실의 선후다.

## 규칙 자산 단독 편집 (확인 사실 12의 선례)

**이 작업은 `project_instructions.rs`를 만지는 유일한 작업이다.** TASK-041이 같은 자리에 선례를
적었다 — "규칙 자산의 버전 상수를 올리는 작업이 동시에 둘이면 한쪽이 상대의 인상을 밟는다. 이 파일을
만지는 다른 작업이 생기면 병행 금지다."

분해 시점에 이 파일을 범위에 올린 미완료 작업은 TASK-086·088 둘이고 **둘 다 `qa_waiting`이다.** 이
작업이 `todo`인 동안 QA가 그중 하나를 되돌리거나 그 파일을 범위로 삼는 작업이 새로 생기면 병행
금지다 — `blocked`으로 두고 상신한다.

## 범위

- `src-tauri/src/infrastructure/project_instructions.rs`
  - `WORKFLOW_RULES` 본문의 `### Ratifying a delegated decision` 절 — 불릿 삭제와 앞 문장 정리.
  - 본문 프론트매터의 `rules_version` — 착수 시점 값 +1.
  - `WORKFLOW_RULES_VERSION` — 같은 값. 두 값이 같아야 한다는 주석이 그 위에 있다.
  - 그 파일의 테스트 — 현재 `rules_version` 값을 기대하는 단언들이 새 값으로 바뀐다.
- 그 외 파일은 건드리지 않는다. 판정 구현은 TASK-097이 끝냈다.
- **역할 계약 세 파일은 무변경이다.** `ROLE_RULES_VERSION`도 planner·architect·developer 본문의
  `rules_version`도 그대로다. 기획서가 고치기로 한 것은 공통 규칙 본문 한 절이다.

## 작업 내용

### 불릿 삭제와 절의 정합 (R4)

세 문장을 함께 봐야 한다.

- 앞 문장 **"Two judgements ignore it and one does not:"** — 불릿이 셋에서 둘로 줄고 **셋 다 무시하게
  되므로** 이 셈이 그대로 남으면 어긋난다. 남은 항목 수와 성격에 맞게 고친다(완료 조건 8).
- 남는 두 불릿(앱 판정·아키텍트 판정)은 사실이 달라지지 않았으므로 내용을 바꿀 이유가 없다.
- **그 절이 답하던 질문에 계약이 여전히 답해야 한다** — "재가 뒤 남는 대리 결정 파일을 무엇이 어떻게
  취급하는가"(R4 둘째 항목). 불릿 하나를 지우면서 그 답이 사라지면 안 된다.

### 새로 감추지 않는다 (R4 셋째 항목)

남은 차이 — 두 분기가 `outcome` 값 목록을 보지 않는 것 — 를 계약이 새로 감추지 않는다. **계약이 그
차이를 원래 적지 않았으므로 새로 적을 필요도 없다.** 적기로 판단한다면 사실만 적는다. 그 차이를
없애는 것은 기획서 제외 범위다.

### 버전 축 (R5)

- `WORKFLOW_RULES_VERSION`과 본문 `rules_version`을 **착수 시점 값에서 정확히 +1**로, 같은 값으로
  올린다. 둘이 어긋나면 검증이 잡는다.
- **고정값을 가정하지 않는다.** 분해 시점 값은 8이지만 상수(8)와 설치본(7)이 어긋나 있고 미착지
  작업이 `qa_waiting`으로 대기 중이라 착수 시점 값이 또 다를 수 있다(확인 사실 8). **착수 시점에
  읽은 값을 보고서에 적고 +1을 적용한다.** TASK-088이 세운 선례다.
- 설치·검증 경로는 상수를 읽으므로 코드 변경이 필요 없다. 그 경로의 기존 테스트가 새 값으로
  통과하는지 확인한다.

## 검증 문구 규칙

이 저장소는 여러 세션의 미커밋 변경이 한 작업 트리에 겹쳐 있다. 그래서 **"`git diff`가 비어 있다"를
완료 조건으로 쓰면 성립하지 않는다.** 무변경은 파일·심볼 단위로 확인한다 — 어느 상수·본문·단언이
착수 시점과 같은 값인지 직접 읽어 보고서에 남긴다.

## 완료 조건

1. 확인 사실 7의 불릿이 `WORKFLOW_RULES` 본문에서 사라졌다. 검증: 변경 전후 본문을 대조해 보고서에
   적는다. (SPEC-030 완료 조건 8의 앞 절반)
2. 그 절이 문장 단위로 앞뒤가 맞는다. 검증: **앞 문장의 셈("Two judgements ignore it and one does
   not")이 남은 항목 수·성격과 맞는지**를 보고서에 인용해 적는다. (완료 조건 8의 뒤 절반, R4)
3. 그 절이 답하던 질문 — 재가 뒤 남는 대리 결정 파일의 취급 — 에 계약이 여전히 답한다. 검증: 그
   답을 담은 문장을 보고서에 인용한다. (R4 둘째 항목)
4. 남은 차이를 계약이 새로 감추지 않는다. 검증: 그 차이에 관해 계약에 무엇을 적었는지(또는 적지
   않기로 했는지)와 근거를 보고서에 적는다. (R4 셋째 항목)
5. `WORKFLOW_RULES_VERSION`과 본문 `rules_version`이 같은 값이고 착수 시점 값 +1이다. 검증: **착수
   시점 값을 보고서에 적고** 두 값을 대조한다. (완료 조건 7)
6. 규칙 자산의 설치·검증 경로가 새 버전 값으로 동작한다. 검증: 기존 `install_project_instructions`·
   `validate_project_instructions` 테스트가 새 값으로 통과한다. (완료 조건 10의 규칙 자산 절반)
7. 역할 계약 세 파일과 `ROLE_RULES_VERSION`을 고치지 않았다. 검증: 세 본문의 `rules_version`과
   `ROLE_RULES_VERSION`이 착수 시점과 같은 값인지 읽어 보고서에 적고, 그 값을 기대하는 단언이 수정
   없이 통과하는 것을 확인한다.
8. 기존 자동 테스트가 삭제되거나 비활성화되지 않았다(`#[ignore]` 신규 0건). (완료 조건 13)
9. `project_instructions.rs`를 범위에 올린 작업이 이번 분해에서 이 하나뿐이다. 검증: SPEC-030 파생
   작업 둘의 범위 목록을 보고서에 적는다. (완료 조건 14)
10. `cargo test --manifest-path src-tauri/Cargo.toml`과 `npm run check`가 통과한다. **확인 사실 13의
    타 세션 위반(`heartbeat_status.rs` fmt 1건, `heartbeat_process.rs:216` clippy 1건)이 남아 있으면
    그것과 이 작업이 만든 결과를 구분해 적는다.** (완료 조건 15)

## 범위 밖

- **판정 구현.** TASK-097이 한다. 이 작업에 `heartbeat_condition.rs`·`role_eligibility.rs` 변경분은
  없다. `CONDITION_SCRIPT_VERSION`도 이 작업이 만지지 않는다.
- 대리 결정의 형식 요건·재가 절차 본문 자체. SPEC-028/TASK-088이 착지시킨 문언이고, 이 기획서는 그
  계약이 남긴 임시 문장 하나만 걷어낸다.
- 세 역할 계약 문서의 자격 조건 재작성과 `ROLE_RULES_VERSION` 인상.
- 두 분기가 `outcome` 값 목록을 보지 않는 차이를 없애는 일. 기획서 제외 범위다.
- 이미 기록된 결정 문서의 소급 정리. 확인 사실 10대로 대상이 0건이다.
- `AGENTS.md`·`CLAUDE.md`의 관리 블록. 이 작업이 고치는 것은 규칙 자산 본문이다.
- 설치본 `.workflow/rules/workflow.md`의 직접 수정. 앱 설치 경로의 산출물이다.
