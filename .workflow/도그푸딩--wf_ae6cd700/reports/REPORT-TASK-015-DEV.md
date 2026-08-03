# TASK-015 개발자 핸드오프

- 대상 작업: TASK-015 (관리 블록 읽기 실패를 잡 없음과 구분하고 그 상태에서 저장을 막는다)
- 근거 문서: SPEC-005 R2·R6, DECISION-02EBD5DB (approved, created_by: user)
- 세션 역할: 개발자
- 작성 시각: 2026-08-02T16:23Z
- 상태: `qa_waiting`

## 대상 선정 근거

- `todo` 작업은 TASK-015~021 일곱이다. TASK-016·017·018은 TASK-015를, TASK-019~021은 SPEC-005 네
  작업 전체를 선행 필수로 걸고 있어 지금 착수할 수 있는 것은 TASK-015뿐이다.
- TASK-015의 선행 필수는 TASK-014 하나다. TASK-014는 구현과 에이전트 검증이 끝나 `qa_waiting`이고,
  그 의존의 근거(같은 저장 경로를 먼저 계약으로 만든다)는 구현이 끝난 시점에 충족된다. 요청 계약
  (`RoleJobRequest`의 `Option` 필드, `PartialSettings::over`)이 작업 트리에 이미 있음을 확인했다.
- 착수 시점에 `.workflow/.runtime/migration.lock` 없음, `leases/` 비어 있음. 배타 생성으로
  `leases/TASK-015.yml`을 만든 뒤 문서를 `in_progress`로 옮기고 시작했다.
- SPEC-005 본문은 `status: user_review`지만 앱이 기록한 승인 결정이 있으므로 공통 규칙 5절의 구현
  차단 조건에 걸리지 않는다.

## 결과

조회 경로가 `HEARTBEAT.md` 읽기 실패를 더 이상 빈 문서로 접지 않는다. "앱이 값을 모르는 상태"와
"값이 없는 상태"가 스냅샷에서 갈라지고, 모르는 상태에서는 두 카드 모두 잡 입력 폼을 그리지 않고
저장 버튼을 비활성으로 둔다. 사유와 대상 경로는 화면에 그대로 보인다.

## 변경한 파일

| 파일 | 내용 |
| --- | --- |
| `src-tauri/src/infrastructure/heartbeat_status.rs` | `TextSource::Unreadable`이 사유를 싣고, 조회가 읽은 문서를 `HeartbeatRead`로 함께 돌려준다 |
| `src-tauri/src/application/heartbeat_service.rs` | `inspect`의 두 번째 읽기 제거, 스냅샷에 `managed_block_failure` 추가, 테스트 3건 추가 |
| `src/features/projects/domain/types.ts` | `IntegrationsSnapshot.managedBlockFailure` 추가 |
| `src/features/projects/components/integrations/HeartbeatCard.tsx` | `UnreadableManagedBlock` 분기 |
| `src/features/projects/components/integrations/DreamCard.tsx` | 같음 |
| `src/features/projects/components/SettingsView.test.tsx` | 픽스처 1줄, 신규 테스트 3건 |
| `src/features/projects/components/integrations/DreamCard.test.tsx` | 픽스처·헬퍼 인자 1개, 신규 테스트 3건 |
| `src/features/projects/application/useProjectWorkspace.test.ts` | 스냅샷 픽스처에 `managedBlockFailure: null` 1줄 |

마지막 줄만 작업 문서의 범위 목록 밖이다. `IntegrationsSnapshot`에 필수 필드를 더하면 이 파일의
픽스처가 타입 검사에서 깨지므로 컴파일이 강제한 1줄이고, 그 외에는 손대지 않았다.

작업 문서가 범위 밖으로 지목한 것은 전부 그대로다. 설치 경로 `read_document`, 배지 문구와 설치
판정(`TextSource::found`), `readFailures` 경고 상자(`IntegrationCard.tsx`), 다른 조회 경로의 읽기 실패
처리 모두 건드리지 않았다.

