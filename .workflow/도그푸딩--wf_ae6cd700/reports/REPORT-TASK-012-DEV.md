# TASK-012 개발자 핸드오프

- 대상 작업: TASK-012 (dream 잡 설치·토글·편집과 역할 잡 독립 토글 보장)
- 근거 문서: SPEC-003 R4·R5, DECISION-5276FDBF (approved)
- 세션 역할: 개발자
- 작성 시각: 2026-08-02T11:35Z
- 상태: `qa_waiting`

## 결과

dream 잡을 관리 블록에 설치·토글·편집하는 경로를 넣었다. 관리 마커 블록은 그대로 하나이고, 두 연동이 그 블록을 공유한다.

핵심은 병합이다. 설치 요청은 자기 연동 몫만 담고, 블록 전체는 서비스가 만든다. 역할 잡 저장이 dream 잡을 지우지 않고, dream 잡 저장이 역할 잡을 지우지 않는다. 잡 순서는 요청 순서와 무관하게 역할 3종(planner → architect → developer) 다음 dream으로 고정된다.

dream 설치 경로는 조건 스크립트를 쓰지 않는다. 프로젝트 로컬 파일을 하나도 만들지 않는 유일한 설치 경로다.

## 변경한 파일

| 파일 | 내용 |
| --- | --- |
| `src-tauri/src/application/heartbeat_service.rs` | 블록 병합(`merge_block`, `preserved_role_jobs`, `preserved_dream_job`, `validate_preserved`, `read_document`), `install_dream()`, `DreamJobRequest`·`ManagedDreamJob`, dream payload에 `managedJob`·`lastRun`, `HeartbeatInstallError::PreservedJob`. 신규 테스트 12개 |
| `src-tauri/src/infrastructure/heartbeat_dream.rs` | `DreamJobSettings`·`default_settings()`·`dream_job_with()` 추가. `dream_job()`은 기본값 래퍼로 유지. 파일 상단 `#![allow(dead_code)]` 제거(이 작업이 연결 완료 시점) |
| `src-tauri/src/commands/heartbeat.rs` | `install_dream_job` 커맨드 |
| `src-tauri/src/lib.rs` | 핸들러 등록 |
| `src/features/projects/domain/types.ts` | `ManagedDreamJob`·`DreamJobRequest`·`IntegrationWriteError`, `DreamIntegration`에 `managedJob`·`lastRun`, 게이트웨이·액션에 `installDreamJob` |
| `src/features/projects/infrastructure/tauriProjectGateway.ts` | `installDreamJob` |
| `src/features/projects/application/useProjectWorkspace.ts` | 쓰기 경로를 `writeIntegration(integration, write)` 하나로 모으고 `installDreamJob` 추가. 실패 사유에 연동 id를 함께 담는다 |
| `src/features/projects/components/integrations/DreamCard.tsx` | `DreamJob` 본문 컴포넌트(설치·토글·편집·확인·실행 기록·쓰기 실패) |
| `src/features/projects/components/integrations/DreamCard.test.tsx` | dream 잡 UI 테스트 9개 추가 |
| `src/features/projects/application/useProjectWorkspace.test.ts` | 픽스처 갱신, 연동별 쓰기 실패 태깅 테스트 1개 추가 |
| `src/features/projects/components/SettingsView.test.tsx` | 픽스처 갱신, 카드별 실패 문구 격리·역할 잡 폼 독립 테스트 2개 추가 |

### 범위 밖이지만 바꾼 파일

- `src/features/projects/components/integrations/IntegrationSection.tsx` — 한 줄이다. `writeError?.integration === id`일 때만 그 카드에 문구를 내려보낸다. 이유는 아래 "쓰기 실패는 요청한 카드에만" 참조. `HeartbeatCard.tsx`는 여전히 `writeError: string | null`을 받으므로 한 줄도 바뀌지 않았다.
- `src/features/projects/components/WorkspaceShell.test.tsx` — `integrationActions` 픽스처에 `installDreamJob`을 더한 것이 전부다. 액션이 필수 필드라 이 픽스처를 고치지 않으면 `npm run typecheck`가 통과하지 않는다(완료 조건 9).

