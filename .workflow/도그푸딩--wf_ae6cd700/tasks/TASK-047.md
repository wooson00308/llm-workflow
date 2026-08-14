---
schema: workflow-labs/task@1
id: TASK-047
title: 선점 헬퍼를 공용 자산 규약으로 옮기고 PowerShell 구현과 동작 일치를 낸다
status: verified
source_spec_id: SPEC-015
source_decision_id: DECISION-EEEEB81D
depends_on:
- TASK-039
- TASK-042
updated_at: 2026-08-14T09:08:07.880257+00:00
history:
- at: 2026-08-03T06:50:00Z
  kind: created
- at: 2026-08-03T10:07:31Z
  kind: in_progress
- at: 2026-08-03T10:21:23Z
  kind: qa_waiting
- at: 2026-08-04T11:45:25.203475+00:00
  kind: completed
- at: 2026-08-14T09:08:07.880257+00:00
  kind: migrated_verified
work_group_id: GROUP-DECISION-EEEEB81D
work_group_revision: 1
---

# 선점 헬퍼를 공용 자산 규약으로 옮기고 PowerShell 구현과 동작 일치를 낸다

SPEC-015 R10을 구현한다. DECISION-73D4BC1B가 선점 헬퍼를 앱 관리 자산으로 도입하면서 "이번에는 POSIX
sh만, Windows 대응 시 헬퍼 포함 의무를 IDEA-54B29779 범위에 부채로 명시"로 확정했고, DECISION-2F71D20D가
그 부채를 이 기획서의 포함 범위로 못박았다. 이 작업이 그 부채를 갚는다.

TASK-042가 실행 자산의 설치 규약을 공용 모듈로 옮기고 조건 스크립트를 그 위에 세웠다. 이 작업은 선점
헬퍼를 같은 규약 위로 옮기고 PowerShell 구현을 더한다. 자산마다 플랫폼 분기 규칙을 새로 정하지 않는
것이 R1의 요구다.

## 의존성

- **선행 필수: TASK-039.** 옮길 `sh` 본문과 `claim_helper.rs`가 있어야 한다. R12·D5가 정한 순서이고,
  "옮기기 전에 옮길 것이 완성돼 있어야 한다"가 그 이유다. **선행이 반영되지 않은 상태에서 이 작업을
  시작하지 않는다.**
- **선행 필수: TASK-042.** 공용 자산 규약 모듈과 그 서술 형식이 있어야 한다. 코드 의존이다.
- **Windows 차단 해제(TASK-045)를 기다리지 않고, 그것도 이 작업을 기다리지 않는다**(D5·R12). 두 축은
  독립이다.
- `claim_helper.rs`만 만진다. TASK-039가 만든 `fs_project_repository.rs`의 설치 호출과 `mod.rs`의 모듈
  선언은 이 작업에서 바뀌지 않으므로, 그 파일들을 만지는 다른 계열 작업과 겹치지 않는다.

## 범위

- `src-tauri/src/infrastructure/claim_helper.rs` — 공용 규약으로 이전, PowerShell 본문 추가, 플랫폼
  분기, 테스트.
- 그 외 파일은 건드리지 않는다. 특히 `managed_script.rs`·`heartbeat_condition.rs`·
  `fs_project_repository.rs`·`mod.rs`·화면은 이 작업에서 바뀌지 않는다. 공용 모듈을 고쳐야 하는 상황이
  나오면 그것은 TASK-042의 서술이 자산 하나에만 맞았다는 뜻이므로, 고치되 조건 스크립트 쪽 동작이
  바뀌지 않는지 기존 테스트로 확인한다.

## 작업 내용

### 0. 먼저 읽을 제약

- **선점 헬퍼의 인터페이스를 이 작업이 다시 정하지 않는다**(R10·기획서 제외 범위). 하위 명령
  (`acquire`·`renew`·`release`), 인자, 종료 코드 여섯, 소유자 확인, `migration.lock` 존중, lease 스키마
  다섯 필드는 SPEC-013이 정했고 DECISION-73D4BC1B로 승인됐다. TASK-039의 "2. 헬퍼의 동작 계약" 절이
  그 단일 정의다. 옮기기 전에 그 절을 먼저 읽는다.
- **판정과 동작을 바꾸지 않는다.** PowerShell 구현은 TASK-039가 낸 `sh` 본문의 결론을 그대로 옮긴다.
- **버전 축은 조건 스크립트와 분리된 채로 유지한다**(R2·R10). 접두사는 `# claim_helper_version:`이고
  상수도 따로다. 한쪽 상수만 올려도 다른 쪽 설치본이 갱신 대상이 되지 않는다.
