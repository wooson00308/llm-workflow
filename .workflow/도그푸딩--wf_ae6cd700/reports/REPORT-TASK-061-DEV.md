# TASK-061 개발자 핸드오프

- 대상 작업: TASK-061 (설치 가이드 접힘을 기억하는 브라우저 저장소를 별도 키로 만든다)
- 근거 문서: SPEC-019 R2 및 완료 조건 4·6·7·8, DECISION-284DCE8B (approved, created_by: user)
- 세션 역할: 개발자 (developer-sasha)
- 작성 시각: 2026-08-04T08:14Z
- 상태: `qa_waiting`

## 대상 선정 근거

- `sh .workflow/rules/wf-eligible.sh developer` → exit 0. `todo`이면서 선행이 충족인 작업은 TASK-061 하나다.
  - TASK-061: `status: todo`, `depends_on` 키 없음 → 대기 없음.
  - TASK-062: `depends_on: [TASK-061]`이고 TASK-061이 `todo`였으므로 미충족. 선택하지 않았고 `blocked`로 옮기지도 않았다.
  - 나머지 작업은 전부 `completed` 또는 `qa_waiting`이다.
- `migration.lock` 없음. `leases/`에는 `SPEC-009.yml` 하나뿐이고 `TASK-061.yml`은 없었다. 남의 lease는 읽지도 지우지도 않았다.
- 근거 결정은 승인 상태 그대로다. SPEC-019에 걸린 결정은 DECISION-284DCE8B 하나이고 `outcome: approved`, `created_by: user`다.
- 선점: `sh .workflow/rules/wf-claim.sh acquire TASK-061 developer-sasha 30` (exit 0, `lease-64518-20260804081217`) → 같은 편집에서 `in_progress` + `history` 기록 → 구현 → 긴 검증 전 `renew`(exit 0) → `qa_waiting` → `release`.

## 변경한 파일

신설 두 개뿐이다. 기존 코드는 한 줄도 고치지 않았다.

- `src/features/projects/infrastructure/browserSetupGuideCollapseStore.ts` — 신설
  - `load(): boolean` / `save(open: boolean): void` 두 함수를 `browserSetupGuideCollapseStore` 객체 하나로 내보낸다.
  - 저장 키 `workflow-labs.heartbeat-setup-guide-collapse.v1`, 기본값 `true`(펼침).
- `src/features/projects/infrastructure/browserSetupGuideCollapseStore.test.ts` — 신설, 12개 케이스.

`browserIntegrationCollapseStore.ts`와 그 테스트, `HeartbeatCard.tsx`, 그 밖의 화면 파일은 무변경이다.

## 핵심 결정과 근거

1. **`browserIntegrationCollapseStore.ts`의 형태를 그대로 베꼈다.** 모듈 스코프 상수 키 → `try`로 감싼 `load` → `try`로 감싼 `save` → 마지막 줄에서 객체 하나 export. 공통 계층이나 제네릭 저장소를 만들지 않았다. 저장소가 둘이 되었다는 이유만으로 추상화를 세우면 기획서가 요구하지 않은 구조가 는다.
2. **값은 `boolean` 하나이고 맵이 아니다.** 드림 카드의 같은 가이드는 SPEC-019의 제외 범위라, 지금 여러 자리를 담을 그릇을 만들지 않았다.
3. **기본값을 저장소가 들고 있다.** `DEFAULT_OPEN = true`를 이 파일에 두어 SPEC-019 완료 조건 4·7·8이 화면 테스트를 거치지 않고 이 파일의 단위 테스트로 닫힌다. TASK-062는 `useState(() => load())` 한 줄이면 되고 기본값을 다시 알 필요가 없다.
4. **`typeof parsed !== "boolean"`으로 한 번에 거른다.** 문자열·숫자·객체·배열·`null`이 전부 이 한 줄에 걸린다. 타입별 분기를 따로 두지 않았다.
5. **키를 나눈 이유를 파일 머리 주석에 적었다.** 카드 접힘 맵은 연동 id를 키로 하므로 같은 자리에 가이드 상태를 넣으면 언젠가 생길 연동 id와 이름이 부딪힌다는 것, 그리고 축을 나누면 완료 조건 6이 저절로 성립한다는 것. 기존 저장소가 같은 자리에 같은 성격의 주석을 두고 있다.

### `!value` 조기 반환에 대해

기존 저장소의 `if (!value) return {};`를 그대로 가져왔다. 값 없음(`null`)과 빈 문자열이 함께 걸리는데, 빈 문자열은 `JSON.parse`가 던져서 어차피 `catch`로 떨어지므로 결론이 같다. 저장된 `"false"`는 빈 문자열이 아니라 이 분기에 걸리지 않는다 — 테스트 `reads back what it stored: false`가 그것을 고정한다.

## 검증 단계와 결과

```
npx vitest run browserSetupGuideCollapseStore.test.ts
                browserIntegrationCollapseStore.test.ts      2 files / 23 passed
npm run check                                                통과 (exit 0)
                                                             typecheck + 15 files / 346 passed + 빌드 성공
```

