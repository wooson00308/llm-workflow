# TASK-017 개발자 핸드오프

- 대상 작업: TASK-017 (화면이 읽은 뒤 바뀐 관리 블록을 확인 없이 덮어쓰지 않는다)
- 근거 문서: SPEC-005 R3, DECISION-02EBD5DB (approved, created_by: user)
- 세션 역할: 개발자
- 작성 시각: 2026-08-02T17:56Z
- 상태: `qa_waiting`

## 대상 선정 근거

- 착수 시점 `todo`는 TASK-017~027 열한 건이다. TASK-018은 TASK-017을 선행 필수로 걸고 병행을 금지하고,
  TASK-019~021(SPEC-006)·TASK-022~025(SPEC-007)·TASK-026~027(SPEC-008)은 SPEC-005의 남은 작업 뒤에
  오는 순서다. REPORT-TASK-016-DEV도 다음을 TASK-017로 지목해 두었다.
- 선행 필수는 TASK-014·TASK-016, 선행 권장은 TASK-015다. 셋 다 `qa_waiting`이다. 세 의존의 근거
  (사용자가 지정한 필드 상태 / 차이 표시 요소 / 못 읽은 상태의 저장 차단)가 구현으로 코드에 있음을
  확인했다. TASK-015·TASK-016도 `qa_waiting`인 선행 위에서 같은 판단으로 진행했다.
- 착수 시점에 `.workflow/.runtime/migration.lock` 없음, `leases/` 비어 있음. 배타 생성으로
  `leases/TASK-017.yml`을 만든 뒤 문서를 `in_progress`로 옮기고 시작했다.
- SPEC-005 본문은 `status: user_review`지만 앱이 기록한 승인 결정이 있으므로 공통 규칙 5절의 구현
  차단 조건에 걸리지 않는다.

## 결과

앱이 화면과 파일 중 한쪽을 임의로 고르지 않는다. 두 방향 모두 막았다.

쓰기 방향: 두 설치 커맨드가 "화면이 읽은 시점의 관리 블록 값"을 기준값으로 함께 받는다. 백엔드는
쓰기 직전에 읽은 문서에서 같은 값을 만들어 대조하고, 다르면 아무 파일도 쓰지 않고 실패한다. 대조는
조건 스크립트 설치보다 앞이라 실패한 요청이 프로젝트 로컬 파일을 새로 만들지 않는다. 대조 범위는 그
요청이 관장하는 잡뿐이라, 다른 연동의 잡만 바뀐 것은 현행 보존 규칙이 그대로 집어 올린다.

읽기 방향: 자동 새로고침이 사용자가 편집 중인 입력을 알림 없이 대체하지 않는다. 한 필드라도 지정한
상태에서 관리 블록이 바뀌면 폼을 되돌리는 대신 무엇이 달라졌는지 보여주고 두 갈래를 준다 —
"파일 값 불러오기"(편집을 버리고 파일 값으로), "편집 유지"(입력을 지키고 파일의 현재 값을 새 기준값
으로). 아무 필드도 지정하지 않은 상태에서는 현행대로 조용히 재시딩한다.

차이 표시는 TASK-016이 만든 `JobChanges` 하나를 그대로 쓴다. 확인 화면과 이 화면이 같은 모양이다.

## 변경한 파일

| 파일 | 내용 |
| --- | --- |
| `src-tauri/src/commands/heartbeat.rs` | 두 설치 커맨드가 `baseline` 인자를 받는다 |
| `src-tauri/src/application/heartbeat_service.rs` | `ManagedRoleJob`·`ManagedDreamJob`에 `Deserialize`, `ManagedBlockChanged` 오류, `install`·`install_dream`의 기준값 대조, 테스트 7건 추가 |
| `src/features/projects/domain/types.ts` | `IntegrationActions`·`ProjectGateway`의 두 쓰기에 `baseline` 인자 |
| `src/features/projects/infrastructure/tauriProjectGateway.ts` | `baseline`을 커맨드 payload에 실어 보낸다 |
| `src/features/projects/application/useProjectWorkspace.ts` | 기준값을 그대로 게이트웨이에 넘긴다 |
| `src/features/projects/components/integrations/HeartbeatCard.tsx` | `seeded` 서명 상태를 `baseline` 값 상태로 교체, 편집 중 재시딩 금지, 선택 UI |
| `src/features/projects/components/integrations/DreamCard.tsx` | 같음 |
| `src/features/projects/components/SettingsView.test.tsx` | 신규 테스트 10건, 기존 단언 4건에 기준값 추가 |
| `src/features/projects/components/integrations/DreamCard.test.tsx` | 신규 테스트 6건, 기존 단언 3건에 기준값 추가 |
| `src/features/projects/application/useProjectWorkspace.test.ts` | 신규 테스트 1건, 기존 호출 2건에 기준값 추가 |
| `.workflow/…/tasks/TASK-017.md` | `todo` → `in_progress` → `qa_waiting` |
| `.workflow/…/reports/REPORT-TASK-017-DEV.md` | 신규 |
| `.workflow/.runtime/leases/TASK-017.yml` | 선점 후 반납 |

