---
schema: workflow-labs/task@1
id: TASK-014
title: 잡 설정 쓰기를 파일 기준 병합으로 전환하고 미지정 필드를 보존
status: completed
source_spec_id: SPEC-005
source_decision_id: DECISION-02EBD5DB
updated_at: 2026-08-03T02:30:54.023925+00:00
history:
  - { at: 2026-08-03T02:30:54.023925+00:00, kind: completed }
---

# 잡 설정 쓰기를 파일 기준 병합으로 전환하고 미지정 필드를 보존

SPEC-005 R1과 R6을 구현한다. 잡 설정 쓰기가 관리 블록에 적힌 편집 가능 값에서 출발하고, 사용자가
이번 편집에서 실제로 지정한 값만 그 위에 덮게 만든다. 기본값은 그 잡이 블록에 없을 때의 초기값으로
좁힌다.

이 작업이 SPEC-005의 토대다. 나머지 네 작업(TASK-015~018)은 여기서 만든 요청 계약 위에 선다.

## 의존성

- 선행 필수 작업 없음. 이 작업만으로 관측된 사고의 원인 경로가 닫히고 사용자가 QA할 수 있다.
- **TASK-015~018과 병행 금지.** 같은 백엔드 파일(`heartbeat_service.rs`)과 같은 두 카드
  (`HeartbeatCard.tsx`, `DreamCard.tsx`)를 만진다.
- 이 작업 이후 TASK-015 → TASK-016 → TASK-017 → TASK-018 순서를 권장한다. 근거는
  REPORT-SPEC-005-ARCH에 적었다.

## 범위

- `src-tauri/src/application/heartbeat_service.rs` — `RoleJobRequest`·`DreamJobRequest`의 편집 가능
  필드를 선택값으로 바꾸고, 설치 경로의 병합 규칙을 파일 기준으로 바꾼다.
- `src/features/projects/domain/types.ts` — 위 두 요청 타입의 프론트 짝.
- `src/features/projects/components/integrations/HeartbeatCard.tsx`,
  `src/features/projects/components/integrations/DreamCard.tsx` — 사용자가 실제로 바꾼 필드만 요청에
  싣는다.
- `src/features/projects/components/SettingsView.test.tsx`,
  `src/features/projects/components/integrations/DreamCard.test.tsx` — 요청 모양이 바뀌므로 기존
  단언을 함께 고친다.
- 백엔드 테스트는 `heartbeat_service.rs`의 `#[cfg(test)]` 모듈에 넣는다.
- 그 외 파일은 건드리지 않는다. 특히 `heartbeat_jobs.rs`의 검증 규칙과 쓰기 함수, `heartbeat_roles.rs`·
  `heartbeat_dream.rs`의 잡 정의는 한 줄도 바꾸지 않는다.

## 작업 내용

### 0. 먼저 읽을 제약

- 앱 소유 필드(`slug`, `prompt`, `timeout`, `condition`, `notify`)는 이 작업의 보존 대상이 아니다.
  `role_managed_jobs`·`heartbeat_dream::dream_job_with`가 매번 앱 값으로 다시 만드는 현행을 유지한다.
  기획서 제외 범위다.
- 값 검증 규칙(`heartbeat_jobs.rs`의 `is_model` 등)과 실패 동작을 바꾸지 않는다. 기획서 제외 범위다.
- 다른 연동 잡의 현행 보존(`preserved_role_jobs`, `preserved_dream_job`)과 `PreservedJob` 실패 동작을
  그대로 유지한다. 이 작업은 같은 규칙을 자기 연동 안으로 넓히는 것이지 기존 보존을 대체하지 않는다.
- 설치 커맨드의 이름과 개수는 그대로다(`install_heartbeat_jobs`, `install_dream_job`). 새 커맨드를
  만들지 않는다.
- 이 작업은 읽기 실패 처리를 다루지 않는다. `inspect`의 `unwrap_or_default()`(`heartbeat_service.rs:156`)는
  TASK-015가 고친다. 여기서 손대면 두 작업이 같은 줄에서 충돌한다.

### 1. 요청 계약을 "지정한 것만"으로 바꾼다 (R1)

