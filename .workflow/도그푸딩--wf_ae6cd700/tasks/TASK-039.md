---
schema: workflow-labs/task@1
id: TASK-039
title: 선점 헬퍼를 앱 관리 자산으로 설치하고 선점·갱신·해제를 종료 코드로 판정하게 한다
status: completed
source_spec_id: SPEC-013
source_decision_id: DECISION-73D4BC1B
depends_on: [TASK-037]
updated_at: 2026-08-03T12:42:56Z
history:
  - { at: 2026-08-03T05:05:00Z, kind: created }
  - { at: 2026-08-03T09:24:56Z, kind: in_progress }
  - { at: 2026-08-03T09:43:42Z, kind: qa_waiting }
---

# 선점 헬퍼를 앱 관리 자산으로 설치하고 선점·갱신·해제를 종료 코드로 판정하게 한다

SPEC-013 R7을 구현한다. 지금 공통 규칙 §4는 "lease 파일을 배타적으로 생성하라"고 절차를 적지만, 그
원자성을 만들어 내는 것은 각 세션이 그 순간 고른 셸 표현이다. 그 동작을 앱이 설치하는 스크립트 하나로
옮긴다. 규칙 문서 갱신은 이 작업이 아니라 TASK-041이다.

## 의존성

- **선행 필수: TASK-037.** 코드 의존은 없다. 둘 다
  `src-tauri/src/infrastructure/fs_project_repository.rs`를 만지기 때문에 순서를 준다. 이 작업이 만지는
  것은 설치 호출 지점 세 곳과 검증 호출 한 곳이고, TASK-037이 만지는 것은 문서 읽기 경로다. 같은 파일
  이라 동시에 진행하면 충돌한다.
- TASK-041이 이 작업의 헬퍼 계약을 규칙 문서로 옮긴다. 순서 제약은 없다 — 규칙이 먼저 가도 "헬퍼가
  없는 프로젝트"의 처리(확인 필요 1번의 결정)가 같은 문서에 있어 세션이 막히지 않는다.
- `mod.rs`·`domain/project.rs`를 만지지 않으므로 SPEC-009·SPEC-011·SPEC-012 계열 작업과의 겹침은
  `fs_project_repository.rs` 하나뿐이다. **TASK-029·TASK-032·TASK-035와 병행 금지.** 순서는 어느 쪽이
  먼저여도 된다.

## 범위

- `src-tauri/src/infrastructure/claim_helper.rs` — 신규. 헬퍼 본문 상수와 설치·검증.
- `src-tauri/src/infrastructure/mod.rs` — 모듈 선언 1줄.
- `src-tauri/src/infrastructure/fs_project_repository.rs` — 설치·검증 호출과 오류 변환.
- 그 외 파일은 건드리지 않는다. 특히 `heartbeat_condition.rs`·`project_instructions.rs`·
  `docs/file-contract.md`·화면은 이 작업에서 바뀌지 않는다.

## 작업 내용

### 0. 먼저 읽을 제약

- **lease 스키마를 바꾸지 않는다**(R7). `schema_version`·`lease_id`·`agent`·`task_id`·`heartbeat_at`·
  `expires_at` 다섯 필드를 지금 형식 그대로 쓴다. 앱의 `read_active_leases`(`:568`)가 읽던 파일과 같은
  모양이어야 한다.
- **헬퍼는 lease 디렉터리 밖의 어떤 파일도 만들거나 고치지 않는다**(R7). 문서 상태 기록(기획서 스켈레톤
  생성, 작업 `in_progress` 전이)은 지금처럼 세션이 한다.
- **앱은 여전히 lease를 읽기만 한다**(기획서 제외 범위). 이 작업은 헬퍼를 **설치**할 뿐이고, 앱이
  lease를 만들거나 지우거나 갱신하는 경로를 만들지 않는다. 만료 lease를 앱이 청소하지도 않는다.
- **POSIX sh만 낸다**(확인 필요 2번의 결정). Windows 대응은 조건 스크립트와 함께 IDEA-54B29779가 다룰
  별건이다.
- **조건 스크립트를 건드리지 않는다.** 버전 축이 분리되어야 한다(R7).

### 1. 새 모듈 — 왜 `heartbeat_condition.rs`를 일반화하지 않는가

