# TASK-046 개발자 핸드오프

- 대상 작업: TASK-046 (건너뜀 문구가 조건 검사 실행 실패를 배제하지 않게 하고 dream 조건의 비보증을 카드가 밝힌다)
- 근거 문서: SPEC-015 R8·R11, D3, DECISION-EEEEB81D (approved, created_by: user)
- 세션 역할: 개발자 (TL 배정)
- 작성 시각: 2026-08-03T09:39Z
- 상태: `qa_waiting`

## 대상 선정 근거

- TL이 이 한 건만 배정했다. 착수 시점 TASK-046은 `todo`이고 `depends_on`이 없다.
- `migration.lock` 없음. 착수 시점(09:28Z) lease는 `SPEC-009.yml`(만료), `TASK-039.yml`,
  `TASK-042.yml`, `TASK-051.yml` 넷이고 전부 내 대상이 아니라 손대지 않았다.
- 병행 금지 상대인 TASK-045(`IntegrationsView.test.tsx` 공유)는 lease가 없었고 착수·종료 시점 모두
  아무도 잡고 있지 않았다.
- 선점: `leases/TASK-046.yml` 배타 생성(`set -C`) → 즉시 `status: in_progress` + `history` 기록 →
  구현 → 검증 → `qa_waiting` → lease 반납. 선점 헬퍼는 아직 이 저장소에 설치되지 않아 공통 규칙 §4의
  폴백 경로를 썼다.
- 소스 결정 DECISION-EEEEB81D는 `outcome: approved`, `created_by: user`로 유효하다.

## 구현 요약

라벨에서 사유를 빼고, 사유를 물을 자리를 안내 문장 하나로 만들었다. 백엔드와 payload는 건드리지
않았다. 앱이 사유를 알아내려고 파일을 읽거나 명령을 실행하지 않는다(R8).

### 1. `skipped` 라벨 — 사유를 뺀다

두 카드 모두 `건너뜀 · 처리할 대상 없음` → `건너뜀`. 하트비트는 조건 미충족과 조건 검사 실행 실패를
같은 값으로 기록하고 앱은 둘을 구분할 방법이 없으므로, 라벨은 앱이 아는 사실 하나만 남긴다.
`quota_skipped`(`건너뜀 · 실행 한도 도달`)는 사유를 아는 값이라 그대로 뒀다.

### 2. 건너뜀 안내 — 두 카드가 글자까지 같은 한 문장

> 건너뜀에는 조건을 충족하지 못한 경우와 조건 검사가 실행되지 못한 경우가 모두 들어갑니다. 앱은 둘 중
> 어느 쪽인지 알지 못하며, 실제 사유는 하트비트 로그 파일에 남습니다.

요구된 사실 셋(두 경우가 섞여 있다 / 앱은 모른다 / 사유는 로그에 남는다)을 담았다.

**표시 조건을 `result === "skipped"`로 좁혔다.** 작업 문서는 "실행 결과가 그려지는 자리에 붙인다"와
"실행 결과가 하나도 없는 상태에서 이 안내만 떠 있지 않게"만 정했고 그 사이의 선택은 열려 있었다.
두 카드는 마지막 실행 하나만 보여주므로, 성공·실패·시간 초과 결과 옆에 건너뜀 설명이 붙으면 설명할
대상이 없는 안내가 된다. 사유를 모르게 된 그 결과에만 붙였다. 이 판단이 뒤집히면 두 카드의 조건식
한 줄씩만 고치면 된다(`run.result === "skipped"` / `dream.lastRun.result === "skipped"`).

기존 스타일 안에서 해결했다. 새 CSS 클래스를 만들지 않고 `integration-note`를 썼다(범위 밖 준수).

### 3. dream 조건의 출처 — 항상 보이는 한 문장

> 이 잡의 조건은 앱이 관리하는 스크립트가 아니라 외부 명령입니다. 앱은 그 명령이 동작하는지 보증하지
> 않습니다.

