# TASK-110 개발 보고서

> 기록 경위: 하네스가 서브에이전트(tl-dev-110)의 보고서 파일 작성을 차단해, 발신된 전문을 TL이 대리 기록한다. 내용은 발신 전문 그대로다. (수신 2026-08-05T04:51Z, TL 세션)

- 대상: TASK-110 (멈춘 일을 세 판정이 함께 다시 보게 한다)
- 기획서 / 결정: SPEC-035 / DECISION-D6C694F2
- 세션: 2026-08-05T04:25Z~04:47Z, TL 투입 개발자 세션 (`tl-dev-110`)
- 선점: `sh .workflow/rules/wf-claim.sh acquire TASK-110 tl-dev-110 30` → exit 0,
  `lease_id: lease-23024-20260805042515`. 작업 중 `renew` 3회(전부 exit 0), 종료 시 `release` exit 0.

## 착수 전 확인

### 자격

`sh .workflow/rules/wf-eligible.sh developer` → `eligible` / exit 0.

착수 시점 lease 디렉터리에는 파일이 둘(`IDEA-886DAB21.yml`·`SPEC-009.yml`) 있었고 **둘 다 만료**였다
(`expires_at` 2026-08-05T00:25:31Z · 2026-08-03T01:20:00Z, 판정 시각 04:25:15Z). 만료 lease는 대상을
잡지 않으므로, `scope_files`를 선언한 이 작업도 겹침으로 막히지 않았다. 선행 넷은 TASK-101
`completed`, TASK-104·105·106 `qa_waiting`으로 모두 충족이다.

이 작업은 `scope_files`를 선언한 첫 착수 사례다. 겹침 판정이 도는 것을 확인했다 — 두 만료 lease는
후보에서 빠지고, 작업 문서가 아닌 문서(`IDEA-886DAB21`·`SPEC-009`)를 잡은 lease는 비교할 상대가
없어 애초에 막지 않는다.

### 착수 시점 값

| 항목 | 착수 시점 | 착지 시점 |
| --- | --- | --- |
| `CONDITION_SCRIPT_VERSION` (`:20`) | 9 | **10** |
| `CONDITION_SCRIPT_SH` 본문 버전 줄 | 9 | **10** |
| `CONDITION_SCRIPT_PS1` 본문 버전 줄 | 9 | **10** |
| `heartbeat_condition.rs`의 `#[test]` | 42 | 42 |
| `SCENARIOS` 행 | 31 | **43** |
| `role_eligibility.rs`의 `#[test]` | 52 | **60** |
| 세 파일의 `#[ignore]` | 0 | 0 |
| `cargo test` | 443 | **451** |

착수 시점 값은 배치 이전 커밋 `612b4f4`의 개수에 TASK-106의 uncommitted 추가(`judgement_cost` 검사
하나)를 더해 얻었다. TASK-106의 산출물은 아직 커밋되지 않았고 이 세션의 작업 트리에 이미 있었다.

## 변경 파일

- `src-tauri/src/infrastructure/heartbeat_condition.rs` — sh 본문(새 훑기 헬퍼 `scan_nondraft_refs`,
  `planner)` 절, `developer)` 후보 검사), PowerShell 본문(`Get-NonDraftReferences`, `planner`·
  `developer` 분기), 버전 축 셋, `SCENARIOS` 12행 추가, 만료 lease 헬퍼 하나 추가.
- `src-tauri/src/infrastructure/role_eligibility.rs` — `WorkflowInput`에 필드 하나 추가,
  `has_planner_work`·`has_developer_work` 이식본, 대조 시나리오 8건 추가, 기대값이 뒤집힌 기존 검사
  3건의 이름·주석·기대값 수정.
- `src-tauri/src/infrastructure/fs_project_repository.rs` — 새 필드를 채우는 계산
  (`collect_nondraft_sources`)과 그 값을 나르는 배선.
- `.workflow/도그푸딩--wf_ae6cd700/tasks/TASK-110.md` — `status`, `history`, `updated_at`.
- `reports/REPORT-TASK-110-DEV.md` — 하네스 차단으로 이 세션이 쓰지 못했다. 이 전문이 그 내용이다.

