# 판 상태 핸드오프 (TL 스냅샷)

> 다음 세션(코덱스 포함) 팔로업용 정본. 개발 로그 전체를 읽기 전에 이 파일을 먼저 본다.
> 갱신: 2026-08-10 (blocked 자동 복구와 개발 QA·에이전트 최초 설정/실행 UX 직접 개선 완료).

## 이번 세션의 핵심 결과

1. blocked 레인의 빠진 실행 경로를 제품과 설치 규칙에 반영했다. `definition_error`는 architect, 나머지 blocked는 developer가 사용자 조작 없이 직접 선점한다. 사용자 해결 입력·재개 UI는 제거하고 과거 재개 기록 읽기만 호환용으로 유지했다. 보호 커밋은 `fcdaf1d`다.
2. 대형 워크플로우 조회가 작업마다 모든 결정 YAML을 다시 읽던 병목을 workflow당 한 번의 스캔과 graph join으로 바꿨다. Rust 701건, Clippy와 조건 스크립트 검사가 통과했다.
3. 새 blocked 경로를 실제 `TASK-S051-11`에 적용했다. developer의 범위 누락 판정→architect 정의 교정→developer 재구현을 같은 작업에서 이어 갔고, 사용자 재개 결정과 `resumed` 이력은 만들지 않았다. quota 격리와 Rust 표준 포맷은 보호 커밋 `66af7b0`에 보존됐다.
4. 개발 보드는 작업 카드를 사용자 QA 단위로 나열하지 않는다. 같은 기획서의 개발이 끝났을 때만 기능 QA 세션 하나로 묶고, 화면 확인 단계와 자동 검증 근거를 분리한다. 940px 최소 창에서도 한 흐름으로 읽힌다.
5. 에이전트 화면은 작업과 설정을 분리했다. 저장된 정책이 없으면 내부 `project_not_configured` 오류나 빈 실행 폼 대신 최초 설정 하나만 안내한다. 설정 저장 전에는 실행 계획 API를 부르지 않는다.
6. 실행 시작 조건은 선택 역할 입력이 바뀔 때 읽기 전용으로 자동 확인한다. 화면에서 고른 한 역할만 계획 요청에 보내며 실제 실행은 `에이전트 시작` 전까지 일어나지 않는다. 수동 확인·계획 취소 버튼과 내부 project id·만료 시각·6열 계획 표는 제거했다.
7. 모델은 주관식이 아니라 공급자별 선택지다. 저장은 변경이 있을 때 한 번만 누르며, 좁은 창에서는 전체 창이 아닌 에이전트 본문 폭 기준으로 4열→2열→1열 재배치된다.

## 현재 보드와 인수 기준

- blocked 작업은 0건이다.
- `TASK-S051-11`: qa_waiting. 로컬 자동 검사는 통과했다. 실제 3OS 서비스 smoke, 공식 runtime 산출물·bundle 양성 경로, 실제 Claude·Codex 로그인은 target CI 또는 사용자 환경 확인으로 남아 있다.
- `TASK-S051-09`, `TASK-S051-10`: qa_waiting. 에이전트 설정과 실행 대시보드는 이번 직접 UX 개선을 반영한 최신 앱으로 확인할 수 있다.
- `TASK-S055-04`: todo. 현재 정책과 충돌하는 “사용자 재개 조작 유지” 문구는 구현하지 않는다. 기존 저장·사건 구현을 재사용하고 남은 정의 수정 요청 UI와 활동 표시만 이어서 구현한다.
- `TASK-S052-03`, `TASK-S052-04`: 앱 사용자 QA로 completed. 앱이 만든 QA 결정은 내용을 수정하지 않고 보호한다.
- 활성 lease 없음. SPEC-009의 오래된 lease 파일은 만료된 잔여다.

## 다음 작업 순서

1. 사용자는 최신 debug 앱의 개발 화면에서 SPEC-051 기능 QA 세션을 확인한다. 에이전트가 QA 도장을 대리하지 않는다.
2. `TASK-S055-04`를 developer 역할로 선점한다. 기존 11개 값 경로와 최신 blocked 정책을 기준선으로 삼고 사용자 재개 UI를 되살리지 않는다.
3. TASK-S051-11의 공식 release 산출물·3OS 서비스 smoke는 로컬 arm64 debug 앱 확인과 구분한다. positive release path가 준비되기 전에는 fail-closed 계약을 약화하지 않는다.
4. 큰 저장소 첫 조회 성능 문제가 다시 보이면 inspect 호출 주기와 프런트 재조회 횟수를 계측한다. 현재 에이전트 UX 변경은 읽기·실행 계약과 백엔드를 바꾸지 않았다.

## 검증

- claude-heartbeat: quota 13 passed, runtime E2E 4 passed·실서비스 1 target-CI skip, 전체 284 passed·8 platform skip.
- workflow-labs Rust 최신: 본체 710 passed, `cargo fmt --check`, Clippy `-D warnings`, 런타임 계약 검증 통과.
- workflow-labs 프런트 최신: 28파일·917 passed, typecheck·production build, Agents 집중 58 passed, `git diff --check` 통과.
- 최신 debug macOS `.app`와 `.dmg` 번들 완료. 실제 앱 최초 설정·모델 선택과 940px 최소 창의 본문 기준 2열 재배치를 확인했다.

## 작업 트리와 브랜치

- workflow-labs: `claude/qa-batch-20260808`. 이번 에이전트 UX 변경과 최신 개발 기록·핸드오프를 마감 커밋으로 보호한다.
- claude-heartbeat: `claude/agent-runtime-20260808`, HEAD `66af7b0`, clean.
- main 병합·push는 하지 않았다. 릴리스 컷은 사용자 지시와 `docs/releasing.md` 절차를 따른다.
- 최신 debug 앱은 `/Users/catze/project/workflow-labs/src-tauri/target/debug/bundle/macos/LLM Workflow.app`이며 에이전트 설정 화면에 열려 있다. 정책 저장과 에이전트 시작은 수행하지 않았다.

## 운영 가드레일

- blocked 레인은 에이전트가 운영하며 사용자 해결 입력·재개 조작을 요구하지 않는다. 완성된 구현의 사용자 관문은 QA다.
- 스펙 승인과 QA 도장은 사용자 전용이며 에이전트가 대리 기록하지 않는다.
- 이전 구현·보고·검사를 인수해서 남은 차이만 고친다. 같은 저장·사건·UI 경로를 새로 만들지 않는다.
- workflow app-owned manifest, decision, runtime 상태와 사용자 동시 변경을 보호한다.
