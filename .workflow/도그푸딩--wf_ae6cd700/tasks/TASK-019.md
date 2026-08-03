---
schema: workflow-labs/task@1
id: TASK-019
title: 연동을 사이드바 독립 메뉴와 전용 뷰로 옮기고 설정에서 제거
status: completed
source_spec_id: SPEC-006
source_decision_id: DECISION-E8A3CB27
updated_at: 2026-08-03T02:31:08.875265+00:00
history:
  - { at: 2026-08-03T02:31:08.875265+00:00, kind: completed }
---

# 연동을 사이드바 독립 메뉴와 전용 뷰로 옮기고 설정에서 제거

SPEC-006 R1·R2·R3을 구현한다. 지금 설정 화면 카드 그리드의 마지막 항목인 연동 섹션을 사이드바의
독립 메뉴와 전용 뷰로 옮기고, 설정에는 앱 자체 설정 세 카드만 남긴다.

이 작업은 위치 이동만 한다. 카드 본문·배지·경고의 문구와 판정은 한 글자도 바꾸지 않는다. 접기·펼치기는
TASK-020, 접힘 상태 기억은 TASK-021의 몫이다.

## 의존성

- **선행 필수: TASK-015·TASK-016·TASK-017·TASK-018 (SPEC-005).** 네 작업이 모두
  `HeartbeatCard.tsx`·`DreamCard.tsx`·`SettingsView.test.tsx`를 만진다. 이 작업은 그 테스트 파일의
  연동 부분을 통째로 새 파일로 옮기므로, 먼저 실행하면 SPEC-005 작업 문서가 적어 둔 파일 경로와 줄
  참조가 전부 어긋난다. SPEC-005가 끝난 뒤 그 결과를 그대로 옮기는 것이 순서다.
- 후속: TASK-020이 이 작업이 만든 뷰 위에서 동작한다.
- TASK-020·TASK-021과 병행 금지. 같은 파일을 만진다.

## 범위

- `src/features/projects/components/integrations/IntegrationSection.tsx` — 전용 뷰로 이름과 형태를
  바꾼다(아래 1절).
- `src/features/projects/components/WorkspaceShell.tsx` — 뷰 상태·이름 목록·사이드바 항목·렌더 분기.
- `src/features/projects/components/SettingsView.tsx` — 연동 섹션과 관련 props 제거, 설명 문구 수정.
- `src/features/projects/components/SettingsView.test.tsx` — 연동 시나리오 이관, 부재 확인 추가.
- `src/features/projects/components/integrations/IntegrationsView.test.tsx` — 신규. 이관받는다.
- `src/features/projects/components/WorkspaceShell.test.tsx` — 메뉴·뷰 전환 확인 추가.
- `src/App.css` — 뷰로 옮기면서 필요한 최소 스타일.
- 그 외 파일은 건드리지 않는다. 특히 `src/App.tsx`와
  `src/features/projects/application/useProjectWorkspace.ts`는 바뀌지 않는다(아래 참고 사실).

## 작업 내용

### 0. 먼저 읽을 제약

- 이동은 위치 변경이다. `HeartbeatCard.tsx`·`DreamCard.tsx`의 본문은 고치지 않는다. 두 파일을 열어야
  한다면 그 이유를 보고서에 적는다.
- 화면 진입은 읽기다. 뷰를 여는 동작이 `~/.claude/HEARTBEAT.md`를 비롯한 전역 파일을 쓰지 않는다
  (SPEC-002 R6, SPEC-006 R2).
- 연동 목록은 고정 배열 `registry`(`registry.ts:11`) 순회로 그린다. 뷰가 `heartbeat`·`dream`이라는
  이름을 알아서는 안 된다. 새 연동이 배열에 늘어도 뷰 파일은 고치지 않는 현행 구조를 유지한다.
- 플랫폼 미지원 경고는 카드마다 반복하지 않고 뷰 공통 위치에서 한 번만 그린다. 현행 섹션 정책
  (`IntegrationSection.tsx:32`)을 그대로 옮긴다.
- `writeError`는 자기 연동 카드에만 내려간다(`IntegrationSection.tsx:45`). 이 격리 조건을 유지한다.

### 1. 섹션을 전용 뷰로 옮긴다 (R2)

- `IntegrationSection.tsx`를 `IntegrationsView.tsx`로 옮기고 컴포넌트 이름을 `IntegrationsView`로
  바꾼다. props 시그니처(`snapshot`·`error`·`writeError`·`actions`)와 registry 순회, 미지원 경고 위치,
  `writeError` 분배는 그대로 둔다.
- 겉모양은 설정 카드 하나가 아니라 화면이 된다. 다른 뷰(`SettingsView`, `HelpView`)와 같은 층으로
  맞춘다: `view-heading`에 눈썹 문구·제목·설명을 두고 그 아래 카드 목록을 둔다. 현행 섹션 헤더의
  설명 문구("앱에 내장된 연동만 표시합니다. 외부 연동을 추가로 등록하지 않습니다.")는 뷰 설명으로
  옮겨 그대로 쓴다.
