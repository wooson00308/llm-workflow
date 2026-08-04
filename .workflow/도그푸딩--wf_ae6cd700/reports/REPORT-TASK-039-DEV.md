# TASK-039 개발자 핸드오프

> 기록 경위: 세션 하네스가 보고서 파일 작성을 차단해, 세션이 채팅으로 보낸 전문을 TL이 그대로 기록했다.

- 대상 작업: TASK-039 (선점 헬퍼를 앱 관리 자산으로 설치하고 선점·갱신·해제를 종료 코드로 판정하게
  한다)
- 근거 문서: SPEC-013 R7, DECISION-73D4BC1B (approved, created_by: user)
- 세션 역할: 개발자 (TL 배정, 병렬 웨이브)
- 작성 시각: 2026-08-03T09:40Z
- 상태: `qa_waiting`

## 대상 선정 근거

- TL이 배정한 단일 작업이다. 착수 시점(09:24Z) `status: todo`.
- 선행 `depends_on: [TASK-037]`은 `qa_waiting`이라 충족이다. 병행 금지 상대였던 TASK-037이 끝나
  `fs_project_repository.rs`를 만질 수 있게 된 뒤에 착수했다. TASK-029·032·035도 모두 끝난 상태다.
- `migration.lock` 없음. 착수 시점 lease는 `SPEC-009.yml`(만료), `SPEC-018.yml`, `TASK-038.yml`,
  `TASK-051.yml`이었고 전부 남의 것이라 건드리지 않았다.
- 소스 결정 DECISION-73D4BC1B는 `outcome: approved`, `created_by: user`로 유효하다.
- 선점: `leases/TASK-039.yml` 배타 생성(`set -C`) → 즉시 `status: in_progress` + `history` 기록 →
  구현 → 검증 → `qa_waiting` → lease 반납. 이 작업이 만드는 헬퍼가 아직 설치돼 있지 않으므로 공통
  규칙 §4가 정한 폴백(직접 배타 생성) 경로를 썼고, `role: developer`도 함께 적었다. 작업 중 한 번
  갱신했다.

## 요약

앱이 `.workflow/rules/wf-claim.sh`를 관리 자산으로 설치한다. 헬퍼는 `acquire`·`renew`·`release`
세 동작을 제공하고 결과를 종료 코드로만 알린다. 앱은 헬퍼를 설치만 하고 부르지 않는다 — lease를
만들거나 지우거나 갱신하는 것은 여전히 세션이고, 앱은 지금처럼 읽기만 한다.

## 헬퍼의 동작 계약 (SPEC-013 R7, 공통 규칙 §4와 같은 값)

```sh
sh .workflow/rules/wf-claim.sh acquire <문서-id> <에이전트> <유효분>
sh .workflow/rules/wf-claim.sh renew   <문서-id> <lease-id> <유효분>
sh .workflow/rules/wf-claim.sh release <문서-id> <lease-id>
```

| 코드 | 뜻 |
| --- | --- |
| 0 | 성공. `acquire`는 자신이 쓴 `lease_id`를 표준 출력에 한 줄로 낸다 |
| 1 | 그 밖의 실패 (입출력 오류, 마이그레이션 락) |
| 2 | 사용법 오류 |
| 3 | 대상이 이미 미만료 lease로 선점되어 있다 |
| 4 | 만료 lease 인수 경합에서 졌다 |
| 5 | 소유자가 아니다 |

TASK-041이 규칙 §4에 적어 둔 하위 명령 이름·인자 순서·종료 코드와 한 글자씩 대조했고 모두 같다.
그 작업의 리스크 2번("구현 세션이 형태를 바꾸면 §4와 갈라진다")은 바꾸지 않았으므로 해소됐다.

### 선점의 배타 구간

- **비어 있는 대상**: `( set -C; ... > "$lease" )` 한 번. 리다이렉트 자체가 `O_EXCL`이라 동시에
  들어온 두 호출 중 하나만 성공한다.
