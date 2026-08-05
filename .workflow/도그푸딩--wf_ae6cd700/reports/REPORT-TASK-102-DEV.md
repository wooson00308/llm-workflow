# TASK-102 개발자 핸드오프

- 대상: TASK-102 (세 계약이 겹침 선언을 쓰고 지목하게 하고 rules_version을 올린다)
- 근거: SPEC-032 R4·R5, 완료 조건 9·10·15,
  DECISION-0D79A7F0 (`outcome: approved`, `created_by: user`, `spec_id: SPEC-032`,
  2026-08-04T13:18:02Z — 직접 확인. SPEC-032의 결정 문서는 이 1건뿐이라 더 늦은 결정이 없다)
- 역할: 개발자 (developer-claude)
- 선점: `acquire TASK-102 developer-claude 30` exit 0 → `lease-1143-20260804175226` →
  `in_progress`(2026-08-04T17:52:30Z) → 구현 → 검증 → `qa_waiting`. 중간에 `renew ... 40` exit 0 1회.

## 선행 확인

`depends_on: [TASK-098, TASK-101]`.

- TASK-098 `completed`, TASK-101 `qa_waiting` — 둘 다 충족.
- 착수 시점 `.workflow/.runtime/leases/`에는 만료된 `SPEC-009.yml`(`expires_at`
  2026-08-03T01:20:00Z) 하나뿐이었고 TASK-102를 덮는 리스는 없었다.
- 착수 시점 `todo`는 TASK-102·103·104·105·106·107·108·109 8건이고, 선행이 충족된 것은
  TASK-102·103·104·105·107 5건이었다. `sh .workflow/rules/wf-eligible.sh developer` → `eligible`,
  exit 0.
- 이 저장소의 작업에는 아직 `scope_files`가 하나도 없다(소급 기입은 기획서 제외 범위). 겹침 판정이
  개입할 자리가 없었고, 실제로 착수 시점 활성 lease도 0건이었다.

## 착수 시점에 읽은 값 (완료 조건 5의 기준선)

| 값 | 착수 시점 | 착지 후 |
| --- | --- | --- |
| `WORKFLOW_RULES_VERSION` (`project_instructions.rs:21`) | 9 | 10 |
| `WORKFLOW_RULES` 프론트매터 `rules_version` | 9 | 10 |
| `ARCHITECT_RULES` 프론트매터 `rules_version` | 4 | 5 |
| `DEVELOPER_RULES` 프론트매터 `rules_version` | 4 | 5 |
| `PLANNER_RULES` 프론트매터 `rules_version` | 5 | 5 (손대지 않았다) |
| `ROLE_RULES_VERSION` (`project_instructions.rs:24`) | 5 | **5 (올리지 않았다 — 아래 참조)** |
| 설치본 `.workflow/rules/workflow.md` 버전 줄 | 9 | 9 (손대지 않았다) |
| 설치본 `.workflow/rules/roles/architect.md`·`developer.md` | 4 | 4 (손대지 않았다) |
| `cargo test` 개수 | 427 | 428 (+1, 새 테스트 하나) |

설치본 `.workflow/rules/*.md`는 앱이 설치 경로로 덮어쓰는 산출물이라 손대지 않았다. 작업 문서가
예고한 상수/설치본 불일치는 그대로 남아 있고, 앱이 다음 설치에서 따라 올린다.

## `ROLE_RULES_VERSION`을 올리지 않은 이유 (작업 문서의 두 요구가 충돌한다)

작업 문서 "버전 축" 절이 서로 성립할 수 없는 두 가지를 요구한다.

- (가) "`ROLE_RULES_VERSION`과 문언을 고친 두 계약의 `rules_version`이 착수 시점 값 +1로 오른다."
  → `ROLE_RULES_VERSION` 5→6, 아키텍트·개발자 4→5.
- (나) "`ROLE_RULES_VERSION`이 세 계약 `rules_version`의 최댓값이라는 관계가 깨지지 않게 한다(`:24`
  주석)." → 착지 후 세 계약은 planner 5·architect 5·developer 5이므로 최댓값은 **5**다.

(가)를 그대로 따르면 상수 6, 최댓값 5가 되어 (나)가 깨진다. **(나)를 택했다.** 근거는 그 상수가
실제로 하는 일이다. `plan_rules_file`(`:497`)은 설치된 파일의 버전이 이 값보다 **클 때만** 거부한다.
즉 이 상수는 "미래 버전 파일을 이 앱이 덮어쓰지 못하게 막는 천장"이고, 계약 문언을 올리는 데는
필요하지 않다 — 내용이 다르면 버전이 같아도 다시 쓴다(`:500`~`:504`).

