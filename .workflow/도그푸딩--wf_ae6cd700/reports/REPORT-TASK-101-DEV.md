# TASK-101 개발자 핸드오프

- 대상: TASK-101 (겹침 선언 필드를 만들고 두 자격 판정이 그것을 보게 한다)
- 근거: SPEC-032 R1·R2·R3·R6·R8·R9, 완료 조건 1~8·12·13·15,
  DECISION-0D79A7F0 (`outcome: approved`, `created_by: user`, `spec_id: SPEC-032`,
  2026-08-04T13:18:02Z — 직접 확인. SPEC-032의 결정 문서는 이 1건뿐이라 더 늦은 결정이 없다)
- 역할: 개발자 (developer-claude)
- 선점: `acquire TASK-101 developer-claude 45` exit 0 → `lease-55572-20260804163813` →
  `in_progress`(2026-08-04T16:38:30Z) → 구현 → 검증 → `qa_waiting`. 중간에 renew exit 0 1회.

## 선행 확인

`depends_on: [TASK-097, TASK-098, TASK-099]`.

- TASK-097 `completed`, TASK-098 `completed`, TASK-099 `qa_waiting` — 셋 다 충족.
- 착수 시점 `.workflow/.runtime/leases/`에는 만료된 `SPEC-009.yml`(2026-08-03T01:20:00Z) 하나뿐이었고
  TASK-101을 덮는 리스는 없었다.
- 착수 시점 `todo`는 TASK-100·101·102·103·104·105·106 7건이고, 선행이 충족된 것은 TASK-100과
  TASK-101 둘이었다. TASK-100은 범위(`DevelopmentBoard.tsx`·`App.css`)가 이 작업과 겹치지 않는다.

## 착수 시점에 읽은 값 (완료 조건 4·9의 기준선)

| 값 | 착수 시점 | 착지 후 |
| --- | --- | --- |
| `CONDITION_SCRIPT_VERSION` (`heartbeat_condition.rs:20`) | 7 | 8 |
| `CONDITION_SCRIPT_SH` 본문 버전 줄 | 7 | 8 |
| `CONDITION_SCRIPT_PS1` 본문 버전 줄 | 7 | 8 |
| 설치본 `.workflow/rules/wf-eligible.sh` 버전 줄 | 6 | 6 (손대지 않았다) |
| `cargo test` 개수 | 411 | 427 |

작업 문서가 예고한 대로 분해 시점 상수(7)와 설치본(6)이 어긋나 있었다. 고정값을 가정하지 않고 착수
시점에 읽은 7에서 +1 해 8로 올렸고, 세 자리가 같은 값이다. 설치본은 앱이 설치 경로로 덮어쓰는
산출물이므로 손대지 않았다.

## 한 것

### `domain/project.rs`

- `TaskOverlapBlock` 추가. 필드는 작업 문서가 적어 준 모양 그대로(`lease_target_id`,
  `shared_files`)이고 파일의 다른 타입과 같이 `#[serde(rename_all = "camelCase")]`다.
- `TaskDocument`에 `overlap_blocks: Vec<TaskOverlapBlock>`. 비어 있으면 막히지 않은 것이고, 별도
  불리언을 만들지 않았다.

### `fs_project_repository.rs`

- `ScopeDeclaration`(`Absent`/`Declared`/`Malformed`)과 `parse_scope_declaration`.
  `parse_dependency_declaration`을 일반화하지 않고 같은 어법의 함수를 하나 더했다 — 허용 문자 집합이
  다르다(`A-Za-z0-9_-`에 `.`과 `/`를 더한 것). 판정 순서는 원본과 같다.
- `task_dependency_graph`의 값이 3튜플 대신 `TaskNode { status, dependencies, scope }` 구조체가
  됐다. 두 선언이 같은 한 번의 읽기에서 나온다. `task_dependencies`·`dependency_state`·
  `declaration_reaches`·`unsatisfied_dependency_task_ids`는 패턴 모양만 바뀌었고 **판정 규칙은 한
  글자도 바꾸지 않았다**.
- `overlap_block(task_id, target, graph) -> Option<Vec<String>>`. 규칙의 단일 정의다. `None`이 "막지
  않는다"이고 `Some`의 값이 함께 가리킨 경로다 — 자격 판정과 상세 payload가 같은 함수를 쓴다.
