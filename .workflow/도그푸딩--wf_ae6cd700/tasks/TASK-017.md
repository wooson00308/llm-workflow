---
schema: workflow-labs/task@1
id: TASK-017
title: 화면이 읽은 뒤 바뀐 관리 블록을 확인 없이 덮어쓰지 않는다
status: verified
source_spec_id: SPEC-005
source_decision_id: DECISION-02EBD5DB
updated_at: 2026-08-14T09:08:07.880257+00:00
history:
- at: 2026-08-03T02:31:02.092686+00:00
  kind: completed
- at: 2026-08-14T09:08:07.880257+00:00
  kind: migrated_verified
work_group_id: GROUP-DECISION-02EBD5DB
work_group_revision: 1
---

# 화면이 읽은 뒤 바뀐 관리 블록을 확인 없이 덮어쓰지 않는다

SPEC-005 R3을 구현한다. 저장 시점의 관리 블록이 화면이 읽은 시점과 다르면 그대로 덮어쓰지 않고,
무엇이 다른지 보이고 사용자가 정하게 한다. 같은 규칙의 다른 쪽 면으로, 자동 새로고침이 사용자가 편집
중인 입력값을 알림 없이 파일 값으로 대체하지 않게 한다.

앱이 화면과 파일 중 한쪽을 임의로 고르지 않는다는 것이 두 항목의 공통 규칙이다.

## 의존성

- **선행 필수: TASK-014.** 화면의 "사용자가 지정한 필드" 상태가 편집 중 판정의 근거다. 그 상태가 없으면
  편집 중과 아닌 때를 구분할 수 없다.
- **선행 필수: TASK-016.** 달라진 내용을 보여줄 때 그 차이 표시 요소를 재사용한다. 두 화면에서 차이가
  다른 모양으로 보이면 안 된다.
- 선행 권장: TASK-015. 관리 블록을 못 읽은 상태에서는 대조할 기준값이 없다. 그 상태의 저장이 이미
  막혀 있으면 이 작업이 그 경우를 따로 처리하지 않아도 된다.
- TASK-018과 병행 금지. TASK-018의 재설정 액션도 이 작업이 만드는 기준값을 함께 보낸다.

## 범위

- `src-tauri/src/commands/heartbeat.rs` — 두 설치 커맨드가 기준값을 함께 받는다.
- `src-tauri/src/application/heartbeat_service.rs` — 기준값 대조와 불일치 오류.
- `src/features/projects/infrastructure/tauriProjectGateway.ts`,
  `src/features/projects/application/useProjectWorkspace.ts`,
  `src/features/projects/domain/types.ts` — 게이트웨이·훅·타입의 인자 전달.
- `src/features/projects/components/integrations/HeartbeatCard.tsx`,
  `src/features/projects/components/integrations/DreamCard.tsx` — 기준값 보관, 편집 중 재시딩 금지,
  달라졌을 때의 선택 UI.
- `src/features/projects/application/useProjectWorkspace.test.ts`,
  `src/features/projects/components/SettingsView.test.tsx`,
  `src/features/projects/components/integrations/DreamCard.test.tsx`.
- 그 외 파일은 건드리지 않는다.

## 작업 내용

### 0. 먼저 읽을 제약

- 편집 중이 아닐 때(사용자가 아무 필드도 건드리지 않은 상태) 파일 값 변화가 화면에 반영되는 현행
  동작은 유지한다. 이 요구는 사용자의 입력을 지키는 것이지 화면을 낡은 채로 두는 것이 아니다.
- 자동 새로고침 주기(2.5초)와 조회 커맨드를 바꾸지 않는다. 조회는 계속 아무 파일도 쓰지 않는다.
- 확인 절차(SPEC-002 R6)를 유지한다. 불일치를 사용자가 넘긴 뒤에도 쓰기 전 확인 화면은 그대로 거친다.
- 커맨드 이름과 개수는 그대로다. 인자만 는다.

### 1. 쓰기 계약에 기준값을 넣는다 (R3)

- 두 설치 커맨드가 "화면이 읽은 시점의 관리 블록 값"을 함께 받는다. 역할 잡은 그 요청이 관장하는
  역할 잡 목록, dream은 dream 잡 하나다. 화면이 시딩에 쓴 스냅샷 값을 그대로 보낸다.
- 백엔드는 쓰기 직전에 읽은 문서에서 같은 값을 만들어 대조한다. 다르면 아무 파일도 쓰지 않고 실패한다.
  조건 스크립트 설치보다 먼저 대조한다. 실패했는데 프로젝트 로컬 파일이 새로 생기면 안 된다.
- 대조 범위는 그 요청이 관장하는 잡으로 한정한다. 다른 연동의 잡이 바뀐 것은 현행 보존 규칙이 그대로
  집어 올리므로 이 요청을 막을 이유가 없다. 역할 잡 화면은 dream 잡을 보여주지도 않는다.