## 설계 판단

- **읽기 결과에 사유를 실었다.** `TextSource::Unreadable`이 `HeartbeatReadFailure`를 들고 다닌다.
  실패 목록에도 같은 값이 들어가지만, 이 문서를 못 읽었다는 사실을 목록에서 경로 문자열로 되찾는
  방식은 경로 조립이 한 군데 더 생기고 다른 파일의 실패와 섞일 위험이 있다.
- **조회가 읽은 문서를 돌려준다.** `read_heartbeat_status`의 반환을 `HeartbeatRead`
  (`status` + `document`)로 바꿨다. 같은 파일을 두 번 읽으면 두 결과가 갈라져 이 작업의 구분 자체가
  성립하지 않는다. 튜플 대신 이름 있는 필드로 둬서 호출부(`.status`)가 무엇을 꺼내는지 드러난다.
  이 함수는 크레이트 안에서만 쓰이므로 `pub(crate)`로 좁혔다.
- **스냅샷 값은 `Option<HeartbeatReadFailure>` 하나다.** "읽었는가"와 "사유"를 각각 필드로 두면 둘이
  어긋날 수 있는 상태가 생긴다. `None`이 곧 읽음이고, 파일 없음도 읽음이다. 프론트가 이미 아는
  `IntegrationReadFailure` 모양을 그대로 쓴다.
- **섹션 공통 값이다.** `HEARTBEAT.md`는 두 연동이 공유하는 한 파일이므로 `supported`·`slug`와 같은
  층에 뒀다. 연동별 payload에 넣으면 dream 카드가 하트비트 연동의 실패를 들여다봐야 한다.
- **막는 화면은 카드 안의 작은 컴포넌트 둘로 뒀다.** 골격(`IntegrationCard.tsx`)은 작업 범위 밖이라
  공용 컴포넌트를 만들지 않았다. 문구가 연동별로 다르므로(역할 잡/dream 잡) 지금은 각 카드가 자기
  문구를 갖는 편이 골격에 조건을 넣는 것보다 단순하다. 세 번째 연동이 오면 그때 올린다.
- **비활성 버튼 문구는 중립으로 뒀다.** "역할 잡 저장"·"dream 잡 저장"이다. 못 읽은 상태에서는 잡이
  있는지 없는지 앱이 모르므로 "이 프로젝트에 ... 설치"(첫 설치)나 "변경 사항 저장"(설치됨) 중
  어느 쪽을 써도 사실이 아닌 상태를 주장하게 된다.
- **잡 목록은 여전히 빈 값이다.** 작업 문서대로 `managedJobs`·`managedJob`의 모양은 바꾸지 않았다.
  화면이 그것을 "잡 없음"으로 읽지 않도록 관리 블록 상태를 먼저 보는 것으로 갈랐다.

## 검증

```
$ cargo test --manifest-path src-tauri/Cargo.toml
test result: ok. 117 passed; 0 failed        (기존 114 + 신규 3)

$ npm run check      # typecheck + vitest + build
Test Files  11 passed (11)
Tests  86 passed (86)                        (기존 80 + 신규 6)
✓ built in 696ms

$ cargo fmt --manifest-path src-tauri/Cargo.toml -- --check      # 차이 없음
$ cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets  # 경고 없음
```

삭제하거나 비활성화한 케이스는 없다. 기존 단언을 고친 것도 없다. 픽스처 3곳에 새 필드 기본값
(`managedBlockFailure: null`)을 더한 것이 전부다(완료 조건 7).

신규 백엔드 테스트:

| 테스트 | 작업 문서 완료 조건 |
| --- | --- |
| `an_unreadable_document_is_reported_with_its_path_and_reason` | 1·2 (읽기 실패가 사유·경로와 함께 스냅샷에 실린다) |
| `an_absent_document_counts_as_read_with_no_jobs` | 6 (파일 없음은 읽기 실패가 아니다) |
| `a_readable_document_reports_its_jobs_and_no_failure` | 회귀 (정상 파일의 잡 목록 그대로) |

