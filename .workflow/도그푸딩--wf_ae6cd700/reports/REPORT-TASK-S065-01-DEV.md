# TASK-S065-01 개발 보고서

## 결정권자 요약

작업 문서에 "이 작업은 혼자 돌아야 한다"고 적을 수 있게 되었고, 배정 판정이 그 표시를 읽는다.
표시된 작업이 차례를 기다리는 동안 이 프로젝트에서는 새 세션이 하나도 시작되지 않고, 돌던 세션이
모두 끝나면 그 작업 하나만 시작된다. 표시가 없는 작업의 배정은 한 가지도 달라지지 않으므로 지금
돌고 있는 일은 그대로 돌아간다. 표시를 지우면 즉시 지금 상태로 돌아온다. 자동 검사는 백엔드
843건과 화면 504건이 모두 통과했고 형식 검사와 빌드도 통과했다. 판정을 세 벌로 구현한 자리
(셸·PowerShell·앱)가 같은 답을 내는지는 실제 스크립트를 돌려 대조하는 기존 장치로 확인했다.
이 결과는 GROUP-065의 자동 검증 완료를 준비하는 증거이며, 사용자가 지금 확인할 것은 없다.

## 바꾼 파일과 모듈

- `src-tauri/src/domain/project.rs`. 제외 사유 상수 두 개(`SOLO_RUN_WAIT`, `SOLO_RUN_ACTIVE`)를
  기존 상수 묶음 옆에 더했다. 값은 C7이 못 박은 `solo-run-wait`·`solo-run-active` 그대로다.
- `src-tauri/src/infrastructure/fs_project_repository.rs`. `scope_files` 판독기 옆에
  `parse_solo_run_declaration`과 `SoloRunDeclaration`을 더하고 `TaskNode`에 실었다.
  `PreparedWorkflow`가 단독으로 읽히는 작업 id 집합을 내고 `WorkflowInput`으로 넘긴다.
- `src-tauri/src/infrastructure/role_eligibility.rs`. `SoloGate`와 `solo_representative`를 더했다.
  개발자 판정의 후보 상태 검사와 원천·그룹 판정을 `is_developer_candidate`·`source_and_group`으로
  묶어, 단독 후보 집합이 개발자 판정과 **같은 함수**를 쓰게 했다. 세 역할의 여덟 선택 자리가 모두
  게이트를 지난다.
- `src-tauri/src/infrastructure/heartbeat_condition.rs`. 셸 본문에 `solo_run_of`·`collect_solo_state`
  를 더하고, 개발자 분기 본문을 `developer_pass`로 묶어 판정 모드와 단독 수집 모드가 한 본문을
  쓰게 했다. PowerShell 본문에는 `Get-SoloRun`·`Get-SoloRepresentative`와, 두 자리가 나눠 쓰는
  `Get-TaskOrigin`·`Test-DependenciesSatisfied`를 더했다. 두 본문 모두 `note_target`/`Write-Target`
  한 자리에서만 게이트를 건다. `condition_script_version`을 22로 올렸다.

## 구현에서 고른 자리

- 단독 후보 집합을 `fs_project_repository`가 아니라 `pending_role_work` 안에서 정했다. 작업 문서의
  선언 판독은 문서를 읽는 저장소가 하고(선행·겹침과 같은 자리), 그 값에 제외 조건을 곱하는 규칙은
  판정 모듈 한 벌로 두었다. C3이 요구하는 "프로젝트 전체를 보는 자리"는 `pending_role_work`가
  그대로 만족한다. 집합을 저장소에서 조립하면 원천 승인과 그룹 가용 판정이 두 벌이 되고, C2가
  요구하는 "선점과 무관한 제외 조건 **전부**"가 어긋날 수 있어 이 자리를 택했다.
- 셸 본문은 `grep -qs '^solo_run:'` 한 번으로 선언 유무를 먼저 본다. 선언이 없으면 훑기가 거기서
  끝나므로 C6이 구조로 보장되고 비용도 역할당 프로세스 1개만 는다.

## 검증 절차와 결과

격리 사본(기준 커밋 484e550, 후보 커밋 40b74e8)에서 실행했다. 착수 시 기록된 기준 377ac58이
통합 직전에 484e550으로 전진해 있어, 후보를 그 커밋 위로 옮기고 아래 검사를 다시 돌린 값이다.

