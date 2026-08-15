---
schema: workflow-labs/work-group@1
id: GROUP-DECISION-DC3ED4B7
title: 누락된 런타임 계약을 보완하고 blocked 작업을 안전하게 재개한다
status: active
revision: 1
qa_mode: user
source_spec_id: SPEC-054
source_decision_id: DECISION-DC3ED4B7
created_at: 2026-08-14T09:08:07.880257+00:00
updated_at: 2026-08-14T09:08:07.880257+00:00
---

# 누락된 런타임 계약을 보완하고 blocked 작업을 안전하게 재개한다

## 기능 설명

기존 개발 작업을 기획서 기준의 작업 그룹으로 전환했습니다.

### QA-01 · provider 실행을 시작·감시·취소·복구할 수명 계약으로 분리한다

이 작업에는 확인할 화면이 없다. 실행 수명 계약은 코드와 자동 검사로만 확인할 수 있으므로, 확인
도장은 아래 명령이 돌려주는 수치를 신뢰한다는 뜻이다. 모든 명령은 구현 저장소
`/Users/catze/Git/claude-heartbeat`에서 실행한다. 가짜 CLI만 사용하므로 실제 Claude·Codex 계정과
네트워크는 필요하지 않다.

   조건과 이렇게 대응한다.
   - 조건 1: `test_reserved_start_returns_a_handle_that_names_the_reserved_work` (Claude·Codex 각 1건)
   - 조건 2: `test_start_success_is_not_role_success_and_the_failing_stages_stay_apart`
   - 조건 3: `test_a_restarted_runtime_resumes_the_same_process_without_starting_a_provider`
   - 조건 4: `test_pid_reuse_and_unverifiable_identity_are_never_adopted_as_the_run`
   - 조건 5: `test_cancelling_through_the_handle_leaves_no_child_and_only_the_lease_open`,
     `test_an_unconfirmed_termination_is_returned_as_a_partial_cancellation`
   - 조건 6: `test_reservation_failures_and_mismatches_never_start_a_provider`,
     `test_the_reservation_response_is_read_without_changing_its_contract`
   - 조건 7: `test_reading_the_same_offset_twice_is_deterministic_and_withholds_a_partial_line`
   - 조건 8: `test_the_prompt_and_the_secret_stay_out_of_the_handle_events_result_and_log`
   - 죽은 프로세스의 정리 단계: `test_a_finished_process_recovers_into_the_cleanup_stages`
   `31 passed`. 기존 provider 검사 19건이 그대로 통과하는지 함께 본다.
   `205 passed, 7 skipped, 1 deselected`. 이번 작업 시작 전 같은 명령의 결과는 `193 passed`였고,
   늘어난 12건은 이번에 추가한 검사다.
4. 계약 자체를 읽어 확인하려면 `docs/provider-lifecycle-contract.md`를 본다. 실행 시작 실패 단계,
   복구 판정, 정리 단계와 예약 응답 필드가 표로 정리돼 있다.
5. 제외한 `test_parse_heartbeat_md_max_per_field` 1건은 사용자 홈의 잡 디렉터리를 격리하지 않는
   기존 실패이며 이번 변경과 무관하다. 이번 작업 시작 전에도 같은 이유로 실패했다.

### QA-02 · 런타임과 서비스의 기기 상태 및 업데이트 계약을 제공한다

화면 확인 대상은 없다. 이 작업은 런타임 계약과 명령 목록만 바꾸므로 자동 검사 결과와 명령 출력으로
확인한다. QA 확정은 아래 숫자와 출력을 직접 확인한 뒤 그 결과를 신뢰한다는 뜻이다.

