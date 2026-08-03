# TASK-022 개발자 핸드오프

- 대상 작업: TASK-022 (개발 작업 전이 이력 계약을 정의하고 규칙 자산에 반영한다)
- 근거 문서: SPEC-007 R2·R3, DECISION-AA40AF4B (approved, created_by: user)
- 세션 역할: 개발자
- 작성 시각: 2026-08-02T18:30Z
- 상태: `qa_waiting`

## 대상 선정 근거

- 착수 시점 `todo`는 TASK-018~027 열 건이다. 이 중 선행 필수를 전혀 걸지 않은 것은 TASK-022와
  TASK-026 둘뿐이고, 나머지 여덟 건은 선행이 `todo`이거나 `qa_waiting`이다.
- TASK-018·019~021은 선행 필수(TASK-014·016·017 / SPEC-005 네 건)가 아직 `qa_waiting`이다. 구현은
  코드에 있지만 사용자 QA를 거치지 않아 반려 시 재작업 대상이 된다. 선행이 하나도 없는 대상이 열려
  있는 상황에서 그 위험을 얹을 이유가 없어 골라내지 않았다.
- TASK-026도 조건상 열려 있으나 작업 문서가 "`useProjectWorkspace.ts`·`types.ts`에 커밋되지 않은 연동
  작업 변경이 올라와 있으니 착수 전 작업 트리를 확인하라"고 적어 두었고, 실제로 두 파일 모두 수정
  상태다. TASK-022는 백엔드 파일 중심이라 겹침이 더 적다. 두 대상 중 ID가 앞선 쪽을 골랐다.
- 병행 금지 대상은 TASK-023 하나이고 `todo` 상태로 아무도 잡고 있지 않다.
- 착수 시점에 `.workflow/.runtime/migration.lock` 없음, `leases/` 비어 있음. 배타 생성으로
  `leases/TASK-022.yml`을 만든 뒤 문서를 `in_progress`로 옮기고 시작했다.
- SPEC-007 본문은 `status: user_review`지만 앱이 기록한 승인 결정(DECISION-AA40AF4B)이 있으므로 공통
  규칙 5절의 구현 차단 조건에 걸리지 않는다.

## 결과

개발 작업 프론트매터에 상태 전이 사실을 남기는 `history` 필드가 계약으로 정의되고, 앱이 그것을 읽어
요약(`WorkflowItemSummary.events`)에 실어 보내며, 앱이 설치하는 공통 규칙과 아키텍트·개발자 계약에
기록 의무가 적혔다.

읽기는 전부 관대하다. `history`가 없거나, 시퀀스가 아니거나, 항목의 `at`·`kind`가 계약과 어긋나도
문서 읽기는 성공하고 그 항목만 빠진다. `read_markdown_summaries`가 `Err`인 문서를 통째로 건너뛰기
때문에, 이력 파싱 실패를 오류로 만들면 작업이 목록에서 사라진다. 그 경로를 만들지 않았다.

쓰기는 이 작업 범위가 아니다. 앱이 QA 시점에 이력을 남기는 경로와 QA 결정 문서를 이벤트 원천으로 읽는
경로는 TASK-023이고, 화면은 손대지 않았다.

## 변경한 파일

| 파일 | 내용 |
| --- | --- |
| `docs/file-contract.md` | 개발 작업 절에 `history` 계약 추가, 예시 프론트매터에 두 항목 |
| `src-tauri/src/domain/project.rs` | `TaskEvent` 타입 추가, `WorkflowItemSummary`에 `events` |
| `src-tauri/src/infrastructure/fs_project_repository.rs` | `TASK_EVENT_KINDS` 상수, `read_task_events`, `read_markdown_document` 배선, 테스트 6건 |
| `src-tauri/src/infrastructure/project_instructions.rs` | 공통 규칙 5·6절, 아키텍트·개발자 Completion, 버전 상수 2개와 네 호출부, 테스트 3건 추가·기존 1건 갱신 |
| `src/features/projects/domain/types.ts` | `TaskEvent` 타입과 `events?` 필드 |
| `.workflow/…/tasks/TASK-022.md` | `todo` → `in_progress` → `qa_waiting` |
| `.workflow/…/reports/REPORT-TASK-022-DEV.md` | 신규 |
| `.workflow/.runtime/leases/TASK-022.yml` | 선점 후 반납 |

