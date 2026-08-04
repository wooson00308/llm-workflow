# TASK-047 개발자 핸드오프

> 기록 경위: 세션 하네스가 보고서 파일 작성을 차단해, 세션이 채팅으로 보낸 전문을 TL이 그대로 기록했다.
> 승계 절의 fs_project_repository.rs 테스트 2건은 보고 직후 TL 지시로 같은 세션이 claim_helper_path()
> 기반으로 수정했다(부록 참조).

- 대상 작업: TASK-047 (선점 헬퍼를 공용 자산 규약으로 옮기고 PowerShell 구현과 동작 일치를 낸다)
- 근거 문서: SPEC-015 R10, DECISION-EEEEB81D (approved, created_by: user)
- 세션 역할: 개발자 (TL 배정, 병렬 웨이브)
- 상태: `qa_waiting`

## 대상 선정 근거

- TL이 배정한 단일 작업이다. 착수 시점(10:07Z) `status: todo`.
- 선행 `depends_on: [TASK-039, TASK-042]`이 둘 다 `qa_waiting`이라 충족이다. 옮길 대상(`sh` 본문과
  `claim_helper.rs`)과 옮겨 갈 자리(`managed_script.rs`)가 모두 트리에 있는 것을 파일에서 확인하고
  착수했다.
- `migration.lock` 없음. 착수 시점 lease는 `SPEC-009.yml`(만료)과 `TASK-045.yml`뿐이었고 내 대상이
  아니라 건드리지 않았다.
- 선점: `leases/TASK-047.yml` 배타 생성(`set -C`). 공통 규칙 §4의 헬퍼는 이 저장소에 아직 설치되어
  있지 않으므로(앱이 다음 쓰기 경로에서 설치한다) §4가 정한 폴백 절차를 그대로 썼고 `role`도 적었다.
- 소스 결정 DECISION-EEEEB81D는 `approved`로 유효하다.

## 요약

`claim_helper.rs`가 자기 설치·검증 로직을 갖고 있던 것을 걷어내고 `ManagedScript` 자산 서술 하나로
줄였다. PowerShell 구현을 더해 Windows에서도 헬퍼가 설치된다. 헬퍼의 계약(하위 명령·인자·종료 코드
여섯·소유자 확인·lease 스키마)은 SPEC-013이 정한 그대로이고 이 작업에서 한 글자도 바꾸지 않았다.

## 이관 — 무엇이 사라지고 무엇이 남았는가

TASK-039가 `claim_helper.rs`에 둔 것 중 아래가 `managed_script.rs`로 흡수되어 파일에서 사라졌다.

- `ClaimHelperError` enum 정의 → `pub type ClaimHelperError = ManagedScriptError;` 별칭
- `plan_claim_helper`·`ensure_regular_file`·`write_text_atomically` → `ManagedScript`의 같은 이름
- `RULES_DIRECTORY`·`CLAIM_HELPER_FILE`·`MANAGED_MARKER` 상수 → 공용 모듈이 갖는다

남은 것은 자산 서술뿐이다: `CLAIM_HELPER_STEM`("wf-claim"), `CLAIM_HELPER_LABEL`("선점 헬퍼"),
`VERSION_PREFIX`, `CLAIM_HELPER_VERSION`(1, TASK-039이 정한 값 그대로), 두 본문 상수, 플랫폼 분기,
`CLAIM_HELPER` 서술, 공개 함수 셋.

- **공개 함수 시그니처와 오류 문구가 그대로다**(완료 조건 1). `claim_helper_path`·
  `install_claim_helper`·`validate_claim_helper`와 `ClaimHelperError` 이름을 유지해
  `fs_project_repository.rs`의 호출 네 곳과 `ProjectError`의 `#[error(transparent)]` 배선을 한 줄도
  건드리지 않았다.
- **오류 문구는 공용 타입 쪽을 고치지 않고 맞았다.** `ManagedScriptError`가 `label`을 끼우는 자리가
  TASK-039의 문구와 정확히 겹친다 — `label`에 "선점 헬퍼"를 넣으면 다섯 갈래 모두 TASK-039가 낸
  문장과 같은 문자열이 된다. 테스트로 두 문구를 문자열 단정해 고정했다(TASK-042가 조건 스크립트에
  만든 `the_error_messages_are_unchanged`와 같은 형태).
- **모듈 머리 주석을 현재 사실로 고쳤다.** TASK-039가 남긴 "두 모듈의 설치 로직을 공용 모듈로 묶지
  않았다 … 세 번째 관리 스크립트가 생기면 그때 묶는 편이 낫다"는 판단은 이 작업으로 실행됐으므로,
  그 문단을 조건 스크립트 모듈과 같은 서술("설치·검증·판정 규약은 `managed_script`가 갖는다")로
  교체했다.
