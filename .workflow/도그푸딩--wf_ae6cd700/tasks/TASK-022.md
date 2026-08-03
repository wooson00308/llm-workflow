---
schema: workflow-labs/task@1
id: TASK-022
title: 개발 작업 전이 이력 계약을 정의하고 규칙 자산에 반영한다
status: completed
source_spec_id: SPEC-007
source_decision_id: DECISION-AA40AF4B
updated_at: 2026-08-03T02:31:04.232982+00:00
history:
  - { at: 2026-08-03T02:31:04.232982+00:00, kind: completed }
---

# 개발 작업 전이 이력 계약을 정의하고 규칙 자산에 반영한다

SPEC-007 R2의 계약 정의 부분과 R3 전부를 구현한다. 개발 작업 프론트매터에 상태 전이 사실을 남기는
`history` 필드를 정의하고, 앱이 그것을 읽어 요약에 실어 보내고, 앱이 설치하는 공통 규칙과 역할 계약에
기록 의무를 적는다.

이 작업은 읽기와 계약까지다. 앱이 QA 시점에 이력을 쓰는 경로와 QA 결정 문서를 이벤트 원천으로 읽는
경로는 TASK-023이다. 화면은 손대지 않는다.

## 의존성

- 선행 없음. SPEC-007의 첫 작업이다.
- TASK-023과 병행 금지. 같은 파일(`fs_project_repository.rs`, `domain/project.rs`)을 만진다.

## 범위

- `docs/file-contract.md` — 개발 작업 절에 `history` 계약 추가.
- `src-tauri/src/domain/project.rs` — `TaskEvent` 타입 추가, `WorkflowItemSummary`에 `events` 추가.
- `src-tauri/src/infrastructure/fs_project_repository.rs` — `read_markdown_document`의 이력 파싱.
- `src-tauri/src/infrastructure/project_instructions.rs` — 공통 규칙·아키텍트·개발자 계약 본문과
  버전 표기.
- `src/features/projects/domain/types.ts` — `TaskEvent` 타입과 `events` 필드.
- 그 외 파일은 건드리지 않는다. 특히 `DevelopmentBoard.tsx`와 `App.css`는 이 작업에서 바뀌지 않는다.

## 작업 내용

### 0. 먼저 읽을 제약

- 계약 확장은 기존 문서를 깨지 않는다(R2). 이 저장소의 개발 작업 21건에는 `history`가 없고, 전부 계속
  유효해야 한다. 파싱 실패는 오류가 아니라 "이력 없음"이다.
- 알 수 없는 프론트매터 필드를 보존하는 현행 동작을 유지한다. 이 작업은 읽기만 바꾼다.
- 앱은 지금 `record_spec_decision`과 `record_task_qa`에서 규칙 자산을 설치한다
  (`fs_project_repository.rs:277`, `:328`). 이 경로가 완료 조건 8의 갱신 통로이므로 새 경로를 만들지
  않는다.

### 1. 프론트매터 계약

`history`는 개발 작업 프론트매터의 선택 필드이고, 블록 시퀀스다. 항목 하나가 전이 하나다.

```yaml
---
schema: workflow-labs/task@1
id: TASK-001
title: 파서 구현
status: qa_waiting
source_spec_id: SPEC-001
source_decision_id: DECISION-001
updated_at: 2026-08-02T16:00:00Z
history:
  - { at: 2026-08-02T14:00:00Z, kind: created }
  - { at: 2026-08-02T15:00:00Z, kind: in_progress }
  - { at: 2026-08-02T16:00:00Z, kind: qa_waiting }
---
```

- `at`은 RFC3339 시각이다. `kind`는 여섯 값 중 하나다:
  `created`(작업 문서 생성), `in_progress`(작업 시작), `blocked`(막힘), `qa_waiting`(QA 대기 진입),
  `completed`(QA 확인으로 완료), `revision_requested`(QA 반려로 `todo` 복귀).
- 기록은 추가 전용이다. 이미 있는 항목은 고치지 않고 새 항목을 아래에 덧붙인다. 같은 `kind`가 여러 번
  나오는 것은 정상이다(반려 후 재작업).
- 항목은 한 줄로 쓴다(위 예시의 흐름 표기). 앱이 줄 단위로 한 줄을 덧붙이기 때문이고, 그 구현은
  TASK-023이다. 읽기는 관대하게 한다 — 블록 표기로 쓴 항목도 정상으로 읽는다.
- 비어 있으면 `history` 키 자체를 쓰지 않는다. `history: []` 같은 인라인 표기는 쓰지 않는다.
- `updated_at`은 전이 시각이 아니다. 마지막 변경 시각일 뿐이므로 이력의 대체로 쓰지 않는다.

