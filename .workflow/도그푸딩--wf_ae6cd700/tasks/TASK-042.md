---
schema: workflow-labs/task@1
id: TASK-042
title: 실행 자산 설치 규약을 플랫폼별 자산으로 일반화하고 조건 스크립트의 PowerShell 구현을 낸다
status: completed
source_spec_id: SPEC-015
source_decision_id: DECISION-EEEEB81D
depends_on: [TASK-040]
updated_at: 2026-08-03T12:42:56Z
history:
  - { at: 2026-08-03T06:50:00Z, kind: created }
  - { at: 2026-08-03T09:30:00Z, kind: in_progress }
  - { at: 2026-08-03T09:52:00Z, kind: qa_waiting }
---

# 실행 자산 설치 규약을 플랫폼별 자산으로 일반화하고 조건 스크립트의 PowerShell 구현을 낸다

SPEC-015 R1·R2·R9를 구현한다. 지금 앱이 `.workflow/rules/`에 설치하는 실행 자산은 POSIX `sh` 하나뿐이고,
그 설치 규약이 `heartbeat_condition.rs` 안에 자산 하나짜리로 굳어 있다. TASK-039가 두 번째 자산
(`wf-claim.sh`)을 같은 규약의 복사본으로 만들면서 "세 번째 관리 스크립트가 생기면 그때 묶는 편이 낫다"를
모듈 머리 주석에 남겼고, 이 기획서가 자산을 넷(조건 스크립트 `sh`·`ps1`, 선점 헬퍼 `sh`·`ps1`)으로 늘리므로
그 "그때"가 여기서 온다.

이 작업은 규약을 공용 모듈로 옮기고, 조건 스크립트를 그 규약 위의 첫 자산으로 다시 세우면서 PowerShell
구현을 더한다. 선점 헬퍼를 같은 규약으로 옮기는 것은 TASK-047이다.

## 의존성

- **선행 필수: TASK-040.** R12가 정한 순서다. TASK-040이 `developer` 분기에 선행 선언 확인을 더하고
  `CONDITION_SCRIPT_VERSION`을 1에서 2로 올린다. 그 전에 PowerShell 본문을 내면 태어나는 순간 낡은
  판정을 담고, TASK-043의 일치 시나리오 표를 깨뜨린다. **선행이 반영되지 않은 상태에서 이 작업을
  시작하지 않는다.** 선행 선언을 읽는 조건 스크립트 자체가 TASK-040의 산출물이라, 그것이 반영되기
  전에는 하트비트가 이 선언을 보지 못하고 세션에게 이 작업을 줄 수 있다. 그때는 문서의 이 줄이
  유일한 방어선이다.
- **TASK-039와 병행 금지.** 둘 다 `src-tauri/src/infrastructure/mod.rs`에 모듈 선언 한 줄을 더한다.
  코드 의존은 없고 순서는 어느 쪽이 먼저여도 된다.
- 이 작업의 산출물(공용 규약 모듈, 조건 스크립트의 stem·상대 경로·조건 명령)을 TASK-043·TASK-044·
  TASK-047이 쓴다.
- `heartbeat_roles.rs`·`heartbeat_status.rs`·`heartbeat_service.rs`·`role_eligibility.rs`·화면을
  건드리지 않으므로 SPEC-009·SPEC-011·SPEC-012 계열 작업과 겹치는 파일이 없다.

## 범위

- `src-tauri/src/infrastructure/managed_script.rs` — 신규. 실행 자산 서술과 공용 설치·검증·판정.
- `src-tauri/src/infrastructure/heartbeat_condition.rs` — 자산 서술로 축소, PowerShell 본문 추가,
  플랫폼 분기, `stem`·상대 경로·조건 명령의 공개.
- `src-tauri/src/infrastructure/mod.rs` — 모듈 선언 1줄.
- 그 외 파일은 건드리지 않는다. 특히 `heartbeat_roles.rs`·`heartbeat_status.rs`·
  `heartbeat_service.rs`·`role_eligibility.rs`·`claim_helper.rs`·`scripts/wf-eligible.sh`·화면은 이
  작업에서 바뀌지 않는다.

