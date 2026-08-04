# TASK-105 개발자 핸드오프

- 대상: TASK-105 (조회 재읽기에서 이유가 사라진 중복 훑기를 걷어낸다)
- 근거: SPEC-033 R7, 완료 조건 10, 승인된 확인 필요 4번,
  DECISION-8D3F0D0F (`outcome: approved`, `created_by: user`, `spec_id: SPEC-033`,
  2026-08-04T15:58:40Z — 직접 확인. SPEC-033의 결정 문서는 이 1건뿐이라 더 늦은 결정이 없다)
- 역할: 개발자 (developer-sasha)
- 선점: `acquire TASK-105 developer-sasha 45` exit 0 → `lease-96818-20260804191140` →
  `in_progress`(2026-08-04T19:11:44Z) → 구현 → 검증 → `qa_waiting`. 중간에 renew exit 0 2회.

## 선행 확인

`depends_on: [TASK-101]`.

- TASK-101 `qa_waiting` — 충족.
- 착수 시점 lease는 만료된 `SPEC-009.yml`(2026-08-03T01:20:00Z)과 미만료
  `TASK-104.yml`(만료 2026-08-04T19:37:05Z, `developer-claude`) 둘. TASK-105를 덮는 lease는 없었다.
- 착수 시점 `todo`는 TASK-105·106·107·108·109 5건이고, 선행이 충족된 것은 TASK-105와 TASK-107
  둘이었다. 더 오래된 TASK-105를 잡았다.

### 작업 문서가 요구한 "같은 파일을 범위에 둔 다른 열린 작업" 재확인

`fs_project_repository.rs`를 범위에 둔 다른 `todo`·`in_progress` 작업은 **없다.**

