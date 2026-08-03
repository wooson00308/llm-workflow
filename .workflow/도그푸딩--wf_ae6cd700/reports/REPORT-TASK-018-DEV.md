# TASK-018 개발자 핸드오프

- 대상 작업: TASK-018 (잡 단위 기본값 재설정을 저장과 분리된 명시적 액션으로 제공)
- 근거 문서: SPEC-005 R5, DECISION-02EBD5DB (approved, created_by: user)
- 세션 역할: 개발자
- 작성 시각: 2026-08-02T19:35Z
- 상태: `qa_waiting`

## 대상 선정 근거

- 착수 시점 `todo`는 TASK-018·019·020·021·023·024·025·027 여덟 건이다. TASK-019는 선행 필수로
  TASK-018을 걸고 있고, TASK-020·021은 TASK-019에 걸린다. TASK-023~025(SPEC-007)·TASK-027(SPEC-008)은
  SPEC-005의 남은 작업 뒤 순서이며, REPORT-TASK-017-DEV도 다음을 TASK-018로 지목해 두었다.
- 선행 필수는 TASK-014·TASK-016·TASK-017, 선행 권장은 TASK-015다. 넷 다 `qa_waiting`이다. 네 의존의
  근거(요청 계약의 미지정 필드 / `JobChanges` 차이 표시 요소 / 기준값 대조 / 못 읽은 상태의 저장 차단)가
  구현으로 코드에 있음을 확인했다. TASK-015~017도 `qa_waiting`인 선행 위에서 같은 판단으로 진행했다.
- 착수 시점에 `.workflow/.runtime/migration.lock` 없음, `leases/` 비어 있음. 배타 생성으로
  `leases/TASK-018.yml`을 만든 뒤 문서를 `in_progress`로 옮기고 시작했다.
- 반려 QA 없음. `decisions/`의 `qa-decision@1` 중 TASK-018을 가리키는 것은 없다.
- SPEC-005 본문은 `status: user_review`지만 앱이 기록한 승인 결정이 있으므로 공통 규칙 5절의 구현
  차단 조건에 걸리지 않는다.

## 결과

되돌리는 것이 저장의 부작용이 아니라 사용자가 고르는 동작이 됐다. 두 가지를 했다.

**기본값의 출처를 하나로 만들었다.** 앱 기본값이 백엔드(`heartbeat_roles.rs`의 `default_settings`,
`heartbeat_dream::default_settings`)와 프론트(`HeartbeatCard.tsx`의 `roleJobDefaults`,
`DreamCard.tsx`의 `jobDefaults`)에 각각 상수로 있던 상태를 없앴다. 백엔드 기본값이 스냅샷에 실려
내려가고 프론트의 두 상수는 지웠다. 역할 잡은 역할마다 값이 다르므로 `heartbeat.roles` 항목에
`defaults`로 실리고, dream은 잡이 하나라 연동 payload에 하나 얹었다. 첫 설치 시딩(`roleFormFrom`,
`formFrom`)과 재설정이 같은 값을 쓴다.

**잡마다 재설정 액션을 뒀다.** 관리 블록에 있는 잡에만 보인다 — 없는 잡은 되돌릴 파일 값이 없고 폼이
이미 기본값에서 시작한다. 누르면 저장과 별개의 확인 화면이 열리고, 그 잡의 파일 현재 값과 앱 기본값의
차이를 `JobChanges`로 보여준다. 달라지는 것이 없으면 그 사실을 밝힌다(요소가 이미 하는 일이다).
확인하면 대상 잡의 세 필드만 기본값을 명시값으로 싣고 같은 요청의 다른 잡은 세 필드를 전부 미지정으로
보낸다. `enabled`는 폼의 토글이 아니라 파일 기준이라, 토글을 바꿔 둔 상태에서 재설정해도 관리 블록의
잡 목록이 바뀌지 않는다. 기준값(TASK-017)은 저장과 같은 값을 함께 보낸다.

새 Tauri 커맨드는 만들지 않았다. TASK-014의 요청 계약이 이 액션을 그대로 표현한다.

## 변경한 파일

