---
schema: workflow-labs/spec@1
id: SPEC-030
title: 조건 스크립트 기획자 분기가 created_by를 읽어 대리 결정 비대칭을 닫는다
status: user_review
source_idea_id: IDEA-ACAE7F01
created_at: 2026-08-04T10:56:15Z
updated_at: 2026-08-04T11:00:10Z
---

# 조건 스크립트 기획자 분기가 created_by를 읽어 대리 결정 비대칭을 닫는다

## 기획 내용

아이디어는 조건 스크립트의 기획자 분기가 `created_by`를 읽지 않아 앱과 하트비트가 갈린다고 적었다. 그 갈림을 직접 재현했고, 아이디어가 적은 대로였다(확인 사실 4). 처방의 모양도 아이디어가 적은 대로다 — 아키텍트 분기가 이미 쓰고 있는 두 줄을 기획자 분기에도 넣고, 계약이 자기 결함을 명시해 둔 임시 문장을 지우면서 두 버전 상수를 올린다.

다만 재현하는 과정에서 같은 결함이 반대 방향으로도 성립하는 것을 확인했고, 아이디어는 그쪽을 적지 않았다. 대리 결정이 수정 요청을 가리는 것(하트비트가 있는 일감을 못 봄)이 아이디어의 재현이고, 대리 `revision_requested` 하나만 있는 기획서는 그 반대로 하트비트만 일감으로 센다(앱은 안 보이는데 기획자를 깨움). 둘 다 원인이 하나다 — 기획자 분기가 결정 문서를 고를 때도, 더 늦은 결정을 찾을 때도 `created_by`를 안 본다. 비교 루프만 고치면 가림은 닫히지만 헛기동은 남는다(확인 사실 5). 아이디어의 목표가 "비대칭을 닫자"이므로 양쪽을 함께 닫는 것을 제안하고, 아이디어의 문언을 넘는 부분이라 확인 필요 1번으로 올린다.

버전 상수는 고정값으로 적지 않는다. 이 저장소는 지금 상수(조건 스크립트 6, 공통 규칙 8)와 설치본(4, 7)이 서로 다르고, 미착지 작업이 여럿 qa_waiting으로 대기 중이라 착수 시점 값이 지금 값과 또 다를 수 있다(확인 사실 8·11). TASK-088이 "값을 가정하지 말고 착수 시점 값을 읽어 +1"로 처리한 선례를 따른다.

판정 결과 불변 검증은 TASK-086의 선례를 따른다. 이 저장소의 결정 문서 75건은 전부 `created_by: user`이고 `user-delegate`는 0건이므로(확인 사실 10), 실저장소 판정은 세 역할 모두 전후가 같아야 한다. 달라지는 것은 대리 결정이 섞인 픽스처뿐이어야 한다.

### 확인 사실

2026-08-04 기준 작업 트리와 이 저장소의 실제 문서에서 직접 읽거나 실행한 값이다. 저장소에 미커밋 변경이 크므로 줄 번호는 작업 트리 기준이다.

