# TASK-043 개발자 핸드오프

- 대상 작업: TASK-043 (조건 스크립트 두 구현과 앱 판정의 일치를 시나리오 표로 고정하고 Windows
  러너에서 돌린다)
- 근거 문서: SPEC-015 R3, DECISION-EEEEB81D (approved, created_by: user)
- 세션 역할: 개발자
- 작성 시각: 2026-08-03T12:30Z
- 상태: `qa_waiting`

## 대상 선정 근거

- 착수 시점(12:16Z) `todo`는 TASK-043·048·049·050·057·058·059·060 여덟 건이고, 그중 선행 선언이
  충족된 것은 TASK-043(`depends_on: [TASK-042]` → `qa_waiting`), TASK-048(`[TASK-045]` →
  `qa_waiting`), TASK-057(`[TASK-056]` → `qa_waiting`), TASK-060(`[TASK-056]` → `qa_waiting`)
  넷이다. 공통 규칙 §3의 "한 번에 한 건"에 따라 id가 가장 작은 TASK-043 하나만 처리했다.
- 나머지 넷(049·050·058·059)은 선행이 `todo`라 미충족이다. 개발자 계약대로 `blocked`으로 바꾸지
  않고 그대로 두었다.
- `migration.lock` 없음. 착수 시점 `leases/`에는 `SPEC-009.yml`(만료, 01:20Z) 하나뿐이라 이 작업을
  덮는 lease는 없었다. 그 파일은 내 것이 아니므로 손대지 않았다.
- 소스 결정 DECISION-EEEEB81D는 `approved`로 유효하다.
- 선점: `.workflow/rules/wf-claim.sh`가 아직 설치돼 있지 않아(설치되는 파일은
  `wf-eligible.sh` 한 벌) 공통 규칙 §4의 예전 절차를 썼다. `leases/TASK-043.yml`을 `set -C`
  배타 생성 → 즉시 `status: in_progress` + `history` 기록 → 구현 → 검증 → `qa_waiting` → 반납.
  작업 중 한 번 갱신했다(12:22Z).

## 변경한 파일 (2건, 작업 범위 그대로)

- `src-tauri/src/infrastructure/heartbeat_condition.rs` — 테스트 전용. `test_support` 모듈 신설,
  `mod tests`의 `#[cfg(unix)]` 27개 제거, R3 시나리오 표와 그 표를 도는 테스트 1건 추가.
- `src-tauri/src/infrastructure/role_eligibility.rs` — 테스트 전용 + 모듈 머리 주석 한 줄.
  `#[cfg(unix)]` 29개 제거, 중복 `run_condition` 삭제 후 공용 헬퍼 사용.

**제품 코드는 한 줄도 바뀌지 않았다.** 두 모듈의 판정 함수, 스크립트 두 본문, 설치 규약, 자산
서술 모두 그대로다. 작업 문서의 "범위 밖"대로 `heartbeat_roles.rs`·`heartbeat_status.rs`·
`heartbeat_service.rs`·`managed_script.rs`·`claim_helper.rs`·`scripts/wf-eligible.sh`·화면·CI
워크플로우 파일은 열어 보기만 하고 건드리지 않았다.

## 구현 결정

### 1. 실행 헬퍼를 `heartbeat_condition::test_support`에 두었다

작업 문서가 요구한 시그니처 그대로다.

```rust
#[cfg(test)]
pub(crate) mod test_support {
    pub(crate) fn run_condition(project_root: &Path, role: &str) -> i32
}
```

- 자산을 소유한 모듈에 두었다. 상대 경로를 `CONDITION_SCRIPT.relative_path()`에서 받으므로 파일
  이름 문자열이 테스트 쪽에 다시 생기지 않는다(그랬으면 그것이 세 번째 사본이 된다).
- `role_eligibility.rs`가 갖고 있던 같은 모양의 `run_condition`은 삭제하고 이 헬퍼를 쓴다. 두
  모듈이 같은 명령으로 스크립트를 부른다.