- `RoleJobRequest`와 `DreamJobRequest`의 `interval`·`max_per`·`model`을 `Option<String>`으로 바꾼다.
  `None`은 "사용자가 이번 편집에서 지정하지 않았다"는 뜻이다.
- `enabled`는 `bool` 그대로 둔다. 잡의 존재 여부는 화면의 토글이 직접 정하는 값이고, 그 시딩 근거
  ("블록에 있느냐")는 필드 값과 달리 파일에서 직접 나온다. 시딩 자체가 믿을 수 없는 상태(읽기 실패)는
  TASK-015가 저장 차단으로, 화면이 읽은 뒤 바뀐 경우는 TASK-017이 기준값 대조로 막는다.
- 프론트 `types.ts`의 두 타입도 `string | null`로 맞춘다. 백엔드와 프론트의 짝을 깨지 않는다.

### 2. 병합 기준을 파일로 옮긴다 (R1)

- 잡 하나의 "기준 설정"을 만드는 규칙을 한 곳에 둔다: 관리 블록에 그 잡이 있으면 블록의 편집 가능
  값이 기준이고, 블록에 없으면 그 잡의 앱 기본값이 기준이다. 필드 단위로 판단한다(블록에 잡은 있으나
  `model` 줄이 없으면 그 필드만 기본값).
- 이 규칙은 이미 `preserved_role_jobs`(`heartbeat_service.rs:263`)와
  `preserved_dream_job`(`:287`)이 하고 있는 일과 같다. 규칙을 두 번 적으면 시간이 지나 갈라진다.
  기존 함수에서 기준 설정을 만드는 부분을 뽑아 요청 병합과 함께 쓴다.
- 요청 병합: 기준 설정 위에 `Some`인 필드만 덮는다. `enabled_role_jobs`(`:393`)가 지금 요청 값을 그대로
  `RoleJobSettings`로 만드는 자리가 진입점이다. `install_dream`의
  `requested_dream_settings`(`:303`)가 dream 쪽 진입점이다.
- 규칙은 잡 종류마다 따로 정의하지 않는다(R1). 역할 잡과 dream 잡이 같은 병합 규칙을 쓰고, 이후 잡이
  늘어도 그 규칙을 다시 적지 않아야 한다.
- 병합에 쓸 문서는 이미 읽고 있는 `read_document`(`:313`)의 결과다. 새로 읽지 않는다.

### 3. 병합 결과의 검증 (R1, R6)

- 병합 결과 전체에 현행 `validate_managed_jobs`를 적용한다. 실패하면 아무 파일도 쓰지 않는다.
- **요청이 그 잡의 어떤 필드도 지정하지 않았다면**(세 필드가 모두 `None`이고 잡이 블록에 있다) 그 잡은
  사실상 기존 `preserved_*`와 같은 처지다. 검증 실패 시 기존 `PreservedJob` 오류를 그대로 쓴다.
  "손으로 고친 값을 바로잡으라"는 안내가 그 상황에 맞는 문구다. 새 오류 문구를 만들지 않는다.
- 사용자가 한 필드라도 지정한 잡은 현행 `Jobs` 오류를 그대로 쓴다.
- 값이 검증을 통과하지 못할 때 조용히 기본값으로 되돌리는 경로를 만들지 않는다. 이 기획서가 막으려는
  동작 그 자체다.

### 4. 화면은 바꾼 필드만 보낸다 (R1)

- 두 카드에 "이번 편집에서 사용자가 실제로 지정한 필드" 상태를 둔다. `edit()`
  (`HeartbeatCard.tsx:212`, `DreamCard.tsx:212`)가 호출될 때 그 필드를 표시한다.
- 설치 요청을 만들 때(`HeartbeatCard.tsx:253`의 `{ role, ...form[role] }`,
  `DreamCard.tsx:246`의 `{ ...form }`) 지정하지 않은 필드는 `null`로 보낸다.
- 모델 입력 방식 전환(`switchModelInput`)은 값 변경이 아니므로 지정으로 치지 않는다. 직접 입력 칸에
  값을 적으면 `onValueChange`를 거치므로 그때 지정된다.