`claim_helper.rs`는 `heartbeat_condition.rs`의 구조를 그대로 따른다. 상수 이름과 오류 종류만 다르고
설치·판정 흐름은 같다.

```rust
  const CLAIM_HELPER_FILE: &str = "wf-claim.sh";
  const MANAGED_MARKER: &str = "# managed_by: workflow-labs";
  const VERSION_PREFIX: &str = "# claim_helper_version:";
  const CLAIM_HELPER_VERSION: u32 = 1;
  const CLAIM_HELPER: &str = r#"#!/bin/sh
  # managed_by: workflow-labs
  # claim_helper_version: 1
  ...
  "#;

  pub fn claim_helper_path(control_root: &Path) -> PathBuf
  pub fn install_claim_helper(control_root: &Path) -> Result<(), ClaimHelperError>
  pub fn validate_claim_helper(control_root: &Path) -> Result<(), ClaimHelperError>
```

판정 규칙은 조건 스크립트와 같다(R7). 파일이 없으면 설치, 관리 마커가 없으면 덮어쓰지 않고 오류,
버전 줄을 읽지 못하면 오류, 설치본 버전이 앱 상수보다 크면 오류, 내용이 이미 같으면 쓰지 않음,
관리본이 어긋나 있으면 앱 본문으로 되돌림. 쓸 때는 임시 파일을 만들어 갈아 끼운다.

**두 모듈의 설치 로직을 공용 모듈로 묶지 않는다.** 이유가 둘이다. 하나, `heartbeat_condition.rs`는
TASK-040이 같은 시기에 만진다 — 그 파일을 이 작업이 함께 고치면 두 작업이 같은 파일에서 부딪힌다.
둘, 지금은 사례가 둘이고 각자의 버전 축·오류 문구·설치 시점을 따로 갖는다. 세 번째 관리 스크립트가
생기면 그때 묶는 편이 낫다. 이 판단을 모듈 머리 주석에 남긴다.

`ClaimHelperError`는 `ConditionScriptError`(`heartbeat_condition.rs:87`)와 같은 네 갈래
(`NotRegularFile`·`Unmanaged`·`Downgrade`·`Io`·`Persist`)를 갖되 문구는 선점 헬퍼를 가리킨다.

### 2. 헬퍼의 동작 계약

```text
  sh .workflow/rules/wf-claim.sh acquire <문서-id> <에이전트> <유효분>
  sh .workflow/rules/wf-claim.sh renew   <문서-id> <lease-id> <유효분>
  sh .workflow/rules/wf-claim.sh release <문서-id> <lease-id>
```

조건 스크립트와 같이 **프로젝트 루트에서 실행**하고 lease 경로는 `.workflow/.runtime/leases`다.

종료 코드는 R7이 정한 값 그대로다.

| 코드 | 뜻 |
| --- | --- |
| 0 | 성공 |
| 1 | 그 밖의 실패(입출력 오류, 마이그레이션 락) |
| 2 | 사용법 오류 |
| 3 | 대상이 이미 미만료 lease로 선점되어 있다 |
| 4 | 만료 lease 인수 경합에서 졌다 |
| 5 | 소유자가 아니다 |

R7이 마이그레이션 락에 별도 코드를 주지 않았으므로 `1`로 정한다. 사용법 오류(`2`)에는 인자 수가
맞지 않는 경우, 알 수 없는 하위 명령, 유효분이 양의 정수가 아닌 경우, **문서 id가
`[A-Za-z0-9_-]` 밖의 문자를 포함하는 경우**가 들어간다. 마지막 것이 중요하다 — 문서 id가 그대로
파일 이름이 되므로 경로 구분자나 `..`가 들어오면 lease 디렉터리 밖에 쓰게 된다.

`acquire`가 성공하면 자신이 쓴 `lease_id`를 표준 출력에 한 줄로 낸다(R7). 실패 메시지는 표준 오류로
낸다. 호출자는 출력 문자열이 아니라 종료 코드로 판정한다.

`lease_id`는 헬퍼가 만든다. `lease-<pid>-<UTC 압축 시각>` 형식이면 한 호스트 안에서 겹치지 않는다.
갱신·해제는 이 문자열이 파일의 값과 정확히 같을 때만 동작한다.

### 3. 시각을 다루는 방법

POSIX sh에는 이식 가능한 날짜 연산이 없다. 그래서 **비교는 문자열로, 계산만 epoch로** 한다.

