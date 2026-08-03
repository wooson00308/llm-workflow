# TASK-019 개발자 핸드오프

- 대상 작업: TASK-019 (연동을 사이드바 독립 메뉴와 전용 뷰로 옮기고 설정에서 제거)
- 근거 문서: SPEC-006 R1·R2·R3, DECISION-E8A3CB27 (approved, created_by: user)
- 세션 역할: 개발자
- 작성 시각: 2026-08-02T20:10Z
- 상태: `qa_waiting`

## 대상 선정 근거

- 착수 시점 `todo`는 TASK-019·020·021·023·024·025·027 일곱 건이다. TASK-020은 TASK-019를,
  TASK-021은 TASK-020을 선행 필수로 건다. TASK-024·025는 아직 `todo`인 TASK-023에 걸린다.
  의존이 풀린 것은 TASK-019·023·027 셋이고 그중 가장 낮은 번호를 골랐다.
- TASK-019의 선행 필수 TASK-015·016·017·018은 모두 `qa_waiting`이다. 네 작업이 만든 결과
  (`JobChanges.tsx`, 관리 블록 읽기 실패 표시, 파일 변화 안내, 잡별 기본값 재설정)가 코드에 있음을
  확인했다. REPORT-TASK-018-DEV도 다음을 TASK-019로 지목해 두었다.
- 착수 시점에 `.workflow/.runtime/migration.lock` 없음, `leases/` 비어 있음. 배타 생성으로
  `leases/TASK-019.yml`을 만든 뒤 문서를 `in_progress`로 옮기고 시작했다.
- 반려 QA 없음. `decisions/`의 `qa-decision@1` 중 TASK-019를 가리키는 것은 없다.
- SPEC-006 본문은 `status: user_review`지만 앱이 기록한 승인 결정이 있으므로 공통 규칙 5절의 구현
  차단 조건에 걸리지 않는다.

## 결과

연동이 설정 화면의 마지막 카드에서 사이드바의 독립 메뉴와 전용 뷰로 나왔다. 위치만 옮겼고 카드
본문·배지·경고의 문구와 판정은 한 글자도 바뀌지 않았다.

**섹션이 뷰가 됐다.** `IntegrationSection.tsx`를 `IntegrationsView.tsx`로 옮기고 컴포넌트 이름을
바꿨다(`git mv`로 이력 유지). props 시그니처, registry 순회, 미지원 경고 위치, `writeError` 분배는
그대로다. 겉모양만 설정 카드 하나에서 화면으로 올라갔다 — 아이콘이 붙은 `.settings-card > header`
대신 `SettingsView`·`HelpView`와 같은 `view-heading`을 쓰고, 그 아래 카드 목록을 둔다. 섹션 헤더의
설명 문구는 뷰 설명으로 그대로 옮겼다. 접근성 이름 "연동"과 카드 마크업(`.integration-item`,
`article`의 `aria-label`)은 손대지 않았다.

**사이드바에 메뉴가 생겼다.** `sidebar-footer`의 도움말·설정과 같은 묶음에 `settings-link` 형태로
두었다. 렌더 분기에 `workflow` 조건을 걸지 않아 워크플로우가 없거나 전환되어도 뷰가 그대로 동작한다.
`viewLabels`에 `integrations: "연동"`을 더해 breadcrumb 마지막 칸이 채워진다. `WorkspaceShell`이 이미
받고 있던 `integrations`·`integrationActions`를 `SettingsView` 대신 새 뷰로 넘긴다. `Props`는 무변경.

**설정에서 빠졌다.** `SettingsView`는 이제 `project`·`updater`·`onSwitchProject` 셋만 받는다.
연동 관련 props와 import를 지웠다. 화면 설명은 남은 세 카드를 가리키도록 한 단어만 고쳤다.

`HeartbeatCard.tsx`·`DreamCard.tsx`·`IntegrationCard.tsx`·`registry.ts`·`JobChanges.tsx`는 열어
읽기만 하고 고치지 않았다. `src/App.tsx`와 `useProjectWorkspace.ts`도 무변경이다.

