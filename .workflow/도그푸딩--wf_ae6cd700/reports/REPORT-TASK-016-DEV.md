# TASK-016 개발자 핸드오프

- 대상 작업: TASK-016 (쓰기 전 확인 화면을 값 나열에서 차이 표시로 전환)
- 근거 문서: SPEC-005 R4, DECISION-02EBD5DB (approved, created_by: user)
- 세션 역할: 개발자
- 작성 시각: 2026-08-02T17:20Z
- 상태: `qa_waiting`

## 대상 선정 근거

- 착수 시점 `todo`는 TASK-016~025 열 건이다. TASK-019~021은 SPEC-005 네 작업 전체를, TASK-017·018은
  이 작업이 만드는 표시 요소를 선행으로 걸고 있다. TASK-022~025(SPEC-007)는 선행이 없지만, SPEC-005의
  다음 순서가 TASK-016이고 REPORT-TASK-015-DEV가 명시적으로 이 작업을 다음으로 지목했다.
- TASK-016의 선행 필수는 TASK-014, 선행 권장은 TASK-015다. 둘 다 `qa_waiting`이다. 두 의존의 근거
  (미지정 필드가 파일 값으로 해석된다는 계약 / 못 읽은 상태에서 저장이 막힌다는 계약)는 구현이 끝난
  시점에 충족되고, 두 계약이 작업 트리에 있음을 코드로 확인했다. TASK-015도 `qa_waiting`인 TASK-014
  위에서 같은 판단으로 진행했다.
- 착수 시점에 `.workflow/.runtime/migration.lock` 없음, `leases/` 비어 있음. 배타 생성으로
  `leases/TASK-016.yml`을 만든 뒤 문서를 `in_progress`로 옮기고 시작했다.
- SPEC-005 본문은 `status: user_review`지만 앱이 기록한 승인 결정이 있으므로 공통 규칙 5절의 구현
  차단 조건에 걸리지 않는다.

## 결과

확인 화면이 쓰게 될 값만 나열하던 것을 그만두고, 잡마다 파일의 현재 값과 쓰게 될 값을 함께 보여준다.
달라지는 값은 `주기 20m → 45m — 바뀜`, 그대로인 값은 `실행 한도 8/24h — 그대로`로 낱말이 구분한다.
아무것도 달라지지 않으면 그 사실을 한 줄로 밝힌다. 관리 블록에 없던 잡은 현재 값 자리가 "없음"이고
새로 추가된다는 사실이 함께 붙는다. 앱 소유 필드를 손으로 고쳐 둔 잡은 되돌아갈 필드 이름이 보이고,
꺼서 사라지는 잡은 함께 사라질 편집값이 확인 단계에서 다시 보인다.

표시는 `integrations/JobChanges.tsx` 하나이고 두 카드가 같은 요소에 자기 잡을 넘긴다.

## 변경한 파일

| 파일 | 내용 |
| --- | --- |
| `src-tauri/src/application/heartbeat_service.rs` | `ManagedRoleJob`·`ManagedDreamJob`에 `app_owned_drift` 추가, `app_owned_fields`·`app_owned_drift` 판정, 테스트 2건 추가 |
| `src/features/projects/domain/types.ts` | 위 두 타입의 프론트 짝에 `appOwnedDrift` 추가 |
| `src/features/projects/components/integrations/JobChanges.tsx` | 신규. 잡 종류를 모르는 차이 표시 요소 |
| `src/features/projects/components/integrations/HeartbeatCard.tsx` | 확인 화면 본문을 `JobChanges`로 교체, 잡 목록 조립 |
| `src/features/projects/components/integrations/DreamCard.tsx` | 같음 |
| `src/features/projects/components/SettingsView.test.tsx` | 픽스처에 `appOwnedDrift`, 신규 테스트 5건 |
| `src/features/projects/components/integrations/DreamCard.test.tsx` | `dreamJob()` 픽스처 도입, 신규 테스트 4건, 기존 단언 1건 갱신 |
| `.workflow/…/tasks/TASK-016.md` | `todo` → `in_progress` → `qa_waiting` |
| `.workflow/…/reports/REPORT-TASK-016-DEV.md` | 신규 |
| `.workflow/.runtime/leases/TASK-016.yml` | 선점 후 반납 |

작업 문서의 범위 목록 밖은 손대지 않았다. 스타일시트도 고치지 않았다 — 새 요소가 기존
`.heartbeat-confirm ul`·`p` 규칙 안에서 중첩 목록으로 그려져 추가 규칙이 필요 없었다.