읽기 실패는 권한 조작으로 만든다. `#[cfg(unix)]` 아래에 두고 테스트가 만든 임시 디렉터리 안의
파일만 `0o000`으로 바꿨다가 되돌린다. 같은 테스트가 설치 판정이 "설치됨" 그대로임도 확인한다
(작업 문서 0절: 못 읽은 파일도 존재는 한다).

신규 프론트 테스트(역할 잡 3건 + dream 3건, 같은 구성):

- 못 읽은 스냅샷에서 세 입력 필드가 렌더되지 않고, 저장 버튼이 비활성이며, 눌러도 확인 화면이 열리지
  않고 설치 함수가 호출되지 않는다. (완료 조건 1·3·4)
- 같은 스냅샷에서 대상 경로·사유·차단 사유가 화면에 보인다. (완료 조건 1)
- 잡이 없는 스냅샷과 못 읽은 스냅샷을 각각 렌더해 대조한다. 전자에만 "역할 잡 미설치"/"dream 잡이
  아직 없습니다"가, 후자에만 "관리 블록을 읽지 못했습니다"가 나온다. (완료 조건 2·4)

전역 파일 무쓰기 확인. 이 세션이 `~/.claude/HEARTBEAT.md`를 쓰지 않았다는 사실만 확인한 것이고,
완료 조건 5가 요구하는 앱 실행 중 확인은 아래 QA 절차에 있다.

```
$ shasum ~/.claude/HEARTBEAT.md
d7d3cb524cb0588aa44fb24553c75617ac0ffe20        # TASK-014 보고서의 값과 같다
$ stat -f "%Sm" ~/.claude/HEARTBEAT.md
Aug  3 00:02:02 2026                            # 세션 시작(01:16 KST) 이전 시각 그대로
$ grep -n max_per ~/.claude/HEARTBEAT.md
12:- max_per: 8/24h
22:- max_per: 8/24h
32:- max_per: 16/24h                             # 실사용 편집값 세 개 모두 그대로
```

`inspect`는 이번 변경으로 읽기가 하나 줄었고 새로 쓰는 경로는 없다. 조회 모듈이 홈 아래 어떤 파일도
건드리지 않는다는 기존 테스트(`reading_the_status_does_not_touch_the_heartbeat_home`)도 그대로 통과한다.

## 사용자 QA 절차

앱을 실제로 띄워야 확인되는 것만 남겼다. 전역 파일의 권한을 건드리므로 백업부터 하고 반드시 원복한다.

```sh
cp ~/.claude/HEARTBEAT.md /tmp/HEARTBEAT.md.bak
md5 ~/.claude/HEARTBEAT.md
chmod 000 ~/.claude/HEARTBEAT.md
# 앱 설정 화면을 연다. claude-heartbeat 카드와 dream 카드 둘 다에서 확인한다:
#   - 주기·실행 한도·모델 입력 칸이 아예 보이지 않는다 (기본값이 찬 폼이 없다)
#   - "관리 블록을 읽지 못했습니다"와 대상 경로·사유가 보인다
#   - 저장 버튼("역할 잡 저장", "dream 잡 저장")이 비활성이고 눌리지 않는다
chmod 644 ~/.claude/HEARTBEAT.md
md5 ~/.claude/HEARTBEAT.md   # 위와 같아야 한다
diff /tmp/HEARTBEAT.md.bak ~/.claude/HEARTBEAT.md   # 비어 있어야 한다
```

잡 없음 상태와 대조한다. 문구·구성이 위 화면과 달라야 한다.

```sh
# 관리 블록 마커 한 쌍만 남기고 그 사이를 비운 파일로 화면을 확인한다
#   - 역할 잡 카드: "역할 잡 미설치 — 앱 관리 블록에 이 프로젝트의 역할 잡이 없습니다."
#   - dream 카드: "앱 관리 블록에 이 프로젝트의 dream 잡이 아직 없습니다."
#   - 두 카드 모두 입력 폼과 저장 버튼이 정상으로 보인다
cp /tmp/HEARTBEAT.md.bak ~/.claude/HEARTBEAT.md
```

