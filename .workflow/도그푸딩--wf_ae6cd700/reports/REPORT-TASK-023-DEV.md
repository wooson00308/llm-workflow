# TASK-023 개발자 핸드오프

- 대상 작업: TASK-023 (앱이 QA 전이를 기록하고 QA 결정을 이벤트 원천으로 병합한다)
- 근거 문서: SPEC-007 R2(앱 기록 부분)·R4·R5(백엔드 부분), DECISION-AA40AF4B (approved, created_by: user)
- 세션 역할: 개발자
- 작성 시각: 2026-08-03T00:15Z
- 상태: `qa_waiting`

## 대상 선정 근거

- 착수 시점 `todo`는 TASK-023·024·025·027 네 건이다.
- TASK-024는 선행 필수 TASK-023이 `todo`, TASK-025는 선행 필수 TASK-024가 `todo`라 둘 다 열려 있지
  않다. 남는 후보는 TASK-023과 TASK-027이다.
- TASK-027은 선행 TASK-026이 `qa_waiting`이라 조건상 열려 있다. 두 후보 중 TASK-023을 골랐다.
  TASK-023이 끝나야 TASK-024·025 두 건이 함께 열리고, TASK-027은 그 사이에도 계속 열려 있다.
  선행 사슬을 먼저 푸는 쪽이 다음 세션의 선택지를 넓힌다.
- 병행 금지 대상은 TASK-022 하나이고 `qa_waiting`이라 아무도 잡고 있지 않다.
- 착수 시점에 `.workflow/.runtime/migration.lock` 없음, `leases/` 비어 있음. 배타 생성으로
  `leases/TASK-023.yml`을 만든 뒤 문서를 `in_progress`로 옮기고 시작했다.
- SPEC-007 본문은 `status: user_review`지만 앱이 기록한 승인 결정(DECISION-AA40AF4B)이 있으므로 공통
  규칙 5절의 구현 차단 조건에 걸리지 않는다.

## 결과

앱이 QA를 기록할 때 작업 문서에 전이 항목을 한 줄 덧붙인다. 확인은 `kind: completed`, 반려는
`kind: revision_requested`이고, 그 `at`은 같이 만들어지는 QA 결정 문서의 `created_at`과 **같은 문자열**
이다. 두 원천이 같은 사실을 가리킨다는 것이 문자열 수준에서 드러난다.

`inspect`는 `decisions/`를 한 번 더 훑어 `workflow-labs/qa-decision@1` 문서를 완료·반려 이벤트로 읽고,
작업 문서의 이력과 합쳐 한 타임라인으로 넘긴다. 겹치는 사실은 한 번만 남고, 남기는 쪽은 작업 문서의
항목이다.

읽기는 전부 관대하다. 형식이 깨진 결정 문서, 스키마가 다른 문서, `created_by`가 `user`가 아닌 문서,
필수 필드가 없는 문서, 없는 작업을 가리키는 문서는 그 파일만 건너뛰고 조회 전체는 성공한다. 쓰기도
QA 기록을 막지 않는다 — `append_task_history`는 실패하지 않고, 남기지 못하는 경우에도 완료·반려 사실은
결정 문서에 남는다.

화면은 손대지 않았다. 캘린더는 TASK-024·025다.

## 변경한 파일

| 파일 | 내용 |
| --- | --- |
| `src-tauri/src/infrastructure/fs_project_repository.rs` | `record_task_qa`에 `event_kind` 분기, `update_task_frontmatter`에 인자 추가, `append_task_history`·`leading_whitespace`·`qa_decision_events`·`merge_qa_decision_events`·`parse_event_instant` 신설, `workflow_items` 배선, 테스트 10건 |
| `.workflow/…/tasks/TASK-023.md` | `todo` → `in_progress` → `qa_waiting`, `history` 항목 |
| `.workflow/…/reports/REPORT-TASK-023-DEV.md` | 신규 |
| `.workflow/.runtime/leases/TASK-023.yml` | 선점 후 반납 |

작업 문서의 범위대로 `fs_project_repository.rs` 한 파일만 만졌다. 화면·타입·규칙 자산·문서는 그대로다.
`latest_spec_decisions`도 한 줄도 고치지 않았다.

## 설계 판단

- **이력 삽입을 `append_task_history`로 떼어 냈다.** `update_task_frontmatter`의 기존 루프는
  `status`·`updated_at`만 치환하는 단순한 형태다. 그 안에 삽입 위치 계산을 섞으면 두 관심사가 엉킨다.
  치환이 끝난 줄 목록을 받아 한 줄 넣는 함수로 분리했다.
