# TASK-111 개발 보고서

- 대상: TASK-111 (계약이 인수를 말하게 하고 규칙 자산 버전을 올린다)
- 기획서 / 결정: SPEC-035 / DECISION-D6C694F2 (`outcome: approved`, `created_by: user`, 이후 결정 없음)
- 세션: 2026-08-05T04:51Z~05:05Z, 개발자 역할 (`developer-claude`)
- 선점: `sh .workflow/rules/wf-claim.sh acquire TASK-111 developer-claude 30` → exit 0,
  `lease_id: lease-34675-20260805045210`. 작업 중 `renew` 4회(전부 exit 0), 종료 시 `release`.

## 착수 전 확인

### 자격

`sh .workflow/rules/wf-eligible.sh developer` → `eligible` / exit 0.

`todo` 작업 여섯 중 선행이 충족된 것은 TASK-111 하나뿐이었다.

| 작업 | `depends_on` | 선행 상태 | 판정 |
| --- | --- | --- | --- |
| TASK-111 | TASK-102, TASK-110 | `completed`, `qa_waiting` | 충족 |
| TASK-113 | TASK-112 | `blocked` | 미충족 |
| TASK-114·115·116·117 | TASK-113 계열 | `todo` | 미충족 |

미충족 다섯은 `blocked`으로 옮기지 않았다(개발자 계약 "Satisfied dependencies" 마지막 문단).

겹침: 착수 시각 04:52:10Z 기준 lease 디렉터리의 두 파일(`IDEA-886DAB21.yml` `expires_at`
2026-08-05T00:25:31Z, `SPEC-009.yml` 2026-08-03T01:20:00Z)이 **둘 다 만료**였다. 미만료 lease가 없으므로
겹침 판정에 걸릴 상대가 없다. 두 파일은 읽기만 했고 손대지 않았다(공통 규칙 §4).

### 인수 여부

이 세션은 인수가 아니다. TASK-111은 `todo`였고 이 작업을 덮는 lease도 없었으므로 평가할 남의 잔여물이
없다. 작업 트리에 커밋되지 않은 변경(TASK-110의 `heartbeat_condition.rs`·`role_eligibility.rs`·
`fs_project_repository.rs`, TASK-104~109의 문서)이 있었지만 그것은 `qa_waiting`으로 정상 착지한 앞선
세션들의 결과물이고, 이 작업의 `scope_files` 두 파일과 겹치지 않는다. 손대지 않았다.

## 구현

### 1. 공통 규칙 (`WORKFLOW_RULES`, `rules_version` 10 → 11)

- §4 끝에 `### Taking over what a stopped session left`를 새로 넣었다. 만료 lease 인수는 남의 미완성
  진행분 위에서 시작하는 일이라는 전제, 잔여물을 살릴 것·걷어낼 것·새로 쓸 것으로 가르라는 의무,
  잔여물에 문서의 진행분과 작업 트리의 코드 변경이 모두 포함된다는 범위, 그 판단을 보고서 하나만 읽고
  드러나게 적으라는 요구, 걷어낸 것이 검사면 그 사실과 근거를 밝혀 "통과시키려고 지우는 것"과 구분되게
  하라는 요구, 그리고 이 의무가 모든 역할에 같으며 여기 한 번만 적는다는 문장을 담았다. (R3 / 완료 조건 1)
- §5 전이 기록 절 첫 문단에 "상태가 바뀌지 않는 인수도 `in_progress` 항목을 덧붙인다"를 넣고, 추가 전용
  불릿에 "인수 전용 일곱 번째 `kind`는 없다"와 "죽은 세션이 남긴 항목을 고치지 않는다"를 붙였다. `kind`
  여섯 값 목록은 그대로다. (R4 / 완료 조건 3)

### 2. `developer.md` (`rules_version` 5 → 6)

- Eligibility: 대상이 `todo` 또는 `in_progress`이고, `in_progress`는 그 작업을 덮는 미만료 lease가 없을
  때만 자격이며, lease 파일이 없는 경우와 만료된 경우가 같고, 나머지 조건은 `todo`와 완전히 같다는 문장을
  넣었다. `blocked`은 lease와 무관하게 대상이 아니며 그 근거가 "세션이 의도적으로 선언한 상태"라는 것을
  같은 자리에 한 문장으로 적었다. (R1 / 완료 조건 4·8)