- **파일이 있는 대상**: 인수는 읽기·판단·쓰기 세 단계라 한 번에 끝나지 않으므로 그 구간을
  `<문서-id>.yml.lock` 디렉터리로 감싼다. `mkdir`은 POSIX에서 원자적이고 이미 있으면 실패한다 —
  잠금을 못 잡은 호출이 `4`다. 잠금을 잡은 뒤 **다시 읽는다**. 배타적 생성이 실패한 시점과 잠금을
  잡은 시점 사이에 다른 호출이 인수를 끝냈을 수 있기 때문이다. 파일이 사라졌으면 새로 쓰고(0),
  미만료면 `3`, 만료면 인수한다(0).
- 잠금 디렉터리는 lease 디렉터리 안에 있고 확장자가 `yml`이 아니라 앱의 `read_active_leases`와
  조건 스크립트의 `[ -f "$leases/<id>.yml" ]` 어느 쪽에도 걸리지 않는다. 임시 파일
  (`.yml.tmp.<pid>`)도 같다.

### 시각을 다루는 방법

- 헬퍼가 쓰는 `heartbeat_at`·`expires_at`은 항상 `%Y-%m-%dT%H:%M:%SZ`다. 자리수가 고정된 UTC 표기라
  사전순 비교가 곧 시각 비교이고, 만료 판정에 RFC3339 파서를 쓰지 않는다. 같은 값은 만료로 본다
  (앱의 `expires_at > now`와 같은 경계).
- 유효분에서 만료 시각을 만들 때만 epoch를 쓰고, 되돌리는 방법이 플랫폼마다 달라 BSD(`date -r`)와
  GNU(`date -d @`) 두 갈래를 시도한다. 둘 다 실패하면 `1`이다.
- **파일의 `expires_at`이 그 정규 표기가 아니면 미만료로 다루고 `3`으로 끝낸다.** 판정하지 못하는
  남의 lease를 인수하는 쪽이 더 위험하다. 앱은 오프셋 표기도 파싱하므로 그런 파일에서는 앱과
  헬퍼의 판정이 갈릴 수 있고, 그 사실을 헬퍼 머리 주석에 적었다.

### 갱신·해제

- 둘 다 파일의 `lease_id`가 제시한 값과 정확히 같을 때만 동작한다. 다르면 아무것도 하지 않고 `5`,
  파일이 없어도 `5`(현재 소유자가 아니라는 결론이 같다).
- 잠금을 쓰지 않는다. 겨루는 상대인 인수는 만료된 lease에만 일어나고, 인수당한 세션은 여기서
  `lease_id`가 달라 `5`를 받는다. 이것이 "인수당한 세션이 뒤늦게 끝나면서 새 소유자의 lease를
  지우는" 경로를 막는다.
- **갱신은 `heartbeat_at`·`expires_at` 두 줄만 바꾸고 나머지 줄은 원문 그대로 옮긴다.** 작업 문서
  §5의 "`agent`·`task_id`·`lease_id`는 원래 값을 그대로 옮긴다"를 줄 단위 치환으로 구현했다. 다섯
  필드를 다시 조립하면 계약이 허용하는 선택 필드(TASK-032가 넣은 `role`)가 갱신마다 사라진다.
  이 저장소의 살아 있는 lease는 전부 `role`을 갖고 있어 실제로 드러날 회귀였다. 테스트로 고정했다.
- 마이그레이션 락은 세 동작을 모두 막는다(작업 문서 §6). 사용법 오류를 락보다 먼저 보는데, 그
  오류는 락과 무관하게 같은 인자로 다시 실패하기 때문이다.

## 변경한 파일 (3건, 작업 범위 그대로)

- `src-tauri/src/infrastructure/claim_helper.rs` — 신규. 헬퍼 본문 상수(`CLAIM_HELPER`),
  `CLAIM_HELPER_VERSION`, `ClaimHelperError`(5갈래), `claim_helper_path`, `install_claim_helper`,
  `validate_claim_helper`, `plan_claim_helper`, 테스트 21건.