- `overlap_blocked_task_ids`(자격용 집합)와 `task_overlap_blocks`(payload용 목록, lease 대상 id
  오름차순). `unsatisfied_dependency_task_ids`·`task_dependencies`와 같은 짝 구조다.
- `PreparedWorkflow`에 `overlap_blocked` 필드. `read`가 그래프를 한 번 만들어 선행 판정과 겹침 판정에
  함께 쓴다(`tasks/` 훑기 횟수는 늘지 않았다).
- `summary_from_manifest`가 `lease_ids(&control_root)`를 위로 끌어올려 `PreparedWorkflow::read`와
  `pending_role_work`에 같은 집합을 넘긴다. **lease 대상 id는 파일 stem이다** — 조건 스크립트가
  `$leases/$id.yml`로 찾는 값과 같아야 두 판정이 갈라지지 않는다. `AgentLeaseSummary.task_id`(파일
  내용)를 쓰지 않은 이유가 이것이고, `lease_ids` 읽기 횟수는 그대로다.
- `read_task`가 `lease_ids`로 미만료 lease를 읽어 `overlap_blocks`를 채운다. 목록
  payload(`WorkflowItemSummary`)는 건드리지 않았다.

### `role_eligibility.rs`

- `WorkflowInput`에 `overlap_blocked` 필드 하나. 이 모듈은 파일을 만지지 않는다는 계약 그대로,
  판정은 `fs_project_repository`가 하고 결과만 받는다.
- `has_developer_work`에 조건 하나가 늘어 네 조건이 됐다.
- 모듈 머리의 "알려진 차이" 다섯 항목은 **손대지 않았다**. 새 차이가 없다 — 스크립트가 파일 아무
  곳이나 보는 것(1번), `id:` 없는 문서를 건너뛰는 것(2번), 등록되지 않은 워크플로우까지 보는 것(3번),
  lease 만료 표기(4번)는 `scope_files`에도 `depends_on`과 똑같이 적용된다.

### `heartbeat_condition.rs`

- sh 본문: `scope_of`(`deps_of`를 본뜨되 키 부재도 1을 낸다 — 선언 없는 작업은 판정 불가다)와
  `overlap_blocks` 헬퍼. `developer)` 절 끝에 두 줄이 늘었다.
- PowerShell 본문: `Get-Scope`·`Test-Overlapped`. 비교는 전부 `-c` 접두 연산자이고 ASCII만 쓴다.
- 자기 선언은 막을 lease를 처음 만났을 때 읽는다. **잡힌 lease가 없으면 두 헬퍼가 파일을 열지
  않으므로 판정 비용이 지금과 같다.**
- `planner)`·`architect)` 절과 `deps_of`·`reaches`·`dep_satisfied`·`task_file`·`lease_blocks`는
  손대지 않았다.

## 검사

새로 넣은 것 16건 + 시나리오 표 4행.

**`fs_project_repository.rs` (10건)**

1. `reads_the_scope_declaration_by_the_contract_form` — 정상 목록·부재·빈 목록(`[]`/`[ ]`)·중복 키·
   블록 표기·값 없는 키·따옴표 표기·공백 든 경로·닫히지 않은 괄호·허용 문자 밖 문자 12가지.
2. `a_shared_path_blocks_the_task_while_the_other_is_leased`
3. `a_disjoint_declaration_stays_open_while_another_task_is_leased`
4. `a_task_without_a_declaration_is_blocked_by_any_active_lease` (lease 있음/없음 두 시점)
5. `an_expired_lease_blocks_nothing`
6. `a_malformed_declaration_blocks_both_directions` (양방향 — 판정 규칙 2번)
7. `a_lease_on_a_document_that_is_not_a_task_blocks_a_declared_task_never`
8. `judging_overlap_leaves_every_lease_file_untouched` — 판정 전후 lease 디렉터리의 파일 이름과 내용
   비교. `role_eligibility.rs`의 기존 검사와 같은 어법이다.
9. `carries_the_overlap_evidence_in_the_task_payload` — `shared_files`가 실제 교집합이고 오름차순,
   자기 자신을 잡은 lease는 담기지 않는다.
10. `leaves_the_shared_files_empty_when_the_declaration_is_missing`

**대조 `role_eligibility.rs` (6건, 전부 `assert_matches_condition_script`)**

