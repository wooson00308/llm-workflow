---
schema: workflow-labs/task@1
id: TASK-110
title: 멈춘 일을 세 판정이 함께 다시 보게 한다
status: completed
source_spec_id: SPEC-035
source_decision_id: DECISION-D6C694F2
depends_on: [TASK-101, TASK-104, TASK-105, TASK-106]
scope_files: [src-tauri/src/infrastructure/heartbeat_condition.rs, src-tauri/src/infrastructure/role_eligibility.rs, src-tauri/src/infrastructure/fs_project_repository.rs]
updated_at: 2026-08-05T06:13:57.765509+00:00
history:
  - { at: 2026-08-05T01:55:00Z, kind: created }
  - { at: 2026-08-05T04:25:18Z, kind: in_progress }
  - { at: 2026-08-05T04:46:26Z, kind: qa_waiting }
  - { at: 2026-08-05T06:13:57.765509+00:00, kind: completed }
---

# 멈춘 일을 세 판정이 함께 다시 보게 한다

SPEC-035의 판정 쪽 전부다. R1·R2·R7과 완료 조건 1~16을 닫는다. 계약 문서와 관리 자산 문구는
TASK-111이 받는다.

죽은 세션이 남긴 일이 잠기지도 열리지도 않는 자리를 판정에서 연다. 개발자 분기는 `in_progress`이면서
미만료 lease가 없는 작업을 후보로 세고, 기획자 분기는 참조 기획서가 모두 `draft`이고 원천을 덮는
미만료 lease가 없는 원천을 다시 후보로 센다.

## 이 작업이 크고 쪼개지지 않는 이유

세 구현이 한 커밋에서 함께 움직여야 한다.

1. 조건 스크립트 두 본문(`CONDITION_SCRIPT_SH`·`CONDITION_SCRIPT_PS1`)은 한 파일에 있고, 두 본문의
   버전 줄과 `CONDITION_SCRIPT_VERSION`을 일치 단언 테스트가 한 묶음으로 묶는다. 어느 하나만 고치면
   그 테스트가 먼저 깨진다. TASK-097·TASK-101·TASK-104가 같은 이유로 두 본문을 한 작업에 묶은 선례다.
2. `role_eligibility.rs`의 대조 검사(`assert_matches_condition_script`)는 픽스처 하나에서 **세 역할
   전부**의 앱 판정과 스크립트 종료 코드가 같은지를 단언한다. 스크립트만 고치면 아래 두 기존 검사가
   즉시 빨개진다. 즉 스크립트 변경과 앱 이식본 변경 사이에 초록인 지점이 없다.
   - `an_idea_claimed_by_a_draft_spec_is_not_planner_work` — R2가 이 픽스처의 답을 뒤집는다.
   - `an_expired_lease_does_not_change_how_a_declaration_is_judged`의 후반 — `in_progress`인
     TASK-001에 lease가 없으므로 R1이 이 픽스처의 답을 뒤집는다.
3. R1과 R2를 두 작업으로 가르는 것도 같은 이유로 되지 않는다. 두 요구가 같은 두 본문·같은 버전 상수·
   같은 대조 검사를 지난다.

## 승인된 확인 필요가 이 작업의 설계다

DECISION-D6C694F2는 코멘트 없이 승인됐다. 기획서 "확인 필요" 머리글이 "승인 시 아래 제안대로
진행한다"이므로 세 항목 모두 제안대로다. 뒤집지 않는다.

1. **아키텍트 중단의 회수는 범위 밖이다.** `architect)` 분기의 판정 규칙은 한 글자도 바뀌지 않는다.
2. **만료 뒤 여유를 두지 않는다.** 만료된 lease는 곧바로 인수 가능하다. 새로운 유예 상수도, 두 번째
   만료 개념도 만들지 않는다. 판별자는 지금 `lease_blocks()`/`Test-Leased`가 답하는 그 값 하나다.
3. **인수 세션이 작업 문서에 손대는 범위는 지금 그대로다.** 이 작업은 판정만 고치므로 여기서 할 일이
   없고, 계약 문구는 TASK-111이 적는다.

## 아키텍트가 고정하는 값