1. 기획자 분기는 `created_by`를 두 자리 모두에서 안 본다. 설치본 `.workflow/rules/wf-eligible.sh`의 `planner)` 절(`:84`~`:128`)은 후보 결정을 고를 때 스키마 줄·`spec_id` 유무·`outcome: revision_requested`만 보고, 더 늦은 결정을 찾는 비교 루프(`:112`~`:120`)는 스키마 줄과 `spec_id` 일치만 본다. 작업 트리 상수도 같다 — `heartbeat_condition.rs`의 sh 본문 `:122`~`:166`(비교 루프 `:150`~`:158`), ps1 본문 `:400`~`:450`(비교 루프 `:427`~`:441`).
2. 아키텍트 분기는 두 자리 모두에서 본다. sh 본문 `:167`~`:202`가 후보 결정에서 `created_by`를 뽑아 `user`가 아니면 건너뛰고, 비교 루프에서도 같은 두 줄을 쓴다. 주석이 이유를 적는다 — "값 전체를 비교한다 — 접두 일치로 두면 위임 대리 결정의 `user-delegate`가 걸러지지 않는다", "비교 대상도 `created_by`로 거른다 — 앱이 세지 않는 결정을 여기서만 더 늦은 것으로 세면 두 판정이 갈라진다". ps1 본문 `:452` 이하가 같은 내용을 영어 주석으로 적는다. 즉 이 기획서가 요구하는 어법은 이미 이 저장소 안에 있다.
3. 앱은 두 자리 모두에서 거른다. `fs_project_repository.rs:1560`의 `read_spec_decisions`가 `:1575`~`:1579`에서 스키마와 `created_by: user`를 함께 검사하고 `:1590`에서 `outcome`을 세 값으로 제한한다. `latest_revision_requests`(`:1653`)는 그렇게 걸러진 목록 안에서만 `created_at`을 비교하므로, 앱에게는 대리 결정이 후보로도 비교 대상으로도 존재하지 않는다.
4. 가림 방향을 재현했다. 임시 디렉터리에 픽스처를 만들고 저장소 파일은 읽기만 했다. `SPEC-X`에 `DECISION-REV`(`revision_requested`, `created_by: user`, 08-01)만 둔 상태에서 `planner`는 설치본(버전 4) `exit 0`, 작업 트리 본문(버전 6) `eligible` / `exit 0`. 여기에 `DECISION-DELEGATE`(`approved`, `created_by: user-delegate`, 08-02)를 더하자 설치본 `exit 1`, 작업 트리 본문 `no-target` / `exit 1`. 앱은 확인 사실 3대로 그 수정 요청을 계속 최신으로 세므로 화면과 하트비트가 갈린다. REPORT-TASK-088-DEV.md의 실측 절과 같은 결과이고, 이번에는 두 버전 본문 모두에서 확인했다.
5. 반대 방향도 같은 픽스처에서 확인했다. `SPEC-Y`에 `DECISION-DREV`(`revision_requested`, `created_by: user-delegate`) 하나만 두면 `planner exit 0`(eligible)인데, 앱은 확인 사실 3대로 그 문서를 아예 읽지 않으므로 기획자 대기 물량이 0이다. 같은 픽스처에서 `architect`는 `exit 1`이다 — 아키텍트 분기는 확인 사실 2의 필터로 이미 닫혀 있다. 하트비트가 깨운 기획자 세션은 계약상 유효한 대상을 못 찾아 `NO_ELIGIBLE_WORK`로 돌아간다.
6. 남은 차이가 코드에 목록으로 적혀 있다. `role_eligibility.rs:17`~`:21`의 "알려진 차이 5"가 "남는 차이는 기획자 분기의 `created_by`와 두 분기가 보지 않는 `outcome` 값 목록이다"라고 적는다. 이 기획서는 앞의 하나를 없애고 뒤의 하나는 남긴다.
7. 계약의 임시 문장은 한 불릿이다. `project_instructions.rs`의 `WORKFLOW_RULES` 안 `### Ratifying a delegated decision` 절, "Two judgements ignore it and one does not" 다음 목록의 세 번째 불릿이다 — "The condition script's planner branch does not read `created_by`. It compares `created_at` across every decision document of the specification, so a delegated decision later than a pending `revision_requested` hides that revision request from the heartbeat while the app still counts it. Until that branch reads `created_by` too, the app and the heartbeat disagree about such a specification." 앞의 "Two judgements ignore it and one does not"와 앞 두 불릿(앱·아키텍트 판정)도 이 문장과 한 덩어리로 읽힌다.
8. 버전 축의 현재값과 설치본이 어긋나 있다. `heartbeat_condition.rs:20`의 `CONDITION_SCRIPT_VERSION`은 6인데 설치본 `.workflow/rules/wf-eligible.sh`는 `# condition_script_version: 4`다. `project_instructions.rs:21`의 `WORKFLOW_RULES_VERSION`은 8인데 설치본 `.workflow/rules/workflow.md`는 `rules_version: 7`이다. 둘 다 앱이 다음에 설치를 돌릴 때 따라 올라간다(REPORT-TASK-088-DEV.md 후속 2·4). 상수 본문의 `# condition_script_version:` 줄과 `rules_version:` 줄은 각 상수와 같은 값이어야 한다.
9. 스크립트 판정을 고정하는 표가 있다. `heartbeat_condition.rs:1477`의 `SCENARIOS`와 `:1692`의 `the_installed_script_matches_the_scenario_table`이 현재 플랫폼에 설치된 구현을 실제로 돌려 종료 코드와 사유를 대조하고, CI가 같은 표를 세 러너에서 돌린다. 아키텍트의 대리 결정 행("아키텍트: created_by가 user가 아닌 승인만 있다", `:1556`~)이 이미 있어 기획자 행의 본이 된다.
10. 저장소에는 대리 결정이 0건이다. 이 워크플로우의 `decisions/*.md` 75건 전부가 `created_by: user`이고(`grep -h '^created_by:' | sort | uniq -c` 결과가 `75 created_by: user` 한 줄), 그중 `schema: workflow-labs/decision@1`인 기획서 결정은 29건이다. `user-delegate`는 0건이다. 따라서 실저장소 판정은 이 변경으로 달라질 수 없고, 달라진다면 그것이 회귀다.
11. 두 파일에 `todo`·`in_progress` 작업이 없다. `heartbeat_condition.rs`를 언급하는 작업 22건 중 미완은 TASK-043·044·045·047·075·076·086이고 전부 `qa_waiting`이다. `project_instructions.rs`를 언급하는 작업 15건 중 미완은 TASK-086·088이고 둘 다 `qa_waiting`이다. 지금 착수하면 겹치지 않지만, QA가 그중 하나를 `todo`로 되돌리면 같은 파일에 두 세션이 붙는다.
12. `project_instructions.rs`는 단독 편집이 선례다. `tasks/TASK-041.md:31`~`:32`가 "규칙 자산의 버전 상수를 올리는 작업이 동시에 둘이면 한쪽이 상대의 인상을 밟는다. 이 파일을 만지는 다른 작업이 생기면 병행 금지다"라고 적는다. 같은 이유가 `heartbeat_condition.rs`의 `CONDITION_SCRIPT_VERSION`에도 그대로 성립한다.
13. 게이트에 남의 세션 위반이 있다. REPORT-TASK-088-DEV.md 게이트 절이 `heartbeat_status.rs`의 fmt 위반 1건과 `heartbeat_process.rs:216`의 clippy 위반 1건을 타 세션 소유로 적어 두었다. 이 기획서의 작업이 만드는 위반과 구분되어야 한다.

