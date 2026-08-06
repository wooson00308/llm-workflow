# TASK-139 개발 보고서

## 결정권자 요약

자격 확인 도구와 앱 내부 판정이 일감의 유무만 답하던 것을 대상 문서와 후보별 제외 사유까지 답하도록 넓혔다.
세션은 이제 문서 전체를 직접 대조하는 대신 도구가 알려 준 대상과 사유를 확인만 하면 된다.
판정 결과와 종료 코드는 이번 변경으로 달라지지 않았다. 넓어진 것은 답의 내용뿐이다.
화면에 전달되는 값의 모양도 그대로라 프런트엔드는 한 줄도 손대지 않았다.
넓어진 답은 사람과 세션이 읽는 자리로 따로 나가므로, 하트비트 데몬이 옮기는 한 줄 사유는 예전과 같다.
앱 내부 판정이 같은 대상과 같은 후보 목록을 답하는지를 기존 대조 검사 예순 건 전부가 확인한다.
러스트 검사 582건과 프런트엔드 검사 761건, 타입 검사, 배포 빌드가 모두 통과했다.
사용자는 확인 동선의 명령을 실행해 대상과 제외 사유가 출력되는지 확인해 주면 된다.
저장소에 설치된 조건 스크립트 사본은 앱이 관리하는 파일이라 이번 세션이 손대지 않았고, 앱이 동기화할 때 새 버전으로 바뀐다.

## 착수 판정 근거

- `.workflow/rules/workflow.md`(rules_version 14)와 `.workflow/rules/roles/developer.md`(rules_version 9)를 읽었다. `.workflow/rules/custom.md`는 없으므로 적용할 사용자 정의 규칙이 없다.
- `.workflow/.runtime/migration.lock` 없음.
- 착수 시점 lease는 `SPEC-009.yml` 하나뿐이고 `expires_at: 2026-08-03T01:20:00Z`로 만료 상태다. 겹침 판정에서 제외되며 파일에 손대지 않았다.
- 미완료 작업은 TASK-139(todo), TASK-140(todo, `depends_on: [TASK-139]` 미충족), TASK-141(todo)이었다. TASK-140은 선행 미충족이라 자격 없음. TASK-139와 TASK-141 중 뒤따르는 작업을 여는 TASK-139를 골랐다.
- `DECISION-30E36EFB`는 `outcome: approved`, `created_by: user`이고 SPEC-049의 유일한 결정이다.
- 선점: `acquire TASK-139 developer-claude 45` → `lease-54082-20260806140742`(14:07:42Z). 직후 `in_progress` 기록, 이후 renew 2회.

## 변경한 파일과 모듈

- `src-tauri/src/domain/project.rs`: 넓어진 판정을 담는 타입 `PendingRoleWorkDetail`·`RoleWorkVerdict`·`WorkCandidate`와 제외 사유 코드 상수를 추가했다. `ProjectSummary`에 `pending_detail` 필드를 더했고 `#[serde(skip)]`이라 직렬화 결과는 그대로다.
- `src-tauri/src/infrastructure/role_eligibility.rs`: 세 역할 판정을 불리언에서 `RoleWorkVerdict`로 넓혔다. `WorkflowInput`에 워크플로우 디렉터리 이름을 더해 판정이 도는 차례를 스크립트의 글롭 순서에 맞췄다.
- `src-tauri/src/infrastructure/heartbeat_condition.rs`: 셸 본문과 PowerShell 본문 양쪽에 대상 줄과 후보 줄 출력을 넣고 `CONDITION_SCRIPT_VERSION`을 11에서 12로 올렸다.
- `src-tauri/src/infrastructure/fs_project_repository.rs`: 호출부를 넓어진 반환값에 맞추고, 결정 문서를 파일 이름 오름차순으로 읽도록 정렬을 더했다. 대조 검사도 대상과 후보 목록을 함께 보도록 넓혔다.

앱이 설치하는 사본인 `.workflow/rules/wf-eligible.sh`는 편집하지 않았다.

## 핵심 결정과 근거

1. **넓어진 답은 표준 오류로 낸다.** 표준 출력 첫 줄은 하트비트 데몬이 `state.json`의 `last_condition_output`으로 옮기는 자리이고, SPEC-023이 그것을 한 줄로 못박아 두었다. 후보 줄을 표준 출력에 이어 붙이면 그 계약이 깨지고 기존 검사 두 곳의 "표준 출력은 한 줄"이라는 단언을 고쳐야 한다. 표준 오류는 본문 주석이 이미 "사람이 읽는 자리"로 정해 둔 채널이라, 세션이 읽는 답이 가기에 맞는 자리이기도 하다. 그 결과 완료 조건 3(일감 없는 상태에서 지금과 같은 결과)이 기존 검사를 한 줄도 고치지 않고 그대로 통과한다.

