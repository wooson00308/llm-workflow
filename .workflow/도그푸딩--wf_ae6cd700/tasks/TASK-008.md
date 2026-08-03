---
schema: workflow-labs/task@1
id: TASK-008
title: 관리 블록 엔진을 잡 종류에 독립적으로 만들고 dream 잡 정의 추가
status: completed
source_spec_id: SPEC-003
source_decision_id: DECISION-5276FDBF
updated_at: 2026-08-02T14:57:41Z
---

# 관리 블록 엔진을 잡 종류에 독립적으로 만들고 dream 잡 정의 추가

SPEC-003 R1의 "관리 블록 소유권 규약을 연동 공통 규칙으로 승격"과 R5의 dream 잡 기본값을 백엔드 엔진 수준에서 구현한다. 이 작업은 화면을 바꾸지 않는다. 커맨드도 새로 만들지 않는다.

이 작업의 절반은 기존 코드의 구조 변경이다. 구조 변경에서 가장 중요한 완료 조건은 "기존 동작이 그대로다"이다. 역할 잡만 설치된 파일의 바이트가 이 변경 전후로 같아야 한다(기획서 완료 조건 12).

## 의존성

- 없음. 이 작업이 SPEC-003의 첫 작업이다.
- TASK-009·TASK-010이 이 작업의 타입을 쓴다. 병행하지 않는다.

## 범위

- `src-tauri/src/infrastructure/heartbeat_jobs.rs` — 잡 종류에 독립적인 엔진만 남긴다.
- `src-tauri/src/infrastructure/heartbeat_roles.rs` (신규) — 역할 잡 정의를 옮겨 받는다.
- `src-tauri/src/infrastructure/heartbeat_dream.rs` (신규) — dream 잡 정의를 새로 만든다.
- `src-tauri/src/infrastructure/mod.rs` — 모듈 선언 2줄 추가.
- `src-tauri/src/application/heartbeat_service.rs` — import 경로와 호출부만 새 API에 맞춘다. 동작은 그대로 둔다.
- 프론트엔드(`src/`), `.workflow/`, `docs/`는 건드리지 않는다.

## 작업 내용

### 0. 먼저 읽을 제약

- `~/.claude/HEARTBEAT.md`는 전역 파일이다. 이 작업에서 만드는 코드는 명시적 설치 호출에서만 쓴다. 조회 경로에는 쓰기가 없어야 한다.
- 홈 경로를 모듈이 스스로 계산하지 않는다. 경로는 인자로 받는다. SPEC-002에서 정한 규칙이고 그대로 유지한다.
- 기존 테스트를 지우거나 비활성화하지 않는다. import 경로 수정과 파일 이동은 허용한다. 단언(assert) 내용을 바꿔야 한다면 그건 동작이 바뀐 것이므로 멈추고 이유를 보고한다.

### 1. 엔진에서 역할 개념을 걷어낸다 (R1)

`heartbeat_jobs.rs`는 "관리 블록을 소유하는 규칙"만 알아야 한다. 어떤 연동의 잡인지는 몰라야 한다.

- 잡 하나를 표현하는 공통 타입을 만든다. 렌더에 필요한 값이 이미 다 결정된 상태로 들어온다. 필드는 현재 파일에 쓰이는 순서 그대로다: `name`, `slug`, `model`, `prompt`, `interval`, `timeout`, `condition`, `notify`, `max_per`.
- 블록 렌더 함수는 이 공통 타입의 목록만 받는다. `HeartbeatRole`을 참조하지 않는다.
- 설치 함수도 공통 타입 목록을 받아 블록 전체를 다시 쓴다. 목록이 비면 블록을 제거한다. 지금 `install_role_jobs`가 하는 일과 같고, 입력 타입만 달라진다.
- 아래는 엔진에 그대로 남는다. 연동 수와 무관하게 성립해야 하는 규칙이다.
  - 관리 마커 한 쌍, 파일 끝 배치
  - 블록 밖 원문 보존, 전역 설정(`tick`) 보존
  - 마커 손상(개수 이상·순서 역전)·종료 마커 뒤 흡수 줄 감지 시 원본 무변경 실패
  - 내용이 같으면 쓰지 않음(멱등), 원자적 쓰기, 줄바꿈(`\r\n`) 보존
  - `interval`·`max_per`·`model` 형식 검증
