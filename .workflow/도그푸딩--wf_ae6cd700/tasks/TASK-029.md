---
schema: workflow-labs/task@1
id: TASK-029
title: 역할별 대기 물량을 조회 결과에 싣고 조건 스크립트와 같은 결론을 테스트로 고정한다
status: todo
source_spec_id: SPEC-009
source_decision_id: DECISION-85491D81
updated_at: 2026-08-03T00:45:00Z
history:
  - { at: 2026-08-03T00:45:00Z, kind: created }
---

# 역할별 대기 물량을 조회 결과에 싣고 조건 스크립트와 같은 결론을 테스트로 고정한다

SPEC-009 R3의 판정 부분과 확인 필요 2번의 확정 사항을 구현한다. "지금 이 역할이 처리할 대상이
대기 중인가"를 앱이 계산해 프로젝트 조회 결과에 싣고, 그 판정이 조건 스크립트
(`.workflow/rules/wf-eligible.sh`)와 같은 결론을 낸다는 것을 자동화 테스트로 못 박는다.
화면은 건드리지 않는다.

## 의존성

- 선행 작업 없음.
- **TASK-028과 병행 금지.** 둘 다 `src-tauri/src/domain/project.rs`를 만진다. 순서는 어느 쪽이
  먼저여도 된다.
- 이 작업의 산출물(`ProjectSummary.pendingWork`)을 TASK-030이 화면에서 쓴다.

## 범위

- `src-tauri/src/infrastructure/role_eligibility.rs` — 신규. 판정 규칙 한 곳.
- `src-tauri/src/infrastructure/mod.rs` — 모듈 선언 1줄.
- `src-tauri/src/infrastructure/fs_project_repository.rs` — `source_decision_id` 읽기, 결정 스캔
  확장, lease 파일 id 수집, 판정 배선.
- `src-tauri/src/domain/project.rs` — `WorkflowItemSummary.source_decision_id`,
  `ProjectSummary.pending_work`, `PendingRoleWork`.
- `docs/file-contract.md` — 파생 작업의 출처 참조 계약.
- 그 외 파일은 건드리지 않는다. 화면·타입스크립트 타입·연동 스냅샷은 이 작업에서 바뀌지 않는다.

## 작업 내용

### 0. 먼저 읽을 제약

- **이 판정은 조건 스크립트를 옮긴 것이다. 더 똑똑하게 만들지 않는다.** 두 판정이 갈라지면 화면이
  거짓말을 한다(R3). 스크립트가 막는 것은 앱도 막고, 스크립트가 통과시키는 것은 앱도 통과시킨다.
- **만료된 lease도 막는다.** 스크립트는 `[ -f "$leases/$id.yml" ]`로 파일 존재만 본다.
  `read_active_leases`(`:568`)는 `expires_at`이 지난 lease를 걸러 내므로 이 판정에 쓸 수 없다.
  화면의 lease 목록은 지금 동작 그대로 두고, 판정용으로 파일 이름 집합을 따로 모은다.
- **마이그레이션 락이 있으면 세 역할 모두 false다.** 스크립트의 첫 줄과 같다. 원인이 한도가 아니므로
  화면도 경고를 띄우지 않는다(R3, 기획서 완료 조건 9). 이 규칙을 화면에 따로 적지 않고 여기서 끝낸다.
- **아키텍트 판정은 "최신 결정"이 아니라 "`approved`인 모든 결정"이다.** 스크립트가 결정 파일을
  하나씩 훑으며 `^outcome: approved`만 본다. 승인 뒤 수정 요청이 이어진 기획서라도, 그 승인 결정을
  참조하는 작업이 없으면 스크립트는 자격 있음으로 판정한다. 앱도 같아야 한다.
  `latest_spec_decisions`의 "가장 최근 결정" 규칙을 여기에 가져오지 않는다.
- **판정 대상은 `project.yml`에 등록된 워크플로우다.** 스크립트는 `.workflow/*/`를 전부 본다.
  등록되지 않은 디렉터리에 문서가 있으면 두 판정이 갈린다. 알려진 차이로 문서에 남기고, 테스트
  픽스처는 등록된 워크플로우로만 만든다. 스크립트의 판정 규칙은 고치지 않는다(기획서 제외 범위).