`useProjectWorkspace.test.ts`는 이번에 고치지 않아도 됐다. 그 파일의 픽스처는 `managedJobs: []`와
`managedJob: null`이라 새 필드가 타입 검사에 걸리지 않는다.

## 설계 판단

- **앱 소유 필드 대조는 백엔드가 한다.** 앱이 쓸 잡은 `role_managed_jobs`·`heartbeat_dream::dream_job`이
  만들고, 파일의 잡은 `parse_heartbeat`가 준다. 두 값을 필드 단위로 대조해 다른 이름만 모아
  `app_owned_drift`에 싣는다. 화면은 이름만 받고 값은 알지 않으므로, 잡 정의가 바뀌어도 화면이 함께
  갈라지지 않는다.
- **대조용 잡은 기본 설정으로 만든다.** 앱 소유 다섯 필드(`slug`·`prompt`·`timeout`·`condition`·
  `notify`)는 편집 가능 값과 무관하게 잡 정의에서 나온다. 편집 가능 세 필드는 대조에서 뺐다.
- **그 줄이 블록에 없는 경우도 "다름"으로 센다.** 사용자가 `- timeout:` 줄을 지웠으면 저장 후 앱 값이
  그 자리에 다시 적힌다. 결과가 값을 고쳐 뒀을 때와 같으므로 같은 이름으로 알린다. 문구를
  "앱 값으로 다시 쓰입니다"로 둔 것도 두 경우를 한 문장이 덮게 하기 위해서다.
- **표시 요소는 잡 종류를 모른다.** `JobChanges`는 `WrittenJob`·`RemovedJob` 두 모양만 받는다.
  역할·dream이라는 낱말이 이 파일에 없다. TASK-018의 기본값 재설정 확인 화면도 같은 모양을 만들어
  넘기면 된다.
- **"쓰게 될 값"은 폼 값을 그대로 쓴다.** 미지정 필드는 백엔드가 파일 값을 쓰고, 폼은 그 파일 값으로
  시드돼 있으므로 두 값이 같다. 잘못된 값은 `requestConfirm`이 확인 화면을 열기 전에 막는다.
- **dream 잡이 블록에 없는데 토글이 꺼져 있으면 제거 목록에 넣지 않는다.** 현행은 그 경우에도
  `제거: …`를 적었지만 파일은 바뀌지 않는다. 이제 "달라지는 값이 없습니다"로 나온다. R4의
  "아무 값도 달라지지 않으면 그 사실을 밝힌다"에 맞춘 결과다.
- **"활성 역할이 없어 관리 블록 전체를 제거합니다" 문구는 그대로 뒀다.** 작업 문서의 지시대로
  현행 문구를 남기고 사라지는 잡들의 값을 그 아래에 더했다.

## 완료 조건 대조

| # | 조건 | 결과 |
| --- | --- | --- |
| 1 | 잡별 현재 값·쓰게 될 값의 차이 표시 | 충족. 두 카드 각각 테스트 |
| 2 | 달라지는 것이 없으면 그 사실 표시 | 충족. 두 카드 각각 테스트 |
| 3 | 앱 소유 필드가 되돌아간다는 사실 표시 | 충족. 백엔드 판정 2건 + 화면 2건 |
| 4 | 끄는 잡의 편집값이 함께 사라진다는 사실 표시 | 충족. 두 카드 각각 테스트 |
| 5 | 같은 요소가 두 카드에서 동작 | 충족. `JobChanges.tsx` 하나를 두 카드가 쓴다 |
| 6 | 확인 절차·접근성 이름 그대로 | 충족. `역할 잡 설치 확인`·`dream 잡 설치 확인` 유지, 확인 없이 쓰는 경로 없음 |
| 7 | 같은 상태로 다시 저장하면 파일 불변 | 충족. 쓰기 경로를 건드리지 않았고 기존 멱등 테스트 통과 |
| 8 | SPEC-002·003·004 기존 테스트 전부 통과 | 충족. 삭제·비활성화 없음 |
| 9 | `npm run check`·`cargo test` 통과 | 충족 |

## 검증 단계와 결과

- `cargo test --manifest-path src-tauri/Cargo.toml` — 119 passed / 0 failed (기존 117 + 신규 2).
- `npm run check` (typecheck + vitest + vite build) — 95 passed / 0 failed (기존 86 + 신규 9), 빌드 성공.
- `cargo fmt -- --check` 차이 없음. `cargo clippy --all-targets -- -D warnings` 경고 없음(CI 동일 조건).
- 삭제하거나 비활성화한 테스트 없음. 기존 단언을 고친 것은 한 곳이다 —
  `DreamCard.test.tsx`의 `wf-dream… — 2h · 6/24h · opus`는 이번 작업이 없애기로 한 나열 형식을
  글자 그대로 고정하고 있었다. 같은 테스트에서 새 표시 형식을 단언하도록 바꿨고 케이스는 그대로 있다.