작업 문서의 범위 목록 밖은 손대지 않았다. `JobChanges.tsx`도 고치지 않았다 — 이 화면이 그 요소에
맞는 모양을 만들어 넘긴다. 스타일시트도 그대로다. 선택 UI가 기존 `.integration-warning`과
`.heartbeat-confirm-actions` 규칙 안에서 그려진다.

## 설계 판단

- **기준값은 화면이 시딩에 쓴 값 그대로다.** 카드가 `managedJobs`(역할)·`managedJob`(dream)을 상태로
  들고 있다가 저장 요청에 함께 싣는다. 백엔드는 같은 함수(`managed_role_jobs`·`managed_dream_job`)로
  쓰기 직전의 문서에서 같은 모양을 만들어 대조한다. 화면과 백엔드가 같은 판정 함수를 쓰므로 대조가
  표현 차이 때문에 어긋나지 않는다.
- **`app_owned_drift`도 대조에 들어간다.** 앱 소유 필드를 손으로 고친 것도 화면이 읽은 뒤의 파일 변화다.
  기준값은 화면이 받은 객체를 그대로 되돌려 보내므로 별도 필드 추림 없이 통째로 비교한다.
- **없던 것과 생긴 것도 "달라졌다"다.** 역할 잡은 목록을 통째로 비교한다. 스냅샷의 순서가
  `HeartbeatRole::ALL`로 고정돼 있어 순서 때문에 흔들리지 않는다. dream 잡은 `Option` 비교라 `None`과
  `Some`의 차이가 그대로 불일치다.
- **대조 위치는 문서를 읽은 직후.** `install`은 조건 스크립트를 먼저 설치하고 `HEARTBEAT.md`를 나중에
  쓴다. 대조가 그 앞이어야 "실패했는데 프로젝트 로컬 파일이 새로 생기는" 경우가 없다. 테스트가 스크립트
  파일의 부재로 이 순서를 고정한다.
- **편집 중 판정은 `specified`다.** TASK-014가 만든 "사용자가 이번 편집에서 지정한 필드" 상태를 그대로
  쓴다. 폼 값이 파일 값과 같아 보여도 지정과는 다른 상태라는 성질이 여기서도 그대로 성립한다.
- **저장 중에는 불일치로 보지 않는다.** 성공한 쓰기의 응답이 스냅샷을 갱신하는 순간과 지정 기록을
  비우는 순간 사이에 선택 화면이 한 프레임 뜨는 것을 막는다. 실패하면 `saving`이 풀리면서 선택 화면이
  그대로 뜬다.
- **저장 버튼을 막지 않았다.** 불일치 상태에서도 저장을 시도할 수 있고, 백엔드가 거부한 사유가 기존
  쓰기 실패 표시 경로(`writeError`·`IntegrationWarning`)로 카드에 보인다. 작업 문서의 검증 절차가
  "저장을 시도한다 → 사유가 보여야 한다"를 요구하므로 UI에서 미리 막으면 그 절차가 성립하지 않는다.
  두 경로(선택 화면·거부 사유)가 같은 화면에 함께 보이는 것을 테스트가 고정한다.
- **"편집 유지"가 기준값을 갱신한다.** 그래야 다음 저장이 대조를 통과한다. 사용자가 무엇을 덮어쓰는지
  같은 화면에서 이미 봤다는 것이 근거다. 3-way 병합은 하지 않는다 — 요구는 "사용자가 정하게 한다"이지
  자동 병합이 아니다.
- **차이 표시의 방향을 한 줄로 밝혔다.** `JobChanges`는 왼쪽을 "현재", 오른쪽을 "쓰게 될 값"으로 그린다.
  이 화면에서는 왼쪽이 화면이 읽은 값, 오른쪽이 파일의 현재 값이라 그 사실을 안내 문장에 적었다.
  요소를 고쳐 두 화면의 모양을 갈라 놓는 대신 문장으로 방향을 밝히는 쪽을 골랐다.