- **버전 번호는 헬퍼 두 구현이 공유한다**(R2).
- **저장소에 `scripts/wf-claim.*` 사본을 두지 않는다.** TASK-039가 그렇게 정했다. 헬퍼를 부르는 것은
  데몬이 아니라 세션이고, 세션은 설치본을 부른다.

### 1. 공용 규약으로 옮긴다

TASK-039가 `claim_helper.rs`에 만든 설치·검증·판정은 `heartbeat_condition.rs`의 복사본이다. TASK-042가
그 로직을 `managed_script.rs`로 옮겼으므로, 여기서는 자산 서술만 남긴다.

```rust
pub const CLAIM_HELPER_STEM: &str = "wf-claim";
const VERSION_PREFIX: &str = "# claim_helper_version:";
const CLAIM_HELPER_VERSION: u32 = 1;      // TASK-039가 정한 값
const CLAIM_HELPER_SH: &str = r#"..."#;   // TASK-039가 낸 본문
const CLAIM_HELPER_PS1: &str = r#"..."#;  // 이 작업이 내는 본문
```

- `label`은 "선점 헬퍼"다. `ClaimHelperError`의 문구가 TASK-039가 정한 것과 같게 나오도록 `label`이
  들어갈 자리를 맞춘다. 맞지 않으면 공용 오류 타입의 문구 형식을 고치되, 조건 스크립트 쪽 문구가
  바뀌지 않는지 TASK-042가 남긴 문구 단정 테스트로 확인한다.
- 공개 함수 시그니처(`claim_helper_path`·`install_claim_helper`·`validate_claim_helper`)와
  `ClaimHelperError` 이름은 그대로 둔다. `fs_project_repository.rs`의 호출과 `ProjectError`의
  `#[error(transparent)]` 배선을 건드리지 않기 위한 조건이다.
- TASK-039가 모듈 머리 주석에 남긴 "세 번째 관리 스크립트가 생기면 그때 묶는 편이 낫다"는 판단은
  이 작업으로 실행됐다. 그 주석을 현재 사실로 고친다.

### 2. PowerShell 본문 — 무엇을 옮기고 무엇을 정하는가

TASK-039의 계약을 그대로 옮긴다. 종료 코드 여섯(0 성공, 1 그 밖의 실패와 마이그레이션 락, 2 사용법
오류, 3 미만료 lease로 선점됨, 4 만료 lease 인수 경합 패배, 5 소유자 아님), `acquire` 성공 시 표준
출력에 `lease_id` 한 줄, 실패 메시지는 표준 오류, 문서 id가 `[A-Za-z0-9_-]` 밖의 문자를 포함하면 2.

`sh` 구현이 이식성 때문에 고른 방식들은 **결과가 같은 한** PowerShell에서 자연스러운 방식으로 바꿔도
된다. 대조하는 것은 종료 코드와 결과 lease 파일이지 구현 수단이 아니다.

- 시각 표기는 `sh` 구현과 같아야 한다. `%Y-%m-%dT%H:%M:%SZ` 고정 자리수 UTC다. 두 구현이 만든 lease를
  서로가 읽어야 하고, 앱의 `read_active_leases`도 읽는다.
- 만료 판정도 같은 규칙이다. 정규 표기가 아닌 `expires_at`은 **미만료로 다루고 3으로 끝낸다.** 남의
  lease를 판정하지 못할 때 인수하는 쪽이 더 위험하다는 TASK-039의 판단을 그대로 따른다.
- 배타 구간의 원자성은 그 플랫폼의 수단으로 만든다. `sh`는 `set -C` 리다이렉트와 `mkdir` 잠금을 썼다.
  PowerShell에서 같은 보장을 주는 수단을 쓰되, **잠금 디렉터리 이름을 `<문서-id>.yml.lock`으로
  맞춘다.** 두 구현이 서로 다른 잠금 이름을 쓰면 한 저장소를 두 플랫폼에서 열었을 때 상호 배제가
  성립하지 않는다. 확장자가 `yml`이 아니어야 앱의 `read_active_leases`와 조건 스크립트의 lease 검사
  어느 쪽에도 걸리지 않는다는 제약도 같다.
- 본문은 ASCII만 쓴다. 이유는 조건 스크립트의 PowerShell 본문과 같다(TASK-042 3절) — 설치 경로가 BOM
  없는 UTF-8로 쓰고, Windows PowerShell 5.1은 그런 `.ps1`을 시스템 코드페이지로 읽는다.
