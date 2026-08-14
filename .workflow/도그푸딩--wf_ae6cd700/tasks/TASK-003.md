---
schema: workflow-labs/task@1
id: TASK-003
title: 조건 스크립트를 앱 관리 자산으로 설치하는 모듈 추가
status: verified
source_spec_id: SPEC-002
source_decision_id: DECISION-1265B3C7
updated_at: 2026-08-14T09:08:07.880257+00:00
history:
- at: 2026-08-14T09:08:07.880257+00:00
  kind: migrated_verified
work_group_id: GROUP-DECISION-1265B3C7
work_group_revision: 1
---

# 조건 스크립트를 앱 관리 자산으로 설치하는 모듈 추가

SPEC-002의 R4를 구현한다. 역할 조건 스크립트를 `.workflow/rules/` 아래 앱 관리 자산으로 설치하는 Rust 모듈과 테스트를 만든다. UI는 붙이지 않는다.

## 의존성

- 선행 작업 없음. 다른 SPEC-002 작업과 파일이 겹치지 않으므로 TASK-004와 병렬로 진행해도 된다.
- 이 작업의 산출물은 TASK-007의 설치 액션이 호출한다.

## 범위

- 신규 파일 `src-tauri/src/infrastructure/heartbeat_condition.rs` 1개.
- `src-tauri/src/infrastructure/mod.rs`에 모듈 선언 1줄 추가.
- 그 외 파일은 건드리지 않는다. Tauri 커맨드 등록과 호출은 TASK-007 담당이다.

## 작업 내용

### 1. 설치 대상과 경로

- 설치 경로는 프로젝트 컨트롤 루트 기준 `rules/wf-eligible.sh`다. 즉 프로젝트 루트에서 보면 `.workflow/rules/wf-eligible.sh`다.
- 함수는 컨트롤 루트를 인자로 받는다. 실제 경로 계산은 호출자가 한다. 테스트가 임시 디렉터리에서 돌 수 있어야 하므로 경로를 모듈 안에 하드코딩하지 않는다.
- 공개 API는 최소 두 개다. 설치를 수행하는 함수 하나와, 쓰기 없이 같은 판정만 하는 검사 함수 하나. `project_instructions.rs`의 `install_project_instructions` / `validate_project_instructions` 쌍과 같은 구조를 따른다.

### 2. 스크립트 본문 (R4)

- 판정 로직은 현재 `scripts/wf-eligible.sh`와 **완전히 동일**하다. 인자 `planner` | `architect` | `developer`, 종료 코드 `0`(대상 있음) / `1`(없음) / `2`(잘못된 사용법), `.workflow/.runtime/migration.lock`이 있으면 역할과 무관하게 `1`.
- 원본 `scripts/wf-eligible.sh`를 읽어 본문을 그대로 옮긴다. 로직을 개선하거나 정리하지 않는다. 기획서가 "현재 동작을 그대로 옮긴다"를 제외 범위로 명시했다.
- 본문은 `project_instructions.rs`의 규칙 문서들처럼 `const` 문자열 리터럴로 모듈 안에 둔다. 빌드 시점에 원본 파일을 읽어 오는 방식(`include_str!`)은 쓰지 않는다. 앱 설치본이 단일 원본이고 `scripts/wf-eligible.sh`는 이번 범위에서 정리하지 않기로 승인됐으므로, 두 파일을 빌드 의존으로 묶으면 나중에 원본을 지울 수 없다.
- 스크립트 첫머리 주석에 앱 관리 표기와 버전 표기를 넣는다. 형식은 다음 두 줄을 그대로 쓴다. 파싱 대상이므로 문구를 임의로 바꾸지 않는다.

```sh
# managed_by: workflow-labs
# condition_script_version: 1
```

- 두 줄은 `#!/bin/sh` 바로 다음에 온다. `sh`는 `#` 시작 줄을 주석으로 처리하므로 실행 동작에 영향이 없다.

### 3. 설치 판정 (R4)

`project_instructions.rs`의 `plan_rules_file`과 같은 판정 순서를 따른다. 그 함수를 재사용해도 되고 같은 규칙으로 새로 써도 된다. 판정 결과는 아래 넷 중 하나다.

1. 파일이 없으면 설치한다.
2. 파일이 있고 `managed_by: workflow-labs` 표기가 없으면 덮어쓰지 않고 실패한다.
3. 파일이 있고 `condition_script_version` 값이 앱이 아는 버전보다 크면 덮어쓰지 않고 실패한다(다운그레이드 거부).
4. 그 외에는 앱 버전 본문으로 맞춘다. 내용이 이미 같으면 파일을 쓰지 않는다.

- `condition_script_version` 줄이 없거나 정수로 파싱되지 않으면 2번과 같이 실패로 처리한다.
- 대상 경로가 일반 파일이 아니면(심볼릭 링크·디렉터리) 실패한다. `project_instructions.rs`의 `ensure_regular_file`과 같은 처리다.
- 실패할 때 기존 파일은 바이트 단위로 그대로 남아야 한다. 판정을 먼저 다 끝내고 그다음에 쓰는 순서를 지킨다.
- 오류 타입은 `ProjectInstructionError`를 재사용하거나 같은 형태의 전용 오류 타입을 새로 정의한다. 사용자에게 보이는 문구는 한국어로 쓰고 충돌한 경로를 포함한다.