`installationNote` 바로 아래, 카드 본문이 그려지는 동안 설치 상태와 무관하게 항상 보인다. 조건의
출처는 설치 여부로 달라지지 않기 때문이다. 역할 잡 카드에는 넣지 않았다 — 그쪽 조건은 앱 관리
자산이라 사실이 다르다.

**문구에 OS 이름을 넣지 않았다.** D3·R11이 "Windows 동작을 보증하지 않는다"로 적었지만 앱이 보증하지
못하는 것은 플랫폼과 무관하게 그 외부 명령 전부이고, 화면은 실행 플랫폼을 알지 못한다(R5가 화면
문구의 OS 이름 하드코딩을 금지했고 payload에 그런 신호도 없다). 아키텍트가 정한 판단이라 QA에서
사용자가 뒤집을 수 있다 — 뒤집으면 `DreamCard.tsx`의 `externalConditionNote` 상수 하나만 고치면
된다. 상수와 주석을 그 목적으로 분리해 뒀다.

기존 조건 명령 안내(`DreamCard.tsx`의 "설치될 dream 잡의 조건 명령입니다…")는 그대로 뒀다. 그것은
설치 시점 확인 절차를 알려 주는 다른 문장이고, 이번 문장은 조건의 출처와 보증 범위를 밝힌다.

## 변경한 파일 (4건, 작업 범위 그대로)

- `src/features/projects/components/integrations/HeartbeatCard.tsx`
  - `runResultLabels.skipped` → `"건너뜀"`, 이유를 적은 주석.
  - `skippedReasonNote` 상수 추가(dream 카드와 글자까지 같아야 한다는 주석 포함).
  - 실행 결과 블록을 프래그먼트로 감싸고 `run.result === "skipped"`일 때 안내 문단을 붙였다.
- `src/features/projects/components/integrations/DreamCard.tsx`
  - 같은 라벨 변경과 `skippedReasonNote` 상수.
  - `externalConditionNote` 상수 추가(플랫폼 중립 판단의 근거와 뒤집는 방법을 주석에 남김).
  - 카드 본문 머리에 `externalConditionNote` 문단, 실행 결과 자리에 건너뜀 안내 문단.
- `src/features/projects/components/integrations/IntegrationsView.test.tsx`
  - `:318`의 `"건너뜀 · 처리할 대상 없음"` 단정을 새 라벨 단정으로 교체(지우지 않음). 카드 전체에
    `"처리할 대상 없음"`이 없다는 단정을 함께 넣어 검증하던 사실이 줄지 않게 했다.
  - `skippedReasonNote` 상수와 테스트 2건 추가.
- `src/features/projects/components/integrations/DreamCard.test.tsx`
  - `:421`의 같은 단정을 교체하고 `within` import 추가.
  - `skippedReasonNote`·`externalConditionNote` 상수와 테스트 3건 추가.

`IntegrationsView.tsx`·`IntegrationCard.tsx`·`types.ts`·`App.css`·백엔드는 한 줄도 바꾸지 않았다.
이 세션이 만진 Rust 파일은 없다.

## 더한 테스트 5건

`IntegrationsView.test.tsx`:

- `explains a skip with one wording shared by the role job card and the dream card` — 섹션이 두
  카드를 함께 그리는 자리에서 같은 문장이 정확히 2개인지 본다. **한쪽 카드만 고치면 개수가 1로
  떨어져 실패한다.** 두 카드가 상수를 공유하지 않는 선택을 지키는 장치다(완료 조건 20·21).
- `keeps the skip guidance out of jobs that have no run record` — 실행 기록이 없는 잡에는 안내가
  뜨지 않는다.

`DreamCard.test.tsx`:

- `says a skip may also mean the condition check never ran` — dream 카드의 안내 문장 존재.
- `does not explain a skip that did not happen` — 성공 결과와 기록 없음 두 경우에 안내가 없다.
- `says the dream condition is an external command the app does not vouch for` — 설치·미설치 두
  상태에서 모두 보이고, 문구에 `Windows`가 들어 있지 않다(완료 조건 22, R5).

## 검증

