# TASK-032 개발자 핸드오프

- 대상 작업: TASK-032 (lease 계약에 역할을 더하고 심장박동·기획서 결정 시각을 화면까지 나른다)
- 근거 문서: SPEC-011 R3·R5·R8, DECISION-FE4BCCC7 (approved, created_by: user)
- 세션 역할: 개발자
- 작성 시각: 2026-08-03T07:20Z
- 상태: `qa_waiting`

## 대상 선정 근거

- 착수 시점(07:08Z) `todo`는 TASK-032~047 열여섯 건. TASK-032가 그중 첫 건이고 선행 작업이 없다.
- `migration.lock` 없음. `.workflow/.runtime/leases`에는 `SPEC-009.yml` 하나뿐이고 만료 시각이
  01:20Z라 이미 만료 상태였다. 남의 lease라 지우지 않았고, 대상도 다르다.
- 병행 금지 상대 확인: TASK-033·034는 `todo`이고 아무도 선점하지 않았다(진행 중이 아니다).
  SPEC-009 계열 TASK-028·029·030은 작업 문서가 쓰인 시점과 달리 지금 전부 `qa_waiting`이라
  구현이 끝나 있다. 겹치는 파일(`domain/project.rs`·`fs_project_repository.rs`·`types.ts`·
  `docs/file-contract.md`)에 동시 작업이 없음을 확인하고 착수했다.
- 소스 결정 DECISION-FE4BCCC7은 `approved`로 유효하다.
- 선점: `leases/TASK-032.yml` 배타 생성(`set -o noclobber`) → 즉시 `status: in_progress` +
  `history` 기록 → 구현 → `qa_waiting` → lease 반납.

## 요약

`inspect`가 이미 담아 보내는 payload를 두 군데 넓혔다. 활성 lease가 `role`·`heartbeat_at`을 싣고,
기획서 항목이 사용자 결정을 `events`로 싣는다. 규칙 자산의 lease 계약에 `role`을 넣고 공통 규칙
버전을 5로 올렸다. 화면 코드는 한 줄도 바꾸지 않았고, 새 커맨드·새 폴링도 만들지 않았다.

## 변경한 파일 (5건, 작업 범위 그대로)

- `src-tauri/src/domain/project.rs`
  - `AgentLease.role: Option<String>` + `#[serde(default)]`. 이 속성이 없으면 `role` 키가 없는
    기존 lease가 파싱에 실패해 목록에서 통째로 사라진다(`read_active_leases`가 실패한 파일을
    조용히 건너뛴다).
  - `AgentLeaseSummary`에 `role: Option<String>`·`heartbeat_at: String`. 주석에 "최초 시작 시각이
    아니다"를 명시했다.
  - `WorkflowItemSummary.events` 주석 수정. "아이디어·기획서에서는 항상 비어 있다"가 이 작업으로
    거짓이 됐다. `kind`의 뜻이 문서 종류에 따라 다르다는 사실(기획서 `revision_requested` =
    "수정 요청", 개발 작업 = "반려")도 같은 주석에 남겼다. 타입 이름은 `TaskEvent` 그대로다.
- `src-tauri/src/infrastructure/fs_project_repository.rs`
  - `read_active_leases`: `heartbeat_at`을 원문 그대로 싣고, `role`은 `filter(|v| !v.trim().is_empty())`로
    공백만 있는 값을 `None`으로 접는다. 값 검사·정규화·대소문자 접기는 하지 않는다 — 계약을 어긴
    세션을 드러내는 것이 이 값을 그리는 화면의 목적이다. 만료 판정과 `expires_at` 오름차순 정렬은
    손대지 않았다(배너 대표와 전용 뷰 첫 카드가 같은 lease를 가리켜야 한다는 R2에 이 정렬이 걸려 있다).
  - `spec_decision_events` 신설. 결정 하나가 이벤트 하나이고, `created_at`이 RFC3339로 읽히지
    않으면 그 문서만 건너뛴다. 한 기획서에 결정이 여럿이면 전부 싣고 시각 오름차순으로 정렬한다.
    중복 제거는 하지 않는다(원천이 결정 문서 하나뿐이다).
  - `workflow_items`: `latest_spec_decisions`로 상태를 덮어쓰는 자리 바로 뒤에서 기획서 항목에
    이벤트를 병합한다. `latest_spec_decisions`/`apply_latest_decision` 경로는 그대로 뒀다.
- `src-tauri/src/infrastructure/project_instructions.rs`
  - `WORKFLOW_RULES_VERSION` 4 → 5, 본문 `rules_version: 4` → `5`. **두 자리를 함께** 고쳤다.
    한쪽만 올리면 `validate_project_instructions`가 방금 설치한 파일을 미래 버전으로 보고
    `create_workflow`를 막는다.
  - §4 lease 예시 YAML에 `role: <planner|architect|developer>` 한 줄, 블록 뒤에 역할 설명 한 줄.
  - 역할 계약 셋과 `ROLE_RULES_VERSION`(3)은 그대로다. 선점은 세 역할 공통 절차라 공통 규칙에만 적었다.