| 파일 | 내용 |
| --- | --- |
| `src-tauri/src/domain/project.rs` | `JobDefaults` 추가, `HeartbeatRoleStatus`에 `defaults` 필드 |
| `src-tauri/src/infrastructure/heartbeat_roles.rs` | `RoleJobSettings → JobDefaults` 변환 |
| `src-tauri/src/infrastructure/heartbeat_dream.rs` | `DreamJobSettings → JobDefaults` 변환 |
| `src-tauri/src/infrastructure/heartbeat_status.rs` | 역할 상태에 앱 기본값을 담는다 |
| `src-tauri/src/application/heartbeat_service.rs` | `DreamIntegration.defaults`, 테스트 3건 추가 |
| `src/features/projects/domain/types.ts` | `JobDefaults`, `HeartbeatRoleStatus.defaults`, `DreamIntegration.defaults` |
| `src/features/projects/components/integrations/HeartbeatCard.tsx` | `roleJobDefaults` 상수 제거, 스냅샷 기본값 사용, 역할별 재설정 액션과 확인 화면 |
| `src/features/projects/components/integrations/DreamCard.tsx` | `jobDefaults` 상수 제거, 같은 규칙의 재설정 액션 |
| `src/features/projects/components/SettingsView.test.tsx` | 신규 테스트 9건, 픽스처에 역할 기본값 |
| `src/features/projects/components/integrations/DreamCard.test.tsx` | 신규 테스트 8건, 픽스처에 dream 기본값 |
| `src/features/projects/application/useProjectWorkspace.test.ts` | 픽스처에 dream 기본값 |
| `.workflow/…/tasks/TASK-018.md` | `todo` → `in_progress` → `qa_waiting` |
| `.workflow/…/reports/REPORT-TASK-018-DEV.md` | 신규 |
| `.workflow/.runtime/leases/TASK-018.yml` | 선점 후 반납 |

작업 문서의 범위 목록 밖은 손대지 않았다. 새 커맨드 없음, `JobChanges.tsx` 무변경, 스타일시트 무변경 —
재설정 확인 화면이 기존 `.heartbeat-confirm`·`.heartbeat-confirm-actions`·`.secondary-button` 규칙
안에서 그려진다.

## 설계 판단

- **기본값은 `heartbeat.roles` 항목에 실었다.** 작업 문서가 지목한 자리다. 역할마다 값이 다르므로
  하나로 접으면 개발자 잡이 다른 값으로 되돌아간다. 백엔드가 늘 세 역할을 담아 보내므로 화면은
  `roles`에서 역할별 기본값 맵을 만들어 쓴다. 화면에는 대체 상수를 두지 않았다 — 두면 이 작업이
  없애려는 이중 정의가 그대로 돌아온다.
- **`JobDefaults`는 도메인에 뒀다.** `HeartbeatRoleStatus`가 도메인 타입이고 dream payload도 같은 값을
  쓴다. 인프라의 `RoleJobSettings`·`DreamJobSettings`에 `Serialize`를 붙여 payload로 내보내는 대신
  변환 두 개를 뒀다. 잡 정의가 바뀌면 변환을 통해 화면 값도 함께 바뀐다.
- **`enabled`는 파일 기준이다.** 요청의 모든 역할에 대해 "관리 블록에 있느냐"로 정한다. 폼 토글을 쓰면
  사용자가 토글을 바꿔 둔 상태의 재설정이 잡을 지우거나 만든다. 완료 조건 12가 금지하는 일이다.
- **확인 화면이 두 파일을 밝힌다.** 역할 잡 재설정은 저장과 같은 `install` 커맨드를 타므로 조건
  스크립트도 앱 버전으로 다시 쓰인다. 저장 확인 화면과 같은 목록을 그대로 적었다. dream 재설정은
  `install_dream`이라 전역 파일 하나만 쓴다.
- **앱 소유 필드 표시를 재설정 화면에도 넣었다.** `appOwnedDrift`를 그대로 넘긴다. 재설정도 쓰기라
  손으로 고친 앱 소유 필드가 되돌아간다. 이것이 없으면 편집 가능 값이 이미 기본값인 잡에서 "달라지는
  것 없음"이라고 적어 놓고 실제로는 파일이 바뀌는 경우가 생긴다.
- **확인 화면은 한 번에 하나만 연다.** 저장 확인을 열면 재설정 확인이 닫히고 반대도 같다. 두 화면이
  동시에 뜨면 "확인하고 쓰기"와 "확인하고 되돌리기" 중 무엇이 무엇에 붙은 버튼인지 읽히지 않는다.
- **재설정 성공 뒤 지정 기록을 비우지 않는다.** 작업 문서는 "재설정 후에는 사용자 편집이 없는 상태이므로
  조용히 재시딩되는 현행 경로가 그대로 맞다"고 적었고, 편집이 없으면 실제로 그 경로가 탄다. 다만 다른
  잡을 편집 중인 상태에서 재설정을 누를 수도 있어서, 그때 지정 기록을 비우면 그 편집이 조용히 사라진다.
  SPEC-005가 없애려는 바로 그 종류의 손실이다. 그래서 비우지 않는다 — 편집이 남아 있으면 TASK-017의
  파일 변화 안내가 뜨고 사용자가 "파일 값 불러오기"와 "편집 유지" 중에서 고른다.