## 완료 조건 대조

| # | 조건 | 결과 |
| --- | --- | --- |
| 1 | 바뀐 상태에서 저장 시도 → 덮어쓰지 않고 차이를 알림, 파일 불변 | 충족. 백엔드 3건(값 변경·추가·삭제) + 화면 2건 |
| 2 | 편집 중 자동 새로고침이 입력을 알림 없이 대체하지 않음 | 충족. 두 카드 각각 테스트 |
| 3 | 편집 중이 아닐 때의 반영은 현행 그대로 | 충족. 두 카드 각각 회귀 테스트 |
| 4 | 불일치 실패 시 조건 스크립트 포함 어떤 파일도 변하지 않음 | 충족. `a_role_job_added_after_the_screen_read_writes_neither_file` |
| 5 | 다른 연동의 잡만 바뀐 경우는 막히지 않고 값 보존 | 충족. 역할·dream 각 방향 1건 |
| 6 | 역할 잡·dream 잡 각각의 테스트 | 충족. 백엔드 7건, 화면 16건 |
| 7 | 같은 상태로 다시 저장하면 파일 불변 | 충족. 기존 멱등 테스트 통과(기준값을 파일에서 만들어 넘긴다) |
| 8 | 조회·화면 진입만으로 전역 파일 불변 | 충족. 조회 경로를 건드리지 않았고 기존 테스트 통과 |
| 9 | SPEC-002·003·004 기존 테스트 전부 통과 | 충족. 삭제·비활성화 없음 |
| 10 | `npm run check`·`cargo test` 통과 | 충족 |

## 검증 단계와 결과

- `cargo test --manifest-path src-tauri/Cargo.toml` — 127 passed / 0 failed (기존 120 + 신규 7).
- `npm run check` (typecheck + vitest + vite build) — 112 passed / 0 failed (기존 95 + 신규 17), 빌드 성공.
- `cargo fmt -- --check` 차이 없음. `cargo clippy --all-targets -- -D warnings` 경고 없음(CI 동일 조건).
- 삭제하거나 비활성화한 테스트 없음. 기존 단언 9건을 고쳤고 전부 같은 이유다 — 쓰기 계약에 인자가
  하나 늘어 호출 모양이 바뀌었다. 케이스와 검사 대상은 그대로다.
- 전역 파일 무쓰기: `~/.claude/HEARTBEAT.md`의 수정 시각(`Aug 3 00:02`)이 세션 전후로 그대로다.
  백엔드 테스트는 전부 임시 디렉터리에서 돈다. `.workflow/rules/wf-eligible.sh`의 수정 시각도 변화 없다.
- 작업 문서의 수동 검증 절차(앱을 띄우고 파일을 손으로 고치는 절차)는 실행하지 않았다. GUI가 필요하고
  전역 파일을 쓰는 절차라 아래 사용자 QA로 넘긴다.

## 사용자 QA 절차

앱을 띄워야 확인되는 항목이다. 전역 파일을 만지므로 백업부터 하고 반드시 원복한다.

```sh
cp ~/.claude/HEARTBEAT.md /tmp/HEARTBEAT.md.bak
shasum ~/.claude/HEARTBEAT.md
# 1) 연동 화면에서 개발자 잡의 주기를 편집한다(저장하지 않는다)
# 2) 다른 터미널에서 관리 블록 안 기획자 잡의 `- max_per: 8/24h`를 `- max_per: 9/24h`로 바꾼다
# 3) 자동 새로고침을 최소 10초 기다린다
#    → 편집 중이던 주기 값이 그대로 남아 있어야 한다
#    → "화면이 읽은 뒤 관리 블록이 바뀌었습니다"와 `실행 한도 8/24h → 9/24h — 바뀜`이 보여야 한다
# 4) 저장을 시도한다 → 확인 화면을 거쳐 "역할 잡을 쓰지 못했습니다"와 함께
#    "화면이 읽은 뒤 관리 블록이 바뀌어 아무 파일도 쓰지 않았습니다"가 보여야 한다
shasum ~/.claude/HEARTBEAT.md   # 2번 직후 값과 같아야 한다(앱이 쓰지 않았다)
# 5) "편집 유지"를 누르고 다시 저장한다 → 이번에는 성공하고 주기만 바뀌어야 한다
# 6) 되돌린 뒤 "파일 값 불러오기"도 확인한다 → 폼이 파일 값으로 바뀌어야 한다
cp /tmp/HEARTBEAT.md.bak ~/.claude/HEARTBEAT.md
```

