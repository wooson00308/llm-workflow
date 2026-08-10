# TASK-S051-06 아키텍트 수리 보고서

## 결정권자 요약

설치 계획 백엔드는 기존 서비스의 신원과 처리 방법을 만들지만 화면은 그 값을 버리고 있었다.
사용자 QA가 요구한 적용 전 확인을 완성하려면 화면 타입·표시·검사 네 경로가 반드시 필요하다.
작업 정의는 그 경로를 범위에서 제외하고 에이전트 화면 수정을 금지해 서로 모순됐다.
기존 승인 범위 안에서 설치 계획 화면만 열고 역할 정책과 실행 큐는 계속 손대지 않도록 교정했다.
서비스 상태·처분·보존 안내의 생성부터 화면 소비까지 값 경로를 다시 대조했다.
작업의 ID와 승인 근거, 선행 관계, 기존 이력과 막힌 사유는 그대로 보존했다.
상태는 사용자 조작 없이 `todo`로 돌렸고 개발자가 같은 구현을 바로 이어갈 수 있다.

## 교정 근거

- 직접 근거는 TASK-S051-06의 `definition_error` 막힌 사유와
  `REPORT-TASK-S051-06-DEV.md`다. 새 사용자 요청 없이 이 두 기록으로 수리했다.
- QA-196CE251은 서비스의 기존·미확인·미등록 상태, 신원과 처리 방법을 계획에 포함하고 필요 시 안전한
  복구를 화면에서 안내하라고 한다.
- 현재 Rust `InstallPlan`은 `service`와 `serviceAction`을 만들지만 `AgentInstallPlan`은 두 값을 받지
  않고, `AgentRuntimeView`는 `serviceTransitionRequired`를 필요함/없음으로만 표시했다.
- 따라서 백엔드만 QA로 보내면 계획과 적용의 표현이 다시 어긋난다는 개발 보고의 판정이 맞다.

## 정의 변경

- `scope_files`에 다음 네 경로를 추가했다.
  - `src/features/projects/domain/types.ts`
  - `src/features/projects/application/useProjectWorkspace.test.ts`
  - `src/features/projects/components/agents/AgentRuntimeView.tsx`
  - `src/features/projects/components/agents/AgentRuntimeView.test.tsx`
- `손대지 않는 것`을 설치 계획·적용 안내 밖의 역할 정책과 실행 큐 화면으로 좁혔다.
- 백엔드 계약 2번에 네 서비스 처분과 적용 전 화면 표시를 명시했다.
- 완료 조건 18~20과 검증 10~11을 추가해 신원 표시, 계획대로만 적용, 외부 서비스 보존, 상태 변경 시
  오래된 계획 거절, stdout 실패 원문 표시를 검사 가능하게 했다.
- `## 범위 사전 검사`에 생성·운반·소비 경로를 기록했다. 기존 Tauri gateway, workspace state,
  상위 조립과 CSS는 값을 바꾸지 않거나 기존 렌더링을 재사용하므로 범위에서 제외했다.

## 보존한 것

- task ID, `source_spec_id`, `source_decision_id`, `depends_on`, 기존 `history` 전부.
- `blocked_kind: definition_error`와 네 줄의 `## 막힌 사유`.
- 설치 계획 외 역할 정책·실행 큐, 기존 서비스의 자동 삭제·중지·덮어쓰기 금지.
- 제품 코드는 아키텍트 단계에서 편집하지 않았다. 앞선 개발 변경은 작업 트리에 그대로 보존했다.

## 확인 결과와 다음 소유자

- `git diff --check` 통과.
- task 상태는 `blocked`에서 `todo`로 돌아갔고 이 전환에는 history를 추가하지 않았다.
- `revision_request_id`는 넣지 않았다. 이번 교정은 이미 처리된 QA 결정의 재처리가 아니라 직접 기록된
  definition error를 근거로 한 자동 복구다.
- 다음 소유자는 TASK-S051-06 개발자다. 네 화면 경로를 구현·검사한 뒤 전체 자동검사와 최신 로컬 앱
  번들을 다시 만들어 사용자 QA로 넘긴다.
