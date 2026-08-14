---
schema: workflow-labs/task@1
id: TASK-045
title: 연동의 Windows 차단을 해제하고 설치 검증을 세 러너 모두에서 돌린다
status: verified
source_spec_id: SPEC-015
source_decision_id: DECISION-EEEEB81D
depends_on:
- TASK-044
updated_at: 2026-08-14T09:08:07.880257+00:00
history:
- at: 2026-08-03T06:50:00Z
  kind: created
- at: 2026-08-03T10:04:15Z
  kind: in_progress
- at: 2026-08-03T10:13:00Z
  kind: qa_waiting
- at: 2026-08-04T11:45:26.654391+00:00
  kind: completed
- at: 2026-08-14T09:08:07.880257+00:00
  kind: migrated_verified
work_group_id: GROUP-DECISION-EEEEB81D
work_group_revision: 1
---

# 연동의 Windows 차단을 해제하고 설치 검증을 세 러너 모두에서 돌린다

SPEC-015 R5·R7을 구현한다. 지금 연동은 Windows에서 통째로 막혀 있고, 막은 이유 하나(조건 스크립트가
POSIX `sh`뿐이라는 것)를 TASK-042·TASK-044가 없앤다. 이 작업이 차단을 푼다.

이 작업은 이 기획서에서 실기 확인이 가장 많이 필요한 자리다. CI Windows 러너는 `cargo test`만 돌린다.
앱 화면, PowerShell 실행 정책이 걸린 상태의 조건 실행, 데몬이 slug를 역변환해 잡은 cwd는 그 러너가
검증하지 않는다. DECISION-EEEEB81D가 그 항목들(기획서 완료 조건 12·13·18·19)을 사용자 QA로 남기기로
확정했다. **개발자 세션은 자동화 테스트 통과를 그 확인의 대체로 삼지 않는다.**

## 의존성

- **선행 필수: TASK-044.** 차단을 먼저 풀면 Windows 사용자가 설치한 잡의 조건이 `sh ...`로 기록되고,
  하트비트가 그 잡을 조용히 건너뛴다. R12가 "조건 스크립트 쪽이 준비되면 그때 푼다"고 정한 순서다.
  TASK-044는 TASK-042를, TASK-042는 TASK-040을 선행으로 둔다.
- **선점 헬퍼(TASK-047)를 기다리지 않는다**(D5·R12). 그 사이 기간에는 Windows에 헬퍼 파일이 없고,
  DECISION-73D4BC1B가 정한 "헬퍼가 있으면 강제"가 Windows에서만 켜지지 않는다. 플랫폼마다 파일 존재
  여부를 보는 같은 규칙의 결과라 각 플랫폼 안에서는 모순이 없고, TASK-047이 들어오면 사라진다
  (R10 마지막 줄). 이 시한부 차이를 규칙 문서나 화면에서 예외로 다루지 않는다.
- **TASK-046과 병행 금지.** 둘 다 `IntegrationsView.test.tsx`를 만진다. 서로 다른 테스트를 고치므로
  순서는 어느 쪽이 먼저여도 된다.
- `WorkspaceShell.tsx`·`App.css`·`types.ts`·`domain/project.rs`를 만지지 않으므로 SPEC-011·SPEC-012
  계열 작업과 겹치는 파일이 없다.

## 범위

- `src-tauri/src/application/heartbeat_service.rs` — `PLATFORM_SUPPORTED`와 두 설치 경로의 플랫폼 거부,
  `UnsupportedPlatform` 변형, `install_tests` 게이트, 관련 테스트.
- `src/features/projects/components/integrations/IntegrationsView.tsx` — 미지원 안내 문구.
- `src/features/projects/components/integrations/IntegrationsView.test.tsx` — 위 문구 테스트.
- 그 외 파일은 건드리지 않는다. 특히 `HeartbeatCard.tsx`·`DreamCard.tsx`·`types.ts`·`App.css`·
  `heartbeat_roles.rs`·`heartbeat_status.rs`·`heartbeat_condition.rs`는 이 작업에서 바뀌지 않는다.

## 작업 내용

### 0. 먼저 읽을 제약

- **지원 여부 판정을 연동별로 쪼개지 않는다**(R5·D3). `supported`는 섹션 공통 값이고, 그것이 SPEC-003
  확인 필요 2번의 승인된 결정이다. dream도 같은 값으로 함께 열린다.
