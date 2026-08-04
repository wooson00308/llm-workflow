# TASK-083 개발자 핸드오프

> 기록 경위: 하네스가 서브에이전트(tl-dev-077, TASK-083 담당 재배정)의 보고서 파일 작성을 차단해, 발신된 전문을 TL이 대리 기록한다. 내용은 발신 전문 그대로다. (수신 2026-08-04T10:53Z, TL 세션)

- 대상: TASK-083 (화면이 가리키는 파일을 실제로 쓰는 파일로 바꾼다, SPEC-024 R7·완료 조건 10)
- 근거: DECISION-3C8F1A42 (`approved`·`created_by: user` 직접 확인) / 상태: **`qa_waiting`**
- lease: `lease-18071-20260804103813` (acquire·renew·release 전부 exit 0)

## 선행 확인 — 배정 메시지와 문서가 다르다 (먼저 볼 것)

TL 배정은 `depends_on`을 네 건(082·065·072·073)으로 적었으나 **작업 문서에는 다섯 건**이고 `TASK-092`가 더 있다(문서 `updated_at: 2026-08-04T10:31:00Z` — 배정 메시지 작성 이후 추가된 것으로 보인다). 다섯 건을 직접 확인했고 **전부 `qa_waiting`**이라 의존성은 충족이다. TASK-092가 넣은 네 번째 문장(dream 잡 기본값 재설정 확인 화면)도 이 작업이 함께 갈아 끼웠다.

## 핵심 결정과 근거

1. **경로를 payload로 내렸다.** `IntegrationsSnapshot`에 `jobs_file_path`(camelCase `jobsFilePath`) 하나. 값은 `inspect`가 **읽기에 쓴 그 경로 객체**를 그대로 문자열로 만든 것이라 화면이 가리키는 파일과 앱이 실제로 여는 파일이 갈라질 수 없다. `project_jobs_path(...)`를 인자 자리에서 즉석 호출하던 것을 `jobs_path` 지역 변수로 묶어 한 번만 계산한다.
2. **TS 타입에서 이 필드는 필수(`string`)다.** TASK-077의 `conditionOutput`을 선택 필드로 둔 것과 반대 판단이고 이유가 다르다. 그 값은 없는 것이 정상이었지만, 이 값은 백엔드가 늘 보내고 **없으면 확인 화면이 파일 경로 자리에 `undefined`를 그린다** — 이 작업이 없애려는 사고와 같은 종류라 컴파일러가 잡게 뒀다. 대가로 픽스처 팩토리 셋을 고쳤다.
3. **`IntegrationsView.tsx`는 고치지 않았다.** 작업 문서가 범위에 넣었지만 실제 코드는 `snapshot={snapshot}`으로 객체를 통째로 두 카드에 넘기고 카드가 `snapshot.jobsFilePath`를 바로 읽는다. 넘기는 코드를 더할 자리가 없다(`managedBlockFailure`도 같은 길).
4. **확인 화면 넷을 모두 고쳤다.** 완료 조건 2는 셋을 지명하지만 네 번째(dream 기본값 재설정)도 같은 `heartbeatFilePath` 상수를 썼다. "손으로 적은 상수가 남지 않는다"를 지키려면 넷 다 필요하다.

## 변경한 파일 (넷 + 테스트 셋 + 작업 문서)

1. `src-tauri/src/application/heartbeat_service.rs` — `IntegrationsSnapshot`에 `jobs_file_path`, `inspect`의 `jobs_path` 바인딩과 필드 채움, 신규 테스트 둘 + 기존 테스트 하나에 단정 추가.
2. `src/features/projects/domain/types.ts` — `IntegrationsSnapshot.jobsFilePath: string`.
3. `HeartbeatCard.tsx` — `heartbeatFilePath` 제거, 상수 셋 신설(`jobsFileNote`·`otherProjectsNote`·`duplicateResolutionNote`), 확인 화면 둘과 중복 경고.
4. `DreamCard.tsx` — 같은 제거·신설, 확인 화면 둘과 중복 경고.
5. 테스트: `IntegrationsView.test.tsx`, `DreamCard.test.tsx`, `useProjectWorkspace.test.ts`.

`IntegrationsView.tsx`·`IntegrationCard.tsx`·`heartbeat_status.rs`·`heartbeat_jobs.rs` 무변경. 보호 상태 무변경. git 커밋·푸시·checkout·restore·stash 없음.

**실기기 `~/.claude` 무변경.** 종료 시점(19:51 KST) `HEARTBEAT.md` 17:50:43, `jobs.d/-Users-catze-Git-mech-arena.md` 17:50:43, `jobs.d/-Users-catze-project-workflow-labs.md` 16:58:15 — TASK-081·082 보고서가 기록한 값과 같다. 모든 테스트가 `tempdir()`만 쓴다.

## 바뀐 문장 (완료 조건 3·4·5)

파일 설명 (네 확인 화면 공통): "전역 파일입니다. 이 컴퓨터의 모든 프로젝트가 함께 씁니다." → **"이 프로젝트 전용 파일입니다. 다른 프로젝트의 잡은 각자의 파일에 있습니다."**

