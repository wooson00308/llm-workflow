# TASK-055 개발자 핸드오프

- 대상 작업: TASK-055 (만료된 lease가 세 분기 모두에서 대상을 막지 않게 하고 앱 판정도 같은 기준을 쓴다)
- 근거 문서: SPEC-018 R4·R5, DECISION-1224D86C (approved, created_by: user)
- 세션 역할: 개발자
- 작성 시각: 2026-08-03T10:05Z
- 상태: `qa_waiting`

## 대상 선정 근거

- 착수 시점(09:50Z) `todo` 작업 15건 중 `depends_on`이 충족된 것은 TASK-055 하나였다.
  선행 TASK-039·TASK-040이 모두 `qa_waiting`이고, 나머지 `todo`는 전부 `todo`/`in_progress`인
  선행을 기다린다. 자격 없는 작업을 `blocked`로 바꾸지 않았다(역할 계약).
- `migration.lock` 없음. 착수 시점 lease는 `SPEC-009.yml`(만료), `TASK-042.yml`, `TASK-052.yml`
  셋이고 전부 내 대상이 아니라 손대지 않았다. 만료된 `SPEC-009.yml`도 그대로 뒀다 —
  이 작업은 판정만 고치고 lease 파일 청소는 기획서 제외 범위다.
- 소스 결정 DECISION-1224D86C는 `outcome: approved`, `created_by: user`로 유효하다.
- 선점: `.workflow/rules/wf-claim.sh`가 이 저장소에 아직 설치되지 않아 공통 규칙 §4의 폴백 경로를
  썼다. `leases/TASK-055.yml` 배타 생성(`set -o noclobber`) → 즉시 `status: in_progress` +
  `history` 기록 → 구현 → 검증 → `qa_waiting` → lease 반납.

## 착수 시 저장소 상태 확인 (작업 문서 0절)

- `CONDITION_SCRIPT_VERSION`은 `2`였다. `3`으로 올렸다. 리터럴을 추정하지 않고 파일에서 읽었다.
- **TASK-042는 이미 반영돼 있었다.** `managed_script.rs`가 존재하고 조건 스크립트 본문이
  `sh`·`ps1` 둘이다. 따라서 PowerShell 본문도 이 작업의 범위에 들어갔고, 같은 판정을 양쪽에 넣었다.
- TASK-043(시나리오 표)은 아직 `todo`라 갱신할 표가 없다.
- 저장소의 `.workflow/.runtime/leases/`에서 실험하지 않았다. 모든 확인은 `tempdir()` 픽스처에서 했다.

## 구현 요약

선점 확인을 "파일이 있는가"에서 "유효한(미만료) lease가 있는가"로 바꿨다. 판정만 고쳤고 lease
파일은 읽기만 한다.

### 1. `sh` 본문 — 세 분기가 함수 하나를 부른다 (R4)

`heartbeat_condition.rs`의 `CONDITION_SCRIPT_SH`와 `scripts/wf-eligible.sh`에 `lease_blocks()`를
넣고, 흩어져 있던 `[ -f "$leases/<id>.yml" ]` 세 자리를 전부 그 호출로 바꿨다.

- `planner`: `lease_blocks "$id" && continue`
- `architect`: `if [ -n "$spec" ] && lease_blocks "$spec"; then continue; fi`
- `developer`: `lease_blocks "$tid" && continue`

분기마다 다른 판정을 두지 않았다. 같은 저장소에 두 가지 선점 개념이 생기지 않는다.

판정은 문자열 비교다. POSIX sh에 이식 가능한 날짜 파싱이 없고, 자리수가 고정된 UTC 표기는
사전순 비교가 곧 시각 비교다. `case`의 `????-??-??T??:??:??Z` 갈래에 걸리지 않는 값은 전부 기본
갈래로 떨어져 선점이 아니다 — `expires_at` 키가 없는 경우도 빈 문자열이 되어 같은 곳으로 간다.
별도 분기를 두지 않았다.

읽을 수 없는 표기를 선점으로 세지 않는 이유를 함수 주석에 남겼다. 선점 헬퍼(`wf-claim.sh`)는 같은
상황을 반대로 다루는데, 헬퍼가 지는 위험은 살아 있는 남의 lease를 인수하는 것이고 이 판정이 지는
위험은 대상이 영원히 열리지 않는 것이다. 실제 선점은 배타적 생성이 막으므로 이 판정이 관대해도
중복 선점으로 이어지지 않는다.

### 2. PowerShell 본문 — 같은 판정 (TASK-042 반영분)

