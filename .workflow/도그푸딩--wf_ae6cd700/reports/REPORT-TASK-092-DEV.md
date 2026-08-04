# TASK-092 개발자 핸드오프

- 대상: TASK-092 (dream 잡 재설정 확인 화면도 다른 프로젝트의 잡 보장을 밝힌다)
- 근거: SPEC-022 R3, DECISION-4E8C1D67 (`outcome: approved`, `created_by: user`, `spec_id: SPEC-022` — 직접 확인)
- 역할: 개발자 (developer-sasha)
- 선점: acquire exit 0 → `lease-86127-20260804103038` → `in_progress`(10:31:00Z) → 구현 → 검증 → `qa_waiting`
- 선행 확인: `depends_on: [TASK-064, TASK-065]` 둘 다 `qa_waiting`(착수 시점 직접 확인). 후행 TASK-083은
  아직 `todo`라 순서가 뒤집히지 않았다 — 작업 문서가 `blocked`으로 두라고 지정한 조건에 해당하지 않는다.

문장 한 줄과 단언 한 줄. 동작 변경은 없다. 보존 자체는 TASK-064가 이미 구현했고, 이 작업은 그
보장을 화면이 밝히지 않던 비일관 상태만 닫는다.

## 변경한 파일 (둘, 작업 문서 범위 그대로)

- `src/features/projects/components/integrations/DreamCard.tsx:797` — `<p>` 한 줄. 기존 두 문장 유지,
  뒤에 보장 문장 하나 추가.
- `src/features/projects/components/integrations/DreamCard.test.tsx:570` — `toHaveTextContent` 문자열
  하나를 확장. 테스트 이름(`shows the difference between the file values and the app defaults`)과
  나머지 본문·다른 단언 4개는 무수정.

`HeartbeatCard.tsx` 무변경, Rust(`src-tauri/`) 무변경, 보호 상태 무변경, 커밋·푸시 없음.

## 구현

```tsx
// DreamCard.tsx:797
<p>이 잡의 편집 가능 값만 앱 기본값으로 되돌립니다. 잡의 활성·비활성 상태와 같은 블록의 역할 잡은 그대로 둡니다. 다른 프로젝트가 이 블록에 둔 잡도 값 그대로 남습니다.</p>
```

작업 문서 지시대로 완전형을 썼다. 축약형("…도 마찬가지입니다")은 dream 설치 화면(`:867`)처럼 바로 앞
문장이 받아 줄 때만 읽히는데, 재설정 화면에는 받을 문장이 없다.

단언은 형제 화면(`IntegrationsView.test.tsx:1010`, 역할 잡 재설정 확인)이 쓰는 방식과 같게 기존
문자열을 뒤로 늘리는 형태로 고쳤다.

## 완료 조건별 확인

| # | 조건 | 결과 |
|---|---|---|
| 1 | 재설정 확인 화면이 보장을 밝히고 기존 두 문장이 남아 있다 | 통과 (위 원문) |
| 2 | 보장 문장이 `HeartbeatCard.tsx:1252`의 같은 문장과 글자까지 같다 | 통과 — 아래 대조 |
| 3 | TASK-064가 구현한 보장과 같은 말까지만 한다 | 통과 — 순서·위치·앱이 남의 잡을 관리한다는 인상 없음 |
| 4 | 파일 소개 문구 네 곳이 그대로다 | 통과 — 아래 실측 |
| 5 | 해당 단언이 새 문자열로 통과한다 | 통과 — `DreamCard.test.tsx` 86건 전부 통과 |
| 6 | 삭제·비활성화된 테스트 없음 | 통과 — `it.skip`·`it.only`·`xit` 0건, 테스트 수 감소 없음 |
| 7 | `npm run check` 통과 | 통과 — 아래 |
| 8 | 세션 변경분이 위 두 파일 밖에 없다 | 통과 — 아래 판정 근거 |

### 조건 2 — 두 문자열 대조 (실측)

두 줄에서 마지막 문장만 잘라 셸 문자열 비교(`[ "$a" = "$b" ]`)로 판정했다.

- `DreamCard.tsx:797`  → `다른 프로젝트가 이 블록에 둔 잡도 값 그대로 남습니다.`
- `HeartbeatCard.tsx:1252` → `다른 프로젝트가 이 블록에 둔 잡도 값 그대로 남습니다.`
- 결과: `IDENTICAL` (마침표·중점·띄어쓰기 포함 완전 일치)

### 조건 4 — 파일 소개 문구 네 곳 실측

`DreamCard.tsx:795`·`:865`, `HeartbeatCard.tsx:1249`·`:1322` 모두 여전히
`{heartbeatFilePath} — 전역 파일입니다. 이 컴퓨터의 모든 프로젝트가 함께 씁니다.` 한 글자도 안 건드렸다.
파일 경로 상수(`DreamCard.tsx:33`)도 무변경 — jobs.d 전환은 TASK-083 몫이다.

### 조건 8 — 판정 방법

작업 문서 지시대로 `git diff`의 공백 여부로 판정하지 않았다. 두 파일 모두 병행 세션의 미커밋 변경이
크게 남아 있어(`DreamCard.test.tsx` +646, `DreamCard.tsx` +335) 그 판정은 성립하지 않는다.

대신 심볼·문자열 단위로 확인했다. 이 세션의 편집은 정확히 두 번, 각각 한 줄 치환이다. 새 문장
`다른 프로젝트가 이 블록에 둔 잡도 값 그대로 남습니다`를 저장소 전체에서 재검색하면 이 세션 이전부터
있던 `HeartbeatCard.tsx`·`IntegrationsView.test.tsx` 외에 `DreamCard.tsx:797`과
`DreamCard.test.tsx:570` 두 곳만 새로 나온다. 마크업 구조(`aria-label`, `role="group"`,
`<JobChanges removed={[]} written={resetChanges} />`)는 자리·인자 모두 그대로다.

## 검증

- `npx vitest run .../DreamCard.test.tsx` → 86 passed / 86
- `npm run check` (typecheck → test → build) → 전부 통과. 테스트 18 파일 456건 통과, `tsc -b` 무오류,
  `vite build` 성공(325 modules).

## 남은 위험과 후속

- **TASK-083과의 순서.** TASK-083이 같은 화면의 파일 설명을 "이 프로젝트 전용 파일"로 바꾸면 이번에
  넣은 문장의 전제("다른 프로젝트가 이 블록에 둔 잡")가 사라진다. 그 작업이 이 문장과 단언까지
  같이 손보게 되어 있는지 담당 세션이 확인해야 한다. 순서는 TASK-083의 `depends_on`에 이미 기록돼 있다.
- **역할 밖 관찰(수정하지 않음).** `.workflow/.runtime/leases/SPEC-009.yml`이 2026-08-03T01:20:00Z에
  만료된 채 남아 있다. 판정은 만료 lease를 선점으로 세지 않아 지금 막는 것은 없고, 규칙상 세션이
  남의 lease 파일을 지우지 않으므로 그대로 두었다.
- 사용자 QA 범위: dream 카드 → 잡 기본값 재설정 → 확인 화면의 안내 문장이 역할 잡 카드의 같은
  화면과 같은 말을 하는지 눈으로 대조.