- `in_progress`인 TASK-104는 이 파일을 범위 밖으로 명시했다(완료 조건 12 "변경분에
  `fs_project_repository.rs`… 가 없다", 범위 밖 절 "앱 조회 재읽기의 중복 정리는 TASK-105의 몫").
  실제로 만지는 파일도 `heartbeat_condition.rs`·`role_eligibility.rs`다.
- `todo`인 TASK-106도 "105는 `fs_project_repository.rs`만 만진다. 두 작업은 병렬로 서도 된다"로
  적어 두었다. TASK-107·108·109는 SPEC-034이고 이 파일을 범위에 두지 않는다.

## 세 쌍의 판단 (완료 조건 1)

작업 문서가 고정한 기준으로 쌍마다 두 질문에 답했다.

> Q1. 두 번째 훑기가 얻는 값을, 첫 번째 훑기가 읽은 **같은 파일 내용**에서 함께 만들 수 있는가?
> Q2. 함께 만들었을 때 **payload와 공개 형태가 그대로인가?**

| 쌍 | Q1 | Q2 | 판단 |
| --- | --- | --- | --- |
| 결정: `read_spec_decisions` × `qa_decision_events` | 예 | 예 | 이유 무효 → **합쳤다** |
| 기획서: `read_markdown_summaries(specs)` × `spec_references` | 예 | 예 | 이유 무효 → **합쳤다** |
| 작업: `read_markdown_summaries(tasks)` × `task_dependency_graph` | 예 | 예 | 이유 무효 → **합쳤다** |

### 결정 쌍

두 함수가 `decisions/`의 같은 파일을 각각 열어 같은 방식으로 프론트매터를 가르고, 서로 다른 스키마의
부분집합만 남긴다. 두 번째가 얻는 값(`task_id`·`created_at`·`outcome`)은 첫 번째가 이미 읽은 바로 그
프론트매터에 들어 있다 → Q1 예.

기록된 이유는 `REPORT-TASK-023-DEV`의 "QA 스캔을 `latest_spec_decisions`와 합치지 않았다 — 두 결과
타입을 동시에 들고 다녀야 한다"였다. **이것은 결과의 형태가 다르다는 말뿐이고, 값을 함께 돌려주면
해결된다.** 두 결과 타입(`Vec<SpecDecisionRecord>`와 `HashMap<String, Vec<TaskEvent>>`)은 그대로 있고
튜플로 함께 나올 뿐이라 payload도 공개 형태도 움직이지 않는다 → Q2 예. 이유는 지금 유효하지 않다.

### 기획서 쌍

`spec_references`가 만드는 값은 `source_idea_id`·`id`·`status`뿐이고 나머지(`is_draft`·`is_rejected`)는
이미 읽어 둔 결정 목록에서 나온다. 셋 다 목록 요약이 읽는 같은 프론트매터다 → Q1 예. 참조는 payload에
실리지 않는 판정용 값이라 `WorkflowItemSummary`가 그대로다 → Q2 예.

이 쌍에는 **기록된 이유가 아예 없었다.** 두 함수가 따로 자라난 자리다.

**다만 두 훑기가 세는 문서가 원래 달랐고, 합치면서도 그 차이를 그대로 두었다.** 목록 요약은
`symlink_metadata`로 일반 파일만 담고, 참조는 읽히는 `.md`를 전부 담는다 — 심링크로 걸린 기획서는
목록에 없어도 아이디어 판정에는 든다. 이 차이를 없애는 것은 판정 규칙 변경이라 이 작업의 몫이 아니다.
합친 함수가 파일을 한 번 읽고 두 규칙을 각각 적용한다. 이 성질은 `read_spec_documents`의 주석에 적었다.

### 작업 쌍

`task_dependency_graph`가 만드는 값은 `id`·`status`와 선언 두 줄이다. 앞의 둘은 목록 요약이 읽는 값과
**같은 규칙**이고(원래 코드 주석이 "id와 상태는 목록 화면이 쓰는 규칙 그대로 읽고"라고 적어 두었다),
선언은 같은 파일의 프론트매터 원문에서 나온다 → Q1 예. 선언은 목록에 싣지 않고 별도 반환값으로
남으므로 `WorkflowItemSummary`에 필드가 늘지 않는다 → Q2 예.

기록된 이유는 `PreparedWorkflow::read`의 주석 "목록 읽기는 선언을 담지 않으므로
(`WorkflowItemSummary`에 필드를 더하지 않는다 — TASK-037) `tasks/`를 한 번 더 훑는다"였다.
**"목록에 싣지 않는다"와 "한 번 더 훑는다" 사이에는 필연이 없다.** 한 번 읽고 두 값을 돌려주면 TASK-037의
선을 지키면서 훑기는 한 번이다. 이유는 지금 유효하지 않다.

## 한 것

전부 `src-tauri/src/infrastructure/fs_project_repository.rs` 한 파일이다.

### 합친 훑기 셋

- `read_decision_documents(workflow_root) -> (Vec<SpecDecisionRecord>, HashMap<String, Vec<TaskEvent>>)`
  (`:1866`). `decisions/`를 한 번 훑는다. 문서별 판정은 `spec_decision_record`와 `qa_decision_event`
  두 함수로 갈라 두었고, 두 함수는 이미 읽어 둔 프론트매터만 받는다.
- `read_spec_documents(specs_root, decided) -> (Vec<WorkflowItemSummary>, Vec<SpecReference>)`
  (`:1156`). `specs/`를 한 번 훑는다. 문서별 참조 판정은 `spec_reference`로 갈라 두었다.
- `read_task_documents(tasks_root) -> (Vec<WorkflowItemSummary>, HashMap<String, TaskNode>)`
  (`:1520`). `tasks/`를 한 번 훑는다. 노드의 `id`·`status`는 **목록 요약이 만든 값을 그대로 쓴다** —
  같은 규칙이라고 주석으로만 적혀 있던 것이 한 벌이 됐다.

### 값을 나눠 쓰도록 바꾼 자리

- `PreparedWorkflow::read`(`:813`~`:815`)가 결정과 작업을 한 번씩 읽어 `workflow_items`에 넘긴다.
  이미 결정 목록을 읽어 넘기던 어법 그대로다.
- `workflow_items`(`:1075`)가 결정 목록·QA 이벤트·작업 목록을 받는다. 이 함수가 여는 디렉터리는
  `specs/`와 `ideas/` 둘뿐이고 각각 한 번이다.
- `merge_qa_decision_events`(`:1799`)가 경로 대신 이미 읽어 둔 QA 이벤트를 받는다.

### 규칙을 한 벌로 남기려고 뽑아낸 것 (동작 불변)

- `markdown_summary(path, metadata, body, default_status)`. `read_markdown_document`의 뒷부분을
  그대로 뽑았다. 파일을 다시 읽지 않는 자리가 목록 항목을 만들 수 있게 하는 것이 목적이고,
  `read_markdown_document`는 읽은 뒤 이 함수를 부른다.
- `sort_markdown_summaries`. `read_markdown_summaries`의 정렬 비교를 그대로 뽑았다. 파일 이름이
  디렉터리 안에서 유일하므로 이 비교는 전순서이고, 입력 순서가 결과를 바꾸지 않는다.

### 이름을 지킨 자리 (호출처가 남은 것)

세 함수는 합친 훑기의 얇은 래퍼로 남겼다. 같은 판정 규칙의 구현을 두 벌 만들지 않기 위해서다.

- `read_spec_decisions`(`:1902`) = `read_decision_documents(...).0`
- `spec_references`(`:1185`) = `read_spec_documents(...).1`
- `task_dependency_graph`(`:1507`) = `read_task_documents(...).1`

`qa_decision_events`는 이름이 사라졌다. 유일한 호출처가 `merge_qa_decision_events`였고 그 자리가
합친 훑기로 옮겨 갔다.

## 다른 호출처 (작업 문서가 세라고 한 것)

세 쌍 여섯 함수를 부르는 자리를 전부 셌다. **조회 경로 말고 전문 읽기 경로 둘이 같은 함수를 쓴다.**

| 호출처 | 부르는 것 | 착지 후 |
| --- | --- | --- |
| `PreparedWorkflow::read`(`:813`·`:814`) — 조회 | 결정·작업 훑기 | 합친 훑기를 직접 부른다 |
| `workflow_items`(`:1083`·`:1096`) — 조회 | 기획서·아이디어 훑기 | 기획서는 합친 훑기, 아이디어는 그대로 |
| `read_task`(`:288`) — 작업 전문 | `task_dependency_graph` | 래퍼를 거쳐 같은 값 |
| `read_idea`(`:320`) — 아이디어 전문 | `spec_references` + `read_spec_decisions` | 래퍼를 거쳐 같은 값 |
| `apply_latest_decision`(`:1993`) — 기획서 전문 | `read_spec_decisions` | 래퍼를 거쳐 같은 값 |
| `mod tests`(`:4587`·`:5371`) | `read_spec_decisions`·`task_dependency_graph` | 래퍼를 거쳐 같은 값, 검사 수정 없음 |

전문 읽기 두 경로는 래퍼가 **버리는 쪽 값을 함께 만드느라** 문서당 YAML 조회가 조금 늘지만
**파일 읽기 횟수는 그대로다**(디렉터리를 한 번 훑는 것이 전과 같다). 두 경로 모두 카드를 눌렀을 때만
도는 경로이고 2.5초 주기에 있지 않다.

## 훑기 횟수 (완료 조건 5)

코드를 읽어 셌다. 단위는 `inspect` 한 번, 워크플로우 하나에서 **파일 본문을 여는 횟수**다.
착수 시점 문서량은 아이디어 33 · 기획서 35 · 작업 105 · 결정 130이다(분해 시점 32·33·96·122에서
늘었다).

| 디렉터리 | 착수 전 | 착지 후 |
| --- | --- | --- |
| `decisions/` | 130 × 2 = 260 | 130 × 1 = 130 |
| `specs/` | 35 × 2 = 70 | 35 × 1 = 35 |
| `tasks/` | 105 × 2 = 210 | 105 × 1 = 105 |
| `ideas/` | 33 × 1 = 33 | 33 × 1 = 33 |
| **합계** | **573** | **303** |

분해 시점 값으로 환산하면 (33+96+122)×2 + 32 = **534** → 33+96+122+32 = **283**이다. 확인 사실 12가
적은 534와 같은 셈법이다.

세 쌍 모두 합쳤으므로 **어느 디렉터리에도 ×2가 남지 않았다.** 남은 성장은 문서 수에 비례하는 선형이고,
그것은 이 작업의 범위 밖이다(승인된 확인 필요 4번이 캐시·증분 읽기를 잘랐다).

## 검증

| 완료 조건 | 검증 | 결과 |
| --- | --- | --- |
| 1 (판단·근거) | 위 "세 쌍의 판단" 절 | 셋 다 판단하고 셋 다 합쳤다 |
| 2 (조회 결과 불변) | 기존 검사 **수정 없이** 통과 + 새 검사 1~4 | 통과 |
| 3 (payload 불변) | `WorkflowItemSummary` 필드 수 | 착수 전 11개 = 착지 후 11개 |
| 4 (폴링·캐시 없음) | `useProjectWorkspace.ts:455`의 `2_500` | 그대로. 프론트엔드 변경분 0건 |
| 5 (훑기 횟수) | 위 표 | 573 → 303 |
| 6 (`.workflow` 무기록) | `inspecting_the_project_does_not_touch_the_workflow_files` | **수정 없이** 통과 |
| 7 (검사 삭제·비활성 0) | `#[test]` 개수, `#[ignore]` 개수 | 106 → 110, `#[ignore]` 0 → 0 |
| 8 (파일 하나) | 아래 "변경 파일" | `fs_project_repository.rs` 하나 |
| 9 (명령) | 아래 | 둘 다 통과 |

```
cargo test --manifest-path src-tauri/Cargo.toml   # 착수 전 432 passed → 착지 후 436 passed, 0 failed, 0 ignored
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings   # 경고 0
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check   # 차이 0
npm run check   # 20 test files / 530 tests passed, tsc -b + vite build 성공
```

### 더한 검사 넷 (작업 문서의 검사 1~4)

`mod tests` 끝에 넣었고 **기존 검사는 이름도 내용도 고치지 않았다.**

1. `one_scan_per_directory_keeps_the_values_two_scans_made` — 세 쌍이 만드는 값을 한 픽스처에서 직접
   단언한다. 기획서 상태·결정 피드(결정 쌍 앞), 작업 타임라인의 QA 이벤트(결정 쌍 뒤), 아이디어 파생
   상태(기획서 쌍), 목록 순서와 선행 판정·`pending_work` 세 값(작업 쌍).
2. `one_decision_scan_keeps_the_two_schemas_apart` — QA 결정과 기획서 결정이 한 디렉터리에 섞여 있고
   **서로의 키까지 들고 있어도**(기획서 결정에 `task_id`, QA 결정에 `spec_id`) 두 값이 오염되지 않는다.
3. `one_scan_skips_the_documents_two_scans_skipped` — 프론트매터가 없는 문서·스키마가 다른 문서·
   읽을 수 없는 문서(잘못된 UTF-8)를 세 디렉터리에 모두 섞어도 세는 문서와 건너뛰는 문서가 그대로다.
4. `one_scan_falls_back_to_the_file_stem_for_a_document_without_an_id` — `id`가 없는 기획서·작업의
   fallback이 파일 stem이고, 그 값이 아이디어 중단 근거와 선행 선언 판정에 그대로 쓰인다.

검사 5는 기존 `inspecting_the_project_does_not_touch_the_workflow_files`이고 수정 없이 통과한다.

### 검사 3을 쓰다 알게 된 기존 성질 둘

내 기대가 틀렸던 자리이고, **둘 다 착수 전부터 있던 동작이며 이 변경분이 바꾼 것이 아니다.**

- 스키마가 다른 문서라도 프론트매터에 `id`가 있으면 목록 항목의 id는 그 값이다(파일 stem이 아니다).
- `updated_at`·`created_at`이 없는 문서는 `updated_at`이 **파일 수정 시각**이라 목록에서 맨 앞에 선다.
  그래서 검사 3은 목록 순서를 보지 않고 문서 집합만 본다. 순서는 시각이 고정된 검사 1이 본다.

## 변경 파일

`src-tauri/src/infrastructure/fs_project_repository.rs` 하나다.

작업 트리에 여러 세션의 미커밋 변경이 겹쳐 있어 `git diff`로는 이 세션의 변경분을 가릴 수 없다.
대신 착수(2026-08-04T19:11:44Z) 이후 수정 시각을 가진 추적 파일이 위 한 개뿐임을 확인했다.
`heartbeat_condition.rs`(18:54)·`role_eligibility.rs`(18:56)는 TASK-104 세션의 착수 전 변경이고,
프론트엔드 파일은 전부 18:15 이전이다.

## 리스크와 후속

- **다른 세션과의 병행.** TASK-104가 `heartbeat_condition.rs`·`role_eligibility.rs`를 `in_progress`로
  들고 있었고(lease 만료 2026-08-04T19:37:05Z), 위 검증은 그 세션의 중간 상태 위에서 돌았다.
  파일이 겹치지 않으므로 판정이 부딪히지는 않지만, **두 작업이 QA에 함께 오면 테스트 개수(436)는 두
  변경분이 합쳐진 값이다.**
- **기획서 쌍의 심링크 차이는 자동 검사가 없다.** 목록 요약과 참조가 세는 문서가 다른 성질(위 "기획서
  쌍" 절)은 합친 함수에서 그대로 지켰고 주석으로 고정했지만, 작업 문서가 준 검사 목록에 그 항목이
  없어 검사를 더하지 않았다. 심링크 픽스처는 `#[cfg(unix)]` 게이트가 필요하고, 최근 두 커밋이 바로 그
  자리에서 Windows clippy를 고쳤다. **검사를 세울지는 아키텍트가 정할 자리다 — 후속 후보.**
- **범위 밖으로 두고 손대지 않은 것.** 캐시·증분 읽기·파일 감시·변경 시각 비교·폴링 주기(승인된 확인
  필요 4번이 잘랐다), 판정 규칙·payload·화면 값, `WorkflowItemSummary`에 선언을 싣는 일(TASK-037),
  조건 스크립트(TASK-104), 회귀 감지 장치(TASK-106), `reports/` 읽기.
- **남은 성장은 선형이다.** 폴링 한 번에 303회 읽기는 문서 수에 비례해 계속 는다. 기획서 확인 필요
  4번의 "비용" 항목이 적어 둔 그대로이고, 화면이 느려지는 날 그 항목이 다시 올라온다.

## QA 안내

1. 앱을 띄우고 이 프로젝트를 연다. **목록의 값이 착수 전과 한 글자도 달라지지 않아야 한다** — 기획서
   상태, 아이디어 상태와 중단 근거, 작업 카드의 이력(QA 확인·반려 포함), 대기 물량 배지 셋.
2. 작업 카드를 눌러 전문을 연다. 선행 목록과 그 상태, 겹침 근거가 전과 같아야 한다.
3. 아이디어 전문을 연다. 상태와 중단 근거가 목록과 같아야 한다.
4. 화면을 열어 둔 채로 `.workflow` 아래 파일이 바뀌지 않는지 본다(조회는 읽기만 한다).
