---
schema: workflow-labs/task@1
id: TASK-040
title: 조건 스크립트의 개발자 자격 판정이 선행 선언을 확인하게 한다
status: verified
source_spec_id: SPEC-013
source_decision_id: DECISION-73D4BC1B
updated_at: 2026-08-14T09:08:07.880257+00:00
history:
- at: 2026-08-03T05:05:00Z
  kind: created
- at: 2026-08-03T09:06:00Z
  kind: in_progress
- at: 2026-08-03T09:27:00Z
  kind: qa_waiting
- at: 2026-08-14T09:08:07.880257+00:00
  kind: migrated_verified
work_group_id: GROUP-DECISION-73D4BC1B
work_group_revision: 1
---

# 조건 스크립트의 개발자 자격 판정이 선행 선언을 확인하게 한다

SPEC-013 R3의 조건 스크립트 몫을 구현한다. 지금 `developer` 분기는 `^status: todo` 여부와 lease 파일
존재만 보고 자격 있음으로 응답한다. 그래서 선행 작업이 아직 `todo`인데도 개발자 잡이 돌고, 세션이
문서를 읽고 나서야 순서가 아니라는 것을 알게 된다. 그 tick은 실행 한도를 한 번 깎고 아무것도 만들지
않는다.

판정 규칙은 이 작업이 새로 정하는 것이 아니다. **TASK-037의 "2. 판정 규칙" 절이 R2의 단일 정의이고,
이 작업은 그것을 POSIX sh로 옮긴다.** 두 구현이 갈리면 화면과 실행이 서로 다른 말을 한다(R2 마지막
줄). 옮기기 전에 그 절을 먼저 읽는다.

## 의존성

- 선행 작업 없음.
- TASK-037과 같은 규칙을 서로 다른 언어로 구현한다. 코드가 겹치지 않으므로 순서 제약을 두지 않았다.
  어느 쪽이 먼저 가든 판정 규칙은 TASK-037 문서의 그 절 하나다.
- **`heartbeat_condition.rs`를 만지는 다른 `todo` 작업은 없다.** TASK-039는 새 모듈을 만들고 이 파일을
  건드리지 않는다.
- **TASK-029(SPEC-009)와의 관계는 아래 "1. 먼저 확인할 저장소 상태"를 읽는다.** 그 작업이 먼저
  반영됐는지에 따라 이 작업의 범위가 달라진다.

## 범위

- `src-tauri/src/infrastructure/heartbeat_condition.rs` — `CONDITION_SCRIPT` 본문의 `developer` 분기,
  `CONDITION_SCRIPT_VERSION`, 테스트.
- `scripts/wf-eligible.sh` — 같은 본문(관리 표기 두 줄 제외).
- 조건부: `src-tauri/src/infrastructure/role_eligibility.rs` — TASK-029가 이미 반영됐을 때만. 1절 참조.
- 그 외 파일은 건드리지 않는다. 특히 `project_instructions.rs`·`fs_project_repository.rs`·
  `domain/project.rs`·화면·`docs/file-contract.md`는 이 작업에서 바뀌지 않는다.

## 작업 내용

### 1. 먼저 확인할 저장소 상태

`src-tauri/src/infrastructure/role_eligibility.rs`가 있는지 본다. TASK-029(SPEC-009)가 만드는 파일이고,
앱 안에서 조건 스크립트와 같은 판정을 하고 그 동치를 테스트로 고정한다.

- **없으면** 이 작업의 범위는 위 목록 그대로다. TASK-029를 대신 구현하지 않는다.
- **있으면** 그 모듈의 `developer` 규칙과 동치 테스트를 이 작업에서 함께 고친다. 스크립트만 고치면
  그 동치 테스트가 깨지고, 기획서 완료 조건 18(기존 테스트를 삭제·비활성화하지 않는다)과 29를 만족할
  수 없다. DECISION-73D4BC1B가 이 재작업을 수용한다고 명시했다. 이때 앱 쪽 규칙도 TASK-037의 판정
  규칙 절을 따른다.

확정된 결정 4번은 이 기획서를 SPEC-009보다 먼저 구현하기를 요구한다. 그 순서를 기계적으로 강제할
수는 없다 — 선행 선언을 판정하는 새 스크립트 자체가 이 기획서의 산출물이라, TASK-028~031은 그 전에
구현될 수 있다. 그래서 순서 대신 위 분기를 남긴다.