- 전역 파일 무쓰기: 세션 전후 `~/.claude/HEARTBEAT.md`의 수정 시각(`Aug 3 00:02:02`)이 그대로이고
  실사용 `max_per` 세 값(`8/24h`·`8/24h`·`16/24h`)도 그대로다. 백엔드 테스트는 전부 임시 디렉터리에서
  돈다. `.workflow/rules/wf-eligible.sh`의 수정 시각도 변화 없다.

## 사용자 QA 절차

앱을 띄워야 확인되는 항목이다. 전역 파일을 만지므로 백업부터 하고 반드시 원복한다.

```sh
cp ~/.claude/HEARTBEAT.md /tmp/HEARTBEAT.md.bak
# 1) 값을 하나도 바꾸지 않고 저장 버튼 → "관리 블록에서 달라지는 값이 없습니다"가 보여야 한다
# 2) 개발자 잡의 주기만 바꾸고 저장 버튼 → 그 줄만 "바뀜", 나머지 둘은 "그대로"여야 한다
# 3) 관리 블록 안 개발자 잡의 `- timeout: 30m`을 `- timeout: 5m`으로 손수 바꾼다
#    → 확인 화면에 "되돌아감: timeout"이 보여야 한다
# 4) 편집값이 있는 잡의 토글을 끈다 → "제거: … 주기 … · 실행 한도 … · 모델 … 값이 함께 사라집니다"
# 5) dream 카드에서 1~4를 같은 형태로 다시 확인한다
# 위 확인은 모두 "취소"로 끝낸다. 아무것도 쓰지 않는다.
diff /tmp/HEARTBEAT.md.bak ~/.claude/HEARTBEAT.md   # 비어 있어야 한다
cp /tmp/HEARTBEAT.md.bak ~/.claude/HEARTBEAT.md
```

3번은 파일을 손으로 고치는 단계다. 확인 후 백업으로 되돌리면 원래 상태가 된다.

## 다음 작업자에게

- 다음은 TASK-017(화면이 읽은 뒤 바뀐 관리 블록을 확인 없이 덮어쓰지 않는다)이다. 이 작업이 만든
  `JobChanges`를 그대로 쓸 수 있다. "파일의 현재 값"을 새로 읽은 값으로 바꿔 넘기면 같은 화면이 된다.
- TASK-018(기본값 재설정)도 같은 요소를 쓴다. 재설정 확인 화면은 `next`에 앱 기본값을 넣은
  `WrittenJob` 하나를 넘기면 된다. 표시 규칙을 다시 만들지 않는다.
- 앱 기본값이 백엔드(`heartbeat_roles.rs`, `heartbeat_dream::default_settings`)와 프론트
  (`HeartbeatCard.tsx`의 `roleJobDefaults`, `DreamCard.tsx`의 `jobDefaults`)에 각각 있는 상태는
  그대로다. TASK-018이 합치기로 되어 있다.

## 후속 / 리스크

- **관리 블록에 잡이 하나도 없는 상태에서 역할 셋을 모두 끄면** "활성 역할이 없어 관리 블록 전체를
  제거합니다"와 "달라지는 값이 없습니다"가 함께 보인다. 둘 다 사실이지만(제거할 잡이 없다) 나란히
  읽으면 어색하다. 현행 문구를 유지하라는 작업 문서 지시를 따른 결과이고, 문구 조정이 필요하면
  별도 사안이다.
- **조건 스크립트는 차이 표시 대상이 아니다.** "달라지는 값이 없습니다"는 관리 블록에 대한 말이고,
  역할 잡 저장은 조건 스크립트도 앱 버전으로 맞춘다. 그 사실은 기존 문구가 위에 그대로 적고 있다.
- **앱 소유 필드의 현재 값은 화면에 없다.** 요구가 사실 고지라 이름만 보인다. 사용자가 무엇을 고쳐
  뒀는지 보려면 파일을 직접 열어야 한다.
- 역할 밖 발견 (수정하지 않음):
  - `heartbeat_roles.rs`·`heartbeat_status.rs` 첫머리의 `#![allow(dead_code)]` 주석
    ("커맨드 계층이 호출하면 이 줄을 지운다")이 실제와 어긋난 채 그대로다. REPORT-TASK-014-DEV와
    REPORT-TASK-015-DEV가 이미 적었다.
  - 작업 트리에 이 작업 이전부터 커밋되지 않은 변경(TASK-008~015 산출물)이 있다. 이 세션은 위 표의
    파일만 건드렸다.
