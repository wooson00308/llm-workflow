---
schema: workflow-labs/task@1
id: TASK-070
title: 역할 잡 하나를 지금 실행하는 백엔드 커맨드를 만든다
status: completed
source_spec_id: SPEC-020
source_decision_id: DECISION-53577F93
updated_at: 2026-08-04T11:43:24.903018+00:00
history:
  - { at: 2026-08-04T08:50:00Z, kind: created }
  - { at: 2026-08-04T08:48:30Z, kind: in_progress }
  - { at: 2026-08-04T09:01:00Z, kind: qa_waiting }
  - { at: 2026-08-04T11:43:24.903018+00:00, kind: completed }
---

# 역할 잡 하나를 지금 실행하는 백엔드 커맨드를 만든다

지금 앱이 노출하는 하트비트 커맨드 셋(`lib.rs:24`~`:26`)은 전부 파일을 읽고 쓰는 일만 하고, 잡을
실행하는 경로가 없다(확인 사실 1). 앱은 지금까지 어떤 외부 명령도 실행하지 않는다 —
`capabilities/default.json`에 셸 권한이 없고 `Cargo.toml`에 셸 플러그인 의존성이 없다(확인 사실 2).
승인된 확인 필요 1번이 "앱이 실행한다"이므로 그 경로를 이 작업이 만든다.

실행 대상은 이 프로젝트의 역할 잡 하나뿐이다. 잡을 지정하지 않는 `heartbeat once`는 다른 프로젝트의
역할 잡과 dream 잡까지 깨우므로 쓰지 않는다(확인 사실 15, R8).

## 의존성

- 선행 없음. 아래 "범위"의 파일은 지금 열린 어떤 작업의 범위에도 없다.
- TASK-071이 같은 계약의 프런트 쪽을 만든다. 파일이 겹치지 않아 병렬로 진행할 수 있다. 두 작업이
  지켜야 할 통신 계약은 아래 "와이어 계약"에 못박아 두었으니 그 값을 임의로 바꾸지 않는다.

## 와이어 계약

두 작업이 이 값에서 갈라지면 화면이 존재하지 않는 커맨드를 부른다.

- 커맨드 이름: `run_heartbeat_job`
- 인자: `path: String`, `job_name: String` (화면에서는 `{ path, jobName }`)
- 성공: 값 없음(`Ok(())`)
- 실패: 아래 모양으로 직렬화되는 오류 값

```json
{ "jobName": "wf-planner-Users-...", "message": "…", "command": "heartbeat once -j wf-planner-Users-..." }
```

`command`는 사용자가 손으로 같은 일을 할 때 칠 명령 원문이다(R6). 화면이 이 문자열을 다시 조립하지
않게 백엔드가 만들어 실어 보낸다 — 설치 마법사가 `stage.command`를 그대로 내려보내는 것과 같은
어법이다.

## 범위

- `src-tauri/src/infrastructure/heartbeat_process.rs` — 신설. 실행 파일 후보 해석과 프로세스 실행.
- `src-tauri/src/application/heartbeat_run_service.rs` — 신설. 잡 이름 검증과 실패 값 조립.
- `src-tauri/src/infrastructure/mod.rs`, `src-tauri/src/application/mod.rs` — 각 한 줄.
- `src-tauri/src/commands/heartbeat.rs` — 커맨드 하나를 더한다. 기존 `heartbeat_home` 헬퍼를 그대로
  쓰고 기존 커맨드 셋은 고치지 않는다.
- `src-tauri/src/lib.rs` — `generate_handler!` 목록에 한 줄.
- **`src-tauri/src/application/heartbeat_service.rs`는 한 줄도 고치지 않는다.** 실행은 조회·설치와
  다른 책임이라 별도 서비스에 둔다. 지금 그 파일은 SPEC-022 계열 작업(TASK-063 등)이 테스트 모듈과
  병합 경로를 고치는 중이라, 같은 파일에 들어가면 두 작업이 서로를 막는다.