범위 밖 수정 한 건이 있다. `tests/test_agent_contract.py`의 단언 한 줄을 현재 사실에 맞게 고쳤다.
그 줄은 `run.start`가 예약 명령이라고 단언했는데 TASK-S051-04가 그 명령을 구현한 뒤로 사실이 아니며,
완료 조건 13의 이중 정의를 없애면 어떤 구현으로도 통과하지 않는다. 그 파일은 이 작업의 범위 밖이라
지휘 세션의 사전 승인을 받고 그 한 줄만 고쳤다. 근거와 전후는 개발 보고서에 적어 두었다.

   검사가 통과하는지 확인한다.
2. 계획이 아무것도 바꾸지 않는지 확인한다.
   - `test_plan_reports_impact_without_changing_anything`: 영향받는 실행 수와 프로젝트 목록을 돌려주고
     파일 해시와 저장소 행이 그대로다.
   - `test_plan_carries_no_prompt_or_credential`: 계획 응답에 prompt와 토큰 문자열이 없다.
   - `test_the_plan_answers_every_fact_the_app_would_otherwise_parse`: 앱이 SQLite와 plist를 직접 읽지
     않아도 되는 필드가 모두 들어 있다.
3. 계획과 적용의 분리를 확인한다.
   - `test_apply_needs_a_confirmation_even_with_no_active_run`: 실행 중 작업이 없어도 확인 없이는
     아무것도 하지 않는다.
   - `test_the_plan_identifier_is_a_fingerprint_of_what_it_assumed`와
     `test_a_changed_service_identity_also_changes_the_plan`: 실행 집합, manifest, 서비스 신원이 바뀌면
     계획 식별자가 달라진다.
   - `test_a_device_that_moved_after_the_plan_is_refused_before_stage_one`: 지문이 다르면 0단계에서
     멈추고 파일과 저장소가 그대로다.
4. 단계별 결과를 확인한다.
   - `test_a_confirmed_plan_moves_the_launcher_and_reports_every_stage`: 다섯 단계가 순서대로 통과한다.
   - `test_verification_failure_inside_a_matching_plan_is_a_stage_one_failure`: 검증 실패 시 기존
     launcher가 그대로 남는다.
   - `test_a_failed_service_stage_is_not_reported_as_a_whole_success`: 서비스 단계만 실패하면 부분
     성공으로 남고 현재 실행 가능 버전과 복구 행동이 온다.
   - `test_the_three_platforms_use_the_same_stages_and_meanings`: 세 플랫폼의 단계 이름과 뜻이 같다.
5. 명령 목록 단일화를 확인한다.
   - `test_the_command_list_is_defined_once_and_matches_what_runs`: 계약이 알리는 목록에 있는 이름은
     미구현으로 거절되지 않고 목록 밖 이름은 실패 봉투를 받는다.
   - `test_the_device_query_is_not_duplicated_as_an_agent_command`: 기기 조회는 runtime 명령군 하나뿐이다.
   - 설치된 CLI가 있으면 `heartbeat agent contract`를 실행해 `implementedCommands`에 열다섯 개,
     `runtimeCommands`에 다섯 개, `reservedCommands`가 빈 목록인지 직접 볼 수 있다.
   실행해 81 passed, 7 skipped를 확인한다.
   1 deselected를 확인한다. 제외한 한 검사는 이번 범위 밖의 기존 jobs.d 격리 문제다.

### QA-03 · blocked 작업 재개를 원자적 사용자 감사 전이로 기록한다

이 작업에는 눈으로 볼 화면이 없다. 재개 버튼과 패널 배치는 이 작업의 범위 밖이고, 여기서 만든 것은
`resume_task` 명령과 저장 계약, 그리고 관리 규칙·파일 계약의 문언이다. 그래서 확인 도장은 아래
자동 검사 수치를 신뢰한다는 뜻이다.


수치 대신 동작을 직접 보고 싶다면 임시 프로젝트에서 다음을 재현할 수 있다. 화면이 없으므로 명령은
개발용 호출로 확인한다.