- 카드 하나하나(`.integration-item`)의 마크업과 클래스는 바꾸지 않는다. 접근성 이름도 그대로다
  (`article`의 `aria-label`이 연동 이름).
- 뷰 컨테이너의 접근성 이름은 "연동"을 유지한다. 이관되는 테스트가 `getByRole("region", { name: "연동" })`
  으로 화면 전체를 잡고 있으므로, 그 셀렉터가 그대로 동작하는 것이 문구 무변경의 증거다.
- 파일이 이동하므로 `IntegrationCardProps`·`IntegrationDefinition`을 두는 `IntegrationCard.tsx`와
  `registry.ts`의 위치는 바꾸지 않는다. import 경로만 맞춘다.

### 2. 사이드바 메뉴와 뷰 전환 (R1)

- `WorkspaceShell.tsx`의 `view` 상태 유니언과 `viewLabels`(`:65`)에 `integrations` 항목을 더한다.
  화면 이름은 "연동"이다. `viewLabels`에 빠지면 breadcrumb의 마지막 칸이 빈다.
- 사이드바 항목은 `sidebar-footer`(`:251`)의 도움말·설정과 같은 묶음에 둔다. 근거는 R1이 적은 소속이다.
  주요 메뉴 다섯은 선택된 워크플로우의 문서 단계를 보여주고, 연동은 워크플로우와 무관하다.
  버튼 형태는 옆의 두 항목과 같게 `settings-link` 클래스와 `active` 처리를 쓴다.
- 아이콘은 `spark`를 쓴다. 현행 연동 섹션 헤더가 쓰던 아이콘이고(`IntegrationSection.tsx:27`), 이 작업은
  보이던 것을 옮기는 일이다. 주요 메뉴의 "오늘"이 같은 아이콘을 쓰지만 두 항목은 다른 묶음에 있고,
  아이콘을 새로 만드는 것은 이 기획서의 범위가 아니다.
- 렌더 분기는 `{view === "integrations" && <IntegrationsView ... />}` 하나다. `workflow` 조건을 걸지
  않는다. 워크플로우가 없거나 전환되어도 연동 뷰는 그대로 동작해야 한다(R1, 기획서 완료 조건 7).
- `WorkspaceShell`이 이미 받고 있는 `integrations`·`integrationActions`를 `SettingsView` 대신 새 뷰로
  넘긴다. `Props`는 바뀌지 않는다.

### 3. 설정에서 제거 (R3)

- `SettingsView.tsx`에서 `IntegrationSection` 렌더와 `integrations`·`integrationActions` props를
  제거한다. 쓰지 않게 된 import도 함께 지운다.
- 화면 설명 문구를 남은 내용에 맞게 고친다. 현행 문구는 "앱 업데이트와 현재 프로젝트의 연결 상태를
  관리합니다."(`SettingsView.tsx:40`)다. 이 문장 자체는 연동을 가리키지 않지만, 남은 세 카드(앱 업데이트·
  현재 프로젝트·파일 감시)를 정확히 가리키는지 다시 읽고 어긋나면 고친다. 화면에 없는 것을 설명하는
  문장이 남아서는 안 된다.
- 설정 화면에 "연동은 전용 메뉴로 이동했습니다" 같은 안내를 남기지 않는다(기획서 제외 범위).
- `.integration-card { grid-column: 1 / -1; }`(`App.css:581`)와 반응형 대응(`:637`)은 설정 그리드
  전용 규칙이다. 연동 카드가 그리드에서 빠지므로 이 규칙들이 어떻게 되는지 확인하고, 이 작업 때문에
  쓰이지 않게 된 것만 정리한다. 원래부터 쓰이지 않던 규칙은 건드리지 않는다.

### 4. 테스트 이관

- `SettingsView.test.tsx`의 세 `describe`("SettingsView 연동 섹션", "SettingsView 역할 잡 설치",
  "SettingsView 모델 선택")를 `IntegrationsView.test.tsx`로 옮긴다. 단언은 바꾸지 않는다. 렌더 헬퍼가
  `SettingsView` 대신 `IntegrationsView`를 렌더하도록만 바꾼다. 케이스를 지우거나 건너뛰지 않는다.
  옮겨 온 케이스 수가 옮기기 전과 같아야 한다.
- `SettingsView.test.tsx`에는 남은 세 카드의 확인과, 연동 카드가 없다는 확인을 둔다
  (기획서 완료 조건 2). `queryByRole("article")`이 비어 있고 "연동" 이름의 영역이 없음을 본다.
- `WorkspaceShell.test.tsx`에 메뉴 확인을 더한다: 사이드바의 "연동"을 누르면 연동 뷰가 열리고 선택
  상태가 표시된다. 기존 "opens a working settings view" 케이스는 설정 화면에서 연동이 사라진 뒤에도
  통과해야 한다.
- 워크플로우 무관 확인(기획서 완료 조건 7): 워크플로우가 둘인 프로젝트에서 연동 뷰를 연 뒤 워크플로우를
  전환해도 뷰 내용이 같음을 보는 케이스를 둔다.