- **플랫폼 분기를 `#[cfg]`가 아니라 `cfg!(windows)`로 썼다.** 두 갈래가 모든 러너에서 컴파일되기
  때문이다. `#[cfg]`로 쓰면 "Windows 갈래가 Windows에서만 컴파일된다"가 되어, 이 작업이 없애려는
  상태(한 플랫폼에서만 컴파일되는 조건 관련 코드)를 헬퍼 자신이 다시 만든다.
- Windows 호출 형태는 `powershell -NoProfile -ExecutionPolicy Bypass -File <상대 경로> <role>`이고
  D1이 요구한, 실행 정책을 시스템이 아니라 그 호출 하나에만 지나가는 형태다. TASK-044가 관리
  블록에 적을 `condition`과 같은 형태여야 한다는 작업 문서의 요구를 이 문자열이 그대로 만족한다.
  TASK-044가 제품 코드에 조립 함수를 만들면 이 헬퍼가 그것을 쓰도록 옮기면 된다 — 그 인계를
  헬퍼 주석에 적어 두었다.
- `current_dir`은 프로젝트 루트다. 조건이 상대 경로를 쓰기 때문이다.

### 2. 시나리오 표

`SCENARIOS: &[Scenario]` 상수 한 곳에 데이터로 세웠다. 행은 `{ name, roles, expected, build }`이고
`build: fn(&Path)`가 컨트롤 루트 아래에 픽스처를 만든다. 테스트는
`the_installed_script_matches_the_scenario_table` 하나이고 행마다 새 임시 프로젝트를 만들어 그
플랫폼에 설치된 구현을 돌린다.

R3 목록과 표의 대응이다. 열넷 중 열둘이 R3이 열거한 최소 목록이다.

| # | 행 | 역할 | 기대 |
| --- | --- | --- | --- |
| 1 | 참조 없는 아이디어가 있다 | planner | 0 |
| 2 | 모든 아이디어가 참조됐다 | planner | 1 |
| 3 | 참조 없는 아이디어에 lease가 있다 | planner | 1 |
| 4 | 후속 작업 없는 승인 결정이 있다 | architect | 0 |
| 5 | 모든 승인 결정에 후속 작업이 있다 | architect | 1 |
| 6 | 그 결정의 기획서에 lease가 있다 | architect | 1 |
| 7 | `todo` 작업이 있다 | developer | 0 |
| 8 | `todo` 작업이 없다 | developer | 1 |
| 9 | `todo` 작업에 lease가 있다 | developer | 1 |
| 10 | 선행 선언이 충족됐다 | developer | 0 |
| 11 | 선행 선언이 충족되지 않았다 | developer | 1 |
| 12 | 잘못된 인자 | (reviewer) | 2 |
| 13 | `migration.lock`이 있다 | 세 역할 모두 | 1 |
| 14 | 본문이 빈 문서만 있다 | 세 역할 모두 | 1 |

- **10·11번은 TASK-040이 도입한 판정을 본다.** 규칙의 단일 정의인 TASK-037 "2. 판정 규칙" 절과
  TASK-040이 낸 `sh` 본문을 함께 읽고 세웠다. 11번은 선행(TASK-002)이 자기 자격으로 표를 통과해
  버리지 않도록 lease로 제외했다 — 기존 선언 테스트들이 쓰는 방법과 같다.
- **12번 픽스처에는 `todo` 작업을 하나 둔다.** 처리할 대상이 있는 저장소에서 2가 나와야, 그 2가
  상태가 아니라 인자 때문이라는 것이 분명해진다.
- **14번은 R3 목록 밖이고 TASK-042의 인계 사항 2번을 받은 것이다.** PowerShell 구현의 `Get-Lines`가
  빈 배열을 돌려줄 때 PowerShell이 `$null`로 언롤하는 성질에 기대고 있으니 그 경로를 표에서 꼭
  덮으라는 요청이었다. 네 종류 디렉터리에 빈 `.md`를 하나씩 두면 세 역할이 모두 그 경로를 탄다.
