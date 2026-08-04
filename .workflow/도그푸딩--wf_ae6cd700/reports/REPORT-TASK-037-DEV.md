# TASK-037 개발자 핸드오프

> 기록 경위: 세션 하네스가 보고서 파일 작성을 차단해, 세션이 채팅으로 보낸 전문을 TL이 그대로 기록했다.

- 대상 작업: TASK-037 (개발 작업의 선행 선언을 읽어 충족 여부와 영원히 열리지 않는 선언을 작업 상세
  payload에 싣는다)
- 근거 문서: SPEC-013 R1·R2·R5, DECISION-73D4BC1B (approved, created_by: user)
- 세션 역할: 개발자 (TL 배정, 병렬 웨이브)
- 상태: `qa_waiting`

## 대상 선정 근거

- TL이 이 한 건만 배정했다. 착수 시점 TASK-037은 `todo`였고 선행 선언(`depends_on`)이 없다.
- `migration.lock` 없음. 착수 시점 lease는 `SPEC-009.yml`(만료), `TASK-036.yml`, `TASK-041.yml`
  셋뿐이었고 전부 내 대상이 아니라 손대지 않았다.
- 선점: `leases/TASK-037.yml` 배타 생성(`set -C`) → 즉시 `status: in_progress` + `history` 기록 →
  구현 → 검증 → `qa_waiting` → lease 반납. 작업 중 만료가 가까워져 `heartbeat_at`·`expires_at`을
  한 번 갱신했다.
- 병행 금지 상대: TASK-039(`fs_project_repository.rs` 공유)는 이번 웨이브에 없었다.
  TASK-029·032·035는 이미 끝난 상태라 두 파일에 동시 작업이 없었다.
- 소스 결정 DECISION-73D4BC1B는 `approved`로 유효하다.

## 요약

작업 상세 조회(`read_task`)가 프론트매터의 `depends_on` 한 줄을 읽어 선행 작업별 판정을 함께
돌려준다. 판정은 읽는 시점의 파생이고 어떤 파일도 쓰지 않는다. 목록 payload(`WorkflowItemSummary`)는
한 필드도 늘지 않았고 화면은 한 줄도 건드리지 않았다.

## 판정 규칙 구현 (SPEC-013 R2의 단일 정의)

### 선언 파싱 — 프론트매터 안에서 줄 단위로

`serde_yaml`은 블록 표기와 흐름 표기를 구분해 주지 않아 이 판정에 쓸 수 없다. 계약이 정하는 표기는
열 0에서 시작하는 한 줄 흐름 시퀀스 하나뿐이다.

1. 프론트매터에서 `depends_on:`으로 시작하는 열 0 줄을 모은다. 없으면 `Absent`.
2. 두 줄 이상이면 `Malformed`.
3. 키 뒤 값을 trim해 비어 있으면 `Malformed` (블록 표기·값 없는 키가 여기서 걸린다).
4. `[`로 시작해 `]`로 끝나지 않으면 `Malformed`.
5. 대괄호 안쪽을 `,`로 나눠 각 토큰을 trim한다. 전부 비어 있으면 `Declared([])`.
6. 토큰이 하나라도 비어 있거나 `[A-Za-z0-9_-]` 밖의 문자를 포함하면 `Malformed`
   (따옴표 표기, ASCII 밖의 id가 여기서 걸린다).
7. 그 밖은 `Declared(토큰들)`.

파싱 대상은 프론트매터 구간뿐이다. 본문에 열 0으로 적힌 같은 문자열은 선언이 아니다.

### 충족 정의와 순환·없는 id 처리

선행 하나의 판정 순서는 `Missing` → `Cyclic` → 상태다.

- **충족**: 선행의 상태가 `qa_waiting` 또는 `completed`면 `satisfied`. 그 밖은 `pending`이고,
  계약에 없는 상태값도 `pending`이다 — 모르는 값을 충족 쪽으로 넘기지 않는다.
- **없는 id**: 그 id의 작업 문서가 이 워크플로우에 없으면 `missing`. 없는 참조를 "제약 없음"으로
  읽지 않는다. 다른 워크플로우에 같은 id가 있어도 `missing`이다(판정 범위는 워크플로우 안).
- **순환**: 선언 그래프에서 그 선행으로부터 지금 작업으로 돌아오는 경로가 있으면 `cyclic`.
  자기 참조가 길이 0인 그 경우다. **순환이 상태 판정보다 앞선다** — `completed`인 선행이 고리를
  이루면 `cyclic`이지 `satisfied`가 아니다. 탐색은 방문 집합을 둬서 종료가 보장되고, 간선은 각
  작업의 `Declared` 목록뿐이라 `Absent`·`Malformed`인 작업에는 나가는 간선이 없다.
