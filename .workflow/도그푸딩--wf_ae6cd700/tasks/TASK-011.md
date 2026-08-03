---
schema: workflow-labs/task@1
id: TASK-011
title: dream 연동 카드 추가와 정제 상태 읽기 전용 표시
status: completed
source_spec_id: SPEC-003
source_decision_id: DECISION-5276FDBF
updated_at: 2026-08-02T14:57:41Z
---

# dream 연동 카드 추가와 정제 상태 읽기 전용 표시

SPEC-003 R2의 dream 카드·설치 안내와 R3의 정제 상태 표시를 구현한다. 이 작업은 읽기 전용이다. dream 잡을 설치하는 버튼은 아직 만들지 않는다.

## 의존성

- TASK-010 선행 필수. 연동 목록과 공통 카드 골격 위에 항목 하나를 얹는다.
- TASK-009의 읽기 함수를 스냅샷에 연결한다.
- 병행 작업 없음. TASK-012가 같은 파일을 만진다.

## 범위

- `src-tauri/src/application/heartbeat_service.rs` — 스냅샷에 dream payload를 추가한다.
- `src-tauri/src/domain/project.rs` — 필요한 경우 dream 표시 타입만 손댄다.
- `src/features/projects/domain/types.ts` — dream 타입과 내장 연동 목록 항목 추가.
- `src/features/projects/components/` — dream 카드 본문 컴포넌트 신규.
- `src/features/projects/components/SettingsView.test.tsx` 또는 dream 카드 전용 테스트 파일.
- 그 외 파일은 건드리지 않는다. 특히 쓰기 경로(`install_heartbeat_jobs`)는 손대지 않는다.

## 작업 내용

### 0. 먼저 읽을 제약

- 이 작업이 추가하는 경로는 전부 읽기 전용이다. 커맨드를 새로 만들지 않고 TASK-010의 스냅샷 조회에 값을 얹는다.
- 앱은 `heartbeat install dream`을 대행하지 않는다. 설치는 사용자가 터미널에서 한다.
- 앱은 `~/.claude/projects/` 아래에 쓰지 않는다. 메모리 topic 파일과 `dream_meta.md`는 읽기만 한다.
- 하트비트 카드의 문구와 동작은 이 작업에서 바뀌지 않는다.

### 1. dream 카드 추가 (R2)

- 내장 연동 목록에 `dream`을 두 번째 항목으로 넣는다. 목록에 항목을 추가하고 본문 컴포넌트를 하나 만드는 것 외에 섹션·공통 골격·배지·경고 컴포넌트를 고치면 안 된다. 고쳐야 한다면 TASK-010의 경계가 잘못 잡힌 것이므로 멈추고 보고한다.
- 카드 설명은 목적을 밝힌다. 예: "역할 세션이 남긴 트랜스크립트를 메모리로 정제해, 다음 세션이 과거 맥락을 아는 상태로 시작하게 합니다."
- 설치 상태를 세 가지로 구분해 다르게 표시한다.
  - 하트비트 미설치: dream은 하트비트 위에서 도는 스킬이라는 사실과, 하트비트를 먼저 설치해야 한다는 안내.
  - 하트비트 설치됨 · dream 스킬 미설치: 설치 명령 `heartbeat install dream`과 공식 저장소 위치(`https://github.com/wooson00308/claude-heartbeat`)를 보여준다.
  - 둘 다 설치됨: 정제 상태를 표시한다. 잡 설치·관리 UI 자리는 TASK-012가 채운다.
- 판정 근거를 문구에 드러낸다. dream 설치 여부는 `~/.claude/skills/dream/SKILL.md` 존재로 본다는 사실을 밝힌다. 다른 이름(`--slug`)으로 설치한 경우 이 경로에 없을 수 있다.
- dream 카드는 하트비트 전용 타입·컴포넌트를 재사용하지 않는다. 공통 골격만 공유한다. (기획서 완료 조건 3)

### 2. 조건 명령 원문 표시 (R2)

