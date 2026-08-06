# SPEC-050 아키텍트 분해 보고서 (전문)

> 기록 경위: 하네스가 서브에이전트(tl-dev-136)의 보고서 파일 작성을 차단해, 발신된 전문을 TL이 대리 기록한다. 내용은 발신 전문 그대로다. (수신 2026-08-06T14:21Z경, TL 세션)

- 대상: SPEC-050 (작업 중 표시를 어느 화면에서든 볼 수 있게 한다)
- 승인: DECISION-877D9096 (outcome: approved, created_by: user, 2026-08-06T14:13:52Z)
- 산출: TASK-142 한 건, status: todo
- 세션: 2026-08-06T14:16Z~14:21Z, 아키텍트 역할 (architect-fable)
- 선점: acquire SPEC-050 → exit 0, lease_id lease-58325-20260806141639. renew exit 0, release exit 0 (반납 완료)

보고서 파일은 재시도하지 않았다. 직전 SPEC-049 세션에서 같은 경로를 시도했을 때 하네스가 "Subagents should return findings as text, not write report files"로 차단했고, 이는 일시적 실패가 아니라 범주 규칙이라 같은 결과가 반복된다. 우회하지 않고 전문 발신으로 대체한다.

## 생성·수정한 파일 (절대경로)

- /Users/catze/project/workflow-labs/.workflow/도그푸딩--wf_ae6cd700/tasks/TASK-142.md (신규)
- /Users/catze/project/workflow-labs/docs/development-logs/2026-08-06.md (세션 섹션 추가)

선점 시각(14:16:39Z) 기준 find -newermt 결과 위 2건이 내 변경 전부다. 같은 구간의 leases/TASK-139.yml, leases/TASK-141.yml, docs/compliance-cost-measurement.md, fs_project_repository.rs, heartbeat_condition.rs, role_eligibility.rs는 진행 중인 개발 세션 둘의 산출이며 각자 선언한 scope_files와 정확히 일치한다(지난 세션의 범위 선언이 실제로 작동하고 있다는 확인이기도 하다). decisions/ 미접근, 커밋 없음, 만료 SPEC-009.yml 무접촉.

## 착수 점검

- 계약 버전: architect 8, workflow 14로 지난 세션과 동일해 재독하지 않았다. custom.md 없음(파일 부재).
- wf-eligible.sh architect → eligible/exit 0 (14:16:01Z).
- 결정 전수 대조로 최신 결정이 approved이면서 파생 작업 0건인 기획서가 SPEC-050 하나임을 확정. 선점 직후 재확인도 0건.
- 하트비트 아키텍트나 codex의 선점 없음. 선점 시점 활성 lease는 TASK-139(developer-claude), TASK-141(developer-fable) 둘뿐이었다.

## 분해 결정과 근거

### 한 작업으로 둔 이유

R1~R6이 전부 WorkspaceShell.tsx 한 구성 요소와 그 스타일(App.css), 그 검사 파일(WorkspaceShell.test.tsx) 안에서 이뤄진다. 나누면 세 파일을 전부 공유하게 되어 병렬이 불가능하면서 인수인계 비용만 늘어난다. SPEC-049에서 R2·R3·R4를 묶은 것과 같은 판단 기준이다.

### 원 아이디어의 "새 백엔드 불필요" 판단 확인 (TL 지시 항목)

기획서가 뒤집지 않았다. 그대로 유지했고 오히려 요구사항으로 못박았다. R5가 "상시 표시만을 위한 별도의 조회나 새로운 백엔드 명령을 추가하지 않는다"이고, 완료 조건 8이 "새로 만든 조회 명령이나 폴링 주기가 없다"이다. 제외 범위에도 실시간 구독·새 폴링 주기 도입이 들어 있다. 따라서 프런트엔드 전용 작업으로 분해했고, 작업 본문의 "손대지 않는 것"에 활성 세션 값의 갱신 주기 변경 금지를 명시했다.

### 배치 근거 (실측)

기획서가 지정한 좌측 메뉴 하단은 실제로 WorkspaceShell.tsx 279행의 `<div className="sidebar-footer">`이고, App.css 114행에 대응 스타일이 있다. 결정적인 실측은 좌측 메뉴 `<aside className="sidebar">`(242행)가 화면 전환 분기 바깥에 있다는 점이다. 어떤 view 값(today/ideas/specs/tasks/archive/activity/integrations/help/settings)에서도 항상 그려지므로, 여기 넣으면 R1의 "어느 화면에서도 보인다"가 조건 분기 없이 배치만으로 충족된다. 이 구조 사실을 작업 본문에 실측값으로 실어 개발자가 다시 조사하지 않게 했다.

### 구현 함정 두 개를 지침으로 못박음

1. 펄스 점 스타일 재사용 불가. 기존 규칙이 App.css 157행에서 `.agent-activity .pulse`로 오늘 화면 카드 안에 한정돼 있어 새 표시에는 적용되지 않는다. 자기 선택자를 따로 쓰라고 적었다.
2. 접근성 이름. R3이 정보량을 펄스와 숫자만으로 줄이라고 해서 그대로 만들면 버튼의 읽어주는 이름이 비어버린다. 기존 좌측 메뉴 버튼 방식을 따르라고 지침에 넣었다.

