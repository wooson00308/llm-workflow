---
schema: workflow-labs/work-group@1
id: GROUP-DECISION-7DD17262
title: 프로젝트별 병렬 CLI 에이전트 런타임과 실행 UX
status: active
revision: 1
qa_mode: user
source_spec_id: SPEC-051
source_decision_id: DECISION-7DD17262
created_at: 2026-08-14T09:08:07.880257+00:00
updated_at: 2026-08-14T09:08:07.880257+00:00
---

# 프로젝트별 병렬 CLI 에이전트 런타임과 실행 UX

## 기능 설명

기존 개발 작업을 기획서 기준의 작업 그룹으로 전환했습니다.

### QA-01 · 자동 배정이 대상 선점과 결과 식별자를 한 번에 예약한다

화면이 없는 백엔드 계약 작업이다. 아래 자동 검사가 성공한 결과를 확인하고 그 숫자를 신뢰해 QA
확인을 남긴다.

### QA-02 · 런타임 제어 계약과 프로젝트별 영속 상태를 만든다

화면이 없는 명령 계약 작업이다. 자동 검사와 다음 명령 결과로 확인한다.

2. 임시 저장소를 지정하고 유효한 세 역할 설정을 `heartbeat agent config write`에 JSON으로 전달 → 성공 결과가 저장한 설정을 그대로 반환한다.
3. 같은 프로젝트 식별자로 `heartbeat agent state` 실행 → 앞 설정과 빈 큐·실행·오류 목록이 JSON으로 표시된다.

### QA-03 · Claude와 Codex CLI를 같은 실행 결과로 정규화한다

화면 확인 대상은 없다. 이 작업은 provider 실행 계약과 프로세스 감시 로직만 바꾸므로 자동 검사
결과를 근거로 확인한다. QA 확정은 아래 숫자를 직접 확인한 뒤 그 결과를 신뢰한다는 뜻이다.

2. 19개 검사가 모두 통과하는지 확인한다. 기존 13건은 명령 인자·표준 입력·진단·구조화 이벤트·
   민감정보 제거·취소와 시간 초과 뒤 자식 프로세스 정리를 그대로 검증한다.
3. QA 수정 요청으로 추가한 6건은 다음 이름으로 확인한다.
   - `test_start_returns_a_running_handle_with_pid_start_time_and_event_file`: 실행이 끝나기 전에
     PID·시작 시각·이벤트 파일 경로를 담은 핸들이 돌아온다.
   - `test_start_failures_separate_the_diagnostic_stage_from_the_spawn_stage`: 진단 실패와 실행 파일
     생성 실패가 서로 다른 단계로 구분된다.
   - `test_watch_resumes_from_the_last_offset_and_withholds_a_partial_line`: 같은 offset 재요청이
     같은 결과를 내고, 완결되지 않은 마지막 줄은 노출되지 않는다.
   - `test_cancel_through_the_handle_stops_the_child_process_tree`: 핸들만으로 취소하면 손자
     프로세스까지 사라지고 종료 결과가 cancelled가 된다.
   - `test_event_file_never_contains_the_prompt_or_environment_secret`: 이벤트 파일과 핸들에서
     prompt와 가짜 API 키가 검색되지 않는다.
   - `test_cancelling_a_run_this_provider_does_not_own_is_not_reported_as_success`: 이 프로세스가
     시작하지 않은 실행의 취소는 성공으로 보고되지 않는다.
   1 deselected를 확인한다. 제외한 한 검사는 이번 범위 밖의 기존 jobs.d 격리 문제다.

### QA-04 · 프로젝트별 큐가 병렬 배정과 반복 실행을 안전하게 이어간다

