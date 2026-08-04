# TASK-040 개발자 핸드오프

> 기록 경위: 세션 하네스가 보고서 파일 작성을 차단해, 세션이 채팅으로 보낸 전문을 TL이 그대로 기록했다.

- 대상 작업: TASK-040 (조건 스크립트의 개발자 자격 판정이 선행 선언을 확인하게 한다)
- 근거 문서: SPEC-013 R2·R3, DECISION-73D4BC1B (approved, created_by: user)
- 세션 역할: 개발자
- 작성 시각: 2026-08-03T09:35Z
- 상태: `qa_waiting`

## 대상 선정 근거

- TL이 배정한 단일 작업이다. 착수 시점(09:06Z) `status: todo`, 선행 선언 없음.
- `migration.lock` 없음. `leases/`에는 `SPEC-009.yml`(만료), `TASK-036`·`TASK-037`·`TASK-041`이
  있었고 `TASK-040.yml`은 없었다. 남의 lease는 건드리지 않았다.
- 소스 결정 DECISION-73D4BC1B은 `outcome: approved`, `created_by: user`로 유효하다.
- 선점: `leases/TASK-040.yml` 배타 생성(`set -C`) → 즉시 `status: in_progress` + `history` 기록 →
  구현 → `qa_waiting` → lease 반납.

## 변경한 파일

- `scripts/wf-eligible.sh` — `deps_of`·`task_file`·`dep_satisfied`·`reaches` 네 헬퍼를 더하고
  `developer` 분기에 셋째 조건(의존 충족)을 넣었다. `planner`·`architect` 분기와 마이그레이션 락
  처리, 사용법 오류는 한 글자도 바꾸지 않았다.
- `src-tauri/src/infrastructure/heartbeat_condition.rs` — `CONDITION_SCRIPT`를 같은 본문으로
  맞추고 `CONDITION_SCRIPT_VERSION`을 1→2로, 본문 셋째 줄 `# condition_script_version:`도 2로
  올렸다. 테스트 18개를 더했다.
- `src-tauri/src/infrastructure/role_eligibility.rs` — 모듈 문서에 알려진 차이 한 문단. 코드는
  바꾸지 않았다. 아래 "완료 조건 8 미충족과 승계" 참조.

설치본 `.workflow/rules/wf-eligible.sh`는 손대지 않았다(작업 문서 3절). 지금도
`condition_script_version: 1`이고 다음 하트비트 설치에서 앱이 갱신한다.

## 판정 규칙

TASK-037 "2. 판정 규칙" 절을 그대로 sh로 옮겼다. 새로 정한 규칙은 없다.

- 선언 파싱 일곱 규칙: 키 없음→선행 없음, 두 줄 이상→형식 오류, 값 비어 있음(블록 표기)→형식 오류,
  `[`로 시작해 `]`로 끝나지 않음→형식 오류, 토큰 전부 비어 있음→빈 목록, 토큰이 비었거나
  `[A-Za-z0-9_-]` 밖의 문자를 포함(따옴표 표기 포함)→형식 오류, 그 밖은 선언된 목록.
- 판정 순서는 `Missing` → `Cyclic` → 상태다. 순환이 상태보다 앞선다.
- `qa_waiting`·`completed`만 충족이고 계약에 없는 상태값도 미충족이다.
- 형식 오류인 선언은 나가는 간선이 없는 것으로 다룬다. 그 작업만 미충족이고 그 작업에 기대는
  작업의 판정은 바꾸지 않는다.
- 순환 탐색은 방문 집합을 둔 너비 우선 확장이라 재귀 없이 끝난다.

dev-037이 같은 시각에 넣은 Rust 구현(`fs_project_repository.rs:1206` `parse_dependency_declaration`,
`:1304` `dependency_state`, `:1326` `declaration_reaches`)과 규칙을 한 항목씩 대조했고 결론이 같다.
`[]]`·`[[TASK-002]]`·비ASCII 토큰·점이 든 토큰 같은 경계값도 양쪽 모두 형식 오류다.

## 검증 단계와 결과

```
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check                        통과
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings    통과
cargo test --manifest-path src-tauri/Cargo.toml                                   251 passed / 0 failed
npm run check                                                                     254 passed / 14 files, 빌드 성공
```

- `heartbeat_condition` 테스트는 9개에서 27개가 되었다(설치 5+2, 실행 4+16). 기존 9개는 한 글자도
  고치지 않았고 `installs_condition_script_with_managed_markers`의 버전 기대값만 1→2로 바꿨다
  (작업 문서 4절이 지정한 그 한 줄이다).
- `#[cfg(unix)]` 실행 테스트는 실제로 `sh`를 띄워 돈다. 새로 더한 16개 모두 실행됐다.
- `role_eligibility`의 동치 테스트 15개는 수정 없이 통과한다.
- 삭제하거나 `#[ignore]`를 붙인 테스트는 없다.

저장소 자체 대조:

