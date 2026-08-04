# TASK-060 개발자 핸드오프

> 기록 경위: 세션 하네스가 보고서 파일 작성을 차단해, 세션이 채팅으로 보낸 전문을 TL이 그대로 기록했다.

- 대상 작업: TASK-060 (앱의 개발자 대기 물량 판정이 선행 선언을 조건 스크립트와 같은 기준으로 확인한다)
- 근거 문서: SPEC-013 R2·R3 및 완료 조건 8, DECISION-73D4BC1B (approved, created_by: user)
- 세션 역할: 개발자 (dev-060)
- 작성 시각: 2026-08-03T12:45Z
- 상태: `qa_waiting`

## 대상 선정 근거

- TL이 배정한 단일 작업이다. 착수 시점(12:36Z) `status: todo`.
- 선행 선언 `depends_on: [TASK-056]`은 충족이다. TASK-056 `qa_waiting`, 사슬 앞의 TASK-055도 `qa_waiting`, 재사용 대상인 TASK-037·TASK-040도 `qa_waiting`이다.
- `migration.lock` 없음. `leases/`에는 `SPEC-009.yml`(만료)·`TASK-049.yml`·`TASK-058.yml`이 있었고 `TASK-060.yml`은 없었다. 남의 lease는 읽지도 지우지도 않았다.
- 선점: `.workflow/rules/wf-claim.sh`가 미설치라 공통 규칙 §4의 폴백을 썼다. `set -o noclobber`로 `leases/TASK-060.yml` 배타 생성 → 같은 편집에서 `in_progress` + `history` 기록 → 구현 → `qa_waiting` → 소유자 확인 후 lease 삭제.

## 변경한 파일

두 개뿐이다. 화면·`types.ts`·조건 스크립트·`domain/project.rs`는 무변경이다.

- `src-tauri/src/infrastructure/fs_project_repository.rs`
  - `unsatisfied_dependency_task_ids()` 추가. 그래프의 각 작업에 대해 상세 화면이 쓰는 `task_dependencies()`를 그대로 호출하고, 형식 오류이거나 `Satisfied`가 아닌 선행이 하나라도 있으면 미충족으로 접는다. 판정 규칙을 새로 쓰지 않았다 — TASK-037의 파서·판정을 부르는 배선이다.
  - `PreparedWorkflow`에 `unsatisfied_dependencies: HashSet<String>` 필드 추가. `read()`에서 `task_dependency_graph(&root.join("tasks"))`로 채운다.
  - `summary_from_manifest()`의 `WorkflowInput` 리터럴에 그 값을 싣는다.
- `src-tauri/src/infrastructure/role_eligibility.rs`
  - `WorkflowInput`에 `unsatisfied_dependencies: &HashSet<String>` 필드 추가.
  - `has_developer_work`에 셋째 조건 추가. 최종 형태는 `task.status == "todo" && !lease_ids.contains(&task.id) && !workflow.unsatisfied_dependencies.contains(&task.id)`이다.
  - 모듈 문서에서 TASK-040이 남긴 미배선 항목 제거(아래 "지운 것 / 남긴 것").
  - 동치 테스트 7개 추가. 기존 테스트 중 고친 것은 `a_lease_blocks_the_same_id_in_every_workflow` 하나뿐이고, 새 필드 때문에 구조체 리터럴에 한 줄 늘린 것이 전부다.

## 핵심 결정과 근거

1. **판정 결과를 `HashSet<String>`으로 넘긴다.** `role_eligibility`가 선언을 다시 파싱하지 않는다. 이 모듈은 "파일 시스템을 만지지 않고 값만 받는다"가 원래 성질이고, 규칙 구현이 두 벌이 되면 이 작업이 닫으려는 그 균열이 한 겹 더 생긴다. 파싱과 판정은 `fs_project_repository`에 한 벌로 남고 이 모듈은 결론만 받는다.
2. **집합에 "미충족"을 담는다("충족"이 아니라).** 집합에 없는 id는 제약이 없는 것으로 떨어진다. 선언 없는 작업, 그래프에 잡히지 않은 작업이 모두 자동으로 충족 쪽이 되어 조건 스크립트와 같다. 반대로 담았다면 값이 비는 모든 경로가 "전부 미충족"으로 기울어 대기 물량이 통째로 사라졌을 것이다.
3. **`WorkflowItemSummary`는 건드리지 않았다.** TASK-037의 제약 그대로다. 대신 `tasks/`를 판정용으로 한 번 더 훑는다(리스크 1번).
4. **판정 순서·기준을 새로 정하지 않았다.** `Missing` → `Cyclic` → 상태, `qa_waiting`·`completed`만 충족, 형식 오류는 그 작업만 미충족. 전부 `task_dependencies`/`dependency_state`가 이미 가진 것이고 TASK-040이 sh로 옮긴 것과 같은 규칙이다.

