---
schema: workflow-labs/task@1
id: TASK-009
title: dream 설치 판정·정제 상태 읽기와 중복 잡 감지 공통화
status: completed
source_spec_id: SPEC-003
source_decision_id: DECISION-5276FDBF
updated_at: 2026-08-02T14:57:41Z
---

# dream 설치 판정·정제 상태 읽기와 중복 잡 감지 공통화

SPEC-003 R2의 설치 상태 판정, R3의 정제 상태, R6의 중복 감지 공통화를 백엔드 읽기 계층에서 구현한다. 전부 읽기 전용이다. 이 작업에서 만드는 코드는 어떤 파일도 쓰지 않고 디렉터리도 만들지 않는다.

앱은 이 상태를 얻기 위해 외부 명령을 실행하지 않는다. 기획서 확인 필요 1번이 승인된 제안대로 파일에서 직접 유도한다.

## 의존성

- TASK-008 선행 필수. dream 잡 이름 규칙과 공통 잡 타입을 쓴다.
- 병행 작업 없음.

## 범위

- `src-tauri/src/infrastructure/heartbeat_dream.rs` — TASK-008이 만든 파일에 읽기 함수를 추가한다.
- `src-tauri/src/infrastructure/heartbeat_status.rs` — 중복 감지와 잡 실행 기록 조회를 연동에 독립적으로 바꾼다.
- `src-tauri/src/domain/project.rs` — 공통 설치 상태 타입과 dream 상태 타입을 추가한다.
- 그 외 파일은 건드리지 않는다.

## 작업 내용

### 0. 먼저 읽을 제약

- 이 모듈들은 파일을 쓰지 않는다. 디렉터리도 만들지 않는다. 자동 새로고침 주기마다 호출되는 경로다.
- 대상 파일·디렉터리가 없는 것은 오류가 아니다. "기록 없음"으로 내려보낸다. 읽기 자체가 권한 등으로 실패한 경우만 기존 `readFailures`에 담는다.
- 홈 경로를 스스로 계산하지 않는다. 하트비트 홈(`~/.claude`)을 인자로 받는다.
- 외부 프로세스를 실행하지 않는다. `Command`, `std::process` 사용 금지.

### 1. 공통 설치 상태 표현 (R1)

- `domain/`에 연동 공통 설치 상태 타입을 만든다. 값은 두 개다: 미설치 / 설치됨.
- 연동별 부가 상태는 그 위에 얹는다. 공통 타입에 연동별 값을 넣지 않는다.
  - 하트비트: 공통 상태 + 데몬 실행 여부(현재의 pid 파일 판정).
  - dream: 공통 상태(dream 스킬 설치 여부) + 하트비트 설치 여부.
- 현재 `HeartbeatInstallation`의 세 값(`not_installed`, `installed_daemon_stopped`, `installed_daemon_running`)은 이 조합으로 표현된다. 화면 문구는 TASK-010이 같은 세 가지로 다시 만든다. 이 작업에서 문구를 정하지 않는다.
- 판단 기준: 세 번째 연동이 와도 공통 상태 타입을 고치지 않아야 한다.

### 2. dream 설치 판정 (R2)

- dream 스킬 설치 여부는 `<하트비트 홈>/skills/dream/SKILL.md`의 존재로 판정한다. 실측으로 확인한 설치 경로다.
- 하트비트 설치 여부는 기존 판정(`HEARTBEAT.md` 또는 `heartbeat/` 존재)을 그대로 쓴다. 새로 만들지 않는다.
- 두 값의 조합이 기획서 R2의 세 상태가 된다: 하트비트 미설치 / 하트비트 설치됨·dream 미설치 / 둘 다 설치됨.
- 한계를 코드 주석에 남긴다: `heartbeat install dream --slug`로 다른 이름으로 설치하면 이 경로에 없을 수 있다. 판정 경로 자체를 화면에 밝히는 것은 TASK-011이 한다.

### 3. dream 정제 상태 읽기 (R3)

현재 프로젝트 slug 기준으로 아래 다섯 값을 만든다. 기준 디렉터리는 `<하트비트 홈>/projects/<slug>/`다.

- 전체 트랜스크립트 수: 그 디렉터리 바로 아래 `*.jsonl` 파일 수. 하위 디렉터리는 세지 않는다.
- 정제 마킹 수: 아래 마킹 규칙에 해당하면서 **실제로 존재하는** `*.jsonl` 파일 수.
- 미정제 수: 전체 − 마킹 수. 이 계산이 음수가 되지 않도록 마킹 수는 반드시 실제 존재하는 파일만 센다. `dream_meta.md`에는 이미 지워진 트랜스크립트 이름이 남아 있을 수 있다.
- 마지막 정제 시각: `memory/dream_meta.md`의 `last_dream` 값. 값이 비어 있으면 없는 것으로 본다.
- 메모리 topic 파일 수: `memory/*.md` 중 `MEMORY.md`와 `dream_meta.md`를 뺀 개수. `memory/_dream_prep/` 아래는 세지 않는다.