TASK-065·092가 넣은 보장 문장을 갈아 끼운 자리(완료 조건 8이 요구한 기록): "다른 프로젝트가 이 블록에 둔 잡도 값 그대로 남습니다." → **"다른 프로젝트의 잡은 이 파일에 들어올 수 없어 영향을 받지 않습니다."** — 두 작업이 넣은 것은 "한 파일을 나눠 쓰는데 앱이 남의 잡을 보존한다"는 보장이었다. 파일이 갈린 뒤 그 문장은 참이지만 전제가 사라져 사용자가 여전히 한 파일을 공유한다고 읽는다. 지운 것이 아니라 같은 걱정에 더 강한 답을 놓았다.

역할 잡 설치 확인 본문: "앱 관리 블록만 다시 씁니다. 블록 밖의 잡과 전역 설정은 읽기만 하고 그대로 둡니다." → **"이 파일 전체를 앱이 다시 씁니다. 손으로 덧붙인 줄은 남지 않습니다."** (+ 위 보장 문장). 뒤 절은 TASK-081 핸드오프 4번(통째 쓰기의 성질)을 사용자에게 밝힌 것이다 — 전환 전에는 블록 밖이 보존됐으므로 새로 생긴 사실이다.

역할 전부 끄기(완료 조건 4): "활성 역할이 없어 관리 블록 전체를 제거합니다." → **"활성 역할이 없어 이 프로젝트의 잡 파일을 지웁니다."**

중복 경고 제목(완료 조건 5, "관리 블록 밖" 전제 제거): "관리 블록 밖에 같은 프로젝트의 역할 잡이 있습니다" → **"이 프로젝트의 역할 잡이 옛 전역 파일에도 있습니다"** (dream도 같은 꼴). 뒷문장은 두 카드 공통:

> **이름이 같으면 데몬이 이 프로젝트의 잡 파일을 우선하고 옛 정의는 무시합니다. 이름이 다르면 둘 다 실행됩니다. 앱이 전환 전에 옛 파일에 써 둔 정의는 이 카드에서 한 번 저장하면 앱이 치웁니다. 손으로 적은 잡은 앱이 지우지 않으므로 직접 정리해야 합니다.**

"이름이 다르면 둘 다 실행됩니다"를 함께 적은 이유: 우선순위만 적으면 사용자가 위험이 이미 해소됐다고 읽는다. 실제 피해(두 세션 동시 기동)는 이름이 갈릴 때 일어나고 앞 문장이 그 피해를 설명한다.

## 완료 조건 대조

1. `the_snapshot_names_the_file_the_save_actually_wrote` — 저장이 돌려준 `jobs_file_path`가 `jobs_file(project, home)`과 같고 그 파일이 실제로 있으며, 옛 전역 파일 경로와 다르고 그 파일은 만들어지지도 않는다. `the_dream_snapshot_names_the_same_jobs_file`이 dream 저장도 같은 파일을 가리키는지 본다. 파일 없는 홈에서도 경로가 나가는 것은 `an_empty_home_reports_the_slug_and_the_condition_script_path`에 더한 단정.
2. 네 확인 화면 모두 `snapshot.jobsFilePath`를 그린다. `grep -n "heartbeatFilePath"` 두 카드 0건. 각 확인 화면 테스트가 `toHaveTextContent(jobsFilePath)` + `not.toHaveTextContent("~/.claude/HEARTBEAT.md")`를 함께 단언.
3. 아래 문구 대조.
4. `toHaveTextContent("활성 역할이 없어 이 프로젝트의 잡 파일을 지웁니다")`.
5. 두 카드 중복 경고 테스트가 `not.toHaveTextContent("관리 블록 밖에")` + 데몬 우선순위·정리 시점 문장을 함께 단언.
6. 기존 `tells the unreadable state apart from a block without role jobs`가 두 상태를 한 테스트에서 만들어 대조한다(통과). 이 작업은 그 픽스처 `path`를 잡 파일 경로로 바로잡았다 — TASK-081 이후 `managedBlockFailure`는 잡 파일 읽기 실패인데 픽스처가 옛 전역 파일을 가리키고 있었다. dream 쪽 같은 describe도 함께.
7. `installationNote`는 HEAD와 같다(문장 대조 확인). `HeartbeatSetupWizard.tsx`는 `git status`에 아예 잡히지 않는다.
8. 아래 "고친 테스트".
9. 아래 게이트.

### 두 카드 문구 대조 (완료 조건 3)

두 파일에서 세 상수 값을 뽑아 `diff` — 바이트까지 동일(각 357바이트, 차이 0).

변이 확인: `DreamCard.tsx`의 `duplicateResolutionNote` 끝을 "직접 정리해야 합니다" → "직접 정리하세요"로 바꾸자 신규 테스트 `explains a duplicate with one resolution wording shared by both cards`가 기대 2 대 실제 1로 실패. 원본 복구(백업본 되돌림) 후 재통과.

## 고친 테스트와 그 이유 (완료 조건 8)

