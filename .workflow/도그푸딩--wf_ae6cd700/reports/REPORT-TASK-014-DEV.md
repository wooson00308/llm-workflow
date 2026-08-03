# TASK-014 개발자 핸드오프

- 대상 작업: TASK-014 (잡 설정 쓰기를 파일 기준 병합으로 전환하고 미지정 필드를 보존)
- 근거 문서: SPEC-005 R1·R6, DECISION-02EBD5DB (approved, created_by: user)
- 세션 역할: 개발자
- 작성 시각: 2026-08-02T15:46Z
- 상태: `qa_waiting`

## 대상 선정 근거

- `todo` 작업은 TASK-014~018 다섯이고 전부 DECISION-02EBD5DB에서 파생됐다. 그 결정은 `approved`이고
  `created_by: user`다.
- TASK-015~018은 모두 TASK-014를 선행으로 걸고, 문서가 병행 금지를 명시했다(같은 백엔드 파일과 같은 두
  카드). 선행 필수 작업이 없는 것은 TASK-014뿐이다.
- 착수 시점에 `.workflow/.runtime/migration.lock` 없음, `leases/` 비어 있음. 배타 생성으로
  `leases/TASK-014.yml`을 만든 뒤 문서를 `in_progress`로 옮기고 시작했다.
- SPEC-005 본문은 `status: user_review`지만 앱이 기록한 승인 결정이 있으므로 공통 규칙 5절의 구현 차단
  조건에 걸리지 않는다.

## 결과

편집 가능 값(`interval`·`max_per`·`model`)의 보존이 화면 시딩의 부수효과에서 쓰기 계약으로 옮겨졌다.
요청은 사용자가 이번 편집에서 실제로 지정한 필드만 싣고, 나머지는 관리 블록에 적힌 값이 이긴다.
규칙은 한 곳(`PartialSettings::over`)에만 있고 역할 잡과 dream 잡이 같은 것을 쓴다.

## 변경한 파일

| 파일 | 내용 |
| --- | --- |
| `src-tauri/src/application/heartbeat_service.rs` | 요청 타입 `Option` 전환, 병합 규칙 도입, 두 설치 경로 재배선, 테스트 7건 추가 |
| `src/features/projects/domain/types.ts` | `RoleJobRequest`·`DreamJobRequest`의 세 필드를 `string \| null`로 |
| `src/features/projects/components/integrations/HeartbeatCard.tsx` | "지정한 필드" 상태 추가, 요청 조립 교체 |
| `src/features/projects/components/integrations/DreamCard.tsx` | 같음 |
| `src/features/projects/components/SettingsView.test.tsx` | 단언 4건 갱신, 신규 1건 |
| `src/features/projects/components/integrations/DreamCard.test.tsx` | 단언 2건 갱신, 신규 1건 |

작업 문서가 금지한 파일은 손대지 않았다. `heartbeat_jobs.rs`의 검증 규칙과 쓰기 함수,
`heartbeat_roles.rs`·`heartbeat_dream.rs`의 잡 정의, 커맨드의 이름과 개수 모두 그대로다.
`inspect`의 `unwrap_or_default()`도 TASK-015 몫이라 건드리지 않았다.

## 설계 판단

- **규칙은 `PartialSettings::over` 하나다.** "없는 필드는 아래 값을 그대로 둔다"를 한 번 정의하고 두 번
  겹쳐 쓴다. 기준 설정은 `블록값.over(앱 기본값)`, 최종 설정은 `요청.over(기준 설정)`이다. 잡 종류마다
  다시 적지 않는다(R1). 잡이 늘어도 새로 적을 것은 `From` 변환 둘뿐이다.
- **`JobSettings` 중간 타입을 뒀다.** `RoleJobSettings`와 `DreamJobSettings`는 필드가 같지만 서로 다른
  타입이라, 이것 없이는 병합을 잡 종류마다 한 번씩 적게 된다. 그 대가가 `From` 네 개다.
- **`preserved_role_jobs`·`preserved_dream_job`도 같은 규칙으로 다시 썼다.** 기존의
  `job.model.unwrap_or(defaults.model)`은 `블록값.over(기본값)`과 같은 뜻이다. 두 벌로 두면 갈라진다.
  결과는 바뀌지 않았고 기존 테스트가 그대로 통과한다.
- **`validate_preserved`를 잡 하나짜리로 좁혔다.** 호출부 셋(보존 역할 잡, 보존 dream 잡, 미지정 요청
  잡)이 전부 잡 단위로 판단하므로 `Vec` 왕복이 필요 없었다. 이 작업 때문에 생긴 변경이다.
- **검증 실패 문구는 지정 여부로 고른다.** 세 필드를 모두 지정하지 않은 잡은 값의 출처가 전부 파일이라
  보존 잡과 같은 처지이고, 기존 `PreservedJob` 문구("손으로 고쳤다면 바로잡은 뒤")가 그 상황에 맞는다.
  한 필드라도 지정한 잡은 현행 `Jobs` 오류 그대로다. 새 문구를 만들지 않았다.
