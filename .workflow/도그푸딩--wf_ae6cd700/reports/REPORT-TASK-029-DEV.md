# TASK-029 개발자 핸드오프

- 대상 작업: TASK-029 (역할별 대기 물량을 조회 결과에 싣고 조건 스크립트와 같은 결론을 테스트로
  고정한다)
- 근거 문서: SPEC-009 R3·확인 필요 2번, DECISION-85491D81 (approved, created_by: user)
- 세션 역할: 개발자
- 작성 시각: 2026-08-03T05:15Z
- 상태: `qa_waiting`

## 대상 선정 근거

- 착수 시점(05:01Z) `todo`는 TASK-029~040 열두 건이고, `.workflow/.runtime/leases`에는
  SPEC-009(만료)·SPEC-013(활성, 아키텍트) 둘뿐이라 TASK-029를 덮는 lease는 없었다.
- TASK-029는 선행 작업이 없다. 병행 금지 상대인 TASK-028은 이미 `qa_waiting`이라 동시 작업이
  아니다(같은 `domain/project.rs`를 만지지만 순서로 분리됨). TASK-030·031은 이 작업의 산출물
  (`ProjectSummary.pendingWork`)을 쓰므로 지금 착수할 수 없다.
- `migration.lock`은 없었다.

## 요약

"지금 이 역할이 처리할 대상이 대기 중인가"를 앱이 계산해 조회 결과에 싣고, 그 판정이 조건
스크립트와 같은 결론을 낸다는 것을 자동화 테스트로 고정했다. 화면은 건드리지 않았다.

## 변경한 파일

- `src-tauri/src/infrastructure/role_eligibility.rs` (신규) — 판정 규칙 한 곳. 파일 시스템을
  만지지 않고 값만 받는다. `WorkflowInput`, `pending_role_work`와 역할별 판정 셋. 모듈 문서에
  스크립트와의 알려진 차이 3건을 적었다. 테스트 15개(동치 대조 13 + 값 판정 2).
- `src-tauri/src/infrastructure/mod.rs` — 모듈 선언 1줄.
- `src-tauri/src/domain/project.rs` — `WorkflowItemSummary.source_decision_id`,
  `ProjectSummary.pending_work`, `PendingRoleWork`(planner·architect·developer).
- `src-tauri/src/infrastructure/fs_project_repository.rs`
  - `read_markdown_document`가 `source_decision_id`를 읽는다.
  - `latest_spec_decisions(workflow_root)` → `read_spec_decisions(workflow_root) ->
    Vec<SpecDecisionRecord>` + `latest_spec_decisions(&[SpecDecisionRecord])`로 나눴다. 건너뛰는
    규칙은 그대로이고 "`id`가 없으면 건너뛴다"만 더했다(스크립트의 `[ -n "$did" ]`와 같다).
  - `lease_ids(control_root) -> HashSet<String>` 추가. 파일 이름만 보고 만료를 거르지 않는다.
    `read_active_leases`와 합치지 않았다.
  - `summary_from_manifest`가 워크플로우별로 `PreparedWorkflow`(디렉터리·items·승인 결정)를 한 번
    만들고, 그 위에서 요약과 판정을 함께 만든다. 다섯 반환 경로가 호출 지점 수정 없이 같은 값을
    갖는다. `uninitialized_summary`는 `PendingRoleWork::default()`다.
  - `MIGRATION_LOCK_FILE` 상수를 두고 `MigrationLock::acquire`와 판정이 같은 이름을 쓴다.
  - 테스트 1개 추가: 작업 요약에 `sourceDecisionId`가 실리고 아이디어·기획서에서는 `None`이다.
- `docs/file-contract.md` — 개발 작업 예시 프론트매터에 `source_spec_id`·`source_decision_id`를
  더하고, 두 키의 뜻과 앱이 그 참조로 무엇을 판정하는지 한 문단으로 적었다.

프런트엔드는 무변경이다. `src/features/projects/domain/types.ts`를 포함해 타입스크립트 파일을
하나도 고치지 않았다(TASK-030 몫).

## 판정 규칙

스크립트 절을 그대로 옮겼고 각 판정 옆에 해당 절을 주석으로 밝혔다.

- `migration.lock`이 있으면 세 역할 모두 `false`. 다른 규칙을 보기 전에 끝낸다.
- planner: `status != "adopted"`이고 lease가 없는 아이디어가 하나라도 있으면 `true`.
- architect: 승인된 **모든** 결정 중, 그 워크플로우의 어떤 작업도 `source_decision_id`로 가리키지
  않고 그 `spec_id`로 lease가 없는 것이 있으면 `true`. `latest_spec_decisions`의 "가장 최근 결정"
  규칙을 쓰지 않았다.
- developer: `status == "todo"`이고 lease가 없는 작업이 있으면 `true`.
- 짝짓기 범위는 워크플로우별, lease만 프로젝트 전역이다.

## 검증

```sh
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check          # 통과
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings  # 경고 0
cargo test --manifest-path src-tauri/Cargo.toml                    # 176 → 191, 실패 0
npm run check                                                      # 191 tests / 13 files, 빌드 성공
```