- 헬퍼가 쓰는 `heartbeat_at`·`expires_at`은 항상 `%Y-%m-%dT%H:%M:%SZ`다. 자리수가 고정된 UTC 표기라
  사전순 비교가 곧 시각 비교다.
- 만료 판정은 파일의 `expires_at`과 `date -u +%Y-%m-%dT%H:%M:%SZ`를 문자열로 비교한다. RFC3339를
  파싱하지 않는다.
- 파일의 `expires_at`이 그 정규 표기가 아니면(오프셋 표기, 소수 초, 값 없음) **미만료로 다루고 3으로
  끝낸다.** 남의 lease를 판정하지 못할 때 인수하는 쪽이 더 위험하다. 이 규칙 때문에 앱의
  `read_active_leases`와 판정이 갈릴 수 있다 — 앱은 오프셋 표기를 파싱한다. R8이 세션의 직접 생성을
  막으면 정규 표기 밖의 lease는 생기지 않으므로, 이 차이는 헬퍼 도입 이전에 만들어진 파일에만 남는다.
  헬퍼 머리 주석에 이 사실을 적는다.
- 유효분에서 `expires_at`을 계산할 때만 epoch를 쓴다. epoch를 다시 표기로 바꾸는 것은 플랫폼마다
  다르므로 두 갈래를 시도한다.

```sh
  # BSD(macOS)와 GNU(Linux) 양쪽에서 동작한다.
  rfc3339_from_epoch() {
    date -u -r "$1" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d "@$1" +%Y-%m-%dT%H:%M:%SZ
  }
```

두 갈래가 모두 실패하면 1로 끝낸다.

### 4. 선점의 배타 구간

R7이 방법을 아키텍트에게 맡긴 부분이다. 두 경로로 나눈다.

**비어 있는 대상 — 배타적 생성.** R7이 명시한 대로 한 번의 배타적 생성으로 끝낸다.

```sh
  ( set -C; printf '%s' "$body" > "$lease" ) 2>/dev/null
```

리다이렉트 자체가 `O_EXCL`이므로 동시에 들어온 두 호출 중 하나만 성공한다. 성공하면 0이다.

**이미 파일이 있는 대상 — 잠금 구간 안에서 인수.** 배타적 생성이 실패했다는 것은 파일이 있다는
뜻이다. 여기서 인수 여부를 정한다. 인수는 읽기·판단·쓰기 세 단계라 배타적 생성처럼 한 번에 끝나지
않으므로(R7), 그 구간을 디렉터리 생성으로 감싼다.

```sh
  mkdir "$lease.lock" 2>/dev/null || exit 4      # 진 쪽은 여기서 끝난다
  trap 'rmdir "$lease.lock" 2>/dev/null' EXIT INT TERM HUP
```

`mkdir`은 POSIX에서 원자적이고, 이미 있으면 실패한다. 잠금을 잡은 뒤 **다시 읽는다.** 배타적 생성이
실패한 시점과 잠금을 잡은 시점 사이에 다른 호출이 인수를 끝냈을 수 있다.

1. 파일이 사라졌으면 → 그 자리에 새 lease를 쓴다(0).
2. `expires_at`이 아직 미래이거나 정규 표기가 아니면 → 3.
3. 만료됐으면 → 새 lease를 임시 파일에 쓰고 제자리로 옮긴다(0).

잠금 디렉터리는 `<문서-id>.yml.lock`이고 lease 디렉터리 안에 만든다. R7의 "lease 디렉터리 밖의 파일을
만들지 않는다"를 지키면서, 확장자가 `yml`이 아니라 `read_active_leases`(`:578`)와 조건 스크립트의
`[ -f "$leases/<id>.yml" ]` 어느 쪽에도 걸리지 않는다.

남는 위험 하나를 문서화한다. 세 파일 연산 사이에 프로세스가 강제 종료되면 잠금 디렉터리가 남고, 그
대상의 인수만 막힌다. `trap`이 정상 종료·중단 신호를 덮으므로 남는 창은 `SIGKILL`뿐이고, 복구는 그
디렉터리를 지우는 것이다. 헬퍼 머리 주석에 적는다.

### 5. 갱신과 해제

둘 다 소유자를 확인한 뒤에만 파일을 건드린다(R7).

