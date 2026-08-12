# TASK-S051-11 정의 교정 보고서

## 결정권자 요약

기존 릴리스 검증과 앞선 검사 격리와 표준 형식 수리 결과를 보존했다.
사용자 품질 확인에서 준비 상태 성공값이 후속 정책 오류와 함께 사라지는 정의 누락을 확인했다.
수리에 필요한 작업 공간 상태 경로 두 개만 기존 작업 범위에 추가했다.
기존 화면 행동과 승인 범위는 넓히지 않고 부분 성공과 오류를 함께 보존하도록 조건을 구체화했다.
기존 식별자와 이력과 최신 막힌 사유를 보존한 채 작업을 개발 가능한 상태로 돌렸다.
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
- 작업 문서의 현재 이력 여덟 개와 막힌 사유 네 표식이 보존되고, `revision_request_id`와 `resumed`가 없음을 확인했다.
- 사용자 앱이 만든 `TASK-S052-03`, `TASK-S052-04`, `QA-4C695346`, `QA-7A99BCC2`는 읽거나 수정하지 않고 보호했다.

## 품질 확인 재교정 근거

- 앱 소유 `QA-523277B2`는 런타임 미설치 상태에서 설치 계획 행동이 사라지고 다시 읽기만 반복되는 사용자 결과를 기록했다.
- 최신 `REPORT-TASK-S051-11-DEV`는 `inspectAgentRuntime` 성공 뒤 `readAgentRuntimePolicy` 실패가 공통 catch로 들어가 inspection을 저장하지 않는 사실을 재현했다.
- `useProjectWorkspace.ts`의 `readAgentRuntime`은 inspection과 policy를 모두 받은 뒤 한 번에 상태를 저장한다. 정책 조회가 실패하면 성공한 inspection을 저장하는 호출에 도달하지 않는다.
- `AgentRuntimeView.tsx`의 `readinessOf`와 오류 영역은 inspection이 전달되면 launcher 미설치 상태의 `설치 계획 보기`와 `readError`를 동시에 표시한다. 화면 컴포넌트에는 수정할 값 경로가 없다.
- 품질 확인 큐와 카드의 정보 구조 개선은 이번 QA의 실행 차단 원인이 아니며 승인된 TASK-S051-11 범위에도 없으므로 섞지 않았다.

## 품질 확인 재교정 내용

- `scope_files`에 `src/features/projects/application/useProjectWorkspace.ts`와 `src/features/projects/application/useProjectWorkspace.test.ts`만 추가했다.
- inspection 성공 뒤 policy 실패에서도 inspection과 읽기 종료 상태를 보존하고, 정책 오류 원문을 별도 상태로 남기는 완료 조건과 검증 절차를 추가했다.
- gateway 응답부터 hook 상태, WorkspaceShell 조립, AgentRuntimeView의 설치 계획 행동과 오류 문구까지 값 경로를 추가했다. 편집이 필요 없는 gateway, 타입, 조립, 화면 컴포넌트는 코드 근거를 적고 범위에서 제외했다.
- 기존 plain 결정권자 요약 형식을 유지하면서 교정 후 현재 상태만 갱신했다.
- 작업 상태를 `todo`로 돌렸다. `id`, `source_spec_id`, `source_decision_id`, `depends_on`, 기존 `history`, `blocked_kind`, 최신 `## 막힌 사유`는 그대로 보존했고 `resumed` 이력은 추가하지 않았다.

## 품질 확인 재교정 검증

- 마이그레이션 잠금이 없고 직접 교정 전 architect 판정이 `targetId: TASK-S051-11`, `targetKind: blocked_task`, `verdict: eligible`임을 확인한 뒤 작업을 선점했다.
- `useProjectWorkspace.ts`, gateway 계약, `AgentRuntimeState`, WorkspaceShell 조립, AgentRuntimeView의 `readinessOf`와 오류 영역을 직접 읽어 수정 경계가 훅과 훅 검사 두 경로뿐임을 확인했다.
- 교정 뒤 architect 판정에서 직접 막힘 대상이 사라졌고, `scope_files`에 새로 추가한 경로가 훅과 훅 검사 두 개뿐임을 diff로 확인했다.
- 작업 문서의 plain 요약, 기존 이력 여덟 개, 최신 막힌 사유 네 표식을 보존했다. `revision_request_id`와 `resumed` 이력은 없다.
- 완료 조건 12개와 값 경로 12개를 일대일로 대조했고 `git diff --check`를 통과했다.
- `npm test -- --run src/features/projects/components/agents/AgentRuntimeView.test.tsx -t '런타임 호출 실패'`는 1건 통과해 inspection이 전달될 때 기존 설치 계획 행동이 정상임을 확인했다.
- `npm test -- --run src/features/projects/application/useProjectWorkspace.test.ts`는 67건 통과했다. inspection 성공 뒤 policy 실패 사례가 없는 현재 검사 공백은 새 완료 조건과 검증 절차가 채운다.
- 제품 코드와 앱 소유 `QA-523277B2`는 수정하지 않았다.

## 다음 인계

- developer는 `TASK-S051-11`을 새로 선점하고 `readAgentRuntime`의 inspection 성공과 policy 실패 경계를 분리한다.
- developer는 hook 회귀 검사에서 launcher 미설치 inspection, 종료된 읽기 상태, 정책 오류 원문을 함께 확인한다.
- 기존 AgentRuntimeView의 설치 계획 행동과 품질 확인 큐 정보 구조는 수정하지 않는다.
- 전체 프런트엔드 검사와 보존된 두 저장소 릴리스 계약 검증을 다시 통과한 뒤 일반 품질 확인으로 인계한다.