### 모듈 문서에서 지운 것 / 남긴 것

지운 것은 **TASK-040이 남긴 미배선 항목 하나뿐**이다. "아직 맞추지 못한 것" 소제목으로 시작하는 두 문단 — 조건 스크립트 v2는 선언을 판정하는데 이 모듈은 보지 않는다는 서술, 그리고 배선하려면 `task_dependency_graph`를 `summary_from_manifest`까지 끌어와야 하고 그 일은 TASK-060이 맡는다는 서술이다. 이번 배선으로 사실이 아니게 되었으므로 제거했다.

남긴 것:

- 원래부터 있던 "알려진 차이" 다섯 항목 전부 — (1) 스크립트의 `grep`이 본문까지 봄, (2) `id:` 없는 문서 처리, (3) 미등록 워크플로우 디렉터리, (4) lease `expires_at` 표기 파싱 차이, (5) 결정 문서 필터 차이. 전부 별건이고 이 작업의 범위 밖이다.
- TASK-043이 더한 "이 대조는 세 플랫폼 러너에서 모두 돈다" 문장.

즉 모듈 문서의 머리 구조는 "알려진 차이 다섯 + 플랫폼 문장"으로 남고, 미배선 부채 문단만 사라졌다.

## 검증 단계와 결과

```
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check                        통과 (exit 0)
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings    통과 (exit 0)
cargo test --manifest-path src-tauri/Cargo.toml                                   352 passed / 0 failed
npm run check                                                                     통과 (exit 0)
                                                                                  타입체크 + 327 passed / 14 files + 빌드 성공
```

- `role_eligibility` 테스트는 28개에서 35개가 되었다. `#[ignore]`를 붙이거나 삭제한 테스트는 없다(두 파일 모두 `#[ignore]` 0건).
- 새 테스트는 전부 `assert_matches_condition_script`를 지난다. 즉 앱 판정과 실제 `sh` 실행 결과를 세 역할 모두에서 대조한다. 규칙만이 아니라 배선까지 고정한다.

### 추가한 동치 테스트 시나리오 (작업 문서 최소 목록 전부)

- 선언 없는 todo (현행과 동일) — 기존 `a_todo_task_is_developer_work` — developer true
- 충족된 선언 (`qa_waiting`·`completed` 둘 다) — `a_todo_task_with_satisfied_dependencies_is_developer_work` — developer true
- 빈 목록 `[]` — `an_empty_declaration_leaves_the_task_open` — developer true
- 미충족 선언만 남음 (선행 `todo`·`in_progress`·`blocked` 셋 다) — `only_unsatisfied_dependencies_leave_no_developer_work` — 스크립트 1 = 앱 false
- 없는 id / 자기 참조 / 상호 순환 — `a_declaration_that_can_never_be_satisfied_is_not_developer_work` — developer false
- 형식 오류 4종 — `a_malformed_declaration_is_not_developer_work` — developer false
- 만료 lease 조합 (TASK-055 기준 유지) — `an_expired_lease_does_not_change_how_a_declaration_is_judged` — 충족이면 true, 미충족이면 false
- 충족 + 미만료 lease — `a_lease_still_hides_a_task_whose_dependencies_are_satisfied` — developer false

세부 두 가지: 순환 시나리오는 선행이 `completed`인데도 고리 때문에 미충족이어야 하는 경우를 함께 본다. 형식 오류 4종은 `TASK-001`(괄호 없음), `["TASK-001"]`(따옴표), `[TASK-001`(닫히지 않음), `[TASK-001, ]`(빈 토큰)이고, 뒤 두 값은 프론트매터 자체가 YAML로 파싱되지 않는 경우이기도 하다 — 그때 id가 파일 stem으로, 상태가 기본값 `todo`로 떨어지는데도 두 판정이 갈라지지 않는 것을 함께 고정한다.

### 역행 검증

`has_developer_work`의 셋째 조건을 임시로 무력화하고 돌려, 새 테스트 중 4개(`only_unsatisfied…`, `a_declaration_that_can_never…`, `a_malformed…`, `an_expired_lease_does_not_change…`)가 정확히 `developer 판정이 조건 스크립트와 다르다`로 실패하는 것을 확인한 뒤 되돌렸다(31 passed / 4 failed). 나머지 3개는 배선 전에도 통과한다 — 두 판정이 원래 같던 구간이라 그렇고, 그 사실을 테스트 주석에도 적었다. 최종 게이트는 되돌린 상태에서 다시 돌린 수치다.

### 완료 조건 대조

