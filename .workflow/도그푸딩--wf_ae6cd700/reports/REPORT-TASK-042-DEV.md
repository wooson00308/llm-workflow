# TASK-042 개발자 핸드오프

> 기록 경위: 세션 하네스가 보고서 파일 작성을 차단해, 세션이 채팅으로 보낸 전문을 TL이 그대로 기록했다.

- 대상 작업: TASK-042 (실행 자산 설치 규약을 플랫폼별 자산으로 일반화하고 조건 스크립트의 PowerShell
  구현을 낸다)
- 근거 문서: SPEC-015 R1·R2·R9 + D1, DECISION-EEEEB81D (approved, created_by: user)
- 세션 역할: 개발자 (TL 배정, 병렬 웨이브)
- 작성 시각: 2026-08-03T09:52Z
- 상태: `qa_waiting`

## 대상 선정 근거

- TL이 이 한 건만 배정했다. 착수 시점(09:30Z) `status: todo`, 선행 `depends_on: [TASK-040]`이
  `qa_waiting`이라 R2 기준 충족.
- `migration.lock` 없음. 착수 시점 lease는 `SPEC-009.yml`(만료), `TASK-039.yml`, `TASK-051.yml`이었고
  내 대상이 아니라 손대지 않았다.
- 선점: `leases/TASK-042.yml` 배타 생성(`set -C`) → 즉시 `in_progress` + `history` → 구현 → 검증 →
  `qa_waiting` → 반납. 작업 중 만료가 가까워져 한 번 갱신했다.
- 소스 결정 DECISION-EEEEB81D는 `approved`로 유효하다.

### 병행 금지 상대와의 충돌 처리

작업 문서가 "TASK-039와 병행 금지"(둘 다 `mod.rs`에 모듈 선언 한 줄)를 명시했는데, 착수 시점
TASK-039는 `in_progress` + 미만료 lease(dev-037-claude)였다. 개발자 계약의 "겹치는 작업을 덮는 미만료
lease가 없을 것"에 엄밀히는 걸린다. TL에 보고하고 아래대로 진행했다(TL이 병렬 지휘 권한으로 명시
예외 승인).

- 전용 파일(`managed_script.rs` 신규, `heartbeat_condition.rs`)을 먼저 끝냈다.
- `mod.rs`는 공통 규칙 §6대로 직전에 다시 읽고 한 줄만 얹었다. 그 시점에 dev-037의
  `pub mod claim_helper;`가 이미 들어와 있었고 그 줄은 건드리지 않았다.
- 결과적으로 충돌 없이 끝났다.

> **TL이 병렬 지휘 권한으로 이 겹침을 명시 예외로 승인했다.** 근거는 작업 문서에 적힌 "서로 다른
> 한 줄, 순서 무관"이다. 절차는 전용 파일 먼저 → `mod.rs`는 맨 마지막에 직전 재읽기 후 자기 줄만
> 추가 → dev-037의 `claim_helper` 선언 보존이었고, 추가 직후 `cargo build`로 두 모듈 선언이 함께
> 컴파일되는 것까지 확인했다.

## 변경한 파일 (3건, 작업 범위 그대로)

- `src-tauri/src/infrastructure/managed_script.rs` — **신규.** 공용 설치 규약.
  `ManagedScript`·`PlatformScript`·`ManagedScriptError`와 `path`·`relative_path`·`install`·
  `validate`·`plan`·`ensure_regular_file`·`write_atomically`.
- `src-tauri/src/infrastructure/heartbeat_condition.rs` — 자산 서술로 축소. `sh` 본문은 그대로 두고
  PowerShell 본문 추가, 컴파일 시점 플랫폼 분기, `CONDITION_SCRIPT_STEM` 공개, 테스트 조정·추가.
- `src-tauri/src/infrastructure/mod.rs` — `pub mod managed_script;` 한 줄.

범위 밖 파일 무변경: `heartbeat_roles.rs`·`heartbeat_status.rs`·`heartbeat_service.rs`·
`role_eligibility.rs`·`claim_helper.rs`·`scripts/wf-eligible.sh`·화면. 설치본
`.workflow/rules/wf-eligible.sh`도 손대지 않았다.

## 구현 결정

