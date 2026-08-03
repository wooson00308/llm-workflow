# TASK-021 개발자 핸드오프

- 대상 작업: TASK-021 (연동 카드의 접힘 상태를 연동 단위로 기억한다)
- 근거 문서: SPEC-006 R6, DECISION-E8A3CB27 (approved, created_by: user)
- 세션 역할: 개발자
- 작성 시각: 2026-08-02T23:39Z
- 상태: `qa_waiting`

## 대상 선정 근거

- 착수 시점 `todo`는 TASK-021·023·024·025·027 다섯 건이다. TASK-024는 TASK-023을, TASK-025는
  TASK-024를 선행 필수로 걸고 두 선행이 모두 `todo`라 의존이 풀리지 않았다. 남은 셋(021·023·027)
  중 가장 낮은 번호를 골랐다.
- TASK-021의 선행 필수 TASK-020은 `qa_waiting`이다. 그 결과물인 `IntegrationsView.tsx`의
  `expanded` 상태와 토글 배선, `IntegrationCard.tsx`의 `hidden` 접기가 코드에 있음을 확인하고 그
  위에서 작업했다.
- 착수 시점에 `.workflow/.runtime/migration.lock` 없음, `leases/` 비어 있음. 배타 생성(`set -C`)으로
  `leases/TASK-021.yml`을 만든 뒤 문서를 `in_progress`로 옮기고 시작했다.
- 반려 QA 없음. `decisions/`의 `qa-decision@1` 중 TASK-021을 가리키는 것은 없다.
- 병행 금지 대상(TASK-019·020)은 이 세션에서 건드리지 않았다. lease도 비어 있어 동시 작업 없음.

## 구현 요약

### 저장소 모듈 (`infrastructure/browserIntegrationCollapseStore.ts`, 신규)

- 키는 `workflow-labs.integration-collapse.v1`. `browserRecentProjectStore.ts`의
  `workflow-labs.` 접두사와 `.v1` 버전 표기를 따랐다. 작업 문서의 검증 절차에 적힌 키와 같은 값이다.
- 저장 형태는 연동 id를 키로 하는 `Record<string, boolean>` 하나다. 값 하나가 통째로 들어가고 나온다.
- `load()`는 값 없음·JSON 파싱 실패·객체가 아님(배열·`null`·숫자·문자열 포함)·`localStorage` 접근
  실패를 전부 빈 맵으로 돌린다. 던지지 않는다.
- 항목 단위로도 검사한다. `Object.entries`를 돌며 값이 boolean인 항목만 살린다. 한 항목이 깨졌다고
  같은 맵의 정상 항목을 버리지 않는다.
- 지금 없는 연동 id는 그대로 둔다. 정리·마이그레이션 로직을 넣지 않았다. 연동이 잠시 빠졌다가
  돌아오는 경우에 사용자의 선택을 지우게 된다(작업 문서의 명시 지시).
- `save()`도 `try/catch`로 실패를 삼킨다. 저장이 실패해도 화면의 펼침 동작은 그대로 간다.

### 뷰 배선 (`components/integrations/IntegrationsView.tsx`)

- `useState`의 초기값을 게으른 초기화 `useState(() => browserIntegrationCollapseStore.load())`로
  바꿨다. 렌더마다 읽지 않는다.
- 저장은 토글 콜백 안에서 한다. `useEffect`로 상태를 따라 쓰면 첫 마운트에서 읽은 값을 그대로
  되쓰게 되므로 고르지 않았다.
- 그 자리에 있던 함수형 갱신(`setExpanded((prev) => ...)`)을 `toggle(id)` 하나로 바꿨다. 갱신 함수
  안에서 저장을 부르면 `StrictMode`가 갱신 함수를 두 번 호출하는 개발 모드에서 부수효과가 두 번
  나간다. 다음 값을 먼저 만들고 `setExpanded(next)`와 `save(next)`에 같은 값을 넘긴다.
- 읽는 쪽은 그대로 `expanded[id] ?? false`다. registry에 없는 id는 순회 대상이 아니라 자연히
  무시되고, registry에 있는데 저장된 값이 없는 id는 접힘이 된다.
- `IntegrationCard.tsx`·`HeartbeatCard.tsx`·`DreamCard.tsx`는 바뀌지 않았다. 저장은 뷰의 관심사다.

## 검증

```sh
npm run check   # typecheck + vitest + build — 통과
```

- 결과: 13 파일 165건 통과 후 빌드 성공.
- 이 세션이 더한 케이스는 17건이다. `IntegrationsView.test.tsx` 69 → 75건, 신규
  `browserIntegrationCollapseStore.test.ts` 11건. 지우거나 건너뛴 케이스는 없다.

