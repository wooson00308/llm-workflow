# TASK-041 개발자 핸드오프

- 대상 작업: TASK-041 (규칙 자산과 파일 계약이 선행 선언과 선점 헬퍼를 기준으로 갱신된다)
- 근거 문서: SPEC-013 R8 전부와 R2·R3·R4·R6의 계약 문구 몫, DECISION-73D4BC1B (approved, created_by: user)
- 세션 역할: 개발자
- 작성 시각: 2026-08-03T09:19Z
- 상태: `qa_waiting`

## 대상 선정 근거

- 사용자가 병렬 작업을 승인했고 이 세션은 TASK-041 하나만 배정받았다. 다른 `todo`는 고르지 않았다.
- `migration.lock` 없음. 착수 시점(09:05Z) `.workflow/.runtime/leases/`에는 `SPEC-009.yml`(만료,
  01:20Z)과 `TASK-036.yml`(하트비트 세션 소유)만 있었다. 남의 lease는 건드리지 않았다.
- 선점: `leases/TASK-041.yml` 배타 생성(`set -C`) → 즉시 `status: in_progress` + `history` 기록 →
  구현 → `qa_waiting` → lease 반납. 선점 헬퍼(`wf-claim.sh`)는 아직 이 저장소에 없으므로(TASK-039
  미착수) 이번 규칙이 정한 폴백 경로를 그대로 따랐다.
- 소스 결정 DECISION-73D4BC1B는 `outcome: approved`, `created_by: user`로 유효하다.

## 착수 시점에 실측한 버전과 인상 결과

작업 문서 "참고 사실"의 수치(공통 4, 역할 3)는 작성 시점 값이라 낡아 있었다. 그 사이 TASK-032가
`WORKFLOW_RULES_VERSION`을 5로 올렸다(그 세션은 설치본은 앱이 갱신하도록 두었다). 그래서 문서의
숫자가 아니라 착수 시점 실측값에서 +1 했다.

| 대상 | 앱 상수(착수 시점) | 인상 후 | 설치본(착수 시점) | 설치본(현재) |
| --- | --- | --- | --- | --- |
| `WORKFLOW_RULES_VERSION` | 5 | 6 | 4 | 6 |
| `ROLE_RULES_VERSION` | 3 | 4 | planner 2 / architect 3 / developer 3 | 세 계약 모두 4 |

- 작업 문서 완료 조건이 적은 "공통 5·역할 4"는 작성 시점 기준의 숫자다. 문서의 의도는 "규칙 자산
  갱신에 버전 인상을 동반한다"이므로 실측 기준선에서 한 칸씩 올렸다. 숫자만 다르고 의도는 같다.
  만약 문서의 5를 그대로 썼다면 앱 상수가 이미 5라 인상이 없는 것과 같고, 이번 계약 변경이 설치본
  갱신을 운반하지 못한다.
- 기획자 계약도 2 → 4로 올렸다. 선점 서술이 바뀌었기 때문이다(R8이 요구하는 세 계약 정합). 본문이
  바뀌었는데 버전이 그대로면 `rules_version`이 계약 변경 표지 역할을 못 한다. 세 계약이 같은 값이
  되면서 `ROLE_RULES_VERSION`의 "기획자가 뒤처져 있어도 된다"는 주석이 낡아, 주석만 현행 사실
  ("계약별 값이 달라도 `plan_rules_file`이 파일 버전 > 상수일 때만 거부한다")로 고쳤다.
- 앱 내장 본문과 이 저장소 설치본이 바이트 단위로 같다. 상수에서 본문을 추출해 설치본에 그대로 쓴
  뒤, 같은 추출을 다시 돌려 네 파일 모두 `unchanged`인 것으로 확인했다. `plan_rules_file`이 하는
  판정(`contents == expected`)과 같은 비교다.

## 결정과 근거

1. **헬퍼의 하위 명령 이름과 인자 순서는 TASK-039 문서에서 가져왔다.** 규칙에 `acquire`·`renew`·
   `release`와 인자 형태를 적었다. 내가 새로 정하면 헬퍼 구현과 갈라진다. TASK-039가 이 이름을
   바꾸면 규칙도 같이 바꿔야 하므로 아래 리스크에 남긴다.
2. **마이그레이션 락은 종료 코드 `1`로 적었다.** R7이 락에 별도 코드를 주지 않았고 TASK-039가
   `1`로 정했다. 두 문서가 같은 말을 하게 맞췄다.
3. **`4`(인수 경합 패배)의 세션 행동을 `3`과 같게 적었다.** 둘 다 "그 대상은 남이 갖고 있다"는
   결론이 같다. 세션이 구분해야 할 것은 원인이 아니라 다음 행동이다.
