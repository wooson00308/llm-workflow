# TASK-020 개발자 핸드오프

- 대상 작업: TASK-020 (연동 카드에 접기·펼치기 토글과 접힘 요약을 더한다)
- 근거 문서: SPEC-006 R4·R5·R7, DECISION-E8A3CB27 (approved, created_by: user)
- 세션 역할: 개발자
- 작성 시각: 2026-08-02T20:40Z
- 상태: `qa_waiting`

## 대상 선정 근거

- 착수 시점 `todo`는 TASK-020·021·023·024·025·027 여섯 건이다. TASK-021은 TASK-020을,
  TASK-024는 TASK-023을, TASK-025는 TASK-024를 선행 필수로 건다. 의존이 풀린 것은
  TASK-020·023·027 셋이고 그중 가장 낮은 번호를 골랐다.
- TASK-020의 선행 필수 TASK-019는 `qa_waiting`이다. 그 결과물인
  `src/features/projects/components/integrations/IntegrationsView.tsx`와 이관된
  `IntegrationsView.test.tsx`가 코드에 있음을 확인하고 그 위에서 작업했다.
- 착수 시점에 `.workflow/.runtime/migration.lock` 없음, `leases/` 비어 있음. 배타 생성으로
  `leases/TASK-020.yml`을 만든 뒤 문서를 `in_progress`로 옮기고 시작했다.
- 반려 QA 없음. `decisions/`의 `qa-decision@1` 중 TASK-020을 가리키는 것은 없다.
- 병행 금지 대상(TASK-019·021·027)은 이 세션에서 건드리지 않았다. lease도 비어 있어 동시 작업 없음.

## 구현 요약

### 골격 (`IntegrationCard.tsx`)

- Props에 `writeError: string | null`, `expanded: boolean`, `onToggleExpanded(): void` 셋을 더했다.
  `IntegrationCardProps`(연동 본문이 받는 값)에도 `expanded`·`onToggleExpanded`를 더해 뷰 → 카드 →
  골격 경로를 `writeError`가 이미 쓰던 방식 그대로 따랐다.
- 카드 머리 오른쪽에 `.integration-item-marks` 묶음을 두고 [경고 표식] [상태 배지] [토글] 순으로
  그린다. 토글은 `<button type="button">`이고 `aria-expanded`로 상태를, `aria-controls`로 감춰지는
  본문을 가리킨다. 본문 id는 `useId()`로 만든다.
- 본문 전체를 `.integration-item-body` 한 겹으로 감싸고 `hidden={!expanded}`로 감춘다.
  **조건부 렌더가 아니다.** 언마운트하면 `HeartbeatRoleJobs`·`DreamJob`의 `useState`가 사라져 R7이
  깨진다. DOM에 남긴 채 감추는 방식을 골랐고, 값이 남는 것을 두 카드 각각의 테스트로 증명했다.
- 조회 실패 한 줄, 확인 중 안내, 연동 본문, 중복 잡 경고, 읽기 실패 목록이 모두 이 본문 안에 있다.
  판정 조건(`!error && badge` 등)은 그대로 두고 위치만 감쌌다.
- 접힘 요약 판정은 골격이 아는 신호 넷의 OR다: `error`, `writeError`, `duplicateJobs`,
  `readFailures`. 저장 실패 **문구**는 지금처럼 연동 본문이 그리고, 골격은 판정에만 쓴다(R2 유지).
- 골격은 여전히 연동 id도 연동별 문구도 알지 않는다. registry에 항목을 더하는 것만으로 새 연동이
  토글과 요약을 갖는다.

### 상태의 주인 (`IntegrationsView.tsx`)

- 뷰가 연동 id를 키로 하는 `Record<string, boolean>`을 `useState`로 든다. 초기값은 빈 맵이고
  `expanded[id] ?? false`로 읽으므로 첫 화면은 전부 접힘이다(R6 앞 절).
- 토글 콜백은 그 id의 값만 뒤집는다. 한 카드를 접거나 펴도 다른 카드는 그대로다.
- 이 상태는 화면 안에만 있고 앱을 다시 열면 초기값으로 돌아간다. 저장·복원은 TASK-021의 몫이라
  손대지 않았다.

### 전달만 하는 두 카드

- `HeartbeatCard.tsx`·`DreamCard.tsx`는 `expanded`·`onToggleExpanded`를 받아 `IntegrationCard`에
  그대로 넘기고, 이미 받고 있던 `writeError`를 골격에도 함께 넘긴다. 본문 로직은 건드리지 않았다.

### 스타일 (`App.css`)

- `.integration-item-marks`(머리 오른쪽 묶음), `.integration-alert`(경고 표식),
  `.integration-toggle`(토글) 세 규칙을 `.integration-status` 앞에 더했다.
- 경고 표식과 상태 배지는 색만으로 갈리지 않는다. 표식은 테두리 있는 사각(`border-radius: 5px`)에
  굵은 글씨이고 배지는 테두리 없는 알약(`99px`)이다. 문구 자체도 "확인할 경고가 있습니다"로 다르다.
- `.integration-item-body`에는 `display`를 주지 않았다. 주면 `hidden` 속성의 기본 스타일을 덮어써
  접기가 동작하지 않는다.

## 검증

```sh
npm run check   # typecheck + vitest + build — 통과
```

- 착수 전 기준선: `npx vitest run src/.../integrations` 2 파일 99건 통과.
- 작업 후: 같은 범위 2 파일 111건 통과. 전체 `npm run check`는 12 파일 148건 통과 후 빌드까지 성공.

### 이관 테스트를 어떻게 맞췄나