- 파일의 `lease_id`가 제시한 값과 다르면 아무것도 하지 않고 5로 끝낸다.
- 파일이 없어도 5다. 현재 소유자가 아니라는 결론이 같다.
- 갱신은 `heartbeat_at`과 `expires_at`만 새로 쓰고 `agent`·`task_id`·`lease_id`는 원래 값을 그대로
  옮긴다. 임시 파일에 쓰고 제자리로 옮긴다.
- 해제는 파일을 지운다.
- 잠금을 쓰지 않는다. 갱신·해제가 겨루는 상대는 인수인데, 인수는 만료된 lease에만 일어난다. 만료된
  뒤에 갱신·해제를 시도한 세션은 이미 인수당했을 수 있고, 그때 `lease_id`가 달라 5를 받는다.
  이것이 "인수당한 세션이 뒤늦게 끝나면서 새 소유자의 lease를 지우는" 경로를 막는다(R7).

### 6. 마이그레이션 락

`.workflow/.runtime/migration.lock`이 있으면 `acquire`가 선점하지 않고 1로 끝낸다. 공통 규칙 §1의
"마이그레이션 락이 있는 동안 모든 워크플로우 쓰기를 멈춘다"와 같은 판정이고, 조건 스크립트의 첫 줄과
같은 자리다. 갱신·해제도 같은 이유로 막는다 — 락이 걸린 동안 lease 디렉터리를 쓰지 않는다.

### 7. 설치 배선

`fs_project_repository.rs`에서 `install_project_instructions`를 부르는 자리마다 헬퍼 설치를 함께
부른다: `create_workflow`(`:148`)·`record_spec_decision`(`:307`)·`record_task_qa`(`:358`).
`validate_project_instructions`를 부르는 `create_workflow`(`:123`)에는 검증을 함께 부른다.
`ProjectError`에 `#[error(transparent)]` 변형을 하나 더해 `ClaimHelperError`를 받는다
(`ProjectInstructions`(`:86`)와 같은 모양).

**`inspect`에는 넣지 않는다.** 기획서 완료 조건 19가 "프로젝트를 열면 설치된다"고 적었지만 그 검증은
"새 임시 프로젝트에서 파일 존재를 확인한다"이고, 새 프로젝트는 `create_workflow`를 지난다.
`inspect`는 2.5초마다 도는 읽기 경로라 파일 쓰기를 넣을 자리가 아니다. 규칙 파일이 지금 정확히 이
방식으로 설치되고, 헬퍼는 규칙 파일과 같은 성격의 세션용 자산이므로 수명주기를 맞춘다. 이미 만들어진
프로젝트에는 다음 기획서 결정이나 QA 기록에서 설치되고, 그 사이에는 세션이 현행 절차로 직접 선점한다
(확인 필요 1번의 결정, TASK-041이 규칙에 적는다).

**조건 스크립트의 설치 지점(`heartbeat_service.rs:337`)에는 넣지 않는다.** 그 자리는 하트비트 연동
설치이고, 선점 헬퍼는 하트비트를 쓰지 않는 프로젝트에도 필요하다.

**저장소에 `scripts/wf-claim.sh` 사본을 두지 않는다.** `scripts/wf-eligible.sh`가 있는 것은 하트비트
잡 설정이 그 경로를 조건으로 쓰기 때문이다. 헬퍼를 부르는 것은 데몬이 아니라 세션이고(확인 사실 13번)
세션은 설치본을 부른다. 사본을 두면 갱신이 갈라질 자리만 는다.

### 8. 테스트

설치(`claim_helper.rs` 테스트 모듈, `heartbeat_condition.rs:198`~`:291`의 다섯 테스트를 그대로 따른다):

- 설치하면 관리 마커 줄과 버전 줄을 가진 파일이 생긴다. (완료 조건 19)
- 두 번 설치해도 파일이 다시 쓰이지 않는다. (완료 조건 20)
- 관리 마커가 없는 파일은 덮어쓰지 않고 오류다. (완료 조건 20)
- 버전 줄을 읽을 수 없는 파일은 덮어쓰지 않고 오류다. (완료 조건 20)
- 설치본 버전이 앱 상수보다 크면 오류이고 파일이 그대로다. (완료 조건 20)
- 관리본이 어긋나 있으면 앱 본문으로 되돌린다. (완료 조건 20)
- 헬퍼 버전 줄과 조건 스크립트 버전 줄이 서로 다른 접두사를 쓰고, 조건 스크립트 설치본이
  `claim_helper_version`을 갖지 않는다. 한쪽 상수만 올려도 다른 쪽 설치본이 갱신 대상이 되지 않는다.
  (완료 조건 21)