### 4. 쓰기 방식과 파일 모드

- 쓰기는 `write_text_atomically`와 같은 방식(같은 디렉터리 임시 파일 → `sync_all` → `persist`)을 쓴다. 쓰기 도중 실패해도 원본이 반쯤 덮이지 않아야 한다.
- 실행 권한은 부여하지 않는다. 잡의 `condition`은 `sh <경로> <역할>` 형태로 호출하므로 실행 비트가 필요 없다. 이 저장소의 `scripts/wf-eligible.sh`도 `644`다.
- 부모 디렉터리가 없으면 만든다.

### 5. 테스트

`src-tauri` 모듈 안 `#[cfg(test)] mod tests`에 작성한다. `tempfile::tempdir`를 쓰는 기존 테스트 방식을 따른다.

- 빈 컨트롤 루트에 설치하면 파일이 생기고 관리 표기·버전 표기가 들어 있다.
- 두 번 설치해도 파일 내용이 변하지 않는다(멱등).
- 관리 표기가 없는 파일이 그 경로에 있으면 실패하고 그 파일이 변경되지 않는다.
- 버전이 앱보다 높은 파일이 있으면 실패하고 그 파일이 변경되지 않는다.
- 설치된 스크립트를 실제로 실행해 인자별 종료 코드가 `0`/`1`/`2`로 나오는지 확인한다. 임시 디렉터리에 `.workflow/<이름>/decisions/`·`tasks/` 같은 최소 구조를 만들어 대상 있음/없음을 각각 재현하고, 잘못된 인자에 `2`가 나오는지 확인한다. 스크립트는 상대 경로를 쓰므로 `std::process::Command`의 `current_dir`을 임시 프로젝트 루트로 지정한다.
- 실행 테스트는 `#[cfg(unix)]`로 제한한다. Windows에는 기본 `sh`가 없고, 기획서 `확인 필요` 2번의 승인 내용대로 이번 범위는 POSIX `sh` 하나뿐이다.

## 완료 조건

1. `.workflow/rules/wf-eligible.sh` 설치·판정·거부를 수행하는 모듈이 존재하고 `mod.rs`에 등록되어 있다.
2. 설치된 스크립트의 인자 3종과 종료 코드 `0`/`1`/`2`가 현재 `scripts/wf-eligible.sh`와 같다. (기획서 완료 조건 6)
3. 관리 표기가 없는 파일과 더 높은 버전 파일에 대해 설치가 실패하고 원본이 변경되지 않는 자동화 테스트가 있고 통과한다. (기획서 완료 조건 7)
4. 같은 설치를 두 번 실행해도 파일이 변하지 않는다.
5. `scripts/wf-eligible.sh`, `docs/`, 프론트엔드(`src/`)에 변경이 없다.

## 검증 절차

```sh
cargo test --manifest-path src-tauri/Cargo.toml
```

- 새 모듈 테스트가 모두 통과해야 한다.

```sh
diff <(sed -e '/^# managed_by:/d' -e '/^# condition_script_version:/d' /tmp/installed-wf-eligible.sh) scripts/wf-eligible.sh
```

- 설치본을 임시 경로로 꺼내 관리 표기 두 줄을 뺀 나머지가 원본과 같은지 눈으로 대조한다. 테스트 안에서 같은 비교를 자동화해도 된다.

```sh
git status --short
```

- 변경이 `src-tauri/src/infrastructure/heartbeat_condition.rs`와 `src-tauri/src/infrastructure/mod.rs` 둘로 한정되는지 확인한다.

## 범위 밖

- 이 저장소의 `scripts/wf-eligible.sh` 제거·수정. 기획서 `확인 필요` 1번의 승인 내용대로 이번 범위에서 정리하지 않는다.
- `docs/heartbeat.md` 문구 수정. TASK-001의 산출물이며 아직 작성 전이다.
- 스크립트 판정 로직 개선. 알려진 공백(lease 만료 미확인, `planner`의 `revision_requested` 미감지, `architect`의 최신 결정 미확인)을 그대로 옮긴다.
- Tauri 커맨드 등록, UI 연결. TASK-007 담당이다.
- Windows용 조건 스크립트.

## 참고 사실

- `src-tauri/src/infrastructure/project_instructions.rs:336`의 `plan_rules_file`이 이 작업이 요구하는 판정(미설치 설치 / 비관리 파일 거부 / 다운그레이드 거부 / 그 외 갱신)을 이미 구현하고 있다. 같은 파일 `453`의 `write_text_atomically`가 원자적 쓰기다.
- 같은 파일 `556`·`609`의 테스트가 다운그레이드 거부와 비관리 파일 거부의 검증 형태를 보여 준다.
- 설치본이 원본이 되면 이 저장소에는 같은 스크립트가 두 벌 존재하게 된다. 기획서가 인지하고 승인한 상태이며, 정리는 별도 아이디어로 다룬다.
