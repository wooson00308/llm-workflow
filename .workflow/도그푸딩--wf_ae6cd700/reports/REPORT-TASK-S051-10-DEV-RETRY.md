# TASK-S051-10 재작업 개발 보고서

## 결정권자 요약

에이전트 메뉴를 실제 앱에 연결하고 실행 계획과 큐 대시보드를 구현했다.
자동·직접 배정과 한 번·반복 정책을 구분하고, 실제 시작 수와 제한·제외 사유를 확인한 뒤만 시작한다.
프로젝트 일시 정지, 실행 취소, 재시도, 상태 복원과 구조화 로그 조회를 확인 단계와 함께 연결했다.
지정 화면 검사 146건, 전체 프런트엔드 903건, 러스트 694건이 모두 통과했다.
사용자는 실제 프로젝트에서 계획을 확인한 뒤 시작·일시 정지·취소·재시도 동선을 확인하면 된다.

## 인수한 잔여 판단

- 이전 개발 세션은 범위 누락을 정의 오류로 정확히 기록했고 제품 파일은 변경하지 않았다. 기존 막힌 사유와 이력, 개발 보고서를 모두 보존했다.
- 아키텍트가 추가한 최상위 조립 파일 범위와 사전 검사 근거를 실제 코드와 대조해 그대로 받았다.
- 이전 세션이 남긴 제품 코드나 검사는 없었으므로 폐기한 잔여도 없다. 다른 활성 작업의 변경은 수정하지 않았다.

## 변경 파일과 모듈

- `src/App.tsx`: 작업 공간의 에이전트 상태와 조작을 화면 껍데기에 전달하는 두 연결을 추가했다.
- `src/features/projects/domain/types.ts`, `src/features/projects/infrastructure/tauriProjectGateway.ts`: 계획·시작·상태·일시 정지·취소·재시도·로그 계약과 Tauri 요청을 연결했다.
- `src/features/projects/application/useProjectWorkspace.ts`: 프로젝트별 실행 계획, 시작·제어 진행, 큐, 오류, 취소 미리보기, 로그 cursor를 소유하고 초기·주기 조회를 수행한다.
- `src/features/projects/components/agents/AgentRunDashboard.tsx`, `AgentRuntimeView.tsx`, `src/App.css`: 계획 확인, 역할별 상태, 큐, 일시 정지, 취소, 재시도, 로그 화면과 스타일을 추가했다.
- `src/features/projects/application/useProjectWorkspace.test.ts`, `src/features/projects/components/agents/AgentRuntimeView.test.tsx`: 수동 대상, stale plan, 프로젝트 식별자, 상태 8종, 확인 동선, 민감정보 제거를 검사했다.

## 검증 절차와 결과

- 지정 Vitest 3개 파일: 146 passed, 0 failed.
- `rg -n 'agentRuntime=|agentRuntimeActions=' src/App.tsx`: 2건을 확인했다.
- `npm run check`: 타입 검사, 26개 파일 903건, 프로덕션 빌드가 모두 통과했다.
- `cargo test --manifest-path src-tauri/Cargo.toml`: 694 passed, 0 failed.
- `git diff --check`: 통과했다.
- 수동 대상은 백엔드의 역할별 `targets` 계약으로 실행 계획에 전달되며, 런타임이 중복·lease·상태·식별자를 실행 전에 검증한다.

## 남은 위험

- 자동 검사는 macOS에서 실행했다. 실제 설치된 런타임과 provider를 사용한 유료 세션 시작은 사용자 QA에서만 확인할 수 있다.
- 빌드는 통과했지만 기존과 같이 주요 자바스크립트 묶음이 500 kB를 넘는다는 Vite 경고가 남는다.

## 후속 작업

- 사용자 QA에서 자동·직접 배정과 한 번·반복 설정의 계획 결과, 프로젝트 일시 정지, 취소 미리보기와 재시도 연결을 확인한다.
- 승인 유지를 판정하려고 연결된 결정 문서를 읽었다. 수동 배정 백엔드 지원을 확정하려고 TASK-S051-08과 SPEC-051의 계약도 추가로 대조했다.
