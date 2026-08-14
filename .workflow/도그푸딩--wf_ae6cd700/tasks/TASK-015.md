---
schema: workflow-labs/task@1
id: TASK-015
title: 관리 블록 읽기 실패를 잡 없음과 구분하고 그 상태에서 저장을 막는다
status: verified
source_spec_id: SPEC-005
source_decision_id: DECISION-02EBD5DB
updated_at: 2026-08-14T09:08:07.880257+00:00
history:
- at: 2026-08-03T02:30:56.603188+00:00
  kind: completed
- at: 2026-08-14T09:08:07.880257+00:00
  kind: migrated_verified
work_group_id: GROUP-DECISION-02EBD5DB
work_group_revision: 1
---

# 관리 블록 읽기 실패를 잡 없음과 구분하고 그 상태에서 저장을 막는다

SPEC-005 R2를 구현한다. 상태 조회가 `HEARTBEAT.md` 읽기 실패를 빈 문서로 접는 현행을 고쳐, "앱이
값을 모르는 상태"와 "값이 없는 상태"를 화면에서 구분하고, 모르는 상태에서는 쓰지 않는다.

지금은 두 상태가 같아 보인다. 읽기에 실패하면 `managedJobs`가 빈 목록이 되고, 화면은 그것을 첫 설치로
읽어 역할 3종을 켠 채 기본값으로 폼을 채운다. 그 상태에서 저장하면 기본값이 파일에 기록된다.

## 의존성

- **선행 필수: TASK-014.** 같은 두 카드의 저장 경로를 만진다. 순서를 뒤집으면 TASK-014가 이 작업의
  차단 분기를 다시 손대야 한다.
- TASK-016·TASK-017·TASK-018과 병행 금지. 같은 두 카드와 같은 백엔드 파일을 만진다.

## 범위

- `src-tauri/src/application/heartbeat_service.rs` — `inspect`의 문서 읽기와 스냅샷 payload.
- `src-tauri/src/infrastructure/heartbeat_status.rs` — 조회가 이미 만든 읽기 결과를 `inspect`가 다시
  쓸 수 있게 하는 최소 변경만.
- `src/features/projects/domain/types.ts` — 스냅샷 타입.
- `src/features/projects/components/integrations/HeartbeatCard.tsx`,
  `src/features/projects/components/integrations/DreamCard.tsx` — 상태 구분 표시와 저장 차단.
- `src/features/projects/components/SettingsView.test.tsx`,
  `src/features/projects/components/integrations/DreamCard.test.tsx`.
- 그 외 파일은 건드리지 않는다.

## 작업 내용

### 0. 먼저 읽을 제약

- 조회 경로는 여전히 아무 파일도 쓰지 않고 디렉터리도 만들지 않는다. 상태 구분은 읽기일 뿐이다(R6).
- 대상 파일이 없는 것은 오류가 아니다. `NotFound`는 지금처럼 빈 문서로 본다. 이 작업이 바꾸는 것은
  `NotFound`가 아닌 읽기 실패다.
- 설치 경로 `read_document`(`heartbeat_service.rs:313`)는 이미 옳게 동작한다. 고치지 않는다. 이 작업은
  조회 경로를 그 판단에 맞추는 것이다.
- 배지 문구와 설치 판정(`installation`, `daemonRunning`)은 바꾸지 않는다. 못 읽은 파일도 존재는 하므로
  설치 판정에서 있는 것으로 보는 현행(`TextSource::found`)이 맞다.
- 기존 `readFailures` 경고 상자(`IntegrationCard.tsx:97`)는 그대로 둔다. 경고가 떠 있어도 저장 버튼이
  살아 있고 폼에 기본값이 차 있으면 사고는 그대로 일어난다는 것이 R2의 전제다. 경고를 대체하는 것이
  아니라 그 위에 상태 구분과 차단을 더한다.

### 1. 조회가 읽기 실패를 접지 않게 한다 (R2)

- `HeartbeatService::inspect`(`heartbeat_service.rs:153`)의
  `fs::read_to_string(...).unwrap_or_default()`(`:156`)를 없앤다. 읽기 결과는 없음·읽음·못 읽음 셋으로
  구분한다. `heartbeat_status.rs:224`의 `TextSource`가 이미 그 세 값을 가진다.
