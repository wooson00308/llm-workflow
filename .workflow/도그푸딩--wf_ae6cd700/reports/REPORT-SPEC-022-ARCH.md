# SPEC-022 아키텍트 핸드오프

> 기록 경위: 하네스가 서브에이전트(arch-b)의 보고서 파일 작성을 차단해, 발신된 전문을 TL이 대리 기록한다. 내용은 발신 전문 그대로다. (수신 2026-08-04T08:43Z, TL 세션)

- 역할: 프로젝트 아키텍트 (architect)
- 대상: DECISION-7A3E5B90 (SPEC-022 승인, 2026-08-04T08:52:00Z)
- 산출 작업: TASK-063, TASK-064, TASK-065 (3건, 전부 status: todo)
- 세션: 2026-08-04T08:32Z ~ 08:41Z
- lease: `lease-74221-20260804083319` 취득(exit 0) → 반납(exit 0). 반납 완료, `leases/SPEC-022.yml` 없음 확인.

## 선점과 경합

선점 시점에 파생 작업이 없는 승인 결정은 셋: DECISION-53577F93(SPEC-020), DECISION-C9B1C1D5(SPEC-021), DECISION-7A3E5B90(SPEC-022). SPEC-020은 `lease-71998-20260804082927`가 09:14:27Z까지 잡고 있어 다른 세션 몫(그 세션이 TASK-070·071을 냈다), 남은 둘 중 지시대로 SPEC-022를 잡았다. SPEC-021은 미선점으로 남아 다음 세션 대상.

기존 lease 무조치: `SPEC-009.yml`(만료)·`SPEC-020.yml`(미만료). DECISION-FEB99DAB(SPEC-010)·DECISION-2F71D20D(SPEC-014)는 파생 작업 0건이지만 `outcome: revision_requested`라 아키텍트 대상 아님. 선점 후 `source_decision_id: DECISION-7A3E5B90` 참조 작업 없음을 재확인하고 분해.

## 생성한 작업

- TASK-063 — 두 번째 slug 픽스처로 남의 잡 증발을 재현하는 회귀 테스트를 남긴다 (R4). 범위: `heartbeat_service.rs`의 `#[cfg(test)] mod tests`(`:873` 이후)만. 제품 코드 무변경.
- TASK-064 — 관리 블록 안 다른 프로젝트의 잡을 원문 그대로 보존한다 (R1·R2·R5). 범위: `heartbeat_jobs.rs`(`install_managed_jobs:141`, `render_block:168`, `plan_block:196`), `heartbeat_service.rs`(`install:363`, `install_dream:398`, `merge_block:425` 호출부), 시그니처 변경 시 `heartbeat_roles.rs`·`heartbeat_dream.rs` 테스트 헬퍼 호출부.
- TASK-065 — 저장 확인 화면 세 문장이 다른 프로젝트의 잡 보장을 밝힌다 (R3). 범위: `HeartbeatCard.tsx:1037`·`:1110`, `DreamCard.tsx:835`, `IntegrationsView.test.tsx:840`, `DreamCard.test.tsx:318`.

## 의존 지도

TASK-063 → TASK-064 → TASK-065, 그리고 TASK-065 ← TASK-062(HeartbeatCard.tsx 공유). 셋 다 직렬 — R4 테스트와 R1 구현이 같은 파일, R3 문구가 R1 보장에 매임. 순환 없음, 존재하지 않는 id 참조 없음.

- 063→064: 둘 다 `heartbeat_service.rs`를 고치고, 064의 완료 판정이 063의 테스트다.
- 064→065: 파일은 안 겹치나(rs 대 tsx) 문구가 보장을 앞지르면 화면이 지금보다 더 강한 거짓을 말한다. 이 기획서의 출발점이 화면의 거짓 약속을 믿고 데이터를 잃은 사고였다.

## 핵심 분해 결정

### 테스트를 구현과 분리하고 재현을 먼저 (유의 2)