2. **후보 목록은 판정이 실제로 본 후보까지다.** 세 분기 모두 처음 자격을 갖춘 후보에서 판정을 끝내는 지금의 어법을 그대로 두었다. 후보 전부를 미리 훑도록 바꾸면 기획자·아키텍트 분기가 후보마다 lease 파일을 여는 자리(`lease_blocks`)에 닿아 후보 하나당 외부 프로세스 네 개가 늘고, 그것이 SPEC-041이 걷어낸 "후보당 상수" 비용의 부활이다. 작업 문서의 설계 지침이 막으라고 한 것이 정확히 이 회귀다. 대상이 없을 때는 어차피 후보 전부를 보므로, 사유가 가장 필요한 상황에서 목록은 완전하다.

3. **판정이 후보를 보는 차례를 파일 이름 오름차순으로 맞췄다.** 대상이 불리언이던 동안에는 차례가 답을 바꾸지 않았지만, 대상 하나를 고르는 순간 차례가 답이 된다. 스크립트는 디렉터리를 글롭 순서로 훑는데 앱의 목록 payload는 `updated_at` 내림차순이라, 그 정렬을 그대로 쓰면 두 판정의 대상이 갈린다. 그래서 판정은 `file_name` 순으로 보고, 결정 문서 읽기에도 같은 이유로 정렬을 더했다(작업 문서 읽기는 이미 정렬돼 있었다). 새로 벌어질 차이를 막은 것이고, 판정 규칙은 바꾸지 않았다.

4. **워크플로우를 보는 차례도 디렉터리 이름 순으로 맞췄다.** 앱은 등록 순서로, 스크립트는 글롭 순서로 돌기 때문에 대상이 나오는 워크플로우가 갈릴 수 있었다. `WorkflowInput`에 디렉터리 이름을 더해 판정 안에서 정렬한다. 등록되지 않은 워크플로우를 스크립트만 본다는 기존 차이는 그대로 남는다.

5. **선행 관련 제외는 사유 하나로 묶었다.** 선언을 읽을 수 없는 경우, 선행이 아직 끝나지 않은 경우, 고리가 있는 경우를 각각 다른 코드로 나누지 않았다. 세션이 할 일이 셋 다 같고(그 선언을 보고 앞의 작업을 먼저 끝낸다), 코드를 늘리면 두 본문과 앱 이식본 셋이 같은 분기를 유지해야 하는 자리가 늘어난다.

6. **넓어진 판정을 조회 결과에 실었다.** `ProjectSummary`에 직렬화되지 않는 필드로 두어, 화면 payload의 모양과 프런트엔드 타입은 그대로 두면서 대조 검사가 화면이 쓰는 그 배선을 그대로 지나게 했다. 판정만 따로 부르는 두 번째 경로를 만들면 대조가 배선을 고정하지 못한다.

## 검증 절차와 결과

작업 문서의 검증 절차 여섯 단계를 그대로 실행했다.

1. `cargo test`(src-tauri): 582개 통과, 실패 0. 판정 비용 검사 `the_judgement_cost_grows_no_faster_than_the_collections`도 통과했다 — 역할별 프로세스 예산(기획자 4·아키텍트 3·개발자 6)을 그대로 두고 통과했으므로 외부 프로세스가 늘지 않았다.
2. 후보가 여럿이고 일부가 제외되는 픽스처: `WIDENED_SCENARIOS` 표 일곱 행을 새로 세웠다. 개발자 행은 후보 넷 중 선점·선행 미충족·겹침으로 셋이 빠지고 넷째가 대상이 되는 픽스처다. 실제 출력을 임시 저장소에서 손으로도 확인했다.

   ```
   $ sh .workflow/rules/wf-eligible.sh developer   # 표준 출력
   eligible                                        # 종료 코드 0
   $ sh .workflow/rules/wf-eligible.sh developer 2>&1 >/dev/null   # 표준 오류
   candidate: leased TASK-001
   candidate: dependencies-unsatisfied TASK-002
   candidate: overlap TASK-003
   candidate: eligible TASK-004
   target: TASK-004
   ```
