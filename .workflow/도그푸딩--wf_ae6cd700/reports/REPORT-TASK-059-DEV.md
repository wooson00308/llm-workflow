# TASK-059 개발자 핸드오프

> 기록 경위: 세션 하네스가 보고서 파일 작성을 차단해, 세션이 채팅으로 보낸 전문을 TL이 그대로 기록했다.

- 대상 작업: TASK-059 (규칙 자산과 파일 계약이 재작업 자격·우선순위·후속 참조·lease 만료 기준을 적는다)
- 근거 문서: SPEC-018 R2·R3·R4·R7, DECISION-1224D86C (approved, created_by: user)
- 세션 역할: 개발자 (TL 배정, 병렬 웨이브, 에이전트명 dev-059)
- 작성 시각: 2026-08-03T12:45Z
- 상태: `qa_waiting`

## 착수 조건 확인

- 선행 둘 다 충족 실측. TASK-041 `qa_waiting`, TASK-057 `qa_waiting`. 개발자 계약의 충족 정의(`qa_waiting` 또는 `completed`)를 그대로 적용했다.
- 선행 산출물을 리터럴이 아니라 파일에서 읽었다. 착수 시점 `project_instructions.rs`의 `WORKFLOW_RULES_VERSION`은 6, `ROLE_RULES_VERSION`은 4였고(TASK-041이 올려 둔 값), 역할 계약 셋의 `rules_version`은 모두 4였다. TASK-057의 산출물은 `derive_idea_states`의 네 갈래(`inbox`/`drafting`/`closed`/`adopted`)와 `role_eligibility.rs:86`의 `idea.status == "inbox"` 판정으로 확인했다.
- `.workflow/.runtime/migration.lock` 없음.
- 선점 헬퍼 `.workflow/rules/wf-claim.sh`는 아직 미설치라(TASK-039 산출물) 공통 규칙 §4의 폴백을 썼다. `set -o noclobber`로 `leases/TASK-059.yml` 배타 생성(lease_id `lease-dev059-20260803123557-13284`). 착수 시점 남의 lease는 `SPEC-009.yml`(만료 잔존), `TASK-049.yml`이었고 하나도 건드리지 않았다.
- 선점 직후 실작업 전에 `TASK-059.md`를 `in_progress`로 옮기고 같은 편집에서 `history`에 `{ at: 2026-08-03T12:35:57Z, kind: in_progress }`를 append했다. 시각은 전부 `date -u`로 실측했다.

## 변경한 파일 (2건, 작업 범위 그대로)

### `src-tauri/src/infrastructure/project_instructions.rs`

- 버전 상수 둘: `WORKFLOW_RULES_VERSION` 6 → 7, `ROLE_RULES_VERSION` 4 → 5.
- `WORKFLOW_RULES` 프론트매터 `rules_version: 6` → `7`.
- `WORKFLOW_RULES` §4에 두 문단 추가(R4): 시각 표기 기준과 만료 판정 기준. lease 예시 블록의 `heartbeat_at`·`expires_at` 자리표시자를 `<RFC3339 timestamp>`에서 `<YYYY-MM-DDTHH:MM:SSZ>`로 바꿔 본문과 예시가 같은 말을 하게 했다.
- `WORKFLOW_RULES` §5 "Ideas and specifications"에 불릿 셋 추가(R2): 재작업 기획서가 두 필드를 모두 적는다는 의무, 후속 판정 키가 `source_decision_id`라는 것과 그 근거, 개발 작업의 동명 필드와 섞이지 않는 이유.
- `PLANNER_RULES` 프론트매터 `rules_version: 4` → `5`. `## Eligibility`와 `## Choose in this order` 두 절 신설(R1·R3). 기존 `## Claim first`의 미처리 아이디어 정의 문장은 문구 그대로 `Eligibility`로 옮겼다(중복 서술을 만들지 않기 위해서다). `Claim first`와 `Completion`의 "prior specification and decision IDs" 표현을 `source_spec_id`·`source_decision_id` 필드 이름으로 바꿨다.
- 테스트: 신규 1건(`records_the_planner_selection_order_and_lease_expiry_in_the_installed_rules`), 기존 단언 갱신 9줄(`rules_version: 6` → `7` 6줄, `planner.contains("rules_version: 4")` → `5` 3줄).

### `docs/file-contract.md`

- 기획서 절: 재작업 참조 문장을 두 필드 이름으로 바꾸고, 후속 판정 키 문단을 새로 넣었다(R2·R7).
- 아이디어 표시 문단: 파생 상태를 셋에서 넷으로 고쳤다(`수집됨`·`반영중`·`종결`·`채택`). 이어지는 문단의 "조건 스크립트의 미처리 판정은 이 표시와 다르다"는 사실과 어긋나므로 "미처리 아이디어 판정은 `수집됨`과 같은 조건이다"로 고치고, 그래도 화면을 자격 판정으로 읽으면 안 되는 이유(수정 요청 결정은 화면에 없다)를 남겼다.
- 사용자 결정 절: `revision_requested` 불릿에 "후속이 없으면 기획자 처리 대상으로 남고 판정 키는 `source_decision_id`" 한 문장을 더했다.
- 역할 계약 절: 기획자 문장을 자격 조건 둘로 풀고, 선택 순서 불릿을 새로 넣었다(R1·R3).
- lease 문단: 시각 표기 기준과 만료 판정 기준을 더했다. "앱은 lease를 읽기만 한다"는 현행 서술은 그대로 뒀다.