## 작업 내용

### 0. 먼저 읽을 제약

- **판정 기준을 바꾸지 않는다**(기획서 제외 범위 첫 줄). PowerShell 구현은 TASK-040이 낸 그 시점의
  `sh` 본문이 내는 결론을 그대로 옮긴다. "옮기면서 고치기"는 여기서 하지 않는다. 판정 기준을 손보자는
  건은 IDEA-C95EABD2로 따로 있다.
- **앱은 여전히 아무것도 실행하지 않는다**(기획서 제외 범위). 이 작업은 파일만 쓴다. 설치한 스크립트를
  앱이 실행하는 경로는 테스트 밖에 만들지 않는다.
- **설치 액션은 현재 플랫폼의 자산만 쓴다**(R2). 다른 플랫폼용 자산이 같은 디렉터리에 있어도 읽거나
  고치거나 지우지 않는다.
- **버전 번호는 한 자산의 두 구현이 공유한다**(R2). 같은 판정을 담은 두 파일이 서로 다른 버전을 갖는
  상태를 만들지 않는다.
- **자산끼리는 버전 축을 공유하지 않는다**(R2). 조건 스크립트와 선점 헬퍼는 SPEC-013이 분리해 둔 대로
  각자의 접두사와 상수를 갖는다.
- **`scripts/wf-eligible.ps1` 사본을 만들지 않는다**(기획서 제외 범위). 저장소 사본 두 벌 정리는
  SPEC-002에서 별건으로 미뤄져 있고, TASK-040이 `scripts/wf-eligible.sh`만 `sh` 본문과 맞춘다.

### 1. 공용 모듈 — 무엇을 묶고 무엇을 남기는가

`managed_script.rs`는 "앱이 `.workflow/rules/`에 설치하는 실행 자산"의 설치 규약만 갖는다. 자산의
본문·이름·버전은 각 자산 모듈이 서술로 넘긴다.

```rust
/// 앱이 `.workflow/rules/`에 설치하는 실행 자산 하나.
pub struct ManagedScript {
    /// 확장자를 뺀 파일 이름. 구현을 가리지 않고 자산을 식별해야 하는 곳(중복 감지)이 쓴다.
    pub stem: &'static str,
    /// 오류 문구에 들어갈 자산 이름. "조건 스크립트" | "선점 헬퍼".
    pub label: &'static str,
    /// 버전 표기 접두사. 자산마다 다르다 — 이것이 버전 축의 분리다.
    pub version_prefix: &'static str,
    /// 두 구현이 공유하는 버전.
    pub version: u32,
    /// 현재 플랫폼에 설치할 구현.
    pub platform: PlatformScript,
}

/// 한 플랫폼용 구현. 확장자와 본문만 다르다.
pub struct PlatformScript {
    pub extension: &'static str,
    pub body: &'static str,
}

impl ManagedScript {
    pub fn path(&self, control_root: &Path) -> PathBuf;
    /// 프로젝트 루트 기준 상대 경로. 항상 `/` 구분자다.
    pub fn relative_path(&self) -> String;
    pub fn install(&self, control_root: &Path) -> Result<(), ManagedScriptError>;
    pub fn validate(&self, control_root: &Path) -> Result<(), ManagedScriptError>;
}
```

옮기는 것은 `heartbeat_condition.rs`의 `RULES_DIRECTORY`·`MANAGED_MARKER`·`plan_*`·
`ensure_regular_file`·`write_text_atomically`와 그 판정 다섯이다. 판정 규칙은 한 글자도 바꾸지 않는다
(R2): 파일이 없으면 설치, 관리 마커가 없으면 오류, 버전 줄을 읽지 못하면 오류, 설치본 버전이 앱
상수보다 크면 오류, 내용이 같으면 쓰지 않음, 관리본이 어긋나 있으면 앱 본문으로 되돌림. 쓰기는 같은
디렉터리의 임시 파일을 거쳐 원자적으로 옮긴다.