범위 파일 셋 말고 다른 코드 파일은 만지지 않았다. `domain/project.rs`·프론트엔드·`.workflow/rules/`
설치본·`docs/`는 그대로다.

## 아키텍트가 고정한 값과의 대조

| 고정값 | 구현 | 어긋남 |
| --- | --- | --- |
| 1. 자격이 넓어지는 자리는 딱 둘 | `developer)`의 후보 상태 하나, `planner)`의 참조 목록 하나 | 없음 |
| 2. 기획자 분기를 "비-draft 참조" 목록 한 벌로 접는다 | `scan_nondraft_refs` 하나를 (가)·(나)가 공유 | 없음 |
| 3. `draft` 판별은 스크립트 어법을 앱이 따라간다 | 셋 다 "`status:`로 시작하는 첫 줄의 값이 정확히 `draft`" | 없음 |
| 4. 앱 이식본은 판정 재료를 값으로 받는다 | `WorkflowInput::nondraft_spec_sources`, 계산은 저장소가 | 없음 |
| 5. 개발자 분기가 프로세스를 늘리지 않는다 | `grep -qsE "^status: (todo|in_progress)"` 호출 한 번 | 없음 |
| 6. 기존 검사를 지우지 않는다 | 삭제·`#[ignore]` 0건, 기대값 뒤집은 셋은 이름·주석 수정 | 없음 |

`role_eligibility.rs` 머리의 "알려진 차이"는 **다섯 그대로**다. 늘지 않았다.

### 셋이 같은 어법을 쓰는 자리 — `draft` 판별

이 작업이 새로 만든 유일한 갈림길이라 셋의 문장을 나란히 적는다.

- sh: `awk`가 `index($0, "status:") == 1`인 **첫 줄**의 값을 잡아 `status_value == "draft"`.
- PowerShell: `Get-Value $lines 'status'`(같은 규칙)의 값에 `-ceq 'draft'`.
- 앱: `yaml_text(metadata, "status").as_deref() == Some("draft")`.

값 전체를 비교하므로 `status:` 줄이 없는 문서와 계약 밖 값을 쓴 문서는 `draft`가 아니다 → 그 참조
줄은 모이고 원천은 후보가 아니다. 화면용 정규화(`normalize_spec_status`)는 계약 밖 값을 전부
`draft`로 접어 정확히 반대로 답하므로 쓰지 않았고, 파생 상태(`drafting`)는 "하나라도 `draft`"라
R2의 "모두 `draft`"와 다르므로 쓰지 않았다. 결정이 덮어쓴 상태도 보지 않는다 — 스크립트는 결정
문서를 읽지 않는다. `SCENARIOS`의 "기획자: status 줄이 없는 기획서는 draft가 아니다" 행이 이 어법을
두 본문에서 고정한다.

## 세 판정이 같은 답을 내는 것의 확인 방법과 결과

**방법은 셋이다. 어느 것도 문자열 포함 검사가 아니다.**

1. **앱 ↔ sh 대조**: `role_eligibility.rs`의 `assert_matches_condition_script`가 픽스처마다 세 역할
   전부에서 앱 판정과 설치된 스크립트의 종료 코드를 대조한다. 이 세션이 더한 대조 시나리오 8건과
   기대값을 뒤집은 3건이 모두 이 헬퍼를 지난다. 60건 전부 통과.
2. **sh ↔ PowerShell 대조**: `SCENARIOS` 표가 현재 플랫폼에 설치된 구현을 돌린다. 이 세션이 12행을
   더했고 43행 전부 통과. Windows 러너에서 같은 표가 PowerShell 본문으로 돈다.
3. **버전 일치 단언**: `both_implementations_share_the_managed_markers_and_version`이 두 본문의 버전
   줄과 상수 셋이 10으로 같은지 본다.

