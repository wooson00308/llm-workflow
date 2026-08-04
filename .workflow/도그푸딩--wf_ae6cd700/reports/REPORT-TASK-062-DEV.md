# TASK-062 개발자 핸드오프

> 기록 경위: 하네스가 서브에이전트(developer-062)의 보고서 파일 작성을 차단해, 발신된 전문을 TL이 대리 기록한다. 내용은 발신 전문 그대로다. (수신 2026-08-04T08:45Z, TL 세션)

- 대상 작업: TASK-062 (설치 마법사의 접힘을 저장소에 배선하고 화면 동작을 테스트로 고정한다)
- 근거 문서: SPEC-019 R1·R3·R4, DECISION-284DCE8B (outcome: approved, created_by: user)
- 세션 역할: 개발자 (developer-062)
- 작성 시각: 2026-08-04T08:41Z
- 상태: `qa_waiting` (lease 반납 완료)

## 대상 선정과 선점

착수 시점(08:32Z) `status: todo`. 선행 `depends_on: [TASK-061]` 충족 — TASK-061이 `qa_waiting`이고, 산출물 `src/features/projects/infrastructure/browserSetupGuideCollapseStore.ts`를 파일로 실측했다(`browserSetupGuideCollapseStore = { load, save }`, 키 `workflow-labs.heartbeat-setup-guide-collapse.v1`, 기본값 `true`). `migration.lock` 없음, `leases/`에 `TASK-062.yml` 없었음(`SPEC-009.yml`·`SPEC-020.yml`만 있었고 남의 lease는 읽지도 지우지도 않았다).

선점은 `set -o noclobber` 폴백 대신 헬퍼로 했다. `.workflow/rules/wf-claim.sh`가 설치돼 있고 공통 규칙 §4가 "헬퍼가 설치돼 있으면 세션은 lease 파일을 직접 만들지 않는다"로 못박고 있어서다. `acquire TASK-062 developer-062 45` → exit 0, `lease-73708-20260804083252` → 같은 편집에서 `in_progress` + history → 구현 → 검증 → `qa_waiting` → `release` exit 0.

## 변경한 파일 (셋)

- `src/features/projects/components/integrations/HeartbeatCard.tsx`
  - `browserSetupGuideCollapseStore` import 추가
  - `useState(true)` → `useState(() => browserSetupGuideCollapseStore.load())`
  - `toggleOpen()` 추가(다음 값 계산 → `setOpen` → 그 자리에서 `save(next)`), 토글 `onClick`이 이 함수를 부른다
  - `:408`~`:410` 주석에 두 문단 추가(기억이 저장소에 남는 이유, 카드 접힘과 키가 다른 이유). 기존 문장은 지운 사실이 아니라 그대로 뒀다
- `src/features/projects/components/integrations/IntegrationsView.test.tsx`
  - 기존 `설치 가이드 접기` describe 안에 테스트 9개 삽입. 기존 세 테스트는 이름·본문 무수정
  - 기억 관련 8개는 중첩 describe `접힘 기억`에 뒀다(카드 쪽 `연동 카드 접기·펼치기` > `펼침 상태 기억` 구조를 그대로 따름)
- `.workflow/도그푸딩--wf_ae6cd700/tasks/TASK-062.md` (상태·history)

`IntegrationsView.tsx`·`IntegrationCard.tsx`·`DreamCard.tsx`·`browserIntegrationCollapseStore.ts`는 무변경. 보호 상태(project.yml, workflow.yml, decisions, runtime lock, 스키마) 무변경. git 커밋 안 했다.

## 핵심 결정과 근거

