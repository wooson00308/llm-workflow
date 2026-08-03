---
schema: workflow-labs/task@1
id: TASK-032
title: lease 계약에 역할을 더하고 심장박동·기획서 결정 시각을 화면까지 나른다
status: todo
source_spec_id: SPEC-011
source_decision_id: DECISION-FE4BCCC7
updated_at: 2026-08-03T02:45:00Z
history:
  - { at: 2026-08-03T02:45:00Z, kind: created }
---

# lease 계약에 역할을 더하고 심장박동·기획서 결정 시각을 화면까지 나른다

SPEC-011의 백엔드 몫 전부를 구현한다. 활성 lease의 `heartbeat_at`과 새 선택 필드 `role`을 화면까지
내려보내고, 기획서 결정 문서의 시각을 기획서 항목의 이벤트로 실어 보낸다. 규칙 자산과 파일 계약
문서에 lease 역할 필드를 반영한다.

화면은 한 줄도 건드리지 않는다. 활동 뷰·배너·사이드바는 TASK-033·TASK-034다.

## 의존성

- 선행 작업 없음. SPEC-011의 첫 작업이다.
- 이 작업의 산출물(`AgentLeaseSummary.role`·`heartbeatAt`, 기획서 항목의 `events`)을 TASK-033·
  TASK-034가 화면에서 쓴다. 두 작업은 이 작업 없이는 그릴 값이 없다.
- **TASK-033·TASK-034와 병행 금지.** 이 작업이 `types.ts`를 바꾸고, 두 작업이 그 타입을 읽는다.
- **SPEC-009 계열 TASK-028·TASK-029와 병행 금지.** 셋 다 `src-tauri/src/domain/project.rs`를 만지고,
  TASK-029는 `fs_project_repository.rs`와 `docs/file-contract.md`까지 겹친다. 두 작업 모두 아직
  `todo`다. 순서는 어느 쪽이 먼저여도 된다.
- **SPEC-009 계열 TASK-030과 병행 금지.** `src/features/projects/domain/types.ts`가 겹친다.

## 범위

- `src-tauri/src/domain/project.rs` — `AgentLease.role`, `AgentLeaseSummary`의 두 필드,
  `WorkflowItemSummary.events` 주석.
- `src-tauri/src/infrastructure/fs_project_repository.rs` — `read_active_leases`,
  기획서 결정 이벤트 읽기·병합.
- `src-tauri/src/infrastructure/project_instructions.rs` — 공통 규칙 §4 본문과 버전 표기.
- `src/features/projects/domain/types.ts` — `AgentLeaseSummary`, `WorkflowItemSummary.events` 주석.
- `docs/file-contract.md` — lease 계약 문단.
- 그 외 파일은 건드리지 않는다. 특히 `WorkspaceShell.tsx`·`App.css`·`SettingsView.tsx`는 이 작업에서
  바뀌지 않는다.

## 작업 내용

### 0. 먼저 읽을 제약

- **계약 확장은 기존 문서를 깨지 않는다**(R8, 기획서 완료 조건 28). 지금 디스크에 있는 lease 파일에는
  `role`이 없고, 그 파일들은 계속 읽혀야 한다. `role`이 없다고 파싱이 실패하면 그 lease는 화면에서
  통째로 사라진다 — `read_active_leases`가 파싱 실패한 파일을 조용히 건너뛰기 때문이다. 이것은 활동
  뷰가 "지금 돌고 있는 것"을 보여주는 화면이 된 뒤에 특히 비싼 실패다.
- **파일에 없는 값을 만들어 채우지 않는다**(R3). `role`이 없으면 `None`이다. `agent` 문자열에서
  역할을 잘라내거나 `task_id` 접두사로 역할을 되짚지 않는다. 기획서 25번째 줄이 그 두 방법을 명시적으로
  배제했다.
- **최초 시작 시각은 넣지 않는다**(기획서 확인 필요 2, 승인된 제안). lease에 없는 값이고 이번 계약
  확장에 얹지 않는다. `heartbeat_at`을 시작 시각처럼 부르는 필드 이름·주석도 쓰지 않는다.