**결과: 세 판정이 갈라진 자리가 하나도 없다.** 구현 도중 실패한 검사 5건은 전부 "기대값이 바뀌었다"
쪽이었고, "앱과 스크립트가 다른 답을 냈다"는 실패는 한 번도 나오지 않았다. 대조 헬퍼가 그 두 종류를
다른 메시지로 구분하므로 이것이 근거가 된다.

로컬에 `pwsh`·`powershell`이 없어 PowerShell 본문을 이 기기에서 실행하지는 못했다. 코드 읽기로
sh 본문과의 구조 대응과 ASCII 전용(`the_powershell_implementation_is_ascii` 통과)을 확인했다.
TASK-104·106이 적은 것과 같은 한계다.

## judgement_cost 실측 변화 (검증 절차 3)

TASK-106이 세운 장치를 그대로 돌리고 값을 임시 출력으로 꺼내 읽었다. 확인용 출력은 되돌렸다
(세 파일에 `eprintln!`·`dbg!`·`println!` 0건).

| 역할 | 착수 전 1배 / 3배 | 착지 후 1배 / 3배 | 변화 |
| --- | --- | --- | --- |
| planner | 4 / 4 | **3 / 3** | 프로세스 **1개 감소** |
| architect | 2 / 2 | 2 / 2 | 없음 |
| developer | 919 / 2,743 | **919 / 2,743** | **없음** |

3배 개발자 내역: `sed` 866 · `grep` 865 · `head` 722 · `date` 145 · `tr` 145 — 착수 전과 같다.

- **`CAP`을 건드리지 않았다.** 3,000 그대로이고, 3배 개발자 2,743에 대한 여유도 257개 그대로다.
- 기획자가 준 것은 `scan_refs`를 두 번 부르던 자리(아이디어용·결정용)를 `scan_nondraft_refs` 한 번으로
  접었기 때문이다.
- 개발자가 소수점까지 같은 이유: 후보 검사가 `grep` 호출 한 번 그대로이고, 후보가 늘어날 여지가
  픽스처에 없다. **픽스처의 작업 96·288장이 전부 이미 후보다**(모두 `todo`이고 어느 것도 조기 종료를
  만들지 않는다). 즉 이 장치가 재는 최악 경로는 상태 집합이 넓어져도 그대로다 — 작업 문서 수가
  상한이고 픽스처가 이미 그 상한에 있다.
- 판정 대조도 같은 검사 안에서 통과했다: 두 픽스처 × 세 역할 여섯 자리에서 shim 실행과 일반 실행의
  종료 코드·사유가 같고 전부 `no-target`이다.

## 실저장소 판정 변화 (검증 절차 4)

설치본은 아직 v9다(앱이 재설치하기 전이다 — 이 세션은 설치본을 손대지 않았다). 그래서 설치본과
작업 트리 본문을 각각 돌려 착지 전후를 나란히 봤다. 작업 트리 본문은 임시 파일로 꺼내 실행했고
저장소에는 읽기만 했다.

| 역할 | 설치본 v9 (현재 답) | 작업 트리 v10 (착지 후 답) |
| --- | --- | --- |
| planner | `no-target` / 1 | **`eligible` / 0** |
| architect | `no-target` / 1 | `no-target` / 1 |
| developer | `no-target` / 1 | `no-target` / 1 |

**기획자가 열린 것이 이 기획서가 고치려던 실물이다.** 새로 후보가 된 원천은 정확히 하나다.

- `IDEA-886DAB21` — 본문이 "작성 중입니다." 한 줄인 `SPEC-036`(`status: draft`)이 이 아이디어를
  `source_idea_id`로 물고 있고, 그 아이디어를 잡았던 lease는 2026-08-05T00:25:31Z에 만료됐다.
  죽은 기획 세션이 남긴 스켈레톤 하나가 아이디어를 판정에서 영원히 지우던 상태 그대로이고,
  REPORT-SPEC-035-ARCH "넘기는 관찰" 2번이 지목한 자리다.
- 다른 아이디어·결정은 전부 비-`draft` 기획서가 참조하고 있어 답이 바뀌지 않았다. 스크립트로 세고
  문서를 직접 읽어 둘 다 확인했다.

