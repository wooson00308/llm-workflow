---
schema: workflow-labs/task@1
id: TASK-094
title: 레인 접힘 상태를 담는 브라우저 저장소를 만든다
status: completed
source_spec_id: SPEC-029
source_decision_id: DECISION-DD348ED0
updated_at: 2026-08-04T15:29:37.591413+00:00
history:
  - { at: 2026-08-04T11:30:00Z, kind: created }
  - { at: 2026-08-04T11:53:00Z, kind: in_progress }
  - { at: 2026-08-04T11:55:30Z, kind: qa_waiting }
  - { at: 2026-08-04T15:29:37.591413+00:00, kind: completed }
---

# 레인 접힘 상태를 담는 브라우저 저장소를 만든다

R6이 요구하는 저장소를 새 파일 하나로 만든다. 화면 연결은 TASK-096이 하고, 이 작업은 저장소와 그
단위 검사까지다. SPEC-029의 완료 조건 8·9를 닫는다.

**이 작업은 기존 파일을 하나도 고치지 않는다.** 그래서 TASK-093·TASK-095와 병행해도 안전하고,
선행 선언이 없다.

## 범위

- `src/features/projects/infrastructure/browserSpecLaneCollapseStore.ts` — 신설.
- `src/features/projects/infrastructure/browserSpecLaneCollapseStore.test.ts` — 신설.
- 그 외 파일은 건드리지 않는다. `.tsx`·CSS·Rust 전부 무변경이다. 기존 저장소 네 개의 코드도
  건드리지 않는다.

## 작업 내용

### 저장할 값의 모양

```ts
/** 워크플로 디렉터리 → 레인 키 → 접혔는지. 값이 없는 레인은 펼침이다. */
type SpecLaneCollapseState = Record<string, Record<string, boolean>>;

const STORAGE_KEY = "workflow-labs.spec-lane-collapse.v1";
```

- **키는 `workflow-labs.*.v1` 계열이다**(R6 둘째 항목). 확인 사실 17의
  `llm-workflow.task-qa-panel-width`는 이 계열이 아니지만, 그 이름을 정리하는 것은 기획서 제외
  범위다. **따라 하지 않고 건드리지도 않는다.**
- **바깥 키는 워크플로 디렉터리다.** 확인 사실 16의 `browserIdeaDraftStore`가 쓰는 것과 같은 키이고,
  같은 근거로 프로젝트 식별자를 넣지 않는다(디렉터리가 `<slug>--wf_<식별자>`라 전역에서 유일하다).
- **안쪽 키는 레인 키다.** 기획서 레인은 기획서 문서 id(`SPEC-029`)이고, 미분류 레인은 `#unassigned`
  하나다. 문서 id에 `#`이 들어가는 경로가 없어 충돌하지 않는다. **이 상수를 저장소가 정의해
  내보낸다** — TASK-095·TASK-096이 같은 문자열을 다시 적지 않게 하기 위해서다.
- **기본값은 펼침이다.** 값이 없는 레인은 펼쳐진 상태로 읽는다. 그래야 처음 켠 사용자가 레인 내용을
  본다.

### 읽기·쓰기

확인 사실 16의 선례를 그대로 따른다. 새 판단을 만들지 말고 `browserIdeaDraftStore`와
`browserIntegrationCollapseStore`의 어법을 복사해 온다.

- `load(workflowDirectory: string): Record<string, boolean>` — 그 워크플로의 접힘 맵. 값 없음·JSON
  파싱 실패·객체 아님·배열·`localStorage` 접근 실패를 **전부 빈 맵으로 돌리고 던지지 않는다.**
- 항목 하나가 깨졌다고 나머지를 버리지 않는다. 바깥에서는 값이 객체가 아닌 디렉터리 항목을 건너뛰고,
  안쪽에서는 값이 boolean이 아닌 레인 항목을 건너뛴다. `browserIntegrationCollapseStore`의
  `typeof flag === "boolean"` 검사와 같은 자리다.
- `save(workflowDirectory: string, collapsed: Record<string, boolean>): void` — **그 워크플로 항목만
  갈아 끼우고 다른 워크플로의 값은 그대로 둔다.** `browserIdeaDraftStore.save`가 하는 것과 같다.
  쓰기 실패는 삼킨다. 표시 상태라 사용자에게 띄울 가치가 없고, 실패해도 화면의 접기 동작은 그대로
  동작해야 한다.