- 조회 경로에 새 디렉터리 순회를 최소한만 더한다. `inspect`는 2.5초마다 돈다.

### 1. `source_decision_id`를 요약에 싣는다

`read_markdown_document`(`:917`)에서 `yaml_text(metadata.as_ref(), "source_decision_id")`를 읽어
`WorkflowItemSummary`에 담는다. 아이디어·기획서 문서에는 그 키가 없으므로 `None`이다.

`domain/project.rs`의 `WorkflowItemSummary`(`:93`)에 필드를 더한다.

```rust
/// 이 작업이 어떤 승인 결정에서 나왔는지. 아이디어·기획서에서는 항상 `None`이다.
/// 앱은 이 참조로 "승인됐지만 아직 작업으로 분해되지 않은 결정"을 판정한다.
pub source_decision_id: Option<String>,
```

`docs/file-contract.md`의 "개발 작업" 절을 고친다.

- 예시 프론트매터에 `source_spec_id: SPEC-001`과 `source_decision_id: DECISION-001`을 더한다.
  지금 예시에는 둘 다 없어서, 역할 계약이 요구하는 키가 계약 문서에는 안 보인다.
- 두 키의 뜻을 한 문단으로 적는다: 파생 작업은 근거 기획서와 근거 결정을 참조하고, 앱은 그 참조로
  아직 분해되지 않은 승인 결정을 판정한다.
- `.workflow/rules/*.md`는 고치지 않는다(기획서 제외 범위).

### 2. 결정 스캔을 늘리지 않는다

아키텍트 판정에는 결정 문서의 `id`가 필요한데 `latest_spec_decisions`(`:1127`)는 `spec_id →
(created_at, outcome)`만 남기고 id를 버린다. 스캔을 하나 더 만들지 않고 기존 스캔을 넓힌다.

- `read_spec_decisions(workflow_root) -> Vec<SpecDecisionRecord>`로 바꾼다.
  `SpecDecisionRecord { id: String, spec_id: String, outcome: String, created_at: String }`.
  건너뛰는 규칙은 지금과 같다(읽기 실패·스키마 불일치·`created_by`가 `user` 아님·`spec_id` 없음·
  `outcome`이 세 값 밖). 여기에 **`id`가 없으면 건너뛴다**를 더한다. 스크립트도 `[ -n "$did" ]`로
  같은 것을 요구한다.
- 지금의 `HashMap<String, (String, String)>`은 그 목록 위에서 만드는 작은 함수로 남긴다. 호출
  지점은 둘이다: `workflow_items`(`:844`)와 `apply_latest_decision`(`:1167`). 두 곳의 동작은 그대로다.
- `qa_decision_events`(`:1049`)는 손대지 않는다. 세 스캔을 한 순회로 합치는 리팩터링은 TASK-023이
  범위 밖으로 둔 것과 같은 이유로 하지 않는다.

### 3. lease 파일 id를 모은다

`fs_project_repository.rs`에 작은 함수 하나를 더한다.

```rust
/// 판정용 lease 목록. 파일 내용을 읽지 않고 이름만 본다. 만료를 거르지 않는 것이 조건 스크립트와
/// 같은 규칙이다.
fn lease_ids(control_root: &Path) -> HashSet<String>
```

- `.runtime/leases/*.yml`의 파일 stem을 모은다. 디렉터리가 없으면 빈 집합이다.
- `read_active_leases`와 합치지 않는다. 한쪽은 만료를 걸러야 하고 다른 쪽은 걸러서는 안 된다.
  한 함수에 두 규칙을 섞으면 어느 쪽이 어느 판정에 쓰이는지 읽는 사람이 매번 되짚어야 한다.

### 4. 판정 모듈 (`role_eligibility.rs` 신규)

규칙을 한 파일에만 적는다. 이 모듈은 파일 시스템을 만지지 않고 값만 받는다. 그래야 규칙과 수집이
섞이지 않고 테스트가 값으로 끝난다.

