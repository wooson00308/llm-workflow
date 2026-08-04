# TASK-086 개발자 핸드오프

> 기록 경위: 하네스가 서브에이전트(tl-dev-086)의 보고서 파일 작성을 차단해, 발신된 전문을 TL이 대리 기록한다. 내용은 발신 전문 그대로다. (수신 2026-08-04T10:23Z, TL 세션)

- 대상: TASK-086 (아키텍트 자격 판정이 최신 결정만 보고 대리 결정을 세지 않게 한다)
- 원천: SPEC-028 / DECISION-2A9D7B31 (`outcome: approved`, `created_by: user` 직접 확인)
- 선점: `acquire TASK-086 tl-dev-086 30` → exit 0, `lease-800-20260804095633`. 종료 시 release exit 0.
- 상태: `in_progress`(09:56:36Z) → `qa_waiting`(10:17:03Z), history 두 항목 추가.
- 선행: TASK-076 `qa_waiting` 확인. 착수 시점 `CONDITION_SCRIPT_VERSION`이 5인 것으로 그 작업의 구현 착지를 확인(작성 시점 값은 4).

## 핵심 결정과 근거

### 1. 최신 검사는 기획자 분기 어법 그대로 (완료 조건 4)

두 분기 루프를 대조하면 아키텍트 쪽은 기획자 분기(`:147`~`:159`)와 다음 두 줄만 다르다.

```sh
        ocb=$(sed -n 's/^created_by: *//p' "$o" | head -1)
        [ "$ocb" = "user" ] || continue
```

나머지는 문자 단위로 같다 — 자기 자신 제외, 스키마 줄 확인, 같은 `spec_id`만 비교, `[ "$oat" '>' "$at" ]` 문자열 비교, `newer=1`이면 건너뛰기, "동률은 최신으로 본다" 주석까지. PowerShell 쪽도 같은 대응이고 비교는 `[string]::CompareOrdinal`(기획자 분기가 문화권 비교를 피한 이유가 같다).

비교 대상(pool)에도 `created_by` 필터를 건 이유는 앱 파리티다. 앱의 `read_spec_decisions`가 `user`가 아닌 결정을 아예 읽지 않으므로, 스크립트만 그런 결정을 "더 늦은 결정"으로 세면 대리 결정이 있는 기획서에서 두 판정이 갈라진다.

### 2. 앱 쪽은 `latest_revision_requests` 선례를 따랐다 — 범위 밖 파일 1건 편집

`role_eligibility.rs`는 값만 받는 모듈이고 `WorkflowInput.approved_decisions`에 `created_at`이 없다. 최신 판정을 그 안에서 하려면 입력 자체를 바꿔야 한다. 그래서 같은 문제를 이미 푼 `latest_revision_requests`(SPEC-018) 옆에 `latest_approvals`를 두고 걸러진 목록을 넘겼다. 두 함수는 같은 비교와 같은 동률 처리(`>`, 동률은 양쪽 다 최신)를 쓴다.

**`fs_project_repository.rs` 제품 코드 세 자리를 건드렸다(범위 밖):** `PreparedWorkflow.approved_decisions` 필드 주석, `PreparedWorkflow::read`의 목록 생성 한 줄, `latest_approvals` 함수 추가.

대안 둘을 버렸다. (가) `items.specs[].events` 근사 — 이벤트는 결정 id를 싣지 않고 정렬이 파싱된 시각이라, 늦은 승인이 분해되고 이른 승인이 남은 기획서에서 앱과 스크립트가 갈린다(R7 세 번째 항목 위반). (나) `approved_decisions`에 `created_at` 싣기 — 같은 파일 같은 구간을 어차피 고쳐야 하고 최신 판정이 기획자 쪽과 다른 자리에 놓인다.

TASK-087이 같은 파일을 잡고 있으나 그 범위는 "테스트 모듈에만 더한다, 제품 코드 한 줄도 안 고친다"라 편집 구간이 겹치지 않았고 실제로 충돌 없이 적용됐다. 그래도 범위 밖이라 명시한다.

