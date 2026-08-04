# TASK-045 개발자 핸드오프

- 대상 작업: TASK-045 (연동의 Windows 차단을 해제하고 설치 검증을 세 러너 모두에서 돌린다)
- 근거 문서: SPEC-015 R5·R7, D3, DECISION-EEEEB81D (approved, created_by: user)
- 세션 역할: 개발자 (TL 배정)
- 작성 시각: 2026-08-03T10:11Z
- 상태: `qa_waiting`

## 대상 선정 근거

- 선행 선언 `depends_on: [TASK-044]`가 충족이다. 착수 시점 TASK-044는 `qa_waiting`이었고, 그 산출물인
  플랫폼별 `condition_command`가 트리에 있었다. R12가 정한 "조건 스크립트 쪽이 준비되면 그때 푼다"는
  순서를 지킨 착수다. 차단을 먼저 풀었다면 Windows 사용자가 설치한 잡의 조건이 `sh ...`로 기록되고
  하트비트가 그 잡을 조용히 건너뛴다.
- 병행 금지 상대 TASK-046(`IntegrationsView.test.tsx` 공유)도 `qa_waiting`이라 해소된 상태였다.
- `migration.lock` 없음. 착수 시점(10:04Z) lease는 `SPEC-009.yml`(만료)·`TASK-053.yml`·`TASK-055.yml`
  셋이고 전부 내 대상이 아니라 손대지 않았다.
- 선점: `leases/TASK-045.yml` 배타 생성(`set -C`) → `in_progress` + `history` → 구현 → 검증 →
  `qa_waiting` → lease 반납.

## 구현

### 1. 백엔드의 차단 제거 (완료 조건 1·2)

- `PLATFORM_SUPPORTED`(`!cfg!(windows)`) 상수를 지웠다.
- `install`(역할 잡)과 `install_dream`의 진입 거부 두 자리를 없앴다. 그 둘이 사라지면서
  `HeartbeatInstallError::UnsupportedPlatform`을 만드는 곳이 없어져 그 변형도 지웠다. 문구 자체가
  "조건 검사가 POSIX sh 스크립트라 Windows에서는…"이라 이 작업 뒤에는 사실이 아니게 되는 문장이다.
  **이 작업 때문에 쓰이지 않게 된 것만 지웠다.**
- `supported` 필드는 남기고 `true`를 쓴다. 왜 지금은 항상 참인지와, 다시 미지원으로 표시할 플랫폼이
  생기면 그 값이 나갈 자리라는 것을 주석으로 남겼다(R5, SPEC-003의 섹션 공통 계약).

### 2. `install_tests` 게이트 해제 (완료 조건 4)