작업 문서의 범위 목록 밖은 손대지 않았다. `DevelopmentBoard.tsx`와 `App.css`는 그대로다.
`fs_project_repository.rs`의 워크플로우 README 템플릿도 고치지 않았다 — 작업 문서가 지목한 규칙 자산은
`project_instructions.rs`의 문자열 상수 넷뿐이다.

## 설계 판단

- **`kind` 검사를 상수 배열로 두었다.** `TASK_EVENT_KINDS` 여섯 값이 계약이고, 파서·문서·규칙 자산이
  같은 여섯 값을 말한다. 열거형으로 만들지 않은 것은 `at`을 원문 문자열로 실어 보내는 것과 같은 이유다
  — 앱은 파일에 적힌 것을 전달할 뿐이고, 도메인 타입을 늘리면 직렬화 이름과 파일 표기를 따로 관리해야
  한다. `HeartbeatJobRun.at`이 이미 같은 선례다.
- **`at`은 원문 그대로 담고 파싱은 검사와 정렬에만 쓴다.** `2026-07-30T09:00:00+00:00`이 `...Z`로
  바뀌지 않는다. 테스트가 이 성질을 고정한다.
- **정렬은 `sort_by`(안정 정렬)다.** 같은 시각의 항목이 둘이면 파일에 적힌 순서가 유지된다. 화면이 다시
  정렬하지 않아도 되도록 저장소가 오름차순으로 넘긴다.
- **`events`는 `Vec`이지 `Option<Vec>`이 아니다.** 아이디어·기획서 요약에서는 항상 빈 목록이다. 파싱을
  문서 종류로 가르지 않은 것은 `due_at`이 개발 작업 전용인데도 같은 타입에 있고 모든 문서에서 읽히는
  현행과 같은 선례다. 이력이 없는 것과 이력이 비어 있는 것을 구별할 이유가 이 기획서에는 없다.
- **TypeScript 쪽은 `events?`로 선택 필드다.** `dueAt?: string | null`과 같은 선례이고, 이렇게 두면
  기존 테스트 픽스처를 한 줄도 고치지 않아도 된다. 실제로 프론트엔드 테스트는 수정 없이 통과했다.
- **버전 숫자를 상수 둘로 모았다.** `WORKFLOW_RULES_VERSION`(4)·`ROLE_RULES_VERSION`(3)이 네 호출부
  (`install`·`validate` × 공통·역할)에서 쓰인다. 리터럴이 흩어져 있으면 하나만 놓쳤을 때
  `validate_project_instructions`가 방금 설치한 파일을 "미래 버전"으로 보고 `create_workflow`를 막는다.
  `validates_the_instructions_it_just_installed`가 그 경우를 잡는다.
- **`ROLE_RULES_VERSION`은 역할 계약 셋의 최댓값 3이다.** 기획자 계약은 내용이 바뀌지 않아 2로 남는다.
  `plan_rules_file`은 파일 버전이 인자보다 **클** 때만 거부하므로 2인 파일이 3으로 검사돼도 통과하고,
  내용이 `expected`와 같으므로 다시 쓰지도 않는다.
- **`ROLE_RULES_SCHEMA` 상수도 함께 만들었다.** 역할 스키마 문자열이 같은 두 호출부에 리터럴로 있었고,
  버전 인자를 상수화하면서 같은 자리를 두 번 고치게 되어 함께 정리했다. 값은 그대로다.
- **규칙 본문에 여섯 `kind`의 뜻을 다 적었다.** 에이전트가 규칙 파일만 읽고 항목을 쓸 수 있어야 한다.
  `completed`·`revision_requested`는 앱이 남기므로 에이전트가 쓰지 않는다는 것도 명시했다.
- **`due_at` 설명의 "캘린더뷰는 이 값을 기준으로 배치하고" 문장은 고치지 않았다.** 화면이 아직 안
  바뀌었는데 문서만 먼저 바꾸면 그 사이 저장소가 거짓을 적어 두게 된다. 작업 문서가 TASK-024로 넘겨
  두었다.

## 완료 조건 대조