- **오류 문구를 바이트 단위로 보존했다.** `ManagedScriptError`는 기존과 같은 다섯 갈래이고 `label`을
  끼울 자리를 원문이 이미 "조건 스크립트"라고 적던 곳으로 잡았다. `Unmanaged`와 `Persist`는 원문에
  자산 이름이 없어 `label`을 넣지 않았다 — 넣었으면 문구가 바뀐다. `조건 스크립트`와 `선점 헬퍼`가
  둘 다 조사 `를`를 받아 문장이 자연스럽다.
- **`Io`의 `#[from]`을 포기했다.** 문구에 `label`이 들어가야 해서 구조체 배리언트로 바꾸고 모듈 안
  io 호출을 `map_err`로 감쌌다. 외부에서 `io::Error`를 이 타입으로 `?` 하는 곳이 없어 파급이 없다.
  `HeartbeatInstallError::ConditionScript(#[from] ConditionScriptError)` 배선은 그대로다.
- **`pub type ConditionScriptError = ManagedScriptError;`로 이름을 이었다.** 호출처
  (`heartbeat_service.rs`)의 시그니처와 `#[from]`을 건드리지 않기 위한 조건이었다.
- **플랫폼 분기는 `#[cfg(windows)]` / `#[cfg(not(windows))]` 컴파일 시점이다.** 런타임 분기가 아니다.
  두 본문 상수는 항상 컴파일한다 — 버전 줄 대조 테스트가 양쪽을 읽어야 한다.
- **`relative_path()`는 `/`로만 조립한다.** `Path`를 거친 값을 Windows에서 쓰면 `\`가 섞인다
  (`7b6fc69`). 첫 호출처는 TASK-044라 지금은 미사용이고, 모듈에 `#![allow(dead_code)]`와 그 사유를
  주석으로 남겼다(`heartbeat_condition.rs`가 이미 쓰는 방식).
- **다른 플랫폼 자산 제외에 별도 규칙을 두지 않았다.** 설치 경로가 현재 플랫폼의 파일 이름으로만
  조립되므로 다른 확장자 파일은 애초에 걸리지 않는다. R9는 규칙이 아니라 구조로 만족된다.

## PowerShell 본문 — 옮긴 것과 정한 것

인터페이스는 `sh`와 같다. 인자 하나(`planner`|`architect`|`developer`), 종료 코드 `0`/`1`/`2`,
`migration.lock`이 있으면 역할과 무관하게 `1`, 모든 경로가 프로젝트 루트 기준 상대 경로다.

**`sh`의 성질 다섯을 그대로 옮겼다.** 파일 아무 곳이나 보는 검사, 참조의 부분 일치
(`source_idea_id: *IDEA-1`이 `IDEA-10`에 걸린다 — 앵커를 더하지 않았다), `id:` 줄 없는 문서 건너뛰기,
등록 여부를 보지 않는 `.workflow/*/` 순회, 만료를 보지 않는 lease.

**PowerShell 고유의 함정을 잡은 것이 이 작업의 실질이다.** PowerShell은 기본이 대소문자 무시라
그대로 옮기면 `grep`과 판정이 갈린다. 다음을 전부 대소문자 구분 연산자로 바꿨다.

- `-match` → `-cmatch`, `-notmatch` → `-cnotmatch`, `-replace` → `-creplace`, `-eq` → `-ceq`
- `String.StartsWith`/`EndsWith` → `[System.StringComparison]::Ordinal` 오버로드
- `switch` → `switch -CaseSensitive` (`PLANNER`가 `planner`로 잡히면 안 된다)
- `Sort-Object -Property Name` → `-CaseSensitive` (glob 순서에 맞춘다)
- 순환 탐색의 방문 집합 → `@{}`(대소문자 무시 해시테이블) 대신
  `HashSet[string]`(`StringComparer::Ordinal`)

그 밖에 정한 것.

- **`.workflow/*/` 글롭은 점으로 시작하는 이름을 건너뛴다.** `Get-ChildItem -Directory`는 Windows에서
  `.runtime`을 포함하므로 `StartsWith('.')`로 걸러 sh와 맞췄다.
- **본문은 ASCII만 쓴다.** 설치가 BOM 없는 UTF-8로 쓰고 Windows PowerShell 5.1은 그런 `.ps1`을 시스템
  코드페이지로 읽는다. 테스트로 고정했다.
- **판정 로직이 파일 안에 있다(D1).** 조건 문자열에 담지 않았다. TASK-044가 대조할 대상이 파일이어야
  한다.