### 3. `created_by` 필터는 아키텍트 분기에만, 값 전체 비교 (완료 조건 2)

값은 작업 문서가 못 박은 `user-delegate` 그대로. 다른 값을 골라야 할 이유는 안 나왔다(TASK-087·088 동기화 불필요). 앱은 이미 `read_spec_decisions:1579`에 같은 필터가 있어 추가 변경 없음 — 이번에 좁아진 건 "알려진 차이 5" 문언이다.

### 4. 같은 초 충돌은 감수, 대신 "같이 틀린다"를 테스트로 고정 (완료 조건 5)

`2026-08-04T09:32:00Z` vs `2026-08-04T09:32:00.500000+00:00`을 비교하면 19번째 문자에서 `.`(0x2E) < `Z`(0x5A)라 **앱이 적은 쪽이 더 이르다고 나온다.** 같은 초에 기록된 앱 형식 결정은 최신 자리를 잃는다.

**비교 전에 다루지 않고 감수하기로 했다.** (1) 완료 조건 4가 기획자 분기와 같은 어법을 요구 — 비교 전에 표기를 다듬으면 아키텍트만 다른 방식으로 최신을 판정하게 되고 그게 R4 세 번째 항목이 막으려는 상태다. (2) 앱의 `latest_revision_requests`도 같은 문자열 비교라, 아키텍트 경로에만 정규화를 넣으면 앱 안에서 두 역할이 갈린다. (3) 표기 규약 변경은 기획서 제외 범위.

대신 `mixed_timestamp_notations_tie_the_same_way_in_both_implementations`로 **뒤집힘이 앱과 스크립트에서 똑같이 일어난다**는 것을 고정했다. 한계는 남되 두 판정은 안 갈라진다. 완전 동률은 양쪽 다 최신으로 봐서 결정이 조용히 닫히는 게 아니라 열리는 방향으로 틀린다(`approvals_recorded_at_the_same_instant_both_stay_latest`).

### 5. 완료 조건 1의 시나리오 행은 작업 문서와 다르게 적었다 — 상신 필요

작업 문서가 요구한 행: "승인 결정 + 그 id 참조 작업이 있는 기획서에 더 늦은 재가 결정이 더해진 상태 → 아키텍트 일감 없음".

**이 기대값은 지시된 두 판정으로 만들어지지 않고, 만들면 완료 조건 8과 충돌한다.** 최신 검사는 오래된 승인을 밀어내지만 더해진 재가 결정 자신은 최신이고 참조 작업이 없어 일감으로 남는다. "일감 없음"을 만들려면 판정 키를 결정에서 기획서로 옮겨야 하는데, 그러면 이 저장소의 실제 결정이 뒤집힌다.

- `SPEC-022`: `DECISION-7A3E5B90`(08:52:00Z 승인, TASK-063·064·065로 분해 완료) + `DECISION-4E8C1D67`(09:38:00Z 승인, 참조 작업 없음). 시나리오 행과 같은 모양이고, 지금 아키텍트 종료 코드 0의 원인이 이 결정이다.
- `DECISION-4E8C1D67` 본문: "DECISION-7A3E5B90을 대체하지 않고 확인 필요 3번의 범위 하나만 넓힌다", "별도 작업을 만들지 말고 흡수하고, 아니면 최소 작업 하나로 뗄 것". 아직 분해 안 된 실제 일감이다.
- 완료 조건 8이 손으로 적힌 결정의 판정 불변을 요구하므로 기획서 키 판정은 그 조건을 깬다.

그래서 표에는 실제 값(`expected: 0`, `eligible`)을 적고 행 주석과 `a_later_approval_stays_architect_work_after_the_earlier_one_was_decomposed`에 근거를 남겼다. **완료 조건 1은 이 작업 범위의 판정으로는 닫히지 않는다.**