범위 밖 무변경(한 줄도 안 건드림): `heartbeat_condition.rs`, `fs_project_repository.rs`, `role_eligibility.rs`, `scripts/wf-eligible.sh`, `.workflow/rules/*` 설치본, 화면 전부, 아키텍트·개발자 역할 계약 본문.

## 핵심 결정과 근거

1. **버전 인상은 읽은 값 기준.** 작업 문서가 "현재 값을 읽고 1을 올린다"고 못박았고 TASK-041이 이미 한 번 올린 뒤였다. 읽은 값 6·4에서 7·5로 올렸다. `ROLE_RULES_VERSION`은 "역할 계약 셋의 최댓값" 규약이므로 planner만 5로 올리고 architect·developer는 4로 둔 채 상수를 5에 맞췄다. `plan_rules_file`은 파일 버전이 상수보다 **클 때만** 거부하므로 4짜리 두 계약도 그대로 설치·검증된다(테스트 통과로 확인).

2. **미처리 아이디어 정의는 옮기되 문구를 그대로 뒀다.** 작업 문서가 "현행 문장 유지"를 요구했다. `Claim first`에 남겨 두고 `Eligibility`에 다시 쓰면 같은 정의가 두 곳에 생겨, 다음에 한쪽만 고쳐지면 계약이 스스로 모순된다. 문구를 보존한 채 자격 절로 이동시켰다.

3. **lease 예시 블록의 자리표시자도 바꿨다.** R4가 없애려는 것이 "RFC3339라고만 적어 두면 구현마다 읽는 범위가 달라진다"인데, 본문에서 표기를 못박고 바로 위 예시가 `<RFC3339 timestamp>`로 남아 있으면 그 문단이 예시와 싸운다. 예시는 계약을 읽는 세션이 실제로 복사하는 자리다.

4. **아이디어 표시 문단의 "다르다"를 "같다"로 뒤집은 근거는 코드다.** 조건 스크립트 (가)는 `source_idea_id` 참조가 있으면 건너뛰고 `lease_blocks`가 참이면 건너뛴다. 앱의 `inbox`는 `!referenced && !preempted`다. 그리고 `has_planner_work`가 `idea.status == "inbox"`를 쓴다. 세 자리가 같은 조건이다. 다만 기획자 자격 전체가 아이디어와 같아진 것은 아니라서(수정 요청 결정이 다른 한 축이다) 그 한계를 문단에 남겼다.

5. **`종결` 판정 서술에 "선점도 없으면"을 넣었다.** `derive_idea_states`는 `preempted || !drafts.is_empty()`를 `all_rejected`보다 먼저 본다. 선점된 아이디어는 전부 반려여도 `반영중`이다. 판정 순서를 문장 순서로 옮겨 적었다.

## 검증 수치

작업 트리 전체 기준이고, 병렬 세션의 파일이 섞여 있는 상태에서 잰 값이다.

| 게이트 | 결과 |
| --- | --- |
| `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` | exit 0, 차이 없음 |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | exit 0, 경고 0 |
| `cargo test --manifest-path src-tauri/Cargo.toml` | exit 0, 352 passed / 0 failed |
| `npm run check` | exit 0, tsc + vitest 327 passed(14 파일) + `vite build` 성공 |

`project_instructions` 모듈만 따로: 14 passed / 0 failed(신규 1건 포함).

삭제·비활성화·약화한 테스트는 없다. 기존 테스트 수정은 버전 상수 인상에 따른 단언 값 갱신 9줄뿐이고, 이는 TASK-022 선례와 같은 성격이다(당시에도 `rules_version` 단언만 갱신했다).

### 중간 관측 (기록만, 손대지 않음)

첫 게이트 실행에서 `role_eligibility.rs`가 dev-060의 편집 중간 상태였다 — clippy가 `overly_complex_bool_expr`(`true || ...`)로 컴파일을 막았고 `cargo test`가 developer 판정 동치 테스트 4건에서 실패했다. 내 파일 둘과 무관하고, 그때도 `project_instructions` 14건은 전부 통과했다. dev-060의 편집이 진행되어 파일이 정리된 뒤 재실행한 값이 위 표다. 남의 영역이라 한 줄도 건드리지 않았다.

## 완료 조건 대조