`a_shared_scope_is_not_developer_work_while_the_other_task_is_leased`,
`a_disjoint_scope_is_developer_work_while_another_task_is_leased`,
`a_task_without_a_scope_is_developer_work_only_while_nothing_is_leased`,
`an_expired_lease_does_not_block_an_overlapping_task`,
`a_malformed_scope_is_not_developer_work_on_either_side`,
`an_empty_scope_overlaps_with_nothing`.

뒤의 둘은 작업 문서의 목록에 없다. 형식 오류와 빈 목록은 두 구현이 각각 판정하는 새 경로라 대조
없이는 갈라져도 아무도 모른다고 보고 더했다.

**시나리오 표 `heartbeat_condition.rs` (4행)** — 겹침/비겹침/선언 없음/작업이 아닌 문서를 잡은 lease.
사유 코드는 늘리지 않았고 `eligible`·`no-target`만 쓴다.

## 고친 기존 검사 1건

`heartbeat_condition.rs`의 `a_finished_dependency_satisfies_the_declaration`이 착지 후 실패했다.
이 픽스처는 **선행을 후보에서 빼려고 선행에 lease를 걸어 두는데**, 두 작업 모두 `scope_files`가 없어
새 규칙 1번(선언 없는 작업은 잡힌 lease 하나로 막힌다)에 걸린다. 승인된 확인 필요 2번이 정한 동작이라
규칙이 아니라 픽스처를 고쳤다 — 두 작업에 서로 다른 경로(`src/one.rs`, `src/two.rs`)를 선언시켰다.
**테스트 이름·단언·기대값은 그대로**이고 삭제도 `#[ignore]`도 아니다. 이 자리가 필요했던 이유를 주석
한 줄로 남겼다. 나머지 기존 검사는 한 건도 고치지 않았다.

## 완료 조건 대조

1. 파서 — 검사 1. ✅
2. 겹치는 두 작업 중 한쪽이 잡히면 다른 쪽이 자격에서 빠진다 — 검사 2 + 대조. ✅
3. 겹치지 않으면 열린다 — 검사 3 + 대조. ✅
4. 버전 셋이 같고 착수 시점 +1 — 위 표. ✅
5. 대조 테스트가 새 상황을 포함해 통과, 기존 단언 감소 0. ✅
6. 선언 없는 작업 — 검사 4 + 대조. ✅
7. 만료 lease — 검사 5 + 대조. ✅
8. 판정이 lease 파일을 만들지도 고치지도 지우지도 않는다 — 검사 8. ✅
9. 활성 lease가 없을 때의 판정이 그대로 — 아래 "실저장소 판정". 기존 검사 411건은 위 1건의 픽스처
   수정을 빼고 전부 수정 없이 통과. ✅
10. `#[ignore]` 신규 0건 (저장소 전체 0건). ✅
11. `the_powershell_implementation_is_ascii` 수정 없이 통과. ✅
12. 실저장소 판정 — 아래. ✅
13. 변경분에 `project_instructions.rs`·`DevelopmentBoard.tsx`·`types.ts` 없음 — 아래. ✅
14. `cargo test` 427 passed / 0 failed, `npm run check` 통과(테스트 514, 빌드 성공). ✅

추가로 `cargo fmt --check`와 `cargo clippy --all-targets -- -D warnings` 통과.

## 실저장소 판정 (완료 조건 12)

이 저장소의 작업에는 `scope_files`가 하나도 없다(소급 기입은 기획서 제외 범위).

| # | 시점 / 본문 / lease | planner | architect | developer |
| --- | --- | --- | --- | --- |
| 1 | 착수 전(16:38Z), 설치본 v6, TASK-101 lease 있음 | 0 `eligible` | 1 `no-target` | 0 `eligible` |
| 2 | 착지 후(16:55Z), 설치본 v6(무변경), TASK-101 lease 있음 | 0 `eligible` | 1 `no-target` | 0 `eligible` |
| 3 | 착지 후(16:55Z), 새 본문 v8, TASK-101 lease 있음 | 0 `eligible` | 1 `no-target` | **1 `no-target`** |
| 4 | 착지 후(16:55Z), 새 본문 v8, 활성 lease 없음(사본) | 0 `eligible` | 1 `no-target` | 0 `eligible` |
| 5 | 착지 후(16:55Z), 설치본 v6, 활성 lease 없음(사본) | 0 `eligible` | 1 `no-target` | 0 `eligible` |
| 6 | lease 해제 후(17:00Z), 설치본 v6, 실저장소 | 0 `eligible` | 0 `eligible` | 0 `eligible` |
| 7 | lease 해제 후(17:00Z), 새 본문 v8, 실저장소 | 0 `eligible` | 0 `eligible` | 0 `eligible` |