한편 최신 검사가 실제로 닫는 구멍은 따로 있고 그건 닫혔다 — 승인 뒤 수정 요청이 붙은 기획서가 파생 작업 없다는 이유로 계속 아키텍트 일감으로 잡히던 것(계약 문언 "The latest app-owned decision must be `approved`"와 어긋나던 자리).

## 변경 파일

- `src-tauri/src/infrastructure/heartbeat_condition.rs` — `CONDITION_SCRIPT_SH`/`_PS1`의 `architect)` 분기에 두 판정, `CONDITION_SCRIPT_VERSION` 5→6(두 본문 버전 줄 포함), 시나리오 표 15행→18행(아키텍트 6행).
- `src-tauri/src/infrastructure/role_eligibility.rs` — 모듈 머리 "알려진 차이 5" 축소, `WorkflowInput.approved_decisions`·`has_architect_work` 주석 갱신(함수 본문은 그대로, 입력이 걸러져 온다), 테스트 6건 추가·1건 기대값 전환.
- `src-tauri/src/infrastructure/fs_project_repository.rs` — 범위 밖, 위 2절.

### 기존 테스트 취급 (완료 조건 11)

삭제·비활성화 없음. 불가피한 갱신 넷:

1. `an_approved_decision_followed_by_a_revision_request_is_still_architect_work` → `an_approved_decision_superseded_by_a_revision_request_is_not_architect_work`. 이 테스트가 고정하던 동작("최신 결정만 본다로 구현하면 여기서 갈라진다")이 정확히 R4가 바꾸라고 한 동작이다. 픽스처·대조 방식 유지, 기대값/이름/주석만 전환.
2. 시나리오 표의 `write_approved_decision`에 `created_by: user` 추가. 없으면 새 필터가 표의 모든 아키텍트 행을 대리 결정으로 읽어 행의 뜻이 사라진다.
3. `a_declaration_does_not_change_the_other_roles`의 인라인 결정에 `created_by: user` 추가. 아키텍트 1이 원래 이유(참조 작업 존재)에서 나오게 유지.
4. 버전 리터럴 셋을 6 기준으로 갱신(완료 조건 10이 요구).

## 게이트 수치 (실행 결과 그대로)

- `cargo test`: **391 passed / 0 failed / 0 ignored**. 신규·전환 테스트 전부 통과.
  - 중간에 `heartbeat_service::install_tests::a_failed_condition_script_install_leaves_the_heartbeat_file_alone` 1건 실패 시점이 있었으나 내 변경과 무관(픽스처 seed `fs::write`가 `install()` 호출 전 NotFound로 죽음, 테스트 본문은 HEAD와 동일한데 헬퍼 `jobs_file`이 SPEC-024 세션의 `project_jobs_path` 전환으로 바뀐 상태). 그 세션이 이후 고쳐 지금 통과.
- `cargo fmt -- --check`: **차이 없음**(전체).
- `cargo clippy --all-targets -- -D warnings`: `src/infrastructure/heartbeat_process.rs:216`의 `cloned_ref_to_slice_refs` 1건으로 실패. **내 변경과 무관** — HEAD에 없는 다른 세션의 새 파일(`git status`에서 `??`), 범위 밖이라 안 고쳤다. `-A clippy::cloned_ref_to_slice_refs`로 돌리면 경고 없이 끝난다(내 파일 무경고).
- `npm run check`: 18 test files / **452 passed**, `tsc -b && vite build` 성공.
- 모듈별: `role_eligibility` 40 passed, `heartbeat_condition` 41 passed.

성공 판정: 신규 테스트 전부 통과 + 기존 테스트 무삭제/무비활성 + 백엔드 실패 0. clippy 1건은 타 세션 신규 파일 소유.

### 실제 저장소 판정 대조 (완료 조건 6·7·8)

