---
schema: workflow-labs/task@1
id: TASK-055
title: 만료된 lease가 세 분기 모두에서 대상을 막지 않게 하고 앱 판정도 같은 기준을 쓴다
status: completed
source_spec_id: SPEC-018
source_decision_id: DECISION-1224D86C
depends_on: [TASK-039, TASK-040]
updated_at: 2026-08-03T12:42:56Z
history:
  - { at: 2026-08-03T09:30:00Z, kind: created }
  - { at: 2026-08-03T09:51:00Z, kind: in_progress }
  - { at: 2026-08-03T10:05:00Z, kind: qa_waiting }
---

# 만료된 lease가 세 분기 모두에서 대상을 막지 않게 하고 앱 판정도 같은 기준을 쓴다

SPEC-018 R4와 R5의 lease 몫을 구현한다. 지금 조건 스크립트의 선점 확인은 세 분기 모두
`[ -f "$leases/<id>.yml" ]`이고, 앱의 `lease_ids`도 파일 이름만 모은다. 앱은 lease를 지우지 않으므로
세션 하나가 대상을 잡고 죽으면 그 대상은 세 역할 모두에서 영원히 자격을 잃는다. 이 저장소의
`.workflow/.runtime/leases/SPEC-009.yml`이 `expires_at: 2026-08-03T01:20:00Z`로 만료된 채 남아 있는 것이
그 실물이다.

이 작업은 판정만 고친다. 만료된 lease 파일을 지우거나 고치지 않는다 — 앱이 lease를 쓰지 않는다는 현행
원칙은 그대로다(기획서 제외 범위).

## 의존성

- **선행 필수: TASK-040.** 둘 다 `heartbeat_condition.rs`의 `CONDITION_SCRIPT` 본문과
  `CONDITION_SCRIPT_VERSION`, `scripts/wf-eligible.sh`를 만진다. 코드 의존은 없고 같은 파일이라 순서를
  준다. **선행이 반영되지 않은 상태에서 이 작업을 시작하지 않는다.**
- **선행 필수: TASK-039.** 둘 다 `fs_project_repository.rs`를 만진다. TASK-039는 TASK-037을 선행으로
  두므로 그 체인 뒤에 선다.
- 이 기획서의 TASK-056이 이 작업을 선행으로 둔다. 두 작업이 같은 세 파일을 만지고, 이 작업이 만드는
  sh 만료 판정 함수를 TASK-056의 결정 루프가 그대로 쓴다.
- **착수 시 TASK-042의 반영 여부를 확인한다.** TASK-042(SPEC-015)가 먼저 반영되면 조건 스크립트가
  공용 자산 규약(`managed_script.rs`)으로 옮겨 가고 PowerShell 본문이 하나 더 생긴다. 그 경우 이
  작업의 범위에 PowerShell 본문의 같은 변경이 포함된다. 아래 "0. 먼저 확인할 저장소 상태"를 읽는다.

## 범위

- `src-tauri/src/infrastructure/heartbeat_condition.rs` — `CONDITION_SCRIPT` 본문의 선점 확인 세 자리,
  `CONDITION_SCRIPT_VERSION`, 테스트.
- `scripts/wf-eligible.sh` — 같은 본문(관리 표기 두 줄 제외).
- `src-tauri/src/infrastructure/fs_project_repository.rs` — `lease_ids`의 만료 필터.
- `src-tauri/src/infrastructure/role_eligibility.rs` — 머리 주석의 알려진 차이, 테스트 픽스처와 만료
  시나리오.
- 조건부: `src-tauri/src/infrastructure/managed_script.rs`와 조건 스크립트의 PowerShell 본문 —
  TASK-042가 이미 반영됐을 때만.
- 그 외 파일은 건드리지 않는다. 특히 `project_instructions.rs`·`docs/file-contract.md`·
  `domain/project.rs`·`claim_helper.rs`·화면은 이 작업에서 바뀌지 않는다.

## 작업 내용

### 0. 먼저 확인할 저장소 상태

- `CONDITION_SCRIPT_VERSION`의 현재 값을 읽고 1을 올린다. 리터럴을 추정하지 않는다 — TASK-040이 1에서
  2로 올리고, TASK-056이 이 작업 뒤에 또 올린다.
- TASK-042의 반영 여부를 `src-tauri/src/infrastructure/managed_script.rs`의 존재로 확인한다. 있으면
  조건 스크립트 본문이 둘(`sh`·`ps1`)이므로 같은 판정을 양쪽에 넣고, TASK-043이 만든 시나리오 표에
  만료 lease 항목이 있으면 그 표를 함께 갱신한다. 없으면 `sh` 하나만 고친다.
- 저장소의 `.workflow/.runtime/leases/`에서 실험하지 않는다. 그 디렉터리에는 다른 세션이 읽는 실제
  lease가 들어 있다. 손으로 확인해야 하면 임시 프로젝트에서 한다.

### 1. sh의 선점 확인을 유효성 판정으로 바꾼다 (R4)