- 값의 존재 여부도 대조에 들어간다. 잡이 새로 생겼거나 사라진 것도 "달라졌다"다. 스냅샷의 역할 잡
  목록은 `HeartbeatRole::ALL` 순서로 고정되므로 목록 통째로 비교해도 순서 때문에 흔들리지 않는다.
- 불일치 오류는 무엇을 해야 하는지 말한다. 아무 파일도 쓰지 않았다는 사실과, 새로고침된 값을 확인한 뒤
  다시 시도하라는 안내를 담는다.

### 2. 편집 중에는 재시딩하지 않는다 (R3)

- 두 카드의 재시딩 분기(`HeartbeatCard.tsx:197`, `DreamCard.tsx:200`)는 지금 관리 블록이 바뀌면
  조건 없이 폼을 파일 값으로 되돌린다. 사용자가 한 필드라도 지정한 상태에서는 되돌리지 않는다.
- 대신 파일이 바뀌었다는 사실과 무엇이 달라졌는지를 보여주고, 사용자가 고르게 한다. 최소 두 갈래가
  필요하다: 파일 값을 불러와 편집을 버리는 쪽과, 편집을 유지하고 새 파일 값을 기준으로 삼는 쪽.
- 편집을 유지하는 쪽을 고르면 기준값이 새 스냅샷 값으로 갱신된다. 그래야 다음 저장이 1번의 대조를
  통과한다. 사용자가 무엇을 덮어쓰는지 화면에서 이미 봤다는 것이 그 근거다.
- 사용자가 아무 필드도 지정하지 않은 상태에서는 현행대로 조용히 재시딩한다.
- 달라진 내용은 TASK-016이 만든 차이 표시 요소로 보여준다.

### 3. 저장 시 불일치가 나면 (R3)

- 백엔드가 불일치로 거부하면 사유를 카드에 보여준다. 기존 쓰기 실패 표시 경로
  (`writeError`, `IntegrationWarning`)를 쓴다. 새 표시 자리를 만들지 않는다.
- 거부 직후 조회가 새 값을 가져오면 2번의 선택 UI가 그 위에서 뜬다. 두 경로가 같은 화면으로 수렴해야
  한다. 사용자가 같은 상황을 두 가지 모양으로 보면 안 된다.

### 4. 테스트

백엔드:

- 기준값과 파일의 관리 블록이 같으면 현행대로 쓴다(회귀).
- 기준값과 다르면 실패하고 파일이 바이트 단위로 그대로다. 조건 스크립트도 새로 생기지 않는다.
- 잡이 새로 생긴 경우와 사라진 경우 모두 불일치로 잡힌다.
- 다른 연동의 잡만 바뀐 경우는 불일치로 보지 않고 현행 보존 규칙대로 쓴다. 역할 잡 쓰기와 dream 잡
  쓰기 각각.

프론트:

- 사용자가 필드를 편집한 상태에서 관리 블록이 바뀐 스냅샷이 들어와도 입력값이 유지되고, 달라졌다는
  사실이 화면에 표시된다.
- 같은 상황에서 "파일 값 불러오기"를 고르면 폼이 파일 값으로 바뀐다.
- 아무 필드도 편집하지 않은 상태에서 관리 블록이 바뀌면 현행대로 조용히 재시딩된다(회귀).
- 저장 시 시딩에 쓴 관리 블록 값이 그대로 기준값으로 실려 나간다. 역할 잡과 dream 잡 각각.
- 자동 새로고침이 같은 값을 반복해 줄 때는 아무 알림도 뜨지 않는다(현행 회귀). 기존
  "keeps the role job form untouched while the dream job is edited" 케이스가 이 성질에 걸리므로 함께
  통과하는지 확인한다.

## 완료 조건

1. 화면이 읽은 뒤 관리 블록이 바뀐 상태에서 저장을 시도하면 그대로 덮어쓰지 않고 차이를 알린다.
   그 시도로 파일이 바뀌지 않는다. (기획서 완료 조건 6)
2. 사용자가 필드를 편집하는 중에 자동 새로고침이 그 입력값을 알림 없이 대체하지 않는다.
   (기획서 완료 조건 7)
3. 편집 중이 아닐 때 파일 값 변화가 화면에 반영되는 현행 동작이 그대로다. (R3)
4. 불일치로 실패했을 때 조건 스크립트를 포함해 어떤 파일도 새로 쓰이거나 바뀌지 않는다. (R6)
5. 다른 연동의 잡만 바뀐 경우는 저장이 막히지 않고 그 잡의 값이 보존된다.
6. 역할 잡과 dream 잡 각각에 대한 테스트가 있고 통과한다.
7. 같은 상태로 다시 저장하면 파일이 변하지 않는다. (기획서 완료 조건 13)
8. 앱 시작·프로젝트 열기·자동 새로고침·연동 화면 진입만으로는 `~/.claude/HEARTBEAT.md`가 변경되지
   않는다. (기획서 완료 조건 15)
