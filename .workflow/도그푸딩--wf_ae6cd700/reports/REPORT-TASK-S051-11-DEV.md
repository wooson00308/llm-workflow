# TASK-S051-11 개발 보고서

## 결정권자 요약

두 저장소의 런타임 계약, 종단 검사, 릴리스 게이트와 운영 문서 구현을 보존했다.
quota 검사가 실제 사용자 설정과 격리되도록 고치고 Rust 소스 여덟 경로에 표준 형식만 반영했다.
런타임 전체 284건, 프런트 902건, Rust 본체 701건과 종단 17건을 모두 통과했다.
포맷, 정적 검사, 정상·불일치 계약 fixture도 모두 통과했으며 제품 동작은 바꾸지 않았다.
사용자는 아래 확인 동선에서 실제 CLI 실행과 로그와 취소를 확인한 뒤 품질 확인을 결정한다.

## 복구 감사

- 2026-08-10에 마이그레이션 잠금, 승인 유지, 선행 상태, 겹치는 lease가 모두 개발 가능 조건임을 확인했다.
- 이전 구현과 보고서를 보존하고 교정 보고서가 추가한 범위만 이어받았다. 제품 값과 계약을 바꾸는 수정은 모두 버렸다.
- `../../Git/claude-heartbeat/tests/test_quota.py`의 HEARTBEAT 기반 파서 검사 두 건이 같은 임시 디렉터리의 jobs.d를 사용하도록 했다. 실제 사용자 jobs.d는 더 이상 검사 결과에 들어오지 않는다.
- 범위에 추가된 Rust 소스 여덟 경로에는 rustfmt 결과만 반영했다. 기능·상수·조건·검사 기대값은 바꾸지 않았다.

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
- `TASK-S051-11.md`: 기존 이력과 막힌 사유를 보존하고 진행·품질 확인 대기 전환과 확인 동선을 기록했다.
- `REPORT-TASK-S051-11-DEV.md`: 이전 구현 결과와 복구 감사를 보존하고 최종 수리·검증 결과를 갱신했다.

## 검증 절차와 결과

- `pytest tests/test_quota.py -q`: 13 passed. 이전에 실패한 `(5, 86400)` 판정과 quota 없는 하위 호환 검사가 격리된 상태로 통과했다.
- `pytest tests/test_agent_end_to_end.py -v`: provider-free 4건 통과, 실제 플랫폼 서비스 1건은 배포물과 운영체제 서비스가 필요한 target CI 전용이라 로컬에서 건너뛰었다.
- `pytest tests/ -v`: 284 passed, 8 skipped. 기존 전체 검사에서 제외하거나 완화한 항목은 없다.
- `npm run agent-runtime:verify`: 런타임 0.8.0, API 1, macOS universal의 실제 소스 계약과 생성 manifest 대조를 통과했다.
- `npm run agent-runtime:verify -- --self-test`: 정상 fixture 1건은 통과하고 API·target·provider 불일치 3건은 모두 거절했다.
- `npm run check`: 프런트엔드 28개 파일, 902개 검사, 타입 검사와 생성 빌드가 통과했다. 큰 bundle 조각 경고만 남았다.
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`: 통과했다.
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`: 통과했다.
- `cargo test --manifest-path src-tauri/Cargo.toml --test agent_runtime_e2e`: 17 passed.
- `cargo test --manifest-path src-tauri/Cargo.toml`: 본체 701개와 종단 17개가 통과했다.
- 교정된 `## 범위 사전 검사`의 11개 값 경로를 실제 변경과 대조해 quota 검사 한 파일과 Rust 형식 여덟 경로만 새로 수정했음을 확인했다.

## 남은 위험

- 실제 macOS, Linux, Windows 서비스 smoke test와 실제 배포물과 앱 bundle 결합은 해당 target CI에서만 확인된다.
- 서비스 기능이 없는 runner는 성공으로 건너뛰지 않고 릴리스를 실패시킨다.
- 실제 Claude·Codex 로그인 확인은 유료 요청을 금지한 이 세션에서 실행하지 않았다.
- 실제 운영체제 서비스 등록·재시작·해제 검사는 로컬에 배포물이 없어 target CI 결과를 기다린다.

## 후속 작업

- macOS·Linux·Windows 릴리스 행렬에서 실제 서비스 smoke와 앱 bundle 결합 결과를 확인한다.
- 사용자는 작업 문서의 확인 동선에 따라 실제 Claude·Codex 실행, 구조화 로그, 취소 결과와 비밀값 미노출을 확인한다.
