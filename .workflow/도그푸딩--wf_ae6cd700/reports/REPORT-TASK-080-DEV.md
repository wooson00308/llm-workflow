# TASK-080 개발자 핸드오프

- 대상: TASK-080 (프로젝트 잡 파일 하나를 통째로 쓰는 인프라를 만든다)
- 근거: SPEC-024 R1, DECISION-3C8F1A42 / 상태: `qa_waiting` (lease-67618-20260804092927, acquire·renew 전부 exit 0)
- 선행: TASK-064 (`qa_waiting`) — 같은 파일을 고치므로 그 작업 트리 위에 얹었다.

## 변경한 파일

`src-tauri/src/infrastructure/heartbeat_jobs.rs` 하나. 그 외 파일은 한 줄도 고치지 않았다.
서비스·상태 조회·프론트엔드·문서 무변경, 보호 상태 무변경, git 커밋 없음.

**이 작업이 끝난 시점에 앱의 동작은 한 가지도 바뀌지 않는다.** 새 함수 둘은 아무도 부르지 않는다
(배선은 TASK-081). 모듈 최상단에 이미 `#![allow(dead_code)]`가 있어 미사용 경고도 나지 않는다.

## 만든 것

### `project_jobs_path(heartbeat_home, slug) -> PathBuf`

`<heartbeat_home>/heartbeat/jobs.d/<slug>.md`. 작업 문서 지시대로 **경로 정의를 이 한 곳에만** 두었고,
그 이유(확인 사실 11의 상수 4곳 분산 사고를 새 경로에서 반복하지 않는다)를 doc 주석에 남겼다.

### `write_project_jobs(path, jobs) -> Result<bool, HeartbeatJobsError>`

반환값 규칙은 `install_managed_jobs`와 같다 — "실제로 썼는가".

1. `validate_managed_jobs`를 먼저 통과시킨다. 걸리면 파일을 만들지도 고치지도 않는다.
2. 대상이 있으면 `ensure_regular_file`로 거른 뒤 읽는다. 지우는 저장(빈 목록)도 이 검사를 거친다.
3. 빈 목록이면 파일을 지운다. 이미 없으면 무동작 + `false`.
4. 렌더 결과가 현재 내용과 바이트로 같으면 `false`.
5. 다르면 부모 디렉터리를 `create_dir_all`로 만들고 `write_text_atomically`로 쓴다.

마커·부분 교체·보존·흡수 줄 검사는 넣지 않았다. 파일 전체가 앱 소유라 그 전제가 서지 않는다(R6).

**줄바꿈은 언제나 `\n`이다.** 마커 블록 쓰기는 남의 표기를 따라가야 해서 `newline_for`를 쓰지만, 이
파일에는 따라갈 남이 없다. 표기를 하나로 고정해야 완료 조건 12(두 번째 저장이 쓰지 않음)가 성립한다.
사용자가 CRLF로 손편집한 파일은 다음 저장 때 한 번 LF로 정규화되고, 그 뒤로는 멱등이다. 작업 문서가
"줄바꿈 표기는 구현이 정하되 멱등성으로 고정한다"고 위임한 부분이라 그렇게 정했다.

### 렌더 분리

`render_block`에서 잡 구간만 `render_jobs(jobs) -> Vec<String>`으로 뺐다. `render_block`은 그것을
마커로 감싸기만 한다. 잡 사이 빈 줄 규칙도 함께 옮겼으므로 **블록 렌더 결과 문자열은 한 글자도 바뀌지
않았다** — 완료 조건 8 근거는 아래 검증에 적었다.

## 완료 조건 대조

| # | 조건 | 근거 |
|---|---|---|
| 1 | 경로 함수가 jobs.d 경로를 낸다 | `the_project_job_file_lives_in_jobs_d_under_the_heartbeat_home` |
| 2 | 계약 잡 문법으로 기록, 제한 없음만 `max_per` 없음 | `a_project_file_holds_only_the_contract_job_syntax` (전문 대조 + 되읽어 필드 8개/7개) |
| 3 | jobs.d 없는 홈에서 디렉터리를 만든다 | `a_missing_jobs_d_directory_is_created_by_the_write` |
| 4 | 두 번째 저장은 쓰지 않고 내용 그대로 | `writing_the_same_list_twice_does_not_write_the_second_time` |
| 5 | 빈 목록은 파일 삭제 / 없으면 무동작 | `an_empty_list_removes_the_file_and_leaves_a_missing_file_alone` |
| 6 | 검증 실패는 파일을 만들지도 고치지도 않음 | `a_rejected_job_leaves_the_project_file_untouched` (신규·기존 두 경우 다) |
| 7 | 일반 파일이 아니면 블록 쓰기와 같은 오류 | `a_project_path_that_is_not_a_regular_file_is_rejected` (쓰는 저장·지우는 저장 둘 다) |
| 8 | 블록 렌더 전후 동일, 063·064 테스트 무수정 통과 | 아래 참조 |
| 9 | 잡 이름·slug 규칙 무변경 | 아래 참조 |
| 10 | 기존 테스트 삭제·비활성화 없음 | 372 → 380, 삭제 0 |
| 11 | `npm run check` + `cargo test` 통과 | 아래 참조 |

