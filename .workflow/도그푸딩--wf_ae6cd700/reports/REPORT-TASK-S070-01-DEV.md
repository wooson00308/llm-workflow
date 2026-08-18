# TASK-S070-01 개발 보고서

## 결정권자 요약

복구와 업데이트 적용이 시작할 때 앱에 실린 버전의 실행 환경 파일이 기기의 버전 자리에 있는지
먼저 확인하고, 없으면 설치 적용과 같은 검증을 거쳐 놓은 다음 나머지 단계를 이어 가게 했다. 앱을
새 버전으로 올린 직후에도 복구를 한 번 적용하면 실행 환경이 정상으로 돌아오고, 앱을 연 뒤
저절로 진행되는 갱신도 같은 경로를 쓰므로 함께 정상화된다. 파일이 이미 있는 기기에서는 확인만
하고 지나가므로 결과와 소요 시간이 이전과 같다. 검증에 실패하면 버전 자리를 그대로 둔 채 사유를
담아 실패로 끝나고 런타임을 부르지 않는다. 자동 검사는 백엔드 861건과 통합 25건, 화면 505건이
모두 통과했고 형식·정적 분석·빌드도 통과했다. 이 결과는 GROUP-070의 사용자 QA 준비를 뒷받침하는
증거이며, 사용자가 지금 확인할 것은 없다.

## 바꾼 파일과 모듈

- `src-tauri/src/application/agent_runtime_install_service.rs`. 선언한 파일 하나만 고쳤다.
  - `apply_update`. 호환 판정 뒤, `version_directory`가 이미 계산하던 경로에 대해 `is_dir()`로
    존재를 먼저 보고, 없을 때만 `agent_runtime_package::install`을 불러 자산을 검증해 놓는다.
    이어서 지금과 같은 `agent_runtime_process::apply_update` 호출을 하고, 파일을 놓은 경우에만
    결과의 `stages` 맨 앞에 `UpdateStage::VersionInstall` 단계를 `ok`로 넣는다. 실패는
    `InstallFailure::Package`로 돌린다. 함수의 doc 주석에 이 순서를 한 문장 더했다.
  - 시험 모듈. 응답 본문 도우미 `update_applied`와 단계 목록 비교 도우미 `stage_pairs`를 더하고
    C11이 요구한 시험 다섯을 넣었다.

## 구현에서 고른 자리

- 존재 확인을 부르는 쪽에 두었다. `agent_runtime_package::install`은 검증(161행)이 존재
  확인(164행)보다 먼저라, 조건 없이 부르면 이미 설치된 기기가 번들 전체를 매번 해시한다. C4가
  요구한 비용 회피는 부르는 쪽 확인으로만 얻어지고, 이 선택 덕분에 `agent_runtime_package.rs`를
  고치지 않아 선언한 범위 안에 머문다.
- 단계는 `insert(0, ...)`로 앞에 넣었다. 런타임이 돌려준 단계 목록의 순서를 손대지 않고 앞에만
  붙이는 것이 C3이 요구한 모양이며, `result`·`runnableVersion`·`recoveryActions`·`detail`은
  응답 값을 그대로 둔다.
- `repair`는 한 줄 그대로 두었다(C7). 두 경로가 같은 함수를 지나므로 동작이 갈리는 자리가 생기지
  않는다. `plan_update`와 `apply_download`는 본문을 고치지 않았다(C8·C9).

## 검증 절차와 결과

착수 시 격리 사본의 기준은 c3ac512였으나 통합 직전 공유 작업 공간이 167f9ff로 전진해 있어,
후보를 그 커밋 위로 옮기고(rebase) 아래 검사를 다시 돌린 값이다. 후보 커밋은 623821d다.

격리 사본(기준 167f9ff, 후보 623821d)에서 실행했다.

1. `cargo test --manifest-path src-tauri/Cargo.toml agent_runtime_install_service` — 23건 통과,
   실패 0. C11이 요구한 다섯 시험이 모두 들어 있고 통과했다.
2. `cargo test --manifest-path src-tauri/Cargo.toml` — 861건 + 25건 통과, 실패 0. C12가 지목한
   기존 시험 `an_unsupported_api_major_blocks_the_update_before_the_runtime_is_asked_to_apply`와
   `repair_never_touches_the_runtime_database`가 본문 수정 없이 그대로 통과했다.
3. `cargo fmt --manifest-path src-tauri/Cargo.toml --check` — 통과.
4. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` — 통과, 경고 0.
5. `npm run check` — 시험 파일 29개, 505건 통과·42건 건너뜀, 실패 0. 타입 검사와 빌드도 성공.
6. `git status` 확인 — 변경 파일은 선언한 하나뿐이고 `.workflow` 아래에 변경이 없다(C13).

통합은 공유 작업 공간의 `dev`로 fast-forward 했다(167f9ff → 623821d). 통합 직전 `.workflow` 밖
추적 파일 가운데 커밋되지 않은 변경은 하나도 없어 후보가 바꾸는 경로와 겹치는 것이 없었다.

통합 후 같은 커밋 위의 깨끗한 격리 사본에서 다시 실행했다.

- `cargo test --manifest-path src-tauri/Cargo.toml` — 861건 + 25건 통과, 실패 0.
- `cargo fmt --check` — 통과. `cargo clippy --all-targets -- -D warnings` — 통과, 경고 0.
- `npm run check` — 505건 통과, 빌드 성공.

## 남은 위험

- 시험은 `FakeCaller`로 런타임 응답을 흉내 낸다. 실제 launcher가 새로 놓인 버전 디렉터리를 받아
  전환까지 마치는지는 이 작업의 자동 검사가 확인하지 못한다. GROUP-070의 사용자 QA가 볼 자리다.
- 버전 자리가 비어 있는 기기에서 적용 소요 시간이 번들 검증과 복사만큼 늘어난다. 실제 배포물
  크기에서 얼마나 늘어나는지는 재지 않았다.
- 버전 디렉터리가 있지만 그 안이 손상된 기기는 이번 변경이 다루지 않는다. `is_dir()`만 보므로
  내용은 검사하지 않으며, 이는 작업 문서가 정한 범위 그대로다.

## 후속 작업

- 적용 결과의 단계 목록을 화면에 보여주는 일은 SPEC-068과 TASK-S068-01이 맡는다. 이번 변경으로
  `version_install` 단계가 기존 타입 그대로 화면까지 실려 간다.
- 역할 밖 발견은 없다. 작업 문서의 `## 범위 사전 검사`가 지목한 파일과 행 번호는 현재 저장소와
  모두 일치했고, 선언한 파일 하나로 완료 조건이 전부 풀렸다.

예약 식별자: RES-20260818T085523Z-42777-20260818085522