1. `.workflow/<워크플로우>/tasks/`에 `status: blocked`인 작업 문서를 두고, 그 문서의 `updated_at`
   값과 비어 있지 않은 해결 근거, 임의의 요청 식별자로 `resume_task`를 호출한다.
2. 작업 문서의 상태가 `todo`로 바뀌고 `history` 끝에 `{ at: <재개 시각>, kind: resumed }` 한 줄이
   붙는다. 같은 시각으로 `decisions/RESUME-XXXXXXXX.md`가 한 건 생기고 본문에는 입력한 해결 근거가
   그대로 있다. 기존 `## 막힌 사유` 절과 알 수 없는 프론트매터 필드는 그대로 남는다.
3. 같은 요청 식별자로 한 번 더 호출하면 성공을 다시 받지만 `resumed` 이력과 감사 파일은 각각 한 건
   그대로다.
4. `updated_at`을 다른 값으로 보내거나, `.workflow/.runtime/leases/<작업-id>.yml`에 미만료 lease를
   두거나, `.workflow/.runtime/migration.lock`이 있는 상태로 호출하면 거절되고 `tasks/`와
   `decisions/`의 파일 내용이 호출 전과 같다.

### QA-04 · 막힌 작업 패널에서 검증 근거를 입력하고 안전하게 재개한다

앱을 열고 왼쪽 메뉴에서 `개발`을 고른 뒤, `막힘` 열의 작업 카드를 눌러 상세를 연다. 오른쪽 패널
아래에 `개발 준비로 돌리기` 영역이 새로 있다.

1. 그 영역에서 `확인한 갱신 시각`과 `재개 조건`을 읽는다. 갱신 시각은 문서에 적힌 원문 그대로이고,
   재개 조건은 작업 문서의 `## 막힌 사유` 절에서 온다. 구조화된 사유가 없는 문서에서는 `작성된 재개
   조건이 없습니다`라는 안내가 대신 서고 재개 영역은 그대로 있다.
2. `해결 근거`에 무엇이 해결됐는지 적는다. 비어 있으면 `개발 준비로 되돌리기` 버튼이 눌리지 않고,
   입력한 글자 수가 입력칸 아래에 `n / 2,000자`로 보인다.
3. 버튼을 한 번 누르면 `한 번 더 누르면 재개`로 바뀌고 무엇을 기록하는지 알리는 문구가 뜬다. 이때는
   아직 아무것도 저장되지 않는다.
4. 한 번 더 누르면 재개된다. 정상이면 상태 배지가 `막힘`에서 `준비`로 바뀌고, 재개 영역이 사라지며,
   그 자리에 `사용자 재개 <시각>` 한 줄이 남는다. 상세 화면은 닫히지 않는다.
5. 왼쪽 메뉴의 `활동`으로 가면 그 작업에 `사용자 재개` 항목이 한 번 보인다. QA 반려의 `반려`와 개발
   시작의 `시작`은 이름이 그대로다.

거절 재현: 3번까지 진행한 상태에서 다른 편집기로 같은 작업 문서의 `updated_at`을 바꾼 뒤 4번을
누른다. 성공 표시 없이 거절 사유가 재개 영역 안에 뜨고, 입력한 근거는 지워지지 않으며, `문서 다시
읽기` 버튼으로 최신 문서를 다시 읽을 수 있다. `.workflow/.runtime/migration.lock`을 만들어 두거나
`.workflow/.runtime/leases/<작업-id>.yml`에 미만료 lease를 두고 눌러도 같은 방식으로 거절된다.

첫 적용 대상은 현재 막혀 있는 TASK-S051-04와 TASK-S051-06이다. 두 작업의 패널에는 각각 TASK-146과
TASK-147의 제목과 현재 상태가 참고 정보로 보이지만, 그 상태가 준비됐다고 앱이 대신 재개하지는
않는다. 언제 누를지는 사용자가 정한다.

화면이 없는 부분(게이트웨이 배선과 요청 형태)은 자동 검사로 닫았다.
