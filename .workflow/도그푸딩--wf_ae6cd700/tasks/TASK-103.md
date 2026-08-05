---
schema: workflow-labs/task@1
id: TASK-103
title: 겹침으로 막힌 작업이 화면에서 시작 가능으로 보이지 않게 한다
status: completed
source_spec_id: SPEC-032
source_decision_id: DECISION-0D79A7F0
depends_on: [TASK-100, TASK-101]
updated_at: 2026-08-05T03:08:56.191072+00:00
history:
  - { at: 2026-08-04T15:46:00Z, kind: created }
  - { at: 2026-08-04T18:13:00Z, kind: in_progress }
  - { at: 2026-08-04T18:28:00Z, kind: qa_waiting }
  - { at: 2026-08-05T03:08:56.191072+00:00, kind: completed }
---

# 겹침으로 막힌 작업이 화면에서 시작 가능으로 보이지 않게 한다

SPEC-032의 R7과 완료 조건 11·13·15를 닫는다. TASK-101이 payload에 실은 겹침 근거를 작업 상세 화면이
읽어, 선행이 전부 충족인데 겹침 때문에 착수할 수 없는 작업을 "시작 가능"으로 말하지 않게 한다.

## 왜 지금 화면이 거짓이 되는가

확인 사실 14가 그 자리를 짚는다. `TaskDependencies`(`DevelopmentBoard.tsx:412`)는 선언된 선행이 전부
`satisfied`면 "시작 가능"(`:421`)이라고 적는다. 겹침 제외가 생기면 **선행은 전부 충족인데 착수할 수
없는 상태**가 만들어지고, 그때 이 문장이 사실과 어긋난다.

더 나쁜 자리가 하나 더 있다. 이 컴포넌트는 **선행이 없고 형식 오류도 아니면 아무것도 그리지
않는다**(`:413`). 선행 선언이 없는 작업이 겹침으로 막히면 화면에 그 사실을 담을 자리가 아예 없다.
**조기 반환 조건에 겹침을 더하는 것이 이 작업의 첫 줄이다.**

## 의존성

`depends_on: [TASK-100, TASK-101]`.

- **TASK-100**: 파일이 겹친다. 100의 범위에 `DevelopmentBoard.tsx`·`DevelopmentBoard.test.tsx`·
  `App.css`가 있고 이 작업이 만지는 파일이 그 셋이다. `types.ts`는 TASK-099가 만지는데, 100이 099를
  선행으로 적었으므로 100 뒤에 서면 그 자리도 함께 비켜난다.
- **TASK-101**: `overlap_blocks` payload를 만드는 작업이다. 없으면 그릴 값이 없다.
- SPEC-032 완료 조건 14가 요구하는 TASK-097·TASK-098 뒤 순서는 TASK-101을 거쳐 성립한다. 이 작업은
  조건 14가 이름을 댄 세 Rust 파일을 하나도 만지지 않으므로 두 작업과 직접 겹치는 자리가 없다.
- **선행 셋(TASK-096·099·100)이 QA에서 `todo`로 되돌아오면 이 작업도 다시 대기 상태가 된다.** 그런
  일이 실제로 일어나면 고쳐서 진행하지 말고 아키텍트 후속으로 넘긴다.

## 범위

- `src/features/projects/domain/types.ts` — `TaskOverlapBlock` 타입과 `TaskDocument`의 필드 하나.
  **TASK-099가 더한 타입은 고치지 않는다.**
- `src/features/projects/components/DevelopmentBoard.tsx` — `TaskDependencies`의 조기 반환·판정·
  문구와 겹침 목록. 프롭 하나가 는다.
- `src/features/projects/components/DevelopmentBoard.test.tsx` — 단언 추가. **기존 검사는 이름도 내용도
  고치지 않는다.** TASK-095·096·100이 더한 검사도 마찬가지다.
- `src/App.css` — 겹침 표시 규칙 추가. **기존 규칙은 고치지 않는다.**
- 그 외 파일은 건드리지 않는다. **Rust·게이트웨이·훅·`ActivityView.tsx`·`WorkspaceShell.tsx`는 이
  작업의 범위가 아니다.** TASK-101이 만든 payload를 읽기만 한다. 모자란 것이 나오면 고치지 말고
  보고서에 적는다.

저장소에 미커밋 변경이 크고 TASK-095·096·100이 같은 세 파일을 이미 고쳤다. **줄 번호는 작업 트리
기준이고, 쓰기 직전에 대상 줄을 다시 읽는다.**

## 작업 내용

### 타입

TASK-101이 Rust에 만든 것과 같은 모양이다. **착수 시점에 `domain/project.rs`를 읽어 대조한다** —
직렬화는 `#[serde(rename_all = "camelCase")]`이므로 `leaseTargetId`·`sharedFiles`다.

```ts
export interface TaskOverlapBlock {
  leaseTargetId: string;
  sharedFiles: string[];
}
```

`TaskDocument`에 `overlapBlocks?: TaskOverlapBlock[]`을 더한다. `dependencies?`·`dependencyFormatError?`
(`:86`·`:88`)와 같이 선택 필드다.

### 판정과 문구 (R7)