마킹 규칙은 dream 구현(`skills/dream/meta.py`, `window.py`)에서 확인한 그대로다.

- legacy: `dream_meta.md`에서 `- `로 시작하고 `.jsonl`로 끝나는 줄의 파일명. 단 `- file:` 형태는 v2 항목이므로 legacy 파일명으로 취급하지 않는다.
- v2: `processed_v2:` 섹션의 `- file: <이름>.jsonl` 항목. 그 항목 아래 들여쓴 `status:` 줄이 있으면 그 값을, 없으면 `sealed`로 본다.
- 마킹된 것 = legacy에 있거나 v2에서 `sealed`인 파일. v2에서 `status: active`인 파일은 부분 처리 상태이므로 마킹되지 않은 것으로 센다.
- `processed_v2:` 섹션은 들여쓰지 않은 새 키가 나오면 끝난다.

없는 경우의 처리는 전부 정상 상태다. 오류로 올리지 않는다.

- `<하트비트 홈>/projects/<slug>/`가 없다 → "트랜스크립트 없음". 전체 수 0.
- `dream_meta.md`가 없거나 `last_dream`이 비었다 → "정제 기록 없음". 마킹 수 0, 미정제 수 = 전체 수.
- `memory/`가 없다 → topic 파일 수 0.

이 수가 dream이 한 번에 처리할 수를 예측하지 않는다는 사실을 코드 주석에 남긴다. dream은 실행 시 활성 파일 게이트(mtime quiet 30분 미만 제외, 10MB 이상 강제 처리)를 추가로 적용한다. 앱은 그 판정을 베끼지 않는다.

### 4. 중복 잡 감지 공통화 (R6)

- 지금 `find_duplicate_jobs`는 조건 문자열에 `wf-eligible.sh`가 들어 있는지만 본다. 이 판정 기준을 연동이 제공하도록 바꾼다.
  - 역할 잡: 조건에 `wf-eligible.sh`가 들어 있다.
  - dream 잡: 조건에 `dream-prep`이 들어 있다.
- 관리 블록 밖에 있고 slug가 같다는 조건은 공통으로 남는다. 블록 안에 있는 잡은 감지 대상이 아니다.
- 결과에 어느 연동의 중복인지가 담겨야 한다. 화면이 해당 연동 카드 안에 경고를 그린다.
- 역할 판별(조건 인자에서 planner/architect/developer 찾기)은 역할 잡에만 해당한다. dream은 역할 개념이 없다.
- 감지만 한다. 수정도 삭제도 하지 않는다.
- 판단 기준: 세 번째 연동이 오면 판정 함수 하나를 넘기는 것으로 끝나야 한다. 감지 루프와 결과 타입은 고치지 않는다.

### 5. 잡 실행 기록 조회 일반화 (R5)

- 지금은 역할 3종에 대해서만 `state.json`을 조회한다. dream 잡도 같은 방식이 필요하다.
- 잡 이름을 받아 실행 기록 하나를 돌려주는 형태로 정리한다. 기존 역할별 조회는 그 위에 얹는다.
- `last_run`은 타임존 없는 로컬 시각 문자열이므로 원문 그대로 전달한다. `last_result`도 원문 그대로 전달한다.
- 기록이 없으면 "실행 기록 없음"이다. 상태 파일이 없거나 깨진 경우와 구분하지 않는다.

### 6. 테스트

`tempfile::tempdir`로 가짜 하트비트 홈을 만들어 작성한다. 실제 `~/.claude`를 건드리지 않는다.

- `skills/dream/SKILL.md`가 있을 때와 없을 때 dream 설치 판정이 달라진다.
- 하트비트 미설치 / 하트비트만 설치 / 둘 다 설치 세 조합이 서로 다른 결과로 나온다.
- `projects/<slug>/`에 `*.jsonl` 5개를 두고 `dream_meta.md`에 그중 2개를 v2 항목으로 마킹하면 전체 5, 마킹 2, 미정제 3이 나온다.
- 마킹 항목에 `status: active`가 붙은 파일은 미정제로 센다.
- legacy 형태(`- <이름>.jsonl`)로만 마킹된 파일도 마킹으로 센다.
- `dream_meta.md`에 실제로 없는 파일 이름이 들어 있어도 미정제 수가 음수가 되지 않는다.
- `dream_meta.md`가 없으면 마킹 0, 미정제 = 전체, 마지막 정제 시각 없음이 나오고 오류가 아니다.
- `projects/<slug>/`가 없으면 전체 0으로 나오고 오류가 아니다.
- `memory/`에 `MEMORY.md`, `dream_meta.md`, topic 3개, `_dream_prep/` 디렉터리를 두면 topic 수가 3으로 나온다.
- 관리 블록 밖에 slug가 같고 조건에 `dream-prep`이 들어간 잡이 있으면 dream 중복으로 감지된다. 블록 안의 dream 잡은 감지되지 않는다.
- 관리 블록 밖의 역할 잡 감지가 기존과 같게 동작한다. 기존 테스트가 그대로 통과해야 한다.
- 함수를 호출해도 대상 디렉터리에 새 파일이 생기지 않고 기존 파일의 수정 시각이 바뀌지 않는다.