4. **역할 계약에 절차를 복제하지 않았다.** 세 계약 모두 "`.workflow/rules/workflow.md` §4가
   설명하는 대로 선점한다"는 참조 한 줄이다(작업 문서 §4의 지시). 헬퍼 미설치 폴백이 §4에만
   있으므로 두 문서가 갈라질 자리를 만들지 않는다. 새 테스트가 역할 계약에 `wf-claim.sh` 문자열이
   없다는 것까지 고정한다.
5. **`role` 필드와 헬퍼의 이음매를 사실대로 적었다.** TASK-032가 넣은 문장은 "앞으로 선점하는
   세션은 `role`을 쓴다"였는데, 헬퍼는 lease 스키마를 모르는 다섯 필드만 쓴다(R7, TASK-039 범위
   밖). 그대로 두면 지킬 수 없는 지시가 되므로 그 문장의 꼬리만 "헬퍼는 필수 다섯 필드만 쓰고,
   폴백으로 세션이 직접 만들 때 `role`도 쓴다"로 고쳤다. 선택 필드라는 계약 자체는 바꾸지 않았다.
   `docs/file-contract.md`의 lease 문단에도 같은 사실을 적었다.
6. **`docs/file-contract.md`의 작업 예시 프론트매터에 `depends_on`을 넣었다.** 열 0에서 시작한다는
   형식 규정은 다른 키와 나란히 있을 때 가장 잘 보인다. `due_at`이 이미 같은 방식으로 예시에 있다.

## 변경한 파일

- `src-tauri/src/infrastructure/project_instructions.rs`
  - 버전 상수 둘과 내장 본문 네 개의 `rules_version` 리터럴 인상.
  - 공통 규칙 §4 전면 재작성: 헬퍼 경로·세 하위 명령·`<target-id>` 의미·`acquire`의 `lease_id`
    표준 출력, 종료 코드 0~5의 뜻과 각 경우 세션의 행동, "세션은 lease 파일을 직접 만들거나
    고치거나 지우지 않는다", 선점 직후 문서 상태 기록·갱신·해제 의무 유지, 헬퍼 미설치 폴백(현행
    직접 배타 생성), 헬퍼가 있는데 실행이 실패하면 선점 실패로 보고 우회 금지.
  - `developer.md`: `## Satisfied dependencies` 절 신설(R2 충족 정의와 네 갈래 미충족 조건, 판정은
    읽기 시점 파생, 미충족 작업 선택 금지와 `NO_ELIGIBLE_WORK`, `blocked`로 바꾸지 않기).
    Completion의 선점 문장을 §4 참조로 교체.
  - `architect.md`: `## Split for parallel safety` 절 신설(동시 진행 안전성 판단, 겹치는 쌍은 뒤에
    오는 작업 한쪽에만 `depends_on`, 범위 절에 만지는 파일 남기기, 순환·없는 id 금지, 겹치지 않는
    작업의 방어적 직렬화 금지). Claim first의 선점 문장을 §4 참조로 교체.
  - `planner.md`: Claim first의 선점 문장을 §4 참조로 교체.
  - 테스트: 기존 버전 단언 갱신(공통 5→6 5곳, architect 3→4 3곳, developer 3→4 3곳,
    planner 2→4 2곳), 낡은 주석 1줄 갱신, 신규 테스트
    `records_the_claim_helper_protocol_in_the_installed_rules` 추가.
- `docs/file-contract.md`
  - 역할 계약 절: 선점 서술을 헬퍼 기준으로 바꾸고 절차의 단일 정의가 §4임을 명시.
  - 개발 작업 절: 예시 프론트매터에 `depends_on` 추가, `depends_on` 형식·의미 문단과 R2 충족 정의
    문단 신설, "작업 범위가 겹치면 병렬 작업을 금지한다" 한 문장을 겹침 판단 주체·선언 방법·
    개발자의 행동으로 풀어 정리.
  - lease 문단: 헬퍼 기준으로 갱신(세 하위 명령·종료 코드 여섯·미설치 폴백·실행 실패 시 포기·앱은
    읽기만 함). TASK-032가 넣은 `role` 필드 서술은 보존하고 헬퍼가 그 필드를 쓰지 않는다는 사실만
    덧붙였다.
- `.workflow/rules/workflow.md`, `.workflow/rules/roles/{planner,architect,developer}.md`
  - 앱 내장 본문에서 그대로 추출한 설치본 갱신. 앱이 다음 승인·QA 기록에서 쓸 값과 같다.
- `.workflow/도그푸딩--wf_ae6cd700/tasks/TASK-041.md` — 상태 전이와 `history` 두 줄.

`heartbeat_condition.rs`·`wf-eligible.sh`·화면·`domain/project.rs`·`fs_project_repository.rs`는
건드리지 않았다. 작업 문서의 범위 그대로다.

## 검증

핸드오프 시점(09:16Z)과 보고서 작성 시점(09:19Z)에 각각 돌렸다. 두 시점 사이에 다른 병렬 세션이
테스트를 추가해 Rust 수치만 늘었고, 실패는 양쪽 모두 0이다.