- **버튼 문구에 역할 이름을 붙였다.** 역할 잡 카드에는 재설정 버튼이 최대 셋이라 접근성 이름이 서로
  달라야 한다. "개발자 기본값으로 재설정" 형태다. 저장 버튼 문구는 손대지 않았다.
- **미지원 플랫폼에서는 비활성이다.** 재설정도 쓰기라 저장 버튼과 같은 취급을 했다.

## 완료 조건 대조

| # | 조건 | 결과 |
| --- | --- | --- |
| 1 | 재설정이 저장과 구분되어 존재하고 실행 전 차이를 보여줌 | 충족. 두 카드 각각 확인 화면 테스트 |
| 2 | 편집 가능 값만 되돌리고 활성 상태를 바꾸지 않음 | 충족. 화면 2건 + 백엔드 `resetting_one_job_keeps_the_other_values_and_the_job_list` |
| 3 | 대상 잡 하나에만 적용, 다른 잡 편집값 유지 | 충족. 화면 요청 payload 1건 + 백엔드 파일 대조 1건 |
| 4 | 앱 기본값이 앱 안 한 곳에서 나옴 | 충족. 프론트 상수 제거, 스냅샷 값이 `default_settings`와 같음을 백엔드 2건이 고정 |
| 5 | 재설정도 확인 화면을 거치고 확인 전 무쓰기 | 충족. 두 카드 각각 테스트 |
| 6 | 재설정 시점 블록이 다르면 덮어쓰지 않음 | 충족. 기준값을 함께 보내고 TASK-017의 대조가 그대로 적용됨. 두 카드 테스트가 baseline 인자를 고정 |
| 7 | 두 카드에 같은 규칙, 각각 테스트 통과 | 충족. 하트비트 9건, dream 8건 |
| 8 | 같은 상태로 다시 저장하면 파일 불변 | 충족. 기존 멱등 테스트 통과 |
| 9 | 조회·화면 진입만으로 전역 파일 불변 | 충족. 조회 경로에 값 하나를 더했을 뿐 쓰기 없음, 기존 테스트 통과 |
| 10 | SPEC-002·003·004 기존 테스트 전부 통과, 삭제·비활성화 없음 | 충족 |
| 11 | `npm run check`·`cargo test` 통과 | 충족 |

## 검증 단계와 결과

- `cargo test --manifest-path src-tauri/Cargo.toml` — 141 passed / 0 failed (기존 138 + 신규 3).
- `npm run check` (typecheck + vitest + vite build) — 131 passed / 0 failed (기존 114 + 신규 17), 빌드 성공.
- `cargo fmt --check` 차이 없음. `cargo clippy --all-targets` 경고 없음.
- 삭제하거나 비활성화한 테스트 없음. 기존 케이스는 그대로다. 픽스처 4곳에 `defaults`를 채웠고
  (`SettingsView.test.tsx`의 heartbeat·dream, `DreamCard.test.tsx`의 dream,
  `useProjectWorkspace.test.ts`의 dream) 이유는 하나다 — payload에 필드가 늘었다. 검사 대상은 그대로다.
  `SettingsView.test.tsx`의 역할 목록 픽스처 두 곳은 `roleStatuses()` 헬퍼 호출로 바꿨다. 백엔드가 늘
  세 역할을 담아 보내는 사실을 픽스처가 따라간 것이고 단언은 바뀌지 않았다.
- 전역 파일 무쓰기: `~/.claude/HEARTBEAT.md`의 수정 시각(`Aug 3 00:02`)과 해시
  (`06cc0959e2bf409a6db662a419323781`)가 세션 전후로 그대로다. 백엔드 테스트는 전부 임시 디렉터리에서
  돈다.
- 작업 문서의 수동 검증 절차(앱을 띄우고 전역 파일을 실제로 되돌리는 절차)는 실행하지 않았다. GUI가
  필요하고 전역 파일을 쓰는 절차라 아래 사용자 QA로 넘긴다. 그 절차가 확인하려던 파일 수준의 결과
  (대상 잡만 기본값, 다른 잡 편집값 유지, 잡 개수 불변)는 백엔드 테스트
  `resetting_one_job_keeps_the_other_values_and_the_job_list`가 같은 시나리오로 고정해 두었다.

## 사용자 QA 절차

앱을 띄워야 확인되는 항목이다. 전역 파일을 만지므로 백업부터 하고 반드시 원복한다.