1. 의존 미충족 `todo`만 남은 픽스처에서 스크립트와 앱이 같은 결론(대상 없음) — 충족.
2. "알려진 차이" 중 TASK-040 항목 제거 + 동치 테스트에 선언 시나리오 포함 — 충족.
3. `planner`·`architect` 판정 전후 동일 — 충족. 두 함수는 한 글자도 바꾸지 않았고, 두 역할의 기존 테스트가 전부 수정 없이 통과한다. 새 테스트도 세 역할을 모두 대조하므로 planner·architect 쪽 회귀도 같이 잡힌다.
4. `npm run check`·`cargo test` 통과, 삭제·비활성화된 테스트 없음 — 충족.

### 중간에 본 빨간불 하나 (내 변경과 무관)

처음 `npm run check`가 `src/features/projects/components/integrations/IntegrationsView.test.tsx`의 미사용 타입 import 두 개(`HeartbeatSetupState`, `HeartbeatSetupStep`, TS6196)로 타입체크에서 멈췄다. dev-049가 작업 중인 파일이고 내 변경은 Rust 두 파일뿐이라 손대지 않았다. 몇 분 뒤 재실행에서 사라졌고 최종 게이트는 exit 0이다.

## 리스크와 후속

1. **`inspect` 경로에서 `tasks/`를 한 번 더 읽는다.** 목록 읽기(`read_markdown_summaries`)와 선언 그래프(`task_dependency_graph`)가 각각 훑는다. 조회 주기가 2.5초라 그 주기마다 작업 문서 수만큼의 읽기가 한 벌 더 붙는다. 지금 60건 규모라 체감되지 않지만, 한 번의 읽기로 둘을 만들려면 `WorkflowItemSummary`에 선언을 싣거나 별도 중간 표현을 두어야 하고 그것은 TASK-037이 명시적으로 배제한 방향이다. 값이 필요해지면 그때 별건으로 다룰 일이다.
2. **판정 비용은 작업 수의 제곱에 비례한다.** `unsatisfied_dependency_task_ids`가 작업마다 `task_dependencies`를 부르고 순환 탐색이 그래프를 걷는다. 선언이 없으면 첫 검사에서 끝난다. TASK-040 보고의 같은 항목과 같은 성질이고 상수만 다르다.
3. **스크립트의 `grep`이 본문까지 보는 차이는 그대로 남는다.** 작업 문서 본문에 열 0으로 적힌 `depends_on:` 줄이 생기면 스크립트만 그것을 선언으로 읽는다. 모듈 문서 "알려진 차이" 1번이고 작업 문서가 범위 밖으로 둔 항목이다. 다만 이번 배선으로 이 차이의 영향 범위가 넓어졌다 — 전에는 스크립트만 틀렸고, 이제는 자격 판정 자체가 두 갈래로 갈릴 수 있는 자리다. 후속으로 세울 값어치가 있다고 본다.
4. **설치본 조건 스크립트는 아직 v1이다.** `.workflow/rules/wf-eligible.sh`는 TASK-040이 손대지 않아 다음 하트비트 설치에서 앱이 갱신한다. 앱 내장 본문(v2)과 이번 앱 판정은 이미 같다.

## 사용자 QA 제안

1. 앱을 띄워 프로젝트를 열고, 역할별 대기 물량의 `developer` 표시가 하트비트 조건과 같은지 본다. 설치본이 `# condition_script_version: 2`로 갱신된 뒤 `sh .workflow/rules/wf-eligible.sh developer`의 종료 코드와 화면 표시가 일치해야 한다.
2. 선언이 미충족인 `todo`만 남는 상태를 만들어 본다(다른 `todo`에 lease를 걸어 후보에서 빼면 된다). 전에는 화면만 "개발자 대기 있음"이었고, 지금은 스크립트와 같이 "없음"이어야 한다.
3. 선행 작업을 QA 반려해 `todo`로 되돌린 뒤, 그것을 기다리던 후행 작업이 다시 대기 물량에서 빠지는지 본다. 판정이 읽는 시점의 파생이라 되돌림 처리 없이 그렇게 되어야 한다(SPEC-013 R2).
4. 작업 상세의 선행 표시(TASK-042 계열)와 이 대기 물량 판정이 같은 말을 하는지 대조한다. 상세의 선행이 전부 "충족"인 `todo` 작업이 있는데 `developer`가 "없음"이면 어긋난 것이다.

---

추가: TASK-040이 미충족으로 남긴 것은 "`role_eligibility.rs`가 스크립트 v2와 같은 기준으로 선언을 본다" 하나였고 그것이 이번 배선으로 닫혔다. 040이 코드 대신 모듈 문서에만 남겨 둔 부채 문단도 함께 제거되어 040 쪽에 남는 미충족 항목은 없다.