## 완료 조건

1. 사이드바에 "연동" 항목이 있고, 누르면 연동 전용 뷰가 열리며 선택 상태가 표시된다.
   (기획서 완료 조건 1)
2. breadcrumb의 화면 이름이 "연동"으로 나온다. 빈 칸이나 다른 화면 이름이 아니다. (R1)
3. 설정 화면에 연동 카드가 없고 앱 업데이트·현재 프로젝트·파일 감시 세 카드는 그대로 있다. 이를 확인하는
   자동화 테스트가 있다. (기획서 완료 조건 2)
4. 설정 화면의 설명 문구가 연동을 가리키지 않는다. (기획서 완료 조건 3)
5. 설정 화면에서 연동 관련 조작을 할 수 없다. 같은 조작이 두 화면에 중복 존재하지 않는다. (R3)
6. 하트비트·드림 카드의 본문·배지·설치 안내·중복 잡 경고·읽기 실패 목록·저장 실패 표시가 이동 전과
   같은 문구와 판정으로 동작한다. 이관된 테스트가 단언 변경 없이 통과한다. (기획서 완료 조건 4)
7. 플랫폼 미지원 경고가 뷰에서 한 번만 표시된다. (기획서 완료 조건 5)
8. 한 연동의 저장 실패 문구가 다른 연동 카드에 나타나지 않는다. (기획서 완료 조건 6)
9. 워크플로우를 전환해도 연동 뷰의 내용이 바뀌지 않는다. (기획서 완료 조건 7)
10. 연동 뷰를 열어도 `~/.claude/HEARTBEAT.md`가 변경되지 않는다. (R2, SPEC-002 R6)
11. `npm run check`가 통과한다. (기획서 완료 조건 16)

## 검증 절차

```sh
npm run check
```

전역 파일이 조회로 바뀌지 않는지 실제로 확인한다.

```sh
md5 ~/.claude/HEARTBEAT.md
# 앱을 열고 사이드바 "연동"을 눌러 뷰를 연다. 다른 화면을 다녀와 다시 연다.
md5 ~/.claude/HEARTBEAT.md   # 위와 같아야 한다
```

화면에서 확인한다.

- 사이드바 하단에 "연동"이 있고 누르면 선택 표시가 바뀐다. breadcrumb 마지막 칸이 "연동"이다.
- 설정 화면에 연동 카드가 없고 세 카드가 남아 있다.
- 워크플로우가 둘 이상인 프로젝트에서 연동 뷰를 연 채 워크플로우를 바꿔도 내용이 같다.

## 범위 밖

- 카드 접기·펼치기와 접힘 요약. TASK-020이 한다.
- 접힘 상태 기억. TASK-021이 한다.
- 카드 본문의 내용·문구, 배지 판정 규칙, 경고 판정 규칙 변경.
- 연동 추가·삭제·비활성화, 외부 연동 등록. `registry`는 고정 배열로 남는다.
- 뷰 상태의 URL 반영, 앱 재시작 후 마지막 화면 복원.
- breadcrumb 구조 개선. 설정·도움말이 워크플로우 이름을 함께 보여주는 현행 표시는 대상이 아니다.
- 아이콘 신규 추가.
- 설정 화면에 이동 안내 문구 남기기.

## 참고 사실

확인 시점 2026-08-02. 추정 없이 실측한 값이다.

- `SettingsView`는 설정 카드 그리드의 마지막 항목으로 `IntegrationSection`을 렌더한다
  (`SettingsView.tsx:82`). 그 앞은 앱 업데이트(`:45`)·현재 프로젝트(`:53`)·파일 감시(`:67`) 세 카드다.
- `IntegrationSection`은 `<section aria-label="연동" className="settings-card integration-card">`이고
  (`IntegrationSection.tsx:25`), 미지원 경고를 `:32`에서 한 번 그린 뒤 `:39`에서 registry를 순회한다.
- `WorkspaceShell`의 뷰 상태는 `:97`, 이름 목록은 `:65`, breadcrumb 사용처는 `:261`,
  사이드바 하단 묶음은 `:251`, 설정 렌더는 `:383`이다.
- `App.tsx:53`이 `workspace.integrations`를, `:54`가 `workspace.integrationActions`를 `WorkspaceShell`에
  넘긴다. 상태는 `useProjectWorkspace.ts:32`에 있다. 이 배선은 이 작업에서 바뀌지 않는다.
- 이관 대상 테스트는 `SettingsView.test.tsx`의 `:117`, `:261`, `:442` 세 `describe`다. 세 곳 모두
  `getByRole("region", { name: "연동" })`으로 화면을 잡는다.
- `WorkspaceShell.test.tsx:235`의 "opens a working settings view"는 설정 화면에서 프로젝트 경로와
  파일 감시 문구를 확인한다. 연동을 확인하지 않으므로 이 케이스는 그대로 통과해야 한다.
- 뷰 공통 스타일은 `.settings-view`·`.view-heading`이고, 연동 카드 스타일은 `App.css:581`~`:593`이다.