`Test-Leased`가 존재 확인에서 만료 판정으로 바뀌었다. `sh`와 결론이 같아야 하므로 모양 검사도
`sh`의 `case` 글로브를 그대로 옮겼다 — `?`는 자릿수를 세지 숫자를 세지 않으므로 정규식도
`^.{4}-.{2}-.{2}T.{2}:.{2}:.{2}Z$`다. 여기서 숫자 검사로 "개선"하면 두 플랫폼의 판정이 갈린다.

비교는 `[string]::CompareOrdinal`이고, 현재 시각은 `InvariantCulture`로 포맷한다. PowerShell의
기본 문자열 비교와 기본 컬처의 시간 구분자가 판정에 끼어들지 않게 하려는 것이다. 본문은 ASCII만
쓴다는 기존 제약을 지켰다.

### 3. 앱 판정도 같은 기준 (R4·R5)

`fs_project_repository.rs`에서 만료 판정을 `read_unexpired_leases()` 한 곳으로 모았다.

- `read_active_leases`(화면 payload)와 `lease_ids`(자격 판정)가 그 함수를 나눠 쓴다.
  반환형만 다르고 "파일을 읽어 만료 전인지 가린다"는 한 단계는 하나다. 만료 규칙이 두 곳에
  생기면 이 기획서가 고치려는 문제가 같은 파일 안에서 재생산된다.
- 새로 둔 `UnexpiredLease { stem, summary }`가 두 쓰임을 잇는다. **판정 키는 파일 stem**이고
  lease 안의 `task_id`가 아니다 — 조건 스크립트가 파일 이름으로 판정하기 때문이다.
  `derive_idea_states`의 `task_id` 판정과 합치지 않았다. 목적이 다르다.
- `lease_ids`는 디렉터리를 읽지 못하면 빈 집합이다(기존과 같음). 정렬은 `read_active_leases`에
  남겨 뒀다. 판정용 집합에는 순서가 없다.
- `pending_role_work` 시그니처는 그대로다. 바뀐 것은 넘기는 집합의 내용이고,
  `role_eligibility.rs`의 인자 주석("만료를 거르지 않은")을 새 뜻으로 고쳤다.

### 4. 남는 차이를 적었다

`role_eligibility.rs` 머리의 "알려진 차이"에 넷째를 넣었다. 앱은 `expires_at`을 RFC3339로 파싱하고
스크립트는 canonical(`YYYY-MM-DDTHH:MM:SSZ`)만 읽는다. 오프셋 표기(`+09:00`)나 소수 초를 쓴 lease는
앱만 유효로 보고 스크립트는 만료로 본다. 표기 기준을 계약에 올리는 것은 TASK-059이고, 선점 헬퍼가
쓰는 lease는 이미 canonical이라 이 차이는 헬퍼 이전에 손으로 만들어진 파일에만 남는다.

## 테스트

`role_eligibility.rs`:

- `write_lease`의 시각 표기를 canonical로 바꿨다(`canonical()` 헬퍼). 기존 `to_rfc3339()`는
  `+00:00`을 내고 그 표기는 새 sh 판정이 읽지 못해 앱↔스크립트 대조가 표기 차이만으로 무너진다.
  픽스처 표기 변경이지 테스트 삭제가 아니다.
- `an_expired_lease_file_still_blocks_its_target` → `an_expired_lease_file_does_not_block_its_target`.
  결론을 뒤집고 이름을 사실에 맞췄다. 아이디어·작업·기획서 세 대상 각각에 만료 lease를 둔 상태에서
  세 역할 모두 `true`다. `active_leases`가 비어 있음도 함께 확인한다(기존 단언 유지).
  이 픽스처에서 작업의 `source_decision_id`를 뺐다 — 붙어 있으면 결정이 이미 분해된 것이 되어
  lease와 무관하게 아키텍트 자격이 없고, "세 역할 모두"를 볼 수 없다.
- `a_lease_without_a_readable_expiry_does_not_block_its_target`: `expires_at`이 없는 lease와
  시각으로 읽히지 않는 lease 각각에서 세 역할 모두 `true`.
- `judging_leaves_every_lease_file_untouched`: 판정 전후로 `leases/` 아래 파일의 개수(3)와
  `(이름, 내용)` 전체가 같다.
- 위 셋 전부 `assert_matches_condition_script`를 통과한다. 앱과 스크립트가 같은 결론을 낸다.
- 미만료 lease가 세 분기에서 대상을 막는 기존 테스트 셋(`a_leased_idea_is_not_planner_work`,
  `a_leased_spec_is_not_architect_work`, `a_leased_task_is_not_developer_work`)은 **수정 없이**
  통과한다.

