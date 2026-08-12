# TASK-149 개발 보고서

## 결정권자 요약

막힌 작업 패널에서 사용자가 해결 근거를 적고 두 번 확인해 개발 준비 상태로 되돌리는 흐름을 구현했다.
첫 확인은 무엇을 어떤 값으로 기록하는지 보여 주기만 하고 두 번째 확인만 호출하며, 앱이 근거를 대신 짓지 않는다.
문서 변경, 잠금, 선점과 부분 저장은 성공으로 표시하지 않고 입력을 유지한 채 최신 문서를 다시 읽게 한다.
재개 뒤에는 같은 상세가 열린 채 상태와 사용자 재개 기록이 바뀌고, 아직 시작할 수 없는 이유는 그대로 남는다.
사용자 재개는 활동 화면과 시간선에서 QA 반려와 다른 이름으로 한 번 나타난다.
집중 검사 108개와 전체 851개, 배포 빌드가 통과했다.
사용자는 TASK-149 확인 동선에 따라 실제 화면에서 재개 조작과 거절 재현을 확인하면 된다.

## 인수한 잔여물

앞선 이 세션이 네트워크 오류로 착수 직후에 끊겼고, 만료된 lease를 다시 선점해 이어받았다. 잔여물은
셋으로 갈렸다. 유지: 작업 문서의 `status: in_progress`는 그 세션이 정확히 기록한 값이라 그대로 두었다.
보완: 같은 편집에서 남겨야 할 `history` 항목이 빠져 있어 인수 시각으로 `in_progress` 한 줄을 덧붙였다.
폐기: 없다. `scope_files`의 화면 파일은 한 줄도 바뀌지 않은 상태였고, 걷어낸 검사도 없다.

## 변경 파일과 모듈

- `src/features/projects/domain/types.ts`: 재개 요청·결과·결말 타입과 게이트웨이 메서드를 더했다. 결말은
  성공과 실패를 값으로 가르며, 실패 사유를 화면 안에서 읽도록 메시지를 함께 싣는다.
- `src/features/projects/infrastructure/tauriProjectGateway.ts`: TASK-148이 등록한 `resume_task` 명령을 호출한다.
- `src/features/projects/application/useProjectWorkspace.ts`: 재개 호출을 더했다. 돌아온 요약으로 프로젝트를
  갈아 끼우고, 부분 저장으로 끝난 결과도 지금의 사실이므로 같은 방식으로 반영한다.
- `src/features/projects/components/BlockedTaskPanel.tsx`: TASK-145의 사유 표시를 그대로 두고 그 아래에 재개
  영역을 세웠다. 확인할 갱신 시각과 재개 조건, 필수 입력과 글자 수, 두 단계 확인, 거절 사유와 문서 다시
  읽기가 한 자리에 있다. 세 폴백 모두에서 같은 자리에 서며, 통로가 없으면 아예 그리지 않는다.
- `src/features/projects/components/BlockedTaskPanel.css`: 재개 영역의 한 열 배치와 980픽셀 이하 규칙, 긴
  근거·경로의 줄바꿈을 더했다.
- `src/features/projects/components/DevelopmentBoard.tsx`: 재개 통로를 상세로 잇고, 성공 뒤 같은 문서를 다시
  읽어 상태·이력·구조 판정을 갱신한다. 이벤트 이름 목록에 사용자 재개를 더했고 활동 화면이 같은 목록을 읽는다.
- `src/features/projects/components/WorkspaceShell.tsx`: 연 워크플로 디렉터리를 붙여 재개 호출을 넘긴다.
- `src/App.tsx`: 작업 공간의 재개 통로를 화면에 연결했다. 이 파일은 작업 문서의 `scope_files`에 없다.
- 검사: `BlockedTaskPanel.test.tsx`(재개 영역 20건, 종단 흐름 4건), `useProjectWorkspace.test.ts`(호출 형태와
  거절 사유 2건), `WorkspaceShell.test.tsx`(배선 1건), `ActivityView.test.tsx`(이름 목록 갱신).

## 검증 절차와 결과

- `npx vitest run src/features/projects/components/BlockedTaskPanel.test.tsx src/features/projects/components/DevelopmentBoard.test.tsx` 통과: 108 passed, 0 failed.
- `npx vitest run src/features/projects/components/ActivityView.test.tsx src/features/projects/components/DevelopmentBoard.test.tsx` 통과: 107 passed, 0 failed.
- `npm run check` 통과: 타입 검사 성공, 25개 파일 851 tests 통과, 배포 빌드 성공.
- 새 검사는 완료 조건과 대응한다. 세 폴백에서 재개 영역이 서는지, 빈 값과 2,000자 초과에서 호출이 없는지,
  첫 확인에서 0회이고 두 번째에서 1회인지, 진행 중 중복 클릭과 입력 변경이 막히는지, 같은 입력의 재시도가
  같은 요청 식별자를 다시 보내고 입력을 고치면 새 식별자를 만드는지, 거절과 부분 저장에서 성공 표시가 없고
  입력이 남으며 다시 읽기가 동작하는지, 성공 뒤 같은 상세가 열린 채 준비 상태와 사용자 재개 기록이 보이고
  선행·겹침 설명이 남는지, 재개가 QA 통로를 부르지 않는지, 두 런타임 작업의 종단 흐름에서 실제 파일 이름과
  갱신 시각이 넘어가고 원래 본문과 완료 조건이 보존되는지를 검사한다.

## 남은 리스크

- 실제 Tauri 명령과 이어 붙인 손 검사는 하지 않았다. 게이트웨이 계약은 TASK-148의 명령 형태와 필드 이름으로
  맞췄고, 검사에서는 대역을 쓴다.
- 요청 식별자는 브라우저 난수를 쓰고 없는 환경에서는 시각과 난수로 만든다. 사용자 사실이 아니라 재시도를
  알아보는 값이지만, 두 창에서 같은 작업을 동시에 재개하면 서로 다른 식별자가 되어 앱이 아니라 백엔드의
  상태 검사가 두 번째를 막는다.
- 화면 폭 판정은 CSS 선언 검사까지다. 실제 렌더링 폭과 포커스 링은 사용자 확인 동선에서 본다.
- 재개 뒤 목록·활동 화면의 값은 명령이 돌려준 요약에서 온다. 그 요약이 옛 상태를 담으면 화면도 옛 상태를
  보여주지만, 이 경로는 TASK-148이 같은 요청에서 다시 계산한다.

## 후속 작업

- `src/App.tsx`를 범위 밖에서 한 줄 고쳤다. 그 파일이 `WorkspaceShell`의 유일한 호출자라 통로를 잇지 않으면
  화면에서 부를 수 없는 기능이 된다. 다음 아키텍트 세션이 화면 배선 작업의 `scope_files`에 이 파일을 함께
  넣어 주면 좋겠다.
- 재개 통로 인자는 선택 필드로 두었다. 보드와 셸을 그리는 검사 리터럴이 66곳이라 필수로 좁히면 그 전부를
  함께 고쳐야 한다. 배선이 끊기면 조작이 사라지므로 셸 검사 하나가 통로 자체를 지킨다.
- TASK-S051-04·06을 실제로 언제 재개할지는 사용자 판단이다. 이 작업은 그 조작을 만들었을 뿐 두 작업의 상태를
  바꾸지 않았다.
