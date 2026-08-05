# SPEC-035 아키텍트 핸드오프

- 대상: DECISION-D6C694F2 (SPEC-035 승인, `created_by: user`, 2026-08-04T23:30:49.522121+00:00)
- 산출 작업: TASK-110, TASK-111 (둘 다 `todo`)
- 세션: 2026-08-05T01:47Z~02:00Z / `wf-claim.sh acquire SPEC-035 architect-sasha-20260805 25` exit 0
  (`lease-8866-20260805014758`) → `renew` exit 0 → `release`
- 자격 판정: `sh .workflow/rules/wf-eligible.sh architect` → `eligible` / 종료 코드 0.
- 자격 재검증: 클레임 직후 설치본 스크립트의 `architect)` 분기를 그대로 손으로 돌려 후보를 열거했다.
  `created_by: user` + 최신 결정 조건을 통과한 승인 33건 중 `tasks/`의 `source_decision_id`가 참조하지
  않는 것은 DECISION-D6C694F2 하나뿐이었다. SPEC-035의 결정도 이 하나뿐이므로 최신 앱 소유 결정이
  `approved`다.
- 분해 후 재확인: `sh .workflow/rules/wf-eligible.sh architect` → `no-target` / 종료 코드 1.
- 결정 본문은 비어 있다. 기획서 "확인 필요" 머리글이 "승인 시 아래 제안대로 진행한다"이므로 **세 항목
  모두 제안대로**로 읽었다. 두 작업이 그 세 항목을 설계 전제로 명시한다.

## 산출물

| 작업 | 범위 파일 | 닫는 요구사항 | 선행 |
| --- | --- | --- | --- |
| TASK-110 | `heartbeat_condition.rs`, `role_eligibility.rs`, `fs_project_repository.rs` | R1·R2·R7 / 완료 조건 1~16 | TASK-101, TASK-104, TASK-105, TASK-106 |
| TASK-111 | `project_instructions.rs`, `docs/file-contract.md` | R3·R4·R5·R6·R8 / 완료 조건 17~20 | TASK-102, TASK-110 |

완료 조건 21(검사를 지우지 않는다)과 22(`npm run check`·`cargo test`)는 두 작업 모두에 걸려 있다.

## 둘로 가른 근거

**판정과 계약은 파일이 겹치지 않고 검증 수단도 다르다.** 판정 쪽은 대조 검사가, 계약 쪽은 설치·갱신
계획 검사와 문서 대조가 확인한다. 한 작업으로 묶으면 리뷰 단위가 세 판정 구현 + 네 문서가 되어
읽히지 않는다.

**판정 쪽은 더 못 가른다.** 조건 스크립트 두 본문이 한 파일에 있고 `CONDITION_SCRIPT_VERSION`과 두
본문의 버전 줄을 일치 단언 테스트가 묶는다. 그 위에 `role_eligibility.rs`의
`assert_matches_condition_script`가 픽스처 하나에서 세 역할 전부의 앱 판정과 스크립트 종료 코드를
대조한다. 그래서 스크립트만 고친 중간 지점에서는 기존 검사 둘이 이미 빨갛다.

- `an_idea_claimed_by_a_draft_spec_is_not_planner_work` — R2가 답을 뒤집는다.
- `an_expired_lease_does_not_change_how_a_declaration_is_judged`의 후반 — `in_progress`인 TASK-001에
  lease가 없으므로 R1이 답을 뒤집는다.

R1과 R2를 가르는 것도 같은 이유로 되지 않는다. 두 요구가 같은 두 본문·같은 버전 상수·같은 대조
검사를 지난다. TASK-097·TASK-101·TASK-104가 같은 이유로 두 본문을 한 작업에 묶은 선례다.

## 순서를 정한 근거

### 다른 승인에서 나온 작업과의 겹침

`depends_on`은 한 승인의 작업만 닿는다는 것이 계약의 기본값이지만, 이 저장소는 이미 승인을 넘는
선행을 쓴다(TASK-091→TASK-079, TASK-099→TASK-095·096, TASK-101→TASK-097·098). SPEC-035는 SPEC-032·
SPEC-033이 방금 고친 바로 그 세 파일에 얹히므로 같은 방식으로 순서를 적었다.

| 선행 | 겹치는 파일 | 지금 상태 |
| --- | --- | --- |
| TASK-101 | `heartbeat_condition.rs`, `role_eligibility.rs`, `fs_project_repository.rs` | `qa_waiting` |
| TASK-102 | `project_instructions.rs` | `qa_waiting` |
| TASK-104 | `heartbeat_condition.rs` | `in_progress` |
| TASK-105 | `fs_project_repository.rs` | `qa_waiting` |
| TASK-106 | `heartbeat_condition.rs` | `todo` |

`qa_waiting`인 셋은 선행 충족이므로 지금 아무것도 막지 않는다. 그래도 적은 이유는 QA 반려로 `todo`로
돌아오면 다시 같은 파일을 만지는 작업이 되기 때문이다 — 그때 순서가 사라지지 않는다.

TASK-106을 선행에 넣은 것은 그것이 프로세스 수 상한(`CAP`)을 세우는 작업이기 때문이다. 상한이 먼저
서야 TASK-110이 그 상한을 넘겼는지 알 수 있고, TASK-110은 그 상한을 올려서 통과시키지 않는다.

### TASK-111이 TASK-110 뒤인 이유

파일은 겹치지 않는다. 계약 본문은 앱이 실제 프로젝트의 `.workflow/rules/` 아래로 설치하는 관리
자산이고 세션이 그것을 자기 자격의 정의로 읽는다. 판정이 아직 `in_progress`를 세지 않는 동안 계약만
"인수가 자격이다"라고 적혀 있으면 계약과 판정이 서로 다른 자격을 말한다. SPEC-030에서
TASK-097(스크립트) → TASK-098(계약)이 같은 순서였다.