## 설계 판단

- **블록 전체는 서비스가 만든다.** 커맨드는 자기 연동의 desired state만 받는다(`RoleJobRequest[]` / `DreamJobRequest`). 카드가 남의 연동 값을 payload에 실어 보내는 구조였다면, 화면이 아직 읽지 못한 값을 저장 시점에 되돌려 쓰는 사고가 난다. 지금은 요청에 그 값이 존재하지 않는다.
- **보존은 블록에서 읽어 다시 만든다.** 다른 연동의 잡은 `interval`·`max_per`·`model`만 블록에서 읽고, 앱 소유 필드(`prompt`·`timeout`·`condition`·`notify`·`slug`)는 항상 앱이 다시 만든다. 사용자가 앱 소유 필드를 손으로 고쳤다면 앱 값으로 돌아온다. 이건 SPEC-002가 정한 소유권 규약 그대로다.
- **블록에 없는 잡은 되살리지 않는다.** 보존은 "블록에 있는 잡"만 대상으로 한다. `managed_role_jobs`/`managed_dream_job`이 `None`을 주면 그 잡은 병합 결과에 없다. 그래서 "역할만" / "dream만" 조합이 유지된다.
- **필드가 비어 있으면 그 연동의 기본값을 쓴다.** 사용자가 `- interval:` 줄만 지운 경우다. 잡 자체는 남아 있으므로 없애지 않고, 그 필드만 기본값으로 채운다.
- **값이 깨져 있으면 실패한다.** 보존 대상 잡의 값이 검증을 통과하지 못하면 `PreservedJob { job, source }`로 실패하고 아무 파일도 쓰지 않는다. 조용히 기본값으로 되돌리면 사용자가 손으로 적은 값이 저장 한 번에 사라진다. 메시지에 잡 이름과 필드 이름이 모두 들어간다.
- **읽지 못한 문서를 빈 문서로 보지 않는다.** `read_document()`는 `NotFound`만 빈 문서로 처리하고 나머지 I/O 오류는 올린다. 못 읽은 파일을 빈 문서로 보면 "다른 연동 잡이 하나도 없다"는 병합이 만들어진다.
- **잡 순서를 연동 목록 순서로 고정했다.** `merge_block(role_jobs, dream_job)`이다. 순서를 요청 순서에 맡기면 같은 상태가 설치 이력에 따라 다른 바이트가 되고, 멱등 판정이 "내용 동일"이라 매번 파일을 다시 쓴다.
- **dream 설치는 조건 스크립트를 건드리지 않는다.** dream 잡의 조건은 `dream-prep check-unprocessed`이고 앱 관리 스크립트를 거치지 않는다. `install_dream()`은 `install_condition_script`를 부르지 않으며, 테스트가 "dream만 설치했을 때 `.workflow/` 자체가 생기지 않는다"까지 단언한다. 역할 잡 경로의 순서(스크립트 먼저, 잡 나중)는 그대로 두었다.
- **쓰기 실패는 요청한 카드에만 보인다.** `IntegrationsState.writeError`를 `{ integration, message }`로 바꿨다. 단일 문자열로 두면 dream 쓰기 실패가 하트비트 카드에 "역할 잡을 쓰지 못했습니다"로 표시된다. 사용자가 해야 할 일을 잘못 읽는 화면이라 dream을 붙이면서 같이 정리했다. 필터는 섹션이 하고, 카드는 여전히 `string | null`만 안다.
- **dream 카드는 하트비트 카드의 코드를 재사용하지 않는다.** 검증 규칙·라벨·기본값을 `DreamCard.tsx` 안에 따로 뒀다. 완료 조건 3이 "dream 카드가 하트비트 전용 타입·컴포넌트를 재사용하지 않음"을 확인 대상으로 삼는다. 공유하는 것은 연동 골격(`IntegrationCard`)과 앱 공용 `ModelField`뿐이다.
- **토글 초기값은 항상 켜짐이다.** 하트비트 카드의 `firstInstall || Boolean(installed)`을 잡 하나짜리 연동에 적용하면 두 항이 모두 참으로 접힌다. 블록에 없으면 "첫 설치"로 보고 켠 상태에서 시작하고, 끄고 저장하면 잡이 사라진 뒤 화면이 다시 첫 설치 상태로 돌아온다. 역할 잡을 전부 끈 뒤와 같은 동작이다.
- **"미설치"라는 낱말을 잡 안내에 쓰지 않았다.** 배지의 "설치됨"은 dream 스킬 이야기이고, 잡이 없다는 사실은 다른 판정이다. 같은 낱말로 적으면 한 카드 안에서 두 판정이 뒤섞여 읽힌다. 문구는 "앱 관리 블록에 이 프로젝트의 dream 잡이 아직 없습니다"로 했다. 기존 테스트(`tells the three install states apart`)가 설치됨 상태에서 "미설치"가 없어야 한다고 단언하고 있어, 그 단언을 약화시키지 않고 문구를 맞췄다.
- **실행 기록은 dream payload가 자기 몫을 따로 읽는다.** `read_job_runs(...).get("wf-dream<slug>")`다. 하트비트와 상태 파일을 한 번만 읽어 나눠 쓰면 그 파일을 못 읽었을 때 어느 카드의 값이 빈 것인지 알 수 없다. 조회당 `state.json`을 한 번 더 읽는 비용이 붙는다(읽기 전용, 작은 JSON).

