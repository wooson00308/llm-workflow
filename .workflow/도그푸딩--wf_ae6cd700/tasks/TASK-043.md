---
schema: workflow-labs/task@1
id: TASK-043
title: 조건 스크립트 두 구현과 앱 판정의 일치를 시나리오 표로 고정하고 Windows 러너에서 돌린다
status: completed
source_spec_id: SPEC-015
source_decision_id: DECISION-EEEEB81D
depends_on: [TASK-042]
updated_at: 2026-08-04T11:45:21.766935+00:00
history:
  - { at: 2026-08-03T06:50:00Z, kind: created }
  - { at: 2026-08-03T12:17:00Z, kind: in_progress }
  - { at: 2026-08-03T12:31:00Z, kind: qa_waiting }
  - { at: 2026-08-04T11:45:21.766935+00:00, kind: completed }
---

# 조건 스크립트 두 구현과 앱 판정의 일치를 시나리오 표로 고정하고 Windows 러너에서 돌린다

SPEC-015 R3을 구현한다. 같은 판정이 이제 세 곳에 있다. 조건 스크립트의 `sh` 구현, TASK-042가 낸
PowerShell 구현, 앱 안의 `role_eligibility.rs`다. 셋이 갈라지면 화면에서 정상으로 보인다 — 하트비트는
조건 불충족과 조건 실행 실패를 모두 `skipped`로 기록하고, 카드는 그 값을 "처리할 대상 없음"으로
번역한다.

갈라짐을 막는 장치는 새로 만들지 않는다. `role_eligibility.rs`가 이미 조건 스크립트를 실행해 자기
판정과 대조하는 헬퍼(`assert_matches_condition_script`)를 갖고 있다. 문제는 그 테스트가 전부
`#[cfg(unix)]`라 Windows 러너에서 한 줄도 컴파일되지 않는다는 것이다. 이 작업은 그 장치를 플랫폼으로
넓히고, 역할별 시나리오 표를 명시적인 데이터로 세운다.

## 의존성

- **선행 필수: TASK-042.** PowerShell 구현이 있어야 Windows에서 대조할 대상이 생긴다. 자산 서술에서
  경로와 확장자를 받아 실행 명령을 만들기 때문에 코드 의존도 있다.
- TASK-042가 TASK-040을 선행으로 두므로, 이 작업이 대조하는 판정에는 선행 선언 확인이 이미 들어 있다.
  개발자 시나리오의 선행 선언 항목(R3)이 그 위에 선다.
- `heartbeat_condition.rs`의 테스트 모듈과 `role_eligibility.rs`의 테스트 모듈만 만진다. 제품 코드는
  건드리지 않으므로 다른 계열 작업과 겹치는 파일이 없다.

## 범위

- `src-tauri/src/infrastructure/heartbeat_condition.rs` — 테스트 모듈. 플랫폼별 실행 헬퍼와 시나리오 표.
- `src-tauri/src/infrastructure/role_eligibility.rs` — 테스트 모듈. `#[cfg(unix)]` 제거와 헬퍼 공유.
- 그 외 파일은 건드리지 않는다. **두 모듈의 제품 코드도 바뀌지 않는다.** 이 작업은 테스트만 더한다.
  본문·판정·설치 규약을 고쳐야 하는 상황이 나오면 그것은 TASK-042의 결과가 틀렸다는 뜻이므로, 여기서
  고치지 말고 보고한다.

## 작업 내용

### 0. 먼저 읽을 제약

- **판정 기준을 바꾸지 않는다.** 이 작업이 대조에서 차이를 발견하면, 그것은 PowerShell 구현이 `sh`를
  잘못 옮겼다는 뜻이다. 고칠 쪽은 옮긴 쪽이지 원본이 아니다.
- **`role_eligibility.rs`의 알려진 차이 셋을 해소하지 않는다**(기획서 제외 범위). 본문까지 보는
  `grep`, `id:` 없는 문서 처리, 등록되지 않은 워크플로우 디렉터리다. 이 작업은 그 모듈의 대조 범위를
  플랫폼으로만 넓힌다.
- **크로스 플랫폼 PowerShell을 한 머신에 깔아 대신하지 않는다**(D2). 각 구현은 그 구현의 실제 대상
  런타임에서 돈다. Windows 구현은 Windows 러너에서 돈다.

### 1. 플랫폼별 실행 헬퍼

지금 `run_condition`이 두 곳에 같은 모양으로 복사돼 있다(`heartbeat_condition.rs:294`,
`role_eligibility.rs:118`). 하나로 합치고 플랫폼 분기를 그 안에 둔다. 두 곳이 서로 다른 명령으로
스크립트를 부르면 대조의 뜻이 사라진다.