- 프런트엔드 파일은 건드리지 않는다.

## 작업 내용

### 실행 수단

- 셸 플러그인을 넣지 않는다. `tauri-plugin-shell`을 붙이면 화면이 임의의 명령을 실행할 수 있는
  권한이 열리고, 그것이 R9와 완료 조건 23이 막으려는 것이다. `std::process::Command`로 직접 띄운다.
  `Cargo.toml`과 `capabilities/default.json`은 그대로 둔다.
- 실행 파일 후보는 둘이고 순서가 있다. 먼저 상속받은 PATH의 `heartbeat`, 그 시도가
  `ErrorKind::NotFound`일 때만 `<user_home>/.local/bin/heartbeat`.
  - 근거: GUI로 띄운 앱이 물려받는 PATH는 사용자 셸의 PATH와 다르다(확인 사실 4). 후보가 하나면
    정상 설치에서도 거의 늘 실패한다. pip·pipx의 사용자 설치 위치가 `~/.local/bin`이라 그 하나만
    더 본다. Homebrew는 이 도구를 배포하지 않으므로 후보에 넣지 않는다.
  - PATH를 앞에 두어 사용자 환경을 먼저 존중한다. `NotFound`가 아닌 실패(권한 없음 등)는 다음
    후보로 넘어가지 않고 그 자리에서 실패로 만든다 — 찾긴 찾았는데 못 돌린 것이라 사유가 다르다.
  - Windows에서는 후보가 PATH 하나뿐이다. 이 저장소는 Windows의 설치 경로 규약을 확인한 적이 없고,
    확인하지 않은 경로를 추측으로 넣지 않는다.
- 인자는 `once -j <잡 이름>` 고정이다. 화면이 준 문자열을 명령줄에 이어 붙이는 경로를 만들지
  않는다(완료 조건 23).
- 표준 입출력 셋 다 `Stdio::null()`이다. 세션 출력을 앱 안에서 보여주는 것은 기획서 제외 범위이고,
  파이프를 열어 두고 읽지 않으면 20~30분짜리 세션에서 버퍼가 막힌다.
- 자식이 끝날 때까지 기다린다(`status()`). 종료 코드가 0이 아니면 실패로 만들고 그 코드를 문구에
  적는다. 조건 미충족과 한도 도달은 종료 코드 0이므로 여기서 실패가 되지 않는다(확인 사실 6).
- 어떤 파일도 읽거나 쓰지 않는다(R1, 완료 조건 5).
- 잡의 작업 디렉터리는 하트비트가 slug에서 정한다(확인 사실 14). 앱이 `current_dir`을 지정하지
  않는다.

### 검증 가능한 모양으로 쪼갠다

- 후보 목록을 만드는 일을 순수 함수로 분리한다(`fn candidates(user_home: &Path) -> Vec<PathBuf>`
  정도). 순서를 실제 실행 없이 단정할 수 있어야 한다.
- 손으로 칠 명령을 만드는 일도 함수 하나에 둔다(`fn manual_command(job_name: &str) -> String`).
  실패 payload의 `command`가 여기서만 나온다.
- 실행 함수는 후보 목록을 인자로 받는다. 존재하지 않는 후보만 넘긴 테스트가 "실행 파일을 찾지 못함"
  실패를 확인할 수 있어야 하고, 그 단정은 세 플랫폼에서 모두 돈다.

### 커맨드 계층

- `#[tauri::command]`를 붙인 `async fn`으로 만들고 실제 실행은 `tauri::async_runtime::spawn_blocking`
  안에서 돌린다. 동기 커맨드는 메인 스레드에서 돌아, 타임아웃 상한(기획자·아키텍트 20분, 개발자
  30분 — 확인 사실 7)까지 창이 멈춘다.
- 홈 해석은 지금처럼 커맨드 계층의 `heartbeat_home`이 한다. 서비스는 경로를 받기만 한다. 이 커맨드가
  쓰는 것은 사용자 홈이다(`~/.local/bin` 후보 때문이며 `~/.claude`가 아니다).