화면 확인 대상은 없다. 이 작업은 런타임 저장소와 제어 명령과 프로세스 감시만 바꾸므로 자동 검사
결과를 근거로 확인한다. QA 확정은 아래 숫자와 명령 출력을 직접 확인한 뒤 그 결과를 신뢰한다는 뜻이다.
자동 검사는 예약 도구와 provider를 가짜 실행 파일로 대체한다. 실제 예약 자산을 쓰는 종단 확인은
TASK-S051-11의 범위다.

1. `claude-heartbeat` 저장소에서
   실행해 41개 검사가 모두 통과하는지 확인한다.
2. 배정 규칙은 `tests/test_agent_dispatch.py`에서 확인한다.
   - `test_started_runs_stop_at_the_smallest_limit`: 역할 3, 프로젝트 5, 기기 남은 슬롯 4, 예약 가능
     2에서 두 실행만 시작된다.
   - `test_reservation_exit_codes_become_distinct_failure_stages`: 종료 코드 1은 `reservation`,
     2는 `request_validation`이며 2는 재시도하지 않는다.
   - `test_missing_reservation_helper_starts_nothing_and_writes_no_lease`: 도구가 없으면 호출도
     하지 않고 lease 파일도 생기지 않는다.
   - `test_manual_requests_are_refused_before_any_reservation`: 중복·잘못된 식별자·활성 lease가
     예약 전에 사유와 함께 막힌다.
   - `test_only_one_dispatcher_wins_the_same_target`: 네 개가 같은 대상을 노려도 실행은 하나다.
   - `test_two_projects_take_turns_on_the_device_slots`: 두 프로젝트가 모두 기기 슬롯을 받는다.
   - `test_one_broken_project_does_not_stop_the_other`: 한 프로젝트의 예약 실패가 다른 프로젝트를
     막지 않는다.
   - `test_role_prompt_reaches_stdin_but_never_the_database_or_events`: prompt는 표준 입력에만
     전달되고 데이터베이스·이벤트 파일·실행 행에서는 검색되지 않는다.
3. 복구와 정리는 `tests/test_agent_recovery.py`에서 확인한다.
   - `test_a_live_process_is_resumed_instead_of_started_again`: 살아 있는 실행을 다시 시작하지 않는다.
   - `test_events_resume_from_the_last_offset_without_duplicates`: 이벤트가 중복되지 않는다.
   - `test_a_reused_pid_is_never_adopted_as_the_running_job`: PID 재사용 의심은 `recovery_required`다.
   - `test_losing_lease_ownership_while_running_keeps_the_process`: 갱신이 5를 내도 프로세스를
     끊지 않는다.
   - `test_release_exit_codes_separate_cleanup_success_from_failure`: 반납 5는 정리 성공, 1은
     `recovery_required`다.
   - `test_partial_cancel_cleanup_is_not_reported_as_success`: 일부 정리 실패는 전체 성공이 아니다.
   - `test_retry_keeps_the_failed_run_and_links_the_new_one`: 재시도가 이전 실패 행을 덮어쓰지 않는다.
4. 제어 명령 표면은 `tests/test_agent_cli.py`의 `test_contract_reports_the_execution_commands_as_implemented`와
   `test_start_needs_the_same_plan_and_an_explicit_confirmation`으로 확인한다. 설치된 CLI가 있으면
   `heartbeat agent contract`를 직접 실행해 `implementedCommands`에 실행 명령 여덟 개가 있고
   `reservedCommands`가 빈 목록인지 볼 수 있다.
   1 deselected를 확인한다. 제외한 한 검사는 이번 범위 밖의 기존 jobs.d 격리 문제다.

### QA-05 · 런타임을 독립 실행형으로 배포하고 세 운영체제에서 복구한다

이번 재작업의 확인 대상은 조회 명령 하나다. 화면은 없고 자동 검사와 명령 출력으로 확인한다.
QA 확정은 아래 숫자와 출력을 직접 확인한 뒤 그 결과를 신뢰한다는 뜻이다.

   26개 검사가 통과하는지 확인한다(플랫폼 전용 7건은 다른 운영체제에서 건너뛴다).
