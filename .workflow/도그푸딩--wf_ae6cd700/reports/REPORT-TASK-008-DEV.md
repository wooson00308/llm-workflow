# TASK-008 개발자 핸드오프

- 대상 작업: TASK-008 (관리 블록 엔진을 잡 종류에 독립적으로 만들고 dream 잡 정의 추가)
- 근거 문서: SPEC-003 R1·R5, DECISION-5276FDBF (approved)
- 세션 역할: 개발자
- 작성 시각: 2026-08-02T07:05Z
- 상태: `qa_waiting`

## 결과

엔진에서 역할 개념을 걷어내고, 역할 잡 정의와 dream 잡 정의를 각각 별도 모듈로 분리했다. 화면과 커맨드는 건드리지 않았다. dream 잡을 실제로 설치하는 경로는 아직 없다(TASK-012 몫).

역할 잡만 설치한 결과는 이 변경 전과 바이트 단위로 같다. 추정이 아니라 실측이다. 변경 전 코드로 기본값 설치 결과를 파일로 덤프해 두고, 변경 후 같은 방식으로 덤프해 `cmp`로 대조했다.

```
변경 전: 6ede72f6bf24d12cda33826fd300f219cf7309a66fcf8f01522a0fa4a2c085ad (1325 bytes)
변경 후: 6ede72f6bf24d12cda33826fd300f219cf7309a66fcf8f01522a0fa4a2c085ad (1325 bytes)
```

이 덤프에 쓴 임시 테스트는 두 번 모두 제거했고, 대신 같은 바이트를 리터럴로 고정한 회귀 테스트를 남겼다(`role_only_block_matches_the_bytes_written_before_the_split`). 완료 조건 12는 이제 사람이 파일을 비교하지 않아도 테스트가 지킨다.

## 변경한 파일

| 파일 | 내용 |
| --- | --- |
| `src-tauri/src/infrastructure/heartbeat_jobs.rs` | 잡 종류에 독립적인 엔진만 남김. `ManagedJob` 도입, `install_managed_jobs`·`validate_managed_jobs`로 API 교체 |
| `src-tauri/src/infrastructure/heartbeat_roles.rs` | 신규. 역할 심볼 이관 + `role_managed_jobs` 변환 |
| `src-tauri/src/infrastructure/heartbeat_dream.rs` | 신규. dream 잡 1종을 R5 기본값으로 조립 |
| `src-tauri/src/infrastructure/heartbeat_status.rs` | `job_name`·`HeartbeatRole` import 경로만 변경 |
| `src-tauri/src/infrastructure/mod.rs` | 모듈 선언 2줄 |
| `src-tauri/src/application/heartbeat_service.rs` | import 경로와 새 설치 API 시그니처에 맞춤 |

프론트엔드(`src/`), `docs/`, `.workflow/` 규칙 문서는 변경하지 않았다.

## 설계 판단

- **엔진에 남긴 것**: 마커 한 쌍·파일 끝 배치, 블록 밖 원문 보존, 마커 손상·흡수 줄 감지, 멱등, 원자적 쓰기, `\r\n` 보존, `interval`·`max_per`·`model` 검증. 전부 연동 수와 무관하게 성립하는 규칙이다.
- **엔진에서 뺀 것**: `HeartbeatRole`, 역할 프롬프트 3종, `job_name`, `RoleJob`, `RoleJobSettings`, 조건 스크립트 경로 상수, `notify` 상수. `notify`는 값이 우연히 두 연동 다 `all`이지만 잡별 필드이므로 각 연동이 소유하게 뒀다.
- **`ManagedJob`은 렌더 직전 상태**로 들어온다. 엔진이 slug를 조립하거나 조건 문자열을 만들지 않는다. `install_managed_jobs`가 `project_root`를 더 이상 받지 않는 이유다.
- **엔진은 병합하지 않는다.** 받은 목록이 블록 전체다. 다른 종류 잡을 보존하는 병합은 연동 목록을 아는 계층(TASK-012)의 몫이라는 작업 지시를 그대로 지켰다.
- **`NotRegularFile` 오류 문구를 "역할 잡" → "잡"으로 바꿨다.** 엔진에 연동별 단어를 남기지 않는다는 완료 조건 1 때문이다. 테스트와 프론트엔드 어디서도 이 문자열을 대조하지 않는 것을 확인하고 바꿨다.
- **dream 잡은 `dream_job(slug)` 하나**다. 사용자 편집값(`model`·`interval`·`max_per`)을 받는 설정 타입은 만들지 않았다. 이번 작업에는 편집 경로가 없고, 쓰이지 않을 인자를 미리 만들지 않는 편이 낫다고 판단했다. TASK-012가 편집을 붙일 때 시그니처를 확장하면 된다. **이 판단은 TASK-012 담당 세션이 뒤집어도 되는 종류다.**

