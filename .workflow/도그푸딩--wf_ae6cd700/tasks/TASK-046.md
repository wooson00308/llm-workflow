---
schema: workflow-labs/task@1
id: TASK-046
title: 건너뜀 문구가 조건 검사 실행 실패를 배제하지 않게 하고 dream 조건의 비보증을 카드가 밝힌다
status: verified
source_spec_id: SPEC-015
source_decision_id: DECISION-EEEEB81D
updated_at: 2026-08-14T09:08:07.880257+00:00
history:
- at: 2026-08-03T06:50:00Z
  kind: created
- at: 2026-08-03T09:28:56Z
  kind: in_progress
- at: 2026-08-03T09:39:32Z
  kind: qa_waiting
- at: 2026-08-04T11:45:32.822054+00:00
  kind: completed
- at: 2026-08-14T09:08:07.880257+00:00
  kind: migrated_verified
work_group_id: GROUP-DECISION-EEEEB81D
work_group_revision: 1
---

# 건너뜀 문구가 조건 검사 실행 실패를 배제하지 않게 하고 dream 조건의 비보증을 카드가 밝힌다

SPEC-015 R8·R11을 구현한다. 하트비트가 `skipped`로 기록하는 상태에는 두 가지가 섞여 있다. 조건 검사가
통과하지 못한 것과 조건 검사가 **실행되지 못한** 것이다. 앱은 그 둘을 구분할 방법이 없는데, 카드는
지금 "건너뜀 · 처리할 대상 없음"으로 하나를 단정한다. 스크립트가 아예 실행되지 못한 상태에서도 화면은
"처리할 대상이 없다"고 말한다.

지금은 Windows에서 설치 자체가 막혀 있어 이 오표시가 잘 드러나지 않지만, 차단을 푸는 순간 이것이
Windows 사용자가 가장 먼저 만날 화면이 된다. D4가 이 수정을 이 범위에 둔 이유다. 다만 이 문제는
플랫폼과 무관하므로 이 작업은 다른 작업을 기다리지 않는다.

## 의존성

- 선행 작업 없음. 화면 문구만 고치고 payload도 백엔드도 건드리지 않는다.
- **TASK-045와 병행 금지.** 둘 다 `IntegrationsView.test.tsx`를 만진다. 이 작업은 실행 결과 라벨
  단정을, TASK-045는 미지원 배너 테스트를 고친다. 순서는 어느 쪽이 먼저여도 된다.
- `App.css`·`types.ts`·`WorkspaceShell.tsx`를 만지지 않으므로 SPEC-011·SPEC-012·SPEC-013 계열
  화면 작업(TASK-033·TASK-034·TASK-036·TASK-038)과 겹치는 파일이 없다.

## 범위

- `src/features/projects/components/integrations/HeartbeatCard.tsx` — `runResultLabels.skipped`와
  건너뜀 안내 한 줄.
- `src/features/projects/components/integrations/DreamCard.tsx` — 같은 두 가지와 조건 출처 표기.
- `src/features/projects/components/integrations/IntegrationsView.test.tsx` — 역할 잡 카드 쪽 테스트.
- `src/features/projects/components/integrations/DreamCard.test.tsx` — dream 카드 쪽 테스트.
- 그 외 파일은 건드리지 않는다. 특히 `IntegrationsView.tsx`·`IntegrationCard.tsx`·`types.ts`·
  `App.css`·백엔드는 이 작업에서 바뀌지 않는다.

## 작업 내용

### 0. 먼저 읽을 제약

- **앱이 사유를 알아내려 하지 않는다**(R8). 새 파일을 읽거나 명령을 실행하지 않는다. 이 작업은 문구와
  안내까지다.
- **문구는 앱이 아는 사실까지만 말한다**(R8). 앱이 아는 것은 "하트비트가 그 잡을 건너뛰었다"뿐이다.
- **두 카드가 같은 결론을 쓴다**(R8). 한쪽만 고쳐 문구가 어긋나지 않게 한다. 코드를 공유하지 않고
  문구만 맞추는 것은 `runResultLabels`가 두 파일에 따로 있는 지금 방식과 같은 선택이다.