셋(sh·PowerShell·`role_eligibility.rs`)이 같은 답을 내야 하고, 그 위에 SPEC-033이 정한 훑기 예산이
얹혀 있다. 그래서 방법의 뼈대를 여기서 고정한다. 임의로 바꾸지 않는다. 바꿔야 할 이유가 나오면 고쳐서
진행하지 말고 보고서에 적고 아키텍트 후속으로 넘긴다.

### 1. 자격이 넓어지는 자리는 딱 둘이다

그 밖의 판정 규칙은 그대로다. 선행 선언 충족(`dep_satisfied`), 순환 검사(`reaches`), 겹침 선언
검사(`overlap_blocks`), lease 만료 판정, `architect)` 분기, 마이그레이션 락, 사유 코드와 종료 코드의
의미 — 어느 것도 이 작업으로 느슨해지지 않는다. `blocked`은 후보가 되지 않는다.

### 2. 기획자 분기는 "비-draft 참조" 하나로 접는다

지금 (가)는 "참조가 하나라도 있으면 건너뛴다"이고, R2는 "참조가 모두 `draft`면 다시 센다"이다. 둘을
따로 두면 후보마다 참조 기획서를 다시 훑게 되어 SPEC-033이 걷어낸 곱이 되살아난다. 그래서 **참조
목록을 두 벌 모으지 말고, 비-`draft` 기획서가 낸 참조 줄만 모은 목록 한 벌**로 접는다.

- `specs/`를 **한 번** 훑으면서, 그 문서가 `draft`가 **아닌** 경우에만 그 문서의 `source_idea_id:`·
  `source_decision_id:` 줄을 모은다.
- (가)의 조회는 그대로 부분 문자열 검사 한 번이다. `case "$nondraft_idea_refs" in
  *"source_idea_id:$id"*) continue ;; esac`. (나)도 같은 모양으로 `source_decision_id:$did`를 본다.
- 이 한 줄이 옛 조건과 새 조건을 함께 만족한다. 참조가 없으면 목록에 없으므로 후보고, 참조가 모두
  `draft`여도 목록에 없으므로 후보이며, 비-`draft` 참조가 하나라도 있으면 목록에 있으므로 후보가
  아니다. R2의 "**모두** `draft`이지 **하나라도** `draft`가 아니다"가 이 형태에서 그대로 나온다.
- 훑기 예산은 TASK-104가 정한 그대로 지킨다. 한 분기가 한 워크플로우에서 각 디렉터리를 한 번만 읽고,
  후보별 조회는 셸 내장(`case`·파라미터 확장)만 쓴다.
- 부분 일치 성질을 그대로 둔다. `DECISION-1`이 `DECISION-12`를 적은 줄에 걸리는 성질, 키 줄을 파일
  아무 곳에서나 보는 성질, `<키>: *` 정규화 — `scan_refs`가 이미 가진 성질을 새 목록도 똑같이 갖는다.

### 3. `draft` 판별은 스크립트의 어법을 앱이 따라간다

이 작업이 새로 만드는 유일한 갈림길이다. **여기서 갈리면 R7이 깨진다.**

- 스크립트에서 `draft`는 그 문서에 `^status: draft`인 줄이 있는 것이다. `status:` 줄이 없는 문서,
  `status: approved`처럼 계약 밖 값을 쓴 문서는 `draft`가 아니다 → 그 문서의 참조 줄은 모인다 →
  원천은 후보가 아니다. 판정 불가가 안전한 쪽으로 기우는 것이고, 이 저장소가 `scope_of`에서 이미
  택한 방향이다.
- **앱 이식본은 화면용 정규화 값(`normalize_spec_status`)이나 파생 상태(`inbox`/`drafting`/
  `adopted`)를 쓰지 않는다.** 정규화는 계약 밖 상태를 전부 `draft`로 접으므로, 그대로 쓰면 위
  문단과 정확히 반대로 답한다. 파생 상태는 R2가 요구하는 "모두"가 아니라 "하나라도"이므로 기획서
  확인 사실 14의 경우에서 갈린다(완료 조건 14가 그것을 고정한다). 프론트매터에 적힌 `status` 원문이
  문자열 `draft`와 같은지로 판별한다.
- 이 결정이 `role_eligibility.rs` 머리의 "알려진 차이"를 늘리지 않아야 한다. 늘어난다면 그것은 이
  작업이 R7을 못 지킨 것이므로, 목록에 한 줄 더하고 넘어가지 말고 보고서에 적고 멈춘다.