## 검증

### 자동화

```sh
cargo test --manifest-path src-tauri/Cargo.toml   # 107 passed / 0 failed (95 → 107, 신규 12개)
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check   # 차이 없음
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets   # 경고 0
npm run check   # typecheck + vitest 78 passed / 11 files + vite build 통과
```

신규 백엔드 테스트(전부 `tempfile::tempdir` 가짜 홈, 실제 `~/.claude` 무접촉):

| 테스트 | 대응 완료 조건 |
| --- | --- |
| `installing_only_the_dream_job_writes_one_block_with_one_job` | 1 |
| `installing_only_the_dream_job_writes_no_project_local_file` | 작업 내용 0·2 |
| `installing_dream_keeps_the_role_jobs_byte_for_byte_and_appends_after_them` | 1·3 |
| `saving_role_jobs_keeps_an_installed_dream_job` | 3 |
| `the_install_order_does_not_change_the_file` | 작업 내용 1 |
| `the_same_dream_install_twice_does_not_change_the_file` | 2 |
| `turning_the_dream_job_off_and_on_restores_the_first_install` | 4 |
| `turning_both_integrations_off_removes_the_block_and_keeps_the_rest` | 3 |
| `a_damaged_preserved_role_job_stops_the_dream_install` | 작업 내용 1 |
| `an_invalid_dream_setting_writes_nothing` | 작업 내용 2 |
| `damaged_markers_stop_the_dream_install_without_touching_the_file` | 작업 내용 5 |
| `a_field_line_after_the_end_marker_stops_the_dream_install` | 작업 내용 5 |

신규 프론트 테스트: 확인 절차 없이는 게이트웨이 미호출, 검증 실패 시 확인 화면 미개방, 쓰기 실패 문구 표시, 확인 화면의 대상 경로·프로젝트 로컬 무기록 안내·기록 값, 토글 끄기 요청, 실행 기록/무기록, 기본값과 근거 문구, 설치 전 잡 UI 은닉. 섹션 레벨로 역할 잡 폼 독립(완료 조건 3)과 카드별 실패 문구 격리.

SPEC-002 대응 기존 테스트는 삭제·비활성화 없이 전부 통과한다. `role_only_block_matches_the_bytes_written_before_the_split`(완료 조건 6 = 기획서 완료 조건 12)도 그대로다.

### 실증

```sh
dream-prep check-unprocessed --slug=-Users-catze-project-workflow-labs   # exit=0 (미처리 23개)
dream-prep check-unprocessed --slug=-Users-catze-no-such-project         # exit=1
```