- 설치될 dream 잡의 `condition` 명령 원문을 화면에 그대로 보여준다. 값은 백엔드가 만든 문자열이어야 한다. 프론트에서 문자열을 다시 조립하지 않는다.
- 왜 보여주는지 함께 밝힌다: 앱은 하트비트 데몬의 PATH를 알 수 없어 `dream-prep`이 실행 가능한지 검증하지 못한다. 조건 검사가 실패하면 하트비트는 잡을 skip 처리하므로 증상이 "아무 일도 일어나지 않음"이 된다. 사용자가 같은 명령을 터미널에서 실행해 확인할 수 있게 한다.
- 프로젝트 slug도 함께 보여준다. 하트비트 카드가 이미 같은 값을 보여주고 있으므로 표시 방식을 맞춘다.

### 3. 정제 상태 표시 (R3)

TASK-009가 만든 값을 읽기 전용으로 표시한다.

- 전체 트랜스크립트 수
- 미정제 트랜스크립트 수
- 마지막 정제 시각. 없으면 "정제 기록 없음"
- 메모리 topic 파일 수
- 프로젝트 디렉터리가 없으면 "트랜스크립트 없음"

표시 규칙.

- 미정제 수 옆에 판정 기준을 밝힌다: 이 수는 `dream_meta.md`의 마킹 기준이고, 실제 실행 시 dream은 열려 있는 활성 트랜스크립트를 다음 라운드로 미루므로 한 번에 처리되는 수는 이보다 적을 수 있다.
- "정제 기록 없음"과 "트랜스크립트 없음"은 오류가 아니다. 경고색이나 오류 문구로 표시하지 않는다.
- 상태는 기존 2.5초 자동 새로고침 주기를 따른다. 새 감시 장치를 만들지 않는다.

### 4. 중복 dream 잡 경고 (R6)

- TASK-009가 감지한 dream 중복 잡을 dream 카드 안에 표시한다. 경고 표시 자체는 공통 컴포넌트를 쓴다.
- 경고 문구는 위험을 구체적으로 밝힌다: 같은 프로젝트에 dream 잡이 둘이면 두 세션이 같은 트랜스크립트를 동시에 정제해 같은 메모리 파일을 서로 덮어쓸 수 있고, 실행 쿼터도 두 배로 소모된다.
- 앱이 사용자 잡을 지우지 않는다는 사실을 함께 밝힌다.

### 5. 테스트

- 하트비트 미설치 / 하트비트만 설치 / 둘 다 설치 세 상태에서 카드 내용이 서로 다르게 나온다.
- dream 미설치 상태에서 `heartbeat install dream`과 저장소 주소가 보인다.
- 둘 다 설치된 상태에서 전체·미정제 수, 마지막 정제 시각, topic 파일 수가 픽스처 값대로 표시된다.
- 마지막 정제 시각이 없을 때 "정제 기록 없음"이 보이고, 미정제 수가 전체 수와 같게 표시된다.
- 미정제 수 옆에 마킹 기준 설명 문구가 있다.
- 조건 명령 원문이 백엔드 값 그대로 표시된다.
- dream 중복 잡이 있을 때 dream 카드 안에 경고가 뜬다.
- 연동 카드가 두 개 렌더된다.

## 완료 조건

1. 설정 화면의 연동 섹션에 `claude-heartbeat`와 `dream` 두 카드가 표시된다. (기획서 완료 조건 1)
2. dream 카드가 하트비트 미설치 / 하트비트 설치됨·dream 미설치 / 둘 다 설치됨 세 상태를 서로 다르게 표시한다. (기획서 완료 조건 2)
3. dream 카드가 하트비트 전용 타입·컴포넌트를 재사용하지 않고 공통 골격으로 렌더된다. TASK-010이 만든 섹션·골격 코드에 변경이 없다. (기획서 완료 조건 3)
4. 전체·미정제 트랜스크립트 수, 마지막 정제 시각, 메모리 topic 파일 수가 파일 내용과 일치하게 표시되고, 기록이 없는 경우가 정상 상태로 표시된다. (기획서 완료 조건 9)
5. 미정제 수 옆에 마킹 기준이라는 설명이 표시된다. (기획서 완료 조건 10)
6. 관리 블록 밖의 중복 dream 잡 경고가 dream 카드에 표시되고, 그 잡이 수정되거나 삭제되지 않는다. (기획서 완료 조건 11)
7. 설치될 dream 잡의 조건 명령 원문과 그 이유가 화면에 표시된다. (R2)
8. 화면 진입·자동 새로고침만으로 `~/.claude/HEARTBEAT.md`와 `~/.claude/projects/` 아래가 바뀌지 않는다. (기획서 완료 조건 14)
9. `npm run check`와 `cargo test --manifest-path src-tauri/Cargo.toml`이 통과한다. (기획서 완료 조건 15)