- `src-tauri/src/infrastructure/mod.rs` — `pub mod claim_helper;` 한 줄.
- `src-tauri/src/infrastructure/fs_project_repository.rs` — import, `ProjectError::ClaimHelper`
  변형(`#[error(transparent)]`), 설치 호출 3곳(`create_workflow`·`record_spec_decision`·
  `record_task_qa`)과 검증 호출 1곳(`create_workflow`), 테스트 3건.

`heartbeat_condition.rs`·`heartbeat_service.rs`·`project_instructions.rs`·`docs/file-contract.md`·
화면은 건드리지 않았다. 저장소에 `scripts/wf-claim.sh` 사본을 두지 않았다(작업 문서 §7).

설치본 `.workflow/rules/wf-claim.sh`는 이 저장소에 아직 없다. `inspect`에 설치를 넣지 않았으므로
(작업 문서 §7) 앱이 다음 워크플로우 생성·기획서 결정·QA 기록에서 설치한다. 그때까지 세션은 규칙
§4의 폴백으로 선점한다 — 이 세션도 그렇게 했다.

## 검증

작업 문서의 검증 절차 그대로 실행했다. 마지막 실행은 09:39Z이고, 그 시점 트리에는 병렬 세션
(dev-040, SPEC-015)의 착지 중 변경이 함께 들어 있다.

| 명령 | 결과 |
| --- | --- |
| `cargo test --manifest-path src-tauri/Cargo.toml` | 293 passed / 0 failed / 0 ignored |
| `npm run check` | 266 passed (14 files), `tsc -b && vite build` 통과 |
| `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` | 내 파일 3건 차이 없음 |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | 내 파일 경고 0 |

뒤의 두 줄에 단서를 단다. 09:39Z 시점에 `cargo fmt --check`는 `heartbeat_condition.rs`와
`managed_script.rs`에서, `clippy -D warnings`는 `managed_script.rs`의 미사용 상수·메서드 둘에서
걸린다. 세 파일 모두 dev-040이 같은 시각 착지 중인 SPEC-015 작업의 것이고 내 변경과 무관하다.
그쪽 파일을 정렬하거나 고치지 않으려고 `cargo fmt`(쓰기)는 돌리지 않았다. **내 변경만 있던
09:34Z 시점에는 네 명령이 모두 통과했다: `cargo test` 286 passed / 0 failed, `fmt --check` 차이
없음, `clippy -D warnings` 경고 0, `npm run check` 266 passed + 빌드 성공.**

삭제하거나 비활성화한 테스트는 없다.

### 더한 테스트 24건

`claim_helper.rs` 설치(7건): `installs_claim_helper_with_managed_markers`(완료 조건 1),
`installing_twice_leaves_the_file_unchanged`, `refuses_to_overwrite_an_unmanaged_helper`,
`refuses_a_helper_without_a_readable_version`, `refuses_to_downgrade_a_future_helper`,
`rewrites_a_managed_helper_that_drifted`(완료 조건 2),
`keeps_the_version_axis_separate_from_the_condition_script`(완료 조건 3 — 두 설치본이 서로의 버전
접두사를 갖지 않는 것을 본다).

`claim_helper.rs` 동작(14건, 전부 `#[cfg(unix)]`로 실제 `sh`를 띄운다):
`acquires_an_empty_target_and_prints_the_lease_id`(완료 조건 4 — 현행 키 여섯을 순서까지 고정하고,
표준 출력이 파일의 `lease_id`와 같은 것과 성공 뒤 잠금 디렉터리가 남지 않는 것을 함께 본다),
`refuses_a_target_that_an_unexpired_lease_covers`(5), `takes_over_an_expired_lease`(6),
`never_takes_over_a_lease_it_cannot_judge`(오프셋 표기·소수 초·빈 값 셋),
`loses_the_takeover_when_the_lock_directory_exists`(7의 진 쪽),
`exactly_one_call_wins_the_race_for_an_expired_lease`(7 — 스레드 둘로 `sh` 두 개를 동시에 띄워
성공이 정확히 하나, 진 쪽이 3이나 4, 최종 파일이 이긴 쪽 `lease_id`인 것을 본다),
`renews_only_for_the_owner`(8), `renewing_keeps_fields_the_helper_does_not_know`(`role` 보존),
`releases_only_for_the_owner`(8), `the_replaced_owner_cannot_release_the_new_lease`(8),
`treats_a_missing_lease_as_not_owned`, `does_not_touch_leases_while_the_migration_lock_exists`(9),
`rejects_calls_that_do_not_match_the_contract`(인자 없음·모르는 하위 명령·인자 수 부족·인자 초과·
유효분 0·유효분 비정수·`../outside`·`wf/TASK-001` 여덟 경우가 각각 2).

