# 판 상태 핸드오프 (TL 스냅샷)

> 다음 세션 팔로업용 정본. 갱신: 2026-08-12.

## 완료된 결과

1. 에이전트 화면을 설정 폼에서 관제 화면으로 교체했다. 자동 배정 여부, 사용자가 확인할 관문, 진행 중, 현재 자격 대기열, 최근 종료만 기본 화면에 남겼다.
2. 자동 배정은 프로젝트별 opt-in이며 기본값은 꺼짐이다. 끄기는 새 자동 시작만 막고 직접 배정과 이미 실행 중인 세션은 유지한다.
3. `no_target`은 정상 대기다. run/error/lease/quota/provider 호출을 만들지 않으며, 수동 지정 대상이 경합으로 사라진 경우만 실행 이력 밖 시작 실패로 답한다.
4. 작업 대기열은 예약 목록이 아니라 전체 역할 자격 판정의 읽기 전용 결과다. 실제 실행 직전에만 다시 판정하고 lease를 잡는다. 프로젝트 간·역할 간 공정 순환은 유지하고 역할 내부 순서는 워크플로 계약을 따른다.
5. `.workflow` 변경 watcher는 500ms debounce로 즉시 재판정하며, 실패하면 기본 5분 안전 확인으로 저하 운행한다. 앱의 2.5초 전체 프로젝트·연동 반복 조회는 제거했다.
6. 연동 메뉴와 Dream 관리 UI/API를 제거했다. 런타임 복구와 기존 역할 잡 이전은 고급 설정으로 이동했고, 외부 Dream 파일은 수정·삭제하지 않는다.
7. 런타임 0.9.0/API 1/schema 5를 앱에 bundle했다. launchd 서비스는 stable launcher의 `agent-dispatcher`를 실행하며 강제 재시작과 앱 종료 뒤에도 복구한다.
8. workflow-labs 구형 역할 잡은 실기 전환으로 제거됐다. mech-arena 잡과 외부 Dream plist는 보존됐다. workflow-labs 자동 배정은 실제 DB에서 OFF다.
9. 모델 선택은 provider 공통 메타데이터·실제 카탈로그를 사용하며, 잘못된 모델과 `limit_reached`·`no_target`을 서로 다른 사용자 안내로 표시한다. 종료된 실행의 경과는 고정 종료 시각을 사용한다.
10. 최신 universal debug 앱은 940px 에이전트 관제 화면에 열려 있다. 고급 설정은 좁은 창에서 overlay sheet로 동작하고 기본 화면에는 원시 JSON·project/lease 식별자가 없다.

## 검증 정본

- claude-heartbeat: 330 passed, 8 skipped; 변경 범위 Ruff 통과.
- workflow-labs 프런트: 24 files, 446 passed·42 skipped; typecheck·production build 통과.
- workflow-labs Rust: 718 lib + 19 e2e; `cargo fmt --check`, Clippy `-D warnings` 통과.
- macOS 실기: service PID 강제 교체 뒤 DB 소유권 일치, runningVersion 0.9.0, 앱 종료 뒤 서비스 유지.
- bundle: 앱·heartbeat·psutil·watchdog 모두 arm64/x86_64, manifest 0.9.0/API 1/macos-universal 검증.
- 1180px·940px 실화면: 헤더 개행·가로 스크롤 없음, 940px drawer sheet 확인.

## 다음 확인

1. 자동 배정은 사용자가 원할 때만 켠다. 현재 OFF이므로 유료 세션이 자동 시작되지 않는다.
2. Linux·Windows 실제 서비스와 앱 bundle smoke, 공식 3OS release 산출물 양성 경로는 target CI 또는 해당 OS 기기에서 확인한다.
3. `.workflow`의 기존 QA·task·report 변경은 사용자/역할 작업이므로 보호한다. 이 직접 구현과 섞어 상태를 소급 수정하지 않는다.
4. main 병합·push·태그·릴리스는 하지 않았다. 릴리스 컷은 별도 승인과 `docs/releasing.md` 절차를 따른다.

## 산출물

- 앱: `/Users/catze/project/workflow-labs/src-tauri/target/universal-apple-darwin/debug/bundle/macos/LLM Workflow.app`
- DMG: `/Users/catze/project/workflow-labs/src-tauri/target/universal-apple-darwin/debug/bundle/dmg/LLM Workflow_0.1.11_universal.dmg`
- 런타임: `/Users/catze/Git/claude-heartbeat/dist/heartbeat`