```rust
pub struct WorkflowInput<'a> {
    pub items: &'a WorkflowItems,
    /// 이 워크플로우의 `outcome: approved` 결정. `(결정 id, spec_id)`다.
    pub approved_decisions: &'a [(String, String)],
}

pub fn pending_role_work(
    migration_locked: bool,
    lease_ids: &HashSet<String>,
    workflows: &[WorkflowInput<'_>],
) -> PendingRoleWork
```

`domain/project.rs`에 결과 타입을 둔다.

```rust
/// 역할별 대기 물량. 조건 스크립트가 그 역할로 종료 코드 0을 돌려주는 상태가 `true`다.
#[derive(Debug, Clone, Copy, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PendingRoleWork {
    pub planner: bool,
    pub architect: bool,
    pub developer: bool,
}
```

규칙은 스크립트 그대로다. 각 판정 옆에 스크립트의 해당 절을 주석으로 밝힌다.

- `migration_locked`이면 셋 다 `false`다. 다른 규칙을 보기 전에 끝낸다.
- **planner**: 어떤 워크플로우든 아이디어 중 `status != "adopted"`이고 `lease_ids`에 그 id가 없는
  것이 하나라도 있으면 `true`. `adopted`는 `workflow_items`가 이미 `source_idea_id` 참조로 매긴
  값이다(`:851`~`:857`).
- **architect**: `approved_decisions` 중, 그 워크플로우의 작업 어느 것도 `source_decision_id`로
  가리키지 않고, `lease_ids`에 그 결정의 `spec_id`가 없는 것이 하나라도 있으면 `true`.
- **developer**: 작업 중 `status == "todo"`이고 `lease_ids`에 그 id가 없는 것이 하나라도 있으면
  `true`.

판정 범위는 워크플로우별이다. 스크립트가 워크플로우 하나 안에서 아이디어↔기획서, 결정↔작업을
대조하므로 앱도 워크플로우를 넘나들며 짝지어서는 안 된다. lease만 프로젝트 전역이다(스크립트도
`.workflow/.runtime/leases` 한 곳만 본다).

### 5. 조회에 배선한다

- `ProjectSummary`(`:51`)에 `pub pending_work: PendingRoleWork`를 더한다.
- `summary_from_manifest`(`:623`)가 워크플로우별 `items`를 이미 만든다(`:640`~`:644`). 그 자리에서
  결정 목록도 모아 `pending_role_work`를 부르고 결과를 담는다. 이 함수를 지나는 다섯 반환 경로
  (`inspect`·`create_workflow`·`create_idea`·`record_spec_decision`·`record_task_qa`)가 모두 자동으로
  같은 값을 갖는다. 호출 지점을 고치지 않는다.
- 마이그레이션 락은 `control_root.join(".runtime/migration.lock").exists()`로 본다. 이 값은 앱이
  마이그레이션 중일 때 스스로 만드는 파일이기도 하다(`MigrationLock`, `:433`).
- `uninitialized_summary`(`:649`)는 `PendingRoleWork::default()`(전부 `false`)로 채운다. 초기화되지
  않은 디렉터리에는 대기 물량이 없다.

### 6. 조건 스크립트 동치 테스트

`role_eligibility.rs`의 테스트 모듈에 둔다. 규칙만 검사하지 않고 **조회 결과(`inspect`)의 값**과
스크립트의 종료 코드를 대조한다. 그래야 배선까지 포함해 동치가 고정된다.

- 스크립트 실행 헬퍼는 `heartbeat_condition.rs:294`의 `run_condition`과 같은 모양으로 만든다.
  `sh`가 없는 플랫폼이 있으므로 `#[cfg(unix)]`로 감싼다. 그 파일의 선례를 그대로 따른다.
- 픽스처 프로젝트는 `FileSystemProjectRepository::create_workflow`로 만들고, 조건 스크립트는
  `heartbeat_condition::install_condition_script(&control_root)`로 설치한다. 저장소의
  `.workflow/rules/wf-eligible.sh`를 복사하지 않는다 — 앱이 설치하는 본문이 판정의 기준이다.