- 스크립트는 반드시 `exit <코드>`로 끝난다.
- 헬퍼는 lease 디렉터리 밖의 어떤 파일도 만들거나 고치지 않는다(SPEC-013 R7).

TASK-039가 헬퍼 머리 주석에 남기기로 한 두 사실(정규 표기 밖 `expires_at`에서 앱과 판정이 갈릴 수
있다는 것, `SIGKILL`로 잠금 디렉터리가 남을 수 있다는 것)을 PowerShell 본문에도 같은 뜻으로 적는다.

### 3. 동작 일치 테스트

R10이 요구하는 것은 종료 코드만이 아니다. 헬퍼는 파일을 만들고 지우므로, 결과 lease 파일의 존재
여부와 그 안의 `agent`·`lease_id`까지 대조한다.

시나리오는 최소한 아래를 덮는다. 각 행은 그 플랫폼의 설치본을 그 플랫폼의 방식으로 실행해 확인한다
(D2). 크로스 플랫폼 PowerShell을 깔아 대신하지 않는다.

- 비어 있는 대상 선점 → 0, lease 파일 생성, 표준 출력의 `lease_id`가 파일의 값과 같음
- 미만료 lease가 있는 대상 선점 → 3, 파일 내용 그대로
- 만료 lease 인수 → 0, `lease_id`·`agent`·`expires_at`이 새 값
- 인수 경합 패배(잠금이 이미 있음) → 4, 파일 그대로
- 소유자 불일치 갱신 → 5, 파일 그대로
- 소유자 불일치 해제 → 5, 파일 그대로
- 소유자 일치 갱신 → 0, `expires_at`만 미뤄지고 `agent`·`task_id`·`lease_id`는 그대로
- 소유자 일치 해제 → 0, 파일 사라짐
- 파일이 없는 대상의 갱신·해제 → 5
- `migration.lock` 존재 → 선점이 1이고 lease 파일이 만들어지지 않음
- 사용법 오류 → 2. 알 수 없는 하위 명령, 인자 수 부족, 양의 정수가 아닌 유효분, 경로 구분자가 든
  문서 id
- 성공한 선점 뒤 잠금 디렉터리가 남지 않음

실행 헬퍼는 TASK-043이 조건 스크립트에 만든 것과 같은 모양으로 만든다. Windows가 아니면
`sh <경로> <인자들>`, Windows면 `powershell -NoProfile -ExecutionPolicy Bypass -File <경로> <인자들>`이고
`current_dir`은 프로젝트 루트다. 표준 출력을 함께 받는다.

TASK-039가 만든 동작 테스트는 `#[cfg(unix)]`다. 그 게이트를 떼어 이 시나리오 표 안으로 흡수한다.
테스트가 줄지 않게 한다.

설치 규약 테스트(TASK-039의 일곱 개)는 자산 서술에서 경로와 본문을 받아 현재 플랫폼 자산을 대상으로
그대로 돈다. 더하는 것 둘이다.

- 다른 플랫폼용 헬퍼 파일이 같은 디렉터리에 있어도 설치가 그 파일을 건드리지 않는다.
- 헬퍼 두 본문의 버전 줄이 같고, 그 접두사가 조건 스크립트의 것과 다르며, 헬퍼 설치본이
  `condition_script_version`을 갖지 않는다.

### 4. 이 저장소에서 헬퍼를 돌리지 않는다

TASK-039가 정한 제약을 그대로 따른다. `.workflow/.runtime/leases/`에는 다음 세션이 읽을 실제 lease가
들어 있고, 실험용 선점이 그 자리에 남으면 다른 세션의 자격 판정을 막는다. 손으로 확인해야 하면 저장소
사본에서 한다.

## 완료 조건

1. 선점 헬퍼가 조건 스크립트와 같은 공용 설치 규약 위의 자산 서술로 표현되고, 공개 함수 시그니처와
   오류 문구가 TASK-039가 낸 것과 같다.
2. 현재 플랫폼이 Windows면 PowerShell 헬퍼가, 그 외 플랫폼에서는 `sh` 헬퍼가 설치된다.
   (기획서 완료 조건 25)
3. Windows 헬퍼가 SPEC-013이 정한 하위 명령과 종료 코드 계약을 그대로 지킨다.
   (기획서 완료 조건 25)
4. 두 구현이 R10의 시나리오에서 같은 종료 코드를 내고 같은 lease 상태(파일 존재 여부와
   `agent`·`lease_id`)를 남긴다. (기획서 완료 조건 26)