- 같은 파일을 두 번 읽지 않는다. 지금 `inspect`는 `read_heartbeat_status`(`:155`) 안에서 한 번,
  바로 다음 줄에서 또 한 번 읽는다. 두 읽기의 결과가 갈라지면 이 작업의 구분이 성립하지 않는다.
  조회가 이미 읽은 문서를 `inspect`가 넘겨받는 형태로 바꾼다.
- 스냅샷에 관리 블록 상태를 담는다. `HEARTBEAT.md`는 두 연동이 공유하는 한 파일이므로 연동별 payload가
  아니라 `IntegrationsSnapshot`의 섹션 공통 값이다(`supported`, `slug`와 같은 층).
  값은 읽을 수 있었는지와, 못 읽었다면 그 경로·사유다.
- 못 읽은 상태에서 `managedJobs`·`managedJob`은 지금처럼 빈 값이지만, 화면이 그것을 "잡 없음"으로 읽지
  않도록 관리 블록 상태를 먼저 본다.

### 2. 화면에서 두 상태를 구분한다 (R2)

두 카드 모두에 적용한다.

- 관리 블록을 읽지 못한 상태에서는 잡 입력 폼을 렌더하지 않는다. 기본값이 화면에 보이면 사용자는
  그것이 파일의 값이라고 읽는다.
- 그 자리에 읽지 못했다는 사실과 대상 경로·사유를 보여준다. "미설치"·"잡 없음"과 다른 문구여야 한다.
- 저장 버튼을 누를 수 없게 한다. 플랫폼 미지원 시 비활성 버튼을 보여주는 현행 방식
  (`HeartbeatCard.tsx:353`, `DreamCard.tsx:343`)과 같은 형태로 맞춘다. 비활성 사유가 화면에 보여야 한다.
- 잡이 없는 상태(읽기 성공 + 관리 블록에 잡 없음)의 현행 표시는 그대로 둔다
  ("역할 잡 미설치 — 앱 관리 블록에 이 프로젝트의 역할 잡이 없습니다.",
  "앱 관리 블록에 이 프로젝트의 dream 잡이 아직 없습니다.").

### 3. 테스트

백엔드:

- 읽을 수 없는 `HEARTBEAT.md`가 있으면 스냅샷의 관리 블록 상태가 "못 읽음"이고 사유가 담긴다.
- 파일이 아예 없으면 관리 블록 상태는 "읽음"이고 잡 목록이 비어 있다. 읽기 실패로 보지 않는다.
- 정상 파일에서는 현행과 같은 잡 목록이 나온다(회귀).
- 읽기 실패를 만드는 방법은 권한 조작이다. `cfg(unix)` 아래에 두고, 테스트가 만든 임시 디렉터리 안에서만
  권한을 바꾼다. 다른 플랫폼에서 컴파일이 깨지지 않게 게이트한다
  (`heartbeat_condition.rs`의 unix 전용 테스트 게이트 방식을 참고한다).

프론트:

- 관리 블록을 못 읽은 스냅샷에서 역할 잡 입력 폼이 렌더되지 않고, 저장 버튼을 눌러도 설치 함수가
  호출되지 않는다.
- 같은 스냅샷에서 사유와 대상 경로가 화면에 보인다.
- 잡이 없는 스냅샷과 못 읽은 스냅샷의 화면이 서로 다르다. 두 상태를 각각 렌더해 대조하는 테스트를
  둔다(기획서 완료 조건 5).
- dream 카드에 대해 위 세 가지와 같은 테스트를 만든다. 같은 파일을 공유하므로 두 카드가 함께 막혀야
  한다.

## 완료 조건

1. 관리 블록을 읽지 못한 상태에서 잡 설정 저장이 차단되고 사유가 표시된다. 그 상태에서 파일이 쓰이지
   않는다. (기획서 완료 조건 4)
2. 읽기 실패 상태와 잡이 없는 상태가 화면에서 서로 다르게 표시된다. (기획서 완료 조건 5)
3. 읽기 실패 상태에서 입력 폼이 기본값으로 채워져 보이지 않는다. (R2)
4. 하트비트 카드와 dream 카드가 같은 규칙으로 막힌다. 두 카드 각각에 대한 테스트가 있고 통과한다.
5. 앱 시작·프로젝트 열기·자동 새로고침·연동 화면 진입만으로는 `~/.claude/HEARTBEAT.md`가 변경되지
   않는다. 조회 경로를 고쳤으므로 이 회귀를 반드시 확인한다. (기획서 완료 조건 15)