## 변경한 파일

| 파일 | 내용 |
| --- | --- |
| `src/features/projects/components/integrations/IntegrationsView.tsx` | `IntegrationSection.tsx`에서 이름 변경(`git mv`). 헤더를 `view-heading`으로, 카드 목록을 `.integration-list`로 |
| `src/features/projects/components/integrations/IntegrationsView.test.tsx` | 신규. `SettingsView.test.tsx`의 연동 케이스 58건 전부 이관 |
| `src/features/projects/components/WorkspaceShell.tsx` | 뷰 상태 유니언·`viewLabels`·사이드바 항목·렌더 분기 |
| `src/features/projects/components/WorkspaceShell.test.tsx` | 메뉴·뷰 전환 1건, 워크플로우 무관 1건 추가 |
| `src/features/projects/components/SettingsView.tsx` | 연동 섹션·props·import 제거, 설명 문구 수정 |
| `src/features/projects/components/SettingsView.test.tsx` | 연동 케이스 이관 후 남은 세 카드 확인과 부재 확인 3건으로 재작성 |
| `src/App.css` | `.integration-list` 추가, 뷰 상단 경고 여백, 셀렉터가 죽은 규칙 3곳 정리 |
| `.workflow/…/tasks/TASK-019.md` | `todo` → `in_progress` → `qa_waiting` |
| `.workflow/…/reports/REPORT-TASK-019-DEV.md` | 신규 |
| `.workflow/.runtime/leases/TASK-019.yml` | 선점 후 반납 |

작업 문서의 범위 목록 밖은 손대지 않았다.

## 설계 판단

- **뷰 컨테이너는 `<section aria-label="연동">`을 유지했다.** 이관되는 테스트 58건 중 다수가
  `getByRole("region", { name: "연동" })`으로 화면 전체를 잡는다. 이 셀렉터가 단언 변경 없이 그대로
  동작하는 것이 "문구가 안 바뀌었다"의 증거다.
- **카드 목록에 `.integration-list` 컨테이너를 뒀다.** 섹션 시절 카드 간격은 `.integration-item`의
  `margin-top: 13px`이 만들었고, 그 값은 `.settings-card`의 안쪽 여백을 전제로 한 값이다. 뷰에서는
  `view-heading` 바로 아래에 첫 카드가 오므로 화면 층의 여백(24px)이 따로 필요하다. `grid` + `gap`
  컨테이너 하나로 두 여백을 분리했고, `.integration-item`의 원래 규칙은 그대로 뒀다
  (`.integration-list > .integration-item { margin-top: 0 }`으로 컨테이너 안에서만 무효화).
- **아이콘은 `spark`를 그대로 썼다.** 현행 연동 섹션 헤더의 아이콘이고 이 작업은 보이던 것을 옮기는
  일이다. 주요 메뉴의 "오늘"이 같은 아이콘을 쓰지만 다른 묶음이고, 아이콘 신규 추가는 범위 밖이다.
- **메뉴 순서는 연동 · 도움말 · 설정이다.** 기획서가 정한 것은 "하단 묶음"까지이고 묶음 안 순서는
  정하지 않았다. 도움말·설정이 앱의 종착 항목으로 읽히므로 그 앞에 두었다.