전역 파일 무변경 회귀 (완료 조건 5).

```sh
shasum ~/.claude/HEARTBEAT.md
# 앱을 켜고 연동 화면을 여러 번 드나든다 (최소 10초, 자동 새로고침 여러 주기)
shasum ~/.claude/HEARTBEAT.md   # 같아야 한다
```

정상 파일에서 기존 저장 흐름(TASK-014 QA 절차)이 그대로인지도 한 번 본다. 조회 경로를 고쳤으므로
폼 시딩이 파일 값을 그대로 읽는지가 회귀 대상이다.

## 남은 위험

- **확인 화면은 아직 값을 나열한다.** TASK-016 몫이다. 이 작업은 못 읽은 상태의 저장만 막았고, 읽은
  상태에서 무엇이 달라지는지는 여전히 보이지 않는다.
- **화면이 읽은 뒤 파일이 바뀐 경우는 아직 대조하지 않는다.** TASK-017 몫이다.
- **읽기 실패가 조회 주기 중간에 생기면 편집 중이던 입력이 사라진다.** 폼 컴포넌트가 언마운트되기
  때문이다. 읽지 못하는 파일에 대해 편집을 이어가게 두는 것이 더 나쁘므로 이대로 뒀지만, 사용자가
  타이핑 중 권한이 바뀌는 드문 경우에는 입력이 날아간다. TASK-017의 "편집 중 보호"와 인접한 사안이다.
- **여러 프로젝트가 한 블록을 공유할 때의 문제는 그대로다.** SPEC-005 제외 범위이고 REPORT-TASK-012-DEV가
  이미 후속으로 지목해 뒀다.

## 다음 작업자에게

- 다음은 TASK-016이다. 못 읽은 상태의 저장이 막혀 있으므로 차이 표시가 그 경우를 따로 처리하지 않아도
  된다(TASK-016 의존성의 "선행 권장" 항목이 이 작업으로 충족됐다).
- 차이 표시가 기준으로 삼을 "파일의 현재 값"은 `heartbeat.managedJobs`·`dream.managedJob`이고,
  그 값이 신뢰할 수 있는지는 `snapshot.managedBlockFailure === null`로 판정한다.
- 앱 기본값이 백엔드(`heartbeat_roles.rs`, `heartbeat_dream::default_settings`)와 프론트
  (`HeartbeatCard.tsx`의 `roleJobDefaults`, `DreamCard.tsx`의 `jobDefaults`)에 각각 있는 상태도
  그대로다. TASK-018이 합치기로 되어 있다.

## 역할 밖 발견 (수정하지 않음)

- 다른 조회 경로의 읽기 실패 처리는 이 작업의 요구가 아니라 점검만 했다. dream 정제 상태
  (`heartbeat_dream.rs`의 `read_text(dream_meta.md)`)와 잡 실행 기록(`state.json`)은 읽기 실패를
  `readFailures`에 남기고 값은 "기록 없음"으로 접는다. 두 값은 표시 전용이고 쓰기 판단에 쓰이지
  않으므로 이번 사고 경로와 다르다. 필요하다면 별도 아이디어로 다루면 된다.
- `heartbeat_roles.rs` 첫머리의 `#![allow(dead_code)]` 주석("커맨드 계층이 호출하면 이 줄을 지운다")이
  실제와 어긋나는 상태가 그대로 남아 있다. `heartbeat_status.rs`에도 같은 주석이 있다.
  REPORT-TASK-014-DEV가 이미 적었고 이 작업과 무관해 손대지 않았다.
- 작업 트리에 이 작업 이전부터 커밋되지 않은 변경(TASK-008~014 산출물)이 있다. 이 세션은 위 표의
  파일만 건드렸다.