- `src/features/projects/domain/types.ts`
  - `AgentLeaseSummary`에 `role: string | null`·`heartbeatAt: string`(둘 다 필수 필드 — 항상
    내려온다). `WorkflowItemSummary.events` 주석을 Rust와 같은 내용으로 맞췄다.
- `docs/file-contract.md`
  - lease 문단에 한 문장. 선택 필드 `role`, 값은 세 역할 이름, 값이 없는 lease도 유효.

화면 파일(`WorkspaceShell.tsx`·`App.css`·`SettingsView.tsx`) 무변경. 새 커맨드·새 폴링 없음.

## 작업 문서와 다르게 한 것 (1건)

작업 문서 §2는 `fn spec_decision_events(workflow_root: &Path)`를 지시했지만,
`fn spec_decision_events(records: &[SpecDecisionRecord])`로 만들었다.

- 근거: 작업 문서의 "참고 사실"이 "`workflow_items`는 이미 `decisions/`를 두 번 읽는다
  (`latest_spec_decisions`, `qa_decision_events`)"라고 적었는데, 실제 코드에서 `latest_spec_decisions`는
  디렉터리를 읽지 않고 이미 읽어 둔 `&[SpecDecisionRecord]`를 받는다. 디렉터리를 실제로 훑는 곳은
  `read_spec_decisions`와 `qa_decision_events` 둘이다. 지시대로 `&Path`를 받으면 훑는 횟수가 셋이
  되는데, `SpecDecisionRecord`의 기존 주석이 "두 판정 때문에 결정 디렉터리를 두 번 훑지 않는다"라고
  그 반대를 못 박고 있다. 2.5초마다 도는 조회에서 결정 문서 24건을 한 번 더 읽는 비용을 코드가
  명시적으로 피해 온 형태를 깨지 않았다.
- 동작 차이: 없음에 가깝다. `read_spec_decisions`가 이미 `schema: workflow-labs/decision@1`,
  `created_by: user`, `spec_id` 존재, `outcome` 세 값을 모두 거른다. 작업 문서가 요구한 필터와 같다.
  유일한 차이는 `read_spec_decisions`가 `id`도 요구한다는 것이라, `id` 없는 결정 문서는 이벤트가
  되지 않는다. 앱은 결정을 쓸 때 항상 `id`를 넣고, 조건 스크립트도 `id` 없는 결정을 건너뛴다.
- 완료 조건 5·6·7은 함수 모양이 아니라 화면에 도달하는 값을 묻고, 아래 테스트가 셋 다 고정한다.

## 검증

```
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check            # 통과
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings   # 경고 0
cargo test --manifest-path src-tauri/Cargo.toml                      # 200 passed / 0 failed
npm run check                                                        # tsc + vitest + build 전부 통과
```

- Rust: 200 통과(직전 192에서 +8). 삭제·비활성화한 테스트 없음.
- 프론트엔드: 221 tests / 13 files 통과. **테스트 파일을 한 줄도 고치지 않았다** — 픽스처가 모두
  `activeLeases: []`라 필수 필드를 더해도 깨지지 않는다(완료 조건 11).
- 기존 테스트 수정은 3줄뿐이고 모두 버전 상수 때문이다: `project_instructions.rs`의
  `assert!(rules.contains("rules_version: 4"))` 셋 → `5`.

### 새 테스트 (8건)

`fs_project_repository.rs`

| 테스트 | 대응 |
| --- | --- |
| `carries_the_lease_role_and_heartbeat_without_rewriting_them` — `role` 없는 lease·`role: architect`·`role: "   "` 셋을 함께 두면 **셋 다 목록에 있고** 역할이 각각 `None`·`Some("architect")`·`None`이며, `heartbeat_at`의 `+00:00`이 `Z`로 바뀌지 않는다 | 완료 조건 1·2·3 (기획서 8·28·31) |
| `reports_the_readable_leases_when_one_file_is_broken` — YAML이 아닌 lease와 정상 lease를 함께 두면 정상 lease만 나오고 조회는 성공한다 | 완료 조건 4 (기획서 11) |
| `carries_spec_decisions_as_events_in_time_order` — 승인·수정 요청·폐기 세 결정이 해당 기획서의 `events`에 시각 오름차순으로 실리고, 한 기획서에 결정이 둘이면 둘 다 남는다 | 완료 조건 5 (기획서 19) |
| `skips_unreadable_spec_decisions_and_keeps_the_others` — `created_by: agent`·시각 아닌 `created_at`·세 값 밖 `outcome`·프론트매터 없는 파일을 섞어도 정상 결정 하나만 실린다 | 완료 조건 6 (기획서 20) |
| `keeps_spec_decision_events_inside_their_workflow` — 워크플로우 둘에 같은 id의 기획서를 두고 한쪽에만 결정을 쓰면 그쪽에만 이벤트가 생긴다 | 완료 조건 7 (기획서 21) |
| `inspecting_the_project_does_not_touch_the_workflow_files` — lease·기획서·결정·이력 있는 작업을 둔 상태로 `inspect` 전후의 `.workflow` 아래 모든 파일 경로·수정 시각이 같다 | 완료 조건 9 (기획서 25·26) |

