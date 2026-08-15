---
schema: workflow-labs/task@1
id: TASK-044
title: 잡의 condition을 플랫폼에 맞게 기록하고 중복 감지가 두 조건 형태를 모두 알아본다
status: verified
source_spec_id: SPEC-015
source_decision_id: DECISION-EEEEB81D
depends_on:
- TASK-042
updated_at: 2026-08-14T09:08:07.880257+00:00
history:
- at: 2026-08-03T06:50:00Z
  kind: created
- at: 2026-08-03T09:53:20Z
  kind: in_progress
- at: 2026-08-03T10:02:00Z
  kind: qa_waiting
- at: 2026-08-04T11:45:29.397763+00:00
  kind: completed
- at: 2026-08-14T09:08:07.880257+00:00
  kind: migrated_verified
work_group_id: GROUP-DECISION-EEEEB81D
work_group_revision: 1
---

# 잡의 condition을 플랫폼에 맞게 기록하고 중복 감지가 두 조건 형태를 모두 알아본다

SPEC-015 R4·R6을 구현한다. 자산이 플랫폼별로 갈렸으니 관리 블록에 기록되는 `condition`도 그 플랫폼에서
실제로 실행 가능한 한 줄이어야 한다. 그리고 관리 블록 밖 중복 역할 잡 감지가 지금은 파일명
`wf-eligible.sh`가 조건 문자열에 들어 있는지로 판단하므로, PowerShell 조건을 쓰는 잡은 그대로 통과해
버린다.

Windows 차단 해제는 이 작업이 아니다(TASK-045). 이 작업은 차단이 풀렸을 때 기록될 값이 맞는지를 먼저
세운다. 순서를 뒤집으면 Windows 사용자가 처음 설치한 잡의 조건이 `sh ...`로 기록되고, 하트비트가 그
잡을 조용히 건너뛴다.

## 의존성

- **선행 필수: TASK-042.** 자산 서술의 `stem`·`relative_path()`와 PowerShell 파일 이름이 있어야 조건
  명령과 감지 규칙을 만들 수 있다. 코드 의존이다.
- **TASK-043과 병행 금지.** 둘 다 `heartbeat_condition.rs`를 만진다. 이 작업은 제품 코드에 조건 명령
  조립 함수를 더하고, TASK-043은 테스트 모듈에 실행 헬퍼를 만든다. 순서는 어느 쪽이 먼저여도 되지만,
  **뒤에 오는 쪽이 앞의 결과를 흡수한다.** 이 작업이 먼저면 TASK-043의 헬퍼가 이 함수를 쓰고, TASK-043이
  먼저면 이 작업이 그 헬퍼를 이 함수 위로 옮긴다. 테스트가 부르는 명령과 관리 블록에 적히는 명령이
  갈리면 "테스트는 통과하는데 데몬은 못 돈다"가 된다.
- 이 작업의 산출물(플랫폼별 조건 명령)을 TASK-045가 딛고 선다.
- `heartbeat_roles.rs`·`heartbeat_status.rs`·`heartbeat_service.rs`를 만진다. SPEC-009·SPEC-011·
  SPEC-012 계열의 `todo` 작업 중 이 세 파일을 만지는 것은 없다.

## 범위

- `src-tauri/src/infrastructure/heartbeat_condition.rs` — 조건 명령 조립 함수(제품 코드) 하나.
- `src-tauri/src/infrastructure/heartbeat_roles.rs` — `CONDITION_SCRIPT` 상수 제거와 조건 조립,
  바이트 고정 테스트의 플랫폼 대응.
- `src-tauri/src/infrastructure/heartbeat_status.rs` — 역할 조건 감지 규칙과 테스트.
- `src-tauri/src/application/heartbeat_service.rs` — `condition_script_relative_path`의 단일화와 테스트.
- 그 외 파일은 건드리지 않는다. 특히 `role_eligibility.rs`·`claim_helper.rs`·`domain/project.rs`·
  `types.ts`·화면은 이 작업에서 바뀌지 않는다.

## 작업 내용

### 0. 먼저 읽을 제약