동작(같은 모듈, `#[cfg(unix)]`. 실행 헬퍼는 `heartbeat_condition.rs:294`의 `run_condition`과 같은
모양으로 만들고 표준 출력을 함께 받는다):

- 비어 있는 대상 선점이 0으로 끝나고, 만들어진 파일이 다섯 필드를 가지며, 표준 출력의 `lease_id`가
  파일의 값과 같다. 그 파일을 앱의 lease 읽기 경로가 활성 lease로 인식한다. (완료 조건 22)
- 미만료 lease가 있는 대상 선점이 3으로 끝나고 파일 내용이 바뀌지 않는다. (완료 조건 23)
- 만료된 lease가 있는 대상 선점이 0으로 끝나고 `lease_id`·`agent`·`expires_at`이 새 값이다.
  (완료 조건 24)
- 만료된 lease가 있고 잠금 디렉터리가 이미 있으면 선점이 4로 끝나고 파일이 그대로다. 경합에서 진
  쪽의 동작을 결정적으로 고정한다. (완료 조건 25)
- 같은 만료 lease에 두 호출을 동시에 넣으면 정확히 하나만 0이고 나머지는 실패이며(3 또는 4), 최종
  파일의 `lease_id`가 이긴 쪽의 값이다. 두 자식 프로세스를 스레드로 동시에 띄운다. (완료 조건 25)
- 인수당한 뒤 옛 `lease_id`로 해제를 시도하면 5로 끝나고 새 소유자의 파일이 그대로 남는다.
  (완료 조건 26)
- 옛 `lease_id`로 갱신을 시도하면 5로 끝나고 파일이 그대로다. (완료 조건 26)
- 자기 `lease_id`로 갱신하면 0으로 끝나고 `expires_at`이 미뤄지며 `agent`·`task_id`·`lease_id`가
  그대로다.
- 자기 `lease_id`로 해제하면 0으로 끝나고 파일이 사라진다.
- 파일이 없는 대상에 갱신·해제를 시도하면 5다.
- 마이그레이션 락이 있으면 선점이 실패하고 lease 파일이 만들어지지 않는다. (완료 조건 27)
- 알 수 없는 하위 명령, 인자 수 부족, 양의 정수가 아닌 유효분, 경로 구분자가 든 문서 id가 각각 2다.
- 성공한 선점 뒤 잠금 디렉터리가 남지 않는다.

`fs_project_repository.rs` 테스트:

- 워크플로우를 만들면 `.workflow/rules/wf-claim.sh`가 함께 설치된다. (완료 조건 19)
- 관리되지 않는 `wf-claim.sh`가 있으면 워크플로우 생성이 그 파일을 덮어쓰지 않고 오류로 끝난다.

## 완료 조건

1. 앱이 워크플로우를 만들거나 기획서 결정·QA를 기록하면 `.workflow/rules/wf-claim.sh`가 관리 마커와
   버전 줄을 갖고 설치된다. (기획서 완료 조건 19)
2. 헬퍼 설치가 조건 스크립트와 같은 안전 규칙 넷을 따른다. (기획서 완료 조건 20)
3. 헬퍼의 버전 상수가 조건 스크립트의 것과 별개다. (기획서 완료 조건 21)
4. 비어 있는 대상 선점이 성공하고 현행 다섯 필드 형식의 lease가 만들어지며 `lease_id`가 표준 출력에
   나온다. (기획서 완료 조건 22)
5. 미만료 lease가 있는 대상 선점이 3으로 실패하고 기존 파일이 그대로다. (기획서 완료 조건 23)
6. 만료 lease 인수가 성공하고 새 소유자의 값으로 바뀐다. (기획서 완료 조건 24)
7. 같은 만료 lease를 동시에 인수하려 한 두 호출 중 정확히 하나만 성공하고, 최종 파일이 이긴 쪽의
   `lease_id`를 갖는다. 잠금을 잡지 못한 호출은 4다. (기획서 완료 조건 25)
