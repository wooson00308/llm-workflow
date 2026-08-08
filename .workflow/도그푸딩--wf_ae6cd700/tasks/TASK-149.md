---
schema: workflow-labs/task@1
id: TASK-149
title: 막힌 작업 패널에서 검증 근거를 입력하고 안전하게 재개한다
status: todo
source_spec_id: SPEC-054
source_decision_id: DECISION-DC3ED4B7
depends_on: [TASK-145, TASK-146, TASK-147, TASK-148]
scope_files: [src/App.css, src/features/projects/application/useProjectWorkspace.test.ts, src/features/projects/application/useProjectWorkspace.ts, src/features/projects/components/ActivityView.test.tsx, src/features/projects/components/ActivityView.tsx, src/features/projects/components/BlockedTaskPanel.css, src/features/projects/components/BlockedTaskPanel.test.tsx, src/features/projects/components/BlockedTaskPanel.tsx, src/features/projects/components/DevelopmentBoard.test.tsx, src/features/projects/components/DevelopmentBoard.tsx, src/features/projects/components/WorkspaceShell.test.tsx, src/features/projects/components/WorkspaceShell.tsx, src/features/projects/domain/types.ts, src/features/projects/infrastructure/tauriProjectGateway.ts]
updated_at: 2026-08-07T16:08:52Z
history:
  - { at: 2026-08-07T16:08:52Z, kind: created }
---

# 막힌 작업 패널에서 검증 근거를 입력하고 안전하게 재개한다

## 결정권자 요약

막힌 작업을 연 사용자는 현재 사유와 재개 조건을 확인하고 해결 근거를 직접 입력한다.
재개 조작은 사용자가 두 번 확인한 뒤에만 실행되며 자동으로 개발 세션을 시작하지 않는다.
문서 변경, 잠금과 선점 충돌에서는 원본을 유지하고 최신 작업을 다시 보여 준다.
재개 뒤에도 선행이나 파일 겹침이 남으면 현재 시작할 수 없는 이유를 그대로 표시한다.
재개 이력은 품질 반려와 다른 이름으로 작업 시간선과 활동 화면에 나타난다.
현재 막힌 두 런타임 작업을 실제 식별자로 검증하되 사용자의 확인 없이 상태를 바꾸지 않는다.

## 목적

SPEC-054의 R8부터 R12까지를 사용자 흐름으로 완성한다. TASK-145의 막힌 사유 패널을 확장해 해결 근거와
사용자 전용 재개 조작을 제공하고 TASK-148의 원자적 명령에 연결한다. TASK-146과 TASK-147의 검증이
준비된 뒤 TASK-S051-04와 TASK-S051-06을 첫 적용 대상으로 확인한다.

## 현재 상태와 선행 결과

- TASK-145는 유효한 막힌 사유 절, 결정권자 요약 폴백과 원문 안내를 우측 패널에 표시하고 관련 작업을
  열 수 있게 한다.
- TASK-148은 blocked 상태, stale 갱신 시각, migration lock과 대상 lease를 다시 확인하고 사용자
  감사 기록과 todo 전이를 한 요청으로 처리한다.
- TASK-146과 TASK-147은 현재 두 런타임 작업이 요구한 보완 계약과 자동 검증 근거를 제공한다.
- 현재 개발 화면은 QA 조작만 workspace callback에 연결하고 blocked 상태에서는 쓰기 조작을 제공하지
  않는다.

## 사용자 흐름

### 패널 정보와 입력

- 현재 상태가 `blocked`일 때만 TASK-145의 패널 아래에 `개발 준비로 돌리기` 영역을 표시한다.
- 조작 영역은 현재 막힌 사유, 재개 조건과 task의 `updatedAt`을 사용자가 확인할 값으로 다시 보여 준다.
  유효한 막힌 사유 절이 없으면 TASK-145가 선택한 결정권자 요약을 그대로 사용하고, 그것도 없으면
  사유를 추측하지 않은 채 원문 확인 안내를 유지한다.