기본값이 접힘으로 바뀌면서 본문이 접근성 트리에서 빠져 `getByRole` 계열 단언 61건이 깨졌다.
**단언은 하나도 고치지 않았다.** 렌더 직후 카드를 펼치는 준비 동작만 더했다.

- `IntegrationsView.test.tsx`: 렌더 헬퍼 `renderIntegrations`에 `{ expand = true }` 옵션을 더해
  렌더 직후 "펼치기" 버튼을 전부 누른다. 폴링 헬퍼 `renderPolling`에도 같은 준비를 넣었다.
  접힘 자체를 보는 새 블록만 `expand: false`로 기본값에서 시작한다.
- `DreamCard.test.tsx`: 이 파일은 카드를 직접 렌더하므로 새 필수 prop을 채워야 한다. 뷰의 자리를
  대신하는 `DreamCardHost`(초기값 펼침, 실제 토글 버튼이 동작하는 `useState` 껍데기)를 두고 두 렌더
  지점이 그것을 쓰게 했다. 덕분에 기존 41건은 그대로 통과하고, 접기 테스트는 실제 버튼을 누른다.
- 케이스를 지우거나 건너뛴 것은 없다. 99 → 111은 전부 순증이다.

### 새로 더한 케이스 (12건)

`IntegrationsView.test.tsx`의 `연동 카드 접기·펼치기` 블록 11건:

- 한 번도 조작하지 않은 카드 둘이 모두 접힌 채 시작한다. (완료 조건 6)
- 토글을 누른 카드만 펼쳐지고 다른 카드는 그대로다. 접는 방향도 같다. (완료 조건 1)
- `aria-expanded`가 false → true → false로 바뀌고, 키보드 Enter와 Space로 조작된다. (완료 조건 2)
- 접힌 카드에서 연동 이름과 상태 배지가 `toBeVisible()`이다. (완료 조건 3)
- 조회 실패·중복 잡·읽기 실패·저장 실패 네 경우 각각(`it.each`), 접힌 카드에 경고 표식이 보이고
  상태 배지와 다른 요소이며 배지 문구에 경고 문구가 섞이지 않는다. (완료 조건 4)
- 경고가 없는 접힌 카드 둘에는 표식이 없다.
- 한 연동의 저장 실패가 다른 연동의 요약을 켜지 않는다.
- 하트비트 주기·실행 한도를 고친 뒤 접었다 펴면 값이 그대로다. (완료 조건 5)

`DreamCard.test.tsx`의 `dream 카드 접기` 블록 1건:

- dream 정제 주기·정제 실행 한도를 고친 뒤 접었다 펴면 값이 그대로다. (완료 조건 5)

접힘 여부는 토글의 `aria-controls`가 가리키는 본문 요소를 `toBeVisible()`로 본다. 구현이 `hidden`이
아닌 다른 방식으로 바뀌어도 같은 테스트가 성립한다.

## 사용자 QA에 남기는 것

`npm run check`로 완료 조건 1~9를 덮었다. 화면 확인은 자동화가 대신하지 못하므로 QA에서 봐 주세요.

- 연동 뷰를 처음 열면 두 카드가 모두 접혀 있고, 각각 이름과 배지가 보이는지.
- 한쪽을 펼쳐도 다른 쪽은 접힌 채인지.
- Tab으로 토글에 도달해 Enter/Space로 접고 펼 수 있는지.
- 주기 값을 고친 뒤 접었다 펴서 고친 값이 그대로인지. 되돌아가면 실패다.
- 관리 블록 밖에 같은 프로젝트의 역할 잡을 하나 두어 중복 잡 경고를 만든 뒤, 접힌 상태에서 경고
  표식이 보이는지.
- 머리 한 줄에 [경고 표식] [상태 배지] [펼치기]가 함께 들어갔을 때 좁은 창에서 줄이 어색하게
  깨지지 않는지. 표식 문구가 "확인할 경고가 있습니다"로 길어 이 부분은 눈으로 봐야 안다.

## 남은 리스크·후속

- 접힘 상태가 화면 안에만 있어 다른 메뉴를 다녀오면 초기값(접힘)으로 돌아간다. 기획서 완료 조건
  13·14(저장·복원, 손상된 값 처리)는 이 작업의 범위 밖이고 **TASK-021**이 맡는다. TASK-021은 이
  작업이 만든 `useState` 초기값과 저장만 바꾸면 되도록 상태의 주인을 뷰 하나로 모아 두었다.
- 이관 테스트 다수가 이제 렌더 헬퍼의 자동 펼침에 기대므로, 본문을 읽는 새 테스트를 쓸 때
  `expand: false`를 넘기면 접근성 질의가 실패한다. 헬퍼 주석에 이유를 적어 두었다.
- `.integration-item-body`에 나중에 `display` 계열 규칙을 주면 `hidden`이 무력화된다. 필요해지면
  `[hidden] { display: none }`을 함께 둬야 한다.

## 범위 밖으로 남긴 것 (역할 외 발견 포함)

- 접힘 상태의 저장·복원 (TASK-021).
- 카드 본문 문구·배지 판정·경고 판정 규칙, 저장 실패 문구의 위치. 전부 그대로다.
- 전체 펼치기/접기, 카드 정렬·검색·필터, 펼침 애니메이션, 플랫폼 미지원 경고 위치. 기획서 제외 범위.
- 작업 트리에 TASK-014~019·022·026의 미커밋 변경이 함께 올라와 있다. 이 세션이 만든 변경은
  `IntegrationCard.tsx`·`IntegrationsView.tsx`·`HeartbeatCard.tsx`·`DreamCard.tsx`·
  `IntegrationsView.test.tsx`·`DreamCard.test.tsx`·`App.css` 일곱 파일에 한정된다.