3. 같은 픽스처의 앱 판정 대조: `role_eligibility.rs`의 `assert_matches_condition_script`와 `fs_project_repository.rs`의 `pending_work_matching_condition_script` 두 대조 헬퍼가 종료 코드에 더해 대상과 후보 목록까지 본다. 두 헬퍼를 지나는 기존 시나리오 예순 건 전부가 수정 없이 통과했고, 여기에 역할별 다중 후보 시나리오 여섯 건을 더했다.
4. 일감이 없는 픽스처: 기존 조건 스크립트 검사를 한 줄도 고치지 않았고 그대로 통과한다. 표준 출력이 사유 한 줄이라는 단언(`the_installed_script_explains_every_verdict_in_one_line`, `the_installed_script_matches_the_scenario_table`)이 그 자리다.
5. 버전 대조: `installs_condition_script_with_managed_markers`와 `updates_a_managed_script_from_the_previous_version`, `the_error_messages_are_unchanged`가 12로 통과한다. 두 본문의 버전 줄이 같은지는 `both_implementations_share_the_managed_markers_and_version`이 본다.
6. `npm run check`: 타입 검사 통과, 검사 파일 24개·검사 761개 통과, 배포 빌드 성공. 프런트엔드 파일은 한 줄도 바꾸지 않았다.

추가로 `cargo fmt --check`와 `cargo clippy --all-targets`가 경고 없이 통과한다.

기존 자동 검사 삭제·비활성화 0건이다. 검사를 지우거나 `#[ignore]`를 붙인 자리가 없고, 기존 단언을 약하게 고친 자리도 없다. 고친 기존 검사는 두 대조 헬퍼(단언을 더한 것)와 `a_lease_blocks_the_same_id_in_every_workflow`(불리언이 아니라 넓어진 값을 보도록 바꾼 것) 셋이며, 셋 다 보는 것이 늘었다.

## 남은 위험

- **PowerShell 본문은 이 기기에서 실행하지 못했다.** 로컬에 PowerShell이 없다. 두 시나리오 표가 현재 플랫폼에 설치된 구현을 돌리고 CI의 러스트 잡이 `windows-latest`를 포함하므로, PowerShell 본문이 셸 본문과 다른 대상이나 다른 사유를 내면 그 러너에서 잡힌다. 병합 전 CI 결과 확인이 이 위험을 닫는 자리다.
- **저장소에 설치된 조건 스크립트 사본은 아직 버전 11이다.** `.workflow/rules/wf-eligible.sh`는 앱이 관리하는 파일이라 세션이 직접 고치지 않았다. 앱이 관리 자산을 동기화할 때 12로 바뀌며, 그때까지 이 저장소에서 스크립트를 직접 실행하는 세션은 넓어진 답을 보지 못한다.
- **후보 목록은 대상 앞까지다.** 대상이 있는 상태에서 그 뒤의 후보는 판정되지 않으므로 목록에 없다. "왜 이 문서가 대상이 아닌가"를 물으려면 그 문서보다 앞선 대상을 먼저 처리하거나 대상이 없는 상태에서 물어야 한다. 후보 전부를 언제나 훑는 쪽은 판정 비용을 되돌리는 선택이라 이번에 택하지 않았다.
- **알려진 차이 다섯 가지는 그대로 남는다.** `role_eligibility.rs` 머리말의 다섯 항목은 이번 작업의 해소 대상이 아니었고, 넓어진 답에서도 같은 자리에서 같은 방식으로 나타난다.

## 후속 작업 (역할 밖 관찰, 손대지 않음)

- TASK-140이 `fs_project_repository.rs`를 함께 수정하며 이 작업을 선행으로 선언해 두었다. 이 작업이 사용자 QA를 지나면 그 선행이 충족된다.
- 대상과 제외 사유를 화면에 노출하는 일은 SPEC-049의 이번 범위 밖이다. 필요해지면 `pending_detail`을 직렬화 대상으로 올리고 프런트엔드 타입을 함께 넓히는 별도 작업이 된다.
- 세션이 이 답을 실제로 어떻게 읽을지(계약 문장으로 안내할지)는 개발자 역할 계약을 고치는 TASK-140의 몫이다.

## 문서 상태

- `tasks/TASK-139.md`: `todo` → `in_progress`(14:08:00Z) → `qa_waiting`(14:32:00Z). history 두 줄 추가, `updated_at` 갱신, 결정권자 요약을 완료 사실로 갱신, `## 확인 동선` 신설. 목적·현재 상태·변경 범위·완료 조건·검증 절차 등 아키텍트 소유 본문은 무수정.
- `decisions/` 무접촉, `specs/` 무접촉, 커밋 없음, 만료 lease 무접촉.