5. 헬퍼에도 관리 표기·버전 표기·다운그레이드 거부·멱등 설치·관리본 복원이 조건 스크립트와 같게
   적용된다. (기획서 완료 조건 27)
6. 헬퍼와 조건 스크립트의 버전 축이 분리된 채로 유지된다. 한쪽 상수를 올려도 다른 쪽 설치본이 갱신
   대상이 되지 않는다. (기획서 완료 조건 27)
7. 다른 플랫폼용 헬퍼가 같은 디렉터리에 있어도 설치가 그 파일을 만들거나 고치거나 지우지 않는다.
   (기획서 완료 조건 5·23의 헬퍼 몫)
8. TASK-039가 만든 설치·동작 테스트가 삭제·비활성화 없이 남고, 동작 테스트의 플랫폼 게이트가
   사라진다. (기획서 완료 조건 30)
9. `cargo fmt --check`·`cargo clippy -D warnings`·`cargo test`와 `npm run check`가 통과한다.
   (기획서 완료 조건 31)

## 검증 절차

```sh
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
npm run check
grep -n "cfg(unix)" src-tauri/src/infrastructure/claim_helper.rs
```

## 사용자 QA 항목

- 기획서 완료 조건 25의 실기 몫. Windows에서 헬퍼를 각 종료 코드가 나오는 상황으로 호출해 계약대로
  끝나는지. CI Windows 러너의 `cargo test`가 이 시나리오를 돌리므로 대부분 자동으로 닫히지만, 기본
  실행 정책 상태의 호출은 러너가 대신하지 못한다(TASK-045의 QA 항목 12와 같은 성질이다).

## 범위 밖

- 헬퍼의 인터페이스·종료 코드·소유자 확인·lease 스키마 규약. SPEC-013이 정했다.
- `sh` 헬퍼의 본문과 동작 변경. TASK-039의 산출물을 딛고 선다.
- 공통 규칙 §4와 역할 계약의 선점 서술, `docs/file-contract.md`의 lease 문단. SPEC-013의 규칙 문서
  갱신 작업(TASK-039·TASK-040이 TASK-041로 부르는 것)이고, 이 기획서의 범위가 아니다.
- 앱이 lease를 만들거나 지우거나 갱신하는 것, 만료 lease 자동 청소.
- 헬퍼 설치 시점과 호출 지점. TASK-039가 정했다.
- 조건 스크립트·잡 condition·중복 감지·Windows 차단 해제. TASK-042·TASK-044·TASK-045다.
- 잠금 디렉터리가 남았을 때의 자동 청소.
- 저장소에 `scripts/wf-claim.*` 사본을 두는 것.

## 참고 사실

확인 시점 2026-08-03. 추정 없이 파일에서 읽은 값이다.

- TASK-039가 정한 헬퍼 계약. 파일 이름 `wf-claim.sh`, 버전 표기 `# claim_helper_version:`, 하위 명령
  셋, 종료 코드 여섯, `acquire` 성공 시 표준 출력의 `lease_id` 한 줄, 문서 id가 `[A-Za-z0-9_-]` 밖의
  문자를 포함하면 2.
- TASK-039의 잠금 이름은 `<문서-id>.yml.lock`이고 lease 디렉터리 안에 만든다. 확장자가 `yml`이 아니라
  `read_active_leases`와 조건 스크립트의 lease 검사 어느 쪽에도 걸리지 않는다.
- TASK-039가 시각을 다루는 방법을 "비교는 문자열로, 계산만 epoch로"로 정했고, 표기는
  `%Y-%m-%dT%H:%M:%SZ`다.
- `ClaimHelperError`는 `ConditionScriptError`와 같은 다섯 갈래이고 문구만 선점 헬퍼를 가리킨다.
  `ProjectError`가 `#[error(transparent)]`로 받는다.
- `install_claim_helper`를 부르는 곳은 `fs_project_repository.rs`의 `create_workflow`·
  `record_spec_decision`·`record_task_qa` 셋이고, `validate_claim_helper`는 `create_workflow` 하나다.
- `read_active_leases`(`fs_project_repository.rs:568`)는 `.runtime/leases/` 아래 확장자가 `yml`인
  파일만 읽고, `expires_at`을 RFC3339로 읽지 못한 파일은 조용히 건너뛴다.
- 조건 스크립트는 lease를 파일 존재로만 본다. 만료를 보지 않는다.
- R10 마지막 줄이 정한 시한부 차이. 이 작업이 들어오기 전까지 Windows에는 헬퍼 파일이 없고, 그동안
  Windows 세션은 현행대로 직접 lease를 만든다. 이 작업이 그 차이를 없앤다.