`project_instructions.rs`

| 테스트 | 대응 |
| --- | --- |
| `records_the_lease_role_field_in_the_installed_rules` — 설치된 공통 규칙에 `rules_version: 5`와 `role` 줄·설명이 있고, 역할 계약 셋의 버전이 3·3·2로 그대로다 | 완료 조건 8 (기획서 31) |
| `upgrades_rules_installed_before_the_lease_role_field` — 공통 4가 설치된 컨트롤 루트에 설치하면 5로 갱신되고, 그 결과가 `validate_project_instructions`를 통과한다 | 완료 조건 8 (기획서 31) |

작업 문서가 요구한 "`install` 직후 `validate` 통과"는 기존 `validates_the_instructions_it_just_installed`가
이미 고정하고 있어 중복 테스트를 만들지 않았다. 버전 상수를 한 군데만 올리면 그 테스트가 잡는다
(작업 중 실제로 확인했다). 작업 이벤트가 이 변경으로 달라지지 않는다는 것은 기존 QA 병합 테스트
(`records_a_confirmed_transition_with_the_qa_decision_time` 계열)가 수정 없이 통과하는 것으로 고정된다.

`inspect` 무변경 테스트는 mtime 비교라, 파일시스템의 시각 해상도가 거친 환경에서는 이론상 실패를
놓칠 수 있다. `heartbeat_status.rs`의 같은 형태 테스트와 동일한 한계다.

## 사용자 QA에서 확인할 것

이 작업은 payload만 바꾸고 화면은 아직 새 값을 읽지 않아, 눈으로 확인할 화면 변화가 없다.
확인할 것은 "아무것도 안 바뀌었는가"와 규칙 자산이다.

1. 앱을 띄워 오늘 화면 배너·설정 화면의 활성 lease 개수가 지금까지와 같은지. 이 저장소의 lease
   파일에는 `role`이 없으므로, 배너가 사라지거나 개수가 줄면 그게 회귀다.
2. 기획서 목록의 상태(승인·수정 요청·폐기)가 그대로인지. 결정 이벤트를 새로 싣지만 상태 판정
   경로는 건드리지 않았다.
3. 기획서를 승인하거나 QA를 기록하면 `install_project_instructions`가 돌아
   `.workflow/rules/workflow.md`가 `rules_version: 5`로 갱신되고 lease 예시에 `role` 줄이 생기는지.
   **이 저장소의 `.workflow/rules/workflow.md`는 앱 소유 자산이라 이 세션이 손으로 고치지 않았다.**
   지금은 아직 4이고, 다음 앱 쓰기에서 5가 된다.

## 후속 / 리스크

- **화면은 아직 새 값을 안 쓴다.** `role`·`heartbeatAt`·기획서 `events`는 payload에만 있다.
  TASK-033·034가 이것을 그린다. 두 작업은 `types.ts`를 읽으므로 이 작업과 병행하면 안 됐고,
  이제 이 작업이 끝나 순서가 열렸다.
- **이 세션의 lease에는 `role: developer`를 적었다.** 계약이 방금 생긴 필드라 아직 규칙 파일에는
  반영 전(위 QA 3번)이지만, `AgentLease`가 알 수 없는 필드를 거부하지 않으므로 변경 전 코드에서도
  안전하다. 다음 세션부터 세 역할이 이 필드를 적으면 화면에 사실이 쌓인다.
- **역할 값은 검사하지 않는다.** `role: 개발자`처럼 계약 밖 값이 오면 그대로 화면에 도달한다.
  의도된 동작이다(계약 위반을 드러내는 것이 목적). 화면이 이 값을 라벨로 쓸 때 모르는 값을 어떻게
  그릴지는 TASK-033의 몫이다.
- **읽지 못한 lease·결정 문서는 흔적을 남기지 않는다.** 기획서가 R3에서 "읽을 수 있는 lease만
  그린다"까지만 정했고 이 작업도 거기까지다. 파싱 실패를 사용자에게 알리는 경로는 없다.
- **역할 밖 발견(고치지 않음)**: 만료된 lease `SPEC-009.yml`(2026-08-03T01:20Z 만료)이 아직 남아
  있다. 남의 lease라 건드리지 않았다. TASK-029·030·031 보고서도 같은 사실을 남겼다.
- **역할 밖 발견(고치지 않음)**: `latest_spec_decisions`의 최신 판정이 `created_at` **문자열**
  비교라, 같은 순간을 `Z`와 `+00:00`으로 달리 적은 결정이 섞이면 최신 판정이 뒤집힐 수 있다.
  새로 만든 `spec_decision_events`는 파싱한 순간으로 정렬해 이 문제가 없다. 작업 문서가 두 경로를
  합치는 리팩터링을 명시적으로 범위 밖에 뒀으므로 그대로 뒀다.
- SPEC-011의 남은 몫은 TASK-033(활동 뷰·배너 입구)·TASK-034(피드)다.
