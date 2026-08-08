# TASK-S051-05 개발 보고서

## 결정권자 요약

사용자 품질 확인이 요구한 기계 판독용 조회를 기존 조회 명령을 넓혀 구현했다.
이름이 다른 두 번째 조회 명령은 만들지 않았고, 그 사실을 검사로 고정했다.
한 번 호출로 설치 버전, 실행 중 버전, 서비스 등록·실행 상태, 복구 가능 여부와 판단 근거를 받는다.
등록 없음, 실행 파일 없음, 등록물 중복, 권한 부족, 지원하지 않는 플랫폼과 버전이 서로 다른 결과다.
확인하지 못한 값과 권한 때문에 확인할 수 없는 값은 실행 중으로 올라가지 않는다.
세 운영체제 서비스 어댑터가 같은 필드를 같은 뜻으로 채우며 조회는 아무것도 바꾸지 않는다.
전용 자동 검사 16건을 더했고 알려진 기존 실패 한 건을 제외한 전체 회귀 검사를 통과했다.
사용자의 확인을 요청한다.

## 재작업 범위

QA-7C6AA0E3의 요구 하나만 다뤘다. 이미 확인받은 패키징, stable launcher 전환, 마이그레이션 결과는
설계도 코드도 건드리지 않았다. 범위 밖인 `agent_cli.py`와 `agent_contract.py`는 수정하지 않았고,
API 주 버전 상수만 기존처럼 가져다 썼다.

## 변경 파일과 모듈

- `src/heartbeat/service/base.py`: 구조화된 조회 결과 `ServiceStatus`와 결과 어휘 일곱 개, 복구 가능
  판정 규칙, 조회 시각 helper를 넣었다. `inspect`를 어댑터 공통 인터페이스에 추가했다.
- `src/heartbeat/service/launchd.py`: 등록물 목록, plist의 실행 경로, `launchctl list`의 PID로
  등록·실행을 판정한다. 등록물이 둘 이상이면 모호로 남기고 하나를 고르지 않는다.
- `src/heartbeat/service/systemd.py`: unit의 `ExecStart` 경로와 `systemctl --user is-active`로
  판정한다. 사용자 버스에 붙지 못하면 권한 부족으로 남기고 실행 여부를 추측하지 않는다.
- `src/heartbeat/service/task_scheduler.py`: 등록 여부는 `schtasks /query`, 실행 경로는 같은 명령의
  XML 출력에서 읽는다. 실행 여부는 로케일 의존 출력이라 모른다고 답한다.
- `src/heartbeat/service/__init__.py`: `inspect_service`를 더했다. 어댑터가 없는 플랫폼도 같은 모양으로
  답한다.
- `src/heartbeat/legacy_migration.py`: stable launcher를 읽어 설치 버전과 target, API 주 버전을 얻는
  `installed_runtime`과, 등록물의 실행 경로를 버전으로 바꾸는 `runtime_version_of`를 더했다. 둘 다
  읽기만 한다.
- `src/heartbeat/cli.py`: `runtime inspect`의 응답을 위 사실로 넓히고 `--install-root`를 더했다.
  응답 조립은 `runtime_status` 한 함수에 두어 검사가 직접 부를 수 있게 했다.
- `docs/agent-runtime-contract.md`: `기기 상태 조회` 절에 응답 예시와 필드 뜻, 결과 어휘, 읽기 전용
  보장을 적었다.
- `tests/test_service.py`, `tests/test_agent_package.py`: 검사 16건을 더했다.

## 설계 판단

- 세 가지 버전을 서로 다른 사실로 분리했다. 이 호출에 답한 실행 파일의 버전, stable launcher가 가리키는
  설치 버전, 그리고 서비스가 실행 중임을 확인했고 그 등록물의 경로에서 버전을 읽어낸 실행 중 버전이다.
  마지막 값은 확인하지 못하면 비운다. 하나로 나머지를 추측하지 않는 것이 이 요구의 핵심이다.
- 등록과 실행은 참·거짓·모름 세 값으로 뒀다. 오래된 PID나 등록 사실만으로 실행 중이라고 답하지 않기
  위해서다. 복구 가능 판정도 같은 규칙을 따라 확인하지 못했으면 비운다.
- 등록물이 여러 개면 복구 가능을 거짓으로 둔다. 무엇을 재기동할지 정할 수 없는 상태에서 하나를 고르면
  데몬이 둘 뜨는 기존 문제가 다시 생긴다.
- Windows의 실행 여부는 돌려주지 않는다. Task Scheduler의 상태 문자열이 로케일에 따라 달라 계약 값으로
  파싱할 수 없다. 기존 재기동 구현이 같은 이유로 상태 파싱을 피하고 있어 그 판단을 유지했다.
  실행 경로는 XML 태그에서 읽으므로 로케일 영향을 받지 않는다.

## 검증 절차와 결과

- `pytest tests/test_service.py tests/test_agent_package.py -q` 통과: 26 passed, 7 skipped. 건너뛴
  7건은 이전부터 있던 플랫폼 전용 검사다.
- `pytest tests/ -q -k 'not test_parse_heartbeat_md_max_per_field'` 통과: 253 passed, 7 skipped,
  1 deselected. 재작업 전 같은 명령은 237 passed였고 늘어난 16건이 이번 추가분이다.
- 전체 `pytest tests/ -q`는 1 failed, 253 passed, 7 skipped이며 실패는 기존
  `test_parse_heartbeat_md_max_per_field` 한 건이다. 이번 변경과 무관한 jobs.d 격리 문제다.
- `python -m compileall -q src/heartbeat` 통과, 변경한 파일의 `ruff check` 통과.
- 조회 전후 해시 비교는 자동 검사 두 건이 수행한다. 설치 루트, launcher, 서비스 정의 픽스처, 가짜
  데이터베이스를 모두 포함해 비교했다.

## 남은 위험

- 검증은 macOS에서만 실행했다. systemd와 Task Scheduler 경로는 가짜 명령 출력으로 검사했고 실제 두
  운영체제에서 돌리지 않았다.
- Windows는 실행 여부를 모른다고만 답한다. 앱이 실행 중 여부로 화면을 가른다면 그 플랫폼에서는 다른
  근거가 필요하다.
- 권한 부족 판정은 명령의 영어 출력 문구에 기댄다. 로케일이 다르면 등록 없음으로 분류될 수 있다.
- 이번 재작업은 조회만 다뤘다. 완료 조건 1부터 13까지의 실제 배포물 빌드와 세 운영체제 서비스 통합
  확인은 이전 확인분 그대로이며 이번에 다시 실행하지 않았다.

## 후속 작업

- TASK-147은 이 응답을 그대로 이어받아 계획과 적용 단계를 얹으면 된다. 필드 이름과 뜻은 계약 문서의
  `기기 상태 조회` 절에 적어 두었다.
- 권한 부족 판정을 문구 대신 종료 코드나 다른 신호로 바꾸는 일은 실제 두 운영체제에서 값을 확인한 뒤에
  하는 편이 낫다.
- quota 검사 격리는 여전히 별도 작업이 필요하다.
