# TASK-S051-11 개발 보고서

## 결정권자 요약

두 저장소의 런타임 계약, 종단 검사, 릴리스 게이트와 운영 문서를 구현했다.
신규 계약 검사와 앱 전체 회귀 검사는 통과했고 런타임 전체 검사는 기존 실패 한 건만 남았다.
선행 에이전트 구현의 Rust 포맷 차이도 릴리스 필수 검사를 막고 있다.
두 실패는 이 작업의 선언 범위 밖이어서 수정하지 않고 작업을 막힘 처리했다.
선행 구현을 수리한 뒤 전체 검사와 플랫폼 릴리스 검사를 다시 실행해야 한다.

## 변경 파일과 모듈

- workflow-labs `.github/workflows/ci.yml`, `.github/workflows/release.yml`: 세 운영체제의 공통 계약 fixture 검사와 bundle 전 실제 배포물 게이트를 추가했다.
- workflow-labs `scripts/verify-agent-runtime-contract.mjs`, `package.json`: manifest 해시·target·버전·API 주 버전과 실제 contract 응답을 대조하는 명령을 추가했다.
- workflow-labs `src-tauri/tests/agent_runtime_e2e.rs`: 동일 manifest와 상태 fixture를 앱의 설치·호환 판정으로 읽는 종단 검사를 추가했다.
- workflow-labs `docs/agent-runtime.md`: 호환, 업데이트, 실행 수명, 중지·취소, 인증·비용, 복구, 레거시·Dream 경계를 기록했다.
- claude-heartbeat `.github/workflows/ci.yml`, `.github/workflows/release.yml`: provider-free 종단 검사와 실제 플랫폼 서비스 등록·강제 종료·재시작·해제 게이트를 게시 전에 추가했다.
- claude-heartbeat `tests/test_agent_end_to_end.py`: 두 프로젝트 격리, 상한, 대상 없음, migration lock, dispatcher 경합, 비밀 prompt 미저장을 가짜 CLI로 검증했다.
- claude-heartbeat `docs/agent-runtime-contract.md`: 릴리스 게이트와 서비스 smoke test 계약을 기록했다.
- `TASK-S051-11.md`: 진행 이력과 현재 막힌 사유를 기록했다.

## 검증 절차와 결과

- `npm run agent-runtime:verify`: 런타임 0.8.0, API 1, macOS universal의 실제 소스 contract와 생성 manifest 대조를 통과했다.
- `npm run agent-runtime:verify -- --self-test`: 정상 fixture 1건은 통과하고 API·target·provider 불일치 3건은 모두 거절했다.
- `npm run check`: 프론트엔드 28개 파일, 914개 검사와 생성 빌드가 통과했다.
- `cargo test --manifest-path src-tauri/Cargo.toml`: 본체 694개와 종단 17개, 총 711개 검사가 통과했다.
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`: 통과했다.
- `pytest tests/test_agent_end_to_end.py -v`: provider-free 4개 검사가 통과했고, 실제 서비스 1건은 배포물과 OS 서비스가 있는 target CI 전용이어서 로컬에서 건너뛰었다.
- `pytest tests/ -q -k 'not test_parse_heartbeat_md_max_per_field'`: 283 passed, 8 skipped, 1 deselected로 통과했다.
- `pytest tests/ -v`: 283 passed, 8 skipped, 1 failed다. `test_parse_heartbeat_md_max_per_field`는 변경 전부터 실패했고 이 세션이 `test_quota.py`와 파서 제품 코드를 수정하지 않았다.
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`: 선행 에이전트 런타임 Rust 파일 6개의 기존 포맷 차이로 실패했다. 이 세션이 추가한 Rust 종단 검사 파일 자체는 포맷 검사를 통과했다.
- Git 변경 목록으로 두 실패의 제품·검사 파일이 이 세션의 변경에 포함되지 않음을 확인했다.
- 작업 문서에 `## 범위 사전 검사` 절이 없어 릴리스 workflow와 런타임 계약 문서를 직접 대조했다. 작업 문서의 식별자만으로는 승인 유지를 판정할 수 없어 연결된 DECISION-7DD17262도 읽었다.

## 남은 위험

- 실제 macOS, Linux, Windows 서비스 smoke test와 실제 배포물과 앱 bundle 결합은 해당 target CI에서만 확인된다.
- 서비스 기능이 없는 runner는 성공으로 건너뛰지 않고 릴리스를 실패시킨다.
- 실제 Claude·Codex 로그인 확인은 유료 요청을 금지한 이 세션에서 실행하지 않았다.

## 후속 작업

- TASK-S051-05 후속에서 quota 파서 회귀 실패를 수정한다.
- TASK-S051-10 후속에서 에이전트 런타임 Rust 파일 6개의 포맷 차이를 반영한다.
- 두 전체 검사가 통과하면 TASK-S051-11을 다시 선점하고 실제 플랫폼 게이트 결과와 함께 품질 확인으로 인계한다.