- 5로 두었을 때의 손해: 없다. 아키텍트·개발자 계약(버전 5)은 그대로 설치·갱신된다. 이번 검증에서
  `upgrades_managed_v1_rules_and_installs_role_contracts` 등 설치 경로 테스트가 전부 통과한다.
- 6으로 올렸을 때의 손해: 있다. 버전 6짜리 역할 계약을 설치한 미래 앱의 상태를 이 앱이 조용히
  버전 5 내용으로 덮어쓰게 된다. `refuses_to_downgrade_future_managed_rules`가 지키려는 바로 그
  성질이 역할 계약 쪽에서 한 칸 약해진다.

**핸드오프:** 이 충돌은 작업 문서(아키텍트 산출물)의 문제이지 구현 판단으로 덮을 문제가 아니다.
완료 조건 5의 "세 버전 상수가 함께 +1" 문구는 위 이유로 `ROLE_RULES_VERSION`에 대해서만 충족되지
않았다. 사용자 QA에서 (가)를 강제하기로 하면 상수만 6으로 올리면 되고, 그때는 `:22`~`:23` 주석의
"최댓값" 문언도 함께 고쳐야 한다(그 편집은 이 작업의 범위 밖이라 하지 않았다).

## 한 것 — `src-tauri/src/infrastructure/project_instructions.rs` 한 파일

### 공통 규칙 §6 "Preserve the file contract" (R1)

`history` 항목 바로 아래에 두 항목을 더했다. 담은 것은 작업 문서가 요구한 넷이다.

- 선택 필드, 프로젝트 루트 기준 상대 경로의 한 줄 흐름 시퀀스, `scope_files: [src/a.rs, src/b.ts]` 꼴.
- 열 0에서 시작하는 한 줄이고 같은 키가 두 번 나오지 않는다.
- 허용 문자는 `A-Za-z0-9`·`_`·`-`·`.`·`/`이고, 경로는 적힌 그대로 비교한다(정규화·글롭·디렉터리 접두
  일치·대소문자 접기 없음).
- 빈 목록은 "만지는 파일이 없다"이고 부재와 다르다. 그 밖의 표기는 판정 불가이고 안전한 쪽으로 기운다.

`depends_on`과의 차이도 한 문장으로 적었다 — "`depends_on` decides which task comes first;
`scope_files` decides which tasks must not be started at the same time."

### 아키텍트 계약 "Split for parallel safety" (R5)

- `Write \`scope_files\` on every task you create.` 항목을 더하고, 왜 순서 규칙만으로는 부족한지를
  한 문장으로 적었다(나중에 분해되는 세션은 아직 없는 작업을 지목할 수 없다).
- **`depends_on` 순서 항목은 그대로 남겼다.** "The two devices do not replace each other" 항목이 그
  관계를 명시한다.
- 산문 범위 절 요구(`Record the files and modules a task touches in its scope section`)도 남기고,
  "어긋나면 판정이 이긴다"를 그 문장에 붙였다.
- 좁게/넓게 적었을 때의 비용을 한 항목으로 적었다.

### 개발자 계약 (R4)

- 자격 조건의 `No unexpired lease may cover overlapping work.` → `No unexpired lease may cover work
  that overlaps the task's \`scope_files\`. "Overlapping work" below is that judgement.`
- "Satisfied dependencies" 절 다음에 `## Overlapping work` 절을 새로 두었다.
- 겹치는 작업만 남으면 파일을 바꾸지 않고 `NO_ELIGIBLE_WORK`를 보고하고 `blocked`로 옮기지 않는다는
  것을, 선행 미충족 문단과 같은 어법으로 적었다.

### 테스트

- `records_the_scope_files_declaration_in_the_installed_rules` 하나를 더했다. 공통 규칙 §6 문언·
  아키텍트 두 문언(새 요구 + 남아 있는 `depends_on` 순서 항목)·개발자 겹침 절 문언·기획자 계약에
  `scope_files`가 없다는 것·`WORKFLOW_RULES_VERSION`·`ROLE_RULES_VERSION`을 단언한다.
- 기존 테스트에서 버전 리터럴만 갱신했다: `rules_version: 9`→`10` 7곳, 아키텍트·개발자
  `rules_version: 4`→`5` 각 4곳. **단언을 지우거나 약화한 곳은 없고 `#[ignore]` 신규 0건이다.**
  옛 버전을 픽스처로 쓰는 자리(1·2·3·4·999)는 그대로 두었다.