## 검증

전부 이 세션에서 실제로 실행한 결과다.

| 명령 | 결과 |
| --- | --- |
| `cargo test --manifest-path src-tauri/Cargo.toml` | 77 passed / 0 failed (변경 전 71 → 신규 6) |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets` | 경고 0 |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | 통과 |
| `npm run check` | 통과 (타입체크·테스트·빌드) |
| `grep` 엔진 연동별 단어 (`mod tests` 밖) | 결과 없음 |
| `grep home_dir\|env::var("HOME")` (신규 3파일) | 결과 없음 |
| `shasum -a 256 ~/.claude/HEARTBEAT.md` | `96e15096…db88a7`, 작업 전후 동일 |

기존 테스트는 하나도 지우거나 비활성화하지 않았다. 단언은 한 글자도 고치지 않았다. 역할 잡 기반 테스트 10건은 `heartbeat_roles.rs`로 파일만 옮겼고 바뀐 것은 `use` 경로와 `install` 헬퍼 본문(`install_role_jobs` → `role_managed_jobs` + `install_managed_jobs`)뿐이다. 순수 파서 테스트 1건은 엔진에 남겼다.

추가한 테스트 6건:

- `heartbeat_jobs`: 공통 잡 목록이 지정한 순서·필드 배치대로 렌더된다(전체 문자열 대조)
- `heartbeat_roles`: 역할 잡 3종 렌더 결과 바이트 고정
- `heartbeat_dream`: dream 잡 8개 필드가 R5 표의 값으로 렌더된다
- `heartbeat_dream`: 역할 3종 + dream이 마커 블록 하나를 공유하고, 역할 부분이 그대로 앞에 남는다
- `heartbeat_dream`: `interval`이 `2시간`이면 파일 무변경 + `InvalidValue { field: "interval" }`
- `heartbeat_dream`: dream 포함 블록을 같은 입력으로 두 번 설치해도 쓰지 않는다

## 사용자 QA 제안

이번 작업은 화면 변화가 없다. 확인할 것은 "달라진 게 없음"이다.

1. 설정 화면 → 연동 섹션에서 역할 잡 3종을 껐다 켜 본다. 이전과 동작이 같아야 한다.
2. 그 뒤 `shasum -a 256 ~/.claude/HEARTBEAT.md`가 조작 전 값과 같은지 확인한다. (현재 값 `96e15096…db88a7`. 단, 화면에서 `max_per` 등을 손대면 당연히 달라진다.)
3. `heartbeat jobs`에 역할 잡 3종이 그대로 보이는지 확인한다.

## 범위 밖 발견 / 핸드오프 노트

- **작업 문서의 범위 목록에 `heartbeat_status.rs`가 빠져 있다.** 이 파일이 `job_name`·`HeartbeatRole`을 쓰고 있어서, 두 심볼을 `heartbeat_roles.rs`로 옮기면 import 경로를 함께 고칠 수밖에 없다. 작업 지시가 명시적으로 허용한 "import 경로 수정"에 해당한다고 보고 진행했다. 변경은 `use` 두 줄뿐이고 로직은 그대로다.
- **`heartbeat_status.rs`의 중복 감지는 아직 역할 전용이다.** `CONDITION_SCRIPT_FILE`(`wf-eligible.sh`)로만 판정하므로 dream 잡 중복(`dream-prep` 참조)은 잡히지 않는다. SPEC-003 R6이고 TASK-009 범위다. 이 작업에서 손대지 않았다.
- **`#![allow(dead_code)]`가 신규 2개 모듈에도 붙어 있다.** 기존 모듈과 같은 이유(호출부 연결 전)이고 주석에 해제 시점을 적어 뒀다. dream 쪽은 TASK-012, 역할 쪽은 기존 표기를 유지했다.
- **역할 잡 `default_settings`의 `max_per`는 여전히 `6/24h`(developer)인데 실제 `~/.claude/HEARTBEAT.md`는 `8/24h`다.** 사용자가 화면에서 편집한 값이라 정상이다. 골든 테스트는 기본값 기준이므로 이 차이와 무관하다.
- 조건 스크립트 이중화와 `revision_requested` 미감지는 이전 보고서들이 이미 올린 미해결 항목이고, 이번 범위에서 손대지 않았다.

## 상태

TASK-008은 `qa_waiting`. 사용자 QA 결과가 `decisions/`에 기록되기 전까지 다음 작업(TASK-009)으로 넘어가지 않는다. `.workflow/.runtime/leases/TASK-008.yml`은 반납했다.