R4 회귀 테스트를 TASK-063으로 떼고 TASK-064가 통과시키게 했다. 계약 충돌(재현 산출 시점에 테스트가 실패해야 하나 §7은 qa_waiting에 그린을 요구)은 네 테스트에 `#[ignore]`를 달고 TASK-064가 떼는 것으로 풀었다. 063 개발자는 `cargo test -- --ignored`로 실패 재현을 확인해 보고서에 남기고 기본 `cargo test`는 초록으로 넘긴다. SPEC-022 완료 조건 11은 기존 테스트 조항이라 새 테스트의 임시 표식은 걸리지 않는다고 판단, 이유를 두 작업 문서에 기록.

### jobs.d 대체 관계 (유의 1)

TASK-064에 "jobs.d 전환과의 관계 (사실 기록)" 절 — 이 보존 로직은 IDEA-CAB890F1 전환 기획서가 대체할 수 있고, TASK-063의 테스트는 전환 뒤에도 같은 계약을 검사하므로 대체되지 않는다.

### 병행 금지 확인 (유의 3)

- 하트비트 계열 5개 파일에 미커밋 v0.1.8 후보 변경이 얹혀 있으나 그 작업들은 전부 `qa_waiting`, 현재 편집 중 세션은 TASK-062 하나뿐 → Rust 작업 둘은 lease만 지키면 안전. qa_waiting이 반려로 todo 복귀 시 순서 재정 조건을 TASK-064에 기록.
- 줄 번호는 작업 트리 기준 경고를 두 문서에 삽입. SPEC-022 본문의 `HeartbeatCard.tsx:1021`·`:1094`는 실측상 `:1037`·`:1110`으로 밀렸고 TASK-062로 또 밀린다 — TASK-065는 문장 원문으로 찾을 것.
- TASK-062와 TASK-065의 `HeartbeatCard.tsx` 공유를 찾아 `depends_on: [TASK-062]`를 걸었다.

### 승인 결론 반영

- 확인 필요 2(원문 보존): TASK-064에 "렌더러를 통과시키지 말고 문자열로 보존"을 명기.
- 확인 필요 3(세 문장): TASK-065는 확인 사실 9의 세 문장만, 파일 소개 문구는 유지.

## 안 나눈 것

- 완료 조건 6(확인 화면 "지워짐" 목록 대조)은 코드 변경이 없어 TASK-065의 보고 항목으로. 대조가 어긋나면 문구를 고치지 말고 `blocked`.
- 보존 구현의 인프라/응용 분리 안 함 — `install_managed_jobs` 시그니처로 묶여 있어 나누면 하드 의존만 늘고 병렬 이득 없음.

## 구현에 남긴 판단

- `install_managed_jobs` 새 시그니처 모양: 함수가 slug를 모르므로 소유 잡 이름 집합을 넘겨야 한다는 제약까지만 명기, 모양은 구현 몫. 제품 호출부는 `heartbeat_service.rs:385`·`:417` 둘.
- 블록 안 남의 잡 자리 규칙: 원래 순서 유지 권장, 멱등성(완료 조건 10) 유지만 조건.

## 후속 / 리스크

- 네 번째 화면: dream 잡 기본값 재설정 확인(`DreamCard.tsx:765`)이 같은 모양의 약속을 한다. 승인은 "세 문장"이라 범위를 넘겨 짚지 않고 후속으로 올림. 검사 테스트는 `DreamCard.test.tsx:521`. 사용자(TL 위임) 판단 필요. → TL 결정(2026-08-04): 네 번째 문장도 TASK-065 배정 시 포함한다. 네 화면의 말이 서로 어긋나는 상태를 남기지 않기 위함이며, 사용자에게 사전 고지 후 이의 없음.
- `disabling_every_role_removes_the_block_but_keeps_the_script`(`heartbeat_service.rs:2358`~`:2374`)는 남의 잡이 없는 픽스처라 수정 뒤에도 무수정 통과해야 한다 — 깨지면 R5 위반 신호.
- 이 기기는 이미 jobs.d를 써서 수동 재현이 어렵고 판정은 Rust 테스트가 한다.

## 상태

- 보호 상태 무변경, 제품 코드 무변경(읽기만), git 커밋 없음.
- 생성 작업 셋 전부 `status: todo` + history `created`.
- lease 반납 완료.