6. 파일이 없는 상태(첫 설치)의 현행 동작이 그대로다. 읽기 실패로 보지 않는다.
7. SPEC-002·SPEC-003·SPEC-004의 완료 조건에 대응하는 기존 자동화 테스트가 모두 통과하고, 삭제되거나
   비활성화된 케이스가 없다. (기획서 완료 조건 16)
8. `npm run check`와 `cargo test --manifest-path src-tauri/Cargo.toml`이 통과한다.
   (기획서 완료 조건 17)

## 검증 절차

```sh
npm run check
cargo test --manifest-path src-tauri/Cargo.toml
```

읽기 실패를 실제로 재현한다. 전역 파일의 권한을 건드리므로 반드시 원복한다.

```sh
cp ~/.claude/HEARTBEAT.md /tmp/HEARTBEAT.md.bak
md5 ~/.claude/HEARTBEAT.md
chmod 000 ~/.claude/HEARTBEAT.md
# 앱 설정 화면을 연다. 두 카드 모두에서 확인한다:
#   - 입력 폼이 기본값으로 채워져 보이지 않는다
#   - 못 읽었다는 사실과 경로·사유가 보인다
#   - 저장 버튼을 누를 수 없다
chmod 644 ~/.claude/HEARTBEAT.md
md5 ~/.claude/HEARTBEAT.md   # 위와 같아야 한다
diff /tmp/HEARTBEAT.md.bak ~/.claude/HEARTBEAT.md   # 비어 있어야 한다
```

잡 없음 상태와 대조한다.

```sh
# 관리 블록 마커 한 쌍만 남기고 그 사이를 비운 파일로 화면을 확인한다
# 위 읽기 실패 화면과 문구·구성이 달라야 한다
cp /tmp/HEARTBEAT.md.bak ~/.claude/HEARTBEAT.md
```

## 범위 밖

- 설치 경로 `read_document`의 동작 변경. 이미 옳다.
- 배지 문구와 설치 판정 규칙 변경.
- `readFailures` 경고 상자의 문구·위치 변경.
- 다른 조회 경로(상태 파일, dream 정제 상태 등)의 읽기 실패 처리 점검. 기획자 핸드오프가 남긴 항목이나
  이 기획서의 요구사항이 아니다. 확인했다면 보고서의 핸드오프 노트에 적는다.
- 읽기 실패를 사용자가 고치도록 돕는 기능(권한 복구 안내 버튼 등). 요구되지 않았다.
- 저장 차단 이외의 쓰기 경로 변경.

## 참고 사실

확인 시점 2026-08-02. 추정 없이 실측한 값이다.

- `HeartbeatService::inspect`는 `heartbeat_service.rs:153`이고, 문제의 줄은 `:156`의
  `fs::read_to_string(heartbeat_home.join(HEARTBEAT_FILE)).unwrap_or_default()`다.
- 같은 문서를 `:155`의 `read_heartbeat_status`가 이미 읽는다. 그 안의
  `read_text`(`heartbeat_status.rs:244`)는 `NotFound`만 `Missing`으로 보고 다른 실패는
  `Unreadable`로 두면서 `read_failures`에 남긴다. `TextSource`는 `:224`에 있다.
- 설치 경로 `read_document`(`heartbeat_service.rs:313`)의 주석에 반대 판단의 근거가 적혀 있다:
  "못 읽은 문서를 빈 문서로 보면 다른 연동의 잡을 지우는 병합이 만들어진다."
- 화면의 첫 설치 판정은 `roleFormFrom`(`HeartbeatCard.tsx:98`)의
  `const firstInstall = managedJobs.length === 0`이다. dream은 `formFrom`(`DreamCard.tsx:77`)이
  `enabled: true`를 무조건 준다.
- `readFailures`는 연동별로 담기고 카드가 각자 보여준다(`IntegrationCard.tsx:97`). 지금
  `HEARTBEAT.md` 읽기 실패는 하트비트 연동의 목록에만 들어가고 dream 카드에는 나타나지 않는다.
  그래서 관리 블록 상태를 섹션 공통 값으로 올린다.
- `TextSource::found`는 못 읽은 파일도 존재로 본다. 그래서 읽기 실패 상태에서도 설치 판정은
  "설치됨"이고, 카드는 미설치 안내가 아니라 잡 UI 분기로 들어간다.
