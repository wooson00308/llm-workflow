# TASK-038 개발자 핸드오프

> 기록 경위: 세션 하네스가 보고서 파일 작성을 차단해, 세션이 채팅으로 보낸 전문을 TL이 그대로 기록했다.

- 대상 작업: TASK-038 (작업 상세가 선행 작업과 충족 여부를 보여주고 영원히 열리지 않는 선언을 구분한다)
- 근거 문서: SPEC-013 R5, DECISION-73D4BC1B
- 세션 역할: 개발자
- 작성 시각: 2026-08-03T09:32Z
- 상태: `qa_waiting`

## 대상 선정 근거

- 배정받은 한 건만 처리했다. `depends_on: [TASK-037]`이고 착수 시점 TASK-037은 `status: qa_waiting`이라
  R2 기준(`qa_waiting`·`completed` = 충족)으로 충족이다.
- `migration.lock` 없음. `.workflow/rules/wf-claim.sh`는 설치돼 있지 않아 공통 규칙 §4의 미설치
  폴백대로 직접 배타 생성(`set -C`)으로 선점했다. 선점 시점 `leases/`에는 `SPEC-009.yml`·`SPEC-018.yml`
  둘뿐이라 `TASK-038.yml`은 비어 있었다. 남의 lease는 읽지도 지우지도 않았다.
- 선점: `leases/TASK-038.yml` 배타 생성 → 즉시 `status: in_progress` + `history` 기록 → 구현 →
  중간에 자기 `lease_id` 확인 후 갱신 1회 → `qa_waiting` → lease 반납.

## 요약

작업 상세의 문서 패널에서 `task-detail-meta` 줄과 본문 사이에 `선행 작업` 블록 하나가 늘었다. 선언이
없고 형식 오류도 아니면 블록 자체가 없어 화면이 이전과 같다. 블록 머리는 `시작 가능`/`시작할 수 없음`
한 줄이고, 항목은 payload 순서 그대로 작업 id와 판정 라벨(`준비됨`·`대기 중`·`없는 작업`·`순환 선언`)을
함께 그린다. `missing`·`cyclic`·형식 오류에는 경고 톤과 함께 "이 선언은 시간이 지나도 풀리지 않습니다.
작업 문서의 선행 선언을 고쳐야 합니다." 한 줄이 붙는다.

## 변경한 파일 (4건, 작업 범위 그대로)

- `src/features/projects/domain/types.ts` — `TaskDependencyState`·`TaskDependency` 신설,
  `TaskDocument`에 선택 필드 `dependencies`·`dependencyFormatError` 추가. 작업 문서가 지정한 형태
  그대로다.
- `src/features/projects/components/DevelopmentBoard.tsx` — 모듈 상수 `dependencyLabels`·
  `permanentDependencyStates`·`PERMANENT_DEPENDENCY_NOTE` 추가, `TaskDependencies` 컴포넌트 신설,
  `TaskDetail`의 문서 패널에서 호출 1줄.
- `src/features/projects/components/DevelopmentBoard.test.tsx` — 픽스처 헬퍼 `dependencyReader`·
  `openDependencyDetail` 추가, 테스트 7건 신설(파일 24건 → 31건). 기존 테스트는 한 줄도 고치지 않았다.
- `src/App.css` — 파일 맨 끝에 `Task dependencies` 블록 추가(14줄). 기존 규칙은 건드리지 않았다.

범위 밖 파일은 손대지 않았다. Rust 코드·`WorkspaceShell.tsx`·`Icon.tsx` 무변경.

## 구현 결정

- **선택 필드 두 개를 화면에서 기본값으로 편다.** `document.dependencies ?? []`,
  `document.dependencyFormatError ?? false`. 백엔드(TASK-037)는 항상 실어 보내지만 저장소의 프런트엔드
  테스트가 `TaskDocument` 리터럴을 직접 만들고 있어 타입은 선택 필드다(작업 문서 §1의 근거 그대로).
  덕분에 기존 테스트 픽스처가 한 건도 수정되지 않았다.