## 검증 절차

```sh
npm run check
cargo test --manifest-path src-tauri/Cargo.toml
```

세 상태 재현. 실제 홈을 건드리므로 순서를 지키고 원복한다.

```sh
ls ~/.claude/skills/dream/SKILL.md
```

- 있으면 "둘 다 설치됨" 상태다. dream 미설치 상태를 화면으로 확인하려면 이 파일을 잠시 다른 이름으로 옮겼다가 되돌린다. 확인이 끝나면 반드시 원래 이름으로 되돌린다.
- 하트비트 미설치 상태는 실제 환경에서 재현하기 어렵다. 그 조합은 단위 테스트 픽스처로 확인하고, 화면 확인은 나머지 두 상태로 한다. 재현하지 못한 조합은 보고서에 명시한다.

정제 상태 대조.

```sh
ls ~/.claude/projects/-Users-catze-project-workflow-labs/*.jsonl | wc -l
ls ~/.claude/projects/-Users-catze-project-workflow-labs/memory/ 2>&1
```

- 화면의 전체 수가 첫 명령의 수와 같아야 한다. 이 저장소에는 `dream_meta.md`가 없으므로 "정제 기록 없음"과 미정제 수 = 전체 수가 나와야 한다.

```sh
md5 ~/.claude/HEARTBEAT.md
find ~/.claude/projects/-Users-catze-project-workflow-labs -newermt "-5 minutes" 2>/dev/null
```

- 화면을 열어 새로고침을 여러 번 거친 뒤에도 해시가 같고, 두 번째 명령에 앱이 만든 파일이 나오지 않아야 한다. 트랜스크립트 파일 자체는 이 세션이 갱신할 수 있으므로 앱이 만든 파일인지로 판단한다.

```sh
git status --short
```

- 변경이 범위에 적힌 파일로 한정되는지 확인한다.

## 범위 밖

- dream 잡 설치·토글·편집 버튼과 쓰기 경로. TASK-012 담당이다.
- 앱이 `heartbeat install dream`을 대행하는 기능. 기획서 제외 범위다.
- 메모리 topic 파일 내용 뷰어, 정제 이력 그래프. 기획서 제외 범위다.
- `dream-prep` 실행 가능 여부 검증. 앱은 데몬의 PATH를 알 수 없다. 조건 원문 표시로 대신한다.
- Windows에서 dream만 허용하는 분기. 기획서 확인 필요 2번이 현행 유지로 결정됐다.

## 참고 사실

- dream은 `claude-heartbeat` 저장소 안의 스킬이다. 설치본 모듈 경로는 `<claude-heartbeat>/skills/dream/`이고, 스킬 설치본은 `~/.claude/skills/dream/SKILL.md`에 놓인다.
- `heartbeat skills`가 설치 여부를 `[✓] dream — dream skill` 형태로 보여준다. 앱은 이 명령을 실행하지 않는다.
- 이 저장소 slug는 `-Users-catze-project-workflow-labs`이고, 확인 시점에 `*.jsonl` 17개가 있으며 `memory/`는 비어 있다.
- `dream_meta.md`가 있는 프로젝트의 예시는 `~/.claude/projects/-Users-catze/memory/dream_meta.md`다. 형식 대조용으로만 읽는다.
- 하트비트는 조건 검사가 실패해도 `last_result`를 `skipped`로 남긴다. dream 잡의 실행 기록에서도 `skipped`가 정상 상태다. 실패로 읽히게 표시하면 안 된다.