```rust
#[cfg(test)]
pub(crate) mod test_support {
    /// 설치된 조건 스크립트를 그 플랫폼의 방식으로 실행하고 종료 코드를 돌려준다.
    pub(crate) fn run_condition(project_root: &Path, role: &str) -> i32
}
```

- Windows가 아니면 `sh <상대 경로> <role>`.
- Windows면 `powershell -NoProfile -ExecutionPolicy Bypass -File <상대 경로> <role>`.
- 상대 경로는 자산 서술의 `relative_path()`에서 받는다. 문자열을 다시 적지 않는다.
- `current_dir`은 프로젝트 루트다. 조건이 상대 경로를 쓰기 때문이다.

이 형태가 TASK-044가 관리 블록에 기록할 조건 명령과 같은 형태여야 한다. 두 곳이 갈리면 "테스트는
통과하는데 데몬은 못 돈다"가 된다. TASK-044는 이 형태를 조립하는 함수를 제품 코드에 만들고, 그때 이
헬퍼가 그 함수를 쓰도록 옮긴다 — 이 작업에서는 테스트 안에 둔다.

### 2. 시나리오 표

R3이 열거한 시나리오를 데이터로 세운다. 각 행은 픽스처를 만드는 방법과 역할별 기대 종료 코드다.
표를 코드로 흩어 놓지 않는 이유는 "이 표가 R3이 요구한 목록을 덮는가"를 사람이 한눈에 볼 수 있어야
하기 때문이다.

덮어야 하는 최소 목록이다.

- 기획자: 참조 없는 아이디어가 있음(0) / 모든 아이디어가 참조됨(1) / 참조 없는 아이디어에 lease가
  있음(1)
- 아키텍트: 후속 작업 없는 승인 결정이 있음(0) / 모든 승인 결정에 후속 작업이 있음(1) / 그 결정의
  기획서에 lease가 있음(1)
- 개발자: `todo` 작업이 있음(0) / `todo` 작업이 없음(1) / `todo` 작업에 lease가 있음(1) / 선행 선언이
  충족됨(0) / 충족되지 않음(1)
- 공통: 잘못된 인자로 2 / `migration.lock`이 있으면 역할과 무관하게 1

선행 선언 항목은 TASK-040이 도입한 판정을 대상으로 한다. 그 판정의 단일 정의는 TASK-037의
"2. 판정 규칙" 절이다. 픽스처를 만들기 전에 그 절과 TASK-040이 낸 `sh` 본문을 함께 읽는다.

기존 실행 테스트 넷(`installed_script_reports_eligible_work` 외)은 이 표와 겹치지만 지우지 않는다.
`#[cfg(unix)]`만 떼어 모든 플랫폼에서 돌게 한다(기획서 완료 조건 30).

### 3. 앱 판정 대조를 플랫폼으로 넓힌다

`role_eligibility.rs`의 `assert_matches_condition_script`와 그것을 쓰는 테스트 전부에서
`#[cfg(unix)]`를 뗀다. 헬퍼는 1절의 공용 것을 쓴다.

- 이 모듈의 픽스처는 `FileSystemProjectRepository::create_workflow`로 만든 실제 워크플로우다. 경로
  조립이 Windows에서도 성립하는지 확인한다. 실패하면 픽스처 쪽을 고치고, 판정이나 스크립트를 고치지
  않는다.
- `chrono::Utc::now()`를 쓰는 `future()` 헬퍼는 플랫폼과 무관하다.
- 게이트를 다시 넣지 않는다는 것을 사람이 알아볼 수 있게, 모듈 머리 주석의 "알려진 차이" 목록 아래에
  "이 대조는 세 플랫폼 러너에서 모두 돈다. 한 플랫폼에서만 도는 상태로 되돌리지 않는다"를 한 줄 적는다.

Windows에서만 재현할 수 없는 이유가 있는 개별 테스트가 나오면(예: 권한 조작), 모듈 전체가 아니라 그
테스트 하나만 게이트하고 사유를 주석으로 남긴다. 게이트가 모듈로 다시 넓어지는 것이 이 작업이 막으려는
바로 그 상태다.

### 4. Windows 러너 결과 확인

완료 조건 10은 "실제로 돌고 결과가 기록된다"를 요구한다. 로컬 한 대에서는 닫히지 않는다.

- 개발자 세션이 로컬에서 닫는 것: 게이트가 사라져 세 플랫폼 모두에서 **컴파일된다**는 것과, 자기
  플랫폼에서 표가 통과한다는 것.