### 2. 판정 규칙을 sh로 옮긴다

`developer` 분기가 지금 보는 두 조건(`^status: todo`, lease 파일 부재)에 셋째 조건을 더한다. 나머지
분기(`planner`·`architect`)와 마이그레이션 락 처리, 사용법 오류는 한 글자도 바꾸지 않는다(R3).

선언 파싱은 TASK-037의 "1. 선언 파싱" 절과 같은 일곱 규칙이다.

```sh
  # 프론트매터의 한 줄 선언을 읽어 표준 출력에 공백으로 구분한 id 목록을 낸다.
  # 반환값 1은 "키는 있는데 계약 형식이 아니다"이고, 그 작업은 미충족이다.
  deps_of() { # $1=작업 파일
    count=$(grep -c '^depends_on:' "$1" 2>/dev/null || echo 0)
    [ "$count" -eq 0 ] && return 0
    [ "$count" -gt 1 ] && return 1
    value=$(sed -n 's/^depends_on:[[:space:]]*//p' "$1" | head -1)
    ...
  }
```

- 값이 비어 있으면 형식 오류다. 블록 표기가 여기서 걸린다.
- 값이 `[`로 시작해 `]`로 끝나지 않으면 형식 오류다.
- 대괄호 안쪽을 `,`로 나누고 각 토큰을 다듬는다. 전부 비어 있으면 선행 없음이다.
- 토큰이 `[A-Za-z0-9_-]`만으로 이루어지지 않으면 형식 오류다. 따옴표 표기도 여기서 걸린다. 이 검사는
  안전 장치이기도 하다 — 토큰이 곧 `grep` 패턴이 되므로 정규식 문자가 들어오면 안 된다.

상태 판정과 순환 판정도 TASK-037의 규칙 그대로다.

```sh
  # 선행 작업 문서를 문서 id로 찾는다. 없으면 미충족이다.
  task_file() { grep -ls "^id: *$2\$" "$1"tasks/*.md 2>/dev/null | head -1; }
```

- 선행 문서가 없으면 미충족이다.
- 선행 문서의 상태가 `^status: qa_waiting` 또는 `^status: completed`가 아니면 미충족이다.
- 선언을 따라 지금 작업으로 돌아오는 경로가 있으면 상태와 무관하게 미충족이다.

순환은 방문 집합을 둔 너비 우선 확장으로 본다. 재귀 없이 목록 변수 둘로 끝난다.

```sh
  # $2에서 선언을 따라가 $3에 닿는가. 방문 집합이 종료를 보장한다.
  reaches() { # $1=워크플로우 경로 $2=출발 id $3=목표 id
    visited=" "
    frontier="$2"
    while [ -n "$frontier" ]; do
      next=""
      for node in $frontier; do
        case "$visited" in *" $node "*) continue ;; esac
        visited="$visited$node "
        [ "$node" = "$3" ] && return 0
        f=$(task_file "$1" "$node")
        [ -n "$f" ] || continue
        next="$next $(deps_of "$f" || true)"
      done
      frontier="$next"
    done
    return 1
  }
```

형식 오류인 선언은 나가는 간선이 없는 것으로 다룬다. 그 작업 자신이 미충족일 뿐, 그 작업에 기대는
작업의 판정을 바꾸지 않는다(TASK-037의 규칙과 같다).

**작업량은 문서 수의 제곱에 비례한다.** 지금 이 워크플로우의 작업이 41건이고 선언은 거의 없다. 선언이
없으면 첫 검사에서 끝나므로 실제 비용은 문서 수만큼의 `grep` 한 번이다. 최적화를 위해 판정을 줄이지
않는다 — 판정이 갈리는 것이 tick 하나보다 비싸다.

### 3. 버전과 사본

- `CONDITION_SCRIPT_VERSION`을 1에서 2로 올리고, 본문의 `# condition_script_version:` 줄도 같이 올린다.
  둘이 어긋나면 설치본이 매번 다시 쓰인다.
- `scripts/wf-eligible.sh`를 같은 본문으로 맞춘다. 관리 표기 두 줄(`# managed_by:`,
  `# condition_script_version:`)만 빼고 나머지가 같아야 한다. 지금도 그 관계다.
- 설치·갱신 경로와 안전 규칙은 그대로 쓴다. 관리 마커가 없는 파일을 덮어쓰지 않고, 설치본 버전이 앱
  상수보다 크면 멈춘다(R3).