세 분기에 흩어진 `[ -f "$leases/<id>.yml" ]`를 함수 하나로 모으고 그 함수가 만료를 본다. 분기마다
다른 판정을 두지 않는다 — 같은 저장소 안에 두 가지 선점 개념이 생긴다.

```sh
# 유효한(미만료) lease가 있으면 0. 파일이 없거나 시각을 읽을 수 없으면 1.
lease_blocks() {
  lease="$leases/$1.yml"
  [ -f "$lease" ] || return 1
  exp=$(sed -n 's/^expires_at: *//p' "$lease" | head -1 | tr -d '"'\''')
  case "$exp" in
    ????-??-??T??:??:??Z) [ "$exp" '>' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" ] ;;
    *) return 1 ;;
  esac
}
```

- **문자열 비교로 판정한다.** POSIX sh에는 이식 가능한 날짜 파싱이 없다. 자리수가 고정된 UTC 표기는
  사전순 비교가 곧 시각 비교다. TASK-039의 선점 헬퍼가 같은 이유로 같은 선택을 했다.
- **읽을 수 없는 표기는 선점으로 세지 않는다**(R4). 선점 헬퍼는 같은 상황을 반대로(미만료로) 다룬다.
  방향이 다른 이유를 함수 주석에 남긴다 — 헬퍼가 지는 위험은 살아 있는 남의 lease를 인수하는 것이고,
  이 판정이 지는 위험은 대상이 영원히 열리지 않는 것이다. 실제 선점은 배타적 생성이 막으므로 이
  판정이 관대해도 중복 선점으로 이어지지 않는다.
- `expires_at` 키가 없으면 `exp`가 빈 문자열이라 `case`의 기본 갈래로 떨어진다. 별도 분기를 두지 않는다.
- 판정은 lease 파일을 **읽기만** 한다. 지우거나 고치거나 새로 만들지 않는다.
- `planner`·`architect`·`developer` 세 분기가 모두 이 함수를 부른다. `architect` 분기가 보는 것은
  결정의 `spec_id`로 만든 lease이고, 그 자격 조건 자체는 이 작업에서 바뀌지 않는다.

### 2. 앱 판정도 같은 기준을 쓴다 (R4·R5)

`lease_ids`(`fs_project_repository.rs:635`)가 만료된 파일을 빼고 돌려준다. 만료 판정을 새로 쓰지 않고
`read_active_leases`(`:590`)의 파싱을 나눠 쓴다. 두 곳에 만료 규칙이 생기면 이 기획서가 고치려는 문제가
같은 파일 안에서 재생산된다.

- **판정 키는 파일 stem이다.** lease 파일 안의 `task_id`가 아니다. 조건 스크립트가 파일 이름으로
  판정하므로 앱도 그래야 한다. `derive_idea_states`는 `task_id`를 쓰지만 그것은 화면 표시의 판정이고
  이 판정과 목적이 다르다. 둘을 합치지 않는다.
- `read_active_leases`는 프론트엔드 payload를 만들고 `lease_ids`는 판정용이라 반환형이 다르다. 공유할
  것은 "파일을 읽어 만료 전인지 가리는" 한 단계뿐이다. `AgentLeaseSummary`에 파일 stem 필드를 더하는
  방법과 만료 판정 헬퍼를 하나 두는 방법 중 어느 쪽을 골라도 좋다. 조건은 파싱 규칙이 한 곳에만
  있는 것이다.
- `role_eligibility.rs`의 `pending_role_work` 시그니처는 그대로다. 이 작업이 바꾸는 것은 그 함수에
  넘기는 집합의 내용이다. `lease_ids` 인자의 주석("만료를 거르지 않은")을 새 뜻으로 고친다.

### 3. 남는 차이를 적는다

계약이 표기를 못박기 전까지는 canonical(`YYYY-MM-DDTHH:MM:SSZ`) 밖의 RFC3339 표기에서 두 판정이
갈린다. 오프셋 표기(`+09:00`)나 소수 초를 앱은 파싱하고 스크립트는 읽지 못한다. `role_eligibility.rs`
머리의 "알려진 차이" 목록에 넷째로 적는다. 표기 기준을 계약에 올리는 것은 TASK-059이고, 선점 헬퍼가
쓰는 lease는 이미 canonical이므로 이 차이는 헬퍼 이전에 손으로 만들어진 파일에만 남는다.

### 4. 테스트

`role_eligibility.rs` 테스트 모듈:

- `write_lease` 헬퍼가 쓰는 시각을 canonical 표기로 바꾼다. 지금은 `chrono::to_rfc3339()`라
  `+00:00`이 나오고, 그 표기는 새 sh 판정이 읽지 못해 일치 대조가 무너진다. 픽스처 표기 변경이지
  테스트 삭제가 아니다.
- `an_expired_lease_file_still_blocks_its_target`(`:369`)의 결론을 뒤집고 이름을 사실에 맞게 고친다.
  아이디어·작업·기획서 세 대상 각각에 만료 lease를 둔 상태에서 세 역할 모두 처리 대상 있음이어야
  한다. (기획서 완료 조건 8)