`git diff`로 판정하지 않았다. 본문 상수를 추출해 변경 전 아키텍트 분기로 되돌린 사본(before)과 현재 사본(after)을 만들어 프로젝트 루트에서 둘 다 실행했다. 설치본 `.workflow/rules/wf-eligible.sh`(버전 4)는 읽기만 했다.

세 역할 종료 코드 — 전후 동일: planner 1/`no-target`, architect 0/`eligible`, developer 0/`eligible` (before = after).

결정 단위: 이 워크플로우 결정 문서 **29건 전부**에 대해 "아키텍트 일감으로 세어지는가"를 before/after로 뽑아 비교 → **차이 없음**. 앱 형식 8건(SPEC-001·002·003·004·009·019·020·021)도 수기분도 판정 동일. 세어지는 결정은 양쪽 다 `DECISION-4E8C1D67` 하나. `DECISION-6F1B8C53`(SPEC-027)은 TASK-090·091이 참조해 양쪽 다 제외. 29건 전부 `created_by: user`라 새 필터를 통과한다.

`SPEC-022`만 최신 검사 영향을 받지만(`DECISION-7A3E5B90`이 최신이 아니게 됨) 이미 파생 작업이 있어 전에도 안 세어졌으므로 결과 불변. 나머지 기획서는 결정이 하나뿐이라 영향 없음.

### 심볼 단위 무변경 확인

- `has_planner_work`·`has_developer_work` 본문 무변경, 스크립트 `planner)`·`developer)` 분기 무변경(위 종료 코드가 실행값으로 증명).
- `has_architect_work` 본문 무변경(바뀐 건 주석과 입력 목록의 뜻).
- `latest_revision_requests`·`latest_spec_decisions`·`read_spec_decisions` 무변경, `:1579`의 `created_by` 필터 착수 시점과 동일.
- `the_powershell_implementation_is_ascii` 무수정 통과(완료 조건 9).
- `assert_matches_condition_script` 호출 지점 36 → **41**. 줄지 않음(완료 조건 3).
- `ROLE_RULES_VERSION`·`WORKFLOW_RULES_VERSION`·`project_instructions.rs`·역할 계약 세 문서·`.workflow/rules/` 설치본 전부 무변경.

### 실행 못 한 검증

PowerShell 본문은 이 러너(macOS, `pwsh` 없음)에서 실행 불가. 정적으로 ASCII 테스트와 `both_implementations_carry_the_same_interface`가 덮고, 시나리오 표는 CI Windows 러너가 같은 18행을 PS 구현으로 돌린다. 두 분기는 같은 편집에서 함께 고쳤다.

## 후속 / 리스크

1. **(상신, 중요) 완료 조건 1이 이 작업으로 닫히지 않는다.** 위 5절. 재가가 이중 분해를 막게 하려면 판정 밖 장치(예: 재가 결정이 앞선 결정의 파생 작업을 잇는 필드)가 필요하고, 지금 판정으로 막으면 `DECISION-4E8C1D67` 같은 실제 보충 승인이 묻힌다. **TASK-088이 계약 문언에 "재가는 두 번째 작업 세트를 만들지 않는다"를 적기 전에 이 항목의 결론이 필요하다** — 지금 적으면 계약이 거짓말을 한다(TASK-088 자신이 적은 원칙이 이 경우다).
2. 범위 밖 파일 편집 1건: `fs_project_repository.rs` 제품 코드. TASK-087과 구간 불겹침이지만 리뷰 확인 대상.
3. 기획자·개발자 분기의 `created_by` 비대칭이 남는다(기획서 제외 범위). 대리 결정이 늘면 기획자 판정에서 먼저 드러난다.
4. 설치본 스크립트가 아직 버전 4라 사유 출력이 없다. 앱이 설치를 돌려야 6으로 올라간다. 이 작업은 설치본을 직접 고치지 않았다.
5. 혼합 표기 한계 잔존(위 4절). 표기 규약을 계약에 올리는 후속에서 다뤄야 한다.
6. `heartbeat_process.rs:216` clippy 위반은 다른 세션의 새 파일 소유.