- **블록을 안 그리는 조건을 `!formatError && dependencies.length === 0`으로 뒀다.** 형식 오류일 때
  `dependencies`가 비어 오므로, 길이만 보면 형식 오류가 조용히 사라진다.
- **`dependencyLabels`를 `Record<string, string>`으로 뒀다.** 같은 파일 `statusLabels`(`:15`)와 같은
  형태다. 계약 밖 값이 오면 판정값 원문을 그대로 그리고 화면이 깨지지 않는다.
- **영원히 안 풀린다는 안내를 항목마다가 아니라 블록에 한 번 그린다.** `missing`·`cyclic`이 여러 개여도
  같은 문장이 반복되지 않는다. 세 경우 각각에서 문장이 함께 나오는지는 테스트가 따로 잡는다.
- **형식 오류에는 목록 대신 사실만 그린다.** 읽지 못한 목록을 지어내지 않는다는 지시대로,
  `.task-dependency` 항목이 0개인지를 테스트가 DOM으로 확인한다.
- **머리 요약은 `startable` 하나로 정한다.** 형식 오류이거나 `satisfied`가 아닌 항목이 하나라도 있으면
  `시작할 수 없음`이다. 사용자가 항목을 하나씩 읽어 스스로 접지 않아도 된다.
- **색은 `status-pill` 계열 값만 재사용했다.** `satisfied`는 `.status-completed`의 초록
  (`#286042`/`#dfeee4`), `pending`은 `.status-in_progress`의 호박색(`#805415`/`#f5e7c9`),
  `missing`·`cyclic`과 경고 문구는 `.status-blocked`의 붉은색(`#8a3f38`/`#f3dfdc`)이다. 새 색은 없다.
- **아이콘을 만들지 않았다.** 상태 구분은 문구와 색으로만 한다(`Icon.tsx`는 TASK-033 몫).
- **`aria-label="선행 작업"`인 `<section>`으로 감쌌다.** 같은 파일 `.task-calendar`와 같은 방식이고,
  테스트가 이 region 안에서만 조회해 보드/QA 패널 텍스트와 섞이지 않는다.
- **선행 작업으로 이동하는 링크는 만들지 않았다.** 기획서가 요구하지 않았다.
- **정렬하지 않는다.** payload 배열을 그대로 `map`한다. key는 같은 id가 두 번 선언된 payload도
  버티도록 `${id}:${index}`다.

## 검증 (게이트 4종 실행 결과)

| 게이트 | 결과 |
| --- | --- |
| `npm run check` | 통과. `tsc -b` 통과, `vitest run` 14파일 261건 전부 통과(그중 `DevelopmentBoard.test.tsx` 31건 = 기존 24 + 신설 7), `vite build` 통과 |
| `cargo fmt --check --manifest-path src-tauri/Cargo.toml` | 통과(종료 코드 0) |
| `cargo test --manifest-path src-tauri/Cargo.toml` | 실패. 컴파일 단계에서 멈춤 — 아래 "무관한 실패" 참조 |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | 실패. 같은 컴파일 오류 |

완료 조건 대응:

| 완료 조건 | 확인 방법 |
| --- | --- |
| 1. 선언 없는 상세가 이전과 같다 | `leaves the detail untouched when a task declares no dependency` — region `선행 작업`이 `null` |
| 2. id와 충족 여부를 읽을 수 있고 섞인 경우가 구분된다 (기획서 13) | `reads every declared dependency as ready when all are satisfied`, `tells a satisfied dependency apart from a pending one` |
| 3. 없는 id·순환·형식 오류가 서로 다른 문구이고 셋 다 안 풀린다는 안내가 붙는다 (기획서 14) | `marks a missing dependency id…`, `marks a cyclic declaration…`, `reports a broken declaration…` 3건. 각각 `없는 작업`·`순환 선언`·`형식이 잘못되어` + 공통 안내 문장 |
| 4. 기존 테스트가 수정 없이 통과, 삭제·비활성화 없음 (기획서 18) | 기존 24건 그대로. 기존 `it(...)` 블록 변경 없음, `skip`·`todo` 없음 |
| 5. `npm run check` 통과 (기획서 29) | 위 결과 |

