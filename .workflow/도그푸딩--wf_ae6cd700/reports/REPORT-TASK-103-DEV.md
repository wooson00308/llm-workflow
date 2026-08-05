# TASK-103 개발자 핸드오프

- 대상: TASK-103 (겹침으로 막힌 작업이 화면에서 시작 가능으로 보이지 않게 한다)
- 근거: SPEC-032 R7, 완료 조건 11·13·15,
  DECISION-0D79A7F0 (`outcome: approved`, `created_by: user`, `spec_id: SPEC-032`,
  2026-08-04T13:18:02Z — 직접 확인. SPEC-032의 결정 문서는 이 1건뿐이라 더 늦은 결정이 없다)
- 역할: 개발자 (developer-claude)
- 선점: `acquire TASK-103 developer-claude 30` exit 0 → `lease-21358-20260804181230` →
  `in_progress`(2026-08-04T18:13:00Z) → 구현 → 검증 → `qa_waiting`.
  중간에 `renew ... 40` exit 0 1회.

## 선행 확인

`depends_on: [TASK-100, TASK-101]`.

- TASK-100 `qa_waiting`, TASK-101 `qa_waiting` — 둘 다 충족.
- 착수 시점 `.workflow/.runtime/leases/`에는 만료된 `SPEC-009.yml`(`expires_at`
  2026-08-03T01:20:00Z) 하나뿐이었고 TASK-103을 덮는 리스는 없었다.
- 착수 시점 `todo`는 TASK-103·104·105·106·107·108·109 7건이고, 선행이 충족된 것은
  TASK-103·104·105·107 4건이었다. `sh .workflow/rules/wf-eligible.sh developer` → `eligible`, exit 0.
- TASK-101이 만든 payload를 착수 시점에 직접 대조했다: `domain/project.rs:173`~`:181`의
  `TaskOverlapBlock`은 `#[serde(rename_all = "camelCase")]`이고 필드는 `lease_target_id`·
  `shared_files`, `TaskDocument`의 필드는 `overlap_blocks: Vec<TaskOverlapBlock>`(`:195`)이다.
  게이트웨이(`tauriProjectGateway.ts:47`)는 `invoke<TaskDocument>("read_task", …)` 그대로라
  변환 자리가 없다 — 화면 타입만 맞추면 값이 닿는다.

## 한 것 — 파일 넷

### `src/features/projects/domain/types.ts`

- `TaskOverlapBlock { leaseTargetId: string; sharedFiles: string[] }`을 더했다. Rust 직렬화형과
  이름·순서가 같다.
- `TaskDocument`에 `overlapBlocks?: TaskOverlapBlock[]`을 더했다. `dependencies?`·
  `dependencyFormatError?`와 같은 선택 필드다.
- **TASK-099가 더한 타입은 손대지 않았다.**

### `src/features/projects/components/DevelopmentBoard.tsx`

`TaskDependencies`에 프롭 `overlaps` 하나가 늘었고, 상세 화면의 호출부가 `document.overlapBlocks ?? []`
를 넘긴다. 판정 세 줄이 이렇게 바뀌었다.

| 자리 | 전 | 후 |
| --- | --- | --- |
| 조기 반환 | `!formatError && dependencies.length === 0` | 위 조건에 `&& overlaps.length === 0` |
| `startable` | `!formatError && 전부 satisfied` | 위 조건에 `overlaps.length === 0` |
| `permanent` | `formatError \|\| missing·cyclic 존재` | **그대로.** 겹침을 넣지 않았다 |

- 겹침 목록은 `permanent` 안내 아래에 별도 블록(`.task-overlaps`)으로 그린다. 선행 미충족과 겹침이
  동시에 성립하면 둘 다 보인다.
- `sharedFiles`가 있으면 `겹친 경로 <경로 목록>`, 비어 있으면
  "두 작업 중 한쪽에 범위 선언이 없거나 형식이 잘못되어 겹친 것으로 봅니다." — 문구가 갈린다.
  이 갈림의 근거는 `overlap_block`(`fs_project_repository.rs:1597`)이 선언 부재·형식 오류일 때
  `Some(Vec::new())`을 돌려주는 자리다.
- 안내 문구는 대기 톤이다: "다른 세션이 잡은 작업과 범위가 겹칩니다. 그 lease가 풀리면 착수할 수
  있습니다." 영구 실패 문구(`PERMANENT_DEPENDENCY_NOTE`)와 문장도 상수도 다르다.
- 선행 목록 `<ul>`에 `dependencies.length > 0` 가드를 더했다. 겹침만 있는 작업에서 빈 `<ul>`이
  그려지는 것을 막는 자리이고, **겹침이 없을 때의 렌더 결과는 이 가드 전후가 같다**(겹침이 없으면
  선언 0건은 조기 반환이 먼저 잡고, 형식 오류면 `<ul>` 자체가 삼항의 반대편이다).

### `src/features/projects/components/DevelopmentBoard.test.tsx`

검사 6건을 뒤에 더했다. 작업 문서의 검사 1~6에 하나씩 대응한다.

1. `stops calling a task startable while an active lease overlaps it` — 선행 전부 `satisfied` +
   겹침 1건에서 "시작 가능"이 없고 "시작할 수 없음"이 있으며, `leaseTargetId`와 공유 경로 두 개가
   화면에서 읽힌다. (완료 조건 11)