- 해결 근거 입력은 필수이며 2,000자 제한, 현재 글자 수와 어떤 사실을 적어야 하는지 설명한다. 자동
  검사 결과나 보완 작업을 예시로 보여 줄 수 있지만 입력값을 자동 생성하거나 저장하지 않는다.
- TASK-S051-04에서는 TASK-146, TASK-S051-06에서는 TASK-147의 제목과 현재 상태를 참고 정보로 보여
  줄 수 있다. 상태가 준비됐다고 원래 작업을 자동 재개하지 않는다.

### 확인과 호출

- 첫 클릭은 대상 작업, 현재 갱신 시각과 입력한 근거를 확인 상태로 고정하고, 두 번째 클릭만 gateway의
  `resumeTask`를 한 번 호출한다. 진행 중에는 중복 클릭과 입력 변경을 막는다.
- 요청에는 워크플로 디렉터리, 실제 파일 이름, 화면이 읽은 `updatedAt`, 해결 근거와 조작별 요청
  식별자를 전달한다. QA outcome이나 decision callback을 재사용하지 않는다.
- 성공하면 ProjectSummary를 갱신하고 같은 작업 문서를 다시 읽어 status, 이력과 구조 판정을 최신으로
  바꾼다. 작업 상세를 닫거나 다른 작업으로 이동하지 않는다.
- stale 문서, migration lock, 활성 lease, 이미 재개됨과 저장 복구 오류는 성공으로 표시하지 않는다.
  사용자 입력을 유지한 채 오류 원인과 최신 문서를 다시 읽는 동작을 제공한다.

### 재개 뒤 표시

- 성공 상태는 `todo`이며 provider 시작, lease 획득과 `in_progress` 전이는 발생하지 않는다.
- 기존 선행 판정, dependency 형식 오류와 scope 겹침 영역을 그대로 다시 계산해 아직 시작할 수 없는
  이유가 있으면 같은 상세 화면에 표시한다.
- `resumed`를 작업 시간선과 활동 화면에서 `사용자 재개`로 표시한다. QA의 `revision_requested`는
  기존 `반려`, 개발 시작은 기존 `시작` 이름을 유지한다.
- 재개 뒤에도 마지막 `## 막힌 사유` 절은 원문에 남지만 현재 상태가 blocked가 아니므로 현재 사유
  패널과 재개 조작은 사라진다.

## 첫 적용 시나리오

- TASK-S051-04 픽스처는 TASK-146이 qa_waiting 또는 completed이고 provider 수명 자동 검사가 통과한
  근거를 사용한다. 사용자가 재개하면 todo가 되지만 dispatcher 구현 완료로 표시하지 않는다.
- TASK-S051-06 픽스처는 TASK-147이 qa_waiting 또는 completed이고 기기 상태·업데이트 자동 검사가
  통과한 근거를 사용한다. 사용자가 재개하면 todo가 되지만 앱 설치 구현 완료로 표시하지 않는다.
- 두 흐름 모두 선행 작업과 scope 판정을 다시 보여 주고 사용자가 조작하지 않은 다른 blocked 작업은
  그대로 남는다.
- 보완 작업 상태가 준비되지 않은 경우 경고와 현재 상태를 보여 주되 앱이 사실을 추측하거나 자동 전이를
  만들지 않는다. 사용자가 근거를 입력하고 확인하는 권한 경계는 유지한다.

## 손대지 않는 것

- provider 수명과 runtime 업데이트 구현
- task·감사 문서의 저장 알고리즘과 managed rules
- QA 확인·반려, 기획 승인과 일괄 QA 조작
- 자동 재개, 일괄 재개와 Heartbeat가 대신 누르는 조작
- 원래 TASK-S051-04·06의 범위, 완료 조건과 구현 상태

## 완료 조건

1. blocked 작업을 열면 현재 사유, 재개 조건, 작업 갱신 시각, 필수 해결 근거 입력과 사용자 재개 조작이
   한 패널에서 읽힌다.