```sh
cp ~/.claude/HEARTBEAT.md /tmp/HEARTBEAT.md.bak
grep -n "max_per" ~/.claude/HEARTBEAT.md   # 8/24h, 8/24h, 16/24h
# 1) 기획자 잡의 토글을 끄고 저장한다(관리 블록에서 빠진 상태를 만든다)
# 2) 개발자 잡의 "개발자 기본값으로 재설정"을 누른다
#    → 확인 화면에 `실행 한도 16/24h → 6/24h — 바뀜`이 보여야 한다
#    → 기획자 잡에는 재설정 버튼이 없어야 한다(블록에 없다)
# 3) "확인하고 되돌리기"를 누른다
grep -n "max_per" ~/.claude/HEARTBEAT.md   # 개발자만 6/24h, 아키텍트는 8/24h 그대로
grep -c "^## wf-" ~/.claude/HEARTBEAT.md   # 잡 개수가 2번 이전과 같아야 한다(기획자는 여전히 없음)
cp /tmp/HEARTBEAT.md.bak ~/.claude/HEARTBEAT.md
grep -n "max_per" ~/.claude/HEARTBEAT.md   # 8/24h, 8/24h, 16/24h로 돌아왔는지 확인
```

이미 기본값인 잡과 토글 무관함도 본다.

```sh
# 4) 재설정 직후 같은 잡의 재설정을 다시 연다 → "관리 블록에서 달라지는 값이 없습니다"가 보여야 한다.
#    취소로 끝낸다.
# 5) 개발자 잡의 토글을 끈 채로 재설정을 실행한다 → 잡이 블록에서 사라지지 않아야 한다.
```

dream 카드에서도 같은 흐름을 한 번 더 확인한다. 실제 `~/.claude/HEARTBEAT.md`의 역할 잡 `max_per`는
`8/24h`·`8/24h`·`16/24h`로 세 값 모두 앱 기본값과 다르다. 원복을 빠뜨리면 이 저장소의 하트비트 구성이
망가진다.

## 다음 작업자에게

- 이 작업으로 SPEC-005 완료 조건 17개가 모두 덮였다. 다음은 TASK-019(연동을 사이드바 독립 메뉴와 전용
  뷰로 이동)다. TASK-019가 선행 필수로 건 TASK-015·016·017·018이 전부 구현됐다.
- TASK-019는 "위치 이동만 한다"가 조건이다. 이 작업이 두 카드에 더한 재설정 버튼과 확인 화면도 그대로
  옮기면 된다. 다만 이관 대상 목록이 늘었다는 것을 알아 두어야 한다. TASK-019 문서가 적은 세 describe
  (`SettingsView 연동 섹션`·`역할 잡 설치`·`모델 선택`) 외에 이 작업이 만든
  `SettingsView 역할 잡 기본값 재설정`이 더 있다. 이 describe는 `region` 셀렉터를 쓰지 않고 버튼과
  확인 그룹을 이름으로 직접 잡으므로 렌더 헬퍼만 바꾸면 그대로 옮겨진다. TASK-019 문서의 "옮겨 온
  케이스 수가 옮기기 전과 같아야 한다"를 셀 때 이 describe를 빠뜨리지 말 것.

## 후속 / 리스크

- **재설정은 조건 스크립트도 다시 쓴다.** 역할 잡 재설정이 저장과 같은 커맨드를 타기 때문이다. 확인
  화면이 그 사실을 밝히지만, "값만 되돌리는 액션"이라는 이름에 비해 쓰는 파일이 하나 많다. 새 커맨드를
  만들지 말라는 작업 문서 제약과 SPEC-002 R6의 스크립트 정합 규칙을 함께 지키면 현재 형태가 된다.
- **편집 중 재설정의 뒷맛.** 다른 잡을 편집 중인 상태에서 재설정하면 성공 직후 TASK-017의 "화면이 읽은
  뒤 관리 블록이 바뀌었습니다" 안내가 뜬다. 방금 자기가 만든 변화라 문구가 살짝 어긋나 읽힌다. 편집을
  조용히 버리는 것보다 낫다고 보고 이 쪽을 골랐다. 문구를 갈래별로 나누려면 `JobChanges`를 쓰는 세
  화면의 안내문을 함께 봐야 하는 별도 사안이다.
- **전체 재설정은 없다.** 기획서 확인 필요 2번이 잡 단위로 승인됐다. 잡 단위를 반복하면 얻을 수 있다.
- 역할 밖 발견 (수정하지 않음):
  - `heartbeat_roles.rs`·`heartbeat_status.rs` 첫머리의 `#![allow(dead_code)]` 주석
    ("커맨드 계층이 호출하면 이 줄을 지운다")이 실제와 어긋난 채 그대로다. REPORT-TASK-014~017-DEV가
    이미 적었다.
  - 작업 트리에 이 작업 이전부터 커밋되지 않은 변경(TASK-008~017 산출물)이 있다. 이 세션은 위 표의
    파일만 건드렸다.