1. `cargo test --manifest-path src-tauri/Cargo.toml role_eligibility` — 99건 통과, 실패 0.
   C9가 요구한 6건이 모두 통과했고 기존 대조 검사는 하나도 깨지지 않았다.
2. `cargo test --manifest-path src-tauri/Cargo.toml` — 843건 + 25건 통과, 실패 0.
3. `cargo fmt --manifest-path src-tauri/Cargo.toml --check` — 통과.
4. `npm run test` — 파일 29개, 504건 통과·42건 건너뜀, 실패 0.
5. `npm run build` — 성공.
6. `git status` 확인 — 변경 파일은 선언한 네 개뿐이고 `.workflow` 아래와 `src` 아래에 변경이
   없다(C12).
7. 프로세스 예산 검사가 지금 세는 값을 다시 재어(planner 4 · architect 4 · developer 8) 규칙대로
   +1을 얹어 5 · 5 · 9로 다시 세웠다. 통과시키려고 올린 것이 아니라 늘어난 `grep` 하나를 실측에
   반영한 값이고, 근거를 각 상수 주석에 적었다.

통합 후 공유 작업 공간(커밋 2730117)의 깨끗한 사본에서 다시 실행했다.

- `cargo test --manifest-path src-tauri/Cargo.toml` — 843건 + 25건 통과, 실패 0.
- `cargo fmt --check` — 통과. `npm run test` — 504건 통과. `npm run build` — 성공.

통합 직전 `.workflow` 밖에 커밋되지 않은 추적 파일이 없어 사용자 작업과 겹치는 경로가 없었다.

## 기존 검사에서 바뀐 줄

C11과 검증 절차 6번은 기존 검사의 기대값이 바뀌지 않기를 요구하는데, C8의 버전 올리기가 버전
문자열을 박아 둔 기존 검사 셋을 함께 움직인다. 바뀐 줄은 아래 넷이고, 어느 것도 검증 의도를
약화시키지 않는다. 판정 규칙을 보는 검사는 한 줄도 고치지 않았다.

- `condition_script_version: 21` → `22` 단언 1줄, 이전 버전 픽스처 1줄, 오류 문구 1줄.
- 프로세스 예산 상수 셋. 위 7번의 실측에서 다시 세웠다.

더한 것은 셋이다. `EXCLUSION_CODES`에 새 사유 코드 두 개(두 본문이 같은 어휘를 갖는지 보는 유일한
정적 장치다), `WIDENED_SCENARIOS`에 단독 판정 행 세 개(이 표가 Windows 러너에서 PowerShell 본문을
돌리므로 그쪽 회귀를 여기서만 잡는다), 손으로 `WorkflowInput`을 세우는 기존 검사 하나에 새 필드 1줄.

## 남은 위험

- PowerShell 본문은 이 기기에서 한 번도 실행되지 않았다. 문법 검사조차 돌리지 못했고(설치된
  PowerShell이 없다), 그 본문의 판정은 `WIDENED_SCENARIOS`가 Windows 러너에서 도는 것으로만
  덮인다. 셸 본문과 갈라졌다면 CI의 windows-latest 잡에서 처음 드러난다.
- 단독 선언이 있는 프로젝트에서는 세 역할이 모두 개발자 후보 훑기를 한 벌씩 더 치른다. 그 비용은
  프로세스 예산 픽스처가 재지 않는다(픽스처에 선언이 없다). 선언이 없는 프로젝트의 비용만 고정돼
  있고, 있는 프로젝트의 판정 시간은 측정되지 않았다.
- 기기 전체가 조용한지는 이 판정이 알 수 없다. 프로젝트 밖에서 도는 세션은 lease 디렉터리에
  나타나지 않으므로, 다른 프로젝트의 부하는 그대로 남는다(기획서 R4, 이번 그룹 범위 밖).

## 후속 작업

- 위 두 번째 위험을 재는 일. 선언이 있는 픽스처로 프로세스 예산을 한 번 재어 두면 그 경로의
  회귀도 잡힌다. 이 작업의 완료 조건이 요구하지 않아 손대지 않았다.
- 세션 진행 중 제품 파일 편집 일부가 공유 작업 공간에 잘못 떨어졌다가 되돌려졌다. 남은 흔적은
  없고(통합 전 `git checkout`으로 원복, 이후 `git status`로 확인) 통합된 내용도 격리 사본에서
  검사를 통과한 것과 같은 커밋이지만, 사실로 기록해 둔다.
