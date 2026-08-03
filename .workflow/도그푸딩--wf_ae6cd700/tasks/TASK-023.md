---
schema: workflow-labs/task@1
id: TASK-023
title: 앱이 QA 전이를 기록하고 QA 결정을 이벤트 원천으로 병합한다
status: completed
source_spec_id: SPEC-007
source_decision_id: DECISION-AA40AF4B
updated_at: 2026-08-03T02:31:15.929926+00:00
history:
  - { at: 2026-08-02T23:53:00Z, kind: in_progress }
  - { at: 2026-08-03T00:16:00Z, kind: qa_waiting }
  - { at: 2026-08-03T02:31:15.929926+00:00, kind: completed }
---

# 앱이 QA 전이를 기록하고 QA 결정을 이벤트 원천으로 병합한다

SPEC-007 R2의 앱 기록 부분, R4 전부, R5의 백엔드 부분을 구현한다. QA 확인·반려 시 앱이 작업 문서에
전이 항목을 덧붙이고, `decisions/QA-*.md`를 읽어 완료·반려 이벤트로 쓰고, 두 원천이 겹치면 한 번만
남긴다.

TASK-022가 정의한 `history` 계약과 `TaskEvent` 타입 위에서 작업한다.

## 의존성

- **선행 필수: TASK-022.** 계약과 읽기 경로, `TaskEvent` 타입이 먼저 있어야 한다.
- TASK-022와 병행 금지. 같은 파일을 만진다.

## 범위

- `src-tauri/src/infrastructure/fs_project_repository.rs` — `update_task_frontmatter`의 이력 추가,
  QA 결정 스캔, 병합·중복 제거.
- 그 외 파일은 건드리지 않는다. 화면·타입·규칙 자산은 이 작업에서 바뀌지 않는다.

## 작업 내용

### 0. 먼저 읽을 제약

- 결정 문서 읽기는 읽기 전용이다(R4). 타임라인을 위해 결정 문서를 만들거나 고치지 않는다.
- 파일에 없는 시각을 만들지 않는다(R5). `updated_at`을 완료 시각의 대체로 쓰지 않는다.
- QA 기록은 사용자의 주 동선이다. 이력 추가가 실패해도 QA 기록 자체를 실패시키지 않는다. 완료·반려
  사실은 결정 문서에도 남으므로 화면에서 사라지지 않는다. 이 이중 원천이 곧 중복 제거가 필요한 이유다.

### 1. QA 기록 경로가 전이를 남긴다

`record_task_qa`(`:314`)는 이미 `next_status`와 `created_at`을 정해 `update_task_frontmatter`에
넘긴다. 같은 `created_at`으로 이력 항목도 덧붙인다.

- `TaskQaOutcome::Confirmed` → `kind: completed`
- `TaskQaOutcome::RevisionRequested` → `kind: revision_requested`

결정 문서와 작업 이력이 **같은 `created_at` 문자열**을 쓰게 한다. 두 원천이 같은 사실을 가리킨다는
것이 문자열 수준에서도 드러난다.

`update_task_frontmatter`에 추가할 `kind`를 넘기고, 다음 규칙으로 한 줄을 삽입한다.

- 프론트매터에 `history:` 줄이 있고 콜론 뒤가 비어 있으면(블록 헤더), 그 아래로 들여쓰기된 줄이
  이어지는 동안 훑어 내려가 블록 끝 바로 뒤에 한 줄을 넣는다. 들여쓰기는 기존 첫 항목의 들여쓰기를
  따르고, 블록이 비어 있으면 공백 두 칸을 쓴다.
- `history:` 줄이 없으면 프론트매터 끝에 `history:` 줄과 항목 한 줄을 덧붙인다. 지금 `updated_at`이
  없을 때 끝에 덧붙이는 동작(`:724`)과 같은 자리다.
- `history:` 줄의 콜론 뒤에 내용이 있으면(`history: []` 같은 인라인 표기) 이력을 덧붙이지 않고 넘어간다.
  계약이 금지한 표기이고, 이 경우에도 완료·반려 사실은 결정 문서에 남는다. 이 한계를 코드 주석으로
  남긴다.
- 추가하는 줄의 형태는 `  - { at: <created_at>, kind: <kind> }`다.
- 기존 항목은 한 줄도 고치지 않는다. `status`와 `updated_at` 줄만 지금처럼 바꾼다.
- 들여쓰기된 줄은 `line.starts_with("status:")`에 걸리지 않는다. 이력 항목 안의 `kind` 값이
  `status:` 줄로 오인되지 않는지 테스트로 못 박는다.

