# TASK-084 개발자 핸드오프 (웨이브 마지막)

> 기록 경위: 하네스가 서브에이전트(tl-dev-081, TASK-084 담당 재배정)의 보고서 파일 작성을 차단해, 발신된 전문을 TL이 대리 기록한다. 내용은 발신 전문 그대로다. (수신 2026-08-04T11:12Z, TL 세션)

- 대상: TASK-084 (잡 파일에는 있는데 데몬이 집었다는 증거가 없는 상태를 화면에 드러낸다)
- 근거: SPEC-024 R4·완료 조건 9, DECISION-3C8F1A42 확인 필요 3번의 승인된 제안("막지 않고 알린다") / 상태: `qa_waiting`
- lease: `lease-42446-20260804105701` (acquire·renew·release 전부 exit 0)

## 선행 확인 — 실측했고 배정 메시지와 같았다

TL 경고대로 문서를 직접 다시 읽었다. TASK-084의 `depends_on`은 **`[TASK-083]` 한 건 그대로**이고 `updated_at`도 `2026-08-04T09:20:00Z`로 생성 시점에서 움직이지 않았다(083은 배정 후 TASK-092가 추가돼 다섯 건이 됐던 것과 대조된다). TASK-083 문서를 열어 `status: qa_waiting`을 확인한 뒤 선점했다.

## 핵심 결정과 근거

1. **백엔드를 한 줄도 고치지 않았다.** 작업 문서가 정한 그대로다. "잡 파일에 그 잡이 있다"는 `heartbeat.managedJobs`(dream은 `dream.managedJob`)가 말하고 "실행 기록이 없다"는 `lastRun === null`이 말한다. payload에 필드를 더하면 같은 결론을 내는 자리가 둘이 된다. 데몬 버전을 추정하는 코드도, `--version`을 부르는 코드도 없다(부결된 대안 A를 되살리지 않았다).

2. **판정을 함수 하나로 뽑았다.** 두 카드에 각각 `missingRunEvidence(installed: boolean, run: HeartbeatJobRun | null)`을 뒀다. 카드 사이에 코드를 공유하지 않는 것은 이 저장소의 기존 선택이고(`runResultLabels`·`skippedReasonNote`가 같은 꼴), 문구만 글자까지 맞춘다. 한 카드 안에서는 본문 렌더와 접힘 요약 판정이 같은 함수를 부르므로 두 자리가 갈라질 수 없다.

3. **미설치·읽기 실패 가드를 두 층으로 나눴다.** 본문에서는 다시 보지 않는다 — 그 두 상태에서는 잡 폼 자체가 그려지지 않는다(`installation !== "not_installed"` 분기와 `managedBlockFailure ? <UnreadableManagedBlock/> : <폼/>` 분기). 반면 접힘 요약(`bodyWarning`)은 그 분기 **밖**에서 계산되므로 같은 조건을 명시적으로 본다(`jobsShown`). 요약이 본문에 없는 경고를 알리면 사용자가 카드를 펼쳐 놓고 무엇을 봐야 할지 알 수 없다.

4. **`App.css`를 고치지 않았다.** 작업 문서가 "새 요소가 필요하면"이라는 조건을 달았는데, 기존 `IntegrationWarning`(=`.integration-warning`)이 제목 + 본문 구조를 그대로 제공한다. 한도 경고가 쓰는 것과 같은 요소라 새 스타일이 필요 없었다.

## 변경한 파일 (넷, 전부 프론트엔드)

- `src/features/projects/components/integrations/HeartbeatCard.tsx` — 상수 둘·판정 함수 하나 신설, `bodyWarning`에 `jobsShown` 가드와 새 갈래 추가, 역할 잡 줄에 경고 렌더, `HeartbeatJobRun` 타입 임포트.
- `src/features/projects/components/integrations/DreamCard.tsx` — 같은 상수·함수, `bodyWarning`에 `jobShown` 가드와 새 갈래, dream 잡 자리에 경고 렌더, 같은 타입 임포트.
- `.../IntegrationsView.test.tsx` — 신규 describe 하나(시험 8), `quotaState` 기본 실행 기록, 한 시나리오의 `runs` 명시.
- `.../DreamCard.test.tsx` — 신규 describe 하나(시험 7), `ranOnce` 상수, 한도 시나리오 넷에 `lastRun` 추가.

**Rust 무변경(완료 조건 8).** `git diff --stat`은 다른 세션의 미커밋 변경이 얹혀 있어 판정 근거가 못 되므로, 착수 시각(19:57 KST) 이후 수정된 파일을 파일시스템에서 직접 셌다: `find src-tauri/src -name "*.rs" -newermt "2026-08-04 19:57:00"` → **0건**. 같은 기준으로 `find src -newermt ...`는 위 넷만 낸다. `App.css`·`types.ts`·`IntegrationsView.tsx`·`IntegrationCard.tsx` 무변경.