**그 잔재에는 손대지 않았다.** SPEC-036도, `IDEA-886DAB21.yml` lease도, `SPEC-009.yml` lease도 읽기만
했다. 이 판정이 그것을 자연 회수하게 하는 것이 이 작업의 목적이고, 청소는 기획서 제외 범위다.

개발자가 두 본문 모두 `no-target`인 것은 측정 시점에 이 세션의 lease가 살아 있었기 때문이다.
`TASK-110`의 미만료 lease가 있고 다른 작업 중 `scope_files`를 선언한 것이 없으므로, TASK-101이 넣은
겹침 규칙대로 나머지 작업이 전부 막힌다. release 뒤에는 이 값이 다시 움직인다.

## 기대값을 뒤집은 기존 검사 셋

**하나도 지우지 않았다. 비활성화도 하지 않았다.** 이름과 주석을 새 규칙에 맞게 고치고 기대값만
뒤집었다. 픽스처(문서 구성)는 그대로 두었다.

| 이전 이름 | 새 이름 | 뒤집힌 이유 |
| --- | --- | --- |
| `an_idea_claimed_by_a_draft_spec_is_not_planner_work` | `an_idea_claimed_only_by_a_draft_spec_is_planner_work_again` | R2. `draft` 참조만 있는 아이디어가 다시 대상 |
| `an_expired_lease_does_not_change_how_a_declaration_is_judged` | `an_expired_lease_leaves_both_the_declaration_and_the_stalled_task_open` | R1. 후반 픽스처의 `in_progress` 선행이 자기 자신 회수 대상 |
| `a_follow_up_spec_answers_the_revision_request_whatever_its_status` | `only_a_non_draft_follow_up_spec_answers_the_revision_request` | R2. `draft` 후속은 수정 요청을 닫지 못한다 |

작업 문서가 지목한 것은 앞의 둘이다. **셋째는 이 세션이 실행으로 찾았고 같은 방식으로 처리했다** —
반복문의 두 상태를 유지하면서 기대값만 상태별로 갈랐으므로 두 방향이 모두 검사에 남는다(그 하나가
완료 조건 10·11을 함께 닫는다).

잃어버린 커버리지도 메웠다: 뒤집힌 두 번째 검사가 보던 "미충족 선언은 lease가 사라져도 미충족"은
`only_unsatisfied_dependencies_leave_no_developer_work`가 계속 따로 고정한다(그쪽은 선행에 미만료
lease를 두어 선행 자신을 후보에서 뺀다). 주석에 그 자리를 적어 두었다.

### 픽스처의 `status`만 바꾼 자리 넷 — 기대값은 그대로다

기대값을 뒤집는 대신 픽스처를 고친 자리가 넷이다. **리뷰가 갈릴 만한 자리라 근거를 적는다.** 넷 다
그 검사가 이름으로 말하는 것이 "참조가 원천을 닫는다"여서, 참조하는 기획서를 `draft`로 두면 새
규칙에서는 그 검사가 자기 이름을 더 이상 증명하지 못한다. 그래서 참조하는 기획서만 `user_review`로
올리고 이름·기대값·취지를 지켰다.

- `an_answered_or_claimed_revision_request_closes_planner_work`의 후속 기획서
- `SCENARIOS`의 "기획자: 모든 아이디어가 참조됐다"
- `SCENARIOS`의 "기획자: IDEA-1을 참조한 기획서가 IDEA-12를 닫지 않는다"
- `SCENARIOS`의 "기획자: IDEA-12를 참조한 기획서가 IDEA-1까지 닫는다"

뒤의 둘은 앵커 없는 부분 일치가 보존됐다는 사실을 지키는 행이다(TASK-104가 세웠다). `draft`로 두면
그 참조 줄이 목록에 들어오지 않아 부분 일치가 무엇을 하는지 아예 보이지 않게 되므로, 픽스처를
고치는 쪽이 그 성질을 계속 지킨다. **새 규칙이 여는 쪽(`draft` 참조)은 새 행·새 검사가 따로 덮는다.**

## 완료 조건 대조