## 완료 조건

1. dream 스킬 설치 여부가 파일 존재로 판정되고, 하트비트 설치 여부와 조합해 R2의 세 상태를 구분한다. (기획서 완료 조건 2의 백엔드 측면)
2. 전체·마킹·미정제 트랜스크립트 수, 마지막 정제 시각, 메모리 topic 파일 수가 파일 내용과 일치하게 나온다. (기획서 완료 조건 9)
3. `dream_meta.md`가 없거나 프로젝트 디렉터리가 없는 경우가 오류가 아닌 정상 상태로 나온다. (기획서 완료 조건 9)
4. 중복 잡 감지가 연동이 제공하는 판정 기준으로 동작하고, 관리 블록 밖의 dream 잡을 감지한다. (기획서 완료 조건 11의 감지 측면, R6)
5. 연동 공통 설치 상태 타입이 있고, 연동별 부가 상태가 그 위에 얹혀 있다. (R1)
6. 모듈이 어떤 파일도 쓰지 않고, 외부 명령을 실행하지 않으며, 홈 경로를 스스로 계산하지 않는다. (기획서 완료 조건 14, 확인 필요 1번)
7. SPEC-002에서 만든 `heartbeat_status.rs` 테스트가 단언 수정 없이 모두 통과한다. (기획서 완료 조건 13)
8. `cargo test --manifest-path src-tauri/Cargo.toml`이 통과한다.

## 검증 절차

```sh
cargo test --manifest-path src-tauri/Cargo.toml
```

```sh
grep -rn "write\|create_dir\|remove_file\|File::create\|Command\|process::\|home_dir" src-tauri/src/infrastructure/heartbeat_dream.rs src-tauri/src/infrastructure/heartbeat_status.rs
```

- `mod tests` 밖에서는 결과가 나오지 않아야 한다. 테스트는 픽스처를 만들어야 하므로 쓰기가 있어도 된다.

```sh
ls -la ~/.claude/skills/dream/SKILL.md
ls ~/.claude/projects/-Users-catze-project-workflow-labs/*.jsonl | wc -l
ls ~/.claude/projects/-Users-catze-project-workflow-labs/memory/ 2>&1
```

- 이 저장소 slug에는 `dream_meta.md`가 없다. 구현이 이 경우에 "정제 기록 없음"과 미정제 수 = 전체 수를 내는지 단위 테스트로 확인한다.
- 비교용 실제 파일이 필요하면 `~/.claude/projects/-Users-catze/memory/dream_meta.md`를 읽어 형식을 대조한다. 앱이 이 파일을 쓰지 않는다.

```sh
git status --short
```

- 변경이 범위에 적힌 3개 파일로 한정되는지 확인한다.

## 범위 밖

- `dream-prep status` 등 외부 명령 실행. 기획서 확인 필요 1번이 승인된 제안으로 배제했다.
- dream의 활성 파일 게이트(mtime quiet 30분, 10MB 강제 처리) 재현. 앱은 마킹 기준만 센다.
- 메모리 topic 파일 내용 읽기·표시. 기획서 제외 범위다.
- 화면 문구와 커맨드 배선. TASK-010·TASK-011 담당이다.
- 새 파일 감시 장치 추가. 기존 자동 새로고침 주기를 따른다.

## 참고 사실

- `dream_meta.md`의 `processed_v2:` 항목은 압축될 수 있다. dream은 sealed 항목이 200개를 넘으면 오래된 항목의 `last_uuid`/`status` 줄을 지우고 `- file: x.jsonl` 한 줄로 줄인다. 그래서 sub-line이 없는 항목을 `sealed`로 보는 것이 맞다.
- 실제 `dream_meta.md`에는 frontmatter가 있다. `last_dream`은 frontmatter 밖 본문에 있다.
- 이 저장소 slug(`-Users-catze-project-workflow-labs`)에는 `dream_meta.md`가 없고 `memory/`가 비어 있다. 정제를 한 번도 하지 않은 프로젝트의 실제 예시다.
- `~/.claude/heartbeat/state.json`에는 `dream-catze`, `dream-unity`처럼 사용자가 손으로 만든 dream 잡 기록이 남아 있다. 잡 이름으로만 조회하는 이유이자 R6 중복 감지가 관측된 위험인 이유다.