### 포함 범위

- 조건 스크립트 기획자 분기가 결정 문서를 고를 때 `created_by`가 정확히 `user`가 아니면 건너뛴다. sh·ps1 두 구현 모두.
- 같은 분기의 비교 루프(더 늦은 결정 찾기)도 같은 기준으로 거른다. sh·ps1 두 구현 모두.
- `CONDITION_SCRIPT_VERSION`과 두 본문의 `# condition_script_version:` 줄을 착수 시점 값에서 +1.
- 확인 사실 7의 임시 불릿을 지우고, 그 절이 남은 사실만 말하게 고친다. 앞 문장 "Two judgements ignore it and one does not"도 함께 정리한다.
- `WORKFLOW_RULES_VERSION`과 본문 `rules_version`을 착수 시점 값에서 +1.
- 확인 사실 6의 "알려진 차이 5" 주석을 남은 차이(`outcome` 값 목록)만 적도록 갱신한다.
- 새 판정을 시나리오 표에 행으로 고정한다. 최소한 확인 사실 4·5의 두 상황.

### 제외 범위

- 두 분기가 `outcome` 값 목록을 보지 않는 차이(확인 사실 6의 나머지 절반). 대리 결정과 무관한 별개의 차이이고, 아이디어가 요청한 것이 아니다. 후속 아이디어로 올릴 것을 권한다.
- 개발자 분기. 결정 문서를 읽지 않으므로 대상이 아니다(아이디어 본문).
- 아키텍트 분기의 판정 규칙 변경. 확인 사실 2대로 이미 닫혀 있고, TASK-086이 착지시킨 자리다.
- 앱 판정(`role_eligibility.rs`·`fs_project_repository.rs`)의 동작 변경. 확인 사실 3대로 앱은 이미 옳게 거르고 있다. 이 기획서는 스크립트를 앱에 맞춘다. 주석 갱신만 포함한다.
- 이미 기록된 결정 문서의 소급 정리. 확인 사실 10대로 대상이 0건이고, 소급은 SPEC-028의 제외 범위였다.
- 대리 결정의 형식 요건·재가 절차 자체(SPEC-028/TASK-088에서 착지). 이 기획서는 그 계약이 남긴 임시 문장 하나만 걷어낸다.
- 조건 스크립트의 사유 출력 규약(SPEC-023). 새 판정이 기존 사유 코드를 쓸 뿐 코드 목록을 늘리지 않는다.

## 요구사항 명세

### R1. 기획자 분기가 대리 결정을 세지 않는다

