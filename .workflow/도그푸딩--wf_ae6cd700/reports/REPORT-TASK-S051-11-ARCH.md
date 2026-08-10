# TASK-S051-11 정의 교정 보고서

## 결정권자 요약

남은 회귀 실패 두 건은 승인 범위의 새 기능이 아니라 기존 릴리스 검증을 끝내기 위한 수리다.
검사 격리 경로 한 개와 표준 형식 경로 여덟 개를 기존 작업 범위에 포함했다.
제품 동작은 바꾸지 않고 검사 격리와 형식 정리만 허용하도록 모순된 제약을 좁혔다.
기존 식별자와 이력과 막힌 사유를 보존한 채 작업을 개발 가능한 상태로 돌렸다.
사용자가 막힘을 재개할 필요 없이 개발 에이전트가 다음 수리를 진행한다.

## 교정 근거

- 공통 규칙 21판과 architect 계약 15판을 읽고, 마이그레이션 잠금이 없음을 확인했다.
- architect 자격 판정은 `TASK-S051-11`을 `blocked_task`로 직접 반환했다. 사용자 정의 수정 요청은 없으므로 `revision_request_id`를 추가하지 않았다.
- 승인된 `SPEC-051`과 앱 소유 결정 `DECISION-7DD17262`, 작업의 `## 막힌 사유`, `REPORT-TASK-S051-11-DEV`를 대조했다. 두 실패 수리는 승인된 완료 조건 20의 전체 자동 검사 통과를 위한 것이며 제품 요구를 추가하거나 제거하지 않는다.
- `pytest tests/test_quota.py::test_parse_heartbeat_md_max_per_field -q`를 다시 실행해 기대값 `(5, 86400)` 대신 `None`이 나오는 실패를 재현했다. `parse_heartbeat_md`가 사용자 jobs.d를 HEARTBEAT 파일보다 먼저 합치므로 제품 파서가 아니라 검사 격리 누락이 원인임을 코드로 확인했다.
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`를 다시 실행해 보고서에 기록된 8개 Rust 소스 경로 모두에서 형식 차이가 발생함을 확인했다.

## 교정 내용

- `scope_files`에 `../../Git/claude-heartbeat/tests/test_quota.py`와 Rust 소스 8개를 추가했다.
- “선행 제품 코드를 고치지 않는다”는 넓은 금지를 “제품 동작은 바꾸지 않고 검증된 검사 격리와 Rust 표준 형식만 바로잡는다”로 좁혔다.
- quota 검사 격리와 Rust 형식 전용 완료 조건을 추가하고, 전체 검사·릴리스 게이트를 그대로 유지했다.
- 완료 조건별 값 경로 11개를 `## 범위 사전 검사`에 기록했다. 제품 값이 이미 전달되는 모듈은 코드 근거와 함께 범위에서 제외했다.
- 결정권자 요약을 교정 후 상태와 최종 QA 기준에 맞게 갱신했다.
- 작업 상태를 `todo`로 돌렸다. `id`, `source_spec_id`, `source_decision_id`, `depends_on`, 기존 `history`, `blocked_kind`, `## 막힌 사유`는 그대로 보존했고 `resumed` 이력은 추가하지 않았다.

## 변경 파일

- `.workflow/도그푸딩--wf_ae6cd700/tasks/TASK-S051-11.md`
- `.workflow/도그푸딩--wf_ae6cd700/reports/REPORT-TASK-S051-11-ARCH.md`

## 검증 결과

- 마이그레이션 잠금 없음과 선점 lease 소유권을 확인했다.
- 직접 교정 전 architect 판정이 `targetId: TASK-S051-11`, `targetKind: blocked_task`, `verdict: eligible`임을 확인했다.
- quota 단일 검사 실패와 Rust 포맷 실패 8개 경로를 현재 작업 트리에서 재현했다.
- 승인 기획의 완료 조건과 교정된 작업의 완료 조건을 대조해 제품 요구의 추가·삭제가 없음을 확인했다.
- 작업 문서의 기존 이력 세 개와 막힌 사유 네 표식이 보존되고, `revision_request_id`와 `resumed`가 없음을 확인했다.
- 사용자 앱이 만든 `TASK-S052-03`, `TASK-S052-04`, `QA-4C695346`, `QA-7A99BCC2`는 읽거나 수정하지 않고 보호했다.

## 다음 인계

- developer는 `TASK-S051-11`을 새로 선점하고 quota 검사가 임시 jobs.d까지 격리하도록 수정한다.
- developer는 범위에 추가된 8개 Rust 소스에 표준 형식만 반영하고 제품 동작을 바꾸지 않는다.
- 두 저장소의 전체 검사와 릴리스 계약 검증을 다시 통과한 뒤 일반 품질 확인으로 인계한다.