`relative_path()`가 `/`로만 조립되는 것은 `7b6fc69` 핫픽스가 고정한 사실이다. `Path`를 거쳐 만든 값을
Windows에서 그대로 쓰면 `\`가 섞인다.

**오류 타입.** `ManagedScriptError`는 `ConditionScriptError`와 같은 다섯 갈래
(`NotRegularFile`·`Unmanaged`·`Downgrade`·`Io`·`Persist`)이고, 문구에 `label`을 끼운다. 조건
스크립트에 대해서는 **지금과 바이트 단위로 같은 문자열이 나와야 한다.** `label`이 들어갈 자리를 그렇게
잡는다. 사용자에게 보이는 문구가 이 리팩터링으로 바뀌면 안 된다.

`heartbeat_condition.rs`는 `pub type ConditionScriptError = ManagedScriptError;`로 이름만 이어 준다.
`heartbeat_service.rs`의 `#[from]` 배선(`HeartbeatInstallError`)과 `install_condition_script`·
`validate_condition_script`·`condition_script_path`의 시그니처는 바뀌지 않는다. 이 작업이 호출처를
건드리지 않기 위한 조건이다.

### 2. 조건 스크립트 자산 서술

```rust
pub const CONDITION_SCRIPT_STEM: &str = "wf-eligible";
const VERSION_PREFIX: &str = "# condition_script_version:";
const CONDITION_SCRIPT_VERSION: u32 = 2;   // TASK-040이 올린 값을 그대로 쓴다
const CONDITION_SCRIPT_SH: &str = r#"..."#;    // TASK-040이 낸 본문
const CONDITION_SCRIPT_PS1: &str = r#"..."#;   // 이 작업이 내는 본문
```

플랫폼 선택은 컴파일 시점 분기다(`#[cfg(windows)]` / `#[cfg(not(windows))]`). 런타임 분기가 아니다 —
앱은 자기가 도는 플랫폼의 자산만 쓴다(R2).

두 본문 상수는 플랫폼과 무관하게 항상 컴파일한다. TASK-043의 버전 줄 대조와 이 작업의 대조 테스트가
둘 다 필요하기 때문이다. 현재 플랫폼이 쓰지 않는 상수는 비테스트 빌드에서 미사용이지만 이 모듈에는
이미 `#![allow(dead_code)]`가 있다.

`CONDITION_SCRIPT_STEM`을 `pub`으로 낸다. TASK-044의 중복 감지가 확장자를 가리지 않고 이 값으로
역할 잡을 식별한다.

### 3. PowerShell 본문 — 무엇을 옮기고 무엇을 옮기지 않는가

**인터페이스는 `sh` 구현과 같다**(R1). 인자는 `planner` | `architect` | `developer` 하나, 종료 코드는
`0`(대상 있음) / `1`(없음) / `2`(잘못된 사용법)이고, `.workflow/.runtime/migration.lock`이 있으면 역할과
무관하게 `1`이다. 프로젝트 루트에서 실행하는 것을 전제로 모든 경로가 상대 경로다.

**`sh` 구현의 성질을 그대로 옮긴다.** 아래 다섯은 "버그"처럼 보이지만 고치지 않는다. 고치면
`role_eligibility.rs`가 머리 주석에 적어 둔 알려진 차이가 플랫폼마다 달라지고, TASK-043의 대조가 한쪽
플랫폼에서만 깨진다.

- `grep`은 파일 아무 곳이나 본다. 프론트매터만 보지 않는다. 본문에 열 0으로 적힌 예시도 실제 값처럼
  잡힌다.
- 참조 검사는 부분 일치다. `source_idea_id: *IDEA-1`이 `IDEA-10`에도 걸린다. 앵커를 더하지 않는다.
- `id:` 줄이 없는 문서는 건너뛴다.
- `.workflow/*/` 아래를 전부 본다. `project.yml`에 등록됐는지 보지 않는다.
- lease는 파일 존재만 본다. 만료를 보지 않는다.

**PowerShell 쪽 제약 셋을 이 작업이 정한다.**

