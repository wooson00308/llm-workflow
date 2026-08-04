# TASK-044 개발자 핸드오프

- 대상 작업: TASK-044 (잡의 condition을 플랫폼에 맞게 기록하고 중복 감지가 두 조건 형태를 모두 알아본다)
- 근거 문서: SPEC-015 R4·R6, D1, DECISION-EEEEB81D (approved, created_by: user)
- 세션 역할: 개발자 (TL 배정)
- 작성 시각: 2026-08-03T10:00Z
- 상태: `qa_waiting`

## 대상 선정 근거

- 선행 선언 `depends_on: [TASK-042]`가 충족이다. 착수 시점 TASK-042는 `qa_waiting`이었고, 그 산출물인
  `managed_script.rs`의 `ManagedScript::relative_path()`·`CONDITION_SCRIPT_STEM`·PowerShell 본문이
  모두 트리에 있었다. 이 작업이 그 위에 선다.
- `migration.lock` 없음. 착수 시점(09:53Z) lease는 `SPEC-009.yml`(만료)과 `TASK-055.yml` 둘이었다.
- 병행 금지 상대 TASK-043은 `todo`이고 아무도 잡고 있지 않았다.
- 선점: `leases/TASK-044.yml` 배타 생성(`set -C`) → 즉시 `in_progress` + `history` → 구현 → 검증 →
  `qa_waiting` → lease 반납. 작업 중 만료가 가까워져 한 번 갱신했다.

## 계약과 다르게 한 것 하나 — `condition_command`의 위치

**작업 문서는 이 함수를 `heartbeat_condition.rs`에 두라고 적었지만, `heartbeat_roles.rs`에 뒀다.**

착수 시점에 TASK-055 세션이 `heartbeat_condition.rs`를 `in_progress`로 잡고 있었다(lease 확인,
그 작업 범위가 `CONDITION_SCRIPT` 본문의 선점 확인 세 자리·`CONDITION_SCRIPT_VERSION`·테스트다).
TL도 그 파일을 이 세션에 읽기 전용으로 지정했다. 같은 파일을 두 세션이 함께 쓰면 이번 웨이브에서
이미 한 번 겪은 컴파일 불능 상태가 반복된다.

`heartbeat_roles.rs`가 대안으로 타당한 근거다.

- `condition`은 역할 잡의 필드이고, 이 모듈이 그 필드를 조립한다. 지우라고 지시받은
  `const CONDITION_SCRIPT`가 원래 여기 있었다.
- `heartbeat_condition.rs`는 자산의 설치 규약을 갖는 모듈이지 잡 필드를 만드는 모듈이 아니다.
  작업 문서가 요구한 "자산을 아는 모듈이 두 값을 낸다"는 요구는 위치가 아니라 출처의 문제이고,
  두 값 모두 `CONDITION_SCRIPT.relative_path()`에서 나오므로 그대로 지켜졌다.
- `pub fn`이라 크레이트 어디서든 부를 수 있다. 이동 비용은 `use` 한 줄이다.

**TASK-043에 전달한다.** 그 작업이 테스트 실행 헬퍼를 만들면서 이 함수를 쓸 때 경로는
`crate::infrastructure::heartbeat_roles::condition_command`다. `heartbeat_condition.rs`로 옮기는 편이
낫다고 판단하면 그때 옮겨도 되고, 그 시점에는 TASK-055가 끝나 있을 것이다.

## 구현

### 1. 조건 명령을 한 곳에서 만든다 (완료 조건 1·2)

```rust
pub fn condition_command(role_argument: &str) -> String {
    let script = CONDITION_SCRIPT.relative_path();
    if cfg!(windows) {
        format!("powershell -NoProfile -ExecutionPolicy Bypass -File {script} {role_argument}")
    } else {
        format!("sh {script} {role_argument}")
    }
}
```

- Windows가 아니면 `sh .workflow/rules/wf-eligible.sh <role>` — 지금 기록되던 값과 바이트 단위로 같다.
- Windows면 `powershell -NoProfile -ExecutionPolicy Bypass -File .workflow/rules/wf-eligible.ps1 <role>`.
  `powershell.exe`는 기본 탑재라 추가 설치가 없고(R1), `-ExecutionPolicy Bypass`는 그 프로세스에만
  걸려 시스템 정책을 바꾸지 않으며(D1), `-NoProfile`은 프로필 스크립트가 판정에 끼어드는 것을 막고,
  `-File`은 스크립트의 `exit` 코드를 그대로 낸다. 판정 로직은 명령 문자열이 아니라 파일에 있다(D1).