- **지금 없는 기획서를 가리키는 키를 지우지 않는다.** 확인 필요 3번의 비용 항목이 요구하는 것이다 —
  카드가 없어 목록에서 빠졌던 레인이 돌아왔을 때 접힘 상태가 남아 있어야 한다.
  `browserIntegrationCollapseStore`가 같은 이유로 모르는 id를 보존한다.
- `false`를 지울지는 구현자의 판단에 맡긴다. `browserIdeaDraftStore`가 빈 초안을 항목 삭제로 다루는
  선례가 있지만, 여기서는 접힘/펼침이 대칭이라 남겨도 된다. **어느 쪽이든 `load`가 같은 답을 내야
  한다.**
- 주석은 이 저장소가 쓰는 판단(키 구성·기본값·모르는 키 보존·실패를 삼키는 이유)을 적는다. 확인 사실
  16의 두 파일이 쓰는 문서화 수준을 따른다.

### 검사

`browserIdeaDraftStore.test.ts`·`browserIntegrationCollapseStore.test.ts`의 어법을 따른다.

1. 저장한 접힘 상태를 다시 읽는다. (완료 조건 8)
2. **워크플로 디렉터리로 갈린다.** 두 디렉터리에 서로 다른 값을 저장하고 각각 제 값을 읽는다. 한쪽을
   저장해도 다른 쪽이 남는다. (완료 조건 8)
3. **다른 저장소 넷의 값이 남는다.** 확인 사실 16대로 다섯이 한 `localStorage`를 나눠 쓴다. 다른 키
   넷(`workflow-labs.idea-draft.v1`·`workflow-labs.integration-collapse.v1`·
   `workflow-labs.setup-guide-collapse.v1`·최근 프로젝트 키)을 미리 넣어 두고 이 저장소가 쓴 뒤에도
   그 값이 그대로인지 본다. **키 이름은 착수 시점에 각 저장소 파일에서 직접 읽어 온다.** (완료 조건 8)
4. 값이 없을 때 빈 맵이다. (완료 조건 9)
5. 깨진 JSON·객체가 아닌 값·배열일 때 빈 맵이고 던지지 않는다. (완료 조건 9)
6. 항목 하나가 깨져도 나머지가 남는다. 값이 boolean이 아닌 레인 항목만 빠진다. (완료 조건 9)
7. `localStorage.getItem`·`setItem`이 던질 때 읽기는 빈 맵이고 쓰기는 조용히 넘어간다. 선례와 같은
   `vi.spyOn`/스텁 어법을 쓴다. (완료 조건 9)
8. 저장된 값이 지금 없는 기획서 id를 가리켜도 `load`가 그 항목을 그대로 돌려주고 던지지 않는다.
   (R6 넷째 항목)

## 완료 조건

괄호 안은 SPEC-029의 완료 조건 번호다.

1. 접힘 상태가 저장되고 다시 읽힌다. 키가 `workflow-labs.spec-lane-collapse.v1`이고 워크플로
   디렉터리로 구분된다. 검증: 위 검사 1·2. (8)
2. 다른 저장소 넷의 값이 남는다. 검증: 위 검사 3. (8)
3. 읽기 실패·파싱 실패·쓰기 실패에 던지지 않는다. 검증: 위 검사 4~7. (9)
4. 지금 없는 기획서를 가리키는 키가 살아남고 화면을 깨지 않는다. 검증: 위 검사 8. (R6 넷째 항목)
5. 변경분이 신설 파일 두 개뿐이다. 검증: `git status`. (14)
6. `npm run check`가 통과한다. (16)

## 범위 밖

- **화면 연결.** 접기 버튼, 접힌 레인의 표시, CSS는 TASK-096의 몫이다. 이 작업은 아무 컴포넌트도
  건드리지 않는다.
- **묶기 토글의 지속.** 기획서 제외 범위가 명시적으로 잘랐다. 토글은 늘 꺼진 상태에서 시작하므로
  이 저장소에 넣지 않는다.
- **확인 사실 17의 QA 패널 키 이름 정리.** 기획서 제외 범위다.
- **기존 저장소 넷의 리팩터링.** 어법을 따라 하되 공용 헬퍼로 묶지 않는다. 다섯 번째가 생겼다는
  이유만으로 추상화하지 않는다.
- **레인 순서·표시 여부의 저장.** 확인 필요 3번이 정한 순서는 그때그때 계산하는 값이다.