### 4. 앱 이식본은 판정 재료를 값으로 받는다

`role_eligibility.rs`는 파일 시스템을 만지지 않는다는 모듈의 규약을 지킨다. `WorkflowItemSummary`에
`source_idea_id`가 없으므로 기획자 쪽 재료는 `WorkflowInput`에 필드를 하나 더해서 받는다 —
`unsatisfied_dependencies`·`overlap_blocked`가 이미 그 선례다.

- 재료의 모양: **비-`draft` 기획서가 참조하는 원천 id의 집합**(아이디어 id와 결정 id가 한 집합에
  들어와도 된다. 두 판정이 각각 자기 id로만 조회하므로 섞이지 않는다). 계산은
  `fs_project_repository.rs`가 하고, 이름은 개발자가 정한다.
- `has_planner_work`의 (가)는 `idea.status == "inbox"` 지름길을 버리고 이 집합으로 판정한다. (나)는
  `spec.source_decision_id`를 훑는 지금 자리를 같은 집합 조회로 바꾼다.
- `has_developer_work`는 후보 상태 집합만 넓힌다: `task.status == "todo" || task.status ==
  "in_progress"`. `lease_ids`·`unsatisfied_dependencies`·`overlap_blocked` 세 조건은 그대로 곱해진다.
  세 값은 이미 상태와 무관하게 그래프 전체로 계산되므로 새로 만들 것이 없다.
- `PendingRoleWork`와 목록 payload의 모양은 바뀌지 않는다. `domain/project.rs`와 프론트엔드는 이
  작업의 범위 밖이다. 바꿔야 할 이유가 나오면 고쳐서 진행하지 말고 보고서에 적고 멈춘다.

### 5. 개발자 분기의 후보 검사가 프로세스를 늘리지 않게 한다

TASK-106이 세우는 장치는 조건 스크립트가 띄우는 외부 프로세스 수를 세고 절대 상한(`CAP`)을 단언한다.
`grep`을 한 번 더 부르면 작업 수만큼 프로세스가 늘어 그 상한에 그대로 부딪힌다.

- sh 본문은 후보 검사를 **호출 한 번**으로 한다. 예: `grep -qsE "^status: (todo|in_progress)"`.
  두 번 부르지 않는다.
- **`CAP`을 올려서 통과시키지 않는다.** 상한에 부딪히면 그것은 이 작업이 예산을 넘긴 것이다. 올려야
  할 이유가 있다고 판단되면 올리지 말고 보고서에 적고 아키텍트 후속으로 넘긴다.
- PowerShell 본문은 이미 줄을 캐시해 읽으므로 조건 하나를 더해도 프로세스가 늘지 않는다. 같은 답을
  내는 것만 확인한다.

### 6. 기존 검사는 지우지 않는다

R2·R1이 답을 뒤집는 기존 검사 둘(위 "쪼개지지 않는 이유" 2번)은 **삭제하지 말고 기대값을 뒤집고
이름과 주석을 새 규칙에 맞게 고친다.** 그 픽스처는 회수 규칙이 실제로 사는 자리이므로 계속 대조에
남아야 한다. 비활성화(`#[ignore]`)도 하지 않는다.

## 완료 조건

기획서 완료 조건 1~16을 이 작업이 닫는다. 모두 `role_eligibility.rs`의 대조 검사 픽스처로 세운다 —
그 헬퍼가 앱 판정과 스크립트 종료 코드를 한 번에 대조하므로 시나리오 하나가 두 판정을 함께 고정한다.

1. `in_progress`이고 그 작업을 덮는 lease가 없으면 개발자 대상이다. (기획서 1)
2. `in_progress`이고 만료된 lease가 덮어도 같은 답이다. (기획서 2)
3. `in_progress`이고 미만료 lease가 덮으면 대상이 아니다. (기획서 3)
4. `in_progress`인데 선행 선언이 미충족이면 대상이 아니다. (기획서 4)
5. `blocked`은 lease 없음·만료 lease 두 경우 모두 대상이 아니다. (기획서 5)
6. `todo` 작업에 대한 기존 판정이 변경 전후로 같다. 기존 개발자 검사가 기대값 수정 없이 통과한다
   (위 "기존 검사" 항목이 지목한 하나는 예외이며, 그것은 `in_progress` 픽스처다). (기획서 6)
