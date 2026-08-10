# TASK-S051-06 개발 보고서

## 결정권자 요약

실제 설치 QA에서 계획은 등록 불필요라 했지만 적용은 기존 서비스와 충돌한 원인을 고쳤다.
설치 계획은 기존 서비스, 미등록, 관리형, 확인 불가를 구분하고 서비스 신원과 처리 방법을 보여 준다.
다른 기존 서비스와 확인 불가 상태에서는 등록 명령을 보내지 않고 기존 등록을 그대로 유지한다.
사용자는 적용 전에 삭제·중지·덮어쓰기·중복 등록이 없다는 사실과 이전 미리보기 경로를 확인한다.
계획 뒤 서비스 상태가 바뀌면 파일을 쓰기 전에 오래된 계획을 거절한다.
stdout에만 있던 런타임 오류도 더 이상 빈 문구로 사라지지 않는다.
전체 자동검사와 별도 앱 식별자를 쓴 실제 설치 계획 화면 QA가 통과했다.
정상 최신 앱은 에이전트 화면에 열어 두었고 작업은 사용자 QA를 기다린다.

## 변경 파일과 모듈

- `src-tauri/src/application/agent_runtime_install_service.rs`: launcher가 없을 때 번들 런타임으로
  읽기 전용 상태 조회를 재시도한다. `register`, `already_managed`, `migration_required`, `unknown`
  처분과 서비스 상태를 계획에 싣고 지문에 묶었다.
- 적용은 계획 처분만 실행한다. 미등록만 한 번 등록하고 관리형 실행 중 서비스는 건너뛰며, 다른 기존
  서비스와 확인 불가는 보존한 채 부분 결과와 안전한 다음 행동을 반환한다.
- `src-tauri/src/infrastructure/agent_runtime_process.rs`: stderr가 비면 stdout 오류 원문을 표시하고,
  서비스 등록 런타임이 앱의 stable launcher를 PATH에서 먼저 찾게 했다.
- `src/features/projects/domain/types.ts`: 설치 계획의 서비스 상태와 처분 타입을 추가했다.
- `src/features/projects/components/agents/AgentRuntimeView.tsx`: 처리 방법, 서비스 label·실행 경로,
  등록·실행 상태, 기존 등록 보존과 이전 미리보기 안내를 적용 전에 표시한다.
- `AgentRuntimeView.test.tsx`와 `useProjectWorkspace.test.ts`: 외부·확인 불가·미등록 화면과 전달
  픽스처를 보강했다. 기존 S051-11의 같은 파일 변경은 보존했다.
- TASK-S051-06은 누락된 화면 범위를 `definition_error`로 기록한 뒤 아키텍트 교정을 거쳐 같은 ID와
  이력을 보존한 채 재개했다. ARCH 보고서에 값 경로와 교정 근거를 남겼다.

## 검증 절차와 결과

- 설치 서비스 타깃 16건, 런타임 호출 타깃 9건 통과.
- Rust 라이브러리 전체 709건, 런타임 종단 17건 통과.
- 프런트 28파일 906건, TypeScript typecheck와 production build 통과.
- `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `git diff --check` 통과.
- 최신 정상 번들 생성:
  `src-tauri/target/debug/bundle/macos/LLM Workflow.app`.
- 격리 QA 번들 생성:
  `src-tauri/target/debug/bundle/macos/LLM Workflow QA.app`.
- 격리 앱에서 실제 시스템의 `com.catze.dream-heartbeat`와 Python 실행 경로, 등록 true·실행 false를
  설치 계획에 표시하고 보존·무중복등록·이전 미리보기 안내가 적용 전에 보이는 것을 확인했다.
- 격리 QA에서는 계획 생성까지만 수행했다. 정상 앱 데이터와 기존 서비스에는 변경 명령을 보내지 않았다.
- 임시 runtime 자산은 빌드 뒤 소스 트리에서 회수했고 `src-tauri/runtime`을 남기지 않았다.

## 남은 위험

- 실제 Windows·Linux 서비스 smoke와 세 target 정식 릴리스 산출물 결합은 target CI 범위다. 로컬 QA
  런타임은 화면 확인용 macOS 빌드이며 정식 universal release 근거로 사용하지 않는다.
- 외부 서비스가 있는 실기기에서 적용 버튼은 안전상 누르지 않았다. 무등록 호출 보장은 같은 실기기
  상태를 넣은 회귀검사와 호출 횟수 단언으로 고정했다.
- 격리 QA 앱은 별도 데이터 루트를 사용한다. 사용자가 정상 앱에서 이미 설치된 런타임을 지우며 첫 설치를
  재현할 필요는 없다.

## 후속 작업

- 사용자는 task의 `## 확인 동선`대로 격리 QA 앱의 설치 계획만 확인하고 승인 또는 수정 요청을 남긴다.
- TASK-S051-11의 세 운영체제 정식 runtime 릴리스 계약과 target CI 검증은 별도 작업의 남은 관문이며,
  이번 화면 교정과 섞지 않는다.