### 테스트 환경에서 발견한 사실 — `localStorage`에 메서드가 없다

이 저장소의 vitest+jsdom 환경에서 전역 `localStorage`는 **메서드가 하나도 없는 빈 객체**다
(`Object.getPrototypeOf(localStorage).constructor.name === "Object"`, 자체 키 없음). Node v25가
Web Storage 전역을 기본 제공하면서 `--localstorage-file` 경로 없이 뜨는 경고
("`--localstorage-file` was provided without a valid path")와 함께 나타나는 현상이고, 테스트 실행
로그에 그 경고가 그대로 찍힌다.

- 그래서 `localStorage.setItem(...)`을 테스트에서 직접 부르면 `TypeError`다. 실제 저장 동작을 보려면
  작업 문서가 가리킨 대로 `vi.stubGlobal`로 저장소를 직접 세워야 한다
  (`DevelopmentBoard.test.tsx:161`의 선례가 이 방식인 이유로 보인다).
- 두 테스트 파일 모두 `beforeEach`에서 `Map` 기반 저장소를 세우고 `afterEach`에서
  `vi.unstubAllGlobals()`로 되돌린다. 매 테스트가 빈 저장소에서 시작하므로 앞 테스트가 펼쳐 둔 값이
  다음 테스트의 시작 상태를 바꾸지 않는다.
- 앱 실행 경로(Tauri 웹뷰)에는 정상 `localStorage`가 있으므로 제품 동작에는 영향이 없다. 다만
  구현이 접근 실패를 삼키지 않았다면 이 환경에서 화면이 통째로 죽는다. 삼키는 쪽을 고른 근거가
  하나 더 생긴 셈이다.

### 이관 테스트를 어떻게 맞췄나

단언은 하나도 고치지 않았다. 렌더 헬퍼 한 줄과 파일 공통 훅만 손댔다.

- `renderIntegrations`의 자동 펼침 루프를 `getAllByRole` → `queryAllByRole`로 바꿨다. 한 테스트
  안에서 렌더 → `cleanup()` → 재렌더를 하는 두 케이스("tells a stopped daemon apart…",
  "tells the unreadable state apart…")에서 두 번째 렌더는 저장된 상태로 이미 펼쳐져 나오므로
  "펼치기" 버튼이 없다. `getAllByRole`은 0건에서 던지고 `queryAllByRole`은 빈 배열을 준다. 두
  케이스의 의도(둘 다 펼쳐진 상태에서 본문 비교)는 그대로다.
- 파일 상단 `afterEach(cleanup)`을 `cleanup()` + `vi.unstubAllGlobals()`로 넓히고 `beforeEach`를
  더했다. 위의 저장소 세팅 때문이다.

### 새로 더한 케이스

`browserIntegrationCollapseStore.test.ts` 11건:

- 저장 후 읽으면 같은 맵이 나온다.
- 값이 없으면 빈 맵이다.
- 저장된 값이 JSON이 아닌 문자열·배열·`null`·숫자·문자열인 다섯 경우(`it.each`) 각각 빈 맵이고
  던지지 않는다.
- boolean이 아닌 항목(`"yes"`, `null`)은 버려지고 같은 맵의 정상 항목(`true`, `false`)은 남는다.
- 지금 없는 연동 id만 담긴 값도 그대로 읽힌다. 정리하지 않는다는 계약의 증명이다.
- 접근이 던지는 저장소에서 읽기·쓰기 모두 던지지 않는다.
- 메서드가 아예 없는 저장소에서도 읽기·쓰기가 던지지 않는다. (이 환경의 실제 전역 모양이다)

`IntegrationsView.test.tsx`의 `연동 카드 접기·펼치기 > 펼침 상태 기억` 블록 6건:

- 기억된 값이 없으면 두 카드가 접힌 채로 시작한다. (완료 조건 1 / 기획서 12)
- 한 카드를 펼치고 언마운트한 뒤 다시 렌더하면 그 카드만 펼쳐져 있다. 다른 카드는 접혀 있다.
  (완료 조건 2·4 / 기획서 13)
- 펼쳤다 다시 접은 카드는 재렌더에서도 접혀 있다. 기억이 한 방향으로만 굳지 않는다.
- 손상된 값(`"{not json"`)이 저장된 상태에서 뷰가 정상적으로 그려지고 두 카드가 접혀 있으며,
  경고 표식도 경고 상자도 나타나지 않는다. (완료 조건 3 / 기획서 14)