삭제하거나 비활성화한 테스트는 없다. 기존 단언은 하나도 바꾸지 않았다.

동치 테스트는 규칙만이 아니라 배선까지 고정한다. 픽스처를 `create_workflow`로 만들고 조건
스크립트를 `install_condition_script`로 설치한 뒤, `inspect`가 돌려준 `pending_work`의 세 값을
`sh .workflow/rules/wf-eligible.sh <role>`의 종료 코드와 한 헬퍼에서 대조한다
(`assert_eq!(app_flag, exit_code == 0)`, `#[cfg(unix)]`). 시나리오:

- planner: 기획서가 참조하지 않는 아이디어 / 채택된 아이디어 / 그 아이디어 id의 lease.
- architect: 파생 작업이 없는 승인 결정 / 그 결정을 참조하는 작업 / 그 결정 `spec_id`의 lease /
  승인 뒤 수정 요청이 이어진 상태(최신 결정만 보면 갈라진다) / 다른 워크플로우의 작업이 이
  워크플로우의 결정을 분해한 것으로 세지 않는다.
- developer: `todo` 작업 / `qa_waiting`만 있는 상태 / 그 작업 id의 lease.
- 만료된 lease 파일 3종이 세 역할을 모두 막는다. 같은 시점에 `active_leases`는 비어 있다는 것도
  함께 단언해, 앱이 만료를 거른 목록을 판정에 쓰지 않는다는 사실을 고정했다.
- `migration.lock`이 있으면 세 역할 모두 자격 없음.
- 문서가 없는 워크플로우와 초기화되지 않은 디렉터리는 전부 `false`.

이 저장소로도 한 번 대조했다(05:11Z, 임시 테스트로 `inspect`를 돌린 뒤 그 테스트는 지웠다).

| 역할 | 앱 | 스크립트 |
| --- | --- | --- |
| planner | true | 0 |
| architect | false | 1 |
| developer | true | 0 |

세 역할 모두 일치했다. 작업 문서가 경고한 `tasks/TASK-022.md` 본문의 프론트매터 예시
(`source_decision_id: DECISION-001`)는 이 저장소의 결정 id가 전부 해시 형식이라 어느 결정과도
겹치지 않아 이번 대조에는 영향이 없었다.

## 완료 조건 대응

1. 동치 테스트 존재·통과 — 위 표와 시나리오 목록.
2. `migration.lock` 시 세 역할 모두 없음 — `a_migration_lock_stops_every_role`.
3. 만료 lease도 막음 — `an_expired_lease_file_still_blocks_its_target`.
4. 승인된 모든 결정을 봄 — `an_approved_decision_followed_by_a_revision_request_is_still_architect_work`.
5. `sourceDecisionId` 적재 — `reads_the_source_decision_of_a_task_and_leaves_it_empty_elsewhere`.
6. 파일 계약 반영 — `docs/file-contract.md` 개발 작업 절.
7. 결정 문서 스캔 횟수 동일 — 조회 경로의 결정 디렉터리 순회는 워크플로우당 둘 그대로다
   (`read_spec_decisions`가 이전 `latest_spec_decisions`의 순회를 대체하고, `qa_decision_events`는
   손대지 않았다). 새 스캔 함수를 더하지 않았다.
8. 기존 테스트 무수정 통과 — 위 검증.
9. 네 명령 통과 — 위 검증.

## 리스크와 후속

- `migrate()`가 `MigrationLock`을 든 채로 `summary_from_manifest`를 부른다. 그래서 마이그레이션
  직후 그 한 번의 반환값만 세 역할 모두 `false`로 나간다. 다음 `inspect`(2.5초)에서 정상값으로
  바뀐다. 판정 규칙을 작업 문서가 지정한 그대로("락 파일이 있으면 false") 구현한 결과이고, 반환
  순서를 바꾸는 것은 이 작업의 범위 밖이라 손대지 않았다.
- 스크립트와의 알려진 차이 3건은 그대로 남는다(모듈 문서에 기록). 스크립트 판정 규칙 변경이
  기획서 제외 범위다.
- 화면은 아직 이 값을 쓰지 않는다. `pendingWork`는 조회 결과에만 실려 있고 소비자는 TASK-030이다.

## 역할 밖 발견 (핸드오프)

- `.workflow/.runtime/leases/SPEC-009.yml`이 2026-08-03T01:20:00Z에 만료됐는데 아직 남아 있다.
  이제 이 파일은 실제 판정에 영향을 준다 — 앱과 스크립트 모두 SPEC-009를 `spec_id`로 갖는 승인
  결정을 아키텍트 대기 물량에서 제외한다. 남의 lease라 이 세션은 건드리지 않았다. TASK-039의
  선점 헬퍼가 다루려는 문제와 같은 사례다.
- `tasks/TASK-022.md`에 문서가 두 벌 들어 있다는 REPORT-TASK-028-DEV의 지적은 지금도 유효하다.
