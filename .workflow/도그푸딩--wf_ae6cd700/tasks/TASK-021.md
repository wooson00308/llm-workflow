---
schema: workflow-labs/task@1
id: TASK-021
title: 연동 카드의 접힘 상태를 연동 단위로 기억한다
status: completed
source_spec_id: SPEC-006
source_decision_id: DECISION-E8A3CB27
updated_at: 2026-08-03T02:31:13.587530+00:00
history:
  - { at: 2026-08-03T02:31:13.587530+00:00, kind: completed }
---

# 연동 카드의 접힘 상태를 연동 단위로 기억한다

SPEC-006 R6을 구현한다. TASK-020이 만든 화면 안의 펼침 상태를 브라우저 저장소에 남겨, 다른 화면을
다녀오거나 앱을 다시 열어도 유지되게 한다.

기본값은 접힘이고, 저장된 값을 읽지 못하거나 형식이 깨졌으면 기본값으로 동작한다. 화면이 뜨지 않거나
사용자에게 오류를 보여서는 안 된다.

## 의존성

- **선행 필수: TASK-020.** 이 작업은 그 작업이 만든 펼침 상태의 초기값과 변경 시점에만 손댄다.
- TASK-019·TASK-020과 병행 금지. 같은 파일을 만진다.

## 범위

- `src/features/projects/infrastructure/browserIntegrationCollapseStore.ts` — 신규. 읽기·쓰기와
  형식 검사.
- `src/features/projects/components/integrations/IntegrationsView.tsx` — 상태 초기값과 저장 호출.
- `src/features/projects/infrastructure/browserIntegrationCollapseStore.test.ts` — 신규.
- `src/features/projects/components/integrations/IntegrationsView.test.tsx` — 복원·손상 대응 케이스.
- 그 외 파일은 건드리지 않는다. 특히 `IntegrationCard.tsx`·`HeartbeatCard.tsx`·`DreamCard.tsx`는
  바뀌지 않는다. 저장은 뷰의 관심사다.

## 작업 내용

### 0. 먼저 읽을 제약

- 저장소 접근은 반드시 실패를 삼킨다. `localStorage`는 접근 자체가 던질 수 있다. 기존 선례가 그렇게
  하고 있다(`browserRecentProjectStore.ts:11`의 `try/catch`,
  `DevelopmentBoard.tsx:158`·`:167`의 `loadQaPanelWidth`·`saveQaPanelWidth`). 같은 형태를 따른다.
- 저장하는 것은 화면 표시 상태뿐이다. 이 작업은 어떤 파일도 쓰지 않고 어떤 커맨드도 부르지 않는다.
- 기억은 연동 단위다. 한 연동을 펼쳐 두었다고 다른 연동이 함께 펼쳐지지 않는다(R6).

### 1. 저장소 모듈

- 키는 다른 저장 항목과 겹치지 않는 이름 하나를 쓰고 버전을 붙인다. 기존 두 키가 서로 다른 접두사를
  쓰고 있다(`workflow-labs.recent-projects.v1`, `llm-workflow.task-qa-panel-width`). 새 키는
  `browserRecentProjectStore.ts`와 같은 `workflow-labs.` 접두사를 따른다. 인프라 모듈의 선례가 그쪽이다.
- 저장 형태는 연동 id를 키로 하는 펼침 여부 맵이다. 값 하나가 통째로 들어가고 나온다.
- 읽기는 다음을 전부 기본값(빈 맵)으로 돌린다: 값 없음, JSON 파싱 실패, 객체가 아님,
  `localStorage` 접근 실패. 던지지 않는다.
- 개별 항목도 검사한다. 값이 boolean이 아닌 항목은 버리고 나머지는 살린다. 한 항목이 깨졌다고 전체를
  버리지 않는다.
- 저장된 값이 지금 없는 연동 id를 가리켜도 그대로 둔다. 뷰는 registry에 있는 id만 찾아 쓰므로 남은
  항목은 화면에 영향을 주지 않는다. 삭제하는 정리 로직을 넣지 않는다 — 연동이 잠시 빠졌다가 돌아오는
  경우에 사용자의 선택을 지우게 된다.
- 쓰기도 실패를 삼킨다. 저장에 실패해도 화면의 펼침 동작은 그대로 동작해야 한다.

### 2. 뷰 배선

- TASK-020이 만든 `useState`의 초기값을 저장소 읽기로 바꾼다. 게으른 초기화(`useState(() => load())`)를
  써서 렌더마다 읽지 않는다.
- 토글이 상태를 바꿀 때 저장한다. `useEffect`로 상태 전체를 따라 쓰는 방식이든 토글 콜백 안에서
  쓰는 방식이든 상관없지만, 첫 마운트에서 읽은 값을 그대로 되쓰는 낭비가 없는 쪽을 고른다.
- 뷰를 벗어났다 돌아오면(`view` 전환으로 언마운트·재마운트) 저장된 값으로 다시 시작한다. 이것이
  "다른 화면에 갔다 와도 유지된다"의 구현이다. 앱 재시작도 같은 경로다.