| 명령 | 09:16Z | 09:19Z |
| --- | --- | --- |
| `cargo test --manifest-path src-tauri/Cargo.toml` | 234 passed / 0 failed | 251 passed / 0 failed |
| `npm run check` (tsc + vitest + build) | 254 passed (14 파일) + 빌드 성공 | 254 passed (14 파일) + 빌드 성공 |
| `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` | 차이 없음 | 차이 없음 |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | 경고 0 | 경고 0 |

- 삭제하거나 비활성화한 테스트 없음. 신규 1건, 기존 단언 갱신 13줄과 주석 1줄이 전부다.
- 작업 문서의 "임시 프로젝트에서 설치본 `rules_version` 확인"은 자동화 테스트가 대신한다.
  `install_project_instructions`가 tempdir에 설치한 결과를 읽는 테스트 다섯이 공통 6·역할 4를
  단언하고, 신규 테스트가 §4의 헬퍼 계약(세 하위 명령, 종료 코드 여섯, 직접 조작 금지 문장, 미설치
  폴백 문장, 우회 금지 문장)과 두 역할 계약의 새 절을 함께 고정한다.
- 설치본이 앱보다 새 버전이면 멈추는 안전 규칙 테스트(`refuses_to_downgrade_future_managed_rules`)
  와 관리 마커 검사 테스트는 수정 없이 통과한다.
- 병렬 세션 관측: 중간에 `cargo clippy --all-targets`가 `fs_project_repository.rs:1703`의 미사용
  import(`TaskDependencyState`·`TaskDocument`)로 한 번 실패했다. 내 변경과 무관한 TASK-037 작업 중
  상태였고, 재실행 시점에는 해소되어 경고 0이었다. `cargo test` 수치가 215 → 234 → 251로 는 것도
  같은 이유다.

## 리스크와 후속

1. **헬퍼 계약이 아직 문서에만 있다.** `.workflow/rules/wf-claim.sh`는 TASK-039가 만든다. 그때까지
   모든 세션은 §4의 폴백(직접 배타 생성)으로 선점한다 — 이 세션도 그렇게 했다. 규칙이 먼저 가도
   막히지 않는다는 것이 TASK-039·TASK-041 양쪽 문서의 전제였고, 실제로 막히지 않았다.
2. **TASK-039가 하위 명령 이름이나 인자 순서를 바꾸면 규칙 §4와 갈라진다.** 지금 규칙은 그 작업
   문서의 `acquire <문서-id> <에이전트> <유효분>` / `renew <문서-id> <lease-id> <유효분>` /
   `release <문서-id> <lease-id>`를 그대로 옮겼다. 구현 세션이 형태를 바꾸면 §4와 신규 테스트의
   `wf-claim.sh <subcommand>` 단언을 같은 작업에서 함께 고쳐야 한다.
3. **`depends_on` 판정 문구가 TASK-037(코드)·TASK-040(조건 스크립트)과 어긋나지 않는지 QA에서
   대조가 필요하다.** 이번 작업은 계약 문구만 담당했고 판정 코드는 만지지 않았다. 세 곳의 정의는
   모두 "선언된 id가 모두 `qa_waiting`·`completed`면 충족, 그 밖·없는 id·자기 참조·순환·목록으로
   읽을 수 없는 형식은 미충족"이어야 한다.
4. **이 저장소의 기존 작업 문서에는 `depends_on`을 소급하지 않았다.** 확정된 결정 3번이자 작업
   문서의 범위 밖이다. TASK-039처럼 아키텍트가 이미 필드를 쓴 문서만 값을 갖는다.
5. **이 보고서가 `qa_waiting` 전이보다 늦게 쓰였다.** 세션 하네스가 `.md` 보고서 작성을 막아 본문을
   지휘 세션에 텍스트로 넘겼고, 지시를 받아 같은 내용을 이 파일로 남겼다. 계약이 정한 순서(보고서
   → 전이 → lease 반납)와 어긋난 것은 이 한 건이며, 내용은 전이 시점에 확정된 것과 같다. lease는
   이미 반납된 상태라 다시 선점하지 않았다.
6. **`docs/development-logs/2026-08-03.md`에 세션 항목을 남기지 않았다.** 이 세션은 수정 범위를
   `project_instructions.rs`·`docs/file-contract.md`·설치된 규칙 파일로 제한받았고, 그 로그는
   동시에 도는 다른 세션들이 같이 쓰는 파일이다. 일일 로그 항목이 필요하면 이 보고서를 근거로
   지휘 세션이 한 번에 덧붙이는 편이 충돌이 없다.
7. **디렉터리 트리 그림은 그대로 뒀다.** `docs/file-contract.md`의 트리에는 `wf-eligible.sh`도
   없다. `wf-claim.sh`만 넣으면 오히려 불균형이라, 두 스크립트를 함께 넣는 편집은 하지 않았다.
   요청 범위 밖이라 판단했고 후속으로 남긴다.