또한 오늘 화면 기존 카드(349~356행)의 마크업·스타일 무수정을 명시했다. R6이 두 표시의 병행을 정했으므로 통합 시도가 나오면 안 된다.

## scope_files·depends_on

TASK-142 — 좌측 메뉴에 활성 세션 축약 표시를 상시 노출한다
- depends_on: 없음 (키 생략)
- scope_files: [src/App.css, src/features/projects/components/WorkspaceShell.test.tsx, src/features/projects/components/WorkspaceShell.tsx]
- 완료 조건 9개, 검증 절차 8단계
- SPEC-049 승인 취지대로 완결 지시서로 작성했다. 현재 상태 절에 WorkspaceShell.tsx의 view 상태(123행)·사이드바(242행)·푸터(279행)·오늘 카드(349행), App.css의 관련 규칙(86·114·155~164행), 검사 픽스처(24·476·781·999행)를 행 번호와 함께 실었다.

## 겹침 판정 (TL 지시 항목)

- TL이 지목한 QA 반려 리스크는 소멸했다. TASK-133부터 TASK-138까지 전부 status: completed로 실측 확인했다. WorkspaceShell.tsx·App.css를 마지막으로 만진 TASK-134·137이 사용자 확인까지 끝나 되돌아올 여지가 없으므로 depends_on을 걸 근거가 없다. 리스크를 선행으로 재는 대신 소멸을 확인하고 선행 없이 뒀다.
- 진행 중 세 작업과 무겹침 확인. TASK-139(domain/project.rs, fs_project_repository.rs, heartbeat_condition.rs, role_eligibility.rs), TASK-140(fs_project_repository.rs, project_instructions.rs), TASK-141(docs/compliance-cost-measurement.md, scripts/measure-compliance-cost.mjs) 어느 쪽도 내 세 파일을 선언하지 않는다. TASK-142는 지금 즉시 병렬 착수 가능하다.

## 착지 후 세 역할 자격 재실측

sh .workflow/rules/wf-eligible.sh <role> 결과다.

- 착수 전 14:16:01Z — planner: no-target(1) / architect: eligible(0) / developer: no-target(1)
- 선점 보유 14:20:17Z — planner: no-target(1) / architect: no-target(1) / developer: eligible(0)
- 반납 후 14:20:18Z — planner: no-target(1) / architect: no-target(1) / developer: eligible(0)

해석:
- architect가 eligible에서 no-target으로 바뀐 것이 이번 분해의 직접 결과다. DECISION-877D9096을 참조하는 작업이 생겨 "파생 작업 없는 승인"이 사라졌다. 반납 뒤에도 같은 값이라 lease 때문이 아니다.
- developer가 no-target에서 eligible로 바뀐 것도 이번 결과다. 착수 전에는 TASK-139·141이 선점돼 있고 TASK-140은 TASK-139가 in_progress라 선행 미충족이어서 후보가 없었다. 지금 유일한 후보는 TASK-142다.
- planner의 no-target은 이번 세션과 무관하다. IDEA-BE2D48EC가 SPEC-050으로 처리돼 미처리 아이디어에서 빠졌고, 다른 후보도 없다.

## 리스크

1. 세로 공간. 축약 표시가 좌측 메뉴 하단에 상시 들어가면서 공간을 쓴다. 기획서가 정보량 축소로 이미 완화했지만 실제 여백은 구현에서 봐야 한다. 기획서 제외 범위라 작업에서 조정 대상으로 넣지 않았다.
2. 완료 조건 8의 확인 난이도. "새 조회·폴링 없음"은 화면만 봐서는 확인이 안 된다. 게이트웨이 호출 기록을 쓰는 기존 검사로 확인하도록 검증 절차 7번에 넣었다.
3. 두 표시의 역할 분리. 오늘 화면에서 상세 카드와 축약 표시가 함께 보이는 것이 기획서가 정한 결과다. 사용자가 중복으로 느끼면 반려 사유가 될 수 있는데, 기획서 확인 필요 절이 "통합을 원하면 반려로 남기라"고 이미 적어 두었다. 구현 문제가 아니라 배치 취향 문제다.
4. 검사 픽스처 공유. WorkspaceShell.test.tsx의 공용 픽스처(24행 activeLeases: [])를 건드리면 기존 검사가 광범위하게 흔들린다. 기존 검사 무삭제를 완료 조건 9번에 넣었다.

## 후속

- 개발 세션은 TASK-142를 지금 착수할 수 있다. 진행 중인 TASK-139·141과 파일이 겹치지 않는다.
- TASK-140은 여전히 TASK-139 착지 대기다.
- 이번 워크플로의 미파생 승인은 0건이 됐다. 새 기획서가 승인되기 전까지 아키텍트 대기 물량은 없다.