- **삽입 위치를 "블록 끝"으로 잡는다.** `history:` 다음 줄부터 들여쓰기(공백·탭)로 시작하는 줄이
  이어지는 동안 훑어 내려가고 그 바로 뒤에 넣는다. `updated_at`이 없어 목록 끝에 덧붙여진 경우,
  덧붙은 `updated_at:` 줄은 들여쓰기가 없으므로 블록 끝 판정에 걸리고 새 항목이 그 앞에 들어간다.
  결과 YAML은 여전히 올바르다.
- **들여쓰기는 기존 첫 항목을 따른다.** 블록이 비어 있으면 공백 두 칸이다. 손으로 네 칸을 쓴 문서에
  두 칸 항목을 섞어 넣지 않는다.
- **인라인 표기(`history: []`)에서는 이력을 넘긴다.** 계약이 금지한 표기이고, 줄을 이어 붙이면 문서가
  깨진다. 코드 주석에 이 한계와 결정 문서가 사실을 보존한다는 근거를 남겼다.
  `skips_history_when_the_field_uses_an_inline_form`이 이 동작을 못 박는다.
- **QA 스캔을 `latest_spec_decisions`와 합치지 않았다.** 두 함수가 같은 디렉터리를 두 번 훑는다.
  작업 문서가 그 리팩터링을 제외 범위로 못박았고, `latest_spec_decisions`는 "기획서별 최신 하나"를,
  새 함수는 "작업별 전부"를 모으므로 누적 형태도 다르다. 한 순회로 합치면 두 결과 타입을 동시에
  들고 다녀야 한다.
- **QA 이벤트도 `created_at`이 RFC3339로 읽히지 않으면 버린다.** 작업 문서가 명시한 것은 필드 존재
  여부지만, 병합 키와 정렬이 파싱한 순간을 쓰므로 파싱되지 않는 값은 타임라인에 놓을 자리가 없다.
  `read_task_events`가 이미 같은 기준으로 항목을 버린다. 두 원천이 같은 기준을 쓴다.
- **중복 판정 키는 `(kind, DateTime<Utc>)`다.** 이 저장소의 실제 QA 결정 13건은 `Z` 표기 6건과
  `+00:00` 표기 7건이 섞여 있다(`QA-281353DF`는 `2026-08-02T14:57:41Z`, `QA-080A79AF`는
  `2026-08-02T04:37:59.588232+00:00`). 문자열로 비교했으면 같은 순간이 두 번 그려진다.
  `FixedOffset` 그대로 두지 않고 `Utc`로 옮긴 것은 해시·동등성이 오프셋과 무관함을 코드에서
  드러내기 위해서다.
- **남기는 쪽은 작업 문서의 항목이다.** `at`이 파일에 적힌 원문 그대로 화면에 간다. 결정 문서 쪽
  표기로 덮어쓰지 않는다. TASK-022가 세운 "앱은 파일에 적힌 것을 전달할 뿐" 원칙 그대로다.
- **`decisions.get`이지 `remove`가 아니다.** 같은 `id`를 가진 작업 문서가 둘 있어도(파일명이 다르면
  가능하다) 둘 다 이벤트를 받는다. `remove`면 뒤쪽 하나가 조용히 빈다.
- **병합을 `workflow_items` 안에 두었다.** `read_task`가 돌려주는 상세 요약에는 병합을 걸지 않았다.
  작업 문서가 지목한 자리가 `workflow_items`이고, 완료 조건 4가 말하는 화면 경로는 `inspect`다.
- **`merge_qa_decision_events`는 결정이 하나도 없으면 바로 돌아온다.** 작업마다 `seen` 집합을 만드는
  비용을 결정 문서가 없는 워크플로우에서 물지 않는다.

## 완료 조건 대조

