# TASK-S080-03 개발 보고서

## 결정권자 요약

사이드바에 리사이즈 핸들과 접기를 붙였다. 오른쪽 경계를 끌면 190px에서 380px 사이에서 움직이고,
더블클릭하면 정해 둔 너비가 지워져 넓은 창 250px, 좁은 창 210px로 돌아간다. 전환 줄 오른쪽 끝의
접기 버튼을 누르면 폭 28px 세로 바만 남고, 다시 누르면 접기 직전 너비로 돌아온다. 정한 값은 여섯
화면과 워크플로우 전환과 앱 재시작을 건너 그대로 남는다. 한 번도 조절하지 않은 사이드바의 배치는
지금과 같다. 스타일 규칙이 변수의 되돌림 값으로 그리므로, 저장된 값이 없으면 250px과 210px이
그대로 나온다. 자동 검증은 격리 사본과 통합 후 모두 `npm run check` 통과(시험 694개)이고, 웹킷
실렌더로 너비 한계·되돌림·접힘·여섯 화면 유지를 눈으로 확인했다. 이 결과는 GROUP-080의 자동
확인을 뒷받침한다.

## 변경한 파일과 모듈

선언한 파일 넷 그대로다. 통합 커밋은 `31ad64b`, 기준 커밋은 `4d3f7f4`.

- `src/App.css`: `.app-shell` 첫 칸을 `var(--sidebar-width, 250px)`로, 창 폭 980px 이하 규칙의 같은
  자리를 `var(--sidebar-width, 210px)`로 바꿨다. `.sidebar`에 `position: relative`를 주고 핸들을
  오른쪽 경계에 겹쳐 세우는 규칙, 접힌 자리의 `.sidebar-collapsed`, 접기 버튼을 전환 버튼의
  형제로 세우는 `.sidebar-switcher-row`를 더했다.
- `src/features/projects/components/WorkspaceShell.tsx`: 사이드바 너비와 접힘 상태, 창 폭 상태,
  `browserPanelLayoutStore` 읽기·쓰기, `defaultPanelWidth`와 `resolveRenderedPanelWidths` 호출,
  조작 요소 셋 배치. 사이드바가 차지한 자리는 `SidebarLayoutContext`로 내보낸다.
- `src/features/projects/components/WorkspaceShell.test.tsx`: C1~C9와 C11의 화면 시험 15개.
- `src/features/projects/components/appShellPanelLayout.test.ts`(신규): C9·C10의 스타일 시험 6개.

`domain/panelLayout.ts`, `browserPanelLayoutStore.ts`, `PanelLayoutControls.tsx`는 읽고 부르기만
했고 고치지 않았다. 그리는 너비 계산과 한계 보정은 전부 TASK-S080-01의 함수가 한다.

## 검증 단계와 결과

- 격리 사본 `npm run check`: 통과. 시험 694개(35파일), 타입체크와 빌드 포함.
- 기준 커밋이 `948043a`에서 `4d3f7f4`로 전진해 있어 리베이스한 뒤 격리 검사를 다시 돌렸다. 두
  커밋 사이 변경은 문서뿐이고 `src/`는 손대지 않았다.
- 통합 후 공유 작업 공간 `npm run check`: 통과. 같은 694개. 공유 기준의 추적 파일 미커밋 변경이
  없어 충돌 없이 fast-forward로 반영했다.
- C12: 통합 직전 `git status`에 선언한 파일 넷 밖의 변경이 없었다.
- C1·C2·C3·C4·C5·C6·C7·C8·C9·C11: `WorkspaceShell.test.tsx`의 화면 시험으로 확인. C6·C7은
  `localStorage`를 대체 구현으로 세워 확인했고, C7은 읽기·쓰기가 모두 던지는 저장소에서 화면이
  그려지고 드래그와 접기가 그대로 도는 것까지 봤다.
- C8: 창 폭 600px에서 저장한 380px이 260px로 줄어 그려지고 저장값은 380px로 남았다. 1024px로
  넓히자 380px이 다시 나왔다.
- C10: 스타일의 되돌림 값 250px·210px을 `PANEL_LIMITS.sidebar`의 기본 너비·좁은 창 기본 너비와
  맞대어 확인했다. 한쪽만 바뀌면 시험이 떨어진다.
- 실렌더 확인(검증 절차 9): 웹킷(Playwright WebKit 26.5)으로 1440x900에서 기본 250px, 끝까지
  넓혀 380px, 끝까지 좁혀 190px, 더블클릭 250px, 접기 28px, 펼치기 250px을 실측했다. 378px로
  넓힌 뒤 오늘·아이디어·기획서·개발·품질 확인·기록 여섯 화면을 차례로 열었고 모두 378px이었다.
  창 폭 900px에서는 기본 210px, 핸들 비표시, 접기 버튼 정상 동작(28px)이었다. 190px과 380px 양
  끝에서 메뉴 이름이 잘리거나 겹치지 않았다. 프로젝트 이름과 워크플로우 이름은 기존 말줄임이
  그대로 걸린다.
- 실렌더에는 `WorkspaceShell`을 픽스처로 띄우는 임시 진입점 둘이 필요했다. 확인 뒤 지웠고 위
  `git status` 결과가 그 사실을 보인다. 처음 만들 때 경로를 잘못 잡아 공유 작업 공간 루트에
  두었다가 즉시 지웠으며, 그 자리에 남은 변경은 없다. 확인용으로 사용자 컴퓨터의 Playwright
  캐시에 webkit 2336을 내려받았다.

## 남은 위험

- 드래그하는 동안 사이드바의 글자가 선택된다. `PanelLayoutControls.tsx`의 핸들에는
  `user-select: none`이 있지만 드래그 중 문서 전체에는 걸리지 않는다. 이 작업의 선언 범위 밖이라
  건드리지 않았다.
- 드래그는 포인터가 움직일 때마다 저장소에 쓴다. 한 번 끌 때 쓰기가 수십 번 발생한다. 표시
  상태라 실패해도 삼키지만, 잦은 쓰기가 걸리면 나중에 눌러 담을 자리가 필요하다.
- 시험은 jsdom이라 `--sidebar-width` 변수의 값까지만 확인한다. 실제 격자가 그 값을 어떻게 그리는지는
  위 웹킷 실렌더가 근거다.

## 후속 작업

- C11의 값 전달 방식이 작업 문서와 다르다. 문서는 화면 컴포넌트에 값으로 넘기라고 적었지만,
  `SpecWorkspace.tsx`와 `IdeaInbox.tsx`가 이 작업의 선언 범위 밖이라 그 쪽 props를 여기서 만들 수
  없다. 선언한 파일 안에서 통로를 세울 수 있는 방법이 React context뿐이어서
  `SidebarLayoutContext`로 내보냈다. 값의 모양은 `PanelReclaimInput` 그대로라
  `measureReclaimedWidth`에 바로 넣을 수 있다. TASK-S080-04는 props가 아니라 이 context를 읽어야
  한다. 두 화면 파일이 `WorkspaceShell.tsx`를 되부르는 순환 참조가 되므로, 값을 컴포넌트 안에서만
  읽어야 한다는 점도 함께 확인이 필요하다.
- 위 드래그 중 글자 선택은 `PanelLayoutControls.tsx`를 선언한 작업이 맡아야 한다.