8. 갱신·해제가 `lease_id`가 일치할 때만 동작하고 불일치하면 파일을 건드리지 않고 5로 끝난다.
   (기획서 완료 조건 26)
9. 마이그레이션 락이 있으면 헬퍼가 선점하지 않는다. (기획서 완료 조건 27)
10. 기존 Rust·프런트엔드 테스트가 수정 없이 통과한다. 삭제·비활성화된 테스트가 없다.
    (기획서 완료 조건 18)
11. `cargo fmt --check`·`cargo clippy -D warnings`·`cargo test`와 `npm run check`가 통과한다.
    (기획서 완료 조건 29)

## 검증 절차

```sh
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
npm run check
```

이 저장소에서 헬퍼를 직접 돌려 보지 않는다. `.workflow/.runtime/leases/`에는 다음 세션이 읽을 실제
lease가 들어 있고, 실험용 선점이 그 자리에 남으면 다른 세션의 자격 판정을 막는다. 손으로 확인해야
하면 저장소 사본에서 한다.

## 범위 밖

- 공통 규칙 §4와 역할 계약의 선점 서술 갱신, `docs/file-contract.md`의 lease 문단. TASK-041이다.
- 앱이 lease를 만들거나 지우거나 갱신하는 것, 만료 lease를 앱이 자동으로 청소하는 것(기획서 제외 범위).
- lease 스키마 변경. `role` 필드 추가는 TASK-032(SPEC-011)의 몫이고 이 헬퍼는 그 필드를 모른다.
  TASK-032가 먼저 반영되면 헬퍼가 쓰는 다섯 필드는 그대로 두고, 늘어난 필드의 기록 방법은 그 작업이
  정한다.
- 조건 스크립트의 본문·버전·판정. TASK-040이다.
- 헬퍼와 조건 스크립트의 설치 로직을 공용 모듈로 묶는 리팩터링.
- Windows 지원(확인 필요 2번의 결정).
- 헬퍼가 문서 상태를 대신 기록하는 것. 기획서 스켈레톤 생성과 작업 `in_progress` 전이는 세션이 한다.
- 잠금 디렉터리가 남았을 때의 자동 청소.

## 참고 사실

확인 시점 2026-08-03. 추정 없이 파일에서 읽은 값이다.

- `heartbeat_condition.rs`가 조건 스크립트를 관리하는 방식이 이 작업의 선례다. 상수
  (`:14`~`:18`), 본문(`:24`), 오류(`:87`), 경로(`:105`), 설치(`:112`), 검증(`:122`),
  판정(`:127`), 원자적 쓰기(`:164`), 테스트(`:198`~`:367`).
- `install_condition_script`를 부르는 곳은 `heartbeat_service.rs:337` 하나이고, 하트비트 연동 설치
  경로다.
- `install_project_instructions`를 부르는 곳은 `fs_project_repository.rs`의 `:148`·`:307`·`:358`이고,
  `validate_project_instructions`는 `:123` 하나다. `inspect`(`:93`)는 둘 다 부르지 않는다.
- `read_active_leases`(`:568`)는 `.runtime/leases/` 아래 확장자가 `yml`인 파일만 읽고, 열지 못하거나
  파싱에 실패하거나 `expires_at`을 RFC3339로 읽지 못한 파일은 조용히 건너뛴다. 만료 전인 것만 담아
  `expires_at` 오름차순으로 돌려준다.
- 조건 스크립트는 lease를 `[ -f "$leases/$id.yml" ]`로만 본다. 만료를 보지 않는다.
- `AgentLease`(`domain/project.rs:33`)의 `task_id`는 `Option<String>`이다.
- 이 저장소의 `.workflow/.runtime/leases/SPEC-009.yml`은 `expires_at: 2026-08-03T01:20:00Z`로 만료된
  채 남아 있다. 그 세션은 해제 없이 끝났다. 인수는 가정이 아니라 이미 필요한 동작이다.
- `ProjectError`(`fs_project_repository.rs:38`)는 `thiserror` 기반이고 `ProjectInstructionError`를
  `#[error(transparent)]`로 받는다(`:85`).
- 조건 스크립트 테스트는 `sh`가 없는 플랫폼을 고려해 넷 다 `#[cfg(unix)]`다(`:307`·`:323`·`:342`·
  `:351`).