- **화면 문구가 특정 OS 이름을 하드코딩한 채 남지 않는다**(R5).
- **slug 생성 규칙을 근거 없이 바꾸지 않는다**(R7). 잡 이름이 하트비트의 상태 키라, 바꾸면 이미 설치된
  잡의 실행 이력과 실행 한도 창이 초기화된다.
- **하트비트 패키지를 고치지 않는다**(기획서 제외 범위). slug 역변환은 그 저장소의 일이다.

### 1. 백엔드의 차단 제거

`PLATFORM_SUPPORTED`(`:33`)가 `!cfg!(windows)`다. 이 값이 세 자리로 나간다.

- `:294` — 스냅샷의 섹션 공통 `supported`.
- `:334` — `install`(역할 잡) 진입 거부.
- `:372` — `install_dream` 진입 거부.

`:334`·`:372`의 거부를 없앤다. 그 둘이 사라지면 `HeartbeatInstallError::UnsupportedPlatform`(`:251`)을
만드는 곳이 없어지므로 그 변형도 지운다. 이 변형의 문구는 "조건 검사가 POSIX sh 스크립트라 Windows에서는
잡이 조용히 건너뛰어집니다"로, 사실이 아니게 되는 문장이기도 하다. **이 작업 때문에 쓰이지 않게 된
것만 지운다.**

`supported` 필드는 남긴다(R5). SPEC-003이 정한 섹션 공통 계약이고, 앞으로 어떤 플랫폼을 다시 미지원으로
표시해야 할 때 그 값이 나갈 자리다. `PLATFORM_SUPPORTED` 상수를 지우고 `:294`에 `true`를 쓰되, 왜
지금은 항상 참인지를 한 줄 주석으로 남긴다. 화면의 미지원 분기도 함께 남는다.

`:931`의 `assert_eq!(snapshot.supported, !cfg!(windows))`는 바뀐 동작을 담도록 고친다. 지우지 않는다.

### 2. `install_tests` 게이트 해제

`heartbeat_service.rs:1609`의 `#[cfg(all(test, not(windows)))] mod install_tests`가 설치 경로 테스트를
통째로 Windows에서 빼고 있다. 게이트 사유("설치는 POSIX `sh` 조건 스크립트를 전제하므로")가 이
작업으로 사라진다. `#[cfg(test)]`로 바꾼다.

- 그 모듈의 리터럴 조건 기대값(`:1791`·`:2296` 등)은 TASK-044가 만든 플랫폼별 형태에 맞춰 나눈다.
  `script_file`(`:1770`)이 쓰는 자산 경로도 플랫폼에 따라 확장자가 다르다.
- Windows에서 재현할 수 없는 이유가 있는 **개별** 테스트가 나오면 그 테스트 하나만 게이트하고 사유를
  주석에 남긴다. 모듈 전체로 게이트가 되돌아가지 않게 한다.
- `:1193`·`:1457`의 `#[cfg(unix)]`는 그대로 둔다. 파일 권한을 조작해 읽기 실패를 재현하는
  테스트이고, 플랫폼 지원과 무관한 사유다.

### 3. 미지원 안내 문구

`IntegrationsView.tsx:57`~`:62`의 분기를 남기고 본문만 고친다.

- `<strong>` 줄("이 플랫폼에서는 연동을 지원하지 않습니다")은 그대로 둔다. OS 이름이 없고, 기존
  테스트가 이 문자열로 분기를 확인한다.
- `<p>` 줄("조건 검사가 POSIX sh 스크립트라 Windows에서는 잡이 조용히 건너뛰어집니다")은 지운다.
  Windows와 `sh`를 하드코딩했고, 이 작업 뒤에는 사실이 아니다. 대신 앱이 아는 사실까지만 적는
  한 문장으로 바꾼다 — 이 플랫폼에서는 앱이 연동 잡을 설치하지 않는다는 것과, 그래서 설치·저장
  액션이 비활성이라는 것.
- 이 분기는 지금 어떤 플랫폼에서도 그려지지 않는다. 화면에서 지우지 않는 이유는 payload 계약이
  남아 있기 때문이다(1절). 그 사실을 주석 한 줄로 남긴다.

### 4. Windows의 slug와 cwd — 확인이 먼저다

R7이 요구하는 것은 "확인한다. 깨면 이 범위에서 맞춘다"이지 "미리 고친다"가 아니다.