- `## Choose in this order`: 재개 가능한 `in_progress`를 `todo`보다 먼저 고른다. 근거로 이미 들어간 비용과
  `depends_on`이 함께 막힌다는 사실(선행 충족은 `qa_waiting`·`completed`만 센다)을 적었다. 선점 실패 시
  다음 순번, 전부 선점되면 `NO_ELIGIBLE_WORK`, 두 판정은 순서를 말하지 않는다는 문장도 함께다. (R6)
- `## Taking over a stopped task`: 상태를 다시 옮기지 않고 `history` 항목만 덧붙이며, 잔여물 평가는 §4를
  가리키고, 작업 문서 본문은 아키텍트 소유라 인수 세션이 고치지 않으며, 죽은 세션이 그 본문을 망가뜨린
  경우는 역할 밖 발견으로 보고하고 멈춘다. (승인된 확인 필요 3번 그대로)
- Completion 두 줄에 인수 경로를 반영했다("A takeover finds the status already there…", "`in_progress`
  when starting or resuming").

### 3. `planner.md` (`rules_version` 5 → 6)

- Eligibility: 원천을 참조하는 기획서가 **모두** `draft`이고 미만료 lease가 없으면 대상이라는 조건으로
  두 종류를 다시 썼다. 참조가 아예 없는 경우가 그 조건의 평범한 사례임을 명시했고, "하나라도"가 아니라
  "모두"임을 별도 문단으로 못박으면서 승인 기획서 + 죽은 재작업 draft 조합은 아이디어가 아니라 그
  재작업의 원천인 수정 요청 결정이 대상이라고 적었다. 선점 대상이 아이디어 id·결정 id 그대로이고 기획서
  문서는 선점 대상이 되지 않는다는 문장도 넣었다. (R2 / 완료 조건 4)
- `## Choose in this order` 맨 앞에 "인수를 아직 손대지 않은 원천보다 먼저"를 넣고, 기존 순서(수정 요청 →
  아이디어)는 그대로 두되 두 축이 충돌하면 인수가 먼저라고 적었다. (R6)
- `## Taking over an abandoned draft`: 같은 문서에서 이어 쓰고 새 ID를 만들지 않는다. 근거(새 ID는 사용자가
  읽고 되돌려 보낸 개정 하나만 뜻하고, 새 ID를 주면 아무도 읽지 않은 문서가 원천을 계속 참조해 회수 판정이
  다시 걸린다)와 함께, ID·원천 참조 보존, `created_at` 유지·`updated_at`만 갱신, 본문은 이어 쓰거나 전부
  다시 써도 되지만 삭제·병합은 하지 않음, 정상 종료는 `user_review` + lease 해제로 같음을 적었다.
  (R5 / 완료 조건 7)
- Claim first에 "회수는 파일이 이미 있으니 생성 대신 `updated_at`을 갱신한다" 한 줄과, Completion의 새 ID
  규칙에 "회수만이 기존 ID를 유지하는 경우" 단서를 달아 R5와 모순되지 않게 했다.

### 4. `architect.md`

본문·`rules_version` 모두 **무변경**(5 그대로). 승인된 확인 필요 1번대로 아키텍트 인수를 암시하는 문장을
넣지 않았다.

### 5. 버전 상수

`WORKFLOW_RULES_VERSION` 10 → 11, `ROLE_RULES_VERSION` 5 → 6("세 계약의 최댓값" 규약 그대로).

### 6. `docs/file-contract.md`

작업 문서 6번 목록의 네 자리를 모두 고쳤다. (완료 조건 9)

1. 아이디어 파생 상태 절 — "참조 기획서가 하나라도 있으면 스크립트는 건너뛴다"를 지우고 "모두 `draft`이고
   미만료 lease가 없으면 대상"으로 다시 썼다. 화면의 네 파생 상태 판정은 바뀌지 않으며 회수 대상 아이디어도
   화면에는 `반영중`으로 남는다는 사실을 함께 적었다(R2 마지막 항목).
2. 역할 계약 요약 — 기획자의 대상 정의를 "모두 `draft`"로, 개발자의 대상을 "`todo` 또는 미만료 lease가 덮지
   않는 `in_progress`"로 고쳤다. `blocked` 제외 근거와 두 역할의 인수 우선 순서도 같은 자리에 넣었다.
3. 전이 기록 절 — "상태를 바꾼 세션이 …" 문장에 인수 항목을 더했다.
4. lease 절 — 만료 lease가 그 자리에 남는다는 현행 문장은 그대로 두고, 그 뒤에 인수 세션의 잔여물 평가·보고
   의무와 §4가 단일 정의라는 문장을 이었다.

추가로 사용자 결정 절의 `revision_requested` 설명("후속 기획서가 아직 없으면")에 "있어도 모두 `draft`면"을
더했다. 목록에 없던 자리지만 그대로 두면 같은 파일 안에서 기획자 자격 조건이 두 규칙으로 읽혀 완료 조건 20에
걸린다. 고친 것은 그 한 구절뿐이다.

### 7. 검사

- 기존 검사는 하나도 지우거나 비활성화하지 않았다. 고친 것은 버전 문자열 단언(`rules_version: 10` → 11 일곱
  자리, `developer`·`planner`의 `rules_version: 5` → 6, `assert_eq!` 두 줄)과, R2가 문장을 다시 쓴
  `records_the_planner_selection_order_and_lease_expiry_in_the_installed_rules`의 단언 한 줄이다. 그 단언의
  뜻(판정 키가 `source_decision_id`라는 것)은 새 문장으로 그대로 옮겼다. (완료 조건 10)
- 새 검사 둘.
  - `records_the_takeover_contract_in_the_installed_rules` — §4 인수 절, §5 인수 이력 문장과 여섯 `kind`,
    개발자 R1·R6·인수 절, 기획자 R2·R5·R6, 그리고 아키텍트가 5 그대로이고 인수 문장을 갖지 않는다는 것을
    설치본에서 단언한다.
  - `a_role_contract_below_the_version_constant_is_not_rewritten_every_time` — 세 계약을 설치한 뒤 갱신
    계획을 다시 세워 셋 다 `None`(쓰기 없음)인지 확인한다. 설치된 `architect.md`의 `rules_version`을 읽어
    `ROLE_RULES_VERSION`보다 낮음을 먼저 단언하므로, 전제가 깨지면 검사가 조용히 통과하지 않는다.
    (완료 조건 6)

## 검증

| 검사 | 결과 |
| --- | --- |
| `cargo test --manifest-path src-tauri/Cargo.toml` | 453 passed / 0 failed (이 세션이 더한 검사 2건 포함) |
| `npm run check` | tsc + vitest 546 passed (20 파일) + `vite build` 성공 |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | 차이 없음 |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | 경고 0 |

착수 전 베이스라인은 따로 재지 않았다. 작업 트리에 앞선 세션들의 미커밋 변경이 있어 그 수치가 이 작업의
전후 비교가 되지 못한다. 대신 이 세션이 더한 `#[test]`가 정확히 둘이고 지운 것이 없다는 사실로 대조한다.
프런트엔드 파일은 한 줄도 고치지 않았다.

### 계약과 판정의 문장 단위 대조 (완료 조건 8, 검증 절차 3)

TASK-110이 남긴 세 구현 — `heartbeat_condition.rs`의 sh 본문(`developer)` `:395~`, `planner)` `:341~`)과
같은 파일의 PowerShell 본문(`:368` 상태 검사, `:234` `Get-NonDraftReferences`), 그리고
`role_eligibility.rs`(`:96~103` 기획자, `:148` 개발자) — 를 새 계약 문장과 나란히 두고 읽었다.

| 계약 문장 | 판정 |
| --- | --- |
| `developer.md` "The task must be `todo` or `in_progress`" | sh `grep -qsE "^status: (todo\|in_progress)"`, ps1 `'^status: (todo\|in_progress)'`, 앱 `task.status == "todo" \|\| task.status == "in_progress"` |
| "…only while no unexpired lease covers it. A missing lease file and an expired one mean the same thing here" | 세 구현 모두 후보 id로 lease를 조회하고, 파일이 없거나 `expires_at`이 표기를 벗어나거나 지났으면 막지 않는다. `todo`와 같은 한 줄이 두 상태를 함께 본다 |
| "Every other condition … none of them is loosened" | 선행 충족·순환·겹침 검사가 상태와 무관하게 같은 자리에서 돈다 |
| "A `blocked` task never qualifies, whatever its lease says" | 상태 목록에 `blocked`이 없다 |
| `planner.md` "every specification that references it in `source_idea_id` is still `draft`" | 비-`draft` 기획서의 참조 줄만 모아 그 목록에 없는 원천을 후보로 센다. 참조가 없는 원천도 목록에 없으므로 같은 조회가 두 경우를 함께 답한다 |
| "…every specification that carries that decision's id in `source_decision_id` is still `draft`" | 같은 목록을 결정 id로 조회한다. 최신 결정·`created_by: user`·스키마·`spec_id` 조건은 그대로다 |
| "Read the condition as *every* referencing specification, never *any* one of them" | 앱 이식본이 파생 상태 `drafting`을 쓰지 않는 이유로 같은 문장을 주석에 적고 있다 |
| "A specification document never becomes a claim target of its own" | 선점 조회는 아이디어 id와 결정 id로만 한다 |
| 두 계약의 "the condition script … answer only whether work exists, never which work comes first" | 세 구현 모두 있다/없다만 낸다 |

`draft` 판별이 "`status:`로 시작하는 첫 줄의 값이 정확히 `draft`"라 상태 줄이 없거나 계약 밖 값을 쓴 기획서는
`draft`가 아니고 그 원천은 대상이 되지 않는다 — 계약 문장("is still `draft`")도 같은 방향으로 읽힌다. 판정
불가가 안전한 쪽으로 기우는 성질이 계약과 구현에서 같다.

`developer.md`의 겹침 절에 있는 "`blocked`은 시작된 뒤 진짜 장애를 만난 작업의 상태" 문장은 그대로 두었고,
Eligibility의 새 `blocked` 문장이 같은 근거를 인수 맥락으로 한 번 더 말한다. 두 문장이 함께 읽혀도 어긋나지
않는다. (완료 조건 8)

### 설치본 갱신 경로 (검증 절차 4, 완료 조건 2·5)

설치본은 손으로 고치지 않았다. 앱 상수와 설치본을 대조한 결과가 이렇다.

| 파일 | 설치본 | 상수 | 앱이 다시 쓰는가 |
| --- | --- | --- | --- |
| `.workflow/rules/workflow.md` | 10 | 11 | 예 |
| `.workflow/rules/roles/planner.md` | 5 | 6 | 예 |
| `.workflow/rules/roles/developer.md` | 5 | 6 | 예 |
| `.workflow/rules/roles/architect.md` | 5 | 5 | 아니오 (본문이 바이트까지 같다) |

넷 다 스키마 줄이 있고 설치본 버전이 상수 이하라 `plan_rules_file`이 거부하지 않는다. 아키텍트만 본문이 같아
계획이 아무것도 쓰지 않는데, 이것이 완료 조건 6이 요구한 성질의 이 저장소 실물이다. 실제 갱신은 앱이 다음
설치 경로를 돌 때 일어난다.

## 남는 것 / 후속

- 설치본 `.workflow/rules/`는 이 세션 종료 시점에 아직 옛 버전(공통 규칙 10, 두 계약 5)이다. QA 때 앱을
  띄우면 그 자리에서 11·6으로 갱신되는지 함께 보면 좋다. 이 저장소의 조건 스크립트 설치본도 같은 이유로
  아직 `condition_script_version: 9`이고 앱 상수는 10이다(TASK-110).
- 역할 밖 관찰(무수정): 만료 lease 두 개(`IDEA-886DAB21.yml`·`SPEC-009.yml`)가 그대로 남아 있다. 판정이
  지우지 않는다는 SPEC-018 R4의 결정대로다.
- 역할 밖 관찰(무수정): TASK-112가 `blocked`이라 TASK-113~117 다섯이 함께 막혀 있다. SPEC-037 계열은 그
  하나가 풀려야 이어진다.
- SPEC-035의 나머지 완료 조건(1~16, 판정 세 구현)은 TASK-110이 닫았다. 이 작업은 17~22(계약·자산·버전)를
  닫는다.