- **스크립트는 반드시 `exit <코드>`로 끝난다.** 마지막 식 값이 종료 코드가 되게 두지 않았다.
  `$ErrorActionPreference = 'Stop'`이라 예외는 0이 아닌 코드로 떨어져 fail-closed다.
- `$visited.Add()`의 bool 반환이 출력 스트림을 오염시키지 않도록 `if (-not $visited.Add($node))`로
  값을 소비했다.

## 검증 단계와 결과

작업 문서의 검증 절차 그대로 실행했다.

| 명령 | 결과 |
| --- | --- |
| `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` | 통과 |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | 경고 없음 |
| `cargo test --manifest-path src-tauri/Cargo.toml` | 298 passed / 0 failed / 0 ignored |
| `npm run check` | 272 passed (14 files), `tsc -b && vite build` 통과 |

`heartbeat_condition` 테스트는 27개에서 34개가 되었다. 기존 설치 테스트 여섯 개와 실행 테스트 넷은
삭제·비활성화 없이 유지했고, 본문 상수 참조만 자산 서술(`CONDITION_SCRIPT.platform.body`)로 바꿨다.
`the_repository_copy_matches_the_managed_script`는 저장소 사본이 `sh` 한 벌뿐이라 현재 플랫폼과 무관하게
`CONDITION_SCRIPT_SH`와 대조하도록 고쳤다 — 검증하던 사실은 그대로다.

더한 테스트 7건: `installs_the_implementation_for_the_current_platform`(완료 조건 2),
`leaves_the_other_platform_asset_untouched`(완료 조건 5, 내용·수정 시각 둘 다 확인),
`both_implementations_share_the_managed_markers_and_version`(완료 조건 6),
`the_powershell_implementation_is_ascii`(완료 조건 6), `both_implementations_carry_the_same_interface`,
`the_asset_description_carries_its_own_version_axis`, `the_error_messages_are_unchanged`(완료 조건 1,
`Unmanaged`·`Downgrade` 문구를 문자열로 단정).

### 병렬 세션과의 경합

검증 중 dev-051의 `heartbeat_service.rs` 편집 때문에 컴파일과 `cargo fmt`가 각각 한 번씩 깨졌다가
복구됐다. 오류 위치를 매번 확인해 내 세 파일에는 한 건도 없음을 확인했고(`rustfmt --check`로 내 파일만
따로도 확인), 트리가 안정된 뒤 네 게이트를 한 번에 다시 돌려 위 결과를 얻었다. 남의 파일을 대신
포맷하지 않았다.

## 완료하지 못한 것

**Windows 러너에서 기존 테스트 1건이 깨진다.** `heartbeat_service.rs:980`
`an_empty_home_reports_the_slug_and_the_condition_script_path`가
`snapshot.heartbeat.condition_script_path == ".workflow/rules/wf-eligible.sh"`를 단정하는데, 이 테스트는
`#[cfg(test)] mod tests`에 있어 windows 게이트 밖이다. R1·완료 조건 2대로 `condition_script_path`가
플랫폼별 자산을 가리키게 되면서 Windows에서는 `.ps1`이 나온다.

- 게이트 밖에서 `condition_script_path`를 파생해 단정하는 곳은 이 한 곳뿐이다. 나머지
  `wf-eligible.sh` 문자열은 리터럴 문서 픽스처이거나 `#[cfg(all(test, not(windows)))]`의
  `install_tests`, `#[cfg(unix)]`의 `role_eligibility` 테스트라 영향이 없다.
- 고치지 않은 이유: 작업 문서 범위 절이 `heartbeat_service.rs`를 "이 작업에서 바뀌지 않는다"로
  명시했고, 그 파일에 dev-051이 라이브였다.
- **승계처: TASK-044(TL 확인).** TL이 044 배정 지시서에 이 단정(`heartbeat_service.rs:980`,
  `cfg!(windows)` 분기)을 명시 항목으로 넣기로 했다. 이 작업에서 넣지 않는 것도 TL이 확인했다 —
  범위 밖이고 dev-051이 그 파일에 라이브였다. CI는 푸시에서만 돌고 다음 푸시(v0.1.8) 전에 044가
  착지하므로 Windows 러너가 빨간 기간의 실질 영향은 없다.