- 기획자 분기가 후보로 고르는 수정 요청 결정은 `created_by`가 정확히 `user`인 것뿐이다. 부분 일치가 아니라 값 전체 비교여야 한다 — 접두 일치로 두면 `user-delegate`가 통과한다(확인 사실 2의 주석이 같은 지적을 한다).
- 같은 분기의 비교 루프도 `created_by`가 `user`인 결정만 더 늦은 결정으로 센다.
- 두 자리 모두 아키텍트 분기와 같은 어법을 쓴다. 세 역할이 서로 다른 방식으로 같은 판정을 하지 않는다.
- 확인 필요 1번을 뒤집는 경우 첫 항목은 빠지고 비교 루프만 남는다.

### R2. sh와 ps1이 같은 답을 낸다

- 두 구현이 확인 사실 4·5의 두 상황에서 같은 종료 코드와 같은 사유를 낸다.
- 확인 사실 9의 시나리오 표에 두 상황이 행으로 들어가고, 세 플랫폼 러너에서 같은 표가 돈다.
- 한 구현만 고친 상태로 착지하지 않는다.

### R3. 앱과 하트비트가 기획자 판정에서 갈리지 않는다

- 확인 사실 4의 픽스처에서 스크립트가 `eligible`을 낸다. 앱의 `has_planner_work`와 같은 답이다.
- 확인 사실 5의 픽스처에서 스크립트가 `no-target`을 낸다. 앱과 같은 답이다. (확인 필요 1번을 뒤집으면 이 항목은 빠진다.)
- 확인 사실 6의 주석이 남은 차이만 적는다. 이미 닫힌 차이를 계속 적어 두면 다음 사람이 같은 자리를 두 번 조사한다.

### R4. 계약이 없어진 결함을 계속 말하지 않는다

- 확인 사실 7의 불릿이 사라진다. 그 문장이 말하는 상태는 R1 이후 참이 아니다.
- 문장을 걷어낸 뒤에도 그 절이 답하던 질문 — 재가 뒤 남는 대리 결정 파일을 무엇이 어떻게 취급하는가 — 에 계약이 여전히 답한다. 불릿 하나를 지우면서 앞 문장의 셈("Two judgements ignore it and one does not")이 어긋난 채로 남지 않는다.
- 남은 차이(제외 범위의 `outcome` 값 목록)를 계약이 새로 감추지 않는다. 계약이 그 차이를 원래 적지 않았으므로 새로 적을 필요도 없다. 적기로 한다면 사실만 적는다.

### R5. 버전 축이 지켜지고 지금 되는 것이 그대로 된다

- `CONDITION_SCRIPT_VERSION`과 두 본문의 버전 줄이 같은 값이고, 착수 시점 값보다 정확히 1 크다. 고정값을 가정하지 않는다(확인 사실 8).
- `WORKFLOW_RULES_VERSION`과 본문 `rules_version`이 같은 값이고, 착수 시점 값보다 정확히 1 크다.
- 실저장소에서 세 역할의 판정이 변경 전후로 같다(확인 사실 10).
- 기존 시나리오 표의 모든 행이 그대로 통과한다. 아키텍트·개발자 분기의 판정이 달라지지 않는다.
- 기존 자동 테스트가 삭제되거나 비활성화되지 않는다.

## 확인 필요

사용자 결정이 필요한 항목이다. 승인 시 아래 제안대로 진행한다.

1. **반대 방향(대리 `revision_requested` 단독)까지 이번에 닫을지.**

   제안: 닫는다. 후보 선택과 비교 루프 두 자리 모두에 `created_by` 필터를 넣는다. 근거는 셋이다. 첫째, 원인이 하나다 — 같은 분기가 `created_by`를 안 읽어서 생기는 일이고, 한 자리만 고치면 같은 결함이 방향만 바꿔 남는다. 둘째, 확인 사실 5로 실행값을 확인했다. 추정이 아니라 재현된 갈림이다. 셋째, 확인 사실 2대로 아키텍트 분기는 이미 두 자리 모두 거르고 있어서, 기획자 분기만 한 자리를 비워 두면 "세 역할이 같은 어법을 쓴다"는 이 저장소의 원칙이 다시 깨진다.

   비용: 아이디어가 적은 처방("비교 루프에 두 줄")보다 변경이 한 자리 늘고, 시나리오 표에 행이 하나 더 붙는다. 그 외에는 같은 파일·같은 두 구현이라 추가 비용이 사실상 없다.

   대안: 아이디어 문언대로 비교 루프만 고친다. 아이디어가 재현한 가림은 닫히고 변경이 최소가 된다. 뒤집기로 하면 대리 `revision_requested`가 하트비트만 깨우는 상태가 남는다 — 깨어난 기획자 세션은 계약상 유효한 대상을 못 찾아 매번 `NO_ELIGIBLE_WORK`로 돌아가고, 확인 사실 6의 "알려진 차이 5"에서 기획자 분기의 `created_by`도 절반만 지워진다.