- **조기 반환**(`:413`): 선행이 없고 형식 오류도 아니어도, 겹침이 하나라도 있으면 그린다.
- **"시작 가능"**(`:414`·`:421`): 겹침이 하나라도 있으면 시작 가능이 아니다. 기존
  `startable` 판정에 조건 하나가 는다.
- **영구·일시 구분**(`:415`): 겹침은 **일시**다. lease가 만료되거나 풀리면 열린다. `missing`·`cyclic`·
  형식 오류를 영구로 다루는 `permanent` 판정에 **겹침을 넣지 않는다.** R7 넷째 항목이 그 구분을
  요구한다. 겹침만으로 막힌 작업은 경고 톤이 아니라 대기 톤이다.
- **무엇과 겹쳤는지**: `leaseTargetId`와 `sharedFiles`를 읽을 수 있게 그린다. `sharedFiles`가 비어
  있으면 공유 경로가 아니라 **선언 부재·형식 오류로 막힌 것**이므로 그 사실을 말한다. 두 경우의 문구가
  같으면 사용자가 "무엇을 고쳐야 열리는가"를 읽지 못한다.
- 겹침과 선행 미충족은 **동시에 성립할 수 있다.** 둘 다 있으면 둘 다 보인다. 한쪽이 다른 쪽을 가리지
  않는다.

### 새 원천을 만들지 않는다 (R7 셋째 항목)

- 활성 lease 목록을 화면에서 다시 조회하지 않는다. `overlapBlocks`가 이미 판정 결과다.
- **`ActivityView.tsx`를 고치지 않는다.** 활성 워커 화면은 SPEC-011이 만든 자리이고 이 기획서가
  요구하는 변경이 없다.
- 목록 payload에 값을 더하지 않는다. 이 화면은 카드를 눌렀을 때 도는 상세 경로다.

### 검사 (`DevelopmentBoard.test.tsx`)

1. 선행이 전부 `satisfied`인데 겹침이 하나 있으면 **"시작 가능"이 보이지 않는다.** (완료 조건 11 앞절)
2. 그때 겹친 상대(`leaseTargetId`)와 공유 경로가 화면에서 읽힌다. (완료 조건 11 뒷절)
3. 선행 선언이 없는 작업도 겹침이 있으면 그 사실이 그려진다. 조기 반환이 삼키지 않는다.
4. `sharedFiles`가 빈 겹침은 선언 부재·형식 오류로 막혔다는 문구를 낸다.
5. 겹침이 없으면 화면이 지금과 같다. 선행이 전부 충족이면 "시작 가능"이 그대로 보인다.
6. 겹침만 있는 작업은 영구 실패 톤(`missing`·`cyclic`·형식 오류의 자리)을 쓰지 않는다.

## 완료 조건

괄호 안은 SPEC-032의 완료 조건 번호다.

1. 선행이 전부 충족인데 겹침으로 막힌 작업이 "시작 가능"으로 보이지 않고, 무엇과 겹쳤는지가 읽힌다.
   검증: 검사 1·2. (11)
2. 선행 선언이 없는 작업의 겹침도 화면에 나온다. 검증: 검사 3.
3. 선언 부재·형식 오류로 막힌 것과 공유 경로로 막힌 것이 다른 문구를 낸다. 검증: 검사 4.
4. 겹침이 일시로 표시되고 영구 실패와 구분된다. 검증: 검사 6. (R7 넷째 항목)
5. 겹침이 없을 때 화면이 지금과 같다. 검증: 검사 5와, **기존 검사가 수정 없이 통과한다.** 착수 시점
   `DevelopmentBoard.test.tsx`의 검사 개수를 세어 보고서에 적는다.
6. 기존 자동 테스트가 삭제되거나 비활성화되지 않는다. (13)
7. 변경분에 Rust 파일과 `ActivityView.tsx`·`WorkspaceShell.tsx`가 없다. (14)
8. `npm run check`와 `cargo test --manifest-path src-tauri/Cargo.toml`이 통과한다. (15)

## 검증 문구 규칙

무변경은 파일·심볼 단위로 확인한다. **"`git diff`가 비어 있다"를 쓰지 않는다** — 이 작업 트리에는 여러
세션의 미커밋 변경이 겹쳐 있다.

## 범위 밖

- **판정 구현과 payload.** TASK-101의 몫이다. 모자라면 고치지 말고 보고서에 적는다.
- **계약 문언.** TASK-102의 몫이다.
- **활동 뷰(`ActivityView.tsx`)의 변경.** 이 기획서가 요구하지 않았다.
- **목록·보드 카드에 겹침 배지를 다는 일.** R7은 "시작 가능" 문장이 거짓이 되는 자리를 고치라고
  했고, 그 자리는 상세의 선행 절이다. 카드 표시는 후속 아이디어로 올린다.
- **겹침을 화면에서 풀거나 lease를 만료시키는 조작.** 기획서 제외 범위다. 앱은 lease를 읽기만 한다.
- **겹침을 근거로 `depends_on`을 제안하는 화면.** 순서를 정하는 것은 아키텍트의 판단이다.
- **동시 세션 수 설정 화면.** 승인된 확인 필요 3번이 잘랐다.