**활성 lease가 없는 동안 세 답이 옛 본문과 같다**(4↔5, 6↔7). 회귀 없음.

3행의 굵은 칸은 회귀가 아니라 이 작업이 만든 판정이다. 활성 lease(이 세션의 TASK-101 lease)가 있고
선행이 충족된 유일한 `todo`(TASK-100)에 `scope_files`가 없으므로 승인된 확인 필요 2번대로 막힌다.
lease를 놓으면 다시 열린다(4·7행).

6·7행에서 architect가 1에서 0으로 바뀐 것은 **이 작업과 무관하다.** 세션 중(16:56Z) 앱이 새 승인
결정 `DECISION-3ECEDCA1`을 기록했고, 그 승인에서 아직 작업이 파생되지 않았다. 두 본문이 그 변화에도
같은 답을 낸다는 것이 6↔7이 보이는 것이다.

측정 방법: 설치본은 앱이 덮어쓰는 산출물이라 손대지 않았으므로, 새 본문은 `CONDITION_SCRIPT_SH`
상수를 `.workflow/` 밖 임시 파일로 뽑아 프로젝트 루트에서 돌렸다. 4·5행은 `.workflow/`를 임시
디렉터리에 복사해 `leases/`만 뺀 사본에서 쟀다 — 실제 lease 파일은 읽기만 했다.

## 무변경 확인 (완료 조건 13)

저장소에 여러 세션의 미커밋 변경이 겹쳐 있어 `git diff`로는 확인되지 않는다. 세션 시작(16:38Z) 이후
수정 시각을 가진 파일은 정확히 넷이다.

```
src-tauri/src/domain/project.rs
src-tauri/src/infrastructure/fs_project_repository.rs
src-tauri/src/infrastructure/role_eligibility.rs
src-tauri/src/infrastructure/heartbeat_condition.rs
```

`project_instructions.rs`(2026-08-05 00:13 KST)·`DevelopmentBoard.tsx`(01:01)·`types.ts`(01:00)는
모두 이 세션 시작(01:38 KST) 이전이 마지막 수정이고, 셋 중 어디에도 `scope_files`가 없다.
`.workflow/rules/wf-eligible.sh`도 그대로다(버전 줄 6).

## 남은 것 / 인계

- **계약 문언과 `rules_version` 인상은 TASK-102의 몫이다.** 지금 필드는 세 구현이 읽지만 어느 계약도
  쓰라고 말하지 않는다. 그 사이에는 모든 작업이 "선언 없음"이므로, **활성 lease가 하나라도 있으면
  개발자 자격이 닫힌다.** 위 표의 굵은 칸이 그 상태다. 병렬 세션을 돌리는 동안에는 이것이 실질적인
  직렬화로 보일 수 있고, TASK-102가 착지해 작업들이 선언을 갖기 시작하면 풀린다.
- **기존 작업 94건의 소급 기입은 기획서 제외 범위**라 하지 않았다. 위 항목의 기간을 줄이려면 소급
  기입이 필요한데, 그것은 새 기획서의 몫이다 — 아키텍트 후속으로 남긴다.
- **화면은 TASK-103의 몫이다.** `overlap_blocks`가 payload에 실리지만 `types.ts`에는 아직 필드가
  없다. 직렬화 이름은 `overlapBlocks`, 원소는 `{ leaseTargetId, sharedFiles }`다.
- PowerShell 본문은 이 기계(macOS)에서 실행할 수 없다. 두 본문의 대조는 CI의 Windows 러너가
  `the_installed_script_matches_the_scenario_table`로 한다. sh 본문 쪽은 형식 오류·중복 키·빈 목록·
  블록 표기·공백 든 경로·겹침 6가지를 임시 픽스처로 손으로 돌려 Rust 파서와 같은 답을 내는 것까지
  확인했다.
- `overlap_blocks`(sh)는 잡힌 lease마다 `task_file`로 작업 문서를 훑는다. lease는 보통 0~2건이라
  비용이 작지만, SPEC-033(TASK-104)이 판정 비용을 손볼 때 이 자리도 같이 보면 좋다.