- **형식 오류**: `Malformed`는 그 자체로 미충족이며 `dependency_format_error: true`로 나가고
  `dependencies`는 빈 목록이다. 선행 자신의 선언이 `Malformed`인 것은 지금 작업의 판정을 바꾸지
  않는다 — 그 작업의 상태만 본다.
- 작업 전체가 충족이라는 것은 선언이 `Absent`이거나 `Declared`이고 모든 항목이 `Satisfied`라는 뜻이다.
- 목록 순서는 선언에 적힌 그대로다. 정렬하면 아키텍트가 쓴 순서의 뜻이 사라진다.

### 파서·판정 함수 위치 (승계 지점)

전부 `src-tauri/src/infrastructure/fs_project_repository.rs`.

- `frontmatter_source:1184` — 판정 대상 구간을 프론트매터로 한정한다. **아래 리스크 1번의 자리.**
- `DependencyDeclaration:1192` — `Absent`/`Declared`/`Malformed` 세 결과.
- `parse_dependency_declaration:1206` — 위 7단계 파싱 규칙 본체. sh의 `deps_of`에 대응.
- `task_dependency_graph:1245` — 문서 id로 상태·선언을 찾는다. sh의 `task_file`에 대응.
- `task_dependencies:1281` — 작업 하나의 선언을 payload 값으로 만든다.
- `dependency_state:1304` — `Missing` → `Cyclic` → 상태 순서.
- `declaration_reaches:1326` — 방문 집합 그래프 탐색. sh의 `reaches`에 대응.
- 배선은 `read_task:264`.

## 변경한 파일 (2건, 작업 범위 그대로)

- `src-tauri/src/domain/project.rs`
  - `TaskDependencyState`(`:149`) — `satisfied`/`pending`/`missing`/`cyclic`, `Serialize`만 파생.
  - `TaskDependency`(`:163`) — `id`·`state`.
  - `TaskDocument`(`:170`)에 `dependencies`(`:174`)·`dependency_format_error`(`:177`) 두 필드.
  - `SpecDocument`·`IdeaDocument`·`WorkflowItemSummary`는 무변경.
- `src-tauri/src/infrastructure/fs_project_repository.rs`
  - 위 일곱 함수·타입 추가, `read_task` 배선, 테스트 19건 추가.
  - `split_frontmatter`의 시그니처는 바꾸지 않았다.

범위 밖 파일 무변경: 화면 전부, `src/features/projects/domain/types.ts`,
`heartbeat_condition.rs`, `role_eligibility.rs`, `project_instructions.rs`, `docs/file-contract.md`.
`cargo fmt`가 고친 것도 `fs_project_repository.rs` 두 자리뿐이다.

## 구현 결정

- **자기 작업의 선언도 그래프에서 읽는다.** `read_task`는 판정용 그래프를 한 번 모으고 자기 노드를
  거기서 찾는다. 파일을 두 번 읽지 않고, 순환 탐색이 쓰는 간선과 payload에 실리는 목록이 같은
  출처에서 나온다.
- **그래프는 상세 조회 경로에서만 모은다.** `inspect`(2.5초 주기)는 이 함수를 부르지 않는다.
  `WorkflowItemSummary`에 필드를 더하지 않은 이유도 같다.
- **id와 상태는 기존 규칙 그대로 `yaml_text`로 읽고 선언만 줄 단위로 읽는다.** 화면이 목록에서 보는
  상태와 판정이 쓰는 상태가 같아야 한다. 같은 id가 둘 이상이면 파일 이름이 앞서는 쪽을 남긴다.

## 검증

작업 문서의 검증 절차 그대로 실행했다.

| 명령 | 결과 |
| --- | --- |
| `cargo test --manifest-path src-tauri/Cargo.toml` | 251 passed / 0 failed / 0 ignored |
| `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` | 통과 |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | 경고 없음 |
| `npm run check` | 254 passed (14 files), `tsc -b && vite build` 통과 |

핸드오프 시점 `cargo test`는 236이었다. 251로 는 것은 그 사이 병렬 세션이 자기 파일에 더한
테스트이고, 이 작업이 더한 것은 19건이다. 삭제·비활성화한 테스트는 없고 기존 테스트는 무수정이다.

### 더한 테스트 19건 (전부 `fs_project_repository.rs` 테스트 모듈)