**PowerShell 본문은 실행·파싱된 적이 없다.** 이 머신에 `pwsh`가 없고 설치할 소프트웨어라 임의로 넣지
않았다(TL 확인). 정적으로 확인한 범위는 ASCII, 괄호·따옴표 균형, 정의되지 않은 함수 호출 없음, 미사용
함수 없음, Rust 원시 문자열 종료 시퀀스 부재, 그리고 sh와 갈리는 지점 정독(대소문자 구분 연산자,
`.workflow/*/` 글롭의 점 파일 제외, 방문 집합 비교자, 파이프라인 출력 오염)이다. **실행 검증은
TASK-043의 Windows 러너 몫이다.**

## 리스크와 후속

1. **위 Windows 테스트 1건이 TASK-044까지 빨갛게 남는다.** CI `rust` 잡이 `fail-fast: false`라 다른
   두 러너 결과는 가려지지 않는다. (CI는 푸시에서만 돌므로 다음 푸시 전 TASK-044 착지 시 실질 영향
   없음 — TL 주기)
2. **PowerShell 본문의 첫 실행이 TASK-043이다.** 정적 검사가 잡지 못하는 것(런타임 타입, 파이프라인
   출력 오염, 5.1과 7의 동작 차이)이 거기서 처음 드러난다. 특히 `Get-Lines`가 빈 배열을 반환할 때
   PowerShell이 `$null`로 언롤하는 성질에 기대고 있어(호출부는 모두 zero-iteration으로 안전하게
   동작하도록 썼다) 그 경로를 시나리오 표에서 꼭 덮어야 한다.
3. **`scripts/wf-eligible.ps1` 사본은 만들지 않았다**(기획서 제외 범위). 저장소 사본은 `sh` 한 벌이고
   대조 테스트도 그 한 벌만 본다.
4. **관리 실행 자산이 이제 둘이고 규약이 갈려 있다.** 조건 스크립트는 이 작업이 만든
   `managed_script` 공용 규약을 쓰고, 선점 헬퍼(`claim_helper.rs`, dev-037의 TASK-039)는 자기
   설치·검증 로직을 따로 갖는다. **의도된 상태다** — TASK-039 문서가 공용화를 명시 금지했다. 헬퍼를
   공용 규약으로 옮기는 것과 그 PowerShell 구현은 TASK-047(`depends_on: [TASK-039, TASK-042]`)이고,
   그때 "조건 스크립트와 선점 헬퍼의 `version_prefix`가 다르다"를
   `the_asset_description_carries_its_own_version_axis` 옆에 더하면 된다. 작업 문서가 그 항목을
   TASK-047로 넘기도록 허용했다. 다음 세션은 `.workflow/rules/`에 관리 자산이 둘이고 그중 하나만
   공용 규약 위에 있다는 것을 전제로 읽으면 된다.
5. **`heartbeat_roles.rs`의 조건 문자열은 아직 `sh .workflow/rules/wf-eligible.sh`로 하드코딩돼 있다.**
   Windows에서 설치되는 파일과 잡에 적히는 명령이 어긋난 상태이고, 이것을 맞추는 것이 TASK-044다.
   현재 Windows는 `PLATFORM_SUPPORTED`가 거짓이라 설치 자체가 막혀 있어 실사용 영향은 없다.

## 사용자 QA 제안

이 작업은 파일만 쓴다. 앱이 스크립트를 실행하는 경로는 테스트 밖에 만들지 않았다.

1. macOS·Linux에서 앱을 열고 `.workflow/rules/wf-eligible.sh`가 그대로 설치·갱신되는지, 화면의 조건
   스크립트 경로 표시가 이전과 같은지 본다. 이 작업 전후로 달라지면 안 된다.
2. `.workflow/rules/`에 `wf-eligible.ps1`을 손으로 하나 만들어 두고 앱을 다시 열어, 그 파일이
   바이트 그대로 남고 오류나 경고가 뜨지 않는지 본다(R9).
3. `.workflow/rules/wf-eligible.sh`의 관리 표기 줄을 지운 뒤 앱을 열어 덮어쓰지 않고 오류 문구가
   이전과 같은 문장으로 뜨는지 본다.
4. Windows 실기 확인(설치되는 파일이 `.ps1`인지, 그 스크립트가 세 역할에서 올바른 종료 코드를 내는지)은
   이 작업에서 닫지 않는다. TASK-043·TASK-045의 사용자 QA 항목이다.