- **`condition`은 한 줄이어야 한다**(R4). 하트비트 파서가 관리 블록의 값을 줄 단위로 읽는다.
- **경로는 프로젝트 루트 기준 상대 경로다**(R4). 하트비트가 조건을 프로젝트 cwd에서 실행한다.
- **판정 로직을 조건 문자열 안에 담지 않는다**(D1). 그러면 일치 테스트가 대조할 대상이 사라진다.
- **사용자 시스템의 실행 정책을 앱이 바꾸지 않는다**(D1·R4). 정책을 지나가는 방법은 앱이 기록하는 그
  명령 하나에만 걸린다.
- **감지는 감지만 한다**(R6). 앱은 사용자 잡을 고치거나 지우지 않는다.

### 1. 조건 명령을 한 곳에서 만든다

지금 같은 사실이 두 곳에서 따로 조립된다.

- `heartbeat_roles.rs:10`의 `const CONDITION_SCRIPT: &str = ".workflow/rules/wf-eligible.sh";`가
  관리 블록에 쓰이는 값을 만든다(`:103`).
- `heartbeat_service.rs:724`의 `condition_script_relative_path`가 화면에 보여줄 값을 실제 자산
  경로에서 계산한다(`:306`).

두 값이 지금 같은 것은 우연이다. 완료 조건 24가 그 우연을 없애라고 요구한다. 자산을 아는 모듈이 둘 다
낸다.

```rust
// heartbeat_condition.rs
/// 관리 블록에 쓰는 한 줄 조건 명령. 실행 플랫폼에 맞는 형태다.
pub fn condition_command(role_argument: &str) -> String;
```

- Windows가 아니면 `sh .workflow/rules/wf-eligible.sh <role>`. **지금 기록되는 값과 바이트 단위로
  같아야 한다.**
- Windows면 `powershell -NoProfile -ExecutionPolicy Bypass -File .workflow/rules/wf-eligible.ps1 <role>`.

Windows 형태를 이렇게 정하는 근거다.

- `powershell.exe`는 Windows에 기본 탑재라 사용자가 아무것도 더 설치하지 않아도 된다(R1). `pwsh`를
  쓰지 않는 이유가 이것이다.
- `-ExecutionPolicy Bypass`는 그 프로세스에만 걸린다. 시스템 정책을 바꾸지 않는다(D1).
- `-NoProfile`은 사용자 프로필 스크립트가 판정에 끼어드는 것을 막는다.
- `-File`은 스크립트 파일을 실행하고 스크립트의 `exit` 코드를 프로세스 종료 코드로 그대로 낸다.
  판정 로직이 명령 문자열이 아니라 파일에 있다는 D1의 요구와 맞는다.
- 경로 구분자는 `/`다. PowerShell은 Windows에서도 `/`를 경로 구분자로 받는다. 자산 서술의
  `relative_path()`가 이미 `/`로만 조립하고(`7b6fc69`가 고정한 사실), 여기서 `\`로 바꾸면 그 핫픽스가
  되돌아온다.

`heartbeat_roles.rs`는 `CONDITION_SCRIPT` 상수를 지우고 `condition_command(job.role.as_argument())`를
쓴다. `heartbeat_service.rs`의 `condition_script_relative_path(project_root)`는 자산 서술의
`relative_path()`를 그대로 쓰도록 줄인다 — 지금 함수는 `project_root`를 받아 붙였다 떼어 내는데,
결과는 언제나 같은 상대 경로다. 인자가 필요 없어지면 없앤다.

### 2. 중복 감지가 확장자를 보지 않게 한다

`heartbeat_status.rs:34`의 `CONDITION_SCRIPT_FILE`("wf-eligible.sh")을 지우고,
`is_role_condition`(`:217`)이 TASK-042가 낸 `CONDITION_SCRIPT_STEM`("wf-eligible")을 쓴다.

- stem 부분 문자열 검사는 두 확장자를 모두 잡는다(R6).
- dream 조건(`dream-prep check-unprocessed --slug=...`)에는 이 문자열이 없으므로 다른 연동과 겹치지
  않는다(R6). `DUPLICATE_RULES`의 순서와 dream 규칙은 그대로 둔다.
- 역할 이름 판정(`condition_role`, `:251`)은 한 글자도 바꾸지 않는다(R6). 조건 문자열을 공백으로 쪼개
  역할 토큰을 찾는 방식 그대로다. PowerShell 형태에서도 역할 인자가 마지막 토큰이라 같은 방식으로
  잡힌다. `-NoProfile` 같은 플래그가 역할 토큰과 겹치지 않는지 테스트로 고정한다.

### 3. 테스트

`heartbeat_roles.rs`:

- `role_only_block_matches_the_bytes_written_before_the_split`(`:158`)은 SPEC-003 완료 조건 12가
  고정한 바이트 단위 비교다. **지우지 않는다.** 기대 문자열의 `- condition:` 줄만 플랫폼별로 나눠,
  각 플랫폼에서 리터럴 바이트 고정을 유지한다. `#[cfg(not(windows))]` 쪽은 지금 문자열 그대로다.