계약 문구를 `docs/file-contract.md`의 개발 작업 절(`:110`~`:140` 사이)에 넣는다. `due_at` 설명
(`:140`)은 그대로 두되, "캘린더뷰는 이 값을 기준으로 작업을 배치하고" 문장은 사실이 아니게 되므로
TASK-024에서 고친다. 이 작업에서 미리 고치지 않는다 — 화면이 아직 안 바뀌었는데 문서가 먼저 바뀌면
그 사이 저장소가 거짓을 적어 두게 된다.

### 2. 도메인 타입

```rust
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskEvent {
    pub kind: String,
    /// 파일에 적힌 RFC3339 원문. 화면이 로컬 날짜로 바꾼다.
    pub at: String,
}
```

`WorkflowItemSummary`에 `pub events: Vec<TaskEvent>`를 더한다. 아이디어·기획서 요약에서는 항상 빈
목록이다. `due_at`이 개발 작업 전용인데도 이 타입에 있는 것과 같은 선례를 따른다.

TypeScript 쪽은 `TaskEvent { kind: string; at: string }`을 더하고
`WorkflowItemSummary.events?: TaskEvent[]`로 선택 필드로 둔다. `dueAt?: string | null`과 같은 선례다.
이렇게 하면 기존 테스트 픽스처를 고치지 않아도 된다.

### 3. 파싱

`read_markdown_document`에서 `due_at`을 읽는 자리(`fs_project_repository.rs:878`) 옆에 이력 파싱을
더한다.

- `history`가 없으면 빈 목록이다. 오류가 아니다.
- 시퀀스가 아니면 빈 목록이다.
- 항목별로 검사한다. 매핑이 아니거나, `at`이 RFC3339로 파싱되지 않거나, `kind`가 여섯 값 밖이면 그
  항목만 버리고 나머지는 살린다. 한 항목이 깨졌다고 전체를 버리지 않는다.
- 파싱한 시각 기준 오름차순으로 정렬해서 담는다. 화면이 다시 정렬하지 않아도 되게 한다.
- `at`은 원문 문자열 그대로 담는다. 정규화한 값으로 바꾸지 않는다. 파싱은 검사와 정렬에만 쓴다.
  (`HeartbeatJobRun.at`이 원문을 그대로 전달하는 선례를 따른다.)
- 파싱에는 이미 의존하고 있는 `chrono`의 `DateTime::parse_from_rfc3339`를 쓴다.

### 4. 규칙 자산

`project_instructions.rs`의 문자열 상수를 고친다.

공통 규칙(`WORKFLOW_RULES`) 5절 "Development tasks"에 전이 기록 의무를 넣는다.

- 상태를 바꾼 세션은 같은 편집에서 `history`에 한 항목을 덧붙인다.
- 여섯 `kind` 값과 그 의미.
- 추가 전용이라는 것, 기존 항목을 고치지 않는다는 것.
- `updated_at`을 전이 시각으로 쓰지 않는다는 것.
- 항목은 한 줄 흐름 표기로 쓴다는 것.
- QA 확인·QA 반려 전이는 앱이 남기므로 에이전트가 쓰지 않는다는 것.

6절 "Preserve the file contract"에 `due_at` 줄 옆으로 `history` 필드가 선택 필드라는 한 줄을 넣는다.

아키텍트 계약(`ARCHITECT_RULES`)의 Completion에 한 줄: 작업 문서를 만들 때 `history`에 `created`
항목을 남긴다.

개발자 계약(`DEVELOPER_RULES`)의 Completion에: `in_progress`로 옮길 때, 막혔을 때, `qa_waiting`으로
넘길 때 각각 해당 항목을 남긴다. 상태 변경과 같은 편집에서 남긴다.

기획자 계약(`PLANNER_RULES`)은 바뀌지 않는다. 기획자는 작업 문서를 만들지 않는다.

버전 표기:

- `WORKFLOW_RULES`의 `rules_version: 3` → `4`.
- `ARCHITECT_RULES`·`DEVELOPER_RULES`의 `rules_version: 2` → `3`.
- `PLANNER_RULES`는 `2` 유지.

버전 숫자가 네 군데 리터럴로 흩어져 있다(`:279`, `:284`, `:319`, `:329`). 하나만 놓치면
`validate_project_instructions`가 방금 설치한 파일을 "미래 버전"으로 보고 `create_workflow`를 막는다.
상수 두 개(`WORKFLOW_RULES_VERSION`, `ROLE_RULES_VERSION`)를 만들어 네 자리 모두에서 쓴다.
`ROLE_RULES_VERSION`은 역할 계약 셋의 최댓값인 `3`이다. 기획자 계약이 `2`로 남아 있어도
`plan_rules_file`은 `version > current_version`일 때만 거부하므로 문제가 없고, 내용이 `expected`와
같으므로 다시 쓰지도 않는다.

### 5. 테스트

Rust (`fs_project_repository.rs`):

- `history`가 있는 작업 문서를 읽으면 `events`가 시각 오름차순으로 나온다. 파일에 뒤죽박죽 순서로
  적혀 있어도 정렬된다.
