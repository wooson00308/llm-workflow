---
schema: workflow-labs/task@1
id: TASK-006
title: 설정 화면 연동 섹션 읽기 전용 표시와 상태 조회 커맨드 연결
status: verified
source_spec_id: SPEC-002
source_decision_id: DECISION-1265B3C7
updated_at: 2026-08-14T09:08:07.880257+00:00
history:
- at: 2026-08-14T09:08:07.880257+00:00
  kind: migrated_verified
work_group_id: GROUP-DECISION-1265B3C7
work_group_revision: 1
---

# 설정 화면 연동 섹션 읽기 전용 표시와 상태 조회 커맨드 연결

SPEC-002의 R1 표시, R5의 상태 표시, R7의 경고 표시를 구현한다. 이 작업이 만드는 경로에는 쓰기가 하나도 없다. 설치·토글·편집 액션은 TASK-007이 붙인다.

## 의존성

- TASK-004, TASK-005 선행 필수. 두 모듈이 없으면 조회할 것이 없다.
- TASK-003과는 무관하다.
- TASK-007이 이 작업의 커맨드 계층과 화면 구조 위에 쓰기 액션을 얹는다.

## 범위

- 신규 파일 `src-tauri/src/commands/heartbeat.rs`, `src-tauri/src/application/heartbeat_service.rs`.
- `src-tauri/src/commands/mod.rs`, `src-tauri/src/application/mod.rs`에 모듈 선언 각 1줄.
- `src-tauri/src/lib.rs`의 `invoke_handler`에 조회 커맨드 등록.
- 프론트엔드: `src/features/projects/domain/types.ts`(타입과 게이트웨이 시그니처), `src/features/projects/infrastructure/tauriProjectGateway.ts`(호출), `src/features/projects/application/useProjectWorkspace.ts`(상태와 폴링), `src/features/projects/components/SettingsView.tsx`(표시).
- 신규 테스트 파일 `src/features/projects/components/SettingsView.test.tsx`.
- `src/App.css`에 필요한 스타일 추가.

## 작업 내용

### 1. 홈 디렉터리 해석 (커맨드 계층)

- 하트비트 홈 경로는 커맨드에서만 계산한다. Tauri v2의 경로 API를 쓴다. 커맨드 시그니처에 `app: tauri::AppHandle`을 받고 `tauri::Manager`의 `app.path().home_dir()`로 홈을 구한 뒤 `.claude`를 붙인다.
- `std::env::var("HOME")`을 쓰지 않는다. Windows에서 성립하지 않는다.
- 홈을 구하지 못하면 오류를 반환한다. 이 경우는 화면에서 연동 카드를 "상태를 읽을 수 없음"으로 표시한다.

### 2. 조회 커맨드

- 커맨드는 하나다. 프로젝트 루트 경로를 받아 아래를 한 번에 담은 결과를 반환한다.
  - 하트비트 설치 상태 3종 (TASK-005)
  - 앱 관리 블록에 현재 설치된 역할 잡 목록과 각 잡의 `interval`·`max_per`·`model` (TASK-004의 파서)
  - 역할 잡별 마지막 실행 시각·결과·소요 시간 (TASK-005)
  - 관리 블록 밖의 중복 역할 잡 목록 (TASK-005)
  - 현재 프로젝트의 slug와 조건 스크립트 상대 경로 — 사용자가 눈으로 확인할 수 있어야 한다(R3)
  - 현재 플랫폼이 이 연동을 지원하는지 여부
- 커맨드 이름은 기존 명명(`inspect_project`, `read_spec`)과 결이 맞게 짓는다.
- 이 커맨드는 어떤 파일도 쓰지 않는다. 대상 파일이 없어도 오류가 아니라 "미설치"로 답한다.
- `application/heartbeat_service.rs`는 `ProjectService`와 같은 얇은 계층으로 만든다. 인프라 모듈을 호출하고 오류를 문자열로 바꾸는 일만 한다.

### 3. 플랫폼 지원 여부

- 기획서 `확인 필요` 2번이 승인된 대로, 이번 범위는 POSIX `sh` 조건 스크립트 하나뿐이다. Windows에서는 연동을 지원하지 않는다.
- 지원 여부는 백엔드에서 컴파일 타임 조건(`cfg(windows)`)으로 판정해 결과에 담는다. 프론트에서 `navigator` 같은 값으로 추정하지 않는다.
- 미지원 플랫폼에서는 상태 조회 자체는 그대로 하되, 화면에 미지원 안내를 표시한다. 설치 액션 차단은 TASK-007이 담당한다.