| # | 조건 | 결과 |
| --- | --- | --- |
| 1 | 계약에 전이 기록이 정의되고 R2의 여섯 시점을 표현할 수 있다 | 충족. `docs/file-contract.md` 개발 작업 절 + 공통 규칙 5절, 여섯 `kind` |
| 2 | 이력 없는 기존 문서가 유효하고 알 수 없는 필드가 보존된다 | 충족. `treats_a_task_without_history_as_having_no_events`(`owner:` 필드 포함) |
| 3 | 깨진 항목이 있어도 읽기가 실패하지 않고 정상 항목만 남는다 | 충족. `drops_only_the_damaged_history_entries`(5가지 손상), `treats_a_non_sequence_history_as_empty_without_failing_the_read` |
| 4 | 규칙 자산에 기록 의무가 반영되고 버전 표기가 오른다 | 충족. `records_the_transition_history_obligation_in_the_installed_rules` |
| 5 | 옛 버전 규칙이 설치된 프로젝트가 갱신을 받는다 | 충족. `upgrades_rules_installed_before_the_transition_history_contract`(공통 3·역할 2 → 4·3) |
| 6 | 화면 동작이 바뀌지 않고 기존 프론트엔드 테스트가 수정 없이 통과한다 | 충족. 프론트엔드 테스트 파일 무수정, 112건 통과 |
| 7 | `npm run check`·`cargo fmt`·`clippy -D warnings`·`cargo test` 통과 | 충족 |

SPEC-007 완료 조건 5(추가 전용, 같은 전이 두 번)는 읽기 쪽만 이 작업에서 덮었다
(`keeps_repeated_transitions_after_qa_rework`). 쓰기 쪽 보장은 TASK-023이다.

## 검증 단계와 결과