- **`enabled`는 `bool` 그대로다.** 작업 문서와 REPORT-SPEC-005-ARCH의 판단을 따랐다.
- **화면의 "지정함"은 `edit()`에서만 선다.** 모델 입력 방식 전환(`switchModelInput`)은 값 변경이 아니라
  지정으로 치지 않고, 직접 입력 칸에 적으면 `edit()`을 거치므로 그때 선다. 재시딩과 저장 성공 시 비운다.
- **폼 시딩과 프론트 검증은 그대로 뒀다.** 화면이 파일 값을 폼에 채우는 동작은 유지하되, 그것이 유일한
  보존 수단이 아니게 되는 것이 이 작업의 요지다.

## 갱신한 단언 (작업 문서 5절이 요구한 전후 기록)

요청 모양이 바뀌어 고친 것뿐이고, 삭제하거나 `skip` 한 케이스는 없다. 프론트 테스트 수는 78 → 80이다.

| 위치 | 전 | 후 |
| --- | --- | --- |
| `SettingsView.test.tsx` "shows both target paths..." | 세 역할 모두 `interval: "30m"` 등 값 | 세 역할 모두 `interval: null, maxPer: null, model: null` |
| `SettingsView.test.tsx` "carries a picked model..." | developer `model: "sonnet"`, 나머지 필드 값 | developer `model: "sonnet"`, 나머지 두 필드 `null` |
| `SettingsView.test.tsx` "carries a directly entered model name..." | developer `model: "claude-opus-5"`, 나머지 필드 값 | developer `model: "claude-opus-5"`, 나머지 두 필드 `null` |
| `SettingsView.test.tsx` "opens a model value outside the list..." | `objectContaining({ role: "developer", model: "claude-opus-5" })` | `objectContaining({ role: "developer", model: null })` |
| `DreamCard.test.tsx` "does not call the gateway until..." | `{ enabled: true, interval: "2h", maxPer: "6/24h", model: "opus" }` | `{ enabled: true, interval: null, maxPer: null, model: null }` |
| `DreamCard.test.tsx` "sends the job as disabled..." | `{ enabled: false, interval: "2h", ... }` | `{ enabled: false, interval: null, maxPer: null, model: null }` |

네 번째 항목만 설명이 필요하다. SPEC-004 R3의 "목록 밖 모델 값을 앱이 목록 안 값으로 바꾸지 않는다"는
보장이 요청 payload에서 쓰기 계약으로 옮겨간 자리다. 화면은 그 값을 직접 입력 칸에 그대로 열어 보여주고
(같은 테스트의 앞 단언), 건드리지 않았으므로 `model: null`로 내보낸다. 파일의 값이 남는다는 사실은
백엔드 테스트 `an_unlisted_model_survives_a_save_that_does_not_specify_it`이 확인한다. 테스트 본문에도
그 이관을 주석으로 적어 두었다.

신규 테스트:

- 프론트 2건. 파일 값이 폼에 차 있을 때 한 필드만 바꿔 저장하면 그 필드만 값으로 실리고 나머지 둘은
  `null`로 실린다. 역할 잡과 dream 잡 각각.
- 백엔드 7건. 아래 검증 결과에 적었다.

## 검증

```
$ cargo test --manifest-path src-tauri/Cargo.toml
test result: ok. 114 passed; 0 failed        (기존 107 + 신규 7)

$ npm run check      # typecheck + vitest + build
Test Files  11 passed (11)
Tests  80 passed (80)                        (기존 78 + 신규 2)
✓ built in 709ms

$ cargo fmt --manifest-path src-tauri/Cargo.toml -- --check      # 차이 없음
$ cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets  # 경고 없음
```

신규 백엔드 테스트가 확인하는 것:

| 테스트 | 기획서 완료 조건 |
| --- | --- |
| `a_field_the_request_does_not_specify_keeps_the_value_written_in_the_block` | 1 (관측된 사고 그 자체) |
| `a_request_that_specifies_nothing_does_not_change_the_file` | 2, 13 |
| `a_dream_field_the_request_does_not_specify_keeps_the_value_written_in_the_block` | 3 |
| `a_dream_request_that_specifies_nothing_does_not_change_the_file` | 2·3·13의 dream 짝 |
| `an_unlisted_model_survives_a_save_that_does_not_specify_it` | 14 |
| `a_job_absent_from_the_block_starts_from_the_app_defaults` | 첫 설치 회귀 (기본값을 명시한 요청과 바이트 단위로 같음) |
| `a_damaged_value_the_request_does_not_specify_fails_as_a_preserved_job` | 조용한 기본값 복귀 금지 |