`heartbeat_condition.rs`:

- 설치·갱신 안전 규칙 넷(관리 마커 없음, 버전 줄 없음, 설치본이 더 새로움, 관리본 드리프트)이 그대로
  통과한다. 버전 리터럴을 쓰는 세 자리만 `2`→`3`으로 옮겼다(설치본 대조, 이전 버전 픽스처,
  다운그레이드 오류 문구).
- 테스트 픽스처 `write_lease`가 빈 파일 대신 미만료 canonical lease를 쓴다. 이 헬퍼는 "선점된
  대상"을 만드는 용도라, 판정이 내용을 보게 된 이상 내용이 있어야 한다. 이 픽스처를 쓰는 기존
  선점 테스트 넷의 단언은 바꾸지 않았다.
- 저장소 사본 대조(`the_repository_copy_matches_the_managed_script`)와 두 본문의 버전 일치
  (`both_implementations_share_the_managed_markers_and_version`)가 통과한다.

기존 자동화 테스트를 삭제하거나 비활성화한 것은 없다. 총 306건 통과(직전 302건 + 신규 3건 + 이
세션 중 다른 세션이 추가한 1건).

## 검증

모두 최종 실행 기준으로 통과했다(2026-08-03T10:07Z).

```
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check          → 통과
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings → 통과
cargo test --manifest-path src-tauri/Cargo.toml                    → 306 passed, 0 failed
npm run check (typecheck && test && build)                          → 통과 (프론트 272 passed, 빌드 성공)
```

검증 도중 한때 `npm run check`가 `IntegrationsView.test.tsx`의 `RoleJobRequest` import 누락
(TS2304 둘)으로 막혔다. 이 작업은 `.rs`와 `.sh`만 고쳤고 TS/TSX를 한 줄도 건드리지 않았다.
병행한 다른 개발자 세션이 그 사이 고쳤고, 최종 실행에서는 통과한다.

## 핸드오프 노트 (범위 밖 발견)

1. **병행 세션이 같은 워킹 트리를 쓰는 동안 검증 결과가 흔들린다.** 이 세션의 첫 검증에서
   `heartbeat_service.rs:319`(E0061)과 `heartbeat_status.rs:218`(E0425), 뒤이어
   `heartbeat_status.rs:35`(clippy `empty_line_after_doc_comments`)가 잡혔다가, 다시 돌리니
   전부 사라졌다. 다른 세션이 편집 중이던 순간을 읽은 것이다. 검증 로그를 읽을 때 이 성질을
   감안해야 하고, 최종 판정은 위 "검증"의 마지막 실행 결과다.
2. **`.workflow/rules/wf-claim.sh`가 설치돼 있지 않다.** 공통 규칙 §4가 헬퍼를 전제하는데 실물이
   없어 모든 세션이 폴백 경로로 lease를 직접 쓴다. SPEC-013 범위로 알고 있고 이 작업에서 손대지
   않았다.
3. **`.workflow/.runtime/leases/SPEC-009.yml`이 만료된 채 남아 있다**(`2026-08-03T01:20:00Z`).
   이제 이 파일은 아키텍트 자격을 막지 않는다. 청소는 기획서 제외 범위라 그대로 뒀다.

## 리스크

- `sh`의 `[ "$a" '>' "$b" ]`는 POSIX `test`의 필수 연산자가 아니라 널리 쓰이는 확장이다.
  bash·dash·busybox ash에서 동작하고 macOS `/bin/sh`에서 테스트로 확인했다. 극단적으로 오래된
  `sh`에서는 갈릴 수 있다.
- PowerShell 본문은 이 환경에서 실행 검증하지 못했다(macOS). `sh` 본문과의 대응은 코드 대조와
  기존 대조 테스트(인터페이스·버전·ASCII)까지다. 실행 대조는 Windows에서만 가능하다.
- 조건 스크립트 버전이 3이 됐다. 이미 2를 설치한 프로젝트는 다음 설치 때 갱신된다. 사용자가
  손으로 고친 설치본은 기존 규칙대로 덮어쓰지 않는다.
- TASK-056이 같은 세 파일을 만지고 이 작업이 만든 `lease_blocks`를 그대로 쓴다. 버전 상수는
  그때 또 올라간다.

## 후속

- TASK-056: `planner` 분기의 수정 요청 결정과 아이디어 판정 규칙. 이 작업을 선행으로 둔다.
- TASK-059: lease 시각 표기 기준을 계약에 올린다. 위 "알려진 차이 4"가 그때 사라진다.