```sh
npm run check
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

- `cargo test` — 136 passed / 0 failed (신규 9: 저장소 6, 규칙 자산 3).
- 착수 전 베이스라인은 따로 돌리지 못했다. 작업 트리에 커밋되지 않은 SPEC-005·006 변경이 걸쳐 있어
  이 세션 파일만 되돌리면 `domain/project.rs`에 의존하는 하트비트 변경이 컴파일되지 않는다. 대신
  직전 세션 기록(REPORT-TASK-017-DEV)의 127 passed / 0 failed와 대조했고, 이번 신규 9건을 더한
  136과 일치한다.
- `npm run check` (typecheck + vitest + vite build) — 112 passed / 0 failed, 빌드 성공. 프론트엔드
  테스트 파일은 한 줄도 고치지 않았다.
- `cargo fmt -- --check` 차이 없음. `cargo clippy --all-targets -- -D warnings` 경고 없음.
- 삭제하거나 비활성화한 테스트 없음. 기존 단언 1건만 고쳤다 —
  `upgrades_managed_v1_rules_and_installs_role_contracts`의 `rules_version: 3` → `4`. 버전이 오른
  것을 확인하는 단언이므로 케이스와 검사 대상은 그대로다.
- 전역 파일 무쓰기: 백엔드 테스트는 전부 임시 디렉터리에서 돈다. 이 저장소의
  `.workflow/rules/workflow.md`·`roles/*.md`도 세션 중 바뀌지 않았다(앱이 승인·QA를 기록할 때 갱신된다).

## 사용자 QA 절차

앱을 띄워야 확인되는 항목이다. 이 저장소의 워크플로우 문서를 만지므로 확인 후 원복한다.

```sh
# 1) 이력 읽기 — 임시 작업 문서를 하나 만든다
cat > '.workflow/도그푸딩--wf_ae6cd700/tasks/TASK-999.md' <<'EOF'
---
schema: workflow-labs/task@1
id: TASK-999
title: 이력 확인용 임시 작업
status: qa_waiting
updated_at: 2026-08-02T18:00:00Z
owner: 확인용
history:
  - { at: 2026-08-02T14:00:00Z, kind: qa_waiting }
  - { at: 2026-08-02T09:00:00Z, kind: created }
  - { at: 어제, kind: blocked }
---

임시 작업이다. 확인 후 지운다.
EOF
# 2) 앱에서 프로젝트를 새로고침한다
#    → TASK-999가 목록에 정상으로 보여야 한다(깨진 항목 때문에 사라지지 않는다)
#    → `owner: 확인용`이 파일에 그대로 남아 있어야 한다
#    → 이 작업은 화면 표시를 바꾸지 않으므로 이력 자체는 아직 화면에 나오지 않는다(TASK-024)
rm '.workflow/도그푸딩--wf_ae6cd700/tasks/TASK-999.md'

# 3) 규칙 자산 갱신 — 현재 설치된 버전을 확인한다
grep -n 'rules_version' .workflow/rules/workflow.md .workflow/rules/roles/*.md
#    지금은 공통 3, 역할 전부 2다.
# 4) 앱에서 아무 기획서 결정이나 작업 QA를 하나 기록한다(승인·확인 무엇이든)
# 5) 같은 grep을 다시 실행한다
#    → workflow.md가 4, architect.md·developer.md가 3, planner.md가 2여야 한다
grep -n 'history' .workflow/rules/workflow.md .workflow/rules/roles/developer.md
#    → 공통 규칙 5절에 "Record every task transition"과 여섯 kind가 있어야 한다
#    → 개발자 계약 Completion에 in_progress·blocked·qa_waiting 기록 의무가 있어야 한다
```

4번을 실행하면 이 저장소의 `.workflow/rules/*`가 실제로 갱신된다. 이후 역할 세션은 새 계약을 읽는다.
원복이 필요하면 `git checkout .workflow/rules/`로 되돌린다.

## 다음 작업자에게

- 다음은 TASK-023(앱이 QA 전이를 기록하고 QA 결정을 이벤트 원천으로 병합한다)이다. 이 작업이 만든
  `TaskEvent` 타입과 `read_task_events`, `TASK_EVENT_KINDS` 상수를 그대로 쓴다.
- `update_task_frontmatter`가 `status`와 `updated_at`만 바꾸고 나머지 줄을 그대로 두는 현행 동작 위에
  줄 덧붙이기를 얹으면 된다. 항목을 한 줄 흐름 표기로 못박은 것이 그 구현을 위한 것이다.
- 파서는 블록 표기 항목도 읽는다(`reads_block_style_history_and_keeps_the_recorded_offset`). 손으로
  블록 표기로 쓴 문서를 앱이 못 읽는 일은 없다.
- 중복 제거(SPEC-007 R4의 "같은 사실이 양쪽에 있을 때 두 번 그려지지 않는다")는 이 작업 범위 밖이다.
  파서는 `history`에 같은 `kind`·`at`이 두 번 있으면 두 항목 다 돌려준다.

## 후속 / 리스크

- **TASK-022 자신의 문서에 `history`를 채우지 않았다.** 이 세션이 따른 개발자 계약은 지금 설치된
  `rules_version: 2`이고 그 계약에는 기록 의무가 없다. 새 계약은 앱이 다음 승인·QA를 기록할 때
  설치된다. 작업 문서도 기존 21건의 소급 채움을 제외 범위로 못박았다. 그래서 이 저장소의 작업 문서는
  당분간 이력이 하나도 없고, TASK-024의 캘린더는 QA 결정에서 파생한 완료·반려 이벤트만으로 채워진다.
  SPEC-007 완료 조건 13("기록이 없어 표시되지 않는 작업"의 존재 알림)이 실제로 필요한 이유다.
- **규칙 자산 갱신 시점이 사용자 행위에 묶여 있다.** `install_project_instructions`의 호출처는
  `create_workflow`·`record_spec_decision`·`record_task_qa` 셋뿐이다. 사용자가 앱에서 결정이나 QA를
  한 번 기록하기 전까지 이 저장소의 `.workflow/rules/*`는 옛 버전으로 남고, 그 사이의 역할 세션은
  이력을 남기지 않는다. 새 경로를 만들지 말라는 것이 작업 문서의 제약이라 그대로 두었다.
- **`kind` 검사가 문자열 비교다.** 도메인 타입이 아니라 상수 배열이므로, 나중에 값이 늘면 파서·문서·
  규칙 자산 세 곳을 함께 고쳐야 한다. 지금은 여섯 값이 고정이고 기획서가 그 이상을 요구하지 않는다.
- **`at`이 미래 시각이거나 순서가 뒤죽박죽인 것을 막지 않는다.** 파서는 RFC3339로 읽히면 받아들이고
  정렬만 한다. 파일에 적힌 것을 사실로 본다는 원칙 그대로이고, 기획서도 검증을 요구하지 않는다.
- 역할 밖 발견 (수정하지 않음):
  - 작업 트리에 이 작업 이전부터 커밋되지 않은 변경(SPEC-005·006 산출물)이 있다. 이 세션은 위 표의
    파일만 건드렸다. `domain/project.rs`와 `types.ts`는 그 변경과 같은 파일이지만 건드린 구간이
    겹치지 않는다(하트비트 영역 vs 워크플로우 요약 영역).
  - `heartbeat_roles.rs`·`heartbeat_status.rs` 첫머리의 `#![allow(dead_code)]` 주석이 실제와 어긋난
    채 그대로다. REPORT-TASK-014~017-DEV가 이미 적었다.