보호 상태 무변경, git 커밋·푸시·checkout·restore·stash 없음. **실기기 `~/.claude` 무변경** — 종료 시점(20:10 KST) `HEARTBEAT.md` 100바이트·17:50:43, `jobs.d`의 두 파일 17:50:43·16:58:15로 TASK-081~083 보고서가 기록한 값과 같다. 이 작업은 프론트엔드만 만져 파일을 여는 코드가 애초에 없다.

## 문구 (완료 조건 5)

제목: **"하트비트가 이 잡을 실행한 기록이 없습니다"**

본문: **"잡 파일에는 이 잡의 정의가 있는데 하트비트가 실행한 기록이 없습니다. 아직 첫 주기가 오지 않았을 수도 있고, 하트비트가 프로젝트별 잡 파일을 읽지 못하는 버전일 수도 있습니다. 앱은 하트비트 버전을 판정하지 않으므로 둘 중 어느 쪽인지 알지 못합니다. 주기가 지나도 기록이 생기지 않으면 하트비트를 갱신하세요."**

원인을 단정하지 않는다. 사실 하나(정의는 있고 기록은 없다) + 가능성 둘(첫 주기 전 / 계약 미지원 버전) + 앱이 버전을 판정하지 않는다는 사실 + 후자일 때의 행동(갱신)만 말한다. 승인된 한계를 문구가 감당하라는 작업 문서의 요구이고, 앱이 알지 못하는 것을 아는 척하지 않는 어법은 `skippedReasonNote`가 이미 택한 것이라 그것을 따랐다.

**두 카드 대조**: 두 파일에서 `noRunEvidenceTitle`·`noRunEvidenceNote` 두 상수를 뽑아 `diff` — **각 553바이트, 차이 0건**.

**변이 확인**: `DreamCard.tsx`의 제목 끝에 마침표 하나를 더하자 `shares one wording with the dream card`가 `expected [...] to have a length of 2 but got 1`로 실패했다. 백업본으로 되돌린 뒤 바이트 동일을 `diff`로 확인했고(잔여 파일 0), 두 카드 시험 281건 재통과했다. 한쪽만 고치는 실수를 이 시험이 실제로 잡는다.

## 완료 조건 대조

1. **파일에 있고 기록이 없으면 나타난다** — `names the state and both of its possible causes`(두 카드 각각). 역할 잡 쪽은 `jobRow("개발자")` 안의 `.integration-warning`을 집어 문장 다섯 조각을 확인한다.
2. **기록이 있으면 안 나타난다** — `drops the notice once the daemon has run the job`(두 카드). 같은 픽스처에 `lastRun`만 넣고, 경고가 사라지면서 "성공" 줄이 그대로인 것을 함께 본다.
3. **꺼진 잡에는 안 나타난다** — `leaves the jobs that are not in the file alone`(기획자·아키텍트 줄에 없고 화면 전체에 정확히 1건), dream 쪽 `says nothing about a job that is not in the file`.
4. **미설치·읽기 실패에서 안 나타난다** — `stays quiet while the heartbeat is not installed`, `stays quiet while the jobs file could not be read`(두 카드 각각). **두 픽스처 모두 잡 목록을 일부러 비우지 않았다** — 비우면 판정이 아니라 빈 목록 때문에 조용해져 시험이 무의미해진다. 읽기 실패 쪽은 카드가 이미 쓰는 "관리 블록을 읽지 못했습니다"가 그대로 나오는 것도 함께 확인한다(같은 원인을 두 이름으로 부르지 않는다).
5. **문구와 두 카드 일치** — 위 "문구" 절. `shares one wording with the dream card`가 두 카드를 함께 그려 제목·본문이 각각 2건인지 센다.
6. **저장·재설정이 그대로 동작** — `blocks neither the save nor the reset`(두 카드). 역할 잡 쪽은 버튼 둘이 `toBeEnabled`인 것에 더해 저장을 눌러 확인 화면(`역할 잡 설치 확인`)이 실제로 열리는 것까지 본다.
7. **접힘 요약** — `marks the collapsed summary so the warning is not hidden by the fold`(두 카드). 역할 잡 쪽은 `expand: false`로 렌더, dream 쪽은 토글을 눌러 접는다.
8. **Rust 무변경** — 위 파일 목록의 `find` 실측.
9. **기존 테스트 미삭제·미비활성화** — 아래.
10. **게이트** — 아래 웨이브 최종 게이트.

## 고친 테스트와 그 이유 (완료 조건 9)

**삭제·비활성화·약화 0.** 신규 15(역할 잡 8 + dream 7), 픽스처 갱신 6.