- 대조 함수 하나를 만들고 모든 시나리오가 그것을 통과하게 한다.
  `assert_eq!(app_flag, script_exit_code == 0)`.
- 시나리오(역할마다 자격 있음·없음 최소 한 쌍씩, 기획서 완료 조건 6):
  - planner: 기획서가 참조하지 않는 아이디어가 있음 / 모든 아이디어가 채택됨 / 그 아이디어 id로
    lease가 있음.
  - architect: 파생 작업이 없는 승인 결정이 있음 / 그 결정을 참조하는 작업이 있음 / 그 결정의
    `spec_id`로 lease가 있음.
  - developer: `todo` 작업이 있음 / `qa_waiting`만 있음 / 그 작업 id로 lease가 있음.
  - 만료된 lease 파일이 있는 상태에서 두 판정이 모두 "막힘"이다. 앱이 `active_leases`를 썼다면
    여기서 갈라진다.
  - `.workflow/.runtime/migration.lock`이 있으면 세 역할 모두 자격 없음이다.
    (기획서 완료 조건 9의 판정 부분)
  - 승인 뒤 같은 기획서에 수정 요청 결정이 이어진 상태에서, 그 승인 결정을 참조하는 작업이 없으면
    아키텍트 자격이 있다. "최신 결정만 본다"로 구현하면 여기서 갈라진다.
- `source_decision_id`가 조회 결과에 실린다는 별도 단정을 `fs_project_repository.rs` 테스트에 둔다.
  기존 `write_task_with_frontmatter`(`:1466`) 헬퍼를 쓰면 짧다.

## 완료 조건

1. 앱의 역할별 대기 물량 판정이 `sh .workflow/rules/wf-eligible.sh <role>`의 종료 코드와 같은
   결론을 낸다. 역할 3종에 자격 있음·없음 시나리오가 모두 있고 통과한다. (기획서 완료 조건 6)
2. `.workflow/.runtime/migration.lock`이 있으면 세 역할 모두 대기 물량 없음으로 나간다.
   (기획서 완료 조건 9의 판정 부분)
3. 만료된 lease 파일도 그 대상을 막는다. 앱이 만료를 걸러 판정하지 않는다.
4. 아키텍트 판정이 승인된 모든 결정을 보고, 최신 결정만 보지 않는다.
5. 작업 요약에 `sourceDecisionId`가 실리고, 아이디어·기획서 요약에서는 `null`이다.
6. `docs/file-contract.md`가 `source_spec_id`·`source_decision_id`를 개발 작업 계약으로 밝힌다.
7. 결정 문서 스캔 횟수가 이 작업 전과 같다. 새 스캔 함수를 추가하지 않았다.
8. 기존 결정·QA·이력 관련 Rust 테스트가 수정 없이 통과한다. 삭제·비활성화된 테스트가 없다.
   (기획서 완료 조건 18)
9. `cargo fmt --check`·`cargo clippy -D warnings`·`cargo test`와 `npm run check`가 통과한다.
   (기획서 완료 조건 19)

## 검증 절차

```sh
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
npm run check
```

이 저장소 자체로도 한 번 대조한다. 지금 상태에서 세 역할의 스크립트 종료 코드를 확인하고, 같은
값이 나오는지 본다.

```sh
sh .workflow/rules/wf-eligible.sh planner; echo "planner=$?"
sh .workflow/rules/wf-eligible.sh architect; echo "architect=$?"
sh .workflow/rules/wf-eligible.sh developer; echo "developer=$?"
```

주의: 이 저장소에는 `tasks/TASK-022.md` 본문에 프론트매터 예시가 코드 블록 밖으로 들어 있어
스크립트의 `grep`이 `source_decision_id: DECISION-001`을 실제 값으로 잡는다. 아래 "참고 사실"의
알려진 차이 항목을 보고, 이 저장소 대조에서 값이 어긋나면 그 원인부터 확인한다.

## 범위 밖

