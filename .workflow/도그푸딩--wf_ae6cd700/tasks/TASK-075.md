---
schema: workflow-labs/task@1
id: TASK-075
title: 저장소 사본 scripts/wf-eligible.sh를 없애고 문서가 설치본 경로를 안내하게 한다
status: verified
source_spec_id: SPEC-023
source_decision_id: DECISION-9E5D2C71
updated_at: 2026-08-14T09:08:07.880257+00:00
history:
- at: 2026-08-04T09:04:00Z
  kind: created
- at: 2026-08-04T09:09:40Z
  kind: in_progress
- at: 2026-08-04T09:17:00Z
  kind: qa_waiting
- at: 2026-08-04T11:43:17.042095+00:00
  kind: completed
- at: 2026-08-14T09:08:07.880257+00:00
  kind: migrated_verified
work_group_id: GROUP-DECISION-9E5D2C71
work_group_revision: 1
---

# 저장소 사본 scripts/wf-eligible.sh를 없애고 문서가 설치본 경로를 안내하게 한다

SPEC-023 R5를 닫는다. 자격 판정이 이 저장소에 네 벌 있는데 그중 하나는 없앨 수 있다. 저장소 사본
`scripts/wf-eligible.sh`(168줄)는 앱 내장 `sh` 본문(`heartbeat_condition.rs:26`의
`CONDITION_SCRIPT_SH`)에서 관리 표기 두 줄(`# managed_by:`, `# condition_script_version:`)만 뺀
같은 파일이다(확인 사실 3). 없어져도 사용자가 잃는 기능이 없다.

이 정리는 이미 예약돼 있던 일이다. SPEC-002 확인 필요 1번이 승인과 함께 "두 산출물이 모두 존재하게
된 뒤 별도 아이디어로 다룬다"라고 미뤄 뒀고(확인 사실 12, DECISION-1265B3C7), 그 조건은 충족됐다.
SPEC-023이 그 별도 아이디어다.

## 왜 이 작업이 먼저인가

TASK-076이 조건 스크립트 본문에 사유 출력을 넣는다. 그 작업이 먼저 가면 저장소 사본까지 같이
고쳐야 한다 — `the_repository_copy_matches_the_managed_script`(`heartbeat_condition.rs:593`)가 두
파일의 문자열 동일성을 단언하므로, 본문만 바꾸면 테스트가 깨진다. 그렇게 고친 파일을 이 작업이 곧바로
지우면 그 작업은 버려진다. 순서를 뒤집으면 TASK-076은 사본을 아예 신경 쓰지 않는다.

## 승인된 확인 필요 1번

DECISION-9E5D2C71이 "없애고 `docs/heartbeat.md`가 설치본 경로(`.workflow/rules/wf-eligible.sh`)를
안내하게 고친다"를 승인했다. 승인 문서(SPEC-001 산출물) 수정을 포함한다는 비용을 인지하고 수용한
결정이다.

## 의존성

없다. 선행 작업 없이 바로 착수할 수 있다.

## 병행 안전 확인 결과

- `heartbeat_condition.rs`를 이 작업과 TASK-076이 함께 고친다. 순서는 이 작업이 먼저이고, 그 사실은
  TASK-076의 `depends_on`에 적혀 있다.
- 지금 이 파일을 편집 중인 세션은 없다. TASK-043(시나리오 표를 만든 작업)은 `qa_waiting`이다.
- `docs/heartbeat.md`와 `scripts/`를 범위에 올린 미완료 작업은 없다.

## 범위

- `scripts/wf-eligible.sh` — 삭제. `git ls-files`에 잡히는 추적 파일이다.
- `docs/heartbeat.md` — `scripts/wf-eligible.sh`를 안내하는 다섯 자리. `:9`(조건 검사 설명),
  `:25`·`:39`·`:53`(역할별 잡 예시의 `sh scripts/wf-eligible.sh <role> || exit 0`),
  `:69`·`:72`(사용법 절).
- `src-tauri/src/infrastructure/heartbeat_condition.rs` — `mod tests`(`:531`) 안의
  `the_repository_copy_matches_the_managed_script`(`:593`)와 그 테스트만 쓰는 헬퍼·import.
  **제품 코드 구간은 한 줄도 고치지 않는다.** 본문·버전 상수·설치 함수는 TASK-076의 몫이다.
- 그 외 파일은 건드리지 않는다.

## 작업 내용