- **버전 축은 분리된 채다**(완료 조건 6). 접두사 `# claim_helper_version:`과 상수가 조건 스크립트의
  것과 별개이고, 두 설치본이 서로의 버전 줄을 갖지 않는 것을 테스트가 본다.

## PowerShell 본문 — 옮긴 것과 정한 것

계약은 `sh`와 같다. 하위 명령 셋, 인자 순서, 종료 코드 여섯, `acquire` 성공 시 표준 출력의
`lease_id` 한 줄, 실패 메시지는 표준 오류, 문서 id가 `[A-Za-z0-9_-]` 밖이면 2, 사용법 오류를
`migration.lock`보다 먼저 보는 순서까지 같다.

**판정 규칙 셋을 그대로 옮겼다.** 시각 표기는 `yyyy-MM-ddTHH:mm:ssZ` 고정 자리수 UTC, 만료 판정은
사전순(`[string]::CompareOrdinal`) 비교이고 같은 값은 만료, 정규 표기가 아닌 `expires_at`은
미만료로 다뤄 3으로 끝낸다. 표기 검사도 `sh`와 같은 자리에 숫자 클래스를 둔다
(`^[0-9]{4}-[0-9]{2}-...`) — 조건 스크립트가 쓰는 `.{4}` 형태와 다른 것은 `sh` 헬퍼가 처음부터
숫자 클래스로 검사했기 때문이고, 두 헬퍼끼리 같은 것이 이 작업의 대조 대상이다.

`sh`가 이식성 때문에 고른 수단은 결과가 같은 선에서 PowerShell 쪽 방식으로 바꿨다.

- 시각 계산은 epoch 왕복 없이 `[System.DateTime]::UtcNow.AddMinutes()` 하나다. `sh`가 BSD·GNU 두
  갈래를 시도해야 했던 이유가 PowerShell에는 없다.
- 배타적 생성은 `FileMode.CreateNew`다. `set -C` 리다이렉트가 주던 `O_EXCL`과 같은 보장이다.
- **잠금은 이름을 맞추되 종류가 다르다.** 이름은 지시대로 `<문서-id>.yml.lock`이고 lease 디렉터리
  안이다. 그런데 `sh`는 그것을 디렉터리로 만들고(`mkdir`이 POSIX에서 원자적) PowerShell은 파일로
  만든다. .NET에는 "이미 있으면 실패하는" 디렉터리 생성이 없다 — `Directory.CreateDirectory`는 이미
  있어도 성공하므로 배타 구간을 만들지 못한다. 파일 쪽은 `CreateNew`가 그 보장을 준다. 한 저장소를
  두 플랫폼에서 여는 경우에도 상호 배제는 성립한다: 같은 이름에 대해 `mkdir`은 파일이 있으면
  실패하고 `CreateNew`는 디렉터리가 있으면 실패한다. 이 사실을 PowerShell 머리 주석에 적었다.
- 원자적 교체는 임시 파일 + `Move-Item -Force`다. 임시 이름은 `sh`와 같은 `.yml.tmp.<pid>`라 앱의
  lease 읽기와 조건 스크립트의 lease 검사 어느 쪽에도 걸리지 않는다.
- 파일은 LF 줄바꿈, BOM 없는 UTF-8로 쓴다(`[System.Text.UTF8Encoding]::new($false)`). 두 구현이
  같은 바이트를 남겨야 앱과 서로가 읽는다.
- 갱신은 `sh`와 같이 `heartbeat_at: `·`expires_at: ` 두 줄만 치환하고 나머지 줄을 원문 그대로
  옮긴다. `sed`의 `^heartbeat_at: .*`와 같은 경계가 되도록 `StartsWith`에 뒤 공백까지 넣었다.

**PowerShell 고유의 함정은 TASK-042가 정리한 것을 그대로 따랐다.** 본문은 ASCII만 쓰고(설치가 BOM
없는 UTF-8로 쓰는데 Windows PowerShell 5.1이 그런 `.ps1`을 시스템 코드페이지로 읽는다), 비교는
전부 대소문자 구분 연산자(`-ceq`·`-cne`·`-cnotmatch`·`-creplace`, `StringComparison::Ordinal`)이고,
`switch -CaseSensitive`를 쓰며, 스크립트는 반드시 `exit <코드>`로 끝난다.
`$ErrorActionPreference = 'Stop'`이라 예외는 0이 아닌 코드로 떨어진다.