## 기대효과

- 화면과 하트비트가 같은 것을 말한다. 지금은 대리 결정 하나가 옆에 있으면 사용자가 반려한 기획서를 앱은 재작업 대상으로 표시하는데 하트비트는 기획자를 깨우지 않는다. 사용자가 남긴 피드백이 아무도 집지 않는 채로 남는 경로다.
- 계약이 자기 결함을 명시한 임시 문장을 걷어낸다. 그 문장은 TASK-088이 "실측해 보니 참이라 참인 만큼만 적었다"며 넣은 것이고, 결함이 닫히면 계약에 남을 이유가 없다.
- 세 역할의 판정 어법이 한 벌로 정리된다. 확인 사실 2·6대로 `created_by` 필터는 아키텍트에만 들어가 있었다.
- 다음 사람이 같은 자리를 다시 조사하지 않는다. "알려진 차이"가 실제로 남은 차이만 적는 목록이 된다.

## 완료 조건

1. 기획자 분기가 `created_by`가 `user`가 아닌 결정을 후보로 고르지 않는다. 검증: 확인 사실 5의 픽스처에서 두 구현이 `no-target`/`exit 1`. (확인 필요 1번을 뒤집으면 이 조건은 빠진다.)
2. 기획자 분기의 비교 루프가 `created_by`가 `user`가 아닌 결정을 더 늦은 결정으로 세지 않는다. 검증: 확인 사실 4의 픽스처에서 두 구현이 `eligible`/`exit 0`.
3. 값 비교가 전체 일치다. 검증: `created_by: user-delegate`가 통과하지 않는 것을 시나리오 표의 행으로 고정한다.
4. 확인 사실 4·5의 두 상황이 시나리오 표에 행으로 있고, `the_installed_script_matches_the_scenario_table`이 통과한다. 검증: 테스트 실행값.
5. sh와 ps1이 같은 답을 낸다. 검증: 시나리오 표가 세 플랫폼 CI에서 통과하는 것. 로컬에서 한 플랫폼만 도는 경우 그 사실을 보고서에 적는다.
6. `CONDITION_SCRIPT_VERSION`과 sh·ps1 본문의 `# condition_script_version:` 줄이 같은 값이고 착수 시점 값 +1이다. 검증: 착수 시점 값을 보고서에 적고 세 자리를 대조한다.
7. `WORKFLOW_RULES_VERSION`과 `WORKFLOW_RULES` 본문 `rules_version`이 같은 값이고 착수 시점 값 +1이다. 검증: 두 값 대조.
8. 확인 사실 7의 불릿이 본문에서 사라졌고, 그 절이 문장 단위로 앞뒤가 맞는다. 검증: 변경 전후 본문을 대조해 보고서에 적는다. 앞 문장의 셈이 남은 항목 수와 맞는지 포함한다.
9. `role_eligibility.rs`의 "알려진 차이 5"가 남은 차이만 적는다. 검증: 주석 본문 확인.
10. 규칙 자산과 조건 스크립트의 설치·검증 경로가 새 버전 값으로 동작한다. 검증: `project_instructions`·`heartbeat_condition` 테스트가 통과한다.
11. 실저장소에서 세 역할의 판정이 변경 전후로 같다. 검증: 착수 전과 착지 후에 `planner`·`architect`·`developer` 세 역할로 스크립트를 돌려 종료 코드와 사유를 보고서에 적는다. 확인 사실 10대로 전부 같아야 한다.
12. 기존 시나리오 표의 모든 행이 그대로 통과하고, 행이 삭제되지 않았다. 검증: 표의 행 수 전후 비교.
13. 기존 자동 테스트가 삭제되거나 비활성화되지 않는다(`#[ignore]` 신규 0건). 검증: 테스트 목록 변경분.
14. `heartbeat_condition.rs`와 `project_instructions.rs`를 만지는 작업이 이번 분해에서 각각 하나뿐이다. 검증: 분해 결과의 작업 범위 목록. 확인 사실 11·12의 선례다.
15. `cargo test --manifest-path src-tauri/Cargo.toml`과 `npm run check`가 통과한다. 확인 사실 13의 타 세션 위반이 남아 있으면 그것과 이 작업이 만든 결과를 구분해 적는다.