- 남는 것: Windows 러너에서 그 테스트들이 skip이나 미컴파일이 아니라 실행·통과로 남았는지. PR CI의
  `Rust (windows-latest)` 잡 로그를 볼 수 있으면 보고 결과를 보고서에 적는다. 볼 수 없으면 "확인하지
  못했다"를 보고서에 적고 QA 항목으로 남긴다. **자동화 테스트가 로컬에서 통과했다는 것으로 이 항목을
  대신하지 않는다.**

## 완료 조건

1. 조건 스크립트를 실행하는 테스트 헬퍼가 한 곳에 있고 플랫폼에 맞는 명령을 고른다. 두 모듈이 같은
   헬퍼를 쓴다.
2. R3이 열거한 역할별·공통 시나리오가 표로 존재하고, 각 행에서 그 플랫폼의 조건 스크립트 종료 코드가
   기대값과 같다. (기획서 완료 조건 6)
3. 잘못된 인자에 종료 코드 2가 나온다. (기획서 완료 조건 7)
4. `migration.lock`이 있으면 역할과 무관하게 1이 나온다. (기획서 완료 조건 8)
5. `role_eligibility.rs`의 동치 테스트가 `#[cfg(unix)]` 없이 컴파일되고, 각 플랫폼에서 그 플랫폼의
   조건 스크립트와 같은 결론을 낸다. (기획서 완료 조건 9)
6. 선행 선언이 충족된 경우와 충족되지 않은 경우가 표에 있고, 두 경우의 종료 코드가 TASK-037의 판정
   규칙과 같다. (기획서 완료 조건 28의 판정 몫)
7. 기존 조건 스크립트 실행 테스트 넷과 `role_eligibility.rs`의 기존 테스트가 삭제·비활성화 없이 남고
   플랫폼 게이트만 사라진다. (기획서 완료 조건 30)
8. `cargo fmt --check`·`cargo clippy -D warnings`·`cargo test`와 `npm run check`가 통과한다.
   (기획서 완료 조건 31)

## 검증 절차

```sh
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
npm run check
```

게이트가 남아 있지 않은지 눈으로 확인한다.

```sh
grep -n "cfg(unix)" src-tauri/src/infrastructure/role_eligibility.rs
grep -n "cfg(unix)" src-tauri/src/infrastructure/heartbeat_condition.rs
```

## 사용자 QA 항목

아래는 개발자 세션이 자동화 테스트 통과로 대신 닫지 않는다.

- 기획서 완료 조건 10. CI의 `Rust (windows-latest)` 잡 로그에서 시나리오 표와 앱 판정 대조 테스트가
  실행·통과로 남았는지. skip이나 미컴파일이면 이 작업은 목적을 이루지 못한 것이다.

## 범위 밖

- 제품 코드의 어떤 변경도. 본문·판정·설치 규약은 TASK-042가 낸 그대로 둔다.
- 잡의 `condition` 문자열을 만드는 제품 코드. TASK-044다.
- Windows 차단 해제. TASK-045다.
- 선점 헬퍼의 동작 일치. TASK-047이다.
- `role_eligibility.rs`의 판정 규칙 변경과 알려진 차이 셋의 해소.
- `frontend` CI 잡을 Windows로 늘리는 것(기획서 제외 범위).
- CI 워크플로우 파일 수정. 러너는 이미 있고 이 작업은 그 러너가 돌릴 테스트를 만든다.

## 참고 사실

확인 시점 2026-08-03. 추정 없이 파일에서 읽은 값이다.

- `role_eligibility.rs`의 테스트에서 `#[cfg(unix)]`가 붙은 자리는 헬퍼 둘(`:117`·`:132`)과 테스트
  열넷(`:206`·`:215`·`:225`·`:235`·`:250`·`:271`·`:289`·`:312`·`:328`·`:349`·`:367`·`:393`·`:442`)이다.
- `assert_matches_condition_script`(`:133`)는 `FileSystemProjectRepository::inspect`의
  `pending_work`와 스크립트 종료 코드를 세 역할 모두에 대해 대조한다.
- 모듈 머리 주석이 스크립트와의 알려진 차이 셋을 이미 적어 두고 있다.
- `heartbeat_condition.rs`의 `run_condition`(`:294`)과 `role_eligibility.rs`의 것(`:118`)은 같은
  코드다. 둘 다 `Command::new("sh")`로 시작한다.
- 조건 스크립트 실행 테스트 넷은 `:307`·`:323`·`:342`·`:351`이다.
- CI `rust` 잡은 세 러너 매트릭스이고 `fail-fast: false`라 한 러너가 실패해도 나머지 결과가 남는다.
- v0.1.6 핫픽스 두 건(`7de81af`·`7b6fc69`)이 모두 이 사각지대에서 나왔다. Windows 러너에서 조건
  관련 코드가 컴파일되지 않거나 경로 표기가 갈린 문제였다.