```
sh .workflow/rules/wf-eligible.sh developer   → 0   (설치본, 아직 옛 본문)
sh scripts/wf-eligible.sh developer           → 0   (새 본문)
sh scripts/wf-eligible.sh planner             → 1
sh scripts/wf-eligible.sh architect           → 1
```

두 `developer` 값이 같다. 선언을 가진 `todo` 작업(TASK-042~054)은 대부분 미충족이지만, 선언이 없는
`todo` 작업이 여럿 남아 있어 판정이 0이다.

`architect`는 착수 시점 0이었다가 1이 됐다. 내 변경 때문이 아니다 — `git show HEAD:scripts/wf-eligible.sh`의
옛 본문을 같은 시점에 돌려도 1이고, `planner`·`architect` 분기는 옛 본문과 diff가 없다. 병렬 세션이
그 사이에 승인 결정을 참조하는 작업 문서를 만든 결과다.

`dash`·`bash`·`ksh`·`zsh`에서 같은 종료 코드를 확인했다. bash 전용 문법은 쓰지 않았다.

## 완료 조건 8 미충족과 승계

**작업 문서 완료 조건 8(`role_eligibility.rs` 동기화)을 채우지 못했다.** 코드는 바꾸지 않고 모듈
문서에 알려진 차이로만 남겼다.

- 이유: 앱의 개발자 판정을 새 규칙으로 맞추려면 각 작업의 `depends_on` 선언이 판정 입력에 들어와야
  하는데, `WorkflowInput`은 `items`(`WorkflowItemSummary`)와 승인 결정만 받고 `WorkflowItemSummary`는
  선언을 담지 않는다. TASK-037이 "목록 payload를 늘리지 않는다 — `WorkflowItemSummary`에 필드를
  더하지 않는다"를 명시 제약으로 두었다.
- 배선하려면 `fs_project_repository.rs`(`summary_from_manifest:673`의 `WorkflowInput` 리터럴과
  `task_dependency_graph:1245`의 가시성)와 `domain/project.rs`를 고쳐야 한다. 두 파일 모두 TASK-040
  문서가 "이 작업에서 바뀌지 않는다"로 못박았고, 같은 시각 dev-037이 두 파일을 작업 중이었다.
- **승계처: TL이 이 보고를 근거로 TASK-060을 파생했다(선행: TASK-056).** SPEC-018 분해가 이 배선을
  담지 않은 것이 확인되어 별도 작업으로 배정됐다.
- **작업 문서 1절의 전제가 낡았다.** "스크립트만 고치면 그 동치 테스트가 깨진다"고 보았는데 실제로는
  깨지지 않는다. 기존 동치 테스트 픽스처에 `depends_on`이 없어 스크립트와 앱의 결론이 그대로 같기
  때문이다. 즉 완료 조건 18(기존 테스트 삭제·비활성화 금지)과 29는 이 상태로도 만족한다.
- 남는 실제 차이: 의존이 미충족인 `todo` 작업만 남으면 스크립트는 1을, 앱은 `developer: true`를
  낸다. 화면의 역할별 대기 물량이 하트비트보다 낙관적으로 보인다.

## 리스크와 후속

- **위 동기화가 TASK-060으로 남는다.** `task_dependency_graph`를 `summary_from_manifest`까지 끌어와
  `WorkflowInput`에 실으면 끝나는 크기다.
- **스크립트의 `grep`은 파일 아무 곳이나 본다.** 앱은 프론트매터만 본다. 작업 문서 본문에 열 0으로
  적힌 `depends_on:` 줄이 생기면 스크립트만 그것을 선언으로 읽는다. 확인 시점 기준 이 워크플로우의
  `depends_on:` 14건은 모두 프론트매터(8번째 줄)이고 본문에는 없다. 이 차이를 없애는 것은 작업
  문서가 범위 밖으로 두었다.
- **설치본과 앱 본문이 어긋나면 매 설치마다 파일이 다시 쓰인다.** 그 사고를 막으려고
  `the_repository_copy_matches_the_managed_script` 테스트를 더했다. 저장소 사본과 앱 내장 본문이
  관리 표기 두 줄을 빼고 같은지 바이트 단위로 본다(완료 조건 7).
- **판정 비용은 문서 수의 제곱에 비례한다.** 선언이 없으면 첫 검사에서 끝나 실제 비용은 문서 수만큼의
  `grep` 한 번이다. 지금 이 워크플로우의 작업은 54건이고 선언은 14건이다.

## 사용자 QA 제안

1. 앱을 띄워 프로젝트를 열고 `.workflow/rules/wf-eligible.sh`의 셋째 줄이
   `# condition_script_version: 2`로 갱신되는지 본다.
2. 갱신 뒤 `sh .workflow/rules/wf-eligible.sh developer`와 `sh scripts/wf-eligible.sh developer`의
   종료 코드가 같은지 본다.
3. 선언이 미충족인 작업만 남겨 두고(다른 `todo`에 lease를 걸어 후보에서 빼면 된다) `developer`가
   1이 되는지 본다.