- 새 테스트 12개가 붙었고 전체는 334 → 346이다. 삭제하거나 `skip`·`todo`로 돌린 테스트는 없다.
- 이웃 저장소의 테스트 11개는 손대지 않았고 그대로 통과한다.

### 완료 조건 대조

1. 저장한 값 그대로 읽기(`true`/`false` 양쪽) — `it.each([true, false])("reads back what it stored: %s")` — 충족.
2. 값 없으면 `true` — `starts expanded when nothing was stored` — 충족.
3. JSON으로 안 읽히는 값이면 `true`, 던지지 않음 — `falls back to expanded when the stored value is JSON이 아닌 문자열` (`{not json`) — 충족.
4. `boolean`이 아닌 값이면 `true` — 같은 `it.each`의 나머지 5종: 문자열 `"true"`, 숫자 `0`, 객체 `{"open":true}`, 배열 `[true]`, `null` — 충족. 숫자는 `0`을, 문자열은 `"true"`를 골랐다. 느슨한 참·거짓 변환으로 새는 자리를 잡으려는 선택이다.
5. 던지는 저장소 / 메서드 없는 저장소 — `swallows a storage that throws on every access`, `swallows a storage that has no methods at all` — 충족. 양쪽 다 `load`가 `true`, `save`가 던지지 않음을 본다.
6. 카드 접힘 키를 읽지도 쓰지도 않음 — `never reads or writes the integration collapse key` — 충족. `getItem`·`setItem`이 받은 키를 전부 모아 `workflow-labs.integration-collapse.v1`이 없음과, 실제로 만진 키가 자기 키 둘뿐임을 함께 본다.
7. `npm run check` 통과, 삭제·비활성 테스트 없음 — 충족.

### 역행 검증

`typeof parsed !== "boolean"` 가드를 임시로 `parsed == null`로 바꿔 돌렸다. 결과는 `4 failed | 8 passed (12)`이고, 실패한 넷은 문자열 `"true"`·숫자 `0`·객체·배열이다. 가드를 지키는 것이 이 네 케이스라는 뜻이다.

나머지 둘은 약한 구현에서도 통과한다. `{not json`은 `JSON.parse`가 던져 `catch`로 떨어지고, `null`은 `parsed == null`에도 걸린다. 즉 이 둘만으로는 타입 가드가 살아 있는지 알 수 없다 — 손상값 목록을 여섯으로 둔 이유가 이것이다. 확인 뒤 가드를 되돌렸고, 위 게이트 수치는 되돌린 상태에서 다시 돌린 것이다.

## 리스크와 후속

1. **아직 아무도 이 저장소를 부르지 않는다.** 화면 배선은 TASK-062다. 지금 앱을 띄워도 가이드 접힘은 여전히 `useState(true)`이고 메뉴를 다녀오면 사라진다. 이 작업만으로는 사용자가 볼 변화가 없다.
2. **키 이름이 `heartbeat-`로 시작한다.** 나중에 드림 카드에 같은 가이드가 생기면 이 키를 넓히는 대신 그쪽 키를 새로 두거나 형식을 바꿔야 한다. SPEC-019가 드림을 제외 범위로 둔 결과라 지금 미리 그릇을 키우지 않았다.
3. **테스트 환경의 `localStorage`가 메서드 없는 빈 객체다.** 이웃 저장소 테스트와 같은 `vi.stubGlobal` 방식으로 세웠다. 이 전제가 바뀌면 두 테스트 파일이 같이 흔들린다.

## 사용자 QA 제안

이 작업은 화면 변화가 없다. QA는 저장소 계약만 보면 된다.

1. `npx vitest run src/features/projects/infrastructure/` — 두 저장소 테스트가 모두 통과하는지 본다.
2. 앱을 띄워 연동 뷰의 카드 접기/펼치기가 전과 똑같이 기억되는지 본다. 이 작업이 카드 접힘에 아무 영향이 없다는 확인이다.
3. 개발자 도구 Application → Local Storage에서 `workflow-labs.heartbeat-setup-guide-collapse.v1` 키가 아직 생기지 않는 것을 본다. 배선 전이라 없는 것이 정상이다.
4. 눈에 보이는 동작 확인은 TASK-062까지 간 뒤에 SPEC-019 완료 조건 1·2·3으로 한다.

## 핸드오프 노트 (역할 밖 발견, 고치지 않음)

- 작업 문서의 `history` 첫 항목 `created`가 `2026-08-04T08:15:00Z`인데 이번 세션의 `in_progress` 실제 시각은 `08:12:22Z`다. 로그가 시각 역순으로 보인다. 이력은 추가 전용이라 기존 항목을 고치지 않고 실제 시각을 그대로 적었다. 앱이 작업 문서를 만들 때 쓴 시각의 문제로 보이고, 이 세션이 판단할 일이 아니다.
- 작업 착수 시점의 워킹 트리에 이 세션과 무관한 미커밋 변경이 많이 남아 있었다(`HeartbeatCard.tsx`·`IntegrationsView.tsx`·`ActivityView.tsx` 등, 앞선 작업들의 산출물로 보인다). 손대지 않았고, `npm run check`는 그 상태를 포함해 통과했다.