- 미만료 lease가 세 분기에서 대상을 막는 기존 테스트 셋(`:227`·`:273`·`:351`)이 수정 없이 통과한다.
  (기획서 완료 조건 10)
- `expires_at`이 없는 lease와 시각으로 읽히지 않는 lease가 각각 대상을 막지 않는다.
  (기획서 완료 조건 9)
- 판정 전후로 `leases/` 아래 파일의 개수와 내용이 같다. (기획서 완료 조건 11)
- 위 전부에서 `assert_matches_condition_script`가 통과한다. 앱과 스크립트가 같은 결론을 낸다.

`heartbeat_condition.rs` 테스트 모듈:

- 설치본에 새 버전 줄이 있고 기존 설치·갱신 안전 규칙 넷(관리 마커 없음, 버전 줄 없음, 설치본이 더
  새로움, 관리본 드리프트)이 그대로 통과한다. (기획서 완료 조건 14)

## 완료 조건

1. 만료된 lease가 `planner`·`architect`·`developer` 세 분기 모두에서 선점으로 세어지지 않는다.
   (기획서 완료 조건 8)
2. `expires_at`이 없거나 시각으로 읽히지 않는 lease도 선점으로 세어지지 않는다. (기획서 완료 조건 9)
3. 미만료 lease는 세 분기 모두에서 대상을 막고, 그 성질을 고정한 기존 테스트가 수정 없이 통과한다.
   (기획서 완료 조건 10)
4. 판정이 lease 파일을 지우거나 고치지 않는다. (기획서 완료 조건 11)
5. 앱의 역할별 대기 물량 판정이 위 네 시나리오 전부에서 조건 스크립트와 같은 결론을 낸다.
   (기획서 완료 조건 12의 lease 몫)
6. 만료 판정 규칙이 앱 안에 한 곳에만 있고, `role_eligibility.rs`의 알려진 차이 목록이 남은 표기 차이를
   적는다.
7. 조건 스크립트 버전이 1 올라가고 설치·갱신 안전 규칙 셋이 그대로다. (기획서 완료 조건 14)
8. 기존 자동화 테스트가 삭제되거나 비활성화되지 않는다. (기획서 완료 조건 22)
9. `npm run check`와 `cargo test --manifest-path src-tauri/Cargo.toml`이 통과한다.
   (기획서 완료 조건 23)

## 검증 절차

```sh
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
npm run check
```

## 범위 밖

- `planner` 분기에 수정 요청 결정을 더하는 것과 아이디어 판정 규칙. TASK-056이다.
- `architect`·`developer` 분기의 자격 조건 변경(기획서 제외 범위). 이 작업이 그 두 분기에서 바꾸는
  것은 선점 확인 한 줄뿐이다.
- 만료된 lease 파일의 청소, 앱이 lease를 만들거나 지우거나 갱신하는 것(기획서 제외 범위).
- 선점 헬퍼(`wf-claim.sh`)의 동작과 그 만료 판정. SPEC-013의 범위다.
- lease 시각 표기 기준을 계약에 적는 것. TASK-059다.
- 화면의 어떤 변경도. `activeLeases`가 이미 미만료만 담고 있어 표시는 바뀌지 않는다.

## 참고 사실

확인 시점 2026-08-03. 추정 없이 파일에서 읽은 값이다.

- 조건 스크립트의 선점 확인은 `heartbeat_condition.rs`의 `:45`·`:60`·`:73` 세 자리이고 전부
  `[ -f "$leases/<id>.yml" ]`다. 스크립트 전체에 시각 비교가 하나도 없다.
- `lease_ids`(`fs_project_repository.rs:635`)는 `.yml` 파일의 stem만 모으고, 함수 주석이 "만료를 거르지
  않는 것이 조건 스크립트와 같은 규칙"이라고 적는다. `role_eligibility.rs:26`의 인자 주석도 같다.
- `read_active_leases`(`fs_project_repository.rs:590`)는 `expires_at`을 `DateTime::parse_from_rfc3339`로
  읽고 만료 전인 것만 담는다. 열지 못하거나 파싱에 실패한 파일은 조용히 건너뛴다.
- `role_eligibility.rs`의 `write_lease`(`:188`)는 `heartbeat_at`·`expires_at`에 같은 값을 쓰고,
  `future()`(`:198`)·`past()`(`:202`)가 `chrono::to_rfc3339()`로 `+00:00` 표기를 만든다.
- `an_expired_lease_file_still_blocks_its_target`(`:369`)가 지금의 결함을 성질로 고정해 두었다. 같은
  테스트가 `active_leases`가 비어 있음도 함께 확인한다.
- `.workflow/.runtime/leases/SPEC-009.yml`이 `expires_at: 2026-08-03T01:20:00Z`로 만료된 채 남아 있다.
  그 세션은 해제 없이 끝났다.