그 밖에 정한 것 둘.

- **인자 수를 `$#`처럼 세려고 `ValueFromRemainingArguments`를 썼다.** 이름 있는 매개변수로 받으면
  "인자가 없다"와 "빈 문자열이다"를 구분하지 못해 인자 수 검사(`acquire`·`renew`는 4개,
  `release`는 3개)가 `sh`와 갈린다.
- **`[System.Environment]::CurrentDirectory`를 PowerShell 위치로 고정했다.** .NET API는 상대 경로를
  프로세스 디렉터리 기준으로 푸는데 그 값은 PowerShell의 위치를 따라가지 않는다. 시작 시점에는 둘이
  같고 이 스크립트는 위치를 옮기지 않지만, 고정해 두면 `System.IO` 호출이 프로젝트 루트에 머무는
  것이 코드에서 보인다.

## 변경한 파일 (1건, 작업 범위 그대로)

- `src-tauri/src/infrastructure/claim_helper.rs` — 공용 규약으로 이전, PowerShell 본문 추가, 플랫폼
  분기, 모듈 머리 주석 갱신, 테스트 조정·추가.

범위 밖 파일 무변경: `managed_script.rs`·`heartbeat_condition.rs`·`fs_project_repository.rs`·
`mod.rs`·`scripts/`·화면. **공용 모듈을 고칠 일은 없었다** — TASK-042의 서술이 두 번째 자산에도
그대로 맞았고, 특히 `label`을 끼우는 자리와 `version_prefix`가 자산마다 다르다는 설계가 이 작업이
필요로 한 것과 일치했다.

## 검증

작업 문서의 검증 절차 그대로 실행했다.

| 명령 | 결과 |
| --- | --- |
| `cargo test --manifest-path src-tauri/Cargo.toml` | 328 passed / 0 failed / 0 ignored |
| `npm run check` | 315 passed (14 files), `tsc -b && vite build` 통과 |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | 경고 없음 |
| `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` | 내 파일 차이 없음 |
| `grep -n "cfg(unix)" claim_helper.rs` | 출력 없음 (완료 조건 8) |

`clippy -D warnings`가 내 파일에서 `CLAIM_HELPER_PS1`과 `claim_helper_path`를 미사용으로 잡았다.
앞의 것은 현재 플랫폼이 아닌 구현이라 프로덕션 경로에서 참조되지 않고, 뒤의 것은 이관으로 내부
호출이 사라져 테스트만 쓴다. 형제 모듈 둘(`heartbeat_condition`·`managed_script`)이 같은 이유로
쓰는 `#![allow(dead_code)]`을 사유 주석과 함께 달았다. 공개 함수 셋을 유지하는 것이 완료 조건 1이라
지우는 선택지는 없었다.

### 테스트

`claim_helper.rs`는 20개에서 27개가 되었다. **TASK-039의 20개는 삭제·비활성화 없이 남았고**, 동작
테스트 13개의 `#[cfg(unix)]` 게이트가 사라져 현재 플랫폼의 설치본을 그 플랫폼의 방식으로 실행한다
(완료 조건 8). 실행 헬퍼는 Windows면 `powershell -NoProfile -ExecutionPolicy Bypass -File <경로>`,
그 외에는 `sh <경로>`이고 경로는 자산 서술의 `relative_path()`에서 온다.

더한 7건: `installs_the_implementation_for_the_current_platform`(완료 조건 2),
`leaves_the_other_platform_asset_untouched`(완료 조건 7, 내용·수정 시각 둘 다 확인),
`both_implementations_share_the_managed_markers_and_version`(완료 조건 5·6),
`the_powershell_implementation_is_ascii`, `both_implementations_carry_the_same_interface`(두 본문이
같은 하위 명령·잠금 이름·락 경로를 문서화하는지), `the_asset_description_carries_its_own_version_axis`
(완료 조건 6), `the_error_messages_name_the_claim_helper`(완료 조건 1).

동작 일치 시나리오 열둘(작업 문서 §3의 표)은 기존 13개 안에 모두 들어 있고, 이제 플랫폼 게이트
없이 현재 플랫폼에서 돈다. 경합 테스트는 스레드 둘로 실제 프로세스 둘을 띄워 정확히 하나만 0이고
최종 파일이 이긴 쪽 `lease_id`인 것을 본다.

