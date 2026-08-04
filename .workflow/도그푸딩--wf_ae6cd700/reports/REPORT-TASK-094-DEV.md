# TASK-094 개발자 핸드오프

- 대상: TASK-094 (레인 접힘 상태를 담는 브라우저 저장소를 만든다)
- 근거: SPEC-029 R6·완료 조건 8·9, DECISION-DD348ED0 (`outcome: approved`, `created_by: user`,
  `spec_id: SPEC-029` — 직접 확인. SPEC-029의 결정 문서는 이 1건뿐)
- 역할: 개발자 (developer-claude)
- 선점: acquire exit 0 → `lease-94999-20260804115255` → `in_progress`(11:53:00Z) → 구현 → 검증 →
  `qa_waiting`(11:55:30Z). 작업이 짧아 renew 없이 첫 임차(30분) 안에 끝났다.
- 선행 확인: `depends_on` 없음. 후행 TASK-096이 이 저장소를 부르지만 아직 `todo`이고, 그쪽 선행
  둘(TASK-094·095) 중 095가 아직 `todo`라 순서가 뒤집히지 않았다.

신설 파일 두 개뿐이다. 기존 파일을 하나도 열지 않았으므로 병행 세션과 겹칠 자리가 없다.

## 착수 시점 실측

- 이 워크플로우의 `todo` 작업 5건 중 선행이 충족된 것은 TASK-094·095·097 셋(093이 `completed`라
  095도 충족). 096·098은 선행이 `todo`라 미충족이다. 그중 이 세션은 하나만 선점했다.
- `.workflow/.runtime/migration.lock` 없음. 활성 lease 없음(`SPEC-009.yml`은 2026-08-03T01:20:00Z
  만료분이 남아 있는 것이고 이 대상과도 겹치지 않는다).

## 변경한 파일 (둘, 전부 신설)

- `src/features/projects/infrastructure/browserSpecLaneCollapseStore.ts` — 신설 (73줄)
- `src/features/projects/infrastructure/browserSpecLaneCollapseStore.test.ts` — 신설 (검사 16건)

`.tsx`·CSS·Rust·`types.ts` 무변경. 기존 저장소 네 개 무변경. 보호 상태 무변경. 커밋·푸시 없음.

## 구현에서 고른 것

- **키**: `workflow-labs.spec-lane-collapse.v1`. 바깥 키는 워크플로 디렉터리, 안쪽 키는 레인 키다.
- **`UNASSIGNED_LANE_KEY = "#unassigned"`를 저장소가 내보낸다.** TASK-095가 같은 문자열을 자기
  파일에 두고 TASK-096이 이 상수로 합치는 순서라, 합칠 대상이 여기 있다.
- **`false`를 지우지 않고 남긴다.** 접힘/펼침이 대칭이라 지울 이유가 없고, 남겨도 `load`의 답이
  같다(검사 1이 `SPEC-030: false`를 저장하고 그대로 읽는다). `browserIdeaDraftStore`가 빈 초안을
  삭제로 다루는 것은 "빈 초안 저장"과 "초안 삭제"가 갈리면 안 되기 때문인데, 여기엔 그 문제가 없다.
- **`save`는 그 워크플로 항목만 갈아 끼운다.** `readAll` → 한 항목 교체 → 통째로 쓰기. 다른
  워크플로의 값이 남는 것을 검사 3이 본다.
- **모르는 키를 지우지 않는다.** 정리 코드를 아예 쓰지 않았다. 지금 없는 기획서 id를 가리키는 값도
  `load`가 그대로 돌려준다(검사 15).
- **두 층 모두에서 항목 하나가 깨져도 나머지가 남는다.** 바깥은 값이 객체가 아닌 디렉터리 항목을
  건너뛰고, 안쪽은 `typeof flag === "boolean"`이 아닌 레인 항목을 건너뛴다.
  `browserIntegrationCollapseStore`와 같은 자리·같은 어법이다.

## 완료 조건별 확인

| # | 조건 | 결과 |
|---|---|---|
| 1 | 저장·재읽기, 키가 `workflow-labs.spec-lane-collapse.v1`, 워크플로 디렉터리로 구분 | 통과 — 검사 1·2·3 |
| 2 | 다른 저장소 넷의 값이 남는다 | 통과 — 검사 4 |
| 3 | 읽기·파싱·쓰기 실패에 던지지 않는다 | 통과 — 검사 5~13 |
| 4 | 지금 없는 기획서를 가리키는 키가 살아남는다 | 통과 — 검사 15 |
| 5 | 변경분이 신설 파일 두 개뿐 | 통과 — 아래 |
| 6 | `npm run check` 통과 | 통과 — 아래 |

### 조건 5 — 판정 방법

