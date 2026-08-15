---
schema: workflow-labs/work-group@1
id: GROUP-DECISION-44483694
title: 프로젝트별 무인 에이전트 실행에 동의 관문을 둔다
status: active
revision: 1
qa_mode: user
source_spec_id: SPEC-RES-20260813T085941Z-17368-20260813085941
source_decision_id: DECISION-44483694
created_at: 2026-08-14T09:08:07.880257+00:00
updated_at: 2026-08-14T09:08:07.880257+00:00
---

# 프로젝트별 무인 에이전트 실행에 동의 관문을 둔다

## 기능 설명

기존 개발 작업을 기획서 기준의 작업 그룹으로 전환했습니다.

### QA-01 · 실행 환경에 프로젝트별 실행 권한 동의 기록과 확인·동의·철회 명령을 만든다

이 작업에는 눌러 볼 화면이 없다. 동의 기록과 세 명령은 앱이 부르는 실행 환경의 내부 계층이고, 그 계층을
쓰는 화면은 뒤따르는 작업이 만든다. 따라서 이 작업은 자동 검사로 닫았으며, 확인 도장은 아래 수치를
신뢰한다는 뜻이다.

확인하는 수치는 다음과 같다. `../../Git/claude-heartbeat`에서 실행한다.


마지막 수치가 이 작업의 핵심이다. 변경 전 저장소 전체 검사는 343 passed, 8 skipped였다. 늘어난 10개가
이 작업이 더한 검사이고, 건너뛴 8개는 그대로이며 실패는 없다. 즉 새 동작이 검사로 고정되었고 기존 동작은
하나도 깨지지 않았다.

완료 조건과 검사의 대응은 다음과 같다. 조건 1은 `test_contract_announces_the_three_consent_commands_and_the_required_notice_version`,
조건 2는 `test_consent_read_answers_absent_consent_with_success_not_failure`, 조건 3은
`test_consent_grant_succeeds_without_a_stored_configuration_and_stamps_the_time`, 조건 4는
`test_consent_grant_below_the_required_notice_version_records_nothing`과
`test_consent_grant_rejects_a_notice_version_that_is_not_an_integer`, 조건 5는
`test_raising_the_required_notice_version_invalidates_without_deleting_the_record`, 조건 6은
`test_consent_revoke_clears_only_the_named_project`, 조건 7은
`test_database_written_before_consent_existed_gains_the_table_and_keeps_its_rows`, 조건 8은
`test_consent_round_trips_and_stores_only_the_three_recorded_values`가 각각 확인한다. 조건 9는
`docs/agent-runtime-contract.md`의 "실행 권한 동의" 절을 읽어 확인한다.

직접 눈으로 보고 싶다면 아래 한 줄로 계약 조회 응답에 세 명령과 요구 고지 버전이 실렸는지 볼 수 있다.


`1 ['consent.grant', 'consent.read', 'consent.revoke']`가 나오면 맞다.

### QA-02 · 실행 환경의 모든 새 실행 경로에서 프로젝트 동의를 확인한다

이 작업에는 눈으로 볼 화면이 없다. 바뀐 것은 실행 환경이 세션을 시작하기 직전에 거치는 판정이고, 그
판정을 사람이 직접 실행해 볼 수 있는 화면이나 셸 명령은 이 저장소에 아직 없다. 동의를 남기고 지우는
명령은 표준 입력 JSON 계약으로만 구현돼 있어 셸에서 부를 수 없다. 따라서 이 작업은 자동 검사로 닫았고,
확인 도장은 아래 숫자를 신뢰한다는 뜻이다.


  동의 네 경우의 자동 배정 결과와, 실행 중 세션이 유지되는지, 동의 없는 프로젝트가 다른 프로젝트의
  배정을 멈추지 않는지를 확인한다.
  실행 실패와 다른 사유로 알리는지 확인한다.
  없으면 실행하지 않는 실제 서비스 검사이며, 이번 변경과 무관하다.

마지막 명령이 이 작업의 핵심이다. 직전 세션에서는 같은 명령이 3 failed, 360 passed였고, 실패하던 검사
세 개가 이번에 준비 코드만 고쳐 통과했다. 검사를 지우거나 건너뛰게 하거나 단언을 약하게 만든 곳은 없다.
한 줄뿐이다.

### QA-03 · 앱이 실행 환경의 동의 상태를 함께 읽고 동의와 철회를 전달한다

이 작업에는 눌러 볼 화면이 없다. 여기서 만든 것은 앱이 실행 환경과 주고받는 값과 두 개의 호출 통로이며,
그 값을 읽어 보여 주는 동의 화면은 뒤따르는 작업이 만든다. 따라서 이 작업은 자동 검사로 닫았고, 확인
도장은 아래 수치를 신뢰한다는 뜻이다.

앱 저장소 루트에서 실행한다. `cargo`가 없다는 오류가 나면 `export PATH="$HOME/.cargo/bin:$PATH"`를
먼저 실행한다.


첫 수치가 이 작업의 핵심이다. 변경 전 같은 명령은 738 passed, 0 failed였다. 늘어난 9개가 이 작업이 더한
검사이고 실패는 없다. 즉 새 동작이 검사로 고정되었고 기존 동작은 하나도 깨지지 않았다.

