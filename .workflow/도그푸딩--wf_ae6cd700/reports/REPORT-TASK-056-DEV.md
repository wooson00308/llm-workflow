# TASK-056 개발자 핸드오프

> 기록 경위: 세션 하네스가 보고서 파일 작성을 차단해, 세션이 채팅으로 보낸 전문을 TL이 그대로 기록했다.

- 대상 작업: TASK-056 (후속 기획서가 없는 수정 요청이 기획자 대기 물량이 되고 두 판정이 같은 결론을 낸다)
- 근거 문서: SPEC-018 R1·R5, DECISION-1224D86C (approved, created_by: user)
- 세션 역할: 개발자 (TL 배정, 병렬 웨이브)
- 작성 시각: 2026-08-03T10:18Z
- 상태: `qa_waiting`

## 대상 선정 근거

- TL이 이 한 건만 배정했다. 착수 시점(10:08Z) `status: todo`.
- 선행 `depends_on: [TASK-055]`가 `qa_waiting`이라 충족. 착수 전 트리 그린(307 passed)과
  `CONDITION_SCRIPT_VERSION = 3`, TASK-042 반영(PowerShell 본문 존재)을 실측했다.
- `migration.lock` 없음. 착수 시점 lease는 `SPEC-009.yml`(만료), `TASK-045.yml`, `TASK-047.yml`이었고
  내 대상이 아니라 손대지 않았다.
- 선점: `leases/TASK-056.yml` 배타 생성(`set -C`) → 즉시 `in_progress` + `history` → 구현 → 검증 →
  `qa_waiting` → 반납.

## 변경한 파일 (4건, 작업 범위 그대로)

- `src-tauri/src/infrastructure/heartbeat_condition.rs` — `sh`·PowerShell 두 본문의 `planner` 분기,
  `CONDITION_SCRIPT_VERSION` 3→4, 테스트.
- `scripts/wf-eligible.sh` — 관리 표기 두 줄을 뺀 같은 본문. 앱 상수에서 기계적으로 생성했다.
- `src-tauri/src/infrastructure/fs_project_repository.rs` — `latest_revision_requests`,
  `PreparedWorkflow.revision_requested_decisions`, `WorkflowInput` 조립 한 줄.
- `src-tauri/src/infrastructure/role_eligibility.rs` — `WorkflowInput` 필드, `has_planner_work`,
  알려진 차이 목록, 시나리오 표 10건.

범위 밖 무변경: `project_instructions.rs`·`docs/file-contract.md`·`domain/project.rs`·화면.
`architect`·`developer` 분기는 한 글자도 바뀌지 않았다.

## 판정 규칙 (작업 문서 1절의 단일 정의)

기획자 대기는 **(가) 미처리 아이디어** 또는 **(나) 후속 기획서가 없는 수정 요청 결정** 중 하나라도
있으면 있음이다. (나)의 다섯 조건: 스키마가 `workflow-labs/decision@1`이고 `spec_id`가 비어 있지
않음 → 그 `spec_id`의 최신 결정임 → `outcome: revision_requested` → 그 **결정 id**를
`source_decision_id`로 참조하는 기획서가 `specs/`에 없음 → 그 결정 id의 유효한 lease가 없음.

### 구현 결정 둘

**1. 최신 판정에 `latest_spec_decisions`를 쓰지 않았다.** 작업 문서 3절이 그 함수를 지목했지만,
그쪽은 `>=`라 `created_at`이 같은 결정이 둘이면 나중에 읽힌 하나만 최신으로 남고 디렉터리 순회
순서는 정해져 있지 않다. 스크립트는 1절 규칙 2번대로 "더 큰 것이 있는가"만 보므로 동률을 양쪽 다
최신으로 본다. 그대로 뒀으면 동률 픽스처에서 두 판정이 갈렸다. 그래서
`latest_revision_requests`를 따로 두고 스크립트와 같은 "strictly greater" 비교를 쓴다. 1절이
"규칙의 단일 정의"라고 못박았으므로 그쪽을 따랐다. 동률 시나리오를 sh 프로브와 Rust 테스트 양쪽에
고정했다.