알려진 사실만 적는다. 앱의 slug 생성(`heartbeat_jobs.rs:120`)은 프로젝트 경로 문자열의 `/`를 `-`로
바꾸고 앞에 `-`를 붙인다. Windows 경로는 구분자가 `\`이고 드라이브 문자가 앞에 붙으므로, 이 규칙이
만든 값을 하트비트가 되돌릴 수 있는지는 이 저장소에서 확인할 수 없다. 하트비트의 역변환은 `/`에서
시작해 존재하는 디렉터리를 최장 일치로 찾아 내려가는 추정이다.

이 작업이 하는 것은 둘이다.

- Windows 형태 경로에 대해 지금 규칙이 내는 slug 값을 테스트로 고정한다. 판정이 아니라 사실 기록이다.
  이 값이 QA에서 문제가 되면 무엇을 바꿔야 하는지가 이 테스트에서 바로 보인다.
- slug 생성 규칙을 **바꾸지 않는다.** 실기 확인 없이 바꾸면 이미 설치된 잡의 이름이 바뀌어 실행 이력과
  한도 창이 초기화된다. 기획서 완료 조건 19가 "규칙을 바꾸지 않았다면 이 조건은 해당 없음으로
  기록한다"를 허용한다.

QA에서 역변환이 깨지는 것이 확인되면, 그것은 이 작업의 재작업이 아니라 새 아이디어로 다뤄야 할 수
있다. 잡 이름 변경 고지(완료 조건 19)가 함께 와야 하기 때문이다. 보고서에 그 갈림길을 적는다.

### 5. 테스트

Rust:

- Windows에서 역할 잡 설치 요청이 플랫폼을 이유로 거부되지 않는다. (완료 조건 14) 게이트가 풀린
  `install_tests`가 Windows 러너에서 도는 것 자체가 이 확인이다.
- dream 설치도 같다.
- 스냅샷의 `supported`가 모든 플랫폼에서 참이다.
- Windows 형태 경로의 slug 값 고정. (4절)

프런트엔드:

- `supported: false`일 때 미지원 안내가 뷰 공통 위치에서 한 번만 그려진다. 기존 테스트(`:359`)가
  `<strong>` 문자열로 확인하므로 그대로 통과한다.
- `supported: true`일 때 그 안내가 없고 설치·저장 버튼이 활성이다. 기존 테스트(`:575`·`:800`)의 짝을
  확인한다.
- 안내 문구에 특정 OS 이름이 없다. (R5)

## 완료 조건

1. 잡 설치 경로가 플랫폼을 이유로 요청을 거부하지 않고, 그 거부를 위해 있던 오류 변형이 남지 않는다.
   (기획서 완료 조건 14)
2. 스냅샷의 `supported`가 모든 플랫폼에서 참이고, 섹션 공통 값이라는 구조와 화면의 미지원 분기가
   그대로 남는다. (기획서 완료 조건 13의 payload 몫, R5)
3. 미지원 안내 문구에 특정 OS 이름과 `sh` 같은 구현 이름이 없다. (R5)
4. `install_tests` 모듈이 세 플랫폼에서 컴파일·실행되고, 게이트가 남았다면 개별 테스트 단위이며 사유가
   주석에 있다.
5. Windows 형태 경로에 대한 slug 생성 결과가 테스트로 고정되어 있고, slug 생성 규칙은 바뀌지 않았다.
   (기획서 완료 조건 19의 전제)
6. 기존 Rust·프런트엔드 테스트가 삭제·비활성화 없이 통과한다. 플랫폼 지원 값이 바뀌어 기대값을 고쳐야
   하는 테스트는 고치되, 검증하던 사실이 줄지 않는다. (기획서 완료 조건 30)
7. `cargo fmt --check`·`cargo clippy -D warnings`·`cargo test`와 `npm run check`가 통과한다.
   (기획서 완료 조건 31)

## 검증 절차

```sh
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
npm run check
```

게이트가 모듈 단위로 남아 있지 않은지 확인한다.

```sh
grep -n "not(windows)" src-tauri/src/application/heartbeat_service.rs
```

## 사용자 QA 항목

DECISION-EEEEB81D가 확정한 대로, 아래는 개발자 세션이 자동화 테스트 통과로 대신 닫지 않는다. 전부 실제
Windows 환경이 필요하다.

- 기획서 완료 조건 12. PowerShell 실행 정책을 기본값으로 되돌린 Windows에서, 관리 블록에 기록된
  `condition` 문자열을 그대로 실행해 조건 스크립트의 종료 코드가 나오는지.
- 기획서 완료 조건 13. Windows에서 연동 뷰에 미지원 경고 배너가 보이지 않고, 역할 잡 설치·저장·기본값
  재설정 버튼이 활성 상태인지.
- 기획서 완료 조건 18. Windows에서 하트비트가 잡의 slug를 역변환한 cwd가 실제 프로젝트 루트이고, 그
  cwd에서 상대 경로 조건이 종료 코드 0을 내는지. 데몬이 잡을 실행하게 두고 로그와 상태 파일로
  확인하거나, 같은 slug로 역변환 결과를 재현해 확인한다.
- 기획서 완료 조건 19. 18번에서 역변환이 깨지지 않았다면 "해당 없음"으로 기록한다. 깨졌다면 slug 생성
  규칙 변경과 잡 이름 변경 고지가 함께 필요하므로, 이 작업의 재작업이 아니라 별건으로 다룰지 사용자가
  정한다.
- 기획서 완료 조건 22의 절반. Windows에서 dream 카드가 열리는지. 카드의 비보증 표기는 TASK-046이다.

## 범위 밖

- 조건 명령 조립과 중복 감지. TASK-044다.
- 자산 설치 규약·본문·버전. TASK-042다.
- 판정 일치 시나리오 표. TASK-043이다.
- 선점 헬퍼의 Windows 지원. TASK-047이고, 이 작업은 그것을 기다리지 않는다(D5).
- `skipped` 문구와 dream 카드의 외부 명령 비보증 표기. TASK-046이다.
- Windows용 설치 안내 강화와 설치 마법사. IDEA-48EDAF2B로 따로 있다.
- 하트비트 데몬을 Windows에 등록하는 절차의 앱 내 안내(기획서 제외 범위).
- 하트비트 패키지의 slug 역변환·조건 실행 방식 수정.
- 실행 한도·주기 기본값의 플랫폼별 차등(기획서 제외 범위).
- `frontend` CI 잡을 Windows로 늘리는 것(기획서 제외 범위).

## 참고 사실

확인 시점 2026-08-03. 추정 없이 파일에서 읽은 값이다.

- `PLATFORM_SUPPORTED`(`heartbeat_service.rs:33`)는 `!cfg!(windows)`이고 `:294`·`:334`·`:372` 세 곳에서
  쓰인다. `:931`의 테스트가 그 값을 `!cfg!(windows)`로 단정한다.
- `HeartbeatInstallError::UnsupportedPlatform`(`:251`)을 만드는 곳은 `:335`·`:373` 둘뿐이고, 이
  변형을 문자열로 단정하는 테스트나 프런트엔드 코드는 없다.
- `install_tests`(`:1609`)는 `#[cfg(all(test, not(windows)))]`다. `:1193`·`:1457`의 `#[cfg(unix)]`는
  파일 권한 조작 테스트라 사유가 다르다.