| # | 조건 | 결과 |
| --- | --- | --- |
| 1 | QA 확인·반려 시 앱이 전이 항목을 남긴다 (기획서 9) | 충족. `records_a_confirmed_transition_with_the_qa_decision_time`(`at`이 결정 문서 `created_at`과 동일), `records_a_revision_transition_and_returns_the_task_to_todo` |
| 2 | 전이 기록이 추가 전용, 같은 전이 두 번이면 두 항목 (기획서 5) | 충족. `keeps_every_transition_when_qa_repeats`(반려 2회 + 확인 1회, 씨앗 항목 원문 유지, `revision_requested` 두 번) |
| 3 | 이력 없는 문서·사용자 정의 필드 보존 (기획서 6의 QA 부분) | 충족. `adds_a_history_block_while_preserving_custom_fields`(`custom_field: keep-me`) |
| 4 | QA 결정의 `task_id`·`outcome`·`created_at`을 이벤트로 쓴다 (기획서 10) | 충족. `reads_qa_decisions_as_events_for_tasks_without_history` |
| 5 | 깨진 결정 문서·없는 작업을 가리키는 기록이 있어도 조회가 정상 (기획서 11) | 충족. `ignores_qa_decisions_that_are_damaged_or_point_nowhere`(6종 혼합) |
| 6 | 같은 사실이 두 원천에 있어도 한 번만 (기획서 12) | 충족. `merges_the_same_fact_from_both_sources_only_once`(`Z` vs `+00:00`) |
| 7 | 파일에 없는 시각을 추정으로 채우지 않는다 (기획서 14) | 충족. `leaves_events_empty_when_only_updated_at_is_recorded` |
| 8 | 결정 문서를 만들거나 고치지 않고 기존 결정 테스트가 무수정 통과 | 충족. `qa_decision_events`는 읽기만 한다. 기존 결정 테스트 4건 무수정 통과 |
| 9 | `npm run check`·`cargo fmt`·`clippy -D warnings`·`cargo test` 통과 (기획서 23) | 충족 |

추가로 `keeps_history_entries_out_of_the_status_and_updated_at_substitution`이 작업 문서가 요구한
"이력 항목 안의 값이 `status`·`updated_at` 치환에 걸리지 않는다"를 못 박는다. 프론트매터 중간에
이력 블록이 있는 문서로 QA를 기록해도 씨앗 항목 두 줄이 그대로 남고, 최상위 `status:`·`updated_at:`
줄은 각각 하나씩만 남는다.

## 검증 단계와 결과

```sh
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
npm run check
```

- `cargo test` — 151 passed / 0 failed. 직전 세션 기록(REPORT-TASK-022-DEV)의 136에 이번 신규 10건과
  그 사이 TASK-026 세션의 5건을 더한 수와 맞는다.
- `cargo fmt -- --check` 차이 없음. `cargo clippy --all-targets -- -D warnings` 경고 없음.
- `npm run check` (typecheck + vitest + vite build) — 165 passed / 0 failed, 빌드 성공. 프론트엔드
  파일은 한 줄도 고치지 않았다.
- 삭제하거나 비활성화하거나 단언을 약화한 테스트 없음. 기존 테스트는 한 건도 수정하지 않았다.
  `update_task_frontmatter`의 인자가 하나 늘었지만 호출부가 `record_task_qa` 하나뿐이라 기존 테스트가
  영향을 받지 않았다.
- 백엔드 테스트는 전부 임시 디렉터리에서 돈다. 이 저장소의 `.workflow/` 문서는 이 세션이 명시적으로
  건드린 셋(작업 문서, 이 보고서, lease) 말고는 바뀌지 않았다.
- 실제 데이터 가정 확인(읽기만): 이 저장소의 QA 결정 13건은 전부
  `schema: workflow-labs/qa-decision@1` / `created_by: user`이고 `task_id`·`outcome`·`created_at`이
  모두 있으며 `outcome`은 전부 `confirmed`다. 표기는 `Z` 6건 / `+00:00` 7건으로 섞여 있다.

## 사용자 QA 절차

앱을 띄워야 확인되는 항목이다. 이 저장소의 워크플로우 문서를 실제로 바꾸므로 확인 후 원복한다.