- 이 저장소의 설치본 `.workflow/rules/wf-eligible.sh`는 손으로 고치지 않는다. 앱 관리 자산이라 다음
  하트비트 설치에서 갱신된다.

### 4. 테스트

`heartbeat_condition.rs`의 테스트 모듈에 더한다. 기존 다섯 개의 설치 테스트와 네 개의 실행 테스트를
고치지 않는다 — 실행 테스트의 픽스처에는 선언이 없어 판정이 지금과 같다(완료 조건 9).

`run_condition`(`:294`)과 같은 헬퍼로 종료 코드를 본다.

- 선언이 없는 `todo` 작업만 있으면 0이다. 지금 동작과 같다.
- 선행이 `qa_waiting`인 `todo` 작업이 있으면 0이다. (완료 조건 7)
- 선행이 `completed`인 `todo` 작업이 있으면 0이다. (완료 조건 7)
- 선행이 `todo`인 작업만 있으면 1이다. (완료 조건 6)
- 선행이 `in_progress`인 작업만, `blocked`인 작업만 있는 경우도 각각 1이다. (완료 조건 6)
- 둘을 선언했고 하나만 `completed`면 1이다.
- 없는 id를 선언한 작업만 있으면 1이다.
- 자기 자신을 선언한 작업만 있으면 1이고 스크립트가 끝난다.
- 두 작업이 서로를 선언하면 1이고 스크립트가 끝난다.
- 선행이 `completed`인데 그 선행이 이 작업을 선언하면 1이다. 순환이 상태 판정보다 앞선다.
- 블록 표기, 값 없는 키, 닫히지 않은 대괄호, 따옴표로 감싼 id를 선언한 작업만 있으면 각각 1이다.
- 빈 목록 표기는 선행 없음과 같아 0이다.
- 의존이 충족됐어도 그 작업 id로 된 lease 파일이 있으면 그 작업은 대상에서 제외된다. 다른 대상이
  없으면 1이다. (완료 조건 8)
- 만료된 lease 파일도 그 대상을 막는다. 스크립트는 만료를 보지 않는다. 지금 동작과 같다.
- 자격 있는 작업과 자격 없는 작업이 섞여 있으면 0이다. 하나라도 있으면 자격 있음이다.
- 선언한 선행이 다른 워크플로우에 있으면 미충족이다. 판정 범위는 워크플로우 안이다.
- 선언을 가진 작업이 있어도 `planner`·`architect` 판정이 이 변경 전후로 같다. (완료 조건 9)
- 마이그레이션 락이 있으면 `developer`가 1이다. 기존 테스트가 그대로 통과한다. (완료 조건 9)

버전(완료 조건 10)은 기존 테스트가 이미 형태를 잡아 두었다. 마커·버전 문자열 단정
(`installs_condition_script_with_managed_markers`, `:199`)의 기대값을 새 버전으로 고치고,
`refuses_to_downgrade_a_future_script`(`:244`)와 `refuses_to_overwrite_an_unmanaged_script`(`:229`),
`rewrites_a_managed_script_that_drifted`(`:278`)는 그대로 둔다. 여기에 하나를 더한다.

- 이전 버전(`condition_script_version: 1`)으로 설치된 관리본이 새 본문으로 갱신된다. (완료 조건 10)

### 5. 저장소 자체 대조

이 저장소에서 세 역할의 종료 코드를 확인한다. 이 작업 뒤에도 `developer`가 0이어야 한다 — 지금
`todo`인 작업 중 선언이 없는 것이 여럿이다.

```sh
sh .workflow/rules/wf-eligible.sh developer; echo "developer=$?"
sh scripts/wf-eligible.sh developer; echo "repo=$?"
```

두 값이 같아야 한다. `.workflow/rules/wf-eligible.sh`는 앱이 설치한 사본이라 이 작업 시점에는 아직 옛
본문일 수 있다. 그때는 `scripts/wf-eligible.sh`의 값이 새 판정이고, 설치본은 다음 하트비트 설치에서
따라온다.

**주의.** 스크립트의 `grep`은 파일 아무 곳이나 본다. 작업 문서 본문에 열 0으로 적힌 `depends_on:`이
있으면 실제 선언으로 잡힌다. `tasks/TASK-022.md` 본문의 프론트매터 예시가 이미 같은 사례를 만들고
있다(REPORT-SPEC-008-ARCH의 핸드오프 노트). 대조 값이 어긋나면 이 원인부터 확인한다. 이 알려진 차이를
없애는 것은 이 작업의 범위가 아니다.