9. SPEC-002·SPEC-003·SPEC-004의 완료 조건에 대응하는 기존 자동화 테스트가 모두 통과하고, 삭제되거나
   비활성화된 케이스가 없다. (기획서 완료 조건 16)
10. `npm run check`와 `cargo test --manifest-path src-tauri/Cargo.toml`이 통과한다.
    (기획서 완료 조건 17)

## 검증 절차

```sh
npm run check
cargo test --manifest-path src-tauri/Cargo.toml
```

화면을 열어 둔 채 파일을 손으로 바꾼다. 전역 파일을 건드리므로 백업부터 하고 반드시 원복한다.

```sh
cp ~/.claude/HEARTBEAT.md /tmp/HEARTBEAT.md.bak
md5 ~/.claude/HEARTBEAT.md
# 1) 앱 설정 화면을 열고 개발자 잡의 주기를 편집한다(저장하지 않는다)
# 2) 다른 터미널에서 관리 블록 안 기획자 잡의 `- max_per: 8/24h`를 `- max_per: 9/24h`로 바꾼다
# 3) 자동 새로고침을 여러 번(최소 10초) 기다린다
#    → 편집 중이던 주기 값이 그대로 남아 있어야 한다
#    → 파일이 바뀌었다는 사실과 무엇이 달라졌는지가 보여야 한다
# 4) 저장을 시도한다 → 그대로 덮어쓰지 않고 사유가 보여야 한다
md5 ~/.claude/HEARTBEAT.md   # 2번 직후 값과 같아야 한다(앱이 쓰지 않았다)
cp /tmp/HEARTBEAT.md.bak ~/.claude/HEARTBEAT.md
```

편집 중이 아닐 때의 반영을 확인한다.

```sh
cp ~/.claude/HEARTBEAT.md /tmp/HEARTBEAT.md.bak
# 화면을 열고 아무 필드도 건드리지 않은 채, 파일에서 개발자 잡의 주기를 바꾼다
# → 화면 값이 조용히 새 값으로 바뀌어야 한다(알림 없음)
cp /tmp/HEARTBEAT.md.bak ~/.claude/HEARTBEAT.md
```

## 범위 밖

- 파일 잠금이나 감시자 도입. 대조는 쓰기 직전의 읽기로 충분하고, 이 앱은 잠금을 쓰지 않는다.
- 관리 블록 밖 사용자 잡과 전역 설정의 변화 감지. 앱은 그 부분을 읽기만 하고 그대로 보존한다.
- 자동 새로고침 주기 변경, 조회 커맨드 분할.
- 편집 이력 저장·되돌리기(undo). 기획서 제외 범위다.
- 두 프로젝트가 같은 관리 블록을 동시에 쓰는 문제. 기획서 제외 범위이고 REPORT-TASK-012-DEV가 별도
  사안으로 지목해 두었다.
- 충돌 값을 필드 단위로 합치는 3-way 병합. 요구는 "사용자가 정하게 한다"이지 자동 병합이 아니다.

## 참고 사실

확인 시점 2026-08-02. 추정 없이 실측한 값이다.

- 재시딩 판정은 `JSON.stringify(managedJobs)`(`HeartbeatCard.tsx:186`)와
  `JSON.stringify(managedJob)`(`DreamCard.tsx:189`)의 변화다. 값이 같으면 2.5초 조회가 폼을 건드리지
  않는다. 이미 있는 이 신호가 "파일이 실제로 바뀌었다"의 근거다.
- 바뀌면 `setForm(...)`으로 조건 없이 폼을 되돌린다(`HeartbeatCard.tsx:197`, `DreamCard.tsx:200`).
  사용자가 편집 중이었는지 보지 않는다.
- 설치 커맨드는 `commands/heartbeat.rs:29`(`install_heartbeat_jobs`)와 `:45`(`install_dream_job`)다.
  인자는 각각 `path`+`roles`, `path`+`dream`이다.
- 게이트웨이는 `tauriProjectGateway.ts`의 `installHeartbeatJobs`·`installDreamJob`이고, 훅은
  `useProjectWorkspace.ts:257`의 `writeIntegration`을 거친다. 쓰기 실패는 연동별 `writeError`로
  카드에 전달된다(`:269`).
- `install`(`heartbeat_service.rs:186`)은 조건 스크립트를 먼저 설치하고
  `HEARTBEAT.md`를 나중에 쓴다. 순서의 근거가 주석에 있다. 기준값 대조는 이 두 쓰기 앞이어야 한다.
- `ManagedRoleJob`(`heartbeat_service.rs:90`)과 `ManagedDreamJob`(`:100`)은 지금 `Serialize`만 있다.
  기준값으로 받으려면 역방향이 필요하다.
- 실제 `~/.claude/HEARTBEAT.md`의 역할 잡 `max_per`는 `8/24h`·`8/24h`·`16/24h`다. 검증 중 원복을
  빠뜨리면 이 저장소의 하트비트 구성이 망가진다.
