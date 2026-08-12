# TASK-147 개발 보고서

## 결정권자 요약

기기 조회 위에 업데이트 계획과 단계별 적용을 얹어 앱이 쓸 계약을 만들었다.
계획은 아무것도 바꾸지 않고 대상 버전, 전환 필요 여부, 영향받는 실행 수와 프로젝트 목록을 돌려준다.
계획 식별자는 계획이 가정한 사실의 지문이라, 기기가 달라지면 적용이 첫 단계 전에 멈춘다.
적용은 다섯 단계를 정해진 순서로 돌려주며 일부만 성공하면 전체 성공으로 표시하지 않는다.
검증이나 설치가 실패하면 기존 launcher와 서비스는 그대로 남는다.
계약이 알리는 명령 목록을 한 곳으로 모았고 그 목록이 곧 라우팅 기준이 된다.
전용 자동 검사 26건을 더했고 알려진 기존 실패 한 건을 제외한 전체 회귀 검사를 통과했다.
범위 밖 검사 한 줄은 지휘 세션의 사전 승인을 받아 현재 사실에 맞게 고쳤다.

## 범위 밖 수정 한 건과 그 승인

`tests/test_agent_contract.py`의 단언 한 줄을 고쳤다. 그 파일은 이 작업의 `scope_files`에 없으므로
지휘 세션에 사실과 선택지를 먼저 보고하고 사전 승인을 받은 뒤에 손댔다. 승인 범위는 이 한 줄로 한정한다.

- 전: `assert "run.start" in description["reservedCommands"]`
- 후: `assert "run.start" in description["implementedCommands"]`와
  `assert "run.start" not in description["reservedCommands"]` 두 줄

근거는 셋이다. 첫째, 그 단언은 이미 사실이 아니다. TASK-S051-04가 `run.start`를 구현했고 지금까지는
`agent_cli.py`가 응답의 목록을 덮어써서 겉으로만 맞아 보였다. 그 덮어쓰기가 바로 완료 조건 13이 없애라고
한 이중 정의다. 둘째, 목록을 한 곳으로 모아 사실과 맞추면 그 단언은 어떤 정직한 구현으로도 통과하지
않는다. 셋째, 그 파일을 `scope_files`로 가진 작업은 TASK-S051-02 하나이고 완료 상태이며, 미완료 소유자와
경합 lease가 없어 동시 편집 충돌 위험이 없었다. 검사를 지우거나 약화하지 않았고 오히려 현재 사실을
고정하는 단언 두 줄로 바꿨다.

## 완료 조건 15의 해석

`이 작업이 더하는 기기 조회와 업데이트 명령도 같은 한 곳의 목록에 나타난다`를 다음으로 읽었다. 명령
목록은 `agent_contract.py` 한 곳에서만 정의하되, 표면이 다른 두 종류를 그 한 곳에서 나눠 적는다.
`implementedCommands`는 표준 입력 JSON으로 부르는 agent 명령이고 여기에 업데이트 두 개가 들어간다.
`runtimeCommands`는 `heartbeat runtime` 명령군이며 기기 조회를 여기에 적는다. 기기 조회를 agent 명령으로
옮기면 같은 사실을 돌려주는 명령이 둘이 되어 완료 조건 16과 TASK-S051-05의 명령 집합 잠금 검사를
어긴다. 이 해석은 지휘 세션의 승인을 받았고, 후속 아키텍트가 다르게 보면 이 문단이 논의의 출발점이다.

## 변경 파일과 모듈

- `src/heartbeat/runtime_management.py`: 새 모듈이다. 기기 사실 읽기, 지문 계산, 읽기 전용 계획,
  단계별 적용과 부분 실패 처리를 담는다.
- `src/heartbeat/agent_contract.py`: 명령 목록의 유일한 정의를 넣었다. agent 명령 열다섯 개와 runtime
  명령 다섯 개를 나눠 적고 예약 목록은 비웠다.
- `src/heartbeat/agent_cli.py`: 목록 덮어쓰기를 없애고 그 목록을 라우팅 기준으로 삼았다. `update.plan`과
  `update.apply`를 봉투 계약으로 노출했다.