- **앱은 lease를 읽기만 한다**(R8, 제외 범위). lease 파일을 만들거나 고치거나 지우는 경로를 추가하지
  않는다. 만료된 lease 파일 정리도 하지 않는다.
- 조회 주기와 조회 횟수를 바꾸지 않는다(R8). 새 커맨드도 새 폴링도 만들지 않는다. 이 작업이 넓히는
  것은 이미 도는 `inspect`가 담아 보내는 값뿐이다.

### 1. lease 계약에 역할을 더한다

`AgentLease`(`domain/project.rs:33`)에 선택 필드를 더한다.

```rust
/// 선점 세션이 스스로 적은 역할. 계약상 선택 필드라 없을 수 있고, 없으면 `None`이다.
/// `#[serde(default)]`가 없으면 이 키가 없는 기존 lease 파일이 파싱에 실패해 화면에서 사라진다.
#[serde(default)]
pub role: Option<String>,
```

`AgentLeaseSummary`(`:152`)에 두 필드를 더한다.

```rust
pub role: Option<String>,
/// lease 파일의 `heartbeat_at` 원문(RFC3339). 최초 시작 시각이 아니다. 화면이 로컬로 바꾼다.
pub heartbeat_at: String,
```

`read_active_leases`(`fs_project_repository.rs:568`)가 두 값을 옮긴다.

- `heartbeat_at`은 원문 그대로 싣는다. 정규화하지 않는다(`TaskEvent.at` 선례).
- `role`은 공백만 있는 값을 `None`으로 접는다. `Some("")`가 화면에 도달하면 "역할 칸이 비어 있다"와
  "역할이 빈 문자열이다"가 화면에서 같은 모양이 되는데, 후자를 만들 이유가 없다.
- 만료 판정·정렬 규칙은 그대로다. `expires_at` 오름차순 정렬을 바꾸지 않는다. 배너의 대표 워커와
  전용 뷰의 첫 카드가 같은 lease를 가리켜야 한다는 요구(R2, 기획서 완료 조건 5)가 이 정렬에 기대고
  있다.

역할 값의 어휘는 역할 계약 파일 이름과 같은 `planner`·`architect`·`developer` 셋이다. 백엔드는 값을
검사하지 않고 원문을 그대로 옮긴다. 계약을 어긴 세션을 드러내는 것이 이 화면의 목적이므로, 앱이 모르는
값을 걸러 내면 그 사실이 사라진다.

### 2. 기획서 결정을 이벤트로 싣는다

`qa_decision_events`(`fs_project_repository.rs:1049`)와 같은 모양의 함수를 만든다.

```rust
fn spec_decision_events(workflow_root: &Path) -> HashMap<String, Vec<TaskEvent>>
```

- 대상은 `decisions/*.md` 중 `schema: workflow-labs/decision@1`이고 `created_by: user`인 문서다.
  두 조건은 `latest_spec_decisions`(`:1127`)와 같다.
- `spec_id`·`created_at`이 없거나 `created_at`이 RFC3339로 파싱되지 않으면 그 문서만 건너뛴다
  (R5, 기획서 완료 조건 20).
- `kind`는 `outcome` 원문이고 `approved`·`revision_requested`·`rejected` 셋만 받는다. 그 밖의 값은
  건너뛴다.
- 중복 제거는 하지 않는다. 작업 이벤트는 두 원천(작업 문서 이력 + QA 결정)을 합치느라 dedup이
  필요했지만, 기획서 결정은 원천이 결정 문서 하나뿐이고 앱이 결정 하나당 문서 하나를 쓴다.

`workflow_items`(`:842`)에서 기획서 항목에 병합한다. `merge_qa_decision_events`와 같은 자리다.

- 한 기획서에 결정이 여럿이면 전부 싣는다. 감사 로그는 추가 전용이고, "언제 승인됐고 언제 반려됐나"가
  피드가 답해야 할 질문이다.
- 시각 오름차순으로 정렬한다. 작업 이벤트와 같은 규칙이라 화면이 원천마다 다른 가정을 하지 않는다.
- `spec.status`를 덮어쓰는 `latest_spec_decisions` 경로는 그대로 둔다. 두 함수가 같은 디렉터리를 각각
  읽는 것은 지금도 `latest_spec_decisions`와 `qa_decision_events`가 그러고 있는 형태다.

`WorkflowItemSummary.events`(`domain/project.rs:100`)의 주석이 "아이디어·기획서에서는 항상 비어 있다"라고
말하고 있다. 이 작업이 그것을 거짓으로 만드므로 같은 편집에서 고친다. 타입 이름(`TaskEvent`)은 바꾸지
않는다 — 이름을 바꾸면 프론트엔드 타입과 `DevelopmentBoard`까지 번지고, 이 작업의 범위가 아니다.
`kind` 값의 뜻이 문서 종류에 따라 다르다는 사실(기획서의 `revision_requested`는 "수정 요청",
개발 작업의 `revision_requested`는 "반려")을 주석에 남긴다. 라벨을 가르는 것은 TASK-034다.

### 3. 규칙 자산

`project_instructions.rs`의 `WORKFLOW_RULES` §4 "Claim work before starting it"을 고친다.

- lease 예시 YAML 블록(`:92`~`:99`)에 `role: <planner|architect|developer>` 줄을 더한다.
- 블록 뒤의 `task_id` 설명(`:101`) 옆에 역할 설명 한 줄을 더한다: 이 세션이 쓰는 역할 계약 이름을
  `role`에 적는다. 값이 없는 기존 lease도 유효한 선택 필드이지만, 새로 선점하는 세션은 적는다.
- `rules_version: 4` → `5`(`:48`)와 `WORKFLOW_RULES_VERSION`(`:21`) 둘 다 올린다. 한 곳만 올리면
  `validate_project_instructions`가 방금 설치한 파일을 미래 버전으로 보고 `create_workflow`를 막는다.
  이 위험 때문에 TASK-022가 상수를 만들었으니 상수와 본문 리터럴 두 자리를 함께 고친다.
- 역할 계약 셋(`PLANNER_RULES`·`ARCHITECT_RULES`·`DEVELOPER_RULES`)은 바꾸지 않는다. 선점은 세 역할
  공통 절차라 공통 규칙에만 적는다. `ROLE_RULES_VERSION`은 `3` 그대로다.

`docs/file-contract.md`의 lease 문단(`:158`)에 한 문장을 더한다: lease에는 선점 세션의 역할을 적는 선택
필드 `role`이 있고 값은 `planner`·`architect`·`developer`이며, 값이 없는 lease도 유효하다.

### 4. 타입스크립트 타입

```ts
export interface AgentLeaseSummary {
  leaseId: string;
  agent: string;
  /** 선점 세션이 적은 역할. 계약상 선택 필드라 없으면 null이다. 추정으로 채우지 않는다. */
  role: string | null;
  taskId: string | null;
  /** lease 파일의 `heartbeat_at` 원문(RFC3339). 최초 시작 시각이 아니다. */
  heartbeatAt: string;
  expiresAt: string;
}
```

이 저장소의 프론트엔드 테스트 픽스처는 모두 `activeLeases: []`라서(`WorkspaceShell.test.tsx:15`,
`SettingsView.test.tsx:15`, `ProjectSetup.test.tsx:12`, `useProjectWorkspace.test.ts:17`) 필수 필드를
더해도 픽스처를 고칠 필요가 없다. 선택 필드로 두지 않는 이유이기도 하다 — 두 값은 항상 내려온다.

`WorkflowItemSummary.events`의 주석도 Rust 쪽과 같은 내용으로 고친다.

### 5. 테스트

Rust (`fs_project_repository.rs`):

- `role`이 있는 lease와 없는 lease를 함께 두고 조회하면, 있는 쪽은 값이 실리고 없는 쪽은 `None`이며
  **둘 다 목록에 있다**. (기획서 완료 조건 28·31의 백엔드 몫)
- `role: "   "`인 lease가 `None`으로 나온다.
- `heartbeat_at`이 요약에 실리고 원문 그대로다(`+00:00`이 `Z`로 바뀌지 않는다).
  (기획서 완료 조건 8)
- 깨진 lease 파일(YAML이 아닌 내용)과 정상 lease를 함께 두면 정상 lease만 나오고 조회는 성공한다.
  기존 `reports_only_non_expired_agent_leases`(`:1352`)와 같은 형태로 만든다. (기획서 완료 조건 11)
- 기획서 결정 문서 셋(승인·수정 요청·폐기)을 두면 해당 기획서 항목의 `events`에 셋이 시각 오름차순으로
  실린다. 한 기획서에 결정이 둘이면 둘 다 남는다. (기획서 완료 조건 19)
- `created_by: agent`인 결정, `created_at`이 시각이 아닌 결정, `outcome`이 세 값 밖인 결정, 프론트매터가
  깨진 파일이 섞여 있어도 정상 결정만 실리고 나머지 항목이 정상으로 나온다.
  (기획서 완료 조건 20)
- 워크플로우가 둘인 프로젝트에서 각 기획서 항목이 자기 워크플로우의 결정만 받는다.
  (기획서 완료 조건 21의 백엔드 몫)
- 작업 항목의 `events`는 이 변경으로 달라지지 않는다. 기존 QA 병합 테스트가 그대로 통과한다.
- `inspect`를 부른 전후로 `.workflow` 아래 파일들의 수정 시각이 그대로다. `heartbeat_status.rs`의
  `reading_the_status_does_not_touch_the_heartbeat_home`(`:604`)과 같은 형태로 만든다. 조회가 읽기
  전용이라는 것을 파일 수준에서 고정한다. (기획서 완료 조건 25·26의 백엔드 몫)

Rust (`project_instructions.rs`):

- 설치된 공통 규칙에 `rules_version: 5`와 `role`이 있다.
- 아키텍트·개발자·기획자 계약의 버전이 각각 `3`·`3`·`2`로 그대로다.
- 옛 버전(공통 4)이 설치된 컨트롤 루트에 `install_project_instructions`를 부르면 새 버전으로 갱신된다.
  기존 `upgrades_managed_v1_rules_and_installs_role_contracts` 계열 테스트와 같은 형태로 만든다.
  (기획서 완료 조건 31)
- `install_project_instructions` 직후 `validate_project_instructions`가 통과한다. 버전 상수를 한 군데만
  올렸을 때 잡히는 테스트다.

## 완료 조건

1. lease의 `heartbeat_at`이 화면이 받는 요약에 실린다. (기획서 완료 조건 8)
2. lease 계약에 역할이 선택 필드로 정의되고, 값이 있으면 원문 그대로 실린다.
   (기획서 완료 조건 31의 계약·백엔드 몫)
3. `role`이 없는 기존 lease 파일이 계속 유효하고 목록에서 사라지지 않는다.
   (기획서 완료 조건 28)
4. 형식이 깨진 lease 파일이 있어도 나머지 lease가 정상으로 조회된다. (기획서 완료 조건 11의 백엔드 몫)
5. 기획서 결정의 종류와 시각이 기획서 항목의 이벤트로 화면까지 도달한다. (기획서 완료 조건 19)
6. 깨진 결정 문서가 있어도 나머지 결정이 정상으로 실린다. (기획서 완료 조건 20의 백엔드 몫)
7. 결정 이벤트가 워크플로우 경계를 넘지 않는다. (기획서 완료 조건 21의 백엔드 몫)
8. 앱이 설치하는 공통 규칙에 역할 필드 의무가 반영되고 `rules_version`이 오르며, 옛 버전이 설치된
   프로젝트가 갱신된 규칙을 받는다. (기획서 완료 조건 31)
9. 조회가 `.workflow` 아래 어떤 파일도 바꾸지 않는다. (기획서 완료 조건 25·26의 백엔드 몫)
10. 조회 커맨드·조회 주기가 늘거나 바뀌지 않는다. (기획서 완료 조건 27의 백엔드 몫)
11. 화면 동작이 바뀌지 않는다. 기존 프론트엔드 테스트가 수정 없이 통과한다.
12. `npm run check`와 `cargo fmt --check`·`cargo clippy -D warnings`·`cargo test`가 통과한다.
    (기획서 완료 조건 32)

## 검증 절차

```sh
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
npm run check
```

화면 확인은 이 작업에서 하지 않는다. payload만 바뀌고 화면은 아직 새 값을 읽지 않는다.

## 범위 밖

- 화면의 어떤 변경도. 사이드바 메뉴·배너·활동 뷰는 TASK-033·TASK-034다.
- lease에 최초 시작 시각을 더하는 것. 기획서 확인 필요 2의 승인된 제안이 넣지 않기로 정했다.
- lease 파일 쓰기·삭제·만료 파일 정리. 기획서 제외 범위다.
- 읽지 못한 lease 파일이 있다는 사실을 사용자에게 알리는 것. 기획서는 R3에서 "읽을 수 있는 lease만
  그린다"까지만 정했다.
- `latest_spec_decisions`를 새 이벤트 함수로 대체하는 리팩터링. 최신 판정의 동률 처리(`created_at`
  문자열 비교)가 이벤트 수집과 규칙이 달라서, 합치면 기획서 상태 판정 동작이 조용히 바뀐다.
- `read_spec`이 돌려주는 단일 문서에 결정 이벤트를 싣는 것. 기획서 화면은 이 값을 쓰지 않는다.
- `TaskEvent` 타입 이름 변경, 스키마 식별자 변경.
- 역할 값의 유효성 검사나 정규화(대소문자 접기 등). 계약 위반을 드러내는 것이 화면의 목적이다.

## 참고 사실

확인 시점 2026-08-03. 추정 없이 파일에서 읽은 값이다.

- `AgentLease`는 `domain/project.rs:33`, `AgentLeaseSummary`는 `:152`다. 요약은 네 필드
  (`lease_id`·`agent`·`task_id`·`expires_at`)뿐이고 `heartbeat_at`은 파일에서 읽히지만 버려진다
  (`fs_project_repository.rs:594`).
- `read_active_leases`(`:568`)는 `.yml`이 아닌 파일, 열지 못한 파일, 파싱 실패한 파일, `expires_at`이
  RFC3339가 아닌 파일을 각각 `continue`로 건너뛴다. 실패가 화면에 흔적을 남기지 않는다.
- 만료 판정은 `expires_at > now`이고, 정렬은 `expires_at` 오름차순이다(`:602`). 배너가
  `activeLeases[0]`을 대표로 쓴다(`WorkspaceShell.tsx:319`).
- lease 디렉터리는 `.workflow/.runtime/leases` 하나이고(`:569`) lease 문서에 워크플로우를 가리키는 값이
  없다.
- `qa_decision_events`(`:1049`)가 QA 결정 문서를 작업 이벤트로 바꾸고 `merge_qa_decision_events`(`:1093`)가
  같은 순간·같은 종류를 한 번만 남긴다. 기획서 결정 쪽에는 대응물이 없다.
- `latest_spec_decisions`(`:1127`)는 `created_at`을 최신 판정 비교에만 쓰고, `apply_latest_decision`
  (`:1167`)이 `outcome`으로 기획서 `status`를 덮어쓴다. 결정 시각은 화면으로 내려가지 않는다.
- `workflow_items`(`:842`)는 이미 `decisions/`를 두 번 읽는다(`latest_spec_decisions`,
  `qa_decision_events`). 이 저장소의 `decisions/`에는 문서 24건이 있다.
- 규칙 설치 경로는 `install_project_instructions`(`project_instructions.rs:302`)이고 호출처는
  `create_workflow`·`record_spec_decision`·`record_task_qa` 셋이다. 사용자가 기획서를 승인하거나 QA를
  기록할 때 이 저장소 자신의 `.workflow/rules/*`도 갱신된다.
- `plan_rules_file`(`:378`)은 파일 버전이 현재 값보다 **클 때만** 충돌로 본다. 공통 규칙만 올리고 역할
  계약을 그대로 두어도 안전하다.
- `WORKFLOW_RULES_VERSION`은 `:21`, 본문 `rules_version: 4`는 `:48`이다. 두 자리가 같아야 한다.
- 이 저장소의 lease 파일에는 `role` 키가 없다. 계약에 없던 필드이기 때문이다.