## 완료 조건

1. `todo` 작업이 있어도 전부 의존 미충족이면 `developer` 판정이 1이다. (기획서 완료 조건 6)
2. 의존이 충족된 `todo` 작업이 하나라도 있으면 `developer` 판정이 0이다. (기획서 완료 조건 7)
3. 의존이 충족되었어도 그 작업 id로 된 lease 파일이 있으면 그 작업은 대상에서 제외된다.
   (기획서 완료 조건 8)
4. 없는 id·자기 참조·순환·형식 오류를 선언한 작업이 미충족으로 판정되고, 순환에서 스크립트가 끝난다.
   (기획서 완료 조건 3·4·5의 스크립트 몫)
5. `planner`·`architect` 판정 결과가 이 변경 전후로 같고, 기존 조건 스크립트 테스트가 수정 없이
   통과한다. (기획서 완료 조건 9)
6. 조건 스크립트 버전이 올라가고 기존 설치본이 새 버전으로 갱신되며, 관리 마커가 없는 파일은 덮어쓰지
   않고 설치본이 앱보다 새 버전이면 멈춘다. (기획서 완료 조건 10)
7. `scripts/wf-eligible.sh`와 앱 내장 본문이 관리 표기 두 줄을 제외하고 같다.
8. `role_eligibility.rs`가 이미 있으면 그 모듈의 `developer` 규칙과 동치 테스트가 새 규칙으로
   동기화되어 통과한다. 없으면 이 항목은 해당 없음이다.
9. 기존 Rust·프런트엔드 테스트가 수정 없이 통과한다. 삭제·비활성화된 테스트가 없다.
   (기획서 완료 조건 18)
10. `cargo fmt --check`·`cargo clippy -D warnings`·`cargo test`와 `npm run check`가 통과한다.
    (기획서 완료 조건 29)

## 검증 절차

```sh
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
npm run check
sh scripts/wf-eligible.sh planner; echo "planner=$?"
sh scripts/wf-eligible.sh architect; echo "architect=$?"
sh scripts/wf-eligible.sh developer; echo "developer=$?"
```

## 범위 밖

- `planner`·`architect` 분기의 판정 변경(R3).
- 앱 안의 판정과 payload. 작업 상세의 선행 표시는 TASK-037이고, 역할별 대기 물량은 TASK-029다.
- 역할 계약·공통 규칙·`docs/file-contract.md`의 계약 문구. TASK-041이다.
- 조건 스크립트가 `grep`으로 본문까지 보는 알려진 차이를 없애는 것.
- 등록되지 않은 `.workflow/` 하위 디렉터리를 판정 대상에서 빼는 것.
- 선점 헬퍼. TASK-039다.
- 하트비트 저장소의 잡 설정, 동시 실행 허용, 동시 세션 수(기획서 제외 범위).

## 참고 사실

확인 시점 2026-08-03. 추정 없이 파일에서 읽은 값이다.

- 앱이 설치하는 본문은 `heartbeat_condition.rs:24`의 `CONDITION_SCRIPT` 상수다. `developer` 분기는
  `:65`~`:77`이고, 지금 보는 것은 `^status: todo`와 `[ -f "$leases/$tid.yml" ]` 둘뿐이다.
- 저장소 사본 `scripts/wf-eligible.sh`는 관리 표기 두 줄을 제외하고 상수와 같다.
- `CONDITION_SCRIPT_VERSION`은 `:18`의 1이고 본문 셋째 줄과 같아야 한다. 판정은 `plan_condition_script`
  (`:127`)가 한다.
- 실행 테스트 넷은 `#[cfg(unix)]`이고 헬퍼는 `run_condition`(`:294`)이다.
- 하트비트 데몬이 잡의 조건으로 이 스크립트를 부르고 종료 코드로 깨어날지를 정한다.
- 이 워크플로우의 작업 41건 중 선행 선언을 가진 것은 SPEC-013에서 나온 TASK-038·TASK-039 둘이다.
  나머지는 선언이 없어 이 변경 뒤에도 판정이 지금과 같다.
- 확정된 결정 3번이 기존 작업의 산문 의존을 새 필드로 옮기지 않기로 했다. 그래서 이 변경 뒤에도
  TASK-028~036 사이의 순서는 스크립트가 보지 못한다. 지금과 같은 수준이지 나빠지는 것은 아니다.