**삭제·비활성화 0.** 신규 셋, 픽스처 팩토리 셋, 단정 갱신 여덟, 픽스처 경로 둘.

- **신규 셋**: `the_snapshot_names_the_file_the_save_actually_wrote`, `the_dream_snapshot_names_the_same_jobs_file`(Rust), `explains a duplicate with one resolution wording shared by both cards`(두 카드를 함께 그려 공통 뒷문장이 둘인지 센다).
- **픽스처 팩토리 셋**(필수 필드가 늘어 컴파일이 요구): `useProjectWorkspace.test.ts`의 `snapshot` 상수, `DreamCard.test.tsx`·`IntegrationsView.test.tsx`의 `snapshot()` 팩토리에 `jobsFilePath` 추가. 값은 각 테스트 파일 상수(`/home/tester/.claude/heartbeat/jobs.d/-projects-workflow-labs.md`)이고 단정이 그 상수를 참조한다.
- **단정 갱신 여덟**(전부 문구·경로 변경의 직접 결과): IntegrationsView 쪽 — 역할 잡 설치 확인(경로·파일 설명·본문), 전부 끄기 안내, 기본값 재설정 확인(경로·본문), 중복 경고 제목·뒷문장. DreamCard 쪽 — 설치 확인(경로·파일 설명·본문), 기본값 재설정 확인(경로·본문), 중복 경고 제목·뒷문장. 검사하던 성질("확인 화면이 대상 파일과 그 파일의 성격, 저장이 무엇을 보존하는지 밝힌다")은 그대로고 사실의 내용만 바뀌었다. 갱신하면서 옛 경로 음성 단정을 함께 넣어 되살아나면 실패하게 했다.
- **픽스처 경로 둘**: 두 파일 "관리 블록 읽기 실패" describe의 `failure.path`를 잡 파일 경로로. 근거는 TASK-081 — 그 이후 이 실패는 잡 파일 읽기 실패다. 단정은 상수 참조라 검사 내용 불변.

## 게이트

- 루트 `npm run check` — **18 파일 459 테스트 통과**, `tsc -b && vite build` 성공, 실패 0.
- `src-tauri` `cargo test` — **401 통과 0 실패 0 무시.**
- `cargo fmt -- --check` — **diff 0건으로 완전히 깨끗하다.** 처음에 신규 테스트의 `assert_ne!` 한 줄이 걸렸는데 `cargo fmt`를 돌리면 다른 세션의 미커밋 코드까지 건드리므로 그 줄만 손으로 고쳤다.
- `cargo clippy --all-targets -- -D warnings` — 에러 1건으로 실패하고 **이 작업의 변경분이 아니다**: `heartbeat_process.rs:216`의 `cloned_ref_to_slice_refs`(타 세션 소유, TASK-081·082 보고서가 같은 건 기록). 그 lint만 `-A`로 빼면 `--all-targets`가 경고 0으로 통과 — 이 작업의 변경분 지적 0.

판정은 "신규 테스트 전부 통과 + 기존 테스트 미삭제 + 실패 0". 절대 수치는 병행 착지로 계속 움직인다.

## 후속 / 리스크

1. **TASK-077 후속이던 `.integration-note` 줄바꿈 여지가 이 작업으로 더 현실적인 위험이 됐다.** `App.css`는 TASK-083 범위 밖이라 손대지 않았다. 다만 이 작업이 확인 화면에 **절대 경로**를 새로 넣었고 경로에는 공백이 없어 긴 한 덩어리가 된다 — 홈이 깊은 사용자에게 `<li>`가 가로로 넘칠 수 있다. 후속에서 `overflow-wrap: anywhere` 한 줄 검토를 권한다. jsdom은 레이아웃을 계산하지 않아 테스트로 잡히지 않는다.
2. **저장 실패 문구 픽스처 하나가 아직 옛 파일을 말한다.** `IntegrationsView.test.tsx`의 `"~/.claude/HEARTBEAT.md의 앱 관리 블록 마커가 손상되어 파일을 쓰지 않았습니다."`는 `writeError` 렌더 경로의 입력 문자열이고 전환 뒤 백엔드가 그런 메시지를 만들지 않는다. 범위 목록에 없어 손대지 않았다 — 실제 메시지를 만드는 자리가 백엔드이므로 문구 정리도 그쪽 작업과 함께 가는 것이 맞다.
3. **`managedBlockFailure` 이름은 그대로다.** TASK-081의 판단을 잇는다(범위 밖 명시). 이 작업은 그 필드가 가리키는 **파일**만 사실에 맞췄다.
4. **"한 번 저장하면 앱이 치웁니다"는 저장할 때만 참이다.** TASK-082 후속 3번 그대로 — 조회만 하는 사용자의 잔여는 치워지지 않는다. 문구가 "저장하면"으로 조건을 밝히므로 오해를 만들지 않는다고 판단했다.
5. **`installationNote`는 여전히 `~/.claude/HEARTBEAT.md`를 말한다.** 의도된 것이다(작업 문서 명시, 설치 판정 근거 파일은 그대로). QA에서 "여기만 옛 경로"로 보일 수 있어 사실로 남긴다.
