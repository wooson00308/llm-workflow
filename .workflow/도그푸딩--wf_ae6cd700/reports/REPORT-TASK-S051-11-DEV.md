# TASK-S051-11 개발 보고서

## 결정권자 요약

이전 런타임 계약과 검사 격리와 표준 형식 수리 결과를 그대로 보존했다.
사용자 품질 확인에서 런타임 미설치 상태의 설치 계획 행동이 사라지는 회귀를 재현하고 수리했다.
준비 상태 조회 성공값을 즉시 보존하고 후속 정책 조회 실패를 별도 오류로 남기도록 경계를 나눴다.
기존 화면의 설치 계획 행동과 계획 생성 흐름은 그대로 재사용하며 화면 컴포넌트와 QA 큐는 바꾸지 않았다.
관련 회귀와 프런트엔드 전체 검사, 계약 검증, 최신 macOS 디버그 번들 생성을 마쳤다.

## 복구 감사

- 2026-08-10에 마이그레이션 잠금, 승인 유지, 선행 상태, 겹치는 lease가 모두 개발 가능 조건임을 확인했다.
- 이전 구현과 보고서를 보존하고 교정 보고서가 추가한 범위만 이어받았다. 제품 값과 계약을 바꾸는 수정은 모두 버렸다.
- `../../Git/claude-heartbeat/tests/test_quota.py`의 HEARTBEAT 기반 파서 검사 두 건이 같은 임시 디렉터리의 jobs.d를 사용하도록 했다. 실제 사용자 jobs.d는 더 이상 검사 결과에 들어오지 않는다.
- 범위에 추가된 Rust 소스 여덟 경로에는 rustfmt 결과만 반영했다. 기능·상수·조건·검사 기대값은 바꾸지 않았다.

## 품질 확인 재작업 감사

- 앱 소유 QA-523277B2의 코멘트대로 런타임 미설치 상태에서 설치 계획 버튼 없이 다시 읽기와 같은 오류만 반복되는 현상을 재현 근거로 삼았다.
- `useProjectWorkspace.ts:260-284`는 inspection을 받은 뒤 정책까지 성공해야 두 값을 함께 저장한다. 정책 실패 catch는 기존 inspection을 갱신하지 않고 raw 오류만 저장한다.
- `AgentRuntimeView.tsx:59-76`은 inspection이 없으면 행동을 만들지 않고, launcher 실패 inspection이 있으면 `설치 계획 보기`를 만든다. 따라서 화면 컴포넌트가 아니라 hook의 부분 성공 유실이 원인이다.
- 교정된 범위에 hook과 hook 검사가 포함된 뒤, inspection을 받은 즉시 상태에 저장하고 project policy 조회만 별도 try/catch로 분리했다. 정책 조회가 실패해도 inspection은 유지되고 `reading=false`, `readError=원문 오류`가 함께 남는다.
- 신규 회귀 검사는 수정 전 inspection이 `null`인 상태로 정확히 실패했고, 수정 뒤 launcher 미설치 inspection, raw 정책 오류, 설치 계획 생성까지 통과했다.
- `AgentRuntimeView`는 inspection에서 readiness와 CTA를 먼저 렌더하고 `readError`를 그 아래 별도 상태 문단으로 렌더한다. 오류는 CTA의 조건이나 비활성 조건에 참여하지 않아 설치 안내를 가리거나 중복된 `준비 상태를 아직 읽지 않았습니다`를 만들지 않는다.
- 프로젝트 전환의 늦은 응답 guard, 정상 정책 조회, 초기화되지 않은 폴더 경로는 기존 검사와 전체 회귀에서 그대로 통과했다.

## 변경 파일과 모듈

- workflow-labs `.github/workflows/ci.yml`, `.github/workflows/release.yml`: 세 운영체제의 공통 계약 fixture 검사와 bundle 전 실제 배포물 게이트를 추가했다.
- workflow-labs `scripts/verify-agent-runtime-contract.mjs`, `package.json`: manifest 해시·target·버전·API 주 버전과 실제 contract 응답을 대조하는 명령을 추가했다.
- workflow-labs `src-tauri/tests/agent_runtime_e2e.rs`: 동일 manifest와 상태 fixture를 앱의 설치·호환 판정으로 읽는 종단 검사를 추가했다.
- workflow-labs `docs/agent-runtime.md`: 호환, 업데이트, 실행 수명, 중지·취소, 인증·비용, 복구, 레거시·Dream 경계를 기록했다.
- claude-heartbeat `.github/workflows/ci.yml`, `.github/workflows/release.yml`: provider-free 종단 검사와 실제 플랫폼 서비스 등록·강제 종료·재시작·해제 게이트를 게시 전에 추가했다.
- claude-heartbeat `tests/test_agent_end_to_end.py`: 두 프로젝트 격리, 상한, 대상 없음, migration lock, dispatcher 경합, 비밀 prompt 미저장을 가짜 CLI로 검증했다.
- claude-heartbeat `docs/agent-runtime-contract.md`: 릴리스 게이트와 서비스 smoke test 계약을 기록했다.
- claude-heartbeat `tests/test_quota.py`: 임시 HEARTBEAT 기반 검사 두 건에 임시 jobs.d를 함께 지정했다.
- workflow-labs 에이전트 런타임 Rust 소스 8개: 표준 형식만 반영했다.
- workflow-labs `src/features/projects/application/useProjectWorkspace.ts`: 런타임 검사와 정책 조회의 오류 경계를 나눠 부분 성공을 보존했다.
- workflow-labs `src/features/projects/application/useProjectWorkspace.test.ts`: launcher 미설치 inspection 뒤 정책 조회 실패와 설치 계획 흐름의 회귀 검사를 추가했다.
- `TASK-S051-11.md`: 사용자 QA 재작업 이력, 확인 동선, 품질 확인 대기 상태를 기록했다.
- `REPORT-TASK-S051-11-DEV.md`: 이전 구현·검증 결과를 보존하고 최종 재작업과 검증 근거를 추가했다.