2. 조회 명령을 직접 실행한다. `heartbeat runtime inspect`(또는 저장소에서
   `python -c "from heartbeat.cli import runtime_status; import json; print(json.dumps(runtime_status(), indent=1))"`).
   응답 한 덩어리에 `installedVersion`, `runningVersion`, `apiMajor`, `target`, `recoverable`,
   `service.registered`, `service.running`, `service.label`, `service.executable`, `checkedAt`,
   `evidence`가 모두 들어 있는지 본다.
3. 실패 구분은 `tests/test_service.py`에서 확인한다.
   - `test_missing_registration_is_its_own_result`: 등록 없음.
   - `test_a_registration_without_its_executable_is_not_recoverable`: 실행 파일 없음.
   - `test_two_registrations_are_ambiguous_instead_of_one_guess`: 등록물 중복.
   - `test_unreadable_state_never_becomes_running`: 권한 부족과 도구 없음이 실행 중으로 승격되지 않는다.
   - `test_a_platform_without_an_adapter_answers_in_the_same_shape`: 지원하지 않는 플랫폼.
   - `test_every_adapter_returns_the_same_inspect_fields`: 세 어댑터의 필드와 뜻이 같다.
4. 설치 쪽 구분과 무쓰기는 `tests/test_agent_package.py`에서 확인한다.
   - `test_status_reports_installed_running_and_service_facts_in_one_response`: 한 응답에 모두 담긴다.
   - `test_installed_runtime_separates_the_ways_an_install_can_be_unreadable`: launcher 없음, 버전
     디렉터리 없음, manifest 못 읽음이 서로 다른 결과다.
   - `test_an_incompatible_api_major_is_its_own_result`: 지원하지 않는 버전.
   - `test_status_never_turns_an_unconfirmed_service_into_a_running_version`: 확인 못 한 서비스에서
     실행 중 버전을 만들어내지 않는다.
   - `test_status_changes_nothing_it_reports_on`: 조회 전후 해시가 같다.
   - `test_only_one_command_answers_the_device_status_question`: 두 번째 조회 명령이 생기지 않았다.
5. 응답 필드가 TASK-147 문서의 기기 조회 항목과 어긋나지 않는지 대조한다. 이름과 뜻은
   `docs/agent-runtime-contract.md`의 `기기 상태 조회` 절에 적어 두었다.
   1 deselected를 확인한다. 제외한 한 검사는 이번 범위 밖의 기존 jobs.d 격리 문제다.

### QA-06 · 앱이 호환 런타임 설치와 업데이트를 안전하게 관리한다

이번 QA는 실제 서비스에 적용하지 않고, 같은 코드와 런타임을 별도 앱 식별자에 묶은 격리 번들에서
설치 계획까지만 확인한다. 정상 최신 앱은 현재 에이전트 화면에 열어 두었다.

1. `src-tauri/target/debug/bundle/macos/LLM Workflow QA.app`을 열고 최근 프로젝트
   `workflow-labs` → 좌측 `에이전트` → `설치 계획 보기`를 누른다.
2. 설치 계획에 아래 값이 모두 보이면 정상이다.
   - 서비스 전환: `필요함`
   - 처리 방법: `기존 서비스 이전 필요`
   - 서비스 신원: `com.catze.dream-heartbeat`와 실제 Python 실행 경로
   - 등록 / 실행: `예 / 아니요`
3. 같은 계획의 안내에 기존 서비스를 그대로 유지하고 런타임 파일과 launcher만 놓으며,
   `삭제·중지·덮어쓰기·중복 등록하지 않습니다`와 `기존 역할 잡 이전` 미리보기가 명시돼야 한다.
4. `이 계획을 적용`은 누르지 않는다. 외부·확인 불가 서비스에서 등록 명령을 호출하지 않는 경계와
   미등록만 한 번 등록하는 경계는 자동검사로 확인했다.