- **본문은 ASCII만 쓴다. 한국어 주석을 넣지 않는다.** 설치 경로가 BOM 없는 UTF-8로 파일을 쓰는데
  (`write_text_atomically`), Windows PowerShell 5.1은 BOM 없는 `.ps1`을 시스템 코드페이지로 읽는다.
  비ASCII 문자가 들어가면 본문이 깨지고, 문자열 리터럴 안에 들어가 있었다면 판정까지 바뀐다. `sh`
  본문은 한국어 주석을 그대로 갖는다 — 두 본문이 주석까지 같을 필요는 없다.
- **판정 로직을 조건 문자열이 아니라 파일에 담는다**(D1). 이건 TASK-044가 쓰는 조건 명령의 전제다.
  일치 테스트가 대조할 대상이 파일이어야 한다.
- **스크립트는 반드시 `exit <코드>`로 끝난다.** PowerShell의 마지막 식 값이 종료 코드가 되게 두지
  않는다. 예외가 나면 PowerShell이 0이 아닌 코드로 끝나므로 fail-closed 쪽으로 떨어진다.

버전 줄은 두 본문 모두 `# condition_script_version: <N>` 한 줄로 갖고 값이 같다. PowerShell도 `#`가
주석이라 관리 표기 두 줄의 모양이 `sh`와 같다.

### 4. 테스트

기존 설치 테스트 여섯 개(`heartbeat_condition.rs:198`~`:291`)는 삭제하지 않는다. 자산 서술에서 경로와
본문을 가져오게 바꾸면 현재 플랫폼의 자산을 대상으로 그대로 돈다. `installs_condition_script_with_managed_markers`의
버전 문자열 기대값은 TASK-040이 이미 2로 올려 두었을 값이다.

기존 실행 테스트 넷(`:307`~`:367`)은 이 작업에서 `#[cfg(unix)]`인 채로 둔다. 플랫폼별 실행과 시나리오
표는 TASK-043이다.

더하는 테스트:

- 현재 플랫폼이 Windows면 `.workflow/rules/wf-eligible.ps1`이, 아니면 `wf-eligible.sh`가 설치된다.
  (완료 조건 2)
- 다른 플랫폼용 자산 파일을 미리 만들어 둔 상태에서 설치하면, 그 파일이 바이트 단위로 그대로이고
  수정 시각도 같다. 설치는 성공하고 경고나 오류가 아니다. (완료 조건 5)
- 두 본문이 모두 `# managed_by: workflow-labs`를 갖고, 두 본문의 버전 줄이 서로 같으며, 그 값이
  `CONDITION_SCRIPT_VERSION`과 같다. (완료 조건 6)
- PowerShell 본문이 ASCII다(`is_ascii()`). (완료 조건 6)
- 조건 스크립트의 `version_prefix`가 선점 헬퍼의 것과 다르다. 이 작업 시점에 `claim_helper.rs`가
  아직 없으면 이 항목은 TASK-047로 넘기고 여기서는 조건 스크립트 접두사가 자산 서술에서 온다는 것만
  고정한다.
- 조건 스크립트 오류 문구가 리팩터링 전과 같다. 관리되지 않은 파일·상위 버전 파일 각각에 대해
  `to_string()` 결과를 문자열로 단정한다.

## 완료 조건

1. 두 실행 자산이 쓸 공용 설치 규약이 한 모듈에 있고, 조건 스크립트가 그 위의 자산 서술로 표현된다.
   조건 스크립트의 공개 함수 시그니처와 오류 문구가 이 작업 전후로 같다.
2. 현재 플랫폼이 Windows면 PowerShell 구현이, 그 외 플랫폼에서는 `sh` 구현이 설치된다.
   (기획서 완료 조건 1·2)
3. 관리 표기가 없는 파일, 버전 줄을 읽을 수 없는 파일, 앱보다 높은 버전의 파일을 덮어쓰지 않고
   실패하며 그 파일이 변경되지 않는다. (기획서 완료 조건 3)
4. 같은 설치를 두 번 실행해도 자산 파일의 내용과 수정 시각이 같다. (기획서 완료 조건 4)
5. 다른 플랫폼용 자산이 같은 디렉터리에 있어도 설치가 그 파일을 만들거나 고치거나 지우지 않고, 그
   상태가 오류나 경고가 아니다. (기획서 완료 조건 5·23)