`#[cfg(all(test, not(windows)))]` → `#[cfg(test)]`. 게이트 사유("설치는 POSIX `sh` 조건 스크립트를
전제하므로")가 이 작업으로 사라졌다. 모듈 주석을 그 사실로 바꾸고, 재현할 수 없는 사유가 있는
테스트는 그 테스트 하나만 게이트하라는 규칙을 함께 적었다.

**개별 게이트를 새로 만들 필요가 없었다.** 그 모듈의 64개 테스트가 macOS에서 전부 통과하고,
Windows에서 갈릴 자리는 조건 문자열과 자산 경로 둘뿐인데 둘 다 아래처럼 플랫폼을 따르게 만들었다.

- `script_file` 헬퍼는 `condition_script_path`를 쓰므로 이미 플랫폼별 확장자를 낸다. 손대지 않았다.
- 조건 리터럴 두 자리(`- condition: sh .workflow/rules/wf-eligible.sh {role}` 단정과, 손편집 테스트의
  `replace` 대상)를 TASK-044의 `condition_command(role)`로 바꿨다. 여기서 제품 함수를 쓰는 것이
  맞는 이유는, 이 테스트들이 확인하는 것이 "설치가 그 값을 그대로 썼는가"이지 문자열의 바이트 고정이
  아니기 때문이다. 바이트 고정은 `heartbeat_roles.rs`가 리터럴로 따로 갖고 있다(TASK-044).

`#[cfg(unix)]` 둘(`:1273`·`:1591`)은 그대로 뒀다. 파일 권한을 조작해 읽기 실패를 재현하는
테스트이고 플랫폼 지원과 사유가 다르다.

검증 절차의 확인 명령 결과다.

```
$ grep -n "not(windows)" src-tauri/src/application/heartbeat_service.rs
(출력 없음)
```

### 3. 미지원 안내 문구 (완료 조건 3)

`IntegrationsView.tsx`의 분기와 `<strong>` 줄은 그대로 두고 `<p>` 한 줄만 바꿨다.

- 지운 문장: "조건 검사가 POSIX sh 스크립트라 Windows에서는 잡이 조용히 건너뛰어집니다."
- 새 문장: "앱이 이 플랫폼에서는 연동 잡을 설치하지 않습니다. 설치와 저장 액션은 비활성 상태입니다."

앱이 아는 사실까지만 적고 OS 이름과 구현 이름을 담지 않는다. 이 분기가 지금 어떤 플랫폼에서도
그려지지 않는다는 것과, 그래도 남기는 이유(payload 계약)를 주석으로 남겼다.

### 4. Windows의 slug — 확인이 먼저다 (완료 조건 5)

R7이 요구한 것은 "확인한다"이지 "미리 고친다"가 아니다. **slug 생성 규칙을 바꾸지 않았다.**

Windows 형태 경로에 대해 지금 규칙이 내는 값을 테스트로 고정했다. 판정이 아니라 사실 기록이다.

```
project_slug(r"C:\Users\catze\project\workflow-labs") == r"-C:\Users\catze\project\workflow-labs"
```

경로에 `/`가 없으므로 치환이 일어나지 않고 앞에 `-`만 붙는다. `\`와 `:`가 잡 이름에 그대로 남는다.
하트비트의 역변환은 `/`에서 시작해 존재하는 디렉터리를 최장 일치로 찾아 내려가는 추정이라, 이 값을
프로젝트 루트로 되돌릴 수 있는지는 이 저장소에서 확인할 수 없다. 그 확인이 사용자 QA 항목
(기획서 완료 조건 18)이고, 이 테스트는 깨졌을 때 무엇을 바꿔야 하는지를 한자리에서 보여 준다.

**갈림길을 적어 둔다.** QA에서 역변환이 깨지는 것이 확인되면 그것은 이 작업의 재작업이 아닐 수 있다.
slug 생성 규칙을 바꾸면 이미 설치된 잡의 이름이 바뀌어 하트비트의 실행 이력과 실행 한도 창이
초기화되므로, 잡 이름 변경 고지(완료 조건 19)가 함께 와야 한다. 별건으로 다룰지는 사용자가 정한다.

## 변경한 파일 (3건 + 작업 문서)

- `src-tauri/src/application/heartbeat_service.rs` — 상수 제거, 거부 두 자리 제거, 오류 변형 제거,
  `supported: true`와 주석, `install_tests` 게이트 해제와 모듈 주석, 조건 리터럴 두 자리의 플랫폼
  대응, 테스트 2건 추가와 기존 단정 1건 갱신.
- `src/features/projects/components/integrations/IntegrationsView.tsx` — 미지원 안내 `<p>` 한 줄과 주석.
- `src/features/projects/components/integrations/IntegrationsView.test.tsx` — 기존 배너 테스트에 금지
  낱말 단정 추가, 지원 상태 테스트 1건 추가.
- `.workflow/도그푸딩--wf_ae6cd700/tasks/TASK-045.md` — 상태 전이와 `history`.

**`HeartbeatCard.tsx`·`DreamCard.tsx`·`App.css`·`types.ts`·`heartbeat_roles.rs`·`heartbeat_status.rs`·
`heartbeat_condition.rs`는 한 줄도 바꾸지 않았다.** 작업 문서가 명시 제외한 파일이고, 카드 둘은
TASK-053 세션이 동시에 잡고 있었다.

## 더한 테스트 3건

- `records_what_the_slug_rule_produces_for_a_windows_shaped_path` — 4절의 사실 기록. `/` 형태 경로가
  지금 값 그대로라는 것도 함께 고정해 규칙이 바뀌지 않았음을 보인다.
- `shows no platform banner while the integration is supported`(프런트) — `supported: true`에서 배너가
  없고 설치 버튼이 활성이다. 기존 `supported: false` 테스트의 짝이다.
- 기존 배너 테스트에 금지 낱말 단정 추가 — 배너 텍스트에 `Windows`·`macOS`·`Linux`·`POSIX`·
  `sh 스크립트`가 없다(R5). 검증하던 사실이 줄지 않고 늘었다.

기존 `assert_eq!(snapshot.supported, !cfg!(windows))`는 `assert!(snapshot.supported)`로 고쳤다.
바뀐 동작을 담은 것이고 지우지 않았다(작업 문서 1절의 지시).

## 검증

| 명령 | 결과 |
| --- | --- |
| `cargo test --manifest-path src-tauri/Cargo.toml` | 307 passed / 0 failed |
| `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` | 차이 없음 |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | 경고 0 |
| `npm run check` | 294 passed (14 파일) + 빌드 성공 |
| `grep -n "not(windows)" heartbeat_service.rs` | 출력 없음 (모듈 단위 게이트 없음) |

- 삭제·비활성화한 테스트 없음. `install_tests`는 게이트가 풀리면서 오히려 Windows에서 새로 돈다.
- 병렬 세션 관측: `npm run check`가 한 번 4건 실패(2개 파일)로 나왔다. 재실행에서 294 전부 통과했고,
  실패한 파일은 내가 만지지 않은 카드 테스트였다. TASK-053 세션이 그 두 파일을 동시에 편집 중이었다.
  내 변경 파일(`IntegrationsView.tsx`·`IntegrationsView.test.tsx`)은 단독 실행에서도 119건 통과했다.

## 사용자 QA 항목 — 자동화로 닫지 않은 것

DECISION-EEEEB81D가 확정한 대로 아래는 개발자 세션이 테스트 통과로 대신 닫지 않는다. **전부 실제
Windows 환경이 필요하고, CI Windows 러너는 `cargo test`만 돌려 이 중 어느 것도 검증하지 않는다.**

1. **기획서 완료 조건 12.** PowerShell 실행 정책을 기본값으로 되돌린 Windows에서, 관리 블록에 기록된
   `condition` 문자열을 그대로 실행해 조건 스크립트의 종료 코드가 나오는지.
2. **기획서 완료 조건 13.** Windows에서 연동 뷰에 미지원 배너가 보이지 않고, 역할 잡 설치·저장·기본값
   재설정 버튼이 활성인지.
3. **기획서 완료 조건 18.** Windows에서 하트비트가 잡의 slug를 역변환한 cwd가 실제 프로젝트 루트이고,
   그 cwd에서 상대 경로 조건이 종료 코드 0을 내는지. 4절의 slug 값이 이 확인의 입력이다.
4. **기획서 완료 조건 19.** 3번에서 역변환이 깨지지 않았다면 "해당 없음"으로 기록한다. 깨졌다면 위
   갈림길대로 별건 여부를 사용자가 정한다.
5. **기획서 완료 조건 22의 절반.** Windows에서 dream 카드가 열리는지. 카드의 비보증 표기는 TASK-046이
   이미 처리했다.

## 리스크와 후속

1. **Windows 러너 검증 대기.** `install_tests` 64건이 Windows에서 도는 것은 다음 푸시 CI가 처음이다.
   이 머신은 macOS라 로컬에서는 그 경로를 확인할 수 없었다. 거기서 깨지면 후보는 둘이다 — 조건 명령의
   PowerShell 형태(TASK-044)나 조건 스크립트 PowerShell 본문(TASK-042). 이 작업이 만든 것은 게이트
   해제뿐이라, 실패가 나와도 수정 지점은 대개 그 두 작업 쪽이다.
2. **Windows 사용자에게 연동이 열렸지만 선점 헬퍼는 아직 없다**(D5·R12). TASK-047 전까지 Windows에는
   `wf-claim.sh`도 `.ps1`도 없고, "헬퍼가 있으면 강제"가 그 플랫폼에서만 켜지지 않는다. 각 플랫폼
   안에서는 같은 규칙(파일이 있으면 쓴다)의 결과라 모순이 없다. 기획서가 이 시한부 차이를 규칙 문서나
   화면에서 예외로 다루지 말라고 정했으므로 아무것도 적지 않았다.
3. **미지원 분기는 이제 죽은 코드에 가깝다.** 어떤 플랫폼에서도 `supported`가 거짓이 아니므로 배너가
   그려지지 않는다. 남긴 이유(payload 계약, R5)를 코드 주석과 테스트로 함께 묶어 뒀다. 다음 세션이
   "안 쓰이니 지운다"로 읽지 않게 하는 것이 그 주석의 목적이다.
4. **slug 규칙은 손대지 않았다.** Windows 잡 이름에 `\`와 `:`가 들어간다. 하트비트가 그 이름을 파일명
   등으로 쓰는 경로가 있으면 별도 문제가 될 수 있는데, 그것은 하트비트 저장소의 일이고 이 기획서의
   제외 범위다.