- **`quota_skipped`는 건드리지 않는다.** "건너뜀 · 실행 한도 도달"은 앱이 아는 사실이다. 하트비트가
  그 사유를 따로 기록한다.

### 1. `skipped` 라벨

두 카드의 `runResultLabels.skipped`(`HeartbeatCard.tsx:36`, `DreamCard.tsx:38`)에서 사유를 뺀다.
라벨은 앱이 아는 사실 하나만 남긴다 — 건너뛰었다는 것.

사유를 뺀 라벨만 남기면 사용자가 "왜?"를 물을 곳이 없어지므로, 두 카드가 실행 결과를 보여주는 자리에
같은 문장 하나를 함께 그린다. 그 문장이 담아야 하는 사실은 셋이다.

- 건너뜀에는 조건 미충족과 조건 검사 실행 실패가 모두 들어간다.
- 앱은 둘 중 어느 쪽인지 모른다.
- 실제 사유는 하트비트 로그 파일에 남는다.

문장은 두 카드에서 글자까지 같아야 한다. 실행 결과가 하나도 없는 상태에서 이 안내만 떠 있지 않게,
실행 결과가 그려지는 자리에 붙인다.

### 2. dream 조건의 출처를 밝힌다

dream 잡의 조건은 앱 관리 스크립트가 아니라 외부 명령(`dream-prep check-unprocessed --slug=...`)이다.
그 명령은 이 저장소 밖 별도 패키지의 콘솔 스크립트이고, 앱은 그 동작을 보증할 수 없다. dream 카드가
그 사실을 밝힌다(R11·D3).

**문구에 OS 이름을 넣지 않는다.** D3이 이 요구를 "Windows 동작을 보증하지 않는다"로 적었지만, 앱이
보증하지 못하는 것은 플랫폼과 무관하게 그 명령 전부다. 플랫폼별로 문장을 갈라 쓰려면 화면이 실행
플랫폼을 알아야 하는데, R5가 화면 문구에서 OS 이름을 하드코딩하지 말라고 정했고 payload에는 그런
신호가 없다. 그래서 항상 보이는 한 문장으로 적는다. 이 판단은 아키텍트가 정한 것이므로 QA에서
사용자가 뒤집을 수 있다 — 보고서에 남긴다.

문장이 담아야 하는 사실은 둘이다.

- 이 잡의 조건은 앱이 관리하는 스크립트가 아니라 외부 명령이다.
- 그래서 그 명령이 동작하는지를 앱이 보증하지 않는다.

역할 잡 카드에는 이 문장을 넣지 않는다. 역할 잡의 조건은 앱 관리 자산이라 사실이 다르다.

### 3. 테스트

`IntegrationsView.test.tsx`:

- `:318`의 `"건너뜀 · 처리할 대상 없음"` 단정을 새 라벨로 고친다. 지우지 않는다.
- 역할 잡 카드에 건너뜀 안내 문장이 있고, 그 문장이 사유를 단정하지 않으며 로그에서 확인할 수 있다는
  것을 밝힌다. (완료 조건 20·21)
- `:977`의 `"건너뜀 · 실행 한도 도달"`은 그대로 통과해야 한다.

`DreamCard.test.tsx`:

- `:421`의 단정을 같은 새 라벨로 고친다.
- dream 카드의 건너뜀 안내 문장이 역할 잡 카드의 것과 같은 문자열이다. (완료 조건 20)
- dream 카드에 조건이 외부 명령이고 앱이 동작을 보증하지 않는다는 표기가 있다. (완료 조건 22)
- `:693`의 `"건너뜀 · 실행 한도 도달"`은 그대로 통과해야 한다.

두 카드의 문구가 같다는 것을 사람이 아니라 테스트가 지키게 한다. 문자열 상수를 공유하지 않는 선택이라,
한쪽만 고치는 실수를 막는 것은 테스트뿐이다.