격리 앱은 `com.workflowlabs.desktop.qa` 데이터 루트를 사용하므로 정상 앱의 설치본과 설정을 바꾸지 않는다.
실기기 확인에서도 설치 계획 생성만 수행했고 기존 서비스에는 변경 명령을 보내지 않았다.

### QA-07 · 앱이 프로젝트별 역할 정책을 런타임 계약으로 저장한다

화면은 이 작업의 범위가 아니다. 백엔드 명령만 만들었으므로 자동 검사 결과로 확인한다. QA 확정은
아래 숫자와 검사 이름을 직접 확인한 뒤 그 결과를 신뢰한다는 뜻이다.

   이번에 더한 11건이 그 안에 있다.
3. 저장과 재조회를 `src-tauri/src/application/agent_runtime_config_service.rs`에서 확인한다.
   - `a_stored_configuration_comes_back_field_for_field`: provider, model, 실행 방식, 최대 병렬 인원,
     판정 간격, 실행 한도가 저장된 값 그대로 돌아온다.
   - `a_project_without_a_stored_configuration_gets_the_default_limits`: 역할 상한 1과 프로젝트 상한
     3이 새 프로젝트에 적용된다.
   - `two_projects_never_mix_their_values`: 프로젝트를 바꾸면 식별자와 작업 디렉터리와 역할 값이
     그 프로젝트만 따른다.
   - `a_matching_revision_writes_once_and_returns_the_saved_value`: 쓰기 호출이 정확히 한 번 나간다.
4. 무쓰기 거절을 확인한다.
   - `a_save_on_a_stale_revision_writes_nothing_and_returns_the_current_value`: 경합한 저장은 최신
     값을 받고 쓰기 호출이 나가지 않는다.
   - `an_unsupported_provider_is_refused_before_the_runtime_is_called`와
     `an_incompatible_runtime_is_never_written_to`: 잘못된 provider와 호환되지 않는 런타임은 런타임을
     부르기도 전에 막힌다.
   - `a_role_the_contract_cannot_disable_is_refused_instead_of_silently_enabled`: 아래 계약 공백 참고.
5. 마이그레이션을 확인한다.
   - `the_migration_preview_keeps_every_legacy_value_or_lists_it`: interval과 max_per와 model이
     그대로 옮겨지고, 읽지 못한 값과 대응 필드가 없는 timeout이 unresolved 목록에 남는다. 기존 잡이
     없는 역할은 손대지 않는다.
   - `a_preview_from_older_jobs_cannot_be_applied`: 미리보기 뒤 잡이 바뀌면 적용이 거절된다.
6. provider 진단이 설정과 갈라져 있는지 `provider_diagnostics_ride_along_without_changing_the_stored_values`로
   확인한다. 미설치·로그인 필요·권한 부족·지원하지 않는 버전이 그대로 실려 오고 저장값은 바뀌지 않는다.
7. 저장이 provider를 띄우지 않는 것은 위 검사 전부가 가짜 호출자만 쓰고 프로세스를 만들지 않는 것으로
   확인된다. 기존 잡과 Dream을 읽고 쓰는 경로도 이 모듈에 없다.

### 이번 구현에서 사용자가 알아야 할 계약 공백 하나

설정 계약 1번은 역할마다 `enabled`를 두라고 하는데, 런타임의 설정 계약에는 역할을 끄는 필드가 없다.
세 역할은 언제나 존재하고 최대 병렬 인원은 1 이상이어야 한다. 그래서 앱은 `enabled: false`를 조용히
켠 채로 저장하지 않고 쓰기 전에 거절한다. 역할을 실제로 끄려면 런타임 설정 계약에 필드가 하나 필요하고,
그 파일은 이 작업의 범위 밖이다.

### QA-08 · 앱이 실행 계획과 큐 상태와 제어 결과를 런타임에서 읽는다