### 4. 폴링 (R5)

- 상태 조회는 `useProjectWorkspace`의 **기존 2.5초 인터벌 안에서** 함께 호출한다. `setInterval`을 새로 만들지 않는다. 기획서가 별도 감시 장치를 새로 만들지 말라고 명시한다.
- 조회 실패는 화면 전체 에러(`error` 상태)로 올리지 않는다. 연동 카드 안에서만 "상태를 읽을 수 없음"으로 표시한다. 2.5초마다 실패 토스트가 뜨면 앱을 못 쓴다.
- 프로젝트가 초기화되지 않았거나 열려 있지 않으면 조회하지 않는다.

### 5. 설정 화면 표시 (R1, R5, R7)

`SettingsView.tsx`의 `settings-grid` 안에 연동 섹션을 추가한다. 기존 카드(`settings-card`)의 구조와 문체(존댓말, `header` + 내용)를 따른다.

- 섹션 제목으로 연동임이 드러나야 한다. 내장 연동 목록에 `claude-heartbeat` 카드 하나만 노출한다. 외부에서 연동을 추가 등록하는 경로는 만들지 않는다(R1).
- 설치 상태 3종을 서로 다르게 표시한다. 상태 뱃지는 기존 `compatibility-status` 계열의 표현 방식을 참고한다.
  - 미설치: 설치 명령과 공식 문서 위치만 안내한다. 앱이 설치를 대행하지 않는다는 것이 문구에서 드러나야 한다.
  - 설치됨·데몬 미실행 / 실행 중: 판정 근거가 드러나는 문구를 쓴다. "데몬이 살아 있습니다"처럼 단정하지 않는다. 앱은 pid 파일의 존재만 보며, 데몬이 정리 없이 죽으면 pid 파일이 남는다(TASK-005 1번 참조).
- 설치됨일 때만 역할 잡 영역을 노출한다(R1). 이 작업에서는 읽기 전용이다.
  - 관리 블록에 잡이 없으면 "역할 잡 미설치"로 표시한다. 설치 버튼은 TASK-007이 추가한다.
  - 잡이 있으면 역할별로 `interval`·`max_per`·`model`과 마지막 실행 시각·결과·소요 시간을 표시한다.
  - 실행 기록이 없으면 "실행 기록 없음"으로 표시한다. 오류로 보이게 만들지 않는다(R5).
  - `last_result`의 `skipped`는 정상 동작이다. 조건 검사에서 대상이 없어 건너뛴 경우이며 실패가 아니다. 문구와 색으로 실패처럼 읽히게 만들지 않는다. `quota_skipped`는 `max_per` 한도에 걸린 경우로 원인이 다르므로 구분해서 보여준다.
  - `last_run`은 타임존이 없는 로컬 시각 문자열이다. UTC로 해석해 변환하지 않는다. 그대로 보여주거나 로컬 시각임이 드러나게 표기한다.
- slug와 조건 스크립트 경로를 화면에 그대로 보여준다(R3). 사용자가 눈으로 확인하는 값이다.
- 중복 잡 경고(R7): 관리 블록 밖에 같은 slug로 조건 스크립트를 참조하는 잡이 있으면 경고를 표시한다. 문구는 위험을 구체적으로 밝힌다 — 같은 역할 잡이 둘이면 두 세션이 동시에 깨어나고, 하나는 lease 경합으로 `NO_ELIGIBLE_WORK`로 끝나며, 쿼터만 두 배로 소모된다. 자동으로 지우지 않는다는 것도 밝힌다.
- 미지원 플랫폼에서는 미지원 안내를 표시한다.

### 6. 프론트 테스트

`SettingsView.test.tsx`를 새로 만든다. 기존 컴포넌트 테스트(`DevelopmentBoard.test.tsx` 등)의 방식(`@testing-library/react`)을 따른다.

- 미설치 상태에서 설치 안내가 보이고 역할 잡 영역이 보이지 않는다.
- 설치됨·데몬 미실행과 실행 중이 서로 다르게 표시된다.
- 실행 기록이 없는 잡에 "실행 기록 없음"이 표시된다.
- 중복 잡이 있으면 경고가 표시된다.
- 미지원 플랫폼이면 미지원 안내가 표시된다.
- slug와 조건 스크립트 경로가 화면에 나온다.