- `creates_file_with_three_role_jobs_at_defaults`(`:201`)의 조건 단정도 같은 방식으로 나눈다.

`heartbeat_condition.rs`:

- 현재 플랫폼의 조건 명령이 한 줄이고, 자산의 `relative_path()`를 포함하며, 역할 인자로 끝난다.
- 조건 명령에 들어 있는 경로에 `\`가 없다.
- **기록된 조건 명령을 그대로 실행하면 조건 스크립트의 종료 코드가 그대로 나온다.** (완료 조건 11)
  하트비트가 `shell=True`로 부르므로 셸을 거쳐 실행한다. Windows면 `cmd /C <조건>`, 그 외면
  `sh -c '<조건>'`이고, `current_dir`은 픽스처 프로젝트 루트다. 자격 있음 픽스처에서 0, 없음
  픽스처에서 1이 나오는지 본다.
  이 테스트는 `install_condition_script`와 `condition_command`만 쓴다. `HeartbeatService::install`을
  거치지 않는다 — 그 경로는 TASK-045 전까지 Windows에서 막혀 있고, 이 확인은 차단 해제와 무관하다.

`heartbeat_status.rs`:

- 관리 블록 밖에 PowerShell 조건을 쓰는 같은 slug의 역할 잡이 있으면 중복으로 감지되고 역할 이름이
  함께 나온다. (완료 조건 15)
- 기존 `sh` 조건 중복 감지 테스트(`:490`·`:507`·`:514`·`:585`·`:710`)가 수정 없이 통과한다.
  (완료 조건 16)
- dream 조건을 쓰는 잡이 역할 잡 중복으로 감지되지 않는다. 기존 테스트가 그대로 통과한다.
  (완료 조건 17)
- 역할 인자가 없는 PowerShell 조건은 역할 이름이 `None`이다. 기존 `sh` 쪽 테스트(`:609`)의 짝이다.

`heartbeat_service.rs`:

- `an_empty_home_reports_the_slug_and_the_condition_script_path`(`:924`)의 경로 기대값을 플랫폼별로
  나눈다.
- 화면에 나가는 `condition_script_path` 값이 관리 블록에 기록되는 `condition` 문자열 안의 경로와 같다.
  (완료 조건 24) 두 값을 같은 테스트에서 뽑아 대조한다.

### 4. 하지 않는 것

`#[cfg(all(test, not(windows)))]`로 묶인 `install_tests` 모듈(`heartbeat_service.rs:1609`)의 게이트를
이 작업에서 풀지 않는다. 그 모듈은 `HeartbeatService::install`을 거치고, 그 경로는 Windows에서
`UnsupportedPlatform`으로 끝난다. 게이트 해제는 차단 해제와 같은 시점이어야 하므로 TASK-045다.

## 완료 조건

1. 관리 블록에 쓰이는 조건 명령과 화면이 보여주는 조건 스크립트 경로가 같은 자산 서술에서 나오고,
   두 값이 가리키는 경로가 같다. (기획서 완료 조건 24)
2. Windows의 조건 명령이 한 줄이고, 기본 탑재 PowerShell로 실행되며, 실행 정책을 앱이 기록한 그 명령
   하나에서만 지나간다. (기획서 완료 조건 11의 형태 몫, R4)