## 아키텍트가 고정한 값 중 기획서에 없던 것

기획서는 "무엇을"까지 적었고 아래 넷은 "어떻게"다. 셋이 같은 답을 내야 하는 자리라 세션마다 다르게
풀면 R7이 깨지므로 작업 문서에 못박았다.

1. **기획자 분기를 "비-`draft` 참조" 목록 한 벌로 접는다.** 참조 목록을 두 벌 모으거나 후보마다
   참조 기획서를 다시 훑으면 SPEC-033이 걷어낸 곱이 되살아난다. `specs/`를 한 번 훑으며 `draft`가
   아닌 문서의 참조 줄만 모으면, 기존 (가)의 부분 문자열 검사 한 줄이 옛 조건과 새 조건을 함께
   만족한다. 부분 일치·파일 아무 곳이나 보는 성질도 그대로 남는다.
2. **`draft` 판별은 스크립트 어법을 앱이 따라간다.** 스크립트에서 `draft`는 `^status: draft` 줄이
   있는 것이고, `status:` 줄이 없거나 계약 밖 값을 쓴 문서는 `draft`가 아니다. 앱이 화면용 정규화
   (`normalize_spec_status`)를 쓰면 계약 밖 상태를 전부 `draft`로 접어 정확히 반대로 답한다.
   R2가 새로 만드는 유일한 갈림길이고, 여기서 갈리면 알려진 차이가 여섯 개가 된다.
3. **앱 이식본은 `WorkflowInput`에 필드를 하나 더 받는다.** `WorkflowItemSummary`에 `source_idea_id`가
   없어 기획자 쪽 재료를 모듈 안에서 만들 수 없다. `unsatisfied_dependencies`·`overlap_blocked`가
   같은 모양의 선례다. `domain/project.rs`와 프론트엔드는 범위 밖으로 두었다.
4. **개발자 분기의 후보 검사는 프로세스를 늘리지 않는다.** `grep`을 한 번 더 부르면 작업 수만큼
   프로세스가 늘어 TASK-106의 상한에 그대로 부딪힌다. 호출 한 번으로 두 상태를 함께 본다.

## 넘기는 관찰 — 역할 밖

아키텍트가 고치지 않는다. 사람의 판단이 필요한 자리다.

### 1. TASK-104가 SPEC-035가 말하는 바로 그 상태로 멈춰 있다

`.workflow/.runtime/leases/TASK-104.yml`의 `expires_at`이 `2026-08-04T19:37:05Z`인데 작업은
`in_progress`다. lease는 풀렸고 상태는 멈춰 있다 — 기획서 확인 사실 3·4가 적은 모양 그대로이고,
그 사이에도 하트비트 세션들이 정상적으로 오갔다.

**이것이 이번 분해의 실질적 위험이다.** TASK-110이 TASK-104를 선행으로 두는데, 현행 판정은 `todo`만
세므로 TASK-104는 자동 루프에서 다시 잡히지 않는다. 즉 **SPEC-035를 고칠 작업이 SPEC-035가 고치려는
문제 때문에 착수되지 않는다.** 선행을 빼서 푸는 문제가 아니다 — 두 작업이 같은 파일을 만지므로
순서는 필요하다. 사람이 TASK-104를 인수해 완주시키거나 상태를 정리해야 이 줄기가 움직인다.

덧붙여, TASK-104의 코드 변경은 이미 착지한 것으로 보인다. 커밋 612b4f4가 "condition script perf"를
담고 있고, 작업 트리의 `heartbeat_condition.rs`는 `CONDITION_SCRIPT_VERSION: 9`에 훑기 재작성이 든
상태이며 `src-tauri`에 미커밋 변경이 없다. 죽은 세션이 남긴 것은 코드가 아니라 **상태 전이와
보고서**로 보이고, `reports/`에 `REPORT-TASK-104-DEV.md`가 없다. 인수 세션이 R3의 방식으로 갈라
읽어야 할 잔여물이 바로 이것이다.

### 2. IDEA-886DAB21이 기획자 쪽 회수 실물이다

`.workflow/.runtime/leases/IDEA-886DAB21.yml`이 `2026-08-05T00:25:31Z`에 만료됐고, 그 아이디어를
참조하는 SPEC-036이 `status: draft`로 남아 있다. R2가 정확히 이 조합을 다시 대상으로 세려는 것이다.
지금 판정에서는 SPEC-036이 참조를 물고 있어 아이디어가 영원히 처리 완료로 읽힌다. 기획서 확인 사실
10·11이 넘겨 둔 자리의 두 번째 실물이고, TASK-110의 완료 조건 7이 픽스처로 고정하는 모양과 같다.

### 3. `WorkflowItemSummary::source_decision_id`의 문서 주석이 코드와 어긋난다

`domain/project.rs`의 주석은 "아이디어·기획서에서는 항상 `None`"이라고 적는데, 요약을 만드는 자리는
문서 종류를 가리지 않고 프론트매터에서 읽는다. 실제로 `has_planner_work`가 기획서의 이 값을 읽어
후속 기획서 존재를 판정한다. 판정은 옳게 동작하고 주석만 낡았다. TASK-110·TASK-111 어느 쪽의 범위
파일도 아니므로 손대지 않았다.

### 4. 만료 lease 파일 둘이 남아 있다

`SPEC-009.yml`(2026-08-03T01:20:00Z 만료)과 위의 둘이다. 기획서 확인 사실 21이 이미 관찰했고
SPEC-018 R4가 "판정은 lease 파일을 지우지 않는다"로 정한 결과다. 청소는 기획서 제외 범위이므로
아무것도 하지 않았다.
