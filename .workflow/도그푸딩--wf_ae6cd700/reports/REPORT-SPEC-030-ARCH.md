# SPEC-030 아키텍트 핸드오프

- 대상: DECISION-4B917B03 (SPEC-030 승인, `created_by: user`, 2026-08-04T11:16:56Z)
- 산출 작업: TASK-097, TASK-098 (둘 다 `todo`)
- 세션: 2026-08-04T11:26Z~11:35Z / `wf-claim.sh acquire` exit 0 → `renew` exit 0 → `release`
- 자격 재검증: 클레임 직후 `grep -ls "source_decision_id: DECISION-4B917B03" tasks/*.md` 결과 0건.
  SPEC-030의 결정은 이 하나뿐이므로 최신 앱 소유 결정이 `approved`다.

## 산출물

| 작업 | 범위 파일 | 닫는 요구사항 |
| --- | --- | --- |
| TASK-097 | `heartbeat_condition.rs`, `role_eligibility.rs` | R1, R2, R3, R5(조건 스크립트 축) |
| TASK-098 | `project_instructions.rs` | R4, R5(규칙 자산 축) |

## 의존 지도

TASK-097 — 선행 없음. TASK-098 ← `depends_on: [TASK-097]`.

**파일은 겹치지 않는다.** 순서의 근거는 코드 충돌이 아니라 문언과 사실의 선후다 — TASK-098이 지울
불릿("planner branch does not read `created_by` … Until that branch reads `created_by` too, the app
and the heartbeat disagree")이 말하는 상태는 TASK-097이 판정을 고친 뒤에야 거짓이 된다. 먼저 지우면
계약이 "닫혔다"는 침묵으로 거짓말을 한다. SPEC-030 R4 첫 항목("그 문장이 말하는 상태는 R1 이후 참이
아니다")이 이 순서를 직접 지시하고, TASK-088이 SPEC-028에서 같은 순서를 같은 이유로 세웠다.

그 외 병렬 제약은 만들지 않았다. 두 작업 사이에 다른 겹침이 없다.

## 완료 조건 14를 어떻게 지켰는가

기획서 완료 조건 14가 "`heartbeat_condition.rs`와 `project_instructions.rs`를 만지는 작업이 이번
분해에서 각각 하나뿐"을 요구한다. 위 표대로 각각 TASK-097·TASK-098 하나씩이다.

`role_eligibility.rs`를 TASK-097에 붙인 이유는 셋이다.

1. 그 파일에서 이 분해가 만지는 것은 **모듈 머리 주석과 대조 테스트뿐**이고, 판정 함수는 무변경이다
   (확인 사실 3대로 앱은 이미 옳다).
2. "알려진 차이 5"(확인 사실 6)는 스크립트가 고쳐진 뒤에만 좁아진다. 따로 떼면 TASK-097에
   `depends_on`으로 매달릴 수밖에 없어 병렬 여지가 0인데 문서만 하나 늘어난다.
3. R3 첫·둘째 항목이 요구하는 "앱과 스크립트가 같은 답을 낸다"의 단언 자리가 그 파일의 테스트다.
   판정 변경과 그 대조가 한 리뷰 단위에 있어야 한다. TASK-086이 같은 두 파일을 한 작업으로 묶은
   선례다.

## 병행 안전 확인 결과 (확인 사실 11·12)

분해 시점에 세 파일을 범위로 삼은 미완료 작업은 전부 `qa_waiting`이고 `todo`·`in_progress`는 0건이다.

- `heartbeat_condition.rs`: TASK-043·044·045·047·075·076·086·088 (8건, 전부 `qa_waiting`)
- `role_eligibility.rs`: TASK-043·044·058·075·076·086·088 (7건, 전부 `qa_waiting`)
- `project_instructions.rs`: TASK-086·088 (2건, 둘 다 `qa_waiting`)

**QA가 그중 하나를 `todo`로 되돌리면 같은 파일에 두 세션이 붙는다.** 두 작업 문서 모두에 "착수 직전에
다시 확인하고, 겹치면 `blocked`으로 두고 상신한다"를 적었다. 개발자가 임의로 병행하지 않게 하는 것이
목적이다.

## 아키텍트 판단으로 못 박은 것

- **버전 상수를 고정값으로 적지 않았다.** 분해 시점 값은 `CONDITION_SCRIPT_VERSION` 6,
  `WORKFLOW_RULES_VERSION` 8이지만, 설치본은 각각 4와 7이라 어긋나 있고 미착지 작업이 여럿
  `qa_waiting`이다(확인 사실 8). 두 작업 모두 "착수 시점 값을 읽어 +1, 그 값을 보고서에 적는다"로
  적었다. TASK-088의 선례를 그대로 따랐다.
- **설치본 직접 수정 금지를 두 작업 모두의 범위 밖에 명시했다.** `.workflow/rules/wf-eligible.sh`와
  `.workflow/rules/workflow.md`는 앱 설치 경로의 산출물이다. 시나리오 표 테스트는 임시 프로젝트에
  상수 본문을 설치해 돌리므로 설치본에 의존하지 않는다(확인해 봤다:
  `the_installed_script_matches_the_scenario_table`이 `project()` + `install_condition_script`로
  픽스처를 세운다).
- **픽스처 헬퍼가 하나 부족하다는 것을 TASK-097에 적었다.** `write_decision_document`는
  `outcome: approved`가, `write_later_revision_request`는 `created_by: user`와 `created_at`이 본문에
  박혀 있어 확인 사실 4·5의 두 행을 세울 수 없다. **기존 헬퍼 시그니처를 바꾸는 대신 하나를 더한다**로
  방향을 지정했다 — 기존 행 불변이 완료 조건 12다.
- **사유 코드는 늘리지 않는다.** `eligible`·`no-target`으로 두 행이 다 표현된다. 기획서 제외 범위
  ("조건 스크립트의 사유 출력 규약")를 지킨다.

## 후속 / 리스크

1. **`outcome` 값 목록 차이는 그대로 남는다.** 기획서 제외 범위이고 "알려진 차이 5"에 남길 항목이
   정확히 그것이다. 기획서가 "후속 아이디어로 올릴 것을 권한다"라고 적었다. 이 세션은 아이디어를
   만들지 않았다(역할 밖).
2. **CI 세 플랫폼 실행은 로컬에서 확인되지 않는다.** R2 둘째 항목과 완료 조건 5가 요구하는 것은 세
   러너이고, 개발자 세션은 보통 한 플랫폼만 돈다. 두 작업 중 TASK-097의 완료 조건 5에 "한 플랫폼만
   돈 경우 그 사실과 플랫폼을 보고서에 적는다"를 넣었다. PowerShell 본문의 실제 실행 검증은 CI에서만
   난다는 뜻이고, 그 한계를 감춘 채 착지하지 않게 하는 장치다.
3. **게이트에 타 세션 위반이 남아 있다**(확인 사실 13): `heartbeat_status.rs` fmt 1건,
   `heartbeat_process.rs:216` clippy 1건. 두 작업 모두 완료 조건 마지막 항목에 "그것과 이 작업이 만든
   결과를 구분해 적는다"를 넣었다.
4. **id 경합.** 분해 시점에 `TASK-095`·`TASK-096`이 `RESERVED` 본문만 있는 상태였다 — SPEC-029 분해
   세션(lease `SPEC-029`, `expires_at: 2026-08-04T11:45:09Z`)이 선점 중인 번호다. 그 둘을 건드리지
   않고 `set -C` 배타 생성으로 097·098을 원자적으로 선점한 뒤 내용을 채웠다. RESERVED 잔여 0,
   타 세션 문서 무손상.
