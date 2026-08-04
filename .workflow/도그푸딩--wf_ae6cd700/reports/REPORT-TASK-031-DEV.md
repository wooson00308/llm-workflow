# TASK-031 개발자 핸드오프

- 대상 작업: TASK-031 (dream 카드가 같은 통로로 실행 한도 사용량과 미정제 대기 경고를 보여준다)
- 근거 문서: SPEC-009 R1·R2·R3·R4·R5의 dream 몫, DECISION-85491D81 (approved, created_by: user)
- 세션 역할: 개발자
- 작성 시각: 2026-08-03T06:30Z
- 상태: `qa_waiting`

## 대상 선정 근거

- 착수 시점(06:18Z) `todo`는 TASK-031~040 열 건. `.workflow/.runtime/leases`에는 SPEC-009
  (01:20Z 만료)·SPEC-013(05:55Z 만료) 둘뿐이고 **둘 다 만료 상태**라, TASK-031을 덮는 유효한
  lease는 없었다. 남의 lease는 만료됐어도 지우지 않았다.
- 선행 필수인 TASK-030은 `qa_waiting`이고, 그 산출물이 작업 트리에 실제로 있는 것을 코드에서
  확인했다: `IntegrationCard.tsx`의 `bodyWarning` prop과 `types.ts`의 `JobQuota`.
  병행 금지 상대(TASK-030, 그 선행인 TASK-028·029)는 모두 `qa_waiting`이라 동시 작업이 아니다.
- `migration.lock`은 없었다.
- 선점: `leases/TASK-031.yml` 배타 생성(`set -o noclobber`) → 즉시 `status: in_progress` +
  `history` 기록 → 구현 → `qa_waiting` → lease 반납.

## 요약

dream 카드의 잡 행에 실행 한도 사용량 줄을 더하고, 소진이면서 미정제 트랜스크립트가 남아 있을
때만 경고를 띄우며, 그 경고를 TASK-030이 연 `bodyWarning` 통로로 골격에 올렸다. 골격·뷰·타입·CSS·
백엔드는 한 줄도 건드리지 않았다. 세 번째 연동이 통로를 고치지 않고 그대로 썼다는 것이 이 작업의
결과다(기획서 완료 조건 11).

## 변경한 파일 (2건, 작업 범위 그대로)

- `src/features/projects/components/integrations/DreamCard.tsx`
  - `JobQuota` 타입 import 추가.
  - 모듈 상단에 문구 함수 넷: `quotaUsageLabel`·`localTime`·`quotaRecoveryLabel`·`quotaWarned`.
    앞의 셋은 `HeartbeatCard.tsx`의 같은 함수와 **문구가 글자까지 같다**. 코드는 공유하지 않았다 —
    작업 문서가 "표시 컴포넌트를 공유 파일로 빼지 않는다"고 못 박았고, `runResultLabels`가 두
    파일에 따로 있는 기존 선례와 같은 선택이다.
  - `quotaWarned`만 dream 고유다. 인자가 `(quota, refinement)`이고 판정은
    `counted && exhausted && unrefinedTranscripts > 0`. 역할 잡의 `pendingWork` 경로를 억지로
    공유하지 않았다(R3).
  - `JobQuotaLine` 컴포넌트 — 하트비트 카드와 같은 클래스(`heartbeat-job-quota`·
    `heartbeat-quota-usage`·`quota-exhausted`·`heartbeat-quota-exhausted`)를 쓴다. CSS가 범위 밖
    이므로 새 클래스를 만들지 않고 TASK-030이 만든 규칙을 그대로 재사용했다.
  - 잡 행에서: 실행 기록 블록 **뒤에**, 같은 `installed &&` 조건으로 사용량 줄. 실행 기록 블록은
    고치지 않았다. 그 뒤에 `IntegrationWarning` 하나.
  - `bodyWarning={false}` → `bodyWarning={quotaWarned(dream.quota, dream.refinement)}`.
    계산은 `DreamCard` 안에서 한다(하트비트 카드와 같은 자리). `snapshot`/`dream`이 없으면 `false`.
- `src/features/projects/components/integrations/DreamCard.test.tsx`
  - 픽스처 `quota` 기본값을 `{ kind: "unknown" }` → 여유 있는 `counted`(`roomyQuota`)로 바꿨다.
    `unknown`이면 새 표시가 대부분의 기존 테스트에서 안 그려져 회귀를 놓친다. 역할 잡 테스트와
    같은 선택이다.
  - `exhaustedQuota` 픽스처 추가, 새 테스트 13개(아래).

`IntegrationCard.tsx`·`IntegrationsView.tsx`·`types.ts`·`App.css`·백엔드 무변경. 이 작업이 그것을
고쳐야 했다면 통로가 특정 연동을 아는 형태였다는 뜻인데, 그런 자리는 없었다.

## 경고 문구 (R3의 넷)

> **dream 잡이 대기 중인 일을 처리하지 못하고 있습니다**
> 정제하지 않은 트랜스크립트가 2개 남아 있는데 실행 한도(24/24 · 24h 기준)가 차서, 하트비트가
> 조건 검사 전에 이 잡을 건너뜁니다.
> 8월 3일 14:20에 1회 여유 (예상)
> 더 기다리지 않으려면 이 잡의 실행 한도 칸에서 한도를 올리고 아래 저장 버튼을 누르세요.

무엇이·왜·언제·어디를 순서대로 담았고, 문장 구조는 하트비트 카드의 경고와 같다. 카드에 이미 있는
안내("미정제 수는 마킹 기준이라 한 번에 처리되는 수는 이보다 적을 수 있다")와 어긋나지 않게, 경고는
"정제할 것이 남아 있는데 잡이 안 돈다"까지만 말하고 처리 건수를 약속하지 않는다.