- 지금 없는 연동 id(`gone-integration`)만 담긴 값에서 두 카드가 접힌 채 정상 동작한다. (완료 조건 3)
- 접근이 던지는 저장소에서 뷰가 그려지고 토글이 그대로 동작한다. (완료 조건 5)

언마운트 → 재렌더가 "다른 화면을 다녀오는 것"과 "앱을 다시 여는 것" 양쪽의 실제 경로다. 라우터가
없고 화면 전환이 `WorkspaceShell`의 `view` 상태 하나여서 두 경우가 같은 경로로 모인다.

완료 조건 6(TASK-020 조건 유지)은 기존 케이스가 그대로 통과하는 것으로 확인했다. 접었다 펴서 폼
값이 남는 케이스("keeps the unsaved heartbeat form values across a collapse", DreamCard의 대응
케이스) 모두 통과한다.

## 사용자 QA에 남기는 것

`npm run check`로 완료 조건 1~7을 덮었다. 실제 저장소가 있는 앱에서의 확인은 QA에서 봐 주세요.

- 연동 뷰를 처음 열면 두 카드가 접혀 있는지.
- 하나를 펼치고 설정·개발 등 다른 화면에 갔다 돌아오면 그 카드만 펼쳐져 있는지. 다른 카드는 접힌
  채여야 한다.
- 앱을 완전히 종료하고 다시 열어도 같은지.
- 개발자 도구 콘솔에서 아래를 각각 넣고 뷰를 다시 연다. 두 경우 모두 화면이 정상적으로 뜨고 두
  카드가 접혀 있어야 한다. 오류 문구가 보이면 실패다.

```js
localStorage.setItem("workflow-labs.integration-collapse.v1", "{not json");
localStorage.setItem("workflow-labs.integration-collapse.v1", '{"gone-integration":true}');
```

- 펼침 상태를 만든 뒤 위 두 줄로 값을 깨뜨렸다가, 다시 펼치고 접는 조작이 정상적으로 기억되는지.

## 남은 리스크·후속

- 저장된 맵은 지금 없는 연동 id를 계속 들고 있는다. 의도한 계약(작업 문서의 명시 지시)이고 키 하나에
  담기는 작은 값이라 크기 문제는 없지만, 연동이 늘고 줄기를 반복하면 사용하지 않는 항목이 쌓인다.
  정리가 필요해지면 별도 작업으로 다뤄야 한다.
- 저장 실패는 조용히 삼킨다. 사용자는 "펼쳐 뒀는데 다음에 열면 접혀 있다"를 원인 없이 겪게 된다.
  표시 상태라 알릴 가치가 없다는 기획서 판단을 그대로 따랐다.
- 키에 프로젝트 구분이 없다. 여러 프로젝트를 오가도 연동 목록은 사용자 환경 단위로 같은 둘이므로
  지금은 문제가 아니지만, 연동이 프로젝트마다 달라지면 키를 갈라야 한다.

## 범위 밖으로 남긴 것 (역할 외 발견 포함)

- 뷰 상태(어느 화면을 보고 있었는지)의 복원, 접힘 상태의 파일·백엔드 저장, 저장 실패 알림 UI,
  저장 값 정리·마이그레이션, 전체 펼치기/접기. 전부 기획서 제외 범위다.
- **`browserRecentProjectStore.ts:41`의 `remember()`는 `localStorage.setItem`을 `try/catch` 없이
  부른다.** 같은 파일의 `load()`는 감싸고 있다. 위에 적은 대로 이 저장소의 테스트 환경에서는
  `localStorage`에 `setItem`이 없어 이 경로가 `TypeError`를 던진다. 지금은 이 함수를 부르는 테스트가
  없어 드러나지 않는다. 앱 실행 경로에서도 저장 용량 초과나 접근 차단이면 같은 자리에서 던진다.
  이 작업의 범위 밖이라 손대지 않았다. 별도 작업으로 다룰지 판단이 필요하다.
- `IntegrationCard.tsx`·`HeartbeatCard.tsx`·`DreamCard.tsx`, 카드 본문 문구·배지·경고 판정 규칙,
  `App.css`는 전부 그대로다. TASK-020이 만든 골격을 바꾸지 않았다.
- 작업 트리에 TASK-014~020·022·026의 미커밋 변경이 함께 올라와 있다. 이 세션이 만든 변경은
  `browserIntegrationCollapseStore.ts`·`browserIntegrationCollapseStore.test.ts`(신규 둘),
  `IntegrationsView.tsx`·`IntegrationsView.test.tsx` 네 파일에 한정된다.