## 검증 절차와 결과

- `pytest tests/test_quota.py -q`: 13 passed. 이전에 실패한 `(5, 86400)` 판정과 quota 없는 하위 호환 검사가 격리된 상태로 통과했다.
- `pytest tests/test_agent_end_to_end.py -v`: provider-free 4건 통과, 실제 플랫폼 서비스 1건은 배포물과 운영체제 서비스가 필요한 target CI 전용이라 로컬에서 건너뛰었다.
- `pytest tests/ -v`: 284 passed, 8 skipped. 기존 전체 검사에서 제외하거나 완화한 항목은 없다.
- `npm run agent-runtime:verify`: 런타임 0.8.0, API 1, macOS universal의 실제 소스 계약과 생성 manifest 대조를 통과했다.
- `npm run agent-runtime:verify -- --self-test`: 정상 fixture 1건은 통과하고 API·target·provider 불일치 3건은 모두 거절했다.
- `npm run check`: 프런트엔드 28개 파일, 903개 검사, 타입 검사와 생성 빌드가 통과했다. 큰 bundle 조각 경고만 남았다.
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`: 통과했다.
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`: 통과했다.
- `cargo test --manifest-path src-tauri/Cargo.toml --test agent_runtime_e2e`: 17 passed.
- `cargo test --manifest-path src-tauri/Cargo.toml`: 본체 701개와 종단 17개가 통과했다.
- 교정된 `## 범위 사전 검사`의 11개 값 경로를 실제 변경과 대조해 quota 검사 한 파일과 Rust 형식 여덟 경로만 새로 수정했음을 확인했다.
- 신규 focused hook 검사는 수정 전 launcher 미설치 inspection이 `null`로 사라져 실패했고, 수정 뒤 `npm test -- --run src/features/projects/application/useProjectWorkspace.test.ts -t '정책 조회가 실패해도 런타임 검사 결과를 보존한다'`에서 1 passed다.
- `npm test -- --run src/features/projects/application/useProjectWorkspace.test.ts`: 68 passed. 프로젝트 전환 guard, 정상 정책 조회, 초기화되지 않은 폴더를 포함한 기존 경로도 통과했다.
- `npm test -- --run src/features/projects/components/agents/AgentRuntimeView.test.tsx -t '런타임 호출 실패'`: 1 passed. launcher 실패 inspection이 전달되면 설치 계획 CTA가 표시된다.
- 회귀 상태의 렌더 경로를 다시 대조해 `실행 환경을 확인하지 못했습니다`, `설치 계획 보기`, raw 정책 오류가 함께 표시되고 설치 계획 생성이 이어짐을 확인했다.
- `npm run tauri -- build --debug`: 최신 소스로 macOS debug 앱과 DMG를 생성했다. 앱 경로는 `src-tauri/target/debug/bundle/macos/LLM Workflow.app`이다.

## 남은 위험

- 실제 macOS, Linux, Windows 서비스 smoke test와 실제 배포물과 앱 bundle 결합은 해당 target CI에서만 확인된다.
- 서비스 기능이 없는 runner는 성공으로 건너뛰지 않고 릴리스를 실패시킨다.
- 실제 Claude·Codex 로그인 확인은 유료 요청을 금지한 이 세션에서 실행하지 않았다.
- 실제 운영체제 서비스 등록·재시작·해제 검사는 로컬에 배포물이 없어 target CI 결과를 기다린다.
- 생성된 macOS debug 앱에서 실제 launcher 미설치 상태의 최종 조작 확인은 사용자 QA 동선으로 남는다.

## 후속 작업

- 사용자는 최신 debug 앱에서 launcher 미설치 결과, 설치 계획 CTA, 확인 뒤 적용 순서를 최종 확인한다.
- QA 카드 정보 구조 개선은 QA-523277B2의 코멘트와 이 작업 범위 밖이므로 별도 후속으로 남긴다.