**2. `has_planner_work`의 아이디어 조건을 `status == "inbox"`로 바꿨다.** DECISION-1224D86C가 이
기획서에 배정한 일치 복원이다. `!= "adopted"`는 SPEC-012가 파생 상태를 세 값으로 바꾼 뒤로
스크립트와 어긋나 있었다 — `draft` 기획서가 참조하는 아이디어(`drafting`)에서 앱만 대기 있음이라고
답했다. 재현 픽스처를 `an_idea_claimed_by_a_draft_spec_is_not_planner_work`로 고정했다.

## 세 벌 동기

`sh` 본문 · PowerShell 본문 · 저장소 사본을 같은 판정으로 맞췄고 버전 줄 셋과 상수를 함께 4로
올렸다. 저장소 사본은 손으로 쓰지 않고 앱 상수에서 관리 표기 두 줄만 빼 생성했으며,
`the_repository_copy_matches_the_managed_script`가 바이트 일치를 고정한다.

PowerShell 이식에서 잡은 것 하나를 남긴다. 최신 판정의 `created_at` 비교를 처음에 `-cgt`로 썼다가
`[string]::CompareOrdinal(...) -gt 0`으로 바꿨다. .NET의 문화권 비교는 하이픈 같은 문자를 무시할 수
있어 타임스탬프 순서가 뒤집힐 여지가 있다. TASK-055가 lease 만료 비교에서 이미 `CompareOrdinal`을
쓴 선례가 있어 그쪽에 맞췄다. 정적 검사에서 대소문자 무시 연산자가 문자열 비교에 남아 있지 않음을
확인했다(남은 `-eq`·`-gt`·`-lt`는 전부 `.Length`·`.Count` 수치 비교이거나 `CompareOrdinal` 결과다).

sh 쪽 구조 변경도 하나 있다. 기존 `[ -d "${wf}ideas" ] || continue`를 `if ... fi`로 바꿨다. 그대로
두면 `ideas/` 없는 워크플로우에서 결정 루프까지 건너뛴다. 그 경우를
`a_revision_request_opens_planner_work_without_any_idea`로 고정했다.

## 검증 단계와 결과

작업 문서의 검증 절차 그대로 실행했다.

| 명령 | 결과 |
| --- | --- |
| `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` | 통과 |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | 경고 없음 |
| `cargo test --manifest-path src-tauri/Cargo.toml` | 328 passed / 0 failed / 0 ignored |
| `npm run check` | 315 passed (14 files), `tsc -b && vite build` 통과 |

- `heartbeat_condition` 34 → 38 (실행 테스트 4건 추가), `role_eligibility` 18 → 28 (시나리오 10건 추가).
- 삭제·비활성화한 테스트 없음. 기존 테스트 중 고친 것은 버전 문자열 3곳(3→4)뿐이고 검증하던 사실은
  그대로다.
- sh 본문은 `dash`·`bash`·`ksh`·`zsh`에서 문법 검사를 통과했고, 별도 프로브로 16개 시나리오를
  종료 코드로 확인했다.
- 저장소 자체 대조: `planner=1`, `architect=1`, `developer=0`. 이 저장소에는 후속 없는 최신
  `revision_requested` 결정이 없어 planner가 1이다.

## TASK-043이 바로 쓸 v4 판정 요약

| 역할 | 대상이 있음(exit 0)의 조건 |
| --- | --- |
| `planner` | (가) 어떤 기획서도 `source_idea_id`로 참조하지 않고 유효 lease가 없는 아이디어, **또는** (나) 스키마가 `decision@1`이고 `spec_id`가 있으며 그 `spec_id`의 최신(더 큰 `created_at`이 없는) 결정이고 `outcome: revision_requested`이며 그 **결정 id**를 `source_decision_id`로 참조하는 기획서가 없고 유효 lease가 없는 결정 |
| `architect` | `outcome: approved`이고 그 결정 id를 `source_decision_id`로 참조하는 **작업 문서**가 없으며 그 `spec_id`로 유효 lease가 없는 결정 (최신 여부를 보지 않는다 — v4에서도 그대로) |
| `developer` | `status: todo`이고 유효 lease가 없으며 `depends_on` 선언이 충족된 작업 (`Missing`→`Cyclic`→상태 순, `qa_waiting`·`completed`만 충족, 형식 오류는 미충족) |