- 화면의 어떤 변경도. 경고 표시는 TASK-030·TASK-031이다.
- `src/features/projects/domain/types.ts`를 포함한 프런트엔드 타입. TASK-030이 한다.
- 실행 한도 사용량 계산. TASK-028이다.
- **조건 스크립트의 판정 규칙 변경**과 `.workflow/rules/*.md` 역할 계약 본문 변경(기획서 제외 범위).
- 앱이 조건 스크립트를 실행해 판정을 얻는 것. 확인 필요 1번이 앱 안 계산으로 확정됐다.
- 어느 문서가 대기 중인지 목록으로 보여주는 것. 기획서는 "막혀 있다"는 사실까지만 다룬다.
- `latest_spec_decisions`·`qa_decision_events`·`read_active_leases`의 순회를 하나로 합치는 리팩터링.
- 등록되지 않은 `.workflow/` 하위 디렉터리를 판정 대상에 넣는 것.

## 참고 사실

확인 시점 2026-08-03. 추정 없이 파일에서 읽은 값이다.

- 조건 스크립트 원본은 `.workflow/rules/wf-eligible.sh`이고, 앱이 설치하는 본문은
  `heartbeat_condition.rs:24`의 `CONDITION_SCRIPT` 상수다. 두 본문은 같아야 하며 그 사실을
  `installs_the_app_version_over_a_drifted_script` 계열 테스트가 지킨다.
- 스크립트는 `.workflow/*/`를 훑는다. `*`는 `.`으로 시작하는 이름을 잡지 않으므로 `.runtime`은
  걸리지 않고, `rules/`는 `ideas`·`decisions`·`tasks` 디렉터리가 없어 건너뛰어진다.
- `read_active_leases`(`:568`)는 `expires_at > now`인 lease만 담는다. 스크립트는 만료를 보지 않는다.
- `workflow_items`(`:842`)가 아이디어 상태를 `adopted`로 바꾸는 근거는
  `adopted_idea_ids`(`:867`)이고, 그것은 `specs/*.md`의 **프론트매터** `source_idea_id`를 모은다.
- `summary_from_manifest`(`:623`)는 다섯 경로가 함께 쓰는 조립 지점이다. `uninitialized_summary`
  (`:649`)만 따로 만든다.
- `MigrationLock`(`:433`)이 `.runtime/migration.lock`을 만들고 `Drop`에서 지운다(`:453`).
  마이그레이션 중에는 활성 lease도 없어야 한다(`:412`).
- `heartbeat_condition.rs`에 이미 `sh`로 스크립트를 돌리는 테스트가 넷 있고 모두 `#[cfg(unix)]`다
  (`:307`, `:323`, `:342`, `:351`). 헬퍼는 `:294`의 `run_condition`이다.
- 이 저장소의 결정 문서는 기획서 결정 9건과 QA 결정 13건이 `decisions/` 한 디렉터리에 섞여 있다.
  기획서 결정은 전부 `outcome: approved`다.
- **알려진 판정 차이.** 아래 셋은 스크립트와 앱이 갈릴 수 있는 지점이다. 이 작업은 스크립트를
  고치지 않으므로 차이를 없애지 않고, 테스트 픽스처는 앱이 실제로 만드는 문서 모양으로만 만든다.
  1. 스크립트는 `grep`으로 파일 아무 곳이나 본다. 앱은 프론트매터만 본다. `tasks/TASK-022.md`
     본문의 프론트매터 예시가 실제 값처럼 잡히는 사례가 이미 있다(REPORT-SPEC-008-ARCH의 핸드오프
     노트에 기록됨).
  2. 스크립트는 `id:` 줄이 없는 문서를 건너뛴다. 앱은 `id`가 없으면 파일 stem을 id로 쓴다
     (`read_markdown_document`, `:929`~`:933`). 앱이 만든 문서에는 항상 `id`가 있다.
  3. 스크립트는 등록 여부와 무관하게 `.workflow/*/`를 본다. 앱은 `project.yml`에 등록된 워크플로우만
     본다.
- `docs/file-contract.md`의 개발 작업 예시 프론트매터에는 지금 `source_spec_id`·`source_decision_id`가
  없다. 실제 작업 문서(TASK-001~027)에는 둘 다 있고, 역할 계약(`roles/architect.md`)이 그것을
  요구한다.
