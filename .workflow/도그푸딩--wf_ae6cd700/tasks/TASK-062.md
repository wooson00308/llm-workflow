---
schema: workflow-labs/task@1
id: TASK-062
title: 설치 마법사의 접힘을 저장소에 배선하고 화면 동작을 테스트로 고정한다
status: completed
source_spec_id: SPEC-019
source_decision_id: DECISION-284DCE8B
depends_on: [TASK-061]
updated_at: 2026-08-04T09:45:52.662943+00:00
history:
  - { at: 2026-08-04T08:15:00Z, kind: created }
  - { at: 2026-08-04T08:32:57Z, kind: in_progress }
  - { at: 2026-08-04T08:41:30Z, kind: qa_waiting }
  - { at: 2026-08-04T09:45:52.662943+00:00, kind: completed }
---

# 설치 마법사의 접힘을 저장소에 배선하고 화면 동작을 테스트로 고정한다

`HeartbeatSetupWizard`의 접힘은 지금 `useState(true)` 하나다(`HeartbeatCard.tsx:411`). 연동 뷰가
조건부 렌더라 다른 메뉴를 다녀오면 이 상태가 사라진다. TASK-061이 만든 저장소를 그 자리에 배선해
SPEC-019 R1·R3을 닫고, R4가 지키라고 한 성질이 그대로인지 테스트로 확인한다.

## 의존성

- **선행 필수: TASK-061.** `browserSetupGuideCollapseStore`를 import한다. 파일은 겹치지 않지만
  모듈이 없으면 타입 검사부터 실패한다.

## 범위

- `src/features/projects/components/integrations/HeartbeatCard.tsx` — `HeartbeatSetupWizard`의
  `open` 초기화와 토글 처리, 그 자리의 주석.
- `src/features/projects/components/integrations/IntegrationsView.test.tsx` — `설치 가이드 접기`
  describe(:2420)에 시나리오를 더한다. 이 파일의 `localStorage` 세팅은 이미 갖춰져 있다(:33 주변
  주석과 `beforeEach`).
- 그 외 파일은 건드리지 않는다. `IntegrationsView.tsx`·`IntegrationCard.tsx`·`DreamCard.tsx`·
  `browserIntegrationCollapseStore.ts`는 무변경이다.

## 작업 내용

- `IntegrationsView.tsx:35`의 idiom을 그대로 쓴다. 게으른 초기화로 저장소를 한 번 읽고
  (`useState(() => browserSetupGuideCollapseStore.load())`), 토글이 바꾼 값을 그 자리에서 저장한다.
  렌더마다 읽지 않는다.
- 저장은 사용자가 토글을 누를 때만 한다. 첫 마운트에서 읽은 값을 되쓰지 않는다.
- `HeartbeatCard.tsx:408`~`:410`의 주석은 지금 "연동 카드의 접기와 같은 성질이라 같은 idiom을
  쓴다"까지만 적는다. 기억이 저장소에 남는다는 사실과 왜 카드 접힘과 다른 키인지를 덧붙인다.
  기존 문장(자동 재확인이 접어 둔 가이드를 다시 펼치면 안 된다)은 지운 사실이 아니므로 남긴다.
- 접기는 언마운트가 아니라는 성질을 유지한다. `hidden={!open}`, `aria-expanded`, `aria-controls`,
  "설치 가이드" 제목과 "필수 단계 n/m 완료" 요약, 버튼 문구를 바꾸지 않는다(R4).
- 마법사가 보이지 않는 동안 기억을 지우지 않는다(R3). `if (!remaining) return null` 경로에서 저장소를
  건드리지 않으면 그대로 성립한다.
- 새 테스트는 기존 `설치 가이드 접기` describe 안에 둔다. 기존 두 테스트("starts expanded and counts
  only the finished required steps", "stays folded while the next snapshot refreshes the checks")는
  이름도 본문도 고치지 않는다 — 둘이 SPEC-019 완료 조건 4·10의 검증 수단이다.

## 완료 조건

1. 가이드를 접은 뒤 뷰를 언마운트하고 다시 그리면 접혀 있다. (SPEC-019 완료 조건 1)
2. 접힘이 저장된 상태에서 뷰를 처음 그리면 접힌 채로 열린다. (완료 조건 2)
3. 접었다가 다시 편 뒤 1·2번과 같은 경로를 지나도 펼쳐져 있다. (완료 조건 3)
4. 저장된 값이 없으면 펼침으로 시작하고, 기존 "starts expanded…" 테스트가 수정 없이 통과한다.
   (완료 조건 4)
5. 하트비트 카드의 접기/펼치기를 섞어 조작해도 가이드의 접힘 상태가 바뀌지 않는다. (완료 조건 5)
6. 가이드를 접어도 `workflow-labs.integration-collapse.v1`에 저장된 값이 그대로다. (완료 조건 6)
7. 저장된 값이 깨졌거나 형식이 다른 상태에서 뷰를 열면 펼침으로 그려지고 오류 문구가 보이지 않는다.
   (완료 조건 7)
8. 읽기·쓰기가 던지는 저장소에서도 뷰가 정상으로 그려지고 토글이 동작한다. (완료 조건 8)
9. 필수 단계를 모두 `done`으로 바꿔 마법사를 없앤 뒤 다시 미완료로 되돌리면 마지막으로 고른 접힘
   상태로 돌아온다. (완료 조건 9)
10. 기존 "stays folded while the next snapshot refreshes the checks" 테스트가 수정 없이 통과한다.
    (완료 조건 10)
11. 접힌 상태에서 "설치 가이드" 제목, "필수 단계 n/m 완료" 요약, 다시 펼치는 토글이 보인다. 기존
    접기 테스트가 수정 없이 통과한다. (완료 조건 11)
12. 접힌 상태에서도 명령 복사·카드 배지·경고 표시가 달라지지 않는다. (완료 조건 12)
13. `aria-expanded`와 `aria-controls`를 확인하는 기존 테스트가 통과한다. (완료 조건 13)
14. 삭제되거나 비활성화된 테스트가 없다. (완료 조건 14)
15. `npm run check`가 통과한다. (완료 조건 15)

## 범위 밖

- 연동 카드 접힘의 동작·저장 형식 변경. 이미 요구대로 동작한다.
- 설치 가이드의 문구·단계 구성·단계 판정·자동 재확인, 마법사의 표시 조건(SPEC-016이 정한 그대로).
- 드림 카드에 같은 가이드를 만드는 일.
- 복사 결과 표시(`copied`)와 역할 잡 편집 폼 값의 기억. 뷰를 떠날 때 초기화되는 현행 동작을 둔다.
- 접힘 상태의 동기화·내보내기·초기화 같은 관리 기능.