- 역할 관련 심볼(`HeartbeatRole`, 역할 프롬프트, 역할 기본값, `job_name`, `RoleJob`, `RoleJobSettings`)은 `heartbeat_roles.rs`로 옮긴다. 로직은 바꾸지 않는다.
- `project_slug`, `parse_heartbeat`, 마커 상수는 공통이므로 `heartbeat_jobs.rs`에 남긴다.

판단 기준: `heartbeat_jobs.rs`에서 `role`, `planner`, `dream` 같은 연동별 단어가 사라져야 한다. 코드 리뷰에서 이걸 근거로 "세 번째 연동이 와도 이 파일은 안 고친다"를 설명할 수 있어야 한다.

### 2. 역할 잡 렌더 결과는 바이트 단위로 같아야 한다 (완료 조건 12·13)

- 잡 순서(planner → architect → developer), 필드 순서, 잡 사이 빈 줄 한 줄, 마커 위치를 그대로 유지한다.
- 기존 테스트 `creates_file_with_three_role_jobs_at_defaults`, `appends_block_after_user_jobs_and_preserves_them`, `keeps_carriage_returns_of_the_original_file` 등이 수정 없이 통과해야 한다(파일 이동에 따른 `use` 경로 변경은 예외).
- 아래 실제 파일과 대조해 확인한다. 이 파일은 현재 앱이 쓴 결과다.

```sh
sed -n '3,33p' ~/.claude/HEARTBEAT.md
```

### 3. dream 잡 정의 (R5)

`heartbeat_dream.rs`에 dream 잡 하나를 만드는 코드를 넣는다. 파일을 읽거나 쓰지 않는다. 값 조립만 한다.

| 필드 | 값 | 소유 |
| --- | --- | --- |
| name | `wf-dream<slug>` | 앱 |
| slug | 프로젝트 slug | 앱 |
| model | `opus` | 사용자 편집 가능 |
| prompt | 아래 고정 문구 | 앱 |
| interval | `2h` | 사용자 편집 가능 |
| timeout | `30m` | 앱 |
| condition | `dream-prep check-unprocessed --slug=<slug>` | 앱 |
| notify | `all` | 앱 |
| max_per | `6/24h` | 사용자 편집 가능 |

- 잡 이름은 `wf-dream` 뒤에 slug를 붙인다. slug가 `-`로 시작하므로 결과는 `wf-dream-Users-catze-project-workflow-labs` 형태다. 역할 잡의 `wf-<역할><slug>` 규칙과 같은 모양이고, 사용자가 손으로 만들어 온 `dream-catze`·`dream-unity`와 겹치지 않는다(R4).
- prompt는 앱이 소유하는 한 줄 고정 문구다. 아래 문구를 쓴다. 줄바꿈을 넣지 않는다.

```
/dream 스킬로 이 프로젝트의 트랜스크립트를 메모리로 정제해줘. 처리할 트랜스크립트가 없으면 아무것도 정제하지 말고 멈춰.
```

- condition은 기획서 R5 표의 문자열을 그대로 쓴다. `sh`를 앞에 붙이지 않는다. dream 잡은 조건 스크립트를 쓰지 않는다.
- 조건 스크립트(`.workflow/rules/wf-eligible.sh`)를 dream 경로에서 설치하지 않는다. `dream-prep check-unprocessed`가 하트비트 조건용으로 만들어진 명령이라 별도 스크립트가 필요 없다.
- `interval`·`max_per`·`model` 검증은 엔진의 공통 검증을 그대로 쓴다. dream 전용 규칙을 새로 만들지 않는다.

### 4. 서비스 호출부 맞추기

- `heartbeat_service.rs`는 이번에 구조를 바꾸지 않는다. import 경로와 새 설치 API 시그니처에 맞춰 최소한만 고친다.
- 역할 잡 → 공통 잡 타입 변환은 `heartbeat_roles.rs`가 제공한다. 서비스가 필드를 직접 조립하지 않는다.
- 이 작업이 끝난 시점에도 앱 동작은 SPEC-002와 완전히 같다. dream 잡을 쓰는 경로는 아직 없다.

### 5. 테스트

기존 테스트를 유지한 채 아래를 추가한다.