- 기존 실행 테스트 넷(`installed_script_reports_eligible_work` 외)은 표와 겹치지만 지우지 않았다.
  플랫폼 게이트만 뗐다(기획서 완료 조건 30).

### 3. 앱 판정 대조를 플랫폼으로 넓혔다

- `role_eligibility.rs`의 `assert_matches_condition_script`와 그것을 쓰는 테스트 전부에서
  `#[cfg(unix)]`를 뗐다. 픽스처 헬퍼(`project_with_leases`·`read_lease_directory`)도 같다.
- 모듈 머리 주석의 "알려진 차이" 목록 아래에 한 줄을 적었다. "이 대조는 세 플랫폼 러너에서 모두
  돈다. 한 플랫폼에서만 도는 상태로 되돌리지 않는다."
- **개별 테스트를 다시 게이트한 곳은 없다.** 이 모듈에서 unix 전용 API를 쓰는 테스트가 없었다
  (권한 조작·심볼릭 링크·`std::os::*` 사용 0건). 픽스처는 `create_workflow`가 만든 실제
  워크플로우와 `std::fs`·`chrono`뿐이라 경로 조립이 플랫폼에 의존하지 않는다.
- `heartbeat_condition.rs`에 남은 플랫폼 조건은 셋이고 전부 의도된 것이다. `PLATFORM` 상수의
  `#[cfg(windows)]`/`#[cfg(not(windows))]` 쌍(자산 선택, TASK-042)과
  `installs_condition_script_with_managed_markers` 안의 `#[cfg(not(windows))]` 단정 한 줄
  (`sh` 본문의 `#!/bin/sh` 시작을 보는 줄이라 `.ps1`에는 성립하지 않는다). 모듈 게이트가 아니라
  단정 한 줄에만 걸린 형태다.

## 검증 단계와 결과

작업 문서의 검증 절차 그대로 실행했다.

| 명령 | 결과 |
| --- | --- |
| `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` | 통과 |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | 경고 없음 |
| `cargo test --manifest-path src-tauri/Cargo.toml` | 329 passed / 0 failed / 0 ignored |
| `npm run check` | 315 passed (14 files), `tsc -b && vite build` 통과 |
| `grep -n "cfg(unix)" role_eligibility.rs` | 0건 |
| `grep -n "cfg(unix)" heartbeat_condition.rs` | 0건 |

두 모듈만 따로 돌리면 67 passed(heartbeat_condition 39, role_eligibility 28)다. 삭제되거나
`#[ignore]`가 붙은 테스트는 없다. 늘어난 것은 시나리오 표 테스트 1건뿐이고, 줄어든 것은 중복
`run_condition` 함수 1개(테스트 아님)다.

## 완료하지 못한 것

**Windows 러너 결과 확인(기획서 완료 조건 10)을 닫지 못했다.** 작업 문서 §4가 미리 정한 대로
사용자 QA 항목으로 남긴다. 로컬에서 시도한 것과 막힌 지점이다.

- `cargo check --target x86_64-pc-windows-msvc --all-targets`를 시도했다. 이 저장소의 전이 의존
  `ring 0.17.14`가 Windows 타깃용 C 코드를 컴파일하려다 MSVC 헤더(`assert.h`)를 찾지 못해
  빌드 스크립트에서 실패한다. 내 코드에 닿기 전에 끊긴다. 확인 뒤 추가했던 rustup 타깃과
  `target/x86_64-pc-windows-msvc/`는 원상 복구했다.
- 이 머신에 `pwsh`·`powershell`이 없다. TASK-042와 같은 이유로 임의 설치하지 않았다. 즉 **표의
  PowerShell 실행은 이 세션에서도 한 번도 일어나지 않았다.** TASK-042가 "실행 검증은 TASK-043의
  Windows 러너 몫"이라 적은 그 실행이 여전히 CI 러너에 남아 있다.
