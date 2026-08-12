# TASK-S051-02 개발 보고서

## 결정권자 요약

버전화된 JSON 계약으로 프로젝트별 설정과 비어 있는 실행 상태를 조회할 수 있다.
설정은 런타임 저장소에 원자적으로 보관되며 프로젝트 사이에 섞이지 않는다.
지원하지 않는 버전과 정책 값은 저장 전에 거절하고 비밀값은 저장 경로에 넣지 않는다.
동시 저장과 기존 기능을 포함한 자동 검사를 통과했으며 사용자는 명령 결과로 확인할 수 있다.

## 변경 파일과 모듈

- `agent_contract.py`, `providers/base.py`, `providers/__init__.py`: API 버전, 역할·provider·실행 방식,
  실행 상태, 실패 단계와 보수적인 기본 정책을 정의하고 설정을 검증한다.
- `agent_store.py`: SQLite WAL, 스키마 버전, 프로젝트별 설정·큐·실행·이벤트·오류 테이블과 원자적
  설정 저장을 추가했다. 첫 동시 기동의 WAL 잠금은 짧게 재시도한다.
- `agent_cli.py`, `cli.py`: `heartbeat agent`의 계약 조회, 설정 검증·저장·조회, 상태 조회를 JSON
  한 줄 응답으로 연결했다. provider 프로세스나 dispatcher는 시작하지 않는다.
- `agent-runtime-contract.md`: 앱이 사용할 요청·응답, 기본 상한, 보존 정책과 내부 저장소 비의존 원칙을
  문서화했다.
- `test_agent_contract.py`, `test_agent_store.py`, `test_agent_cli.py`: 잘못된 요청의 무저장, 비밀값
  비노출, 프로젝트 격리, 동일·서로 다른 프로젝트의 동시 저장, CLI 왕복을 검증했다.

## 검증 절차와 결과

- `pytest tests/test_agent_contract.py tests/test_agent_store.py tests/test_agent_cli.py -v` 통과: 27 passed.
- 동일 프로젝트 동시 저장 검사를 세 번 반복해 모두 통과했다.
- `heartbeat agent contract`, 설정 저장, 상태 조회를 임시 저장소에서 수동 실행해 JSON 응답을 확인했다.
- `python -m compileall -q src/heartbeat`와 `git diff --check`를 통과했다.
- `pytest tests/ -q -k 'not test_parse_heartbeat_md_max_per_field'` 통과: 163 passed, 7 skipped, 1 deselected.

## 남은 위험

- 전체 `pytest tests/ -v`는 기존 quota 파서 검사 한 건이 실패한다. 이 검사는 사용자 jobs.d를 격리하지
  않아 첫 잡을 잘못 선택하며, 이번 작업의 파일과 무관하므로 수정하지 않았다.
- 실행 계획, provider 프로세스, 예약, 로그와 보존 정리는 후속 작업 범위다. 현재 상태 조회는 의도적으로
  빈 큐·실행·오류만 반환한다.

## 후속 작업

- 작업 문서의 명령 이름과 입력 객체가 충분히 구체적이지 않아, 연결된 SPEC-051의 버전화된 CLI 통신
  요구를 확인한 뒤 현재 계약 형태를 정했다.
- 후속 provider와 dispatcher 작업은 이 계약의 지원 명령과 프로젝트 저장 경계를 사용하면 된다.