`fs_project_repository.rs`(3건): `installs_the_claim_helper_with_the_workflow`(완료 조건 1),
`refuses_to_overwrite_an_unmanaged_claim_helper`(관리되지 않는 파일이 있으면 워크플로우 생성이
그 파일을 덮어쓰지 않고 오류로 끝나며 `project.yml`도 만들어지지 않는다),
`reads_a_lease_written_by_the_installed_helper`(완료 조건 4의 "앱의 lease 읽기 경로가 활성 lease로
인식한다" — 설치된 헬퍼로 실제 선점한 뒤 `inspect`의 `active_leases`에서 `lease_id`·`agent`·
`task_id`를 대조한다).

경합 동작은 자동화 테스트 외에 셸에서 8회 반복해 수동으로도 확인했다. 매번 승자가 정확히 하나였고
(4,0)과 (0,4)가 섞여 나왔으며 최종 파일은 항상 이긴 쪽의 값이었다.

## 병렬 세션과의 겹침 — 발견 경위와 승계

구현과 검증이 끝난 뒤(09:34Z 전량 통과) 종료 절차에 들어가기 직전, 트리가 컴파일되지 않는 것을
발견했다. 원인은 `heartbeat_condition.rs`가 새 모듈 `managed_script`를 import하는데 `mod.rs`에 그
선언이 아직 없는 상태였고, dev-040이 SPEC-015를 착지시키는 중간 단계였다(그 세션은 `mod.rs` 줄을
맨 마지막에 넣는 절차로 승인받았다). 09:39Z에 착지가 끝나 컴파일이 회복됐다.

그 과정에서 확인한 설계상의 겹침을 남긴다.

- `managed_script.rs`는 "앱이 `.workflow/rules/`에 설치하는 실행 자산의 공용 설치 규약(SPEC-015 R2)"
  이다. 판정 규칙 여섯이 이 작업이 구현한 것과 같고, `version_prefix` 필드가 "자산마다 다르다 —
  이것이 버전 축의 분리다"로 완료 조건 3과 같은 말을 한다. 즉 이 헬퍼 같은 자산을 담으려고 만든
  자리다.
- 그런데 TASK-039 문서는 그 공용화를 명시적으로 범위 밖에 두었고(작업 내용 §1, 범위 밖 절), 그
  판단을 모듈 머리 주석에 남기라고 지시했다. 지시대로 구현했고 주석도 그렇게 적혀 있다.
- **이것은 설계 충돌이 아니라 설계된 순서다.** TL 확인 결과 이 합류는 이미
  **TASK-047**("선점 헬퍼를 공용 자산 규약으로 옮기고 PowerShell 구현과 동작 일치를 낸다",
  `depends_on: [TASK-039, TASK-042]`)로 예정되어 있다. SPEC-015를 분해한 아키텍트가 예견하고 만든
  작업이다. 이 작업 시점에는 공용 규약이 없었으므로 자체 구현이 맞았고, 규약이 생긴 지금 둘을
  화해시키는 것이 047이다.
- **TASK-047이 승계할 것 둘.** (1) `claim_helper.rs`의 설치·검증·원자적 쓰기를 `ManagedScript`
  서술로 옮기고 `ClaimHelperError`를 `ManagedScriptError`로 접는 것. (2) 그때
  `claim_helper.rs` 머리 주석의 "두 모듈의 설치 로직을 공용 모듈로 묶지 않았다" 문단이 낡으므로
  함께 지우거나 고칠 것. 지금 그 주석은 이 작업 시점의 사실을 정확히 적고 있으므로 여기서는
  건드리지 않았다.
