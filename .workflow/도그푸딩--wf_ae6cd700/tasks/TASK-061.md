---
schema: workflow-labs/task@1
id: TASK-061
title: 설치 가이드 접힘을 기억하는 브라우저 저장소를 별도 키로 만든다
status: verified
source_spec_id: SPEC-019
source_decision_id: DECISION-284DCE8B
updated_at: 2026-08-14T09:08:07.880257+00:00
history:
- at: 2026-08-04T08:15:00Z
  kind: created
- at: 2026-08-04T08:12:22Z
  kind: in_progress
- at: 2026-08-04T08:15:54Z
  kind: qa_waiting
- at: 2026-08-04T09:46:00.654592+00:00
  kind: completed
- at: 2026-08-14T09:08:07.880257+00:00
  kind: migrated_verified
work_group_id: GROUP-DECISION-284DCE8B
work_group_revision: 1
---

# 설치 가이드 접힘을 기억하는 브라우저 저장소를 별도 키로 만든다

SPEC-019 R2가 저장 수단을 아키텍트에게 맡겼다. 이 작업은 그 결정을 코드로 고정한다: 카드 접힘이
쓰는 `workflow-labs.integration-collapse.v1`을 넓히지 않고, 설치 가이드 전용 키를 새로 둔다.

근거는 둘이다. 첫째, 카드 접힘 맵은 연동 id를 키로 하는 `Record<string, boolean>`이다. 가이드
상태를 같은 맵에 넣으면 그 자리에 쓰는 이름이 언젠가 생길 연동 id와 같은 이름 공간에서 부딪힌다.
둘째, SPEC-019 완료 조건 6("가이드를 접어도 카드 접힘 기억이 바뀌지 않는다")이 축을 나누면 저절로
성립한다. 한 맵에 두 축을 담으면 그 성질을 매번 테스트로 지켜야 한다.

기억은 앱 전체 하나다(SPEC-019 확인 필요 1번의 승인된 제안). 키에 프로젝트 식별자를 넣지 않는다.

## 의존성

없다. 새 파일 둘만 만들고 기존 코드를 고치지 않는다.

## 범위

- `src/features/projects/infrastructure/browserSetupGuideCollapseStore.ts` — 신설.
- `src/features/projects/infrastructure/browserSetupGuideCollapseStore.test.ts` — 신설.
- 그 외 파일은 건드리지 않는다. `browserIntegrationCollapseStore.ts`와 그 테스트는 무변경이다.

## 작업 내용

- `browserIntegrationCollapseStore.ts`의 형태를 그대로 따른다. 모듈 안의 `load`/`save` 함수 둘을
  객체 하나로 내보낸다. 새 추상화를 만들지 않는다 — 저장소가 둘이 되었다고 공통 계층을 세우면
  이 기획서가 요구하지 않은 구조가 늘어난다.
- 저장 키는 `workflow-labs.heartbeat-setup-guide-collapse.v1`.
- 값은 펼침 여부 하나다(`boolean`). 맵이 아니다 — 드림 카드에 같은 가이드를 만드는 일은 SPEC-019의
  제외 범위이므로 지금 여러 자리를 담을 그릇을 만들지 않는다.
- `load(): boolean`은 기본값 `true`(펼침)를 돌린다. 값 없음·JSON 파싱 실패·`boolean`이 아닌 값
  (문자열·숫자·객체·배열·`null`)·`localStorage` 접근 실패를 전부 기본값으로 돌리고 던지지 않는다
  (R2). 기본값을 저장소가 들고 있으면 SPEC-019 완료 조건 4·7·8이 이 파일의 단위 테스트로 닫힌다.
- `save(open: boolean): void`는 실패를 삼킨다. 저장에 실패해도 화면의 토글은 그대로 동작해야 한다.
- 이 결정의 근거(별도 키를 쓰는 이유, 실패를 삼키는 이유)를 주석으로 남긴다. 기존 저장소가 같은
  자리에 같은 성격의 주석을 두고 있다.

## 완료 조건

1. 저장한 값을 그대로 읽는다. `true`와 `false` 양쪽을 확인한다.
2. 저장된 값이 없으면 `true`를 돌린다. (SPEC-019 완료 조건 4)
3. JSON으로 읽히지 않는 값이 저장돼 있으면 `true`를 돌리고 던지지 않는다. (완료 조건 7)
4. `boolean`이 아닌 값(문자열·숫자·객체·배열·`null`)이 저장돼 있으면 `true`를 돌린다. (완료 조건 7)
5. `getItem`·`setItem`이 던지는 저장소에서 `load`가 `true`를 돌리고 `save`가 던지지 않는다.
   메서드가 아예 없는 저장소에서도 같다. (완료 조건 8)
6. `load`와 `save` 어느 쪽도 `workflow-labs.integration-collapse.v1` 키를 읽거나 쓰지 않는다.
   (완료 조건 6)
7. `npm run check`가 통과하고, 삭제되거나 비활성화된 기존 테스트가 없다.

## 범위 밖

- 화면 배선. `HeartbeatCard.tsx`는 TASK-062가 고친다.
- 카드 접힘 저장소의 동작·키·형식 변경.
- 두 저장소를 아우르는 공통 모듈이나 훅.
- 표시 상태를 백엔드나 프로젝트 파일에 저장하는 일.