완료 조건과 검사의 대응은 다음과 같다. 조건 1은 `a_valid_consent_rides_along_with_the_configuration`,
조건 2는 `a_runtime_that_does_not_know_the_command_leaves_the_rest_of_the_read_intact`, 조건 3은
`a_consent_read_that_fails_for_another_reason_never_reads_as_granted`, 조건 4는
`a_project_without_a_consent_record_is_asked_for_one`, 조건 5는
`granting_consent_sends_the_project_and_the_notice_version`, 조건 6은
`revoking_consent_leaves_the_project_asking_for_consent_again`, 조건 7은
`the_consent_commands_are_registered_where_the_screen_can_call_them`, 조건 8은
`an_incompatible_runtime_is_never_asked_about_consent`가 각각 확인한다. 화면이 읽을 필드 이름과 상태
문자열은 `the_consent_value_reaches_the_screen_under_the_agreed_names`가 함께 고정한다. 조건 9는
`docs/agent-runtime.md`의 "실행 권한 동의" 절을 읽어 확인한다.

다음 한 줄로 이 작업이 더한 검사만 따로 볼 수 있다.


`8 passed, 0 failed`가 나온다. 아홉 개 중 이름에 consent가 없는
`a_runtime_that_does_not_know_the_command_leaves_the_rest_of_the_read_intact` 하나만 이 필터에 걸리지
않으므로, 그 하나는 위 전체 실행의 747에 포함된 것으로 확인한다.

### QA-04 · 첫 실행 행동 앞에 동의 관문을 두고 동의 상태와 철회를 화면에 붙인다

동의 기록이 없는 프로젝트가 출발점이다. 이미 동의한 프로젝트라면 고급 설정에서 먼저 철회하고 시작한다.

1. 에이전트 화면에서 자동 배정 스위치를 켠다. 자동 배정 켜기 확인 창 안에 "실행 권한 고지"와 다섯
   문장이 먼저 보이고, "위 내용을 읽고 실행 권한에 동의합니다"가 선택되지 않은 상태이며, 계속 버튼은
   "동의하고 자동 배정 켜기"이고 누를 수 없다.
2. 그 창에서 취소를 누른다. 자동 배정이 켜지지 않고 동의도 남지 않는다. 고급 설정의 실행 권한 동의는
   그대로 "동의 필요"다.
3. 다시 스위치를 켜고 확인 항목을 고른 뒤 "동의하고 자동 배정 켜기"를 누른다. 자동 배정이 켜지고,
   고급 설정의 실행 권한 동의가 "동의함"으로 바뀌며 동의 시각과 고지 버전 1이 보인다.
4. 직접 배정을 연다. 고지가 나오지 않고 기존처럼 작업을 고르고 시작 조건을 확인하는 흐름이 이어진다.
   참여 역할이나 실행 도구를 바꿔도 다시 묻지 않는다.
5. 고급 설정 > 실행 권한 동의에서 "고지 전문 다시 읽기"를 펼친다. 3에서 동의한 다섯 문장이 같은
   내용으로 보인다.
6. 같은 자리에서 "동의 철회"를 누른다. 확인 창이 이미 실행 중인 세션은 계속되며 실행 취소로 끝낼 수
   있다는 것과, 다시 실행하려면 최신 고지에 다시 동의해야 한다는 것을 알린다. 철회하면 자동 배정
   켜기와 직접 배정 확정에서 고지가 다시 나온다.
7. 자동 배정을 켜 둔 채 6의 철회를 하면 에이전트 화면에 "실행 권한 동의 필요"가 보인다. 그 자리에서
   "고지 읽고 동의"를 눌러 동의하면 설정을 저장하지 않고 동의만 남는다.
8. 7의 상태를 그대로 두고 왼쪽 메뉴에서 "오늘"을 누른다. 에이전트 화면을 벗어나도 첫 화면 위쪽의
   호환성·오류 배너와 같은 자리에 "실행 권한 동의 필요"가 보인다. 프로젝트를 닫았다 다시 열어도
   왼쪽 메뉴의 에이전트를 누르지 않은 채 같은 자리에서 이 알림을 만난다.
9. 8의 알림에서 "고지 읽고 동의"를 누른다. 고지 다섯 문장과 선택되지 않은 확인 항목이 있는 동의
   화면이 열린다. 확인 항목을 고르고 동의하면 알림이 사라지고, 고급 설정의 실행 권한 동의가
   "동의함"으로 바뀐다. 자동 배정 스위치는 켜진 그대로이고 다시 저장되지 않는다.
10. 에이전트 화면으로 돌아가면 "실행 권한 동의 필요"가 한 곳에만 보인다. 첫 화면의 알림과 에이전트
    화면의 안내가 함께 보이지 않는다.

실행 환경이 시작을 거절하는 두 경우와 동의 상태를 읽지 못하는 두 경우는 손으로 만들기 어려워 자동
검사로 확인했다. 아래 명령의 결과를 보는 것으로 이 부분의 확인을 갈음한다.