신규 시험을 넣기 전 기존 시험 10건이 실패했다. 전부 한도(quota) 시나리오이고 원인이 하나다: **잡을 설치해 두고 `lastRun`을 주지 않은 픽스처**라, 이 작업이 넣은 경고가 새로 나타나면서 "경고가 없어야 한다"류 단정이 깨졌다. 한도를 세려면 그 잡이 이미 돌았어야 하므로 그 픽스처들이 뜻한 상태는 원래 "돈 잡"이다. 그래서 사실을 바로잡았다.

- `IntegrationsView.test.tsx` — `quotaState`의 기본 `runs`를 `{}`에서 `{ developer: ranOnce }`로. 한 곳 고치는 것으로 한도 describe 전체가 제 상태를 갖는다. 기록 없는 상태를 다루는 시나리오는 `runs`를 직접 넘기므로 영향이 없다. 세 역할을 모두 설치하는 `drops every warning when no role has work waiting`만 셋 다 기록을 주도록 `runs`를 명시했다(주석에 이유를 남겼다).
- `DreamCard.test.tsx` — `ranOnce` 상수를 두고 한도 시나리오 넷(`names what waits...`, `raises no quota warning for the chosen unlimited...`, `treats a malformed max_per...`, `stays quiet in the collapsed summary...`)에 `lastRun: ranOnce`를 넣었다.

각 시험이 검사하던 성질(한도 경고가 뜬다/안 뜬다, 소진 표시, 무제한 문구)은 그대로고 픽스처의 사실만 바뀌었다. 단정은 한 줄도 지우지 않았다.

## 웨이브 최종 게이트

**전이·lease 반납을 끝낸 뒤 마지막 상태에서 한 번 더 완주한 결과다.**

`src-tauri`:

- `cargo test` — **401 passed, 0 failed, 0 ignored.**
- `cargo fmt -- --check` — **Diff 블록 0건.** 완전히 깨끗하다. 이 작업은 Rust를 만지지 않았고 다른 세션의 미커밋 코드도 포매팅이 맞은 상태다.
- `cargo clippy --all-targets -- -D warnings` — **에러 1건으로 실패. 이 웨이브 내내 같은 그 한 건이다.** `src/infrastructure/heartbeat_process.rs:216`의 `cloned_ref_to_slice_refs`이고, `git status`가 `??`로 내는 **미추적 파일**(타 세션 소유, TASK-081·082·083 보고서가 모두 같은 건을 기록했다). 그 lint 하나만 `-A clippy::cloned_ref_to_slice_refs`로 빼면 `--all-targets`가 **경고 0으로 통과**한다. 즉 이 웨이브가 만든 코드에서 나온 clippy 지적은 0이고, 남은 실패는 소유자가 그 한 줄을 `std::slice::from_ref(&script)`로 바꾸면 닫힌다.

루트:

- `npm run check` — **18 test files / 474 tests passed**, `tsc -b && vite build` 성공, 실패 0.

일시 실패는 이번 완주에서 한 건도 없었다(재시도 불필요). 하트비트 세션의 편집과 겹치지 않았다. 프런트 총계 474는 TASK-083 보고서의 459에 이 작업의 신규 15를 더한 값과 같다.

## 후속 / 리스크

1. **잡 이름이 전환 전후로 같아서 생기는 사각지대(작업 문서가 사실로 남기라고 한 항목).** 계약 미지원 데몬이 옛 파일의 정의로 그 잡을 돌던 이력이 `state.json`에 남아 있으면 `lastRun`이 `null`이 아니라 이 표시가 뜨지 않는다. 잡으려면 "마지막 실행이 주기에 비해 얼마나 오래됐는가"로 판정해야 하는데 그것은 승인되지 않은 새 판정이라 만들지 않았다.
2. **첫 주기 전과 계약 미지원이 구분되지 않는다.** 확인 필요 3번이 승인되면서 결정문에 남은 한계 그대로이고, 문구가 두 가능성을 모두 말하는 것으로 감당한다.
3. **역할 잡 카드에서는 잡마다 같은 경고가 최대 3개까지 붙는다.** 한도 경고가 잡마다 붙는 것과 같은 꼴로 맞췄다. 세 잡이 동시에 이 상태가 되는 것은 전환 직후 첫 주기 전인 정상 구간이라, 한 번만 묶어 보여주는 편이 나은지는 QA에서 눈으로 볼 항목이다.
4. **한도 픽스처의 기본 실행 기록이 이제 `quotaState`에 들어 있다.** 앞으로 한도 시나리오를 더할 때 "기록 없는 잡"을 만들려면 `runs: {}`를 명시해야 한다. 상수 옆 주석에 그 이유를 적어 뒀다.
5. **SPEC-024 R1~R7이 이 작업으로 모두 닫혔다.** R3의 두 번째 갈래(잔여 감지)는 082, 경로 표기는 083, 이 표시는 084다. 남은 것은 사용자 QA와, 데몬 0.8.0의 push·릴리스(별도 사용자 결정 대기)다.