- 경로 구분자는 두 플랫폼 모두 `/`다. `relative_path()`가 `/`로만 조립하고(`7b6fc69`), 여기서 `\`로
  바꾸면 그 핫픽스가 되돌아온다. 테스트가 `\` 부재를 고정한다.
- `heartbeat_roles.rs`의 `const CONDITION_SCRIPT`(하드코딩 `.sh` 경로)를 지웠다.
- `heartbeat_service.rs`의 `condition_script_relative_path`는 `project_root`를 붙였다 떼어 내던 것을
  `CONDITION_SCRIPT.relative_path()` 한 줄로 줄였다. 인자가 필요 없어져 없앴고, 그 변경으로 쓰이지
  않게 된 `condition_script_path` import를 제품 코드 쪽에서 지웠다(테스트 모듈은 자기 `use`로 계속 쓴다).

### 2. 중복 감지가 확장자를 보지 않는다 (완료 조건 5·6·7)

`heartbeat_status.rs`의 `CONDITION_SCRIPT_FILE`("wf-eligible.sh")을 지우고 `is_role_condition`이
TASK-042가 낸 `CONDITION_SCRIPT_STEM`("wf-eligible")을 쓴다. stem 부분 문자열 검사가 두 확장자를 모두
잡는다. dream 조건(`dream-prep check-unprocessed --slug=...`)에는 그 문자열이 없어 겹치지 않는다.
`DUPLICATE_RULES`의 순서·dream 규칙·`condition_role`은 한 글자도 바꾸지 않았다.

## 변경한 파일 (4건, 범위 그대로 — 단 위치 하나는 위 절 참조)

- `src-tauri/src/infrastructure/heartbeat_roles.rs` — `CONDITION_SCRIPT` 상수 제거,
  `condition_command` 추가, `role_managed_jobs`의 조건 조립 교체, 테스트 4건 추가와 바이트 고정
  테스트의 플랫폼 대응.
- `src-tauri/src/infrastructure/heartbeat_status.rs` — `CONDITION_SCRIPT_FILE` 제거,
  `is_role_condition`이 stem을 쓰도록 교체(주석을 그 함수로 옮김), 테스트 2건 추가.
- `src-tauri/src/application/heartbeat_service.rs` — `condition_script_relative_path` 단일화와 인자
  제거, 호출부 한 줄, import 정리, 테스트 1건 추가와 경로 단정의 플랫폼 대응.
- `.workflow/도그푸딩--wf_ae6cd700/tasks/TASK-044.md` — 상태 전이와 `history`.

**`heartbeat_condition.rs`는 읽기만 했다.** `CONDITION_SCRIPT`·`CONDITION_SCRIPT_STEM`·
`install_condition_script`를 import했을 뿐 한 줄도 쓰지 않았다. `role_eligibility.rs`·
`claim_helper.rs`·`managed_script.rs`·`domain/project.rs`·`types.ts`·화면도 무변경이다.

## TL 지시 항목 — Windows CI 지뢰

`heartbeat_service.rs`의 `an_empty_home_reports_the_slug_and_the_condition_script_path`가
`".workflow/rules/wf-eligible.sh"`를 하드코딩 단정하고 있었다. 이 테스트는
`#[cfg(all(test, not(windows)))]` 게이트 **밖**이라 Windows 러너에서도 돌고, 자산이 갈린 뒤로는 그
플랫폼에서 실패한다. 기대값을 `cfg!(windows)` 분기로 나눴다.

```rust
assert_eq!(
    snapshot.heartbeat.condition_script_path,
    if cfg!(windows) { ".workflow/rules/wf-eligible.ps1" } else { ".workflow/rules/wf-eligible.sh" }
);
```

같은 성질의 자리를 이 세션의 범위 안에서 더 찾아 함께 고쳤다 — `heartbeat_roles.rs`의 바이트 고정
테스트 세 줄과 기본값 테스트의 조건 단정이다. 이 둘도 게이트 밖이고 조건 문자열을 리터럴로 담고 있었다.

## 더한 테스트 7건

`heartbeat_roles.rs`:

- `the_condition_command_is_one_line_pointing_at_the_platform_asset` — 한 줄이고, 자산의
  `relative_path()`를 담고, 역할 인자로 끝나고, `\`가 없다.
- `every_role_condition_points_at_the_same_asset_path` — 세 역할 잡의 조건이 모두 같은 자산 경로를
  가리킨다.
- `the_recorded_condition_returns_the_condition_scripts_exit_code` — **완료 조건 3(기획서 11).**
  기록된 조건 명령을 셸을 거쳐(`sh -c`, Windows면 `cmd /C`) 픽스처 프로젝트 루트에서 실행해,
  자격 있음에서 0·없음에서 1이 나오는 것을 본다. `install_condition_script`와 `condition_command`만
  쓰고 `HeartbeatService::install`을 거치지 않는다 — 그 경로는 TASK-045 전까지 Windows에서 막혀 있고
  이 확인은 차단 해제와 무관하다.
- `expected_condition` 헬퍼 — 바이트 고정 테스트가 각 플랫폼에서 리터럴을 유지하도록 조건 줄만
  `#[cfg]`로 나눈다. **제품 코드의 `condition_command`를 부르지 않는다.** 되먹이면 바이트 고정이
  아니라 항등식이 된다.

