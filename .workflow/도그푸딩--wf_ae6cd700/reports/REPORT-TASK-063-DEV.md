# TASK-063 개발자 핸드오프

> 기록 경위: 하네스가 서브에이전트(dev-063)의 보고서 파일 작성을 차단해, 발신된 전문을 TL이 대리 기록한다. 내용은 발신 전문 그대로다. (수신 2026-08-04T09:00Z, TL 세션)

- 대상 작업: TASK-063 (두 번째 slug 픽스처로 남의 잡 증발을 재현하는 회귀 테스트를 남긴다)
- 근거 문서: SPEC-022 R4 / 완료 조건 1·2·3·4·5, DECISION-7A3E5B90 (outcome: approved, created_by: user)
- 세션 역할: 개발자 (dev-063)
- 작성 시각: 2026-08-04T08:52Z
- 상태: `qa_waiting` (lease 반납 완료, release exit 0)

## 대상 선정과 선점

착수 시점(08:44Z) todo, depends_on 없음. migration.lock 없음. 선점은 wf-claim.sh 헬퍼(acquire → renew → release 전부 exit 0, lease-79993-20260804084400). 하트비트 개발자와 경합 없음. 남의 lease(IDEA-4141EE4C·IDEA-CAB890F1·SPEC-009·SPEC-020) 무조치.

## 변경한 파일 (둘)

- `src-tauri/src/application/heartbeat_service.rs` — `#[cfg(test)] mod install_tests` 안에만 세 군데: `:2088` use에 managed_block 추가, `:2260`~`:2314` 픽스처 헬퍼(OTHER_SLUG, other_role_job, other_dream_job, seed_other_project_block, assert_other_project_jobs_intact), `:2578`~`:2647` 재현 테스트 4개.
- `tasks/TASK-063.md` (상태·history)

제품 코드·프런트·다른 Rust 파일 무변경, 보호 상태 무변경, git 커밋 없음.

### mod tests가 아니라 mod install_tests인 이유 (작업 문서와 어긋난 유일한 지점)

파일에 `#[cfg(test)]` 모듈이 둘(:873 tests, :2081 install_tests)인데, 저장 경로를 부르는 install/install_dream 헬퍼와 문서가 인용한 픽스처 세 곳이 전부 install_tests에 있어 그쪽에 넣었다. mod tests의 managed(body)는 형제 모듈 비공개 항목이라 접근 불가 — 가시성 수정은 범위 밖이라 seed_other_project_block()으로 대체. 제품 코드 무변경 제약(:1~:871)은 준수.

## 픽스처

다른 프로젝트 slug는 사고 당사자와 같은 `-projects-mecha-arena`. 관리 블록 안에 남의 역할 잡·dream 잡을 넣고 앱 렌더러를 통과하면 사라지는 값 셋을 심음: 모르는 필드(`- retries: 2`, `- window: 22:00-06:00`), 다른 필드 순서, 검증 불가 값(`- interval: 20분`). 이 셋이 "원문 그대로 보존"의 판정 수단.

## 재현 증거 (완료 조건 4)

`cargo test -- --ignored` → 0 passed / 4 failed / 352 filtered out.

1. 세 테스트는 :2310에서 실패 — 블록은 남는데 안이 전부 이 프로젝트 잡으로만 재작성, 남의 잡 두 구간 통째 소멸 (확인 사실 1·5).
2. turning_every_job_of_this_project_off는 :2308에서 실패 — 파일 전체가 `# HEARTBEAT\n- tick: 5m\n\n`뿐, 마커째 증발 (확인 사실 6, 사고 당일과 같은 모양).

별도 확인: 남의 잡의 `- interval: 20분`은 지금 저장을 막지 않는다(앱이 안 읽는 우연한 통과). TASK-064가 그 값을 해석하기 시작하면 PreservedJob 실패가 남의 잡에 걸려 R2가 깨진다 — 수정 뒤 이 테스트가 회귀 감시로 바뀐다.

## 완료 조건 대조

1~5 전부 충족 (픽스처, 네 경로, 원문 대조 판정 — 블록 안을 잘라 바이트 대조, --ignored 실패 재현, 기본 스위트 그린).

## 무변경 확인 (완료 조건 7·8)

미커밋 v0.1.8 변경으로 git diff가 80+ hunk라, 이번 편집 3개만 역적용한 복원본(3199줄, 착수 시점 실측 일치)과 대조: 차이는 :2086 이상 세 hunk뿐, 제품 코드 구간(head -871) 차이 없음, 삭제 줄은 use 재배치뿐, #[test] 85 → 89(+4). #[ignore]는 새 넷뿐이고 사유 명시(`SPEC-022 R1·R2: 대상 결함. TASK-064가 통과시킨다`).

## 검증 게이트 (수치)

| 게이트 | 결과 |
| --- | --- |
| cargo test | 352 passed / 0 failed / 4 ignored |
| cargo test -- --ignored | 0 passed / 4 failed (의도된 실패, 재현 성공) |
| npm run check | typecheck 통과, 15 files 355 tests, build 통과 |
| cargo fmt -- --check | 통과 (크레이트 전체 fmt은 남의 미커밋 변경을 건드려 하지 않음) |

## 후속 / 리스크

- TASK-064가 #[ignore] 넷을 뗀다 (임시 표식).
- 블록 제거 조건: "블록에 남길 남의 잡이 하나도 없을 때만 블록을 지운다"로 구현해야 기존 disabling_every_role_removes_the_block_but_keeps_the_script(남의 잡 없는 픽스처, 빈 파일 단언)와 새 테스트가 둘 다 통과한다. → TL이 TASK-064 담당에게 중계 완료.
- assert_other_project_jobs_intact는 남의 잡의 상대 위치를 강제하지 않는다(R5가 이 프로젝트 잡 순서만 정함). 순서까지 정하면 TASK-064가 단언을 좁히면 된다.
- 역할 밖 발견: 작업 문서의 "mod tests" 모듈 지정이 실제 구조와 어긋남 — TASK-064·065 분해 표현에 같은 판단이 또 필요할 수 있음.