| 조건 | 어디서 닫혔나 |
| --- | --- |
| 1. `in_progress` + lease 없음 → 대상 | `a_stalled_in_progress_task_is_developer_work` / 표 "멈춘 in_progress 작업에 lease가 없다" |
| 2. `in_progress` + 만료 lease → 대상 | `an_expired_lease_leaves_a_stalled_in_progress_task_open` / 표 한 행 |
| 3. `in_progress` + 미만료 lease → 아님 | `an_unexpired_lease_still_hides_an_in_progress_task` / 표 한 행 |
| 4. `in_progress` + 선행 미충족 → 아님 | `an_in_progress_task_with_an_unsatisfiable_declaration_is_not_developer_work` / 표 한 행 |
| 5. `blocked`은 두 경우 모두 아님 | `a_blocked_task_is_not_developer_work_with_or_without_an_expired_lease` / 표 두 행 |
| 6. `todo` 판정 불변 | 기존 개발자 검사 전부가 기대값 수정 없이 통과. 예외로 지목된 하나는 `in_progress` 픽스처다 |
| 7. 참조가 모두 `draft` + lease 없음 → 대상 | `an_idea_claimed_only_by_a_draft_spec_is_planner_work_again` / 표 한 행 |
| 8. 그 아이디어에 미만료 lease → 아님 | `a_leased_idea_claimed_only_by_a_draft_spec_is_not_planner_work` / 표 한 행 |
| 9. 하나가 `user_review`면 아님 | `an_idea_claimed_by_a_reviewed_spec_is_not_planner_work` / 표 한 행 |
| 10. `draft` 재작업만 남은 수정 요청 → 대상 | `only_a_non_draft_follow_up_spec_answers_the_revision_request`(draft 방향) / 표 한 행 |
| 11. 그 재작업이 `user_review`면 아님 | 같은 검사(user_review 방향) / 표 한 행 |
| 12. 판정이 아무것도 쓰지 않는다 | `recovering_a_stalled_session_writes_nothing` — lease 디렉터리와 워크플로우 트리 전체의 (경로, 내용)을 판정 전후로 대조 |
| 13. 1~11에서 앱과 스크립트가 같은 답 | 위 시나리오 전부가 `assert_matches_condition_script`를 지난다 |
| 14. 파생 상태가 `drafting`인데 둘 다 "대상 없음" | 9번 검사가 `idea.status == "drafting"`을 함께 단언한다 |
| 15. PowerShell이 sh와 같은 답 | `SCENARIOS` 12행 추가, 43행 통과(Windows 러너가 PowerShell로 같은 표를 돈다) |
| 16. 버전 축이 함께 오른다 | 9 → 10 셋. 관리 마커 없음·미래 버전·드리프트 세 경우의 기존 검사가 그대로 통과 |
| 17. 기존 검사 삭제·비활성화 없음 | 아래 "검사 목록 변경분" |
| 18. `npm run check`·`cargo test` 통과 | 아래 게이트 |

### 검사 목록 변경분 (조건 17)

배치 이전 커밋 `612b4f4`의 이름 집합과 현재 파일을 `comm`으로 대조했다.

- `heartbeat_condition.rs`: 사라진 `#[test]` 이름 **0건**. 늘어난 것은 `judgement_cost` 하나인데
  그것은 TASK-106의 것이다. `SCENARIOS` 행 이름 사라진 것 **0건**, 31 → 43.
- `role_eligibility.rs`: 사라진 이름 3건 = 위 "기대값을 뒤집은 검사 셋"의 옛 이름 그대로다. 새 이름
  11건 = 그 셋의 새 이름 + 새 검사 8건.
- 세 파일의 `#[ignore]` 0건(착수 0건).

## 게이트

| 검사 | 결과 |
| --- | --- |
| `cargo test --manifest-path src-tauri/Cargo.toml` | **451 passed** / 0 failed / 0 ignored (착수 443) |
| `cargo fmt --check` | 통과 (무출력) |
| `cargo clippy --all-targets -- -D warnings` | 통과 (경고 0) |
| `npm run check` | 통과 — 20개 파일 546 테스트, `tsc -b` + `vite build` 327 모듈 |