3. 기록된 조건 명령을 셸을 거쳐 프로젝트 루트에서 실행하면 조건 스크립트의 종료 코드가 그대로 나온다.
   (기획서 완료 조건 11)
4. Windows가 아닌 플랫폼에서 기록되는 조건 문자열이 이 작업 전후로 바이트 단위로 같다.
5. 관리 블록 밖에 PowerShell 조건을 쓰는 같은 slug의 역할 잡이 중복으로 감지되고 역할 이름이 함께
   나온다. (기획서 완료 조건 15)
6. 기존 `sh` 조건 중복 감지 결과가 이 변경 전후로 같다. (기획서 완료 조건 16)
7. dream 조건을 쓰는 잡이 역할 잡 중복으로 감지되지 않는다. (기획서 완료 조건 17)
8. 기존 Rust·프런트엔드 테스트가 삭제·비활성화 없이 통과한다. 조건 문자열이 플랫폼에 따라 달라져
   기대값을 나눠야 하는 테스트는 나누되, 각 플랫폼에서 리터럴 고정이 유지된다. (기획서 완료 조건 30)
9. `cargo fmt --check`·`cargo clippy -D warnings`·`cargo test`와 `npm run check`가 통과한다.
   (기획서 완료 조건 31)

## 검증 절차

```sh
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
npm run check
```

이 저장소에 잡을 설치해 보지 않는다. 관리 블록은 사용자 홈의 실제 파일이고, 실험용 설치가 남으면
도그푸딩 머신의 데몬 동작이 바뀐다.

## 범위 밖

- Windows 차단 해제와 `install_tests` 게이트 해제. TASK-045다.
- 판정 일치 시나리오 표와 `role_eligibility.rs`. TASK-043이다.
- 자산 설치 규약·본문·버전. TASK-042다.
- 선점 헬퍼. TASK-047이다.
- `skipped` 문구와 dream 카드 표기. TASK-046이다.
- 하트비트 패키지의 조건 실행 방식(`shell=True`, 타임아웃, cwd 역변환) 변경.
- 잡 이름·slug의 표시 형식 개선(기획서 제외 범위).
- `scripts/` 아래 저장소 사본과 `docs/heartbeat.md`.

## 참고 사실

확인 시점 2026-08-03. 추정 없이 파일에서 읽은 값이다.

- `heartbeat_roles.rs:10`이 조건 경로 상수를, `:103`이 `format!("sh {CONDITION_SCRIPT} {}", ...)`로
  조건 문자열을 만든다.
- `heartbeat_service.rs:724`의 `condition_script_relative_path`는 자산 경로에서 `project_root`를 떼고
  컴포넌트를 `/`로 이어 붙인다. 부르는 곳은 `:306`(스냅샷 payload) 하나다.
- `heartbeat_status.rs:34`가 `CONDITION_SCRIPT_FILE`을 갖고, `:217`의 `is_role_condition`이 조건
  문자열에 그 이름이 들어 있는지만 본다. `:251`의 `condition_role`이 공백 토큰에서 역할 인자를 찾는다.
- `DUPLICATE_RULES`(`:178`)는 역할 잡 규칙과 dream 규칙 둘이고, 먼저 맞는 규칙 하나를 쓴다.
- `heartbeat_roles.rs:158`의 바이트 고정 테스트는 SPEC-003 완료 조건 12의 산물이고 조건 세 줄을
  리터럴로 담는다. 이 테스트는 `install_managed_jobs`만 거치므로 Windows에서도 지금 돈다.
- `heartbeat_service.rs:1609`의 `install_tests`는 `#[cfg(all(test, not(windows)))]`다. 주석이 사유를
  "설치는 POSIX `sh` 조건 스크립트를 전제하므로 지원 플랫폼에서만 검증한다"로 적고 있다.
- 하트비트는 조건을 `subprocess.run(condition, shell=True, ..., cwd=<slug 역변환 경로>)`으로 실행하고
  종료 코드가 0일 때만 잡을 깨운다. Windows에서 `shell=True`는 `cmd.exe`를 거친다.
- 하트비트는 조건 불충족과 조건 실행 실패를 구분해 기록하지 않는다. 둘 다 `last_result: "skipped"`다.