`heartbeat_status.rs`:

- `detects_a_duplicate_role_job_written_with_a_powershell_condition` — 완료 조건 5. 역할 이름까지
  함께 나오는 것을 본다. `-NoProfile` 같은 플래그가 역할 토큰과 겹치지 않는다는 것이 여기서 고정된다.
- `duplicate_powershell_condition_without_a_role_argument_reports_the_name_only` — 기존 `sh` 쪽
  테스트의 짝.

`heartbeat_service.rs`:

- `the_reported_path_is_the_one_written_into_the_job_condition` — 완료 조건 1(기획서 24). 화면에 나가는
  경로와 관리 블록에 기록되는 조건 문자열 안의 경로를 같은 테스트에서 뽑아 대조한다.

## 검증

| 명령 | 결과 |
| --- | --- |
| `cargo test --manifest-path src-tauri/Cargo.toml` | 306 passed / 0 failed |
| `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` | 차이 없음 |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | 경고 0 |
| `npm run check` | 272 passed (14 파일) + 빌드 성공 |

- 삭제·비활성화한 테스트 없음. 기존 테스트에서 고친 것은 조건 문자열을 리터럴로 담고 있던 단정
  네 자리뿐이고, 각 플랫폼에서 리터럴 고정이 유지된다(완료 조건 8).
- 기존 `sh` 조건 중복 감지 테스트 다섯(`:490`·`:507`·`:514`·`:585`·`:710` 계열)과 dream 조건 테스트는
  한 줄도 고치지 않고 통과한다(완료 조건 6·7).
- `install_tests` 모듈(`#[cfg(all(test, not(windows)))]`)의 게이트는 풀지 않았다. TASK-045다.
- 이 저장소에 잡을 설치해 보지 않았다. 관리 블록은 사용자 홈의 실제 파일이다.

## 사용자 QA 제안

이 작업은 macOS에서 기록되는 값을 바꾸지 않는다. 화면과 파일 모두 지금과 같아야 한다.

1. 연동 화면에서 조건 스크립트 경로가 `.workflow/rules/wf-eligible.sh`로 그대로 보이는지 본다.
2. 역할 잡을 저장한 뒤 `~/.claude/HEARTBEAT.md`의 `- condition:` 세 줄이 이전과 같은 문자열인지
   확인한다. 바뀌었다면 반려 사유다(완료 조건 4).
3. Windows 확인은 이 작업으로 닫지 않는다. 차단이 아직 걸려 있어(TASK-045) 실기 확인이 불가능하다.
   기획서 완료 조건 12·13·18·19가 사용자 QA로 남긴 항목과 같은 성질이다.

## 리스크와 후속

1. **`condition_command`의 위치가 작업 문서와 다르다.** 위 절에 근거를 적었다. TASK-043이 흡수할 때
   경로가 `heartbeat_roles::condition_command`라는 것만 알면 된다.
2. **Windows 형태를 실기로 확인하지 못했다.** 이 머신은 macOS다. `cfg!(windows)` 분기의 문자열과
   실행 테스트는 Windows 러너에서 처음 돈다. CI 3 러너 중 Windows가 `cargo test`를 돌리므로 그 시점에
   `the_recorded_condition_returns_the_condition_scripts_exit_code`가 PowerShell 본문과 `cmd /C`
   조합을 실제로 검증한다. **그 러너가 이 작업의 실질 검증이다.**
3. **PowerShell 본문 자체는 TASK-042의 산출물이다.** 이 작업은 그것을 가리키는 명령만 만든다. 본문이
   `exit` 코드를 제대로 내지 않으면 2번의 테스트가 Windows에서 실패하고, 그 수정은 TASK-042 쪽이다.
4. **`is_role_condition`이 stem 부분 문자열이라 넓어졌다.** `wf-eligible`을 이름에 포함하는 무관한
   명령도 역할 조건으로 볼 수 있다. 감지는 감지만 하고 앱이 사용자 잡을 고치거나 지우지 않으므로
   (R6) 피해는 목록에 한 줄 더 뜨는 것이다. 좁히려면 확장자 집합을 명시해야 하는데, 그러면 세 번째
   플랫폼이 생길 때 같은 자리를 다시 고쳐야 한다.
5. **`heartbeat_condition.rs`를 TASK-055가 동시에 만지고 있었다.** 이 세션은 읽기만 했고, 그 세션의
   변경이 `CONDITION_SCRIPT`의 이름이나 `relative_path()` 계약을 바꾸지는 않는다. 두 작업이 모두
   반영된 뒤 `cargo test`를 한 번 더 돌려 보는 것이 안전하다.