`cargo fmt --check`가 처음에 `has_planner_work`의 줄바꿈 한 곳을 지적해 `cargo fmt`로 정리했다.
그 정리는 이 세션이 새로 쓴 줄에만 닿았다.

## 남는 리스크 · 후속

1. **개발자 분기의 판정 비용이 실저장소에서는 늘 수 있다.** 계량은 변화 없음(2,743 그대로)이지만
   그것은 픽스처의 작업이 전부 이미 후보이기 때문이다. `in_progress` 작업이 많은 저장소에서는 후보가
   실제로 늘어 작업당 상수 개의 프로세스가 더 뜬다. 상한은 여전히 "작업 문서 수 × 상수"이고 픽스처가
   그 상한을 재고 있으므로 `CAP`은 넘지 않는다. 다만 TASK-104가 넘긴 개발자 분기의 3배 7.1초 문제는
   그대로 남아 있고, 이 변경이 그 자리를 좋게도 나쁘게도 만들지 않는다.
2. **PowerShell 본문을 이 기기에서 실행하지 못했다.** `pwsh`가 없다. Windows 러너의 `SCENARIOS` 표가
   그 자리를 덮는다. TASK-104·106과 같은 한계다.
3. **설치본이 아직 v9다.** 앱이 다음 설치 경로에서 v10으로 덮어쓴다. 그때까지 하트비트 데몬은 옛
   판정으로 돈다 — 즉 회수는 설치본이 갱신된 뒤에 실제로 일어난다. QA 때
   `.workflow/rules/wf-eligible.sh`의 `condition_script_version`이 10인지 보면 그 시점을 알 수 있다.
4. **역할 밖 발견(핸드오프).** 계약 문서(`workflow.md` §4·§5, 개발자·기획자 계약)는 아직 "인수가
   자격이다"를 말하지 않는다. TASK-111의 몫이고, 그때까지 판정이 계약보다 넓다. 자동 세션이 회수
   대상을 집었을 때 잔여물 평가(R3)와 이력 기록(R4) 의무가 계약에 없는 상태이므로, TASK-111이
   착지하기 전의 회수는 그 둘이 세션의 판단에 맡겨진다. 설치본 갱신이 TASK-111보다 먼저 오면 그
   창이 실제로 열린다.
5. **역할 밖 발견(핸드오프).** `domain/project.rs`의 `WorkflowItemSummary::source_decision_id` 주석이
   코드와 어긋난다는 REPORT-SPEC-035-ARCH "넘기는 관찰" 3번은 그대로다. 범위 파일이 아니라 손대지 않았다.

## 보호 상태

- `project.yml`·`workflow.yml`·`decisions/`·`.workflow/.runtime/`을 읽기만 했다. 결정 문서는 만들지도
  고치지도 않았다.
- lease는 헬퍼로만 다뤘다. 파일을 직접 만들거나 고치거나 지우지 않았다. release 뒤 lease 디렉터리에는
  만료된 `IDEA-886DAB21.yml`·`SPEC-009.yml` 둘만 남았다(착수 시점과 같다).
- `.workflow/rules/` 설치본을 손대지 않았다. `wf-eligible.sh`의 수정 상태는 착수 전부터 있던 앱의
  설치 출력이고, 그 내용이 v9 본문과 바이트 단위로 같음을 확인했다(sha 434e9874da510407).
- 다른 세션의 문서를 만지지 않았다. 이 세션이 쓴 워크플로 문서는 `tasks/TASK-110.md` 하나뿐이다
  (보고서는 차단됐다). 죽은 세션의 잔재(SPEC-036, `IDEA-886DAB21` lease, `SPEC-009` lease)는 판정
  확인을 위해 읽기만 했다. 같은 시각 작업 트리에 있는 다른 문서의 수정 상태는 이 세션의 것이 아니다.
- `git commit`·`git push`를 하지 않았다.
- 측정과 픽스처는 전부 임시 디렉터리에서 했고, 실저장소에는 읽기 전용 실행만 했다.