- **이 작업의 테스트 24건이 047의 회귀 기준이다.** 설치 판정 7건은 규약을 갈아 끼워도 같은 결론이
  나와야 하고, 동작 14건은 스크립트 본문이 바뀌지 않는 한 그대로 통과해야 한다. PowerShell 구현이
  붙으면 그 14건에 대응하는 한 벌이 더 필요하다.

## 사용자 QA 제안

작업 문서가 이 저장소에서 헬퍼를 직접 돌리지 말라고 정했다(`.workflow/.runtime/leases/`에 다음
세션이 읽을 실제 lease가 들어 있고 실험용 선점이 그 자리에 남으면 다른 세션의 자격 판정을 막는다).
그래서 아래는 임시 프로젝트 기준이다.

1. 앱에서 새 프로젝트에 워크플로우를 하나 만들고 `.workflow/rules/wf-claim.sh`가 생기는지, 그
   파일의 둘째·셋째 줄이 `# managed_by: workflow-labs`와 `# claim_helper_version: 1`인지 본다.
2. 그 프로젝트 루트에서 `sh .workflow/rules/wf-claim.sh acquire TASK-001 나 30`을 실행해 종료
   코드가 0이고 `lease_id`가 출력되는지, 앱 화면의 활성 lease 목록에 그 값이 뜨는지 본다.
3. 같은 명령을 한 번 더 실행해 종료 코드가 3이고 파일이 그대로인지 본다.
4. `sh .workflow/rules/wf-claim.sh release TASK-001 <출력된 lease-id>`로 0과 파일 삭제를,
   아무 문자열로 같은 명령을 실행해 5와 파일 보존을 본다.
5. 이 저장소에서 확인하고 싶으면 앱으로 아무 기획서 결정이나 QA를 한 번 기록해 설치를 유발한 뒤,
   파일이 생겼는지만 보고 헬퍼를 실행하지는 않는다.

## 리스크와 후속

1. **TASK-047의 이관이 남아 있다.** 위 승계 절 참조. 지금 상태로도 계약은 만족하지만 관리 자산
   둘이 서로 다른 설치 구현을 갖고 있다.
2. **Windows에서 헬퍼를 쓸 수 없다.** POSIX sh만 냈다(확인 필요 2번의 결정). SPEC-015가 조건
   스크립트에 `ps1` 구현을 붙였으므로 헬퍼만 sh인 상태가 됐고, 그 해소도 TASK-047이다.
3. **정규 표기 밖의 `expires_at`을 가진 lease는 영원히 인수되지 않는다.** 헬퍼는 판정할 수 없는
   lease를 미만료로 다룬다. 규칙 §4가 세션의 직접 생성을 막으므로 새로 생기지는 않지만, 헬퍼 도입
   이전에 만들어진 파일에는 남는다. 이 저장소의 `SPEC-009.yml`은 정규 표기라 해당 없다.
4. **잠금 디렉터리가 `SIGKILL`로 남을 수 있다.** `trap`이 정상 종료와 INT·TERM·HUP을 덮으므로 남는
   창은 `SIGKILL`뿐이고, 그때 그 대상의 인수만 막힌다. 복구는 그 디렉터리를 지우는 것이며 헬퍼 머리
   주석에 적었다. 자동 청소는 작업 문서가 범위 밖으로 두었다.
5. **헬퍼가 `role`을 쓰지 않는다.** `acquire`는 계약이 정한 여섯 키만 쓴다(R7). 그래서 헬퍼로 잡은
   lease에는 `role`이 없고, 화면의 역할 표시가 비게 된다. `renew`는 이미 있는 `role`을 보존한다.
   늘어난 필드의 기록 방법은 작업 문서가 TASK-032 쪽 몫으로 넘겼다.
6. **`docs/development-logs/2026-08-03.md`에 세션 항목을 남기지 않았다.** 이 세션의 수정 범위는
   작업 문서가 정한 세 파일이고, 그 로그는 동시에 도는 다른 세션들이 함께 쓰는 파일이다. 일일 로그가
   필요하면 이 보고서를 근거로 지휘 세션이 한 번에 덧붙이는 편이 충돌이 없다.