다른 연동 보존 회귀는 기존 테스트가 그대로 덮는다. 새로 만들지 않았다.
`saving_role_jobs_keeps_an_installed_dream_job`, `installing_dream_keeps_the_role_jobs_byte_for_byte_and_appends_after_them`.

전역 파일 무쓰기 확인. 이 세션이 `~/.claude/HEARTBEAT.md`를 쓰지 않았다는 사실만 확인한 것이고,
완료 조건 15가 요구하는 앱 실행 중 확인은 아래 QA 절차에 있다.

```
$ shasum ~/.claude/HEARTBEAT.md
d7d3cb524cb0588aa44fb24553c75617ac0ffe20
$ stat -f "%Sm" ~/.claude/HEARTBEAT.md
Aug  3 00:02:02 2026        # 세션 시작(00:34 KST) 이전 시각 그대로
$ grep -n max_per ~/.claude/HEARTBEAT.md
12:- max_per: 8/24h
22:- max_per: 8/24h
32:- max_per: 16/24h        # 실사용 편집값 세 개 모두 그대로
```

## 사용자 QA 절차

앱을 실제로 띄워야 확인되는 것만 남겼다. 전역 파일을 건드리므로 백업부터 하고 반드시 원복한다.

```sh
cp ~/.claude/HEARTBEAT.md /tmp/HEARTBEAT.md.bak
grep -n max_per ~/.claude/HEARTBEAT.md          # 8/24h, 8/24h, 16/24h
# 설정 화면에서 개발자 잡의 "주기"만 바꾸고 저장한다. 실행 한도 칸은 건드리지 않는다.
grep -n max_per ~/.claude/HEARTBEAT.md          # 16/24h가 그대로여야 한다 (완료 조건 1)
cp /tmp/HEARTBEAT.md.bak ~/.claude/HEARTBEAT.md
```

```sh
shasum ~/.claude/HEARTBEAT.md
# 앱을 켜고 설정 화면을 여러 번 드나든다 (최소 10초, 자동 새로고침 여러 주기)
shasum ~/.claude/HEARTBEAT.md                   # 같아야 한다 (완료 조건 15)
# 값을 바꾸지 않고 저장을 한 번 더 실행
shasum ~/.claude/HEARTBEAT.md                   # 같아야 한다 (완료 조건 13)
```

dream 잡도 같은 방식으로 한 번 본다. dream 잡의 실행 한도를 손으로 `2/24h`로 고쳐 둔 뒤 화면에서
주기만 바꿔 저장하면 `2/24h`가 남아야 한다 (완료 조건 3).

## 남은 위험

- **확인 화면은 아직 값을 나열한다.** 저장 전 화면에 보이는 값은 폼 값이고, 실제로 쓰이는 값(미지정
  필드는 파일 값)과 다를 수 있다. 지금은 둘이 같은 경우가 대부분이지만 어긋나는 경우가 이론적으로
  가능하다. TASK-016이 차이 표시로 바꾸면서 닫는다. 이 작업의 범위 밖이라 그대로 뒀다.
- **관리 블록 읽기 실패는 여전히 "잡 없음"과 구별되지 않는다.** `inspect`가 읽기 실패를 빈 문서로
  접으므로 화면은 첫 설치 상태로 보이고, 그 상태에서 저장하면 역할 3종이 기본값으로 새로 쓰인다.
  이 작업은 요청 계약만 바꿨고 이 경로는 TASK-015가 저장 차단으로 막는다. **TASK-015 전까지는 이
  경로가 열려 있다.**
- **화면이 읽은 뒤 파일이 바뀐 경우는 아직 대조하지 않는다.** TASK-017 몫이다.

## 다음 작업자에게

- 권장 순서는 TASK-015 → 016 → 017 → 018이다. 근거는 REPORT-SPEC-005-ARCH에 있다.
- TASK-018이 쓸 요청 계약이 준비됐다. 대상 잡만 세 필드를 명시값(기본값)으로, 나머지 잡은 세 필드를
  모두 `null`로 보내면 재설정이 된다. 새 커맨드가 필요 없다.
- 앱 기본값은 여전히 백엔드(`heartbeat_roles.rs:42`, `heartbeat_dream::default_settings`)와 프론트
  (`HeartbeatCard.tsx`의 `roleJobDefaults`, `DreamCard.tsx`의 `jobDefaults`)에 각각 있다. TASK-018이
  합치기로 되어 있어 이 작업에서는 손대지 않았다.

## 역할 밖 발견 (수정하지 않음)

- `heartbeat_roles.rs` 첫머리의 `#![allow(dead_code)]`에 "커맨드 계층이 호출하면 이 줄을 지운다"는
  주석이 남아 있다. 커맨드 계층은 이미 이 모듈을 호출한다. 이 작업과 무관해 그대로 뒀다.
- 작업 트리에 이 작업 이전부터 커밋되지 않은 변경(TASK-008~013 산출물)이 있다. 이 세션은 위 표의
  파일만 건드렸다.