### 2. QA 결정을 이벤트 원천으로 읽는다

`latest_spec_decisions`(`:951`)와 같은 형태로 `decisions/`를 훑는 함수를 하나 더 만든다.
기존 함수는 고치지 않는다.

- `schema: workflow-labs/qa-decision@1`이고 `created_by: user`인 문서만 쓴다. 나머지는 건너뛴다.
- `task_id`·`outcome`·`created_at`이 모두 있어야 한다. 하나라도 없으면 건너뛴다. 추정하지 않는다.
- `outcome: confirmed` → `kind: completed`, `outcome: revision_requested` → `kind: revision_requested`.
  그 외 값은 건너뛴다.
- 읽기 실패·프론트매터 파싱 실패는 그 파일만 건너뛴다. 전체를 실패시키지 않는다.
- 결과는 `task_id`별 이벤트 목록이다.

### 3. 병합과 중복 제거

`workflow_items`(`:776`)에서 작업 요약을 만든 뒤, 각 작업의 `events`에 그 작업 id를 가리키는 QA
이벤트를 합친다.

- 가리키는 작업이 목록에 없는 QA 이벤트는 버린다. 이것으로 "없는 작업을 가리키는 결정 기록"이 화면에
  도달하지 않는다.
- 중복 판정 키는 `(kind, 파싱한 시각)`이다. 문자열이 아니라 파싱한 순간으로 비교한다. 이 저장소의
  기존 QA 결정은 `created_at: 2026-08-02T04:37:59.588232+00:00` 형태라 `Z` 표기와 문자열로는 다르지만
  같은 순간일 수 있다.
- 같은 키가 이미 있으면 더하지 않는다. 남기는 쪽은 작업 문서의 항목이다(원문 보존).
- 합친 뒤 시각 오름차순으로 다시 정렬한다.

`workflow_items`는 `inspect`마다 불리고 화면은 2.5초마다 조회한다. `decisions/`를 한 번 더 훑는
비용이 늘지만, `latest_spec_decisions`가 이미 같은 디렉터리를 훑고 있으므로 성격이 같은 비용이다.
두 스캔을 하나로 합치는 리팩터링은 하지 않는다. 이 작업의 요구가 아니다.

### 4. 테스트

전부 `fs_project_repository.rs`의 테스트 모듈에 넣는다.

- QA 확인 뒤 작업 파일에 `kind: completed` 항목이 생기고, 그 `at`이 같이 만들어진 QA 결정 문서의
  `created_at`과 같다. (기획서 완료 조건 9)
- QA 반려 뒤 `kind: revision_requested` 항목이 생기고 작업이 `todo`로 돌아간다.
- 반려 → 다시 `qa_waiting` → 확인 시나리오에서 이력 항목이 셋 다 남고, 앞의 두 항목이 그대로다.
  같은 `kind`가 두 번 나오는 경우도 포함한다. (기획서 완료 조건 5)
- 이력이 없고 사용자 정의 필드가 있는 작업 문서로 QA를 기록하면 사용자 정의 필드가 보존되고 이력이
  새로 생긴다. 기존 `reads_task_detail_and_records_user_qa_outcomes`의 `custom_field: keep-me`
  선례를 쓴다. (기획서 완료 조건 6의 QA 기록 부분)
- 이력 항목이 프론트매터 중간에 있는 문서에서 QA를 기록해도 항목 안의 값이 `status`·`updated_at`
  치환에 걸려 망가지지 않는다.
- QA 결정만 있고 작업 문서에 이력이 없는 상태에서 `inspect`하면 해당 작업의 `events`에 완료 이벤트가
  나온다. (기획서 완료 조건 10)
- 프론트매터가 깨진 결정 문서, 스키마가 다른 문서, `created_by`가 `user`가 아닌 문서, 없는 작업을
  가리키는 결정 문서가 섞여 있어도 `inspect`가 성공하고 정상 이벤트는 나온다. (기획서 완료 조건 11)
- 같은 사실이 작업 이력과 QA 결정 양쪽에 있을 때 `events`에 한 번만 나온다. `Z` 표기와 `+00:00`
  표기가 섞인 경우도 포함한다. (기획서 완료 조건 12)
- `updated_at`만 있고 이력도 QA 결정도 없는 `completed` 작업은 `events`가 비어 있다.
  (기획서 완료 조건 14)