7. 참조 기획서가 모두 `draft`이고 아이디어를 덮는 미만료 lease가 없으면 기획자 대상이다. (기획서 7)
8. 그 아이디어를 미만료 lease가 덮으면 대상이 아니다. (기획서 8)
9. 참조 기획서 중 하나가 `user_review`이고 다른 하나가 `draft`이면 대상이 아니다. (기획서 9)
10. `draft` 재작업 기획서만 남은 수정 요청 결정이 다시 대상이 된다. (기획서 10)
11. 그 재작업 기획서가 `user_review`면 대상이 아니다. (기획서 11)
12. 판정이 lease 파일과 워크플로우 문서를 지우거나 고치지 않는다. 판정 전후로 `leases/`와 워크플로우
    디렉터리의 파일 개수와 내용이 같다. (기획서 12)
13. 1~11의 모든 픽스처에서 앱 판정과 조건 스크립트가 같은 답을 낸다. 즉 위 시나리오를
    `assert_matches_condition_script`로 세운다. (기획서 13)
14. 9번 픽스처에서 아이디어 파생 상태가 `drafting`인데도 두 판정이 모두 "대상 없음"을 낸다.
    앱 이식본이 파생 상태를 지름길로 쓰지 않았다는 증거다. (기획서 14)
15. PowerShell 본문이 sh 본문과 같은 답을 낸다. 두 본문의 판정 일치를 고정한 기존 장치에 새 행을
    더해 통과시킨다. (기획서 15)
16. `CONDITION_SCRIPT_VERSION`과 두 본문의 버전 줄이 함께 올라간다. 관리 마커가 없는 파일은
    덮어쓰지 않고, 설치본이 앱보다 새 버전이면 멈춘다 — 세 경우의 기존 검사가 그대로 통과한다.
    (기획서 16)
17. 기존 자동화 검사가 삭제되거나 비활성화되지 않는다. 기대값을 뒤집은 검사는 이름과 주석이 새
    규칙을 말한다. (기획서 21)
18. `npm run check`와 `cargo test --manifest-path src-tauri/Cargo.toml`이 통과한다. (기획서 22)

## 검증 절차

1. `cargo test --manifest-path src-tauri/Cargo.toml` — 대조 검사 전부와 버전 일치 단언.
2. `npm run check`.
3. 1배·3배 픽스처에서 TASK-106의 프로세스 수 검사가 통과하는지 확인하고, 세 역할의 프로세스 수를
   변경 전후로 보고서에 적는다. `CAP`을 건드리지 않았음을 함께 밝힌다.
4. 이 저장소 자신에서 세 역할의 종료 코드와 사유 코드를 손으로 확인한다
   (`sh .workflow/rules/wf-eligible.sh developer` 등). 실제 저장소에 `in_progress` + 만료 lease인
   TASK-104가 있으므로 R1이 실물에서 어떻게 답하는지 그대로 드러난다.
5. Windows 러너의 PowerShell 대조가 통과하는지 CI 결과로 확인한다.

## 범위 파일

`scope_files`가 판정의 근거이고, 이 절은 그 판단을 사람이 읽는 자리다.

- `src-tauri/src/infrastructure/heartbeat_condition.rs` — sh·PowerShell 두 본문, 버전 상수, 두
  본문을 대조하는 검사.
- `src-tauri/src/infrastructure/role_eligibility.rs` — 앱 이식본 세 함수, `WorkflowInput`의 새 필드,
  대조 검사 시나리오.
- `src-tauri/src/infrastructure/fs_project_repository.rs` — 새 필드를 채우는 계산.

`docs/`와 `.workflow/rules/`의 문구, `project_instructions.rs`의 계약 본문은 이 작업이 만지지 않는다.
TASK-111이 받는다.

## 선행

- `TASK-101`(SPEC-032) — 겹침 선언을 세 판정에 넣은 작업. 같은 세 파일을 만진다.
- `TASK-104`(SPEC-033) — 조건 스크립트의 훑기 구조를 다시 쓴 작업. 이 작업은 그 구조 위에 얹는다.
- `TASK-105`(SPEC-033) — `fs_project_repository.rs`의 조회 경로를 다시 쓴 작업.
- `TASK-106`(SPEC-033) — 프로세스 수 상한을 세우는 작업. 상한이 먼저 서야 이 작업이 그것을 넘겼는지
  알 수 있다.