- 저장소 사본을 지운다. `scripts/` 디렉터리에 다른 파일이 남아 있으면 디렉터리는 그대로 둔다.
- `docs/heartbeat.md`의 안내를 설치본 경로로 고친다. 잡 예시의 호출은
  `sh .workflow/rules/wf-eligible.sh <role> || exit 0` 형태가 된다. 이 경로는 앱이 실제로 쓰는
  값과 같다(`heartbeat_roles.rs:264`).
- **문서가 "이 파일은 앱이 설치한 뒤에야 생긴다"를 설명하게 한다.** 승인 결정이 인지한 비용이
  이것이다. 저장소를 클론만 한 사람은 그 파일을 갖지 못하므로, 안내가 없으면 문서를 따라 하다
  "파일이 없다"에서 막힌다. 어디에 어떤 문장으로 넣을지는 구현이 정하되, 사용법 절(`:67`~`:72`)이
  가장 자연스러운 자리다.
- `the_repository_copy_matches_the_managed_script`를 정리한다. 대조 대상이 사라지므로 이 테스트는
  더 이상 성립하지 않는다. **다만 삭제로 끝내지 말고, 이 테스트가 지키던 것이 무엇이었는지 판단해
  보고서에 적는다**(완료 조건 12). 그 테스트가 막던 것은 "저장소 사본이 내장 본문과 갈라지는 것"인데,
  사본이 없어지면 갈라질 대상 자체가 없다. 즉 같은 보장을 남길 새 장치가 필요하지 않다는 것이
  결론이라면 그 판단을 근거와 함께 적으면 된다. 없어진 대조를 대신할 것이 있다고 판단되면 그것을
  만든다.
- 설치본(`.workflow/rules/wf-eligible.sh`)은 건드리지 않는다. 그것은 사본이 아니라 산출물이고
  (확인 사실 2), 설치가 `CONDITION_SCRIPT_SH`를 그대로 쓴다(`heartbeat_condition.rs:482`).

## 완료 조건

1. `git ls-files scripts/wf-eligible.sh`가 빈 결과다. (SPEC-023 완료 조건 11 전반부)
2. `docs/heartbeat.md`에 `scripts/wf-eligible.sh` 문자열이 남아 있지 않다. 검증: `grep`.
   (완료 조건 11 후반부)
3. `docs/heartbeat.md`의 잡 예시 세 개가 설치본 경로를 부른다.
4. 문서가 그 파일이 앱 설치 후에 생긴다는 것을 설명한다.
5. `the_repository_copy_matches_the_managed_script`의 처리와 그 판단 근거가 보고서에 있다.
   (완료 조건 12)
6. 판정 규칙이 바뀌지 않았다. `heartbeat_condition.rs`의 제품 코드 구간(`:1`~`:495`)에 변경분이
   없음을 `git diff`로 확인해 보고서에 적는다. (R7)
7. 자격 판정 결과가 이전과 같다. 검증: 변경 전후로 `sh .workflow/rules/wf-eligible.sh <role>` 세
   역할의 종료 코드를 비교해 보고서에 적는다. (완료 조건 14)
8. 앱의 판정 결과와 설치 스크립트 종료 코드를 대조하는 테스트가 유지된다. `role_eligibility.rs`의
   `assert_matches_condition_script` 사용 단언이 36곳 그대로다. (완료 조건 13)
9. 그 밖의 기존 자동 테스트가 삭제되거나 비활성화되지 않았다. 이 작업이 정리하는 것은 대조 대상이
   사라진 테스트 하나뿐이고, 그 하나는 보고서에 이유와 함께 적는다. (완료 조건 16)
10. `npm run check`와 `cargo test --manifest-path src-tauri/Cargo.toml`이 통과한다. (완료 조건 17)

## 범위 밖

- 조건 스크립트 본문에 사유 출력을 넣는 일. TASK-076이 한다. 이 작업은 본문을 한 글자도 고치지
  않으므로 `CONDITION_SCRIPT_VERSION`(`:20`)도 올리지 않는다.
- 화면의 사유 표시. TASK-077이 한다.
- PowerShell 본문과 Rust 이식본의 통합. 실행 환경이 달라 합칠 수 없다(확인 사실 7·8, 제외 범위).
- 확인 사실 10이 열거한 이식본과 스크립트 사이의 의도된 차이 다섯.
- 자격 판정 규칙의 변경. 어떤 역할이 언제 깨어나는지는 달라지지 않는다.
- 선점 헬퍼(`wf-claim.sh`)의 사본 구조. 같은 패턴이지만 다른 자산이다.
- `docs/heartbeat.md`의 그 밖의 내용 개선. 조건 스크립트 경로 안내만 고친다.