- 정적으로 닫은 범위: 두 모듈에 `#[cfg(unix)]`가 0건이고, `std::os::*`·`PermissionsExt`·
  `symlink` 등 unix 전용 API 참조가 0건이며, 실행 헬퍼의 플랫폼 분기가 `cfg!`라 두 갈래가 모든
  타깃에서 타입 검사를 받는다는 것. 즉 이 두 모듈에서 Windows에만 존재하는 코드는 `PLATFORM`
  상수 하나(같은 타입의 다른 값)뿐이다.
- **자동화 테스트가 macOS에서 통과했다는 것으로 이 항목을 대신하지 않았다.**

## 리스크와 후속

1. **PowerShell 본문의 첫 실행이 여전히 앞에 있다.** 이제 그 실행을 시키는 표는 존재하지만, 표를
   실제로 도는 것은 Windows 러너다. 표가 빨갛게 나오면 고칠 쪽은 옮긴 쪽(PowerShell 구현)이지
   `sh` 원본이 아니다 — 작업 문서 §0의 제약이고, 그 수정은 TASK-042의 결과를 고치는 것이므로 이
   작업이 아니라 후속 작업의 몫이다.
2. **TASK-042가 남긴 Windows 실패 1건이 그대로 있다.** `heartbeat_service.rs:980`
   `an_empty_home_reports_the_slug_and_the_condition_script_path`가 `.sh` 경로를 단정한다.
   승계처는 TASK-044로 확인돼 있고, 이 작업의 범위 밖이라 손대지 않았다. **Windows 러너 로그를
   볼 때 이 실패는 이 작업의 산출물이 아니라는 것을 구분해야 한다.**
3. **표는 현재 플랫폼의 구현 하나만 돌린다.** 한 러너에서 두 구현을 대조하는 것이 아니라 각
   러너가 자기 구현으로 같은 표를 통과하는 형태다(D2). 그래서 "두 구현이 같은 종료 코드를 낸다"는
   3 러너 결과를 함께 봐야 성립한다. 한 러너만 초록이면 완료 조건 6은 아직 닫히지 않은 것이다.
4. **`role_eligibility.rs`의 대조 범위에 선행 선언은 아직 들어오지 않았다.** 그 모듈은 선언을 보지
   않고(배선은 TASK-060), 대조 테스트의 픽스처에도 `depends_on`이 없어서 두 판정이 같다. 표의
   10·11번은 스크립트만 본다. TASK-060이 배선을 끝내면 그때 이 모듈의 픽스처에도 선언이 들어와야
   대조가 그 축까지 덮는다 — 모듈 머리 주석의 "아직 맞추지 못한 것" 문단이 이미 그 상태를 적고
   있어 따로 손대지 않았다.
5. **`test_support`가 테스트 안에 있다.** TASK-044가 조건 문자열 조립 함수를 제품 코드에 만들면
   이 헬퍼가 그 함수를 쓰도록 옮겨야 한다. 지금 상태로 두면 "테스트가 부르는 명령"과 "잡에 적히는
   명령"이 각각 조립돼 갈릴 수 있다. 헬퍼 주석에 그 인계를 적어 두었다.

## 사용자 QA 항목

아래는 자동화 테스트 통과로 닫지 않는다.

1. **기획서 완료 조건 10.** PR CI의 `Rust (windows-latest)` 잡 로그에서
   `the_installed_script_matches_the_scenario_table`과 `role_eligibility` 대조 테스트들이 skip이나
   미컴파일이 아니라 **실행·통과**로 남았는지. skip이면 이 작업은 목적을 이루지 못한 것이다.
   확인 방법: 로그에서 두 이름이 `... ok`로 찍히는지, 그리고 `role_eligibility` 테스트 수가
   macOS·Linux와 같은 28인지 본다. 수가 적으면 게이트가 어딘가 남아 있다는 뜻이다.
2. 같은 로그에서 `Rust (ubuntu-22.04)`·`Rust (macos-latest)`도 초록인지. 세 러너가 함께
   초록이어야 완료 조건 6·9가 닫힌다.
3. 위 리스크 2번(`heartbeat_service.rs:980`)이 Windows 러너에서 여전히 빨간 상태로 보일 수 있다.
   그것은 TASK-044의 몫이고 이 작업의 판단 대상이 아니다.