## 완료 조건

1. 설정 화면에 연동 섹션이 있고 미설치 / 설치됨·데몬 미실행 / 설치됨·데몬 실행 중 세 상태가 서로 다르게 표시된다. (기획서 완료 조건 1)
2. 잡별 마지막 실행 시각·결과·소요 시간이 상태 파일 내용과 일치하게 표시되고, 기록이 없으면 "실행 기록 없음"으로 표시된다. (기획서 완료 조건 10)
3. 앱 시작·프로젝트 열기·자동 새로고침만으로 `~/.claude/HEARTBEAT.md`가 변경되지 않는다. (기획서 완료 조건 11)
4. 관리 블록 밖의 중복 역할 잡에 대한 경고가 표시되고 그 잡이 수정되지 않는다. (기획서 완료 조건 12의 표시 측면)
5. 조회 실패가 화면 전체 에러로 번지지 않고 연동 카드 안에서만 표시된다.
6. `npm run check`와 `cargo test --manifest-path src-tauri/Cargo.toml`이 통과한다. (기획서 완료 조건 13)
7. 쓰기 커맨드가 추가되지 않았다. 이 작업에서 등록한 커맨드는 조회 하나다.

## 검증 절차

```sh
npm run check
cargo test --manifest-path src-tauri/Cargo.toml
```

```sh
md5 ~/.claude/HEARTBEAT.md; ls -l ~/.claude/HEARTBEAT.md
npm run tauri dev
```

- 앱을 켜고 프로젝트를 열어 설정 화면에 들어간 뒤 자동 새로고침이 여러 번 돌 때까지(30초 이상) 둔다.
- 앱을 끄고 같은 명령을 다시 실행해 해시와 수정 시각이 그대로인지 확인한다. 완료 조건 3의 검증이다.

수동 확인 3종(개발자가 직접 재현한다. 실제 사용자 환경을 망가뜨리지 않도록 반드시 백업 후 진행하고, 끝나면 원상 복구한다):

```sh
cp ~/.claude/HEARTBEAT.md /tmp/HEARTBEAT.md.bak
```

- 미설치 재현: `~/.claude/HEARTBEAT.md`와 `~/.claude/heartbeat/`를 임시 경로로 옮긴 뒤 화면 확인.
- 데몬 미실행 재현: `~/.claude/heartbeat/heartbeat.pid`만 임시로 옮긴 뒤 화면 확인.
- 실행 중 재현: 원래 상태(데몬 가동 중)에서 화면 확인.
- 확인이 끝나면 옮긴 파일을 모두 되돌리고 해시를 대조한다.

```sh
git status --short
```

- 변경 목록에 `src-tauri/src/commands/`, `src-tauri/src/application/`, `src-tauri/src/lib.rs`, 프론트엔드 4개 파일, 새 테스트, `App.css`만 있는지 확인한다.

## 범위 밖

- 설치·토글·편집 등 모든 쓰기 액션. TASK-007 담당이다.
- 데몬 시작·중지, 잡 즉시 실행.
- 하트비트 로그 뷰어, 실행 이력 그래프.
- 새 파일 감시 장치 추가.
- `inspect_project`의 결과 타입(`ProjectSummary`) 확장. 프로젝트 문서 상태와 전역 도구 상태는 별개 커맨드로 둔다.

## 참고 사실

- `src/features/projects/application/useProjectWorkspace.ts:227`의 `useEffect`가 기존 2.5초 인터벌이다. 여기에 조회를 얹는다.
- `src/features/projects/components/SettingsView.tsx:19`가 카드 3개를 담은 `settings-grid`다. 네 번째 카드가 들어갈 자리다.
- `src/features/projects/components/WorkspaceShell.tsx:377`이 설정 뷰를 렌더링하는 지점이다. `SettingsView`의 props가 늘어나면 여기도 함께 바뀐다.
- `src-tauri/src/lib.rs:13`이 커맨드 등록 목록이다.
- 이 폴링은 프로젝트가 열려 있는 동안 설정 화면을 보지 않아도 계속 돈다. 읽는 파일이 작아 비용이 낮고, 별도 타이머를 만들지 않는 것이 기획서 요구와 맞아 이 방식을 골랐다.