화면은 이 작업의 범위가 아니다. 백엔드 명령만 만들었으므로 자동 검사 결과로 확인한다.

   이번에 더한 18건이 그 안에 있다.
2. 계획과 시작을 `src-tauri/src/application/agent_runtime_run_service.rs`에서 확인한다.
   - `a_plan_reports_candidates_and_limits_without_starting_anything`: 후보와 제외 사유와 제한이
     provider 시작 없이 온다.
   - `a_stale_plan_becomes_a_new_plan_request_not_a_success`: 조건이 달라진 계획은 성공으로 바뀌지
     않고 새 계획 필요로 전달된다.
   - `starting_sends_the_plan_and_the_confirmation`: 계획 식별자와 확인이 함께 간다.
   - `an_incompatible_runtime_is_never_asked_to_plan_or_start`: 호환되지 않으면 요청 자체를 보내지
     않는다.
   - `no_command_this_service_sends_starts_a_process_outside_the_queue`: 이 서비스가 보내는 인자에
     `once`도 provider 이름도 없다. 실행은 언제나 큐를 거친다.
3. 취소와 재시도를 확인한다.
   - `cancel_without_a_confirmation_only_previews`: 확인 전에는 미리보기만 오고 요청에 확인 값이
     실리지 않는다.
   - `a_cancel_with_a_remaining_stage_is_not_reported_as_applied`: 정리 단계가 남으면 전체 성공이
     아니다.
   - `a_retry_must_carry_a_new_run_identifier`와 `a_retry_links_the_previous_run`: 재시도는 새 실행
     식별자를 쓰고 이전 실행을 가리킨다.
4. 상태와 제어를 `src-tauri/src/application/agent_runtime_status_service.rs`에서 확인한다.
   - `every_contract_state_survives_the_round_trip`: 여덟 상태가 모두 구분돼 오고 역할·provider·
     대상·시작 시각이 함께 실린다.
   - `a_runtime_that_cannot_be_read_leaves_the_state_unknown`: 조회 실패는 모름이지 실행 중이 아니다.
   - `rows_from_another_project_make_the_whole_answer_untrusted`와
     `a_pause_answered_for_another_project_is_not_a_success`: 프로젝트 신원이 어긋나면 성공으로
     처리하지 않는다.
   - `pausing_one_project_reports_only_that_project`: 일시 정지는 새 배정만 막고 돌던 실행은 목록에
     그대로 있다.
   - `the_log_page_travels_by_cursor_and_carries_no_path`: 로그 요청에 파일 경로가 실리지 않는다.

### 확인 시점의 프런트 검사 상태

프런트 작업이다. 그쪽 세션이 `src/features/projects/domain/types.ts`의 게이트웨이 타입에 에이전트
런타임 메서드를 더했는데, 그 타입을 구현하는 검사용 대역
어긋난다. 이 작업은 TypeScript 파일을 하나도 바꾸지 않았고 범위 파일도 모두 `src-tauri` 아래다.
프런트 작업이 끝난 뒤 다시 실행하면 통과해야 한다.

### QA-09 · 프로젝트 에이전트 화면에서 설치와 역할 정책을 관리한다

1. 최신 디버그 앱에서 프로젝트를 열고 왼쪽의 `에이전트`로 이동한다. 실행 환경이 정상이라면 제목 옆과
   준비 카드에 `상태 다시 확인` 또는 `업데이트 계획 보기`가 나타나지 않아야 한다.
2. 런타임이 없거나 호환되지 않는 검사 상태에서는 설치·업데이트·복구 중 현재 필요한 계획 행동 하나만
   나타나야 한다. 계획을 만들기 전에는 적용 버튼이 없어야 한다.
3. 화면 아래의 역할 정책에서 기획자, 아키텍트, 개발자가 한 줄짜리 역할명과 각각의 카드로 보여야 한다.
   실행 도구, 모델, 실행 방식, 최대 인원은 바로 보이고 판정 간격과 실행 한도는 `고급 실행 설정` 안에
   있어야 한다.