- 재시딩(`seeded !== signature` 분기)과 저장 성공 시 이 상태를 비운다. 폼 값이 파일 값으로 되돌아간
  뒤에도 "지정함"이 남으면 다음 저장이 같은 값을 다시 명시로 보낸다. 동작은 같지만 의미가 어긋난다.
- 폼 시딩(`roleFormFrom`, `formFrom`)과 검증(`invalidFields`)의 현행 동작은 그대로 둔다. 화면이 파일
  값을 폼에 채우는 것은 유지하되, 그것이 유일한 보존 수단이 아니게 되는 것이 이 작업의 요지다(R1).

### 5. 테스트

백엔드(`heartbeat_service.rs`):

- 블록에 `max_per: 8/24h`인 개발자 잡이 있고, 요청이 `interval`만 지정하고 `max_per`·`model`을
  지정하지 않으면 파일의 `8/24h`가 그대로 남는다.
- **요청에 앱 기본값이 실려 들어와도 지정하지 않은 필드는 파일 값이 산다.** 세 필드를 모두 `None`으로
  둔 요청이 파일을 바꾸지 않는지 확인한다. 기획서 완료 조건 2가 요구하는 테스트다.
- dream 잡에 대해 위 두 시나리오와 같은 테스트를 각각 만든다(기획서 완료 조건 3).
- 블록에 없는 잡은 요청이 지정하지 않으면 앱 기본값으로 만들어진다(첫 설치 회귀).
- 블록의 `model`이 목록 밖 값(`claude-opus-5`)이고 요청이 `model`을 지정하지 않으면 그 값이 그대로
  남는다(기획서 완료 조건 14).
- 역할 잡을 저장해도 블록의 dream 잡이 그대로 남고, 그 반대도 성립한다(기존 보존 회귀).
- 같은 상태로 두 번 저장하면 파일 내용이 같다(기획서 완료 조건 13).

프론트:

- 파일 값이 폼에 차 있는 상태에서 한 필드만 바꿔 저장하면, 설치 함수에 그 필드만 값으로 실리고 나머지
  두 필드는 `null`로 실린다. 역할 잡과 dream 잡 각각.
- 아무 필드도 건드리지 않고 저장하면 세 필드가 모두 `null`로 실린다.
- 기존 `toHaveBeenCalledWith` 단언(`SettingsView.test.tsx`의 역할 잡 설치, `DreamCard.test.tsx`의 dream
  설치)이 새 모양으로 갱신되어 있고, 어떤 케이스도 삭제·`skip` 되지 않았다. 바뀐 단언을 보고서에 전후로
  적는다.

## 완료 조건

1. 관리 블록에 편집값이 적힌 상태에서 그 필드를 화면에서 건드리지 않고 다른 필드만 바꿔 저장하면
   편집값이 그대로 남는다. (기획서 완료 조건 1)
2. 요청에 사용자가 지정하지 않은 필드가 들어오면 파일 값이 유지된다는 것을 백엔드 테스트가 확인한다.
   (기획서 완료 조건 2)
3. 역할 잡과 dream 잡에 같은 보존 규칙이 적용되고, 두 잡 각각에 대한 테스트가 있고 통과한다.
   (기획서 완료 조건 3)
4. 파일에 목록 밖 `model` 값이 있고 그 필드를 지정하지 않으면 값이 그대로 남는다.
   (기획서 완료 조건 14)
5. 같은 상태로 다시 저장하면 파일이 변하지 않는다. (기획서 완료 조건 13)
6. 앱 시작·프로젝트 열기·자동 새로고침·연동 화면 진입만으로는 `~/.claude/HEARTBEAT.md`가 변경되지
   않는다. (기획서 완료 조건 15)
7. SPEC-002·SPEC-003·SPEC-004의 완료 조건에 대응하는 기존 자동화 테스트가 모두 통과하고, 삭제되거나
   비활성화된 케이스가 없다. 요청 모양 변경으로 고친 단언은 보고서에 전후로 적는다.
   (기획서 완료 조건 16)
8. `npm run check`와 `cargo test --manifest-path src-tauri/Cargo.toml`이 통과한다.
   (기획서 완료 조건 17)

## 검증 절차