## 완료 조건 4 — 계약 문언과 TASK-101 구현을 나란히 놓는다

판정 규칙은 `fs_project_repository.rs`의 `overlap_block`(`:1597`~`:1631`)이 구현이고, 계약은 그것을
읽고 옮겼다. 새로 설계한 규칙은 없다.

| # | 구현 (`overlap_block`) | 개발자 계약 `## Overlapping work` |
| --- | --- | --- |
| 자기 lease | `if target == task_id { return None; }` | "an unexpired lease exists whose target is some other document" / "A lease on the task itself is not overlap; the eligibility rule above already excludes that task." |
| 내 선언 부재·오류 | `let Some(TaskNode { scope: Declared(mine), .. }) = graph.get(task_id) else { return Some(Vec::new()) };` (lease가 무엇을 잡았는지 보지 않는다) | "the task's own declaration is missing or malformed, whatever that lease holds" |
| lease 대상이 작업이 아님 | `let other = graph.get(target)?;` (`None` → 막지 않음) | "When the lease holds something that is not a task document and this task's declaration is readable, there is no declaration to compare against and the task stays open." |
| 상대 선언 부재·오류 | `let Declared(theirs) = &other.scope else { return Some(Vec::new()) };` | "the lease's target is a task document whose declaration is missing or malformed" |
| 겹침 | 문자열 완전 일치 교집합이 비어 있지 않으면 `Some(shared)` | "the two declarations name at least one identical path" |
| 만료 | `overlap_blocked_task_ids`가 받는 `lease_target_ids`가 미만료 lease 대상 집합이다(`lease_ids`) | "Only unexpired leases count, judged for expiry exactly as `.workflow/rules/workflow.md` §4 describes" |
| 상대 상태 | `other.status`를 읽지 않는다 | "the status of the task the lease holds does not matter — expiry is the only thing that releases it" |
| 빈 목록 | `Declared(Vec::new())`은 교집합이 비어 `None` | "An empty `scope_files` list means the task touches no files and overlaps with nothing."(공통 규칙 §6) |
| 파일 쓰기 | 판정 경로에 쓰기가 없다 | "The judgement only reads lease files. Never create, edit, or delete one to change its outcome." |

## 검증

- `cargo test --manifest-path src-tauri/Cargo.toml` → **428 passed / 0 failed / 0 ignored**.
- `npm run check` → vitest **524 passed / 20 files**, `tsc -b` + `vite build` 성공.
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` → 차이 없음.
- 모듈 단독: `cargo test ... project_instructions` → 15 passed(새 테스트 포함).
- 착수 전/후 조건 스크립트: `sh .workflow/rules/wf-eligible.sh developer` → 착수 전 `eligible` exit 0,
  착지 후에도 같다(TASK-103·104·105·107이 남아 있다). 이 작업은 판정 코드를 만지지 않았다.

### 변경 파일 (완료 조건 7)

세션 착수 시각 이후로 mtime이 바뀐 소스 파일은 `src-tauri/src/infrastructure/project_instructions.rs`
하나다(`find src-tauri/src src -newermt ...`로 확인). `heartbeat_condition.rs`·`role_eligibility.rs`·
`fs_project_repository.rs`·프론트엔드·설치본은 손대지 않았다. `cargo fmt`는 크레이트 전체를 돌지만
다른 파일을 바꾸지 않았다(같은 확인). 이 저장소는 여러 세션의 미커밋 변경이 겹쳐 있으므로
"`git diff`가 비어 있다"는 쓰지 않았다.

## 남은 리스크 / 후속

1. **`ROLE_RULES_VERSION` 충돌**(위 절). 사용자 QA의 판단이 필요한 유일한 항목이다.
2. 설치본과 상수의 버전 차이가 한 칸 더 벌어졌다(설치본 workflow.md 9 / 상수 10, 역할 계약 4 / 상수 5).
   앱이 다음 설치에서 따라 올리는 종류의 차이이고 이 작업의 범위가 아니다. 다만 **이 저장소에서 도는
   에이전트 세션은 앱이 재설치할 때까지 새 문언을 보지 못한다** — 겹침 조항이 실제로 세션 선택에
   반영되는 시점이 그때다.
3. 계약이 요구하는 `scope_files`를 아키텍트가 빠뜨렸을 때를 잡는 자동 검사는 없다. 작업 문서가
   범위 밖으로 잘랐고 후속 아이디어 감이다.
4. SPEC-032 완료 조건 11(화면)은 TASK-103이 닫는다. 이 작업은 payload도 화면도 만지지 않았다.