```sh
# 0) 현재 상태 — 작업 문서에 history가 있는 것은 TASK-023 하나뿐이다
grep -l 'history:' '.workflow/도그푸딩--wf_ae6cd700/tasks/'*.md

# 1) 병합 확인 (읽기만) — 앱을 띄워 프로젝트를 연다
#    → 개발 작업 목록이 정상으로 나와야 한다(결정 문서 스캔이 추가돼도 조회가 깨지지 않는다)
#    → TASK-001~013은 QA 결정에서 파생한 완료 이벤트를 갖는다. 이 작업은 화면 표시를 바꾸지
#      않으므로 이벤트 자체는 아직 눈에 보이지 않는다(TASK-024·025).

# 2) 확인 전이 기록 — qa_waiting 작업 하나를 골라 앱에서 "확인 완료"를 누른다
#    (TASK-014~022, 026 중 아무거나. 아래는 TASK-014 예시)
grep -n 'history' '.workflow/도그푸딩--wf_ae6cd700/tasks/TASK-014.md'
#    → `history:` 줄과 `  - { at: …, kind: completed }` 한 줄이 새로 생겨야 한다
ls -t '.workflow/도그푸딩--wf_ae6cd700/decisions/'QA-*.md | head -1 | xargs grep -n 'created_at'
#    → 위 항목의 at과 이 created_at이 같은 문자열이어야 한다
#    → 그 작업의 기존 프론트매터 필드(source_spec_id 등)가 전부 남아 있어야 한다

# 3) 반려 전이 기록 — 다른 qa_waiting 작업에서 "수정 요청"을 누른다
grep -n -A2 'history' '.workflow/도그푸딩--wf_ae6cd700/tasks/TASK-015.md'
#    → `  - { at: …, kind: revision_requested }`가 생기고 status가 todo여야 한다

# 4) 원복
git checkout '.workflow/도그푸딩--wf_ae6cd700/tasks/'
git status --short '.workflow/도그푸딩--wf_ae6cd700/decisions/'
#    → 2·3번이 만든 QA-*.md를 지운다
```

2번을 실행하면 그 작업이 실제로 `completed`가 되고 3번은 `todo`로 돌아간다. 확인용으로 고른 작업의
상태를 원복하려면 4번의 `git checkout`을 쓴다.

## 다음 작업자에게

- 다음은 TASK-024(캘린더를 전이 사실 타임라인으로)다. 이 작업으로 `WorkflowItemSummary.events`가
  실제로 채워지므로 그리드가 비지 않는다. 다만 채워지는 것은 **QA 결정에서 파생한 완료 이벤트
  13건**이 대부분이고, 작업 문서 자체의 이력은 이 세션이 남긴 TASK-023의 두 줄뿐이다.
- 이벤트는 저장소가 시각 오름차순으로 정렬해 넘긴다. 화면이 다시 정렬할 필요는 없다.
- `at`은 파일 원문 문자열이라 `Z`와 `+00:00`이 섞여 온다. 화면에서 날짜로 바꿀 때 두 표기를 모두
  다뤄야 한다. `DateTime::parse_from_rfc3339`가 백엔드에서 쓴 기준이다.
- 이벤트가 하나도 없는 작업이 여전히 다수다(TASK-014~022, 026 등 `qa_waiting` 상태 것들). SPEC-007
  완료 조건 13의 "기록이 없어 표시되지 않는 작업" 알림이 TASK-025에서 실제로 필요하다.

## 후속 / 리스크

- **작업 문서에 이력을 남기는 주체가 앱과 역할 세션 둘로 나뉜다.** 앱은 `completed`·
  `revision_requested`만 쓰고, `created`·`in_progress`·`blocked`·`qa_waiting`은 역할 세션의 몫이다
  (결정 2번). 역할 세션이 빠뜨리면 그 전이는 어디에도 기록되지 않는다. 이 세션은 자기 문서에
  `in_progress`·`qa_waiting` 두 줄을 남겼다.
- **`decisions/`를 매 `inspect`마다 두 번 훑는다.** 화면이 2.5초마다 조회하므로 결정 문서가 크게
  늘면 비용이 보일 수 있다. 지금은 20건이라 문제가 되지 않고, 한 순회로 합치는 리팩터링은 작업
  문서의 제외 범위다.
- **인라인 `history: []`가 적힌 문서는 이력을 못 받는다.** 조용히 넘어가고 사용자에게 알리지 않는다.
  계약이 금지한 표기이고 완료·반려 사실은 결정 문서에 남지만, 손으로 그렇게 쓴 문서가 생기면
  타임라인에 작업 문서 쪽 항목이 하나도 안 생긴다.
- **기존 21건에 이력을 소급해 채우지 않았다.** 작업 문서의 제외 범위다.
- 역할 밖 발견 (수정하지 않음):
  - 작업 트리에 이 작업 이전부터 커밋되지 않은 변경(SPEC-005·006·007·008 산출물)이 걸쳐 있다.
    이 세션은 위 표의 파일만 건드렸다.
  - `heartbeat_roles.rs`·`heartbeat_status.rs` 첫머리의 `#![allow(dead_code)]` 주석이 실제와 어긋난
    채 그대로다. REPORT-TASK-014~017·022-DEV가 이미 적었다.
  - `docs/file-contract.md`의 `due_at` 설명에 아직 "캘린더뷰는 이 값을 기준으로 배치하고"가 남아
    있다. TASK-024의 범위다.
