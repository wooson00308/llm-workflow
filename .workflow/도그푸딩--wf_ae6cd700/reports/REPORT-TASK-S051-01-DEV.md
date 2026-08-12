# TASK-S051-01 개발 보고서

## 결정권자 요약

자동 배정은 실행 전에 대상 문서와 결과 식별자를 한 번에 예약한다.
경합한 실행은 다음 후보를 다시 판단해 중복 실행을 시작하지 않는다.
예약을 받은 세션은 같은 소유권을 갱신하고 새 선점을 하지 않는다.
기존 판정 호출은 그대로 유지했고 자동 검사가 새 계약과 자산 갱신 안전성을 확인했다.
사용자는 작업 문서의 확인 동선으로 자동 검사 결과를 확인하면 된다.

## 변경 파일과 모듈

- `heartbeat_condition.rs`: 기존 표준 출력과 종료 코드를 보존한 `--json` 판정 결과를 셸과
  PowerShell 관리 본문에 추가하고 자산 버전을 올렸다.
- `reservation_helper.rs`: `wf-eligible --json`과 기존 claim 도구를 연결하는 예약 자산을 추가했다.
  경합이면 최대 32회 최신 판정을 다시 읽고, 성공 시 대상·lease·고유 접두어·역할 인계문을 반환한다.
- `fs_project_repository.rs`, `mod.rs`: 새 자산 설치와 동기화, 미래 버전 덮어쓰기 거부를 연결했다.
- `project_instructions.rs`: 공통 규칙과 세 역할 계약에 갱신 기반 인계와 접두어 충돌 방지 규칙을 추가했다.
- `managed_project_assets.rs`: 위 관리 자산 버전에 맞춰 기존 검사 기대값만 갱신했다.

## 검증 절차와 결과

- `cargo fmt --manifest-path src-tauri/Cargo.toml --check` 통과.
- `cargo test --manifest-path src-tauri/Cargo.toml` 통과: 592 passed, 0 failed.
- 새 검사는 기계 판정 JSON의 역할별 대상·후보·제외 사유, 후보 경합, 잠금 중 무예약, 인계 결과,
  미래 예약 자산 보호와 역할 계약 문구를 확인한다.

## 남은 위험

- 이 macOS 실행 환경에는 PowerShell 실행 파일이 없어 실제 Windows PowerShell 실행은 여기서
  재현하지 못했다. 동일 시나리오 표는 Windows CI에서 실행되도록 기존 검사 구조를 유지했다.

## 후속 작업

- 후속 dispatcher 작업은 이 예약 응답의 대상, lease, 결과 접두어와 역할 인계문을 소비하면 된다.
- 이 세션에서는 추가 개발 작업을 시작하지 않았다.