- 화면에서 `supported`를 쓰는 곳은 셋이다. `IntegrationsView.tsx:57`의 뷰 공통 배너,
  `HeartbeatCard.tsx:330`·`:703`·`:777`, `DreamCard.tsx:293`·`:638`·`:709`. 카드 쪽은 버튼 비활성과
  폼 표시 분기다.
- `IntegrationsView.test.tsx:359`가 `<strong>` 문자열로 배너를 확인하고 뷰에서 한 번만 그려지는지
  본다. `:575`·`:800`이 `supported: false`에서 설치·저장 버튼이 비활성인지 본다.
- 앱의 slug 생성은 `heartbeat_jobs.rs:120`의 `project_slug`다. 경로 문자열의 `/`를 `-`로 바꾸고 앞에
  `-`를 붙인다.
- 홈 디렉터리 해석은 커맨드 계층이 Tauri 경로 API로 한다. `HOME` 환경 변수를 쓰지 않으므로 Windows에서도
  성립한다.
- 하트비트 서비스 등록 어댑터는 darwin·win32·linux 셋이고 win32는 Task Scheduler다. 데몬 자체는
  Windows에서 돈다.
- CI `rust` 잡은 세 러너 매트릭스이고 `cargo test`만 돌린다. 앱 화면과 데몬은 CI에 없다.