1. 설치된 `planner.md`에 자격 판정과 선택 순서가 있고 `rules_version` 5, 앱 내장 본문과 동일 — 신규 테스트가 tempdir 설치본을 읽어 확인. 충족
2. 설치된 `workflow.md`에 참조 필드·후속 판정 키·만료·시각 표기가 있고 `WORKFLOW_RULES_VERSION` 7, 본문과 동일 — 같은 테스트 + `validates_the_instructions_it_just_installed`. 충족
3. `ROLE_RULES_VERSION`(5) == max(planner 5, architect 4, developer 4). 충족
4. `docs/file-contract.md` 네 자리 갱신, 어긋나는 서술 없음. 충족
5. 네 문서가 같은 자격 조건·같은 우선순위를 말한다 — 본문 대조 표 참조. 충족
6. 설치본이 앱보다 새 버전이면 멈추는 안전 규칙 — `refuses_to_downgrade_future_managed_rules` 무수정 통과. 충족
7. 기존 테스트 삭제·비활성화 없음. 충족
8. `npm run check`·`cargo test` 통과. 충족

### 네 문서 대조 (완료 조건 5)

| 항목 | 조건 스크립트 | 공통 규칙 §4·§5 | 기획자 계약 | 파일 계약 |
| --- | --- | --- | --- | --- |
| 미처리 아이디어 | 참조 없음 + `lease_blocks` 거짓 | (자격은 역할 계약) | 참조 없음 + 미만료 lease 없음 | 같은 문장 |
| 처리 대상 수정 요청 | 최신 결정 + `source_decision_id` 참조 없음 + lease 없음 | 후속 판정 키 = `source_decision_id` | 같은 세 조건 | 같은 세 조건 |
| 만료 lease | 선점으로 세지 않음 | 선점으로 세지 않음 | §4 참조 | 선점으로 세지 않음 |
| 시각 표기 | `YYYY-MM-DDTHH:MM:SSZ`만 비교 | 같은 표기로 쓴다 | §4 참조 | 같은 표기 |
| 우선순위 | 표현하지 않음(있다/없다) | — | 재작업 우선, 동종은 `created_at` 오름차순 | 같은 규칙 + "순서로 읽지 말 것" |

## 리스크·후속

- **설치본은 아직 옛 버전이다.** 이 저장소의 `.workflow/rules/workflow.md`는 6, `roles/planner.md`는 4다. 규칙 자산 갱신은 앱이 승인·QA를 기록할 때 일어나므로, 다음 앱 쓰기까지 설치본은 옛 값으로 남는다. 손으로 고치지 않았다(앱 소유 자산). 두 값이 상수보다 작으므로 `plan_rules_file`이 거부하지 않고 정상 갱신된다.
- **`role_eligibility.rs`의 모듈 주석 4번이 반쯤 낡았다.** "표기 기준을 계약에 올리기 전까지 남는 차이"라고 적혀 있는데, 이 작업이 그 기준을 계약에 올렸다. 코드상의 차이(앱은 RFC3339 파싱, 스크립트는 고정 자리수)는 그대로이므로 주석이 거짓은 아니지만, "계약에 올리기 전까지"라는 조건절은 이제 만족됐다. 이 작업의 범위 밖이고 그 파일은 dev-060이 잡고 있어 손대지 않았다.
- **기존 문서는 이미 새 계약을 만족한다.** SPEC-013·SPEC-015가 두 필드를 이미 적고 있어 소급 수정이 필요 없다(작업 문서의 제외 범위와 일치).
- 후속 작업 TASK-058(아이디어 인박스 화면)이 같은 `종결` 상태를 화면에 올린다. 이 세션은 계약 문구만 맞췄고 화면은 건드리지 않았다.

## 사용자 QA 제안

앱을 띄우고 기획서 승인이나 QA를 한 번 기록하면 규칙 자산이 갱신된다. 그 뒤 다음을 확인하면 된다.

1. **버전 인상 확인.** `.workflow/rules/workflow.md`의 `rules_version`이 7, `.workflow/rules/roles/planner.md`가 5, `architect.md`·`developer.md`가 4로 남아 있는지.
2. **본문 일치 확인.** 갱신된 `planner.md`에 "Choose in this order" 절이 있고 재작업 우선 근거와 `created_at` 오름차순 규칙이 적혀 있는지. `workflow.md` §4 끝에 "An expired lease does not hold its target" 문단과 `YYYY-MM-DDTHH:MM:SSZ` 표기 규칙이 있는지.
3. **안전 규칙 확인(선택).** 임시 프로젝트에서 `.workflow/rules/workflow.md`의 `rules_version`을 999로 손으로 바꾼 뒤, 앱이 그 파일을 덮어쓰지 않고 오류로 멈추는지. 파일 내용이 그대로 남아야 정상이다.
4. **문서 대조.** `docs/file-contract.md`의 아이디어 표시 문단이 네 상태를 적고, 다음 문단이 "미처리 아이디어 판정은 `수집됨`과 같은 조건"이라고 적는지. TASK-057이 구현한 `종결` 판정과 읽어서 어긋나는 곳이 없는지.
5. 자동화로 덮은 부분: 설치·갱신·검증·안전 규칙·본문 문구는 `cargo test`의 `project_instructions` 14건이 tempdir 프로젝트로 매번 확인한다. 손으로 다시 볼 필요가 있는 것은 4번(사람이 읽어야 판단되는 서술 일관성)이다.
