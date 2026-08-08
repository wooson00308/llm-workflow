# TASK-S051-05 개발 보고서

## 결정권자 요약

독립 실행형 런타임의 빌드, 무결성 확인, 안전한 전환 경로를 구현했다.
번들 실행 파일에서 계약 조회와 무결성 확인을 실제로 통과했다.
사용자는 세 운영체제 CI 작업과 배포물 확인 동선을 검토하면 된다.

## 변경 파일과 모듈

- Claude Heartbeat 저장소에 PyInstaller one-folder spec, 세 운영체제 CI matrix, 태그 기반 release artifact 흐름을 추가했다.
- 런타임 manifest 생성·전체 해시 검증·원자적 stable launcher 전환과 기존 설치의 읽기 전용 마이그레이션 미리보기를 구현했다.
- standalone CLI가 runtime identity, manifest 검증, launcher 전환, migration preview를 JSON으로 반환하도록 확장했다.
- 서비스 launcher 경로를 우선 사용하도록 하고, Windows Task Scheduler XML에 실패 시 재시작과 중복 실행 방지 정책을 추가했다.
- 패키지 무결성, 변조 거부, launcher 보존, Dream 제외 마이그레이션, Windows 서비스 XML을 검증하는 테스트를 추가했다.

## 검증 절차와 결과

- `python -m pytest tests/test_agent_package.py tests/test_legacy_migration.py tests/test_agent_cli.py tests/test_service.py -q`가 20 passed, 7 skipped로 통과했다.
- `pyinstaller packaging/heartbeat.spec --noconfirm --clean`으로 macOS arm64 one-folder runtime을 실제 생성했다.
- 생성한 번들에서 manifest 생성·검증, `runtime inspect`, `agent contract`, `skills`를 실행해 모두 성공했다. 번들 파일 목록에는 Claude Agent SDK·Codex SDK 경로가 없었다.
- CI와 release workflow YAML은 파싱 검사를 통과했고, 세 대상별 압축 artifact·manifest 검증·번들 계약 조회를 수행하도록 구성했다.
- 전체 `pytest tests/ -q`는 187 passed, 7 skipped, 1 failed였다. `tests/test_quota.py::test_parse_heartbeat_md_max_per_field`의 jobs.d 격리 누출이며, 이 작업은 `core.py`와 quota 테스트를 변경하지 않았다.

## 남은 위험

- 로컬에서는 macOS arm64 번들만 실제 빌드했다. macOS universal·Linux·Windows artifact와 OS 서비스 복구는 새 CI matrix 실행으로 확인해야 한다.
- 전체 테스트의 quota 격리 실패는 기존 테스트 환경 문제로 남아 있다. 이번 작업 범위 밖이므로 수정하지 않았다.
- 실제 서비스의 강제 종료·재로그인 복구와 installer가 stable launcher를 호출하는 종단 동작은 사용자 QA가 세 운영체제에서 확인해야 한다.

## 후속 작업

- CI artifact가 세 대상에서 모두 생성되는지와 release tag가 검증된 zip만 게시하는지 확인한다.
- TASK-S051-06에서 앱 설치기가 manifest 검증 뒤 stable launcher를 전환하고 서비스에 launcher 경로를 전달해야 한다.
- quota 테스트의 jobs.d 격리 문제는 별도 개발 작업으로 다룬다.