2. TASK-145의 구조화 사유, 결정권자 요약 폴백과 무요약 원문 안내가 유지되며 앱이 사유를 생성하지
   않는다.
3. 빈 근거와 2,000자 초과 입력은 호출 전에 거절되고 첫 확인만으로는 gateway 호출이 발생하지 않는다.
4. 두 번째 확인은 같은 파일 이름, 화면의 갱신 시각, 입력 근거와 요청 식별자로 한 번만 호출된다.
5. 성공하면 같은 상세에서 todo와 resumed 이력이 보이고 재개 조작은 사라진다. provider, claim과
   in_progress 호출은 0회다.
6. stale 문서, migration lock, 활성 lease, 이미 재개됨과 저장 복구 실패에서 성공 표시가 없고 최신
   문서를 다시 읽을 수 있으며 task와 감사 기록은 중복되지 않는다.
7. 재개 뒤 미충족 선행, dependency 형식 오류와 scope 겹침이 있으면 기존 영역에서 현재 시작 불가
   이유가 보이고 status는 todo로 유지된다.
8. resumed는 시간선과 활동 화면에서 사용자 재개로 한 번 표시되고 QA 반려와 개발 시작의 기존 이름은
   바뀌지 않는다.
9. TASK-S051-04와 TASK-S051-06 픽스처에서 각각 대응 보완 작업과 근거를 확인해 재개하는 종단 흐름이
   통과하고 원래 작업의 본문·범위·완료 조건이 보존된다.
10. 보완 작업 상태는 참고 정보일 뿐 자동 재개를 만들지 않으며 다른 blocked 작업은 변경되지 않는다.
11. 980픽셀 이하와 넓은 화면에서 패널의 읽기·포커스 순서가 같고 긴 근거와 식별자가 잘리지 않는다.
12. 기존 QA 대기, 완료와 그 밖의 상태 패널, 일괄 QA와 관련 작업 열기 검사가 변경 전과 같이 통과한다.

## 검증 절차

1. `npx vitest run src/features/projects/components/BlockedTaskPanel.test.tsx src/features/projects/components/DevelopmentBoard.test.tsx`를 실행한다.
2. 구조화 사유, 결정권자 요약 폴백과 무요약 blocked 픽스처에서 입력·확인·오류·성공 상태를 검사한다.
3. 빈 값, 길이 초과와 첫 확인에서 호출이 0회인지, 더블 클릭과 응답 지연에서 한 번인지 확인한다.
4. stale 갱신 시각, migration lock, 활성 lease, 이미 재개됨과 복구 오류 응답을 주입해 입력 보존과 최신
   문서 재조회 동작을 확인한다.
5. 성공 응답 뒤 todo, resumed, 조작 제거와 provider·claim 비호출을 확인한다.
6. 미충족 선행, 잘못된 dependency 선언과 scope 겹침 픽스처를 재개해 기존 시작 불가 설명을 대조한다.
7. `npx vitest run src/features/projects/components/ActivityView.test.tsx src/features/projects/components/DevelopmentBoard.test.tsx`로 resumed와 기존 이벤트 이름을 확인한다.
8. TASK-S051-04·06 문서와 대응 보완 작업 상태를 가진 두 종단 픽스처에서 사용자 조작 전후 파일,
   이력과 관련 작업 표시를 대조한다.
9. 키보드만으로 입력, 첫 확인, 최종 확인, 오류 재조회와 관련 작업 열기에 순서대로 도달하는지 확인한다.
10. `npm run check`를 실행한다.

## 범위와 선행

TASK-145의 패널과 폴백을 직접 확장하고 TASK-148의 gateway 계약을 호출하므로 두 작업이 선행한다.
TASK-146과 TASK-147의 검증 근거를 이용해 현재 두 blocked 작업의 첫 적용 흐름을 확인하므로 두 작업도
선행한다. 이 작업은 이후 TASK-S051-06·09·10과 화면 기반 파일 일부가 겹치지만, 원래 blocked 체인을
재개하기 전에 먼저 완료되며 활성 lease의 scope 판정이 동시 수정을 막는다.