6. 조건 스크립트 두 구현의 버전 줄이 같은 상수에서 나오고, PowerShell 본문이 ASCII이며 관리 표기
   두 줄을 갖는다. (기획서 완료 조건 28의 버전 몫)
7. 기존 Rust·프런트엔드 테스트가 삭제·비활성화 없이 통과한다. 버전 상수와 오류 타입 이름 변경 때문에
   기대값을 고쳐야 하는 테스트는 고치되, 검증하던 사실이 줄지 않는다. (기획서 완료 조건 30)
8. `cargo fmt --check`·`cargo clippy -D warnings`·`cargo test`와 `npm run check`가 통과한다.
   (기획서 완료 조건 31)

## 검증 절차

```sh
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
npm run check
```

이 저장소의 설치본 `.workflow/rules/wf-eligible.sh`를 손으로 고치지 않는다. 앱 관리 자산이라 다음
하트비트 설치에서 갱신된다.

## 범위 밖

- 잡의 `condition` 문자열 조립과 화면이 보여주는 경로. TASK-044다.
- 관리 블록 밖 중복 잡 감지 규칙. TASK-044다.
- Windows 차단 해제(`PLATFORM_SUPPORTED`·미지원 배너·설치 경로의 플랫폼 거부). TASK-045다.
- 두 구현의 판정 일치 시나리오 표와 `role_eligibility.rs`의 플랫폼 확장. TASK-043이다.
- 선점 헬퍼(`claim_helper.rs`)를 공용 규약으로 옮기는 것과 그 PowerShell 구현. TASK-047이다.
- 판정 기준 변경, `role_eligibility.rs`가 적어 둔 알려진 차이 셋의 해소.
- `scripts/` 아래 저장소 사본을 플랫폼별로 늘리는 것과 `docs/heartbeat.md` 개정.
- 하트비트 패키지의 조건 실행 방식·slug 역변환·`skipped` 기록 세분화.

## 참고 사실

확인 시점 2026-08-03. 추정 없이 파일에서 읽은 값이다.

- `heartbeat_condition.rs`의 현재 구조. 상수(`:14`~`:18`), 본문(`:24`), 오류(`:87`), 경로(`:105`),
  설치(`:112`), 검증(`:122`), 판정(`:127`), 일반 파일 확인(`:155`), 원자적 쓰기(`:164`),
  테스트(`:198`~`:367`).
- `install_condition_script`를 부르는 곳은 `heartbeat_service.rs:351` 하나이고 역할 잡 설치
  경로다. `validate_condition_script`를 부르는 곳은 없다.
- `condition_script_path`를 부르는 곳은 `heartbeat_service.rs:725`
  (`condition_script_relative_path`)와 두 테스트 모듈이다.
- `ConditionScriptError`는 `HeartbeatInstallError`가 `#[from]`으로 받는다. 그 밖의 호출처에서 이
  타입의 문구를 문자열로 단정하는 코드는 없다.
- `mod.rs`는 여덟 줄짜리 모듈 선언 목록이고 `pub mod heartbeat_condition;`이 그중 하나다.
- 조건 스크립트 실행 테스트 넷은 `#[cfg(unix)]`이고 헬퍼는 `run_condition`(`:294`)이다. v0.1.6 핫픽스
  `7de81af`가 unix 전용 import를 cfg로 가둔 것이 이 자리다.
- `7b6fc69`는 조건 스크립트 경로를 모든 플랫폼에서 POSIX 표기로 유지한 핫픽스다.
- CI `rust` 잡은 `ubuntu-22.04`·`windows-latest`·`macos-latest` 매트릭스이고 `fail-fast: false`다.
  세 러너 모두 `cargo fmt --check`·`cargo clippy -D warnings`·`cargo test`를 돌린다.
- TASK-039가 `claim_helper.rs`를 만들면서 두 모듈의 설치 로직을 묶지 않기로 하고, 그 판단("세 번째
  관리 스크립트가 생기면 그때 묶는 편이 낫다")을 모듈 머리 주석에 남기기로 했다.