2. `draws the overlap of a task that declares no dependency at all` — 선행 선언이 없어도 겹침이
   그려진다. 조기 반환이 삼키지 않는다.
3. `tells an undeclared scope apart from a shared path when it reports an overlap` — 빈
   `sharedFiles`가 선언 부재·형식 오류 문구를 내고 "겹친 경로"를 쓰지 않는다.
4. `keeps an overlap out of the tone reserved for declarations that never open` — 겹침만 있는
   작업에 영구 실패 문구·`.task-dependency-note`가 없고 대기 톤 안내만 있다.
5. `shows an unsatisfied dependency and an overlap side by side` — `missing` 하나와 겹침 하나가
   동시에 보인다. 한쪽이 다른 쪽을 가리지 않는다.
6. `leaves the startable reading alone when nothing overlaps the task` — 겹침이 없으면 "시작 가능"이
   그대로다.

기존 검사는 **이름도 본문도 고치지 않았다.** 헬퍼 둘(`dependencyReader`·`openDependencyDetail`)에
기본값 `[]`인 세 번째 인자만 더했으므로 기존 호출부의 동작이 같다.

### `src/App.css`

`.task-overlaps`·`.task-overlap-note`·`.task-overlap`·`.task-overlap > strong` 넷을 기존 블록 **뒤에**
더했다. 색은 대기 톤(`#805415`/`#f5e7c9`)이고 영구 실패의 붉은 톤(`#8a3f38`)이 아니다.
**기존 규칙은 한 줄도 고치지 않았다.**

## 완료 조건 대조

| # | 조건 | 결과 |
| --- | --- | --- |
| 1 | 겹침으로 막힌 작업이 "시작 가능"이 아니고 상대가 읽힌다 (11) | 검사 1 통과 |
| 2 | 선행 선언이 없는 작업의 겹침도 나온다 | 검사 2 통과 |
| 3 | 선언 부재·형식 오류와 공유 경로가 다른 문구 | 검사 3 통과 |
| 4 | 겹침이 일시로 표시되고 영구 실패와 구분 (R7 넷째) | 검사 4 통과 |
| 5 | 겹침이 없을 때 화면이 지금과 같다 | 검사 6 통과 + 기존 검사 무수정 통과 |
| 6 | 기존 자동 테스트 삭제·비활성화 없음 (13) | 삭제 0건, `.skip`/`.todo` 신규 0건 |
| 7 | 변경분에 Rust·`ActivityView.tsx`·`WorkspaceShell.tsx` 없음 (14) | 아래 절 |
| 8 | `npm run check`·`cargo test` 통과 (15) | 아래 절 |

착수 시점 `DevelopmentBoard.test.tsx`의 검사 개수는 **62건**이고 착지 후 **68건**이다(+6, 완료 조건 5의
기준선).

## 검증

- `npx vitest run src/features/projects/components/DevelopmentBoard.test.tsx` →
  **68 passed / 0 failed**.
- `npm run check` → vitest **530 passed / 20 files**, `tsc -b` + `vite build` 성공.
- `cargo test --manifest-path src-tauri/Cargo.toml` → **428 passed / 0 failed / 0 ignored**.
  (이 작업은 Rust를 만지지 않았으므로 TASK-102 착지 시점과 같은 수치다.)

### 변경 파일 (완료 조건 7)

세션 착수 시각 이후로 내용이 바뀐 소스 파일은 넷이다 —
`src/App.css`, `src/features/projects/domain/types.ts`,
`src/features/projects/components/DevelopmentBoard.tsx`,
`src/features/projects/components/DevelopmentBoard.test.tsx`
(`find src src-tauri/src -type f -newermt <착수 시각>`로 확인).

심볼 단위로도 같은 결론이다: `grep -rln "overlapBlocks|TaskOverlapBlock|task-overlap|겹친 경로" src/`가
같은 네 파일만 낸다. `src-tauri/` 아래는 이 세션에서 읽기만 했고, `ActivityView.tsx`·
`WorkspaceShell.tsx`·게이트웨이·훅은 손대지 않았다. 이 저장소는 여러 세션의 미커밋 변경이 겹쳐 있으므로
"`git diff`가 비어 있다"는 쓰지 않았다.

## 남은 리스크 / 후속

1. **payload에 모자란 것은 없었다.** TASK-101이 실은 `overlapBlocks`만으로 R7의 네 요구가 전부
   그려졌다. 화면에서 활성 lease를 다시 조회하지 않았고 목록 payload에도 값을 더하지 않았다.
2. **`scope_files`가 아직 이 저장소의 작업 문서에 하나도 없다**(TASK-102 보고서와 같은 사실).
   따라서 실제 화면에서 겹침 블록이 뜨는 것을 보려면 작업 문서에 선언이 붙거나 lease가 잡힌 상태가
   먼저 필요하다. QA는 검사 6건이 그 상태를 대신 세운다.
3. 목록·보드 카드의 겹침 배지는 이 작업의 범위 밖이다(작업 문서가 후속 아이디어로 돌렸다).
   상세를 열기 전에는 겹침이 보이지 않는다는 사실은 그대로 남는다.
4. 겹침 상대의 **제목**은 그리지 않았다. payload가 싣는 것은 `leaseTargetId`뿐이고, 제목을 얻으려면
   화면이 새 조회를 만들어야 하는데 R7 셋째 항목이 그것을 금지한다.