## 검증

```
npm run check    # tsc -b + vitest run + vite build — 전부 통과
```

- 전체: 221 tests / 13 files 통과(직전 208에서 +13), 빌드 성공. 삭제·비활성화한 테스트 없음.
- `DreamCard.test.tsx`: 55 통과(직전 42).
- 변이 검사: `quotaWarned`를 `return false`로 바꾸면 정확히 4건이 실패한다(경고 표시 / 경고 문구
  넷 / `used > limit` 경고 / 접힘 요약). 확인 후 되돌렸고 55건 재통과를 확인했다.

### 새 테스트 (기획서 완료 조건 대응)

| 테스트 | 대응 |
| --- | --- |
| 사용량이 마지막 실행 기록과 나란히 보인다 | 완료 조건 1 |
| 한도가 관리 블록 값(`3/24`)이고 앱 기본값(`/6`)이 아니다 | 완료 조건 3 |
| 소진 표시 + 회복 예상 시각(로컬 변환, "예상" 포함) | 완료 조건 4 |
| 미정제 1건 이상일 때만 경고, 0건이면 사실 표시만 | 완료 조건 5·8 |
| 경고 문구에 대상 수·원인·회복 시각·한도 올리는 자리가 모두 있다 | R3 |
| `quota_skipped` + 미정제 0건에서 경고 없음 | 완료 조건 7 |
| `noRuns`가 `실행 기록 없음 · 한도 24회/24h`이고 `0/24`가 없다 | 완료 조건 12 |
| 관리 블록 읽기 실패에서 사용량 표시 없음 | 완료 조건 13 |
| `unlimited`이 `한도 없음`이고 소진 표시·경고 없음 | 완료 조건 14 |
| `used > limit`(5/2)이 오류 없이 소진으로 보인다 | 완료 조건 15 |
| 관리 블록에 dream 잡이 없으면 사용량 없음 | R1 |
| 접힘 요약에 `확인할 경고가 있습니다`가 남는다 | 완료 조건 10·11 |
| 소진이지만 미정제 0건이면 접힘 요약에 경고 표시 없음 | R3 |

회복 시각 기대값은 화면과 같은 `Intl.DateTimeFormat("ko-KR", …)`으로 테스트에서 다시 만든다.
실행 환경의 시간대를 고정하지 않으므로 CI 시간대가 달라도 깨지지 않는다.

관리 블록 읽기 실패 테스트는 백엔드가 실제로 보내는 값(`unknown`)이 아니라 `counted` + 소진을
일부러 먹여도 사용량이 그려지지 않는지를 본다. 새 분기를 만들지 않고 잡 목록 자체가
`UnreadableManagedBlock`으로 대체돼 성립한다는 사실을 고정한 것이다(작업 문서 지시 그대로).

## 사용자 QA에서 확인할 것 (앱 실행 필요)

이 세션은 GUI를 띄우지 못해 자동화 테스트까지만 확인했다. 작업 문서의 검증 절차 그대로:

1. 연동 화면에서 dream 카드를 펼쳐 사용량이 보이는지. 관리 블록에 dream 잡이 없으면 먼저 설치한
   뒤 확인한다.
2. dream 잡 한도를 잠깐 `1/24h`로 낮춰 저장 → 소진 표시와 회복 예상 시각이 나오는지, 미정제
   트랜스크립트가 남아 있으면 경고까지 뜨는지. 확인 후 값 되돌리기.
3. 카드를 접어 요약에 `확인할 경고가 있습니다`가 남는지.
4. 같은 시각에 하트비트 카드도 함께 보아 두 카드의 사용량 문구가 같은 낱말인지(완료 조건 12).
   두 카드는 코드를 공유하지 않으므로, 이 확인은 사람 눈으로만 가능하다.

## 후속 / 리스크

- **문구 이중화가 남는다**: 사용량 문구 셋이 `HeartbeatCard.tsx`와 `DreamCard.tsx`에 같은 내용으로
  각각 있다. 작업 문서가 공유를 금지해 그대로 뒀다. 네 번째 연동이 오거나 문구를 고쳐야 할 때 두
  자리를 함께 고쳐야 한다는 사실을 남긴다. 자동 테스트로는 두 문구의 일치를 검사하지 않는다(두
  테스트 파일이 분리돼 있고, 그것을 검사하려면 공용 상수가 필요해 금지된 공유가 된다).
- **알려진 경계(TASK-030과 동일)**: `bodyWarning`은 `managedBlockFailure`를 따로 보지 않는다.
  백엔드는 그 경로에서 `unknown`을 보내므로 실제로는 발생하지 않지만, 계약이 깨져 읽기 실패 상태에
  `counted`가 오면 본문에는 아무것도 없는데 접힘 요약만 경고를 켤 수 있다. 하트비트 카드와 같은
  형태의 경계라 한쪽만 다르게 막지 않았다.
- **역할 밖 발견(고치지 않음)**: 만료된 lease 둘이 남아 있다 — `SPEC-009.yml`(01:20Z 만료),
  `SPEC-013.yml`(05:55Z 만료). 남의 lease라 건드리지 않았다. TASK-029·030 보고서도 SPEC-009를
  같은 이유로 지적했다.
- 미정제 트랜스크립트 **목록** 표시, OS 알림·배지, 사용량 이력 그래프는 기획서 제외 범위 그대로다.
- SPEC-009 계열은 이 작업으로 끝난다(TASK-028·029·030·031). 남은 `todo`는 TASK-032~040.