- **설정 화면 설명 문구는 한 단어만 고쳤다.** 현행 문구("앱 업데이트와 현재 프로젝트의 연결 상태를
  관리합니다")는 원래 연동을 가리키지 않아 R3의 금지 조건에는 걸리지 않았다. 다만 남은 세 카드 중
  파일 감시를 가리키는 말이 없어 "연결 상태"를 "연결·감시 상태"로 바꿨다. 문장 구조는 그대로다.
- **`SettingsView.test.tsx`는 재작성했다.** 이 파일의 케이스 58건이 전부 연동 시나리오였다. 남은 것이
  없어 픽스처와 헬퍼도 함께 이관 대상이 됐고, 설정 화면 자신을 검사하는 케이스 3건을 새로 썼다.

## 이관 대조

`SettingsView.test.tsx`에 있던 케이스 58건이 `IntegrationsView.test.tsx`에 58건 그대로 있다.
지우거나 건너뛴 케이스 없음. 작업 문서가 적은 세 `describe` 외에 TASK-015·017·018이 만든
`관리 블록 읽기 실패`·`관리 블록 변화`·`역할 잡 기본값 재설정` 셋이 더 있었고(REPORT-TASK-018-DEV의
경고대로다) 전부 옮겼다. `describe` 이름의 `SettingsView` 접두사와 렌더 헬퍼(`renderSettings` →
`renderIntegrations`, `renderPolling`의 렌더 대상)만 바꿨다.

단언을 고친 곳은 한 줄이다. `keeps a failed status read inside the card`의 마지막 줄
`expect(screen.getByText("workflow-labs"))`는 "연동 조회가 실패해도 설정 화면의 나머지가 산다"를
프로젝트 이름 카드로 확인하던 단언이다. 전용 뷰에는 그 카드가 없다. 같은 뜻을 뷰 자신의 제목으로
확인하도록 `getByRole("heading", { name: "연동" })`으로 바꿨다. 나머지 57건의 단언은 무변경이다.

새 단언을 하나 더했다. 미지원 경고 케이스에 `getAllByText(...).toHaveLength(1)`을 붙였다. 기존
단언은 "경고가 있다"까지만 봤고 완료 조건 7이 요구하는 "한 번만"은 보지 않았다. 기존 단언은 그대로
두고 한 줄을 더한 것이다.

## 완료 조건 대조

| # | 조건 | 결과 |
| --- | --- | --- |
| 1 | 사이드바 "연동" 항목, 전용 뷰 열림, 선택 상태 표시 | 충족. `WorkspaceShell.test.tsx`의 `opens the integrations view from its own sidebar menu` |
| 2 | breadcrumb 화면 이름이 "연동" | 충족. 같은 케이스가 `.breadcrumbs` 내용을 확인 |
| 3 | 설정에 연동 카드 없고 세 카드는 그대로, 자동화 테스트 있음 | 충족. `SettingsView.test.tsx` 2건 |
| 4 | 설정 설명 문구가 연동을 가리키지 않음 | 충족. `describes only what the screen still shows` |
| 5 | 설정에서 연동 조작 불가, 중복 없음 | 충족. `no longer holds the integrations section`이 `article`·설치 버튼 부재 확인 |
| 6 | 카드 본문·배지·경고가 이동 전과 같은 문구·판정, 이관 테스트가 단언 변경 없이 통과 | 충족. 58건 통과. 단언 변경은 위 "이관 대조"의 한 줄뿐 |
| 7 | 미지원 경고가 뷰에서 한 번만 | 충족. 새로 더한 개수 단언 |
| 8 | 저장 실패 문구가 다른 카드에 안 나타남 | 충족. `shows a failed write only in the card that asked for it` |
| 9 | 워크플로우 전환해도 뷰 내용 불변 | 충족. `keeps the integrations view unchanged across workflow switches` |
| 10 | 뷰를 열어도 `~/.claude/HEARTBEAT.md` 불변 | 코드 수준 충족. 아래 검증 참고. GUI 확인은 사용자 QA |
| 11 | `npm run check` 통과 | 충족 |

## 검증 단계와 결과

- `npm run check` (typecheck + vitest + vite build) — 12 파일 136 passed / 0 failed, 빌드 성공.
  이전 131건 대비 +5는 `SettingsView.test.tsx` 신규 3건, `WorkspaceShell.test.tsx` 신규 2건이다
  (연동 58건은 파일만 옮겨 총계에 변화 없음).
- 삭제하거나 비활성화한 테스트 없음.
- 전역 파일 무쓰기(완료 조건 10): 연동 뷰와 두 카드의 렌더 경로에 쓰기 호출이 없음을 확인했다.
  `actions.installHeartbeatJobs`·`installDreamJob`은 `HeartbeatCard`의 `write()`/`writeReset()`,
  `DreamCard`의 `write()`/`writeReset()` 안에서만 불리고 넷 다 확인 버튼 핸들러가 진입점이다.
  `useEffect`에서 부르는 경로는 없다. 이관된 `does not write before the confirmation step` 2건이
  같은 사실을 고정한다. 실제 파일 해시(`shasum ~/.claude/HEARTBEAT.md`)도 세션 전후로
  `d7d3cb524cb0588aa44fb24553c75617ac0ffe20`로 같다.
- 작업 문서의 수동 검증 절차(앱을 띄워 메뉴를 누르고 md5를 대조하는 절차)는 실행하지 않았다. GUI가
  필요하다. 아래 사용자 QA로 넘긴다.

## 사용자 QA 절차

앱을 띄워야 확인되는 항목이다. 이 절차는 파일을 쓰지 않는다.

```sh
shasum ~/.claude/HEARTBEAT.md   # d7d3cb52...
# 1) 사이드바 하단에 "연동"이 있는지 본다. 누르면 선택 표시가 바뀌고 전용 뷰가 열린다.
#    breadcrumb 마지막 칸이 "연동"이다.
# 2) 다른 화면(설정·오늘)을 다녀와 다시 연동을 연다.
shasum ~/.claude/HEARTBEAT.md   # 위와 같아야 한다
```

화면에서 이어서 본다.

```
# 3) 설정 화면에 연동 카드가 없고 앱 업데이트·현재 프로젝트·파일 감시 세 카드가 남았는지 본다.
# 4) 하트비트·드림 카드의 배지 문구, 잡 폼, 경고 표시가 이동 전과 같은지 본다.
#    (이 저장소는 하트비트 설치·데몬 실행 중이므로 "설치됨 · 데몬 실행 중"이 보인다)
# 5) 워크플로우가 둘 이상인 프로젝트에서 연동 뷰를 연 채 워크플로우를 바꿔 내용이 같은지 본다.
#    이 저장소는 워크플로우가 하나라 확인하려면 워크플로우를 하나 더 만들어야 한다.
```

## 다음 작업자에게

- 다음은 TASK-020(연동 카드 접기·펼치기 토글과 접힘 요약)이다. 이 작업이 만든
  `IntegrationsView.tsx`와 `IntegrationsView.test.tsx` 위에서 동작한다. TASK-021이 그 뒤다.
- TASK-020·021은 `IntegrationCard.tsx`를 만지게 된다. 이 작업은 그 파일을 읽기만 했다.
- 이관된 테스트 58건은 카드가 항상 펼쳐진 상태를 전제로 폼 요소를 이름으로 직접 잡는다. TASK-020이
  기본값을 접힘으로 바꾸면 그 58건이 전부 영향을 받는다. TASK-020 문서가 이 점을 어떻게 처리하라고
  적었는지 착수 전에 확인할 것.

## 후속 / 리스크

- **연동 뷰는 `key`가 없다.** 다른 뷰로 나갔다가 돌아오면 카드가 다시 마운트되어 저장하지 않은 폼
  값이 초기화된다. 섹션 시절과 같은 동작이고, SPEC-006 R7도 "다른 화면에 갔다가 돌아왔을 때의 폼
  초기화 동작은 현행과 같아도 된다"고 명시한다. R7이 막는 것은 같은 화면 안에서 접기 때문에 값이
  사라지는 경우이고 그것은 TASK-020의 몫이다.
- **뷰 상태는 앱을 다시 열면 초기값(오늘)으로 돌아간다.** 현행 동작이고 기획서 제외 범위다.
- 역할 밖 발견 (수정하지 않음):
  - `docs/development-logs/2026-08-02.md:398`이 `integrations/IntegrationSection.tsx`를 이름으로
    가리킨다. 지난 세션의 기록이라 그대로 뒀다.
  - 작업 트리에 이 작업 이전부터 커밋되지 않은 변경(TASK-008~018·022·026 산출물)이 있다. 이 세션은
    위 표의 파일만 건드렸다.