파싱: `treats_a_task_without_a_declaration_as_having_no_dependencies`(완료 조건 1),
`reads_an_empty_declaration_as_no_dependencies`,
`treats_declarations_outside_the_contract_form_as_a_format_error`(블록 표기·값 없는 키·닫히지 않은
대괄호·따옴표 id·빈 토큰·중복 키 6종, 완료 조건 5), `ignores_a_declaration_written_in_the_body`.

판정: `satisfies_a_dependency_that_reached_qa_or_completion`(완료 조건 2·6),
`leaves_a_dependency_pending_until_it_reaches_qa`(`todo`·`in_progress`·`blocked`·계약 밖 상태),
`keeps_every_entry_when_only_one_dependency_is_satisfied`(완료 조건 6),
`marks_a_declaration_without_a_document_as_missing`(완료 조건 3),
`marks_a_self_reference_as_cyclic`, `marks_a_two_task_cycle_as_cyclic_on_both_sides`,
`marks_a_three_task_cycle_as_cyclic`(완료 조건 4),
`prefers_the_cycle_over_the_state_of_a_completed_dependency`,
`reads_only_the_state_of_a_dependency_with_a_malformed_declaration`,
`separates_missing_cyclic_and_malformed_declarations`(완료 조건 7),
`keeps_dependency_resolution_inside_its_workflow`.

배선: `keeps_the_declaration_out_of_the_list_payload`(선언 유무만 다른 같은 문서의 목록 항목이 동일),
`keeps_the_declaration_line_when_qa_confirms_a_task`,
`keeps_the_declaration_line_when_qa_returns_a_task`(둘 다 선언이 `history:` 앞·뒤인 픽스처 각각,
완료 조건 8), `reading_the_task_detail_does_not_touch_the_workflow_files`(완료 조건 9).

## 사용자 QA 제안

이 작업은 payload만 바꾼다. 화면은 아직 새 값을 읽지 않으므로(TASK-038) 화면 확인 항목이 없다.

1. 앱을 열어 개발 작업 카드를 눌러 상세가 지금과 똑같이 열리는지 본다. 선언을 가진 작업 문서가
   아직 하나도 없으므로 표시가 달라지면 안 된다.
2. QA 확인·반려를 한 번씩 실행하고 작업 문서 프론트매터가 지금과 같은 모양으로 갱신되는지 본다.
3. 값을 직접 보려면 임시 작업 문서에 `depends_on: [TASK-036]` 한 줄을 넣고 개발자 도구의
   `read_task` 응답에서 `dependencies`를 확인한다. 화면 표시는 TASK-038의 몫이다.

## 리스크와 후속

1. **조건 스크립트와 파싱 범위가 갈린다 (TASK-040에 전달됨).** 이 작업은 프론트매터 안에서만
   선언을 찾고 그 사실을 테스트로 고정했다. `scripts/wf-eligible.sh`의 `deps_of`는 `depends_on:`
   줄을 **파일 전체**에서 찾는다. 본문에만 열 0으로 적혀 있으면 앱은 "선언 없음", 스크립트는
   "선언 있음"으로 읽고, 프론트매터와 본문에 하나씩 있으면 앱은 `Declared`, 스크립트는 중복 키로
   보아 미충족으로 읽는다. R2 마지막 줄이 금지한 갈라짐이다. TASK-040 보고서가 이 차이를 알려진
   차이로 기록했고(현재 선언 14건은 전부 프론트매터), 해소는 범위 밖 별건으로 남았다.
2. **id가 없는 작업 문서.** 앱은 프론트매터에 `id`가 없으면 파일 stem을 문서 id로 쓰지만 조건
   스크립트의 `task_file`은 `^id:` 줄로만 찾는다. 계약이 `id`를 필수로 두므로 실제로 생기지는
   않지만, 두 구현의 판정 범위가 다른 두 번째 자리다. 1번과 같은 세션에서 함께 보면 된다.
3. **목록에는 선행 표시가 없다.** 상세만이 R5가 요구한 자리다. 목록에 얹으면 `inspect`가 2.5초마다
   워크플로우의 모든 작업 문서를 다시 읽게 된다.
4. **`types.ts`에 대응 필드가 없다.** 프런트엔드 타입은 TASK-038의 몫이라 손대지 않았다. payload에
   필드가 더 있고 TS 인터페이스가 모르는 상태이며, 런타임·빌드 어느 쪽도 깨뜨리지 않는다
   (`npm run check` 통과 확인).
5. **판정 비용.** 상세 조회 한 번에 `tasks/*.md` 전체를 한 번 더 읽는다. 이 워크플로우 기준 50건
   안팎이고 카드를 눌렀을 때만 도는 경로라 지금 규모에서는 문제가 되지 않는다.