- `history`가 없는 작업 문서를 읽으면 `events`가 비어 있고 나머지 필드는 그대로다. (기획서 완료 조건 6)
- 깨진 항목(`at` 없음, `at`이 시각이 아님, `kind`가 여섯 값 밖, 항목이 매핑이 아님)이 섞여 있으면 그
  항목만 빠지고 정상 항목은 남는다.
- `history`가 시퀀스가 아닌 값(문자열·매핑)이면 빈 목록이고 문서 읽기는 성공한다.
- `at`이 원문 그대로 전달된다(`+00:00` 오프셋 표기가 `Z`로 바뀌지 않는다).

Rust (`project_instructions.rs`):

- 설치된 공통 규칙에 `rules_version: 4`와 `history`가 있다. (기획서 완료 조건 7)
- 설치된 아키텍트·개발자 계약에 `rules_version: 3`과 `history`가 있고, 기획자 계약은 `rules_version: 2`다.
- 옛 버전(공통 3, 역할 2)이 설치된 컨트롤 루트에 대해 `install_project_instructions`를 부르면 새
  버전으로 갱신된다. 기존 `upgrades_managed_v1_rules_and_installs_role_contracts` 테스트와 같은
  형태로 만든다. (기획서 완료 조건 8)
- `install_project_instructions` 직후 `validate_project_instructions`가 통과한다. 버전 상수를 한
  군데만 올렸을 때 잡히는 테스트다.

## 완료 조건

1. 개발 작업 계약에 상태 전이 기록이 정의되고, R2의 여섯 시점을 표현할 수 있다. (기획서 완료 조건 4)
2. 이력이 없는 기존 작업 문서가 그대로 유효하고, 알 수 없는 필드가 보존된다. 읽기 쪽 검증을 이 작업에서
   한다. (기획서 완료 조건 6의 읽기 부분)
3. 깨진 이력 항목이 있어도 문서 읽기가 실패하지 않고 정상 항목만 남는다.
4. 앱이 설치하는 공통 규칙과 아키텍트·개발자 계약에 전이 기록 의무가 반영되고 버전 표기가 올라간다.
   (기획서 완료 조건 7)
5. 옛 버전 규칙이 설치된 프로젝트가 갱신된 규칙 자산을 받는다. (기획서 완료 조건 8)
6. 화면 동작이 바뀌지 않는다. 기존 프론트엔드 테스트가 수정 없이 통과한다.
7. `npm run check`와 `cargo fmt --check`·`cargo clippy -D warnings`·`cargo test`가 통과한다.
   (기획서 완료 조건 23)

## 검증 절차

```sh
npm run check
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

## 범위 밖

- 앱이 QA 시점에 `history`를 쓰는 것. TASK-023이다.
- QA 결정 문서를 이벤트 원천으로 읽는 것. TASK-023이다.
- 캘린더 화면의 어떤 변경도. TASK-024·TASK-025다.
- 이 저장소의 기존 작업 21건에 이력을 소급해 채우는 것. 기획서 제외 범위다.
- `due_at` 필드의 폐지나 보드·리스트 표시 변경.
- 스키마 식별자 변경. `workflow-labs/task@1` 그대로다.

## 참고 사실

확인 시점 2026-08-02. 추정 없이 파일에서 읽은 값이다.

- 이 저장소 개발 작업 21건의 프론트매터 키는 `schema`·`id`·`title`·`status`·`source_spec_id`·
  `source_decision_id`·`updated_at` 일곱 개뿐이다. `history`도 `due_at`도 `created_at`도 없다.
- `read_markdown_document`는 `fs_project_repository.rs:849`이고 `due_at`을 `:878`에서 읽는다.
  프론트매터 파싱은 `split_frontmatter`(`:894`)가 `serde_yaml::Value`로 돌려준다.
- `read_markdown_summaries`(`:822`)는 `read_markdown_document`가 `Err`이면 그 파일을 통째로 건너뛴다.
  그래서 이력 파싱 실패를 `Err`로 만들면 작업이 목록에서 사라진다. 반드시 빈 목록으로 처리한다.
- 규칙 설치는 `install_project_instructions`(`project_instructions.rs:270`)이고 호출처는
  `create_workflow`(`fs_project_repository.rs:138`), `record_spec_decision`(`:277`),
  `record_task_qa`(`:328`) 셋이다. `inspect`는 설치하지 않고 `create_workflow`가 `:113`에서
  `validate_project_instructions`로 미리 검사만 한다.
- `plan_rules_file`(`project_instructions.rs:336`)은 파일이 없으면 설치하고, 스키마 줄이 없으면 충돌,
  `rules_version`이 현재보다 크면 충돌, 내용이 같으면 쓰지 않고, 다르면 덮어쓴다.
- `chrono`는 `fs_project_repository.rs:6`에서 이미 쓰고 있다.
- 이 저장소 자신의 `.workflow/rules/*`도 앱 관리 자산이다. 이 변경 뒤 사용자가 기획서를 승인하거나
  QA를 기록하면 새 버전으로 갱신된다.