> TASK-039 보고서의 "24건(claim_helper 21 + repository 3)"은 세는 필터에 다른 모듈 테스트가 섞인
> 값이었다. 실제로는 claim_helper 20 + repository 3 = 23건이다. 그 작업이 검증한 사실은 그대로이고
> 숫자만 바로잡는다.

### PowerShell 본문의 검증 범위 (러너 대기)

이 머신에 `pwsh`·`powershell`이 없다(확인함). 설치할 소프트웨어라 임의로 넣지 않았다. TASK-042와
같은 형식으로 정적 확인 범위를 적는다.

- ASCII 전용 — 자동화 테스트로 고정
- 중괄호·소괄호·대괄호 균형, 홀수 따옴표 줄 없음
- 정의된 함수 8개가 모두 호출되고, 호출되는 이름 중 정의되지 않은 것은 전부 PowerShell 내장
- 종료 코드 0~5 여섯 개가 모두 본문에 있고 스크립트가 `exit`로 끝난다
- Rust 원시 문자열 종료 시퀀스 부재(컴파일로 확인)
- 출력 스트림 오염 점검: 값을 내는 .NET 호출을 `[void]`로 소비했고, `Move-Item`·`Remove-Item`은
  `-PassThru` 없이 불러 함수 반환값이 `$true`/`$false`뿐이다

**실행 검증은 Windows 러너 몫이다.** 정적 검사가 잡지 못하는 것(5.1과 7의 동작 차이, `Move-Item`의
교체 의미, `try/finally` 안의 `exit`가 잠금 파일을 지우는지)은 거기서 처음 드러난다.

## 승계 — Windows 러너에서 깨질 기존 테스트 2건 (→ 보고 직후 해소)

`fs_project_repository.rs`의 테스트 두 개(`:3760` `installs_the_claim_helper_with_the_workflow`,
`:3769` `refuses_to_overwrite_an_unmanaged_claim_helper`)가 `wf-claim.sh`를 문자열로 하드코딩해
Windows 러너에서 깨질 상태였다. 작업 범위 밖 파일이라 이 작업에서는 남겼고, 보고 직후 TL 지시로
같은 세션이 `claim_helper_path()` 기반으로 교체했다(부록 참조).

## 사용자 QA 제안

작업 문서가 이 저장소에서 헬퍼를 돌리지 말라고 정했다. 아래는 임시 프로젝트 기준이다.

1. macOS·Linux에서 앱으로 워크플로우를 하나 만들고 `.workflow/rules/wf-claim.sh`가 이 작업 전과 같은
   내용으로 설치되는지 본다. `sh` 본문은 한 글자도 바뀌지 않았으므로 달라지면 안 된다.
2. `.workflow/rules/`에 `wf-claim.ps1`을 손으로 하나 만들어 두고 앱을 다시 열어, 그 파일이 바이트
   그대로 남고 오류나 경고가 뜨지 않는지 본다(완료 조건 7).
3. `wf-claim.sh`의 관리 표기 줄을 지운 뒤 앱을 열어 덮어쓰지 않고 오류 문구가 "…에 앱이 관리하지
   않는 파일이 있어 덮어쓰지 않았습니다…"로 뜨는지 본다.
4. Windows 실기 확인이 이 작업의 사용자 QA 항목이다(기획서 완료 조건 25의 실기 몫). 설치되는 파일이
   `.ps1`인지, 그 스크립트를 각 종료 코드가 나오는 상황(빈 대상·미만료 lease·만료 lease·소유자
   불일치 갱신·`migration.lock`·잘못된 인자)으로 불러 계약대로 끝나는지 본다. 기본 실행 정책 상태의
   호출은 CI 러너가 대신하지 못한다.

## 리스크와 후속

1. **PowerShell 본문의 첫 실행이 Windows 러너다.** TASK-042의 조건 스크립트와 같은 상태다. 특히
   잠금을 파일로 만든 선택(위 "옮긴 것과 정한 것" 참조)은 두 플랫폼이 한 저장소를 공유할 때의
   상호 배제를 논증으로만 확인했다.
2. **`sh` 본문은 한 글자도 바뀌지 않았다.** 이관은 Rust 쪽 구조만 건드렸다. 이미 돌고 있는 macOS·
   Linux 세션의 동작이 이 작업으로 달라지지 않는다.
3. **이 저장소에는 헬퍼가 아직 설치되어 있지 않다.** `inspect`에 설치를 넣지 않기로 한 TASK-039의
   결정 때문이고, 앱이 다음 워크플로우 생성·기획서 결정·QA 기록에서 설치한다. 그때까지 세션은 공통
   규칙 §4의 폴백으로 선점한다 — 이 세션도 그렇게 했다.