4. `기존 설정 가져오기`와 `기기 전체 한도`는 기본으로 접혀 있어야 한다. 역할 정책 저장은 첫 조작에서
   저장 내용을 보여주고 두 번째 확인에서만 실행돼야 한다.
5. 확인에 사용한 앱은 `src-tauri/target/debug/bundle/macos/LLM Workflow.app`이다. 화면 검사 48건,

### QA-10 · 에이전트 화면에서 실행 계획과 큐를 확인하고 제어한다

1. 런타임 v0.8.3을 묶은 최신 로컬 앱에서 프로젝트를 열고 `에이전트`의 `작업` 탭으로 이동한다.
2. 실행 중인 기록은 시작 시각 옆에 `진행 시간 1분 미만` 또는 온전한 분 수만 보이고 초 숫자가 계속 움직이지 않아야 한다.
3. `최근 종료`의 성공·실패·취소·복구 필요 기록은 시작 시각 옆에 `소요 시간`이 보인다. 1분 미만 종료만 초 단위이고, 1분 이상은 온전한 분 수로 보이면 정상이다.
4. 종료 기록을 본 채 기다리거나 다른 탭을 다녀온 뒤 돌아온다. 같은 기록의 소요 시간이 늘어나지 않아야 한다.
5. 종료 시각이 없는 구형 런타임 fixture에서는 현재 시각으로 추정한 큰 숫자 대신 `소요 시간 기록 없음`이 보여야 한다.
6. 대상 0, API 과금 위험, stale plan, 취소, 재시도, 구조화 로그의 기존 확인·비밀값 차단 계약이 그대로 동작하면 정상이다.

### QA-11 · 두 저장소의 런타임 릴리스 계약을 종단 검증으로 고정한다

`으로 최종 소비 절차를 기록한다. 문서와 화면 검사는 범위에 있고 실제 계정이나 제품 화면 코드는 편집하지 않는다.
- 값 경로: 완료 조건 10의 quota 값은 `../../Git/claude-heartbeat/src/heartbeat/core.py`의 `HEARTBEAT_FILE`과 `JOBS_DIR`를 `parse_heartbeat_md`가 병합하고, `../../Git/claude-heartbeat/tests/test_quota.py`의 `test_parse_heartbeat_md_max_per_field`가 두 경로를 모두 임시 디렉터리로 바꾼 뒤 `max_per`를 최종 소비한다. 제품 파서는 jobs.d 우선순위를 이미 올바르게 전달하므로 범위에서 제외하고, 격리가 빠진 검사 파일만 편집 범위에 넣었다.
- 값 경로: 완료 조건 12의 부분 성공 값은 `src/features/projects/infrastructure/tauriProjectGateway.ts`의 `inspectAgentRuntime`이 `AgentRuntimeInspection`을 만들고 `src/features/projects/application/useProjectWorkspace.ts`의 `readAgentRuntime`이 inspection 성공을 `AgentRuntimeState.inspection`에 먼저 보존한 뒤 `readAgentRuntimePolicy` 실패 원문을 `readError`에 별도로 저장한다. 같은 훅의 반환값을 `src/features/projects/components/WorkspaceShell.tsx`가 `AgentRuntimeView`의 `state`로 그대로 넘기고, `src/features/projects/components/agents/AgentRuntimeView.tsx`의 `readinessOf`가 launcher 미설치 inspection을 `설치 계획 보기`로 소비하며 `readError`도 별도 상태 문구로 표시한다. 편집이 필요한 훅과 `src/features/projects/application/useProjectWorkspace.test.ts`는 범위에 추가했다. gateway, `AgentRuntimeState` 타입, WorkspaceShell, AgentRuntimeView는 현재 값을 이미 손실 없이 전달하고 올바르게 소비하므로 편집 범위에서 제외했다.