1. `IntegrationsView.tsx:35`의 idiom을 그대로 옮겼다. `useEffect` 동기화를 안 쓴 이유 둘 — 첫 마운트에서 읽은 값을 되쓰게 되고, 마법사가 사라진 동안에도 쓰기가 돌아 R3("보이지 않는 동안 기억을 지우지 않는다")을 지키려면 조건을 하나 더 달아야 한다.
2. 토글이 `setOpen((previous) => !previous)`에서 `const next = !open`으로 바뀌었다. 저장할 값이 업데이터 밖에 있어야 해서다. 카드 접힘의 `toggle`도 같은 형태다.
3. `if (!remaining) return null` 경로에서는 저장소에 쓰지 않는다. 훅이 그 위라 읽기만 일어나고 읽기는 기억을 지우지 않는다. 부모가 `<HeartbeatSetupWizard />`를 조건부로 감싸지 않아 null을 돌려줘도 마운트는 유지된다 — 그 경로는 지역 상태가, 언마운트를 지나는 경로는 저장소가 선택을 지킨다.
4. 접힌 상태의 복사 버튼은 `getByRole(..., { hidden: true })`로 집었다. 접힌 본문은 `hidden`이라 접근성 트리 밖이고 그게 카드 본문 접기와 같은 정상 동작이다. 조건 12가 요구하는 건 "단계가 DOM에 남아 복사 경로가 그대로"라 DOM 쪽으로 확인했다.
5. 새 테스트가 헛돌지 않는지 배선 두 곳을 각각 임시로 되돌려 확인하고 복구했다. `useState(true)`로 되돌리면 4개 실패, `save`만 끊으면 4개 실패. 최종 게이트는 복구된 코드에서 돌렸다.

## 완료 조건 대조

- 신규 테스트로 닫음: 1·2·3·5·6·7·8·9·12 (각 테스트 이름은 발신 전문 참조 — `stays folded after leaving the view and coming back` 외 8건)
- 기존 테스트 무수정 통과로 닫음: 4·10·11·13
- 14: `it.skip`/`it.only`/`xit` 0건. 테스트 파일 편집은 삽입뿐
- 15: 아래 게이트

## 게이트 수치

```
npx vitest run IntegrationsView.test.tsx -t "설치 가이드 접기"   12 passed / 131 skipped (143)
npm run check                                                  exit 0
  npm run typecheck (tsc -b)                                   통과
  npm run test (vitest run)                                    15 files, 355 passed / 0 failed
  npm run build (tsc -b && vite build)                         성공, 320 modules
```

백엔드 무변경이라 `cargo test`는 돌리지 않았다(변경 파일 둘 다 `src/` 아래 TSX).

## 사용자 QA 제안

1. 연동 뷰에서 하트비트 카드를 펼쳐 설치 가이드가 펼쳐져 있는지 본다.
2. "설치 가이드 접기"를 누르고 제목·"필수 단계 n/m 완료"·펼치기 버튼이 남는지 본다.
3. 다른 메뉴에 갔다 연동으로 돌아온다 → 접힌 채여야 한다.
4. 앱을 껐다 다시 연다 → 여전히 접혀 있어야 한다.
5. 다시 펼친 뒤 3·4를 반복 → 이번엔 펼쳐진 채여야 한다.
6. 카드 머리의 "접기"/"펼치기"를 몇 번 눌러도 가이드 상태가 따라 바뀌면 안 된다.
7. 하트비트·드림 카드의 접힘 기억이 예전과 같은지 함께 본다.
8. 접힌 상태에서 카드 배지·경고 표시가 펼쳤을 때와 같은지 본다.

## 후속 / 리스크

- 기억은 앱 전체 하나다(SPEC-019 확인 필요 1번의 승인된 제안). 프로젝트를 바꿔도 같은 상태라 QA에서 프로젝트별로 다르길 기대하면 어긋난다.
- 역할 밖 발견(핸드오프 노트): `IntegrationsView.test.tsx`의 `steps()` 헬퍼(:2225) 주석이 "마법사가 접히면 빈 배열이다"라고 적는데 사실이 아니다. 접기는 `hidden`이라 단계 행이 DOM에 남고, 기존 테스트도 그 전제 위에 서 있다. 이번 작업의 주석 범위 밖이라 고치지 않았다.
- 저장소 값은 `boolean` 하나다. 드림 카드에 같은 가이드가 생기면 그때 키 형태를 다시 정해야 한다(SPEC-019 제외 범위, TASK-061과 같은 판단).