작업 문서는 `git status`로 확인하라고 적었지만, 이 저장소는 병행 세션의 미커밋 변경이 크게 얹혀
있어 그 출력만으로는 이 세션의 몫이 갈리지 않는다(`src/App.css`·`DevelopmentBoard.tsx`가 `M`이고,
같은 디렉터리에 다른 세션의 미커밋 신설 파일이 여섯 있다). 개발자 라인에서 두 번 지적된 항목이라
파일 단위로 확인했다.

이 세션의 쓰기는 정확히 세 번이다 — 신설 두 파일과 TASK-094 문서의 상태 전이. `git status`의
`?? browserSpecLaneCollapseStore.ts`·`?? browserSpecLaneCollapseStore.test.ts` 두 줄이 이 세션의
산출물이고, 나머지 `??`(`browserIdeaDraftStore*`·`browserSetupGuideCollapseStore*`·`clipboard.ts`·
`jobValueMemoryStore.ts`)와 `M` 두 건은 착수 전부터 있던 다른 세션의 것으로 손대지 않았다.

### 조건 2 — 검사에 쓴 다른 저장소 키 (착수 시점에 각 파일에서 직접 읽음)

| 저장소 | 실제 키 |
|---|---|
| `browserIdeaDraftStore.ts:13` | `workflow-labs.idea-draft.v1` |
| `browserIntegrationCollapseStore.ts:4` | `workflow-labs.integration-collapse.v1` |
| `browserSetupGuideCollapseStore.ts:8` | `workflow-labs.heartbeat-setup-guide-collapse.v1` |
| `browserRecentProjectStore.ts:7` | `workflow-labs.recent-projects.v1` |

**작업 문서가 적은 `workflow-labs.setup-guide-collapse.v1`은 실제 값이 아니다.** 세 번째 줄이
실제로는 `heartbeat-` 접두를 갖는다. 작업 문서가 "키 이름은 착수 시점에 각 저장소 파일에서 직접
읽어 온다"고 못 박아 두어 실제 값을 썼다. 문서 쪽 오기이고 코드에는 영향이 없다.

한 `localStorage`를 나눠 쓰는 저장소는 실제로 다섯이다 — 위 넷에 `jobValueMemoryStore.ts:12`의
`workflow-labs.job-value-memory.v1`이 더 있다. 검사는 작업 문서가 지정한 넷만 미리 넣어 두고
확인한다.

## 검증

- `npx vitest run src/.../browserSpecLaneCollapseStore.test.ts` → 16 passed / 16.
- `npm run check` (typecheck → test → build) → 전부 통과. `tsc -b` 무오류, 19 파일 490건 통과
  (착수 전 18 파일 474건 + 이 세션 1 파일 16건), `vite build` 성공(325 modules).
- `cargo test`는 돌리지 않았다. Rust 변경분이 없고 작업 문서의 완료 조건에도 없다.

## 남은 위험과 후속

- **TASK-096이 딛고 설 자리.** `load(workflowDirectory)`가 `Record<string, boolean>`을 돌려주고
  `save(workflowDirectory, collapsed)`가 통째로 받는다. 레인 하나만 뒤집는 헬퍼는 만들지 않았다 —
  작업 문서가 요구하지 않았고, `applyPanelWidth` 어법대로 부르는 쪽에서 맵을 만들어 넘기면 된다.
  미분류 레인 키는 `UNASSIGNED_LANE_KEY`로 내보냈으니 TASK-095가 자기 파일에 둔 상수를 이것으로
  합치면 된다.
- **`SpecLaneCollapseState`(두 층 전체 모양) 타입은 내보내지 않았다.** 부르는 쪽이 쓰는 것은 한
  워크플로의 맵이라 `browserIdeaDraftStore`처럼 안에 두었다. TASK-096이 이름 붙은 타입을 원하면
  그때 내보내면 되고, 그 판단은 그쪽 몫이다.
- **역할 밖 관찰(수정하지 않음).** `.workflow/.runtime/leases/SPEC-009.yml`이
  2026-08-03T01:20:00Z에 만료된 채 남아 있다. TASK-093 보고서가 같은 것을 적었고 상황이 그대로다.
  규칙상 남의 lease 파일을 지우지 않으므로 그대로 두었다.
- **역할 밖 관찰(수정하지 않음).** 위 표의 작업 문서 키 오기(`setup-guide-collapse` ↔
  `heartbeat-setup-guide-collapse`). 작업 문서는 아키텍트 소유라 고치지 않았다. 같은 문자열이
  TASK-096 문서에는 없어 후속 작업이 오해할 자리는 없다.
- 사용자 QA 범위: **화면에 보이는 변화가 없다.** 이 저장소를 부르는 코드가 아직 없어(TASK-096의
  몫) 앱 동작은 착수 전과 동일하다. 회귀가 없는지(개발 보드·문서 목록이 이전과 똑같이 뜨는지)만
  보면 된다.