### 완료 조건 8 근거

기존 테스트를 **한 줄도 고치지 않았다.** 테스트 모듈에서 손댄 곳은 `use super::{...}`에 새 함수 두
이름을 더한 것뿐이고, 단언값은 하나도 건드리지 않았다. 착수 전 baseline 372 passed와 변경 후 380
passed가 모두 통과이므로, TASK-063·064의 픽스처 대조 테스트
(`renders_jobs_in_the_given_order_with_a_fixed_field_layout`,
`an_unlimited_job_is_written_without_the_quota_line` 등)가 수정 없이 통과한다.

추가로 `both_writes_render_the_same_job_lines`를 넣어, 마커 블록의 속과 프로젝트 파일이 같은 렌더임을
직접 고정했다. 분리한 렌더가 나중에 한쪽만 바뀌면 이 테스트가 먼저 깨진다.

### 완료 조건 9 근거

`git diff -U2 src-tauri/src/infrastructure/heartbeat_jobs.rs`로 확인했다. `project_slug`(작업 트리
기준 `:128`~`:135`) 본문에 변경 줄이 하나도 없다. diff에서 그 근처에 보이는 헝크 헤더
`@@ -127,19 +135,27 @@ pub fn project_slug`는 함수를 바꿨다는 뜻이 아니라 감싸는 문맥
표시이고, 실제 변경 줄은 전부 그 아래 `install_managed_jobs`의 시그니처 — 즉 **TASK-064의 변경분**이다.
이번 작업이 만든 diff에는 slug·잡 이름 규칙이 들어 있지 않다.

## 검증

- `cargo test --manifest-path src-tauri/Cargo.toml` — **380 passed, 0 failed**
  (착수 전 baseline 372 passed / 신규 8개)
- `npm run check` — 통과. typecheck OK, 프론트엔드 406 passed (17 files), vite build 성공
- `cargo fmt -- --check` — exit 0
- `cargo clippy --all-targets` — 이번 변경분에 경고 0

## 리스크·핸드오프

1. **`npm run check`가 한 번 실패했다가 통과했다.** 첫 실행에서
   `IntegrationsView.test.tsx:225`의 TS2322(`ReturnType<typeof vi.fn>`이 `installDreamJob` 시그니처와
   불일치)로 typecheck가 깨졌다. 그 파일은 이 작업 범위 밖이고, 당시 다른 세션이 편집 중이었다
   (mtime 18:32:39 → 18:33:28, 이 세션 선점 이후). 재실행에서 통과했으므로 편집 중 일시 상태였다.
   범위 밖이라 손대지 않았다. TASK-072·077·079 중 그 파일을 범위에 둔 세션의 산출물이니, 그쪽
   QA에서 최종 상태를 한 번 더 확인하면 좋겠다.
2. **`heartbeat_process.rs:216`에 clippy 경고 하나가 있다**(`cloned_ref_to_slice_refs`). 이 작업
   이전부터 있던 것이고 범위 밖이라 두었다. 정리하려면 별도 작업이 필요하다.
3. **미배선 상태로 남는다.** `write_project_jobs`·`project_jobs_path`를 부르는 곳이 아직 없다.
   TASK-081이 서비스를 이 경로로 옮기기 전까지 앱은 계속 `HEARTBEAT.md`만 쓴다. 즉 SPEC-024 확인
   사실 2·6이 적은 크로스 프로젝트 증발 위험은 이 작업으로 줄어들지 않았다.
4. **`ensure_regular_file`은 심볼릭 링크를 거부한다**(`symlink_metadata` 사용). 기존 블록 쓰기와 같은
   성질이라 그대로 뒀지만, jobs.d 파일을 링크로 관리하는 사용자가 있다면 저장이 막힌다. 계약이
   요구하는 바는 아니고 지금 문제로 관측된 적도 없어 변경하지 않았다.
5. **`fs::read_to_string`이라 UTF-8이 아닌 기존 파일은 읽기에서 실패한다.** 이 역시 블록 쓰기와 같은
   성질이고, 앱이 쓰는 파일은 언제나 UTF-8이다.