- 공통 잡 타입 목록을 넘기면 블록이 그 순서·형식대로 렌더된다.
- dream 잡 하나만 넘겼을 때 `## wf-dream<slug>` 헤더와 8개 필드가 R5 표의 값으로 렌더된다.
- 역할 3종 + dream을 함께 넘기면 마커 블록이 하나만 생기고, 역할 3종만 넘긴 결과에 dream 잡만 덧붙은 형태가 된다.
- 역할 3종만 설치한 결과가 이 변경 전 결과와 같다. 기존 테스트로 이미 덮이면 새로 만들지 않아도 된다.
- dream 잡의 `interval`을 `2시간` 같은 잘못된 값으로 만들면 파일이 그대로 남고 검증 오류가 난다.
- dream 잡을 포함한 블록을 두 번 같은 입력으로 설치해도 파일이 바뀌지 않는다.

## 완료 조건

1. `heartbeat_jobs.rs`에 역할·dream 등 연동별 심볼이 없고, 블록 렌더·설치가 공통 잡 타입만 받는다. (기획서 완료 조건 3의 백엔드 측면, R1)
2. 역할 잡 3종만 설치한 `HEARTBEAT.md`의 내용이 이 변경 전과 바이트 단위로 같다. (기획서 완료 조건 12)
3. dream 잡을 R5 표의 기본값으로 렌더하는 코드가 있고, 잡 이름이 `wf-dream<slug>`다. (기획서 완료 조건 4의 값 측면)
4. SPEC-002에서 만든 `heartbeat_jobs.rs` 테스트가 단언 수정 없이 모두 통과한다. (기획서 완료 조건 13)
5. 새 테스트를 포함해 `cargo test --manifest-path src-tauri/Cargo.toml`이 통과한다.
6. 프론트엔드(`src/`)에 변경이 없다.

## 검증 절차

```sh
cargo test --manifest-path src-tauri/Cargo.toml
```

```sh
grep -n "role\|planner\|architect\|developer\|dream" src-tauri/src/infrastructure/heartbeat_jobs.rs
```

- `mod tests` 밖에서는 결과가 나오지 않아야 한다.

```sh
grep -rn "home_dir\|env::var(\"HOME\")" src-tauri/src/infrastructure/heartbeat_jobs.rs src-tauri/src/infrastructure/heartbeat_roles.rs src-tauri/src/infrastructure/heartbeat_dream.rs
```

- 결과가 없어야 한다. 홈 해석은 커맨드 계층이 한다.

```sh
md5 ~/.claude/HEARTBEAT.md
```

- 작업 전후로 값이 같아야 한다. 이 작업은 실제 전역 파일을 쓰지 않는다.

```sh
git status --short
```

- 변경이 범위에 적힌 5개 파일로 한정되는지 확인한다.

## 범위 밖

- dream 설치 여부·정제 상태 읽기. TASK-009 담당이다.
- 연동 공통 모델과 커맨드 재구성. TASK-010 담당이다.
- dream 잡을 실제로 설치하는 커맨드와 화면. TASK-012 담당이다.
- 다른 종류 잡을 보존하는 병합 로직. 병합은 연동 목록을 아는 계층(TASK-012의 서비스)이 하고, 엔진은 완성된 목록을 받아 쓰기만 한다.
- 조건 스크립트 이중화 정리(`scripts/wf-eligible.sh` ↔ `.workflow/rules/wf-eligible.sh`). 기획서 제외 범위다.

## 참고 사실

- 하트비트 파서는 줄을 trim한 뒤 `## `면 잡 헤더, `- `면 필드로 읽고 나머지는 무시한다. 첫 `## ` 앞의 `- ` 줄만 전역 설정으로 읽힌다. 관리 블록이 파일 끝에 있어야 하는 이유다.
- 파서는 마지막에 `slug`와 `prompt`가 모두 비어 있지 않은 잡만 남긴다. dream 잡도 두 필드를 반드시 채워야 한다.
- 필드 값에 콜론이 들어가도 파서는 첫 콜론에서만 자르므로 문제가 없다. prompt 문구의 `/dream`은 안전하다.
- `dream-prep check-unprocessed --slug SLUG`는 도움말에 `for heartbeat condition`이라고 적혀 있고 미처리 유무로 exit 0/1을 반환한다. `--slug=<slug>` 형태도 같은 인자 파서가 받는다.