공통: `.workflow/.runtime/migration.lock`이 있으면 역할과 무관하게 1. 알 수 없는 역할은 2.
lease 유효성은 `expires_at`이 `YYYY-MM-DDTHH:MM:SSZ` 자리수를 만족하고 현재 UTC보다 큰 경우만이며,
읽을 수 없는 표기는 막지 않는다(TASK-055).

표에 넣을 만한 갈림길 픽스처는 이번에 만든 것 기준으로 이렇다. 후속 기획서 상태(`draft`/`user_review`)가
결과를 바꾸지 않음 · 뒤에 붙은 `approved`/`rejected`가 재작업을 닫음 · `created_at` 동률은 양쪽 다
최신 · 다른 기획서의 늦은 결정은 무관 · 그 결정을 참조하는 것이 작업 문서뿐이면 대기 유지 ·
QA 결정(`qa-decision@1`, `task_id` 보유)은 기획자를 깨우지 않음 · 결정 id lease는 미만료만 막음 ·
`draft` 기획서가 참조하는 아이디어는 양쪽 다 대기 없음.

## 리스크와 후속

1. **`architect` 분기는 여전히 최신 결정을 보지 않는다.** `planner`만 최신 판정을 갖게 되어 두 분기의
   기준이 다르다. 의도된 상태이고(기획서 제외 범위, 확인 사실 17번)
   `an_approved_decision_followed_by_a_revision_request_is_still_architect_work`가 그 성질을 고정한다.
2. **알려진 차이가 다섯으로 늘었다.** 새로 더한 5번은 "앱은 결정을 `created_by: user`와 세 `outcome`
   값으로 한 번 더 거르고 스크립트는 스키마 줄과 `spec_id` 유무만 본다"다. 앱이 쓰는 결정 문서는 항상
   그 둘을 만족하므로 손으로 만든 문서에만 해당한다. 머리말의 "셋"도 다섯으로 고쳤다(TASK-055가 4번을
   더하면서 남아 있던 수치 오류).
3. **최신 판정이 결정 수의 제곱에 비례한다.** sh는 이중 루프, 앱은 `records.iter().any` 중첩이다. 이
   워크플로우의 결정이 30건대라 문제가 되지 않고, 작업 문서 2절이 `sort`·`awk`를 새로 들이지 않는
   편이 PowerShell 이식에 싸다고 정했다.
4. **`depends_on` 미배선은 그대로 TASK-060이다.** 이번 작업이 `WorkflowInput`을 건드렸지만 선언은
   싣지 않았다 — 범위 밖이다. 모듈 머리 주석의 승계처를 "SPEC-018 R5"에서 "TASK-060"으로 갱신했다.
5. **우선순위는 판정에 넣지 않았다.** R3이 요구하는 선택 순서는 계약 문서 몫이고 TASK-059다. 스크립트와
   앱은 "있다/없다"만 답한다.

## 사용자 QA 제안

1. 앱을 열어 `.workflow/rules/wf-eligible.sh`가 `# condition_script_version: 4`로 갱신되는지 본다.
2. 임시 프로젝트에 후속 없는 `revision_requested` 결정 하나만 두고 기획자 대기 표시가 켜지는지,
   그 결정 id를 `source_decision_id`로 갖는 기획서를 만들면 꺼지는지 본다.
3. 같은 상태에서 `sh .workflow/rules/wf-eligible.sh planner`의 종료 코드가 화면 표시와 일치하는지 본다.
4. 개발 작업 QA 반려를 한 번 기록하고 기획자 대기가 켜지지 않는지 확인한다. 이 저장소의 QA 결정 27건은
   전부 `confirmed`라 실제 반려는 이 확인에서 처음 생긴다.