```sh
npm run check
cargo test --manifest-path src-tauri/Cargo.toml
```

편집값 보존을 실제 파일로 확인한다. 전역 파일을 건드리므로 백업부터 하고 반드시 원복한다.

```sh
cp ~/.claude/HEARTBEAT.md /tmp/HEARTBEAT.md.bak
grep -n "max_per" ~/.claude/HEARTBEAT.md      # 개발자 잡의 현재 값(16/24h)을 적어 둔다
# 앱 설정 화면에서 개발자 잡의 주기만 바꾸고 저장한다. max_per 칸은 건드리지 않는다.
grep -n "max_per" ~/.claude/HEARTBEAT.md      # 값이 그대로여야 한다
cp /tmp/HEARTBEAT.md.bak ~/.claude/HEARTBEAT.md
```

무쓰기와 멱등 확인.

```sh
md5 ~/.claude/HEARTBEAT.md
# 앱을 켜고 설정 화면을 여러 번 드나든 뒤(최소 10초 대기)
md5 ~/.claude/HEARTBEAT.md   # 같아야 한다
# 값을 바꾸지 않고 저장을 한 번 더 실행
md5 ~/.claude/HEARTBEAT.md   # 같아야 한다
```

범위 확인.

```sh
git status --short
```

## 범위 밖

- 관리 블록 읽기 실패와 잡 없음의 구분, 그 상태에서의 저장 차단. TASK-015 담당이다.
- 확인 화면의 표시 내용. 지금은 폼 값을 나열하는 현행 그대로 둔다. TASK-016 담당이다.
- 화면이 읽은 뒤 파일이 바뀐 경우의 처리. TASK-017 담당이다.
- 기본값으로 재설정하는 명시적 액션. TASK-018 담당이다.
- 앱 소유 필드의 사용자 편집 보존. 기획서 제외 범위다.
- 백엔드 값 검증 규칙과 실패 문구 변경. 기획서 제외 범위다.
- 꺼진 잡의 편집값을 기억했다가 다시 켤 때 복원하는 것. 기획서 확인 필요 1번이 제외로 승인됐다.
- 한 관리 블록을 여러 프로젝트가 공유할 때의 문제. 기획서 제외 범위다.

## 참고 사실

확인 시점 2026-08-02. 추정 없이 실측한 값이다.

- `RoleJobRequest`는 `heartbeat_service.rs:110`, `DreamJobRequest`는 `:122`에 있다. 프론트 짝은
  `types.ts:184`와 `:193`이다.
- 요청 값이 파일 값과 다른지 비교하는 지점은 지금 어디에도 없다. `enabled_role_jobs`(`:393`)와
  `requested_dream_settings`(`:303`)가 요청 값을 그대로 설정으로 만든다.
- `preserved_role_jobs`(`:263`)와 `preserved_dream_job`(`:287`)이 이미 "블록 값 → 없으면 기본값"을
  하고 있다. `job.model.unwrap_or(defaults.model)` 형태다. 이 작업이 필요로 하는 기준 설정과 같다.
- `validate_preserved`(`:251`)가 보존 잡의 검증 실패를 `PreservedJob`으로 감싼다.
- 역할 기본값은 `heartbeat_roles.rs:42`의 `default_settings`, dream 기본값은
  `heartbeat_dream::default_settings`다. 프론트에도 같은 값이 상수로 있다
  (`HeartbeatCard.tsx:46`, `DreamCard.tsx:44`). 이 작업은 두 정의를 합치지 않는다. TASK-018이 다룬다.
- 실제 `~/.claude/HEARTBEAT.md`의 관리 블록에는 역할 잡 3종이 있고 `max_per`가 각각 `8/24h`,
  `8/24h`, `16/24h`다. 세 값 모두 앱 기본값(`4/24h`, `4/24h`, `6/24h`)과 다르다. 실사용 구성이
  편집값에 의존하고 있으므로 검증 중 원복을 빠뜨리면 이 저장소의 하트비트 구성이 망가진다.
- 관측된 사고의 기록은 `docs/development-logs/2026-08-02.md`의 "SPEC-003·004 구현 사이클과 QA 일괄
  확인" 절에 있다.