## 완료 조건

1. QA 확인·QA 반려 시 앱이 작업 문서에 해당 전이 항목을 남긴다. (기획서 완료 조건 9)
2. 전이 기록이 추가 전용이다. 같은 전이를 두 번 겪으면 두 항목이 모두 남는다. (기획서 완료 조건 5)
3. 이력이 없는 문서와 사용자 정의 필드가 있는 문서로 QA를 기록해도 필드가 보존된다.
   (기획서 완료 조건 6의 QA 기록 부분)
4. 화면이 QA 결정 문서의 `task_id`·`outcome`·`created_at`을 읽어 완료·반려 이벤트로 쓴다.
   (기획서 완료 조건 10)
5. 형식이 깨진 결정 문서나 없는 작업을 가리키는 결정 기록이 있어도 조회가 정상 동작한다.
   (기획서 완료 조건 11)
6. 같은 사실이 두 원천에 있어도 이벤트가 한 번만 나온다. (기획서 완료 조건 12)
7. 파일에 없는 전이 시각이 추정값으로 채워지지 않는다. (기획서 완료 조건 14)
8. 결정 문서를 만들거나 고치지 않는다. 기존 결정 관련 테스트가 수정 없이 통과한다.
9. `npm run check`와 `cargo fmt --check`·`cargo clippy -D warnings`·`cargo test`가 통과한다.
   (기획서 완료 조건 23)

## 검증 절차

```sh
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
npm run check
```

앱에서 확인한다.

- `qa_waiting` 작업 하나를 열어 확인 완료를 누른다. `tasks/<그 작업>.md`에 `history` 항목이 하나
  생기고, `decisions/QA-*.md`의 `created_at`과 같은 값인지 본다.
- 다른 작업으로 수정 요청을 누르고 `kind: revision_requested` 항목이 생기는지 본다.

## 범위 밖

- 캘린더 화면의 어떤 변경도. 이 작업은 백엔드만 만진다. 화면은 TASK-024·TASK-025다.
- 기획서 결정(`DECISION-*.md`)을 이벤트로 쓰는 것. 기획서 제외 범위(대상은 개발 작업의 상태 전이)다.
- 에이전트가 남기는 `created`·`in_progress`·`blocked`·`qa_waiting` 항목을 앱이 대신 쓰는 것.
  결정 2번에 따라 그 넷은 역할 세션의 몫이다.
- 기존 작업에 이력을 소급해 채우는 것.
- `latest_spec_decisions`와 새 스캔을 한 번의 순회로 합치는 리팩터링.
- 이벤트 조회 전용 커맨드 신설. 기존 `inspect_project` 응답에 실어 보낸다.

## 참고 사실

확인 시점 2026-08-02. 추정 없이 파일에서 읽은 값이다.

- `record_task_qa`는 `fs_project_repository.rs:314`이고, `created_at`을 `:337`에서 한 번 만들어 결정
  문서(`:343`)와 `update_task_frontmatter`(`:355`) 양쪽에 쓴다.
- `update_task_frontmatter`(`:688`)는 프론트매터를 줄 목록으로 훑으며 `status:`·`updated_at:`으로
  **시작하는** 줄만 치환하고 나머지는 그대로 둔다. 들여쓰기된 줄은 걸리지 않는다. `updated_at`이
  없으면 목록 끝에 덧붙인다(`:724`).
- `update_task_frontmatter`는 프론트매터가 없거나 `status:` 줄이 없으면 `TaskNotAwaitingQa`를 돌려
  QA 기록 전체를 실패시킨다. 이 동작은 유지한다.
- 이 저장소의 QA 결정 문서 실제 형태:
  `schema: workflow-labs/qa-decision@1` / `id: QA-080A79AF` / `task_id: TASK-007` /
  `outcome: confirmed` / `created_by: user` / `created_at: 2026-08-02T04:37:59.588232+00:00`.
  본문이 비어 있는 것도 있다(확인 메모는 선택).
- `latest_spec_decisions`(`:951`)가 결정 문서를 건너뛰는 방식(읽기 실패·스키마 불일치·`created_by`
  불일치·필수 필드 없음·값 목록 밖)이 그대로 참고할 선례다.
- `decisions/`에는 지금 기획서 결정 7건과 QA 결정 13건이 함께 있다.
- 화면은 `useProjectWorkspace.ts:305`의 2.5초 타이머로 `inspect`를 다시 부른다.