편집 중이 아닐 때의 반영도 확인한다.

```sh
cp ~/.claude/HEARTBEAT.md /tmp/HEARTBEAT.md.bak
# 화면을 열고 아무 필드도 건드리지 않은 채, 파일에서 개발자 잡의 주기를 바꾼다
# → 화면 값이 조용히 새 값으로 바뀌어야 한다(알림 없음)
cp /tmp/HEARTBEAT.md.bak ~/.claude/HEARTBEAT.md
```

dream 카드에서도 같은 흐름을 한 번 더 확인한다. 실제 `~/.claude/HEARTBEAT.md`의 역할 잡 `max_per`는
`8/24h`·`8/24h`·`16/24h`다. 원복을 빠뜨리면 이 저장소의 하트비트 구성이 망가진다.

## 다음 작업자에게

- 다음은 TASK-018(잡 단위 기본값 재설정)이다. SPEC-005의 마지막 작업이고 선행 필수 셋(TASK-014·016·017)이
  모두 구현돼 있다. 재설정도 쓰기이므로 이 작업이 만든 `baseline` 인자를 함께 보내야 한다. 카드의
  `baseline` 상태를 그대로 실으면 된다.
- 재설정 확인 화면은 `JobChanges`에 `next`가 앱 기본값인 `WrittenJob` 하나를 넘기면 된다. 이 작업이
  만든 "파일 변화" 화면과 저장 확인 화면이 이미 같은 요소를 쓰고 있다.
- 앱 기본값이 백엔드(`heartbeat_roles.rs`, `heartbeat_dream::default_settings`)와 프론트
  (`HeartbeatCard.tsx`의 `roleJobDefaults`, `DreamCard.tsx`의 `jobDefaults`)에 각각 있는 상태는
  그대로다. TASK-018이 합치기로 되어 있다.

## 후속 / 리스크

- **토글은 편집 중 판정에 들어가지 않는다.** 작업 문서가 "사용자가 지정한 필드" 상태를 판정 근거로
  못박았고 그대로 따랐다. 그래서 사용자가 값은 그대로 두고 토글만 켜고 끈 상태에서 파일이 바뀌면
  현행대로 조용히 재시딩되고 토글 상태가 되돌아간다. 사고의 원형(편집한 값이 사라짐)과는 다른 경로이고
  범위를 넓히지 않기 위해 손대지 않았다. 다루려면 별도 사안이다.
- **차이 표시의 시제가 이 화면에서는 미래형이다.** `JobChanges`는 저장 확인 화면용이라 새로 생긴 잡에
  "새로 추가됩니다", 사라진 잡에 "값이 함께 사라집니다"로 적는다. 파일 변화 화면에서는 이미 일어난
  일이라 시제가 어긋난다. 두 화면이 같은 모양이어야 한다는 요구를 우선해 요소를 고치지 않았고, 대신
  안내 문장이 방향을 밝힌다. 문구 조정이 필요하면 `JobChanges`를 손대는 별도 사안이다.
- **파일 잠금은 없다.** 대조는 쓰기 직전의 읽기다. 대조와 쓰기 사이의 아주 짧은 창에서 다른 프로세스가
  파일을 바꾸면 그 변경은 덮인다. 기획서 제외 범위이고 이 앱은 잠금을 쓰지 않는다.
- **두 프로젝트가 같은 관리 블록을 동시에 쓰는 문제는 그대로다.** 기준값 대조는 한 화면이 읽은 뒤의
  변화를 잡으므로 다른 프로젝트 창이 먼저 쓴 경우도 불일치로 걸린다. 다만 사용자가 "편집 유지"로 넘기면
  그 값을 덮어쓰는 것은 여전히 가능하다. 기획서 제외 범위이고 REPORT-TASK-012-DEV가 별도 사안으로
  지목해 두었다.
- 역할 밖 발견 (수정하지 않음):
  - `heartbeat_roles.rs`·`heartbeat_status.rs` 첫머리의 `#![allow(dead_code)]` 주석
    ("커맨드 계층이 호출하면 이 줄을 지운다")이 실제와 어긋난 채 그대로다. REPORT-TASK-014·015·016-DEV가
    이미 적었다.
  - 작업 트리에 이 작업 이전부터 커밋되지 않은 변경(TASK-008~016 산출물)이 있다. 이 세션은 위 표의
    파일만 건드렸다.