| 명령 | 결과 |
| --- | --- |
| `npm run check` (tsc + vitest + build) | 266 passed (14 파일) + 빌드 성공 |
| `cargo test --manifest-path src-tauri/Cargo.toml` | 293 passed / 0 failed |
| 대상 두 파일만 (`npx vitest run`) | 152 passed |

- 삭제·비활성화한 테스트 없음. 기존 단정 2줄만 새 라벨로 갱신했고, 두 곳 모두 검증하던 사실이 줄지
  않도록 단정을 하나씩 더했다.
- `"건너뜀 · 실행 한도 도달"`을 보는 기존 테스트 둘(`IntegrationsView.test.tsx`,
  `DreamCard.test.tsx`)은 손대지 않았고 그대로 통과한다(완료 조건 3).
- **병렬 세션 관측 — `cargo test`가 한동안 빨간 상태였다.** 09:34~09:38Z 사이 이 명령이 컴파일
  오류로 실패했다. 원인은 TASK-039 세션이 만들고 있던 신규 미추적 파일
  `src-tauri/src/infrastructure/claim_helper.rs`·`managed_script.rs`와 그 리팩터가 지나가던
  `heartbeat_condition.rs`였다(`unresolved import crate::infrastructure::managed_script`). 오류가
  24개 → 1개 → 0개로 줄어드는 것을 확인하며 재실행했고 09:39Z에 293 passed로 회복됐다. 이 세션은
  Rust 파일을 하나도 만지지 않았으므로 내 변경과 무관하다.

## 사용자 QA 제안

1. 연동 화면을 열어 역할 잡 카드에서 마지막 실행이 건너뜀인 잡을 본다. 라벨이 `건너뜀`이고 바로
   아래에 사유 안내 한 줄이 있는지 확인한다.
2. dream 카드에서 같은 문장이 같은 모양으로 보이는지 확인한다. 두 카드의 문장이 다르면 반려 사유다.
3. dream 카드 머리에서 "조건은 외부 명령이고 앱이 보증하지 않는다" 문장이 설치·미설치 어느 상태에서도
   보이는지 확인한다.
4. **플랫폼 중립 문구를 뒤집을지 판단해 달라.** Windows를 명시하는 문장을 원하면 그 결정을 QA
   코멘트에 남기면 된다. 되돌리는 지점은 `DreamCard.tsx`의 `externalConditionNote` 한 곳이다.
5. 실행 한도로 건너뛴 잡(`건너뜀 · 실행 한도 도달`)에는 이 안내가 붙지 않아야 한다. 그 사유는 앱이
   알기 때문이다.

## 리스크와 후속

1. **안내를 `skipped`에만 붙인 것은 아키텍트 문구의 해석이다.** 작업 문서가 표시 조건을 못박지
   않았고, "실행 결과가 그려지는 자리에 항상"으로 읽을 여지도 있다. QA에서 항상 표시를 원하면 두
   카드의 조건식 한 줄씩을 지우면 된다.
2. **두 카드의 문구 일치는 테스트 하나에 달려 있다.** 상수를 공유하지 않는 기존 선택을 유지했으므로,
   `IntegrationsView.test.tsx`의 대조 테스트를 지우면 다음 세션이 한쪽만 고쳐도 아무도 모른다. 그
   테스트에 목적을 적은 주석을 남겼다.
3. **문구 원문이 네 곳에 있다.** 카드 둘과 테스트 둘이다. 문장을 고치려면 네 곳을 함께 고쳐야 하고,
   빠뜨리면 대조 테스트가 잡는다.
4. **`quota_skipped` 라벨은 그대로다.** 그 값에도 "조건 검사가 실행되지 못했을 수 있다"는 성질이
   있는지는 하트비트 쪽 사실이라 이 작업에서 판단하지 않았다. 지금 계약은 "한도 소진으로 조건 검사
   전에 건너뛰었다"이고, 그 전제가 틀리면 별건이다.
5. **TASK-045와 파일이 겹친다.** 그 작업도 `IntegrationsView.test.tsx`를 만진다. 이 세션이 끝난
   시점에 그 작업은 아직 `todo`이므로, 착수하는 세션이 이 파일의 최신 상태에서 시작하면 된다.