순서 보존은 별도로 `keeps the declared order instead of sorting the dependencies`가 잡는다
(`pending`→`satisfied`→`missing` 순 payload가 그대로 그려진다).

## 무관한 실패 (기록만)

`cargo test`·`cargo clippy --all-targets -- -D warnings`가 컴파일 단계에서 실패한다. 재실행으로
확인했고 오류가 2건 → 6건 → 9건으로 늘었다. 원인은 이 세션 밖이다.

- 오류 위치는 전부 `src-tauri/src/infrastructure/heartbeat_roles.rs`,
  `src-tauri/src/infrastructure/heartbeat_dream.rs`, `src-tauri/src/application/heartbeat_service.rs`이고
  내용은 `max_per` 필드가 `String`에서 `MaxPer` 열거형으로 바뀌는 중이라 호출부가 아직 안 맞는 것이다
  (E0308 `expected MaxPer, found String`, E0277).
- 하트비트 백엔드를 맡은 병렬 세션(TASK-051)이 진행 중인 리팩토링이다. 첫 실행 직전
  `heartbeat_jobs.rs`의 수정 시각이 18:24:47로 갱신됐고, 그 시점 `heartbeat_dream.rs`(14:52)·
  `heartbeat_roles.rs`(14:54)는 아직 옛 상태였다.
- 이 세션의 변경 파일 4건은 전부 TypeScript·CSS다. Rust는 한 줄도 건드리지 않았다.
- `cargo fmt --check`는 통과했다.

## 화면 확인

앱을 띄운 수동 확인은 하지 않았다. 두 가지 이유다.

- 작업 문서 지시대로 이 저장소에는 선행 선언을 가진 작업이 TASK-038 자신뿐이라
  `satisfied` 외의 판정값을 원본에서 재현할 수 없고, 원본 `tasks/`에 실험용 문서를 만들지 말라는
  지시가 있다.
- 지금 Rust 트리가 위 사유로 컴파일되지 않아 Tauri 앱을 띄울 수 없다.

사용자 QA에서 확인하려면 저장소 **사본**의 `.workflow/도그푸딩--wf_ae6cd700/tasks/`에 픽스처를 만들면
된다. `depends_on: [TASK-037]`(→ `준비됨`), `depends_on: [TASK-999]`(→ `없는 작업`), 두 작업이 서로를
가리키는 한 쌍(→ `순환 선언`), `depends_on: TASK-037`처럼 목록이 아닌 값(→ 형식 오류)이면 네 경우가
각각 나온다. 원본에는 만들지 않았다.

## 리스크

- 선행 선언이 있는 작업의 상세에서 문서 패널이 블록 높이(대략 60~90px)만큼 아래로 밀린다.
  `.spec-paper`의 `max-height: 620px`는 건드리지 않았으므로 상세 화면 전체 높이가 그만큼 늘어난다.
  선언이 없는 작업에서는 블록을 안 그리므로 변화가 없다.
- 판정 라벨 어휘가 `statusLabels`(`준비`·`진행 중`…)와 비슷하지만 같지는 않다(`준비됨`·`대기 중`).
  상태 배지와 선행 라벨이 한 화면에 같이 보이므로 QA에서 두 어휘가 헷갈리지 않는지 봐 주면 좋겠다.
- 백엔드가 같은 id를 두 번 실어 보내면 두 항목이 그대로 두 번 그려진다. TASK-037이 선언 순서를
  보존한다는 계약을 그대로 따른 결과이고, 중복 제거는 화면에서 하지 않았다.

## 핸드오프 노트 (역할 밖 발견)

- `.workflow/.runtime/leases/SPEC-009.yml`이 만료 시각 2026-08-03T01:20Z로 아직 남아 있다.
  이전 보고서들이 이미 기록한 것과 같은 상태이고, 남의 lease라 손대지 않았다.
- `.workflow/rules/wf-claim.sh`는 아직 없다. 공통 규칙 §4는 이미 헬퍼 기준으로 개정돼 있어, 헬퍼를
  설치하는 작업(SPEC-013 R7)이 끝나기 전까지 모든 세션이 §4의 미설치 폴백 경로를 탄다.