- `src/heartbeat/agent_store.py`: 실행 영향 집계를 더했다. 실행 수와 프로젝트 식별자만 나가고 prompt,
  이벤트 원문, 도구 출력은 이 경로로 나가지 않는다.
- `docs/runtime-management-contract.md`: 새 문서다. 목록 정의 자리, 계획과 적용의 요청·응답, 단계 이름과
  결과 어휘, 호환성 경계를 적었다.
- `tests/test_agent_runtime_management.py`: 검사 26건을 더했다.

## 설계 판단

- 기기 조회를 다시 만들지 않았다. 완료 조건 16이 요구한 대로 TASK-S051-05가 만든 `runtime inspect`
  하나만 그 사실을 책임지고, 계획은 같은 서비스 상태 구조를 인용한다. agent 명령 쪽에는 조회를 두지
  않았고, 어떤 표면이 그 사실을 담당하는지는 명령 목록에 `runtimeCommands`로 적었다.
- 지문에 조회 시각을 넣지 않았다. 넣으면 읽을 때마다 값이 달라져 모든 계획이 즉시 낡는다. 대신 대상
  manifest, 설치·실행 버전, 서비스 신원, 영향 실행 목록만 묶었다.
- launcher가 움직이기 전의 실패와 그 뒤의 실패를 다른 결과로 나눴다. 앞은 기기가 그대로이므로 실패이고,
  뒤는 새 버전이 이미 실행 가능하므로 부분 성공에 현재 실행 가능 버전과 복구 행동을 담는다.
- 등록된 서비스가 없으면 전환 단계는 건너뛴 것이지 실패가 아니다. 없는 등록물을 재기동하려다 실패로
  적으면 앱이 복구 행동을 잘못 안내하게 된다.

## 검증 절차와 결과

- `pytest tests/test_agent_runtime_management.py -q` 통과: 26 passed.
- `pytest tests/ -q -k 'not test_parse_heartbeat_md_max_per_field'` 통과: 279 passed, 7 skipped,
  1 deselected.
- 전체 `pytest tests/ -q`는 1 failed, 279 passed, 7 skipped이며 실패는 기존
  `test_parse_heartbeat_md_max_per_field` 한 건이다. 이번 변경과 무관한 jobs.d 격리 문제다.
- `pytest tests/test_agent_contract.py tests/test_agent_cli.py tests/test_agent_runtime_management.py tests/test_service.py tests/test_agent_package.py -q` 통과: 81 passed, 7 skipped.
- 계획과 적용의 무쓰기는 두 가지로 확인했다. 런타임 파일·launcher·서비스 정의 픽스처의 해시 비교와,
  저장소의 실행 행 비교다. SQLite 파일 바이트는 WAL 정리 때문에 읽기만 해도 달라져 논리 행으로 비교했고
  그 근거를 검사 안에 적었다.
- `python -m compileall -q src/heartbeat` 통과, 이번에 만지거나 만든 파일의 `ruff check` 통과.

## 남은 위험

- 검증은 macOS에서만 실행했다. 서비스 어댑터는 가짜 상태로 주입해 세 플랫폼의 단계 의미가 같은지만
  확인했고 실제 systemd·Task Scheduler 전환은 돌리지 않았다.
- 작업 트리에는 아직 커밋되지 않은 TASK-S051-05 결과물이 함께 있다. 두 작업의 범위 파일이 겹치므로
  커밋을 나눌 때 확인이 필요하다.
- 적용의 새 버전 설치 단계는 배포물이 이미 버전 디렉터리에 놓여 있다고 보고 존재와 위치만 검사한다.
  실제 복사와 압축 해제는 앱 설치기의 몫이며 이 계약 밖이다.
- 지문은 서비스 식별자와 실행 경로까지 포함한다. 서비스가 자주 바뀌는 기기에서는 계획을 다시 읽어야 하는
  빈도가 높아질 수 있다.

## 후속 작업

- TASK-S051-06의 앱 백엔드는 이 문서의 요청·응답을 그대로 소비하면 된다. 단계 이름은 합치지 말고 그대로
  쓰는 것이 완료 조건이다.
- 실제 배포물로 세 운영체제 전환을 확인하는 일은 TASK-S051-11의 종단 검증에서 하는 편이 낫다.
- quota 검사 격리는 여전히 별도 작업이 필요하다.