## 완료 조건

1. 역할 잡 카드와 dream 카드의 `skipped` 라벨이 건너뜀의 사유를 단정하지 않는다.
   (기획서 완료 조건 20)
2. 두 카드가 실행 결과를 보여주는 자리에, 건너뜀에 조건 미충족과 조건 검사 실행 실패가 모두 들어가고
   실제 사유는 하트비트 로그에 남는다는 안내를 같은 문장으로 그린다. (기획서 완료 조건 20·21)
3. `quota_skipped` 라벨과 그 테스트가 이 작업 전후로 같다.
4. dream 카드가 그 잡의 조건이 외부 명령이고 앱이 동작을 보증하지 않는다는 사실을 밝힌다.
   (기획서 완료 조건 22의 표기 몫)
5. 두 카드의 문구 일치와 dream 표기를 확인하는 자동화 테스트가 있고 통과한다.
6. 기존 프런트엔드 테스트가 삭제·비활성화 없이 통과한다. 라벨이 바뀐 두 단정은 고치되, 검증하던
   사실이 줄지 않는다. (기획서 완료 조건 30)
7. `npm run check`와 `cargo test --manifest-path src-tauri/Cargo.toml`이 통과한다.
   (기획서 완료 조건 31)

## 검증 절차

```sh
npm run check
cargo test --manifest-path src-tauri/Cargo.toml
```

## 범위 밖

- 백엔드의 어떤 변경도. `skipped` 값은 하트비트가 기록하고 앱은 옮기기만 한다.
- 하트비트가 조건 불충족과 조건 실행 실패를 구분해 기록하게 만드는 것. 그 저장소의 일이다
  (기획서 제외 범위).
- 앱이 하트비트 로그 파일을 읽어 사유를 알아내는 것(R8).
- 실행 결과 이력의 구조·정렬·개수 변경.
- Windows 차단 해제와 미지원 배너 문구. TASK-045다.
- `dream-prep` 수정과 그 패키지의 Windows 동작 조사(기획서 제외 범위).
- dream 연동의 설치 안내·저장소 링크 변경.
- `App.css`의 새 클래스. 기존 스타일 안에서 해결한다.

## 참고 사실

확인 시점 2026-08-03. 추정 없이 파일에서 읽은 값이다.

- `runResultLabels`는 두 파일에 따로 있다. `HeartbeatCard.tsx:32`~`:38`, `DreamCard.tsx:34`~`:40`.
  다섯 값(`success`·`failure`·`timeout`·`skipped`·`quota_skipped`)이 같다.
- `DreamCard.tsx:41`의 주석이 두 카드의 문구를 맞추되 코드는 공유하지 않는 기존 선택을 적어 두고 있다.
- `"건너뜀 · 처리할 대상 없음"`을 단정하는 테스트는 `IntegrationsView.test.tsx:318`과
  `DreamCard.test.tsx:421` 둘이다. `"건너뜀 · 실행 한도 도달"`은 `IntegrationsView.test.tsx:977`과
  `DreamCard.test.tsx:693`이다.
- 하트비트는 조건 불충족과 조건 실행 실패를 구분해 기록하지 않는다. 둘 다 `last_run`을 갱신하고
  `last_result`를 `"skipped"`로 적는다. 사유는 로그 파일에만 남는다.
- 조건 검사의 타임아웃(10초)과 예외는 fail-closed다. 실행이 실패하면 잡을 깨우지 않고 skip한다.
- dream 잡의 조건은 `dream-prep check-unprocessed --slug=<slug>`이고 앱 관리 스크립트를 거치지 않는다.
  `dream-prep`은 이 저장소 밖 별도 패키지의 콘솔 스크립트이며 그 소스는 현재 이 머신에 없다.
- dream 카드는 `snapshot.supported`를 버튼 비활성(`:638`)과 폼 표시(`:709`)에 쓴다. 카드 자체는
  플랫폼과 무관하게 그려진다.