완료 조건 5 확인. `dream-prep`은 PATH에 없고 `/Users/catze/.pyenv/versions/3.11.9/bin/dream-prep`에 있다. 기획서 "확인 필요 1번"이 지적한 PATH 문제가 이 환경에서 실재한다. 하트비트 데몬이 이 경로를 볼 수 있는지는 앱이 판단하지 못하며, 카드가 조건 원문을 보여주는 이유가 그것이다.

```sh
shasum -a 256 ~/.claude/HEARTBEAT.md   # 96e1509... (세션 시작·종료 동일)
diff /tmp/HEARTBEAT.before.md ~/.claude/HEARTBEAT.md   # 차이 없음
ls -la .workflow/rules/                # wf-eligible.sh 수정 시각 무변화
```

이 세션은 전역 파일도 프로젝트 로컬 조건 스크립트도 쓰지 않았다.

### 하지 않은 검증

GUI를 띄워 네 조합을 실제로 만드는 절차는 하지 않았다. 앱 실행이 필요하고, 실제 전역 파일에 쓰는 액션이라 사용자 확인 없이 진행하지 않았다. 아래가 QA에서 확인할 것들이다.

- 완료 조건 1~4·6의 화면 확인(네 조합: 둘 다 없음 / 역할만 / dream만 / 둘 다)
- `heartbeat jobs`가 `wf-dream-Users-catze-project-workflow-labs`를 인식하는지
- 완료 조건 7(설치 액션 없이 앱 실행·프로젝트 열기·새로고침 반복 후 전역 파일 무변화)
- 블록 밖 사용자 잡 보존은 자동화 테스트가 덮지만, 실제 파일에 사용자 잡을 임시로 하나 넣고 확인하면 더 확실하다(TASK-012 참고 사실 3번)

## 후속 / 리스크

- **한 관리 블록을 여러 프로젝트가 공유하면 다른 프로젝트 잡이 지워진다.** `~/.claude/HEARTBEAT.md`는 전역 파일인데 관리 블록은 하나다. 프로젝트 A에서 설치하면 블록이 A의 잡으로 통째로 다시 써지고, 블록 안에 있던 프로젝트 B의 잡은 사라진다. 이번 변경으로 생긴 문제가 아니라 SPEC-002 시점부터 있던 성질이고(`install_managed_jobs`는 블록을 통째로 다시 쓴다), 이번 병합은 연동 축만 다룬다. 도그푸딩 환경은 프로젝트가 하나라 드러나지 않는다. 프로젝트 축 병합 또는 프로젝트별 블록은 별도 기획 대상이다. **역할 밖 발견이라 고치지 않았다.**
- **`heartbeat_jobs.rs`·`heartbeat_roles.rs`·`heartbeat_status.rs` 상단의 `#![allow(dead_code)]`가 남아 있다.** 주석은 "TASK-006·TASK-007 연결이 끝나면 지운다"고 적혀 있고 그 연결은 이미 끝났다. `heartbeat_dream.rs`는 주석이 TASK-012를 지목해서 이번에 지웠다. 나머지 셋은 이 작업 범위 밖이라 두었다.
- **dream 카드와 하트비트 카드가 필드 검증 규칙·라벨을 각각 들고 있다.** 완료 조건 3이 요구하는 격리의 대가다. 세 번째 연동이 잡 편집 UI를 가지면 세 벌이 된다. 그때 공용 필드 모듈을 뽑을지 판단하면 된다. 지금 뽑으면 하트비트 카드를 함께 고쳐야 해서 이 작업 범위를 넘는다.
- **`state.json`을 조회당 두 번 읽는다.** 하트비트 역할 잡용 한 번, dream용 한 번. 읽기 전용이고 파일이 작아 2.5초 주기에 문제가 되는 크기는 아니다. 연동이 늘어 읽기 횟수가 연동 수만큼 늘면 스냅샷 조회에서 한 번만 읽어 나눠 주는 형태로 바꾸는 것이 맞다. 그때 읽기 실패를 어느 카드에 담을지 함께 정해야 한다.
- **잡 이름 규칙은 바꾸지 않았다.** `wf-dream<slug>`이다. 이름을 바꾸면 `state.json`의 실행 이력과 쿼터가 끊긴다.
