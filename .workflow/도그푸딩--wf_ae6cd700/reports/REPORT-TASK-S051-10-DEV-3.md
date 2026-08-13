# TASK-S051-10 세 번째 개발 보고서

## 결정권자 요약

실행 중과 종료 뒤에 같은 경과 시간을 쓰던 표시를 상태에 맞게 분리했다.
실행 중에는 초가 움직이지 않는 분 단위 진행 시간을 보여준다.
성공·실패·취소·복구 필요 기록은 런타임 종료 시각으로 계산한 소요 시간이 더 늘지 않는다.
구형 기록도 현재 시각으로 추정하지 않으며 전체 프런트·Rust 검사를 통과했다.

## 변경 파일과 모듈

- `src-tauri/src/domain/agent_runtime.rs`: 선택적 `finishedAt`을 실행 요약에 추가하고 신·구 런타임 JSON 호환을 검사했다.
- `src/features/projects/domain/types.ts`: 화면 실행 요약 타입에 nullable 종료 시각을 연결했다.
- `src/features/projects/components/agents/AgentRunDashboard.tsx`: 실행 중 `진행 시간`과 종료 뒤 고정 `소요 시간`을 분리했다.
- `src/features/projects/components/agents/AgentRuntimeView.test.tsx`: 가짜 시각 전진, 1분 미만 종료, 분 단위 종료와 구형 기록을 검사했다.
- `TASK-S051-10.md`: 재작업 이력과 사용자 확인 동선을 현재 구현에 맞게 갱신했다.

## 검증 절차와 결과

- `npx vitest run src/features/projects/components/agents/AgentRuntimeView.test.tsx`: 64/64 통과.
- `npm run check`: TypeScript 검사, 프런트 28개 파일 930 tests와 production build 통과.
- `cargo test --manifest-path src-tauri/Cargo.toml`: Rust 본체 716개와 종단 19개 통과.
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`: 통과.
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`와 `git diff --check`: 통과.

## 남은 위험

- 실제 화면에서 기존 종료 기록까지 고정 소요 시간으로 보려면 `finishedAt`을 제공하는 런타임 v0.8.3 앱 번들이 필요하다.
- 최소 런타임과 로컬 번들 연결은 TASK-S051-11 소유이므로 이 작업에서 범위를 넓히지 않았다.

## 후속 작업

- TASK-S051-11에서 검증된 로컬 v0.8.3 런타임을 앱에 묶은 뒤 이 작업의 확인 동선을 실제 앱으로 확인한다.
- 기존 TASK-S055-04 제품 변경과 보고서는 손대지 않고 그대로 보존했다.