- registry에 없는 id는 무시하고, registry에 있는데 저장된 값이 없는 id는 접힘으로 본다.

### 3. 테스트

저장소 모듈:

- 저장 후 읽으면 같은 맵이 나온다.
- 값이 없으면 빈 맵이다.
- JSON이 아닌 문자열, 배열, `null`, 숫자에서 각각 빈 맵이 나오고 던지지 않는다.
- boolean이 아닌 값을 가진 항목은 버려지고 같은 맵의 정상 항목은 남는다.
- `localStorage` 접근이 던지는 환경에서 읽기·쓰기 모두 던지지 않는다.
  (`DevelopmentBoard.test.tsx:161`의 `vi.stubGlobal("localStorage", ...)` 방식을 따른다.)

뷰:

- 저장된 값이 없으면 두 카드가 접힌 채로 시작한다. (기획서 완료 조건 12)
- 한 카드를 펼치고 언마운트한 뒤 다시 렌더하면 그 카드만 펼쳐져 있다. (기획서 완료 조건 13)
- 손상된 값(파싱 실패)이 저장된 상태에서 뷰가 정상적으로 그려지고 두 카드가 접혀 있다. 오류 문구가
  화면에 나타나지 않는다. (기획서 완료 조건 14)
- 지금 없는 연동 id만 담긴 값이 저장된 상태에서 뷰가 정상 동작하고, 있는 두 연동은 접혀 있다.
  (기획서 완료 조건 14)

## 완료 조건

1. 저장된 상태가 없는 환경에서 뷰를 처음 열면 모든 카드가 접혀 있다. (기획서 완료 조건 12)
2. 펼치거나 접은 상태가 다른 화면을 다녀오거나 앱을 다시 연 뒤에도 유지된다. (기획서 완료 조건 13)
3. 저장된 값이 손상됐거나 없는 연동을 가리켜도 화면이 정상 동작하고 기본값(접힘)으로 시작한다.
   사용자에게 오류가 보이지 않는다. (기획서 완료 조건 14)
4. 기억이 연동 단위다. 한 연동을 펼쳐도 다른 연동은 접힌 채로 남는다. (R6)
5. `localStorage` 접근이 실패하는 환경에서도 뷰가 그려지고 토글이 동작한다.
6. TASK-020의 완료 조건이 그대로 성립한다. 접었다 펴서 폼 값이 남는 동작이 유지된다.
7. `npm run check`가 통과한다. (기획서 완료 조건 16)

## 검증 절차

```sh
npm run check
```

화면에서 확인한다.

- 연동 뷰를 처음 열면 두 카드가 접혀 있다. 하나를 펼치고 설정 화면에 갔다 돌아오면 그 카드만 펼쳐져 있다.
- 앱을 종료하고 다시 열어도 같다.
- 개발자 도구에서 저장된 값을 깨뜨린 뒤 뷰를 다시 연다. 화면이 정상적으로 뜨고 두 카드가 접혀 있다.

```js
// 개발자 도구 콘솔. 키 이름은 구현에서 정한 값으로 바꾼다.
localStorage.setItem("workflow-labs.integration-collapse.v1", "{not json");
localStorage.setItem("workflow-labs.integration-collapse.v1", '{"gone-integration":true}');
```

## 범위 밖

- 뷰 상태(어느 화면을 보고 있었는지)의 복원. 기획서 제외 범위다.
- 접힘 상태를 파일이나 백엔드에 저장하는 것. 브라우저 저장소면 충분하다.
- 저장 실패를 사용자에게 알리는 UI. 표시 상태라 알릴 가치가 없다.
- 저장된 값의 정리·마이그레이션 기능.
- 전체 펼치기/접기 같은 일괄 조작.

## 참고 사실

확인 시점 2026-08-02. 추정 없이 실측한 값이다.

- 브라우저 저장소 선례는 둘이다. `browserRecentProjectStore.ts`(키 `workflow-labs.recent-projects.v1`,
  `:7`)는 읽기를 `try/catch`로 감싸고 배열이 아니면 빈 배열을 돌리며 항목마다 형식을 검사한다
  (`isRecentProject`, `:22`). `DevelopmentBoard.tsx`(키 `llm-workflow.task-qa-panel-width`, `:149`)는
  읽기·쓰기 양쪽을 `try/catch`로 감싼다(`:158`, `:167`).
- `localStorage`를 던지게 만드는 테스트 선례는 `DevelopmentBoard.test.tsx:161`의 `vi.stubGlobal`이다.
- 뷰의 화면 전환은 `WorkspaceShell`의 `view` 상태 하나이고 라우터가 없다. 다른 화면으로 가면 연동 뷰는
  언마운트된다. 그래서 "다른 화면에 갔다 오기"와 "앱 재시작"이 같은 경로가 된다.
- registry는 고정 배열 `[{ id: "heartbeat" }, { id: "dream" }]`이다(`registry.ts:11`).