### 서비스 계층

- `run_job(&self, project_root: &Path, user_home: &Path, job_name: &str)`.
- **먼저 잡 이름을 검증한다.** `heartbeat_jobs::project_slug(project_root)`로 slug를 만들고
  `heartbeat_roles::job_name(role, &slug)`을 세 역할에 대해 만들어, 받은 이름이 그중 하나가 아니면
  아무것도 띄우지 않고 실패로 돌려준다. 이 검사가 완료 조건 21과 23을 닫는다 — 화면이 무엇을 보내든
  실행되는 것은 이 프로젝트의 역할 잡 셋뿐이다.
- 실패 문구는 사유마다 다른 말을 쓴다. 최소한 넷을 구분한다: 이 프로젝트의 역할 잡이 아님, 실행
  파일을 찾지 못함(본 후보 경로를 함께 적는다), 실행을 시작하지 못함, 0이 아닌 종료 코드.
- `command`는 어느 사유에서도 채운다. 사용자가 직접 칠 명령은 사유와 무관하게 같다.

## 완료 조건

1. `run_heartbeat_job` 커맨드가 `generate_handler!`에 등록되고 위 와이어 계약대로 인자와 값을
   주고받는다. (기획서 완료 조건 2)
2. 이 프로젝트의 세 역할 잡 이름만 실행 대상이 되고, 그 밖의 이름은 프로세스를 띄우지 않고 실패로
   끝난다. (완료 조건 21·23)
3. 실행에 쓰는 인자가 `once -j <잡 이름>` 고정이고, 잡을 지정하지 않는 실행 경로가 코드에 없다.
   (완료 조건 21)
4. 실행 경로가 어떤 파일도 쓰지 않는다. 임시 홈과 임시 프로젝트 루트를 넘긴 실행 뒤 두 디렉터리의
   내용이 그대로다. (완료 조건 5)
5. 실행 파일 후보가 PATH의 `heartbeat` 다음 `<user_home>/.local/bin/heartbeat` 순서이고 Windows
   에서는 PATH 하나뿐이다. 순수 함수 단위 테스트로 확인한다.
6. 존재하지 않는 후보만 있는 상태에서 실패 값이 나오고, 그 `command`가
   `heartbeat once -j <잡 이름>`이다. (완료 조건 16)
7. 위 항목 전부에 자동화 테스트가 있다.
8. 셸 플러그인 의존성과 셸 실행 권한이 추가되지 않았다. `Cargo.toml`과
   `capabilities/default.json`에 변경분이 없다. (완료 조건 23)
9. `application/heartbeat_service.rs`에 변경분이 없다.
10. 기존 자동화 테스트가 삭제되거나 비활성화되지 않는다. (완료 조건 24)
11. `cargo test --manifest-path src-tauri/Cargo.toml`이 통과한다.

## 검증 절차

```sh
cargo test --manifest-path src-tauri/Cargo.toml
git diff --stat src-tauri/Cargo.toml src-tauri/capabilities/default.json \
  src-tauri/src/application/heartbeat_service.rs   # 셋 다 비어 있어야 한다
```

## 범위 밖

- 실행 중인 세션의 취소·중단. 띄운 뒤 되돌리는 경로를 만들지 않는다.
- 세션 출력·로그의 수집과 표시.
- 실행 결과를 앱이 판정하거나 기록하는 일. 실행 기록은 하트비트가 남기는 값이고 앱은 조회로만
  읽는다(R4).
- dream 잡 실행. 승인된 확인 필요 4번이 이번 범위에서 제외했다.
- 데몬의 시작·정지·재시작, 설치 마법사 네 단계의 실행 대행(R9).
- 조회 스냅샷(`IntegrationsSnapshot`)에 필드를 더하는 일. 이 작업은 커맨드 하나만 더한다.
- 여러 잡을 한 번에 도는 조작. 승인된 확인 필요 2번이 역할 잡 하나로 한정했다.
