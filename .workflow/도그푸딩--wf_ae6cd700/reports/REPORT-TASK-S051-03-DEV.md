# TASK-S051-03 개발 보고서

## 결정권자 요약

Claude와 Codex 명령행 도구를 같은 실행 계약으로 구현했다.
설치와 로그인과 권한과 지원 버전 문제를 구분하고, 진행·도구·종료 결과를 공통 이벤트로 바꾼다.
작업 지시와 인증 정보는 실행 인자와 결과에서 제외하며, 취소와 시간 초과는 자식 프로세스까지 정리한다.
전용 자동 검사와 알려진 기존 격리 문제를 제외한 전체 회귀 검사를 통과했으므로 사용자의 확인을 요청한다.

## 변경 파일과 모듈

- `src/heartbeat/providers/process.py`: provider 공통 인터페이스, 안전한 진단, 민감정보 제거, JSONL
  이벤트 처리, 분리된 프로세스 그룹과 취소·시간 초과 시 자식 프로세스 정리를 구현했다.
- `src/heartbeat/providers/claude.py`: `claude -p --output-format stream-json --verbose` 실행과 Claude
  인증·이벤트 정규화를 구현했다. API 과금 경로 환경 변수가 있으면 명시적 확인 전 실행하지 않는다.
- `src/heartbeat/providers/codex.py`: `codex exec --json --sandbox workspace-write` 실행과 Codex
  인증·thread·turn·item 이벤트 정규화를 구현했다.
- `src/heartbeat/providers/__init__.py`: 두 provider와 공통 실행 타입을 외부에 노출했다.
- `tests/test_agent_providers.py`: 가짜 CLI로 인자와 표준 입력, 진단 구분, 비밀값 제거, 계약 밖 출력,
  사용 제한, 취소·시간 초과 뒤 자식 프로세스 종료를 검증했다.

## 검증 절차와 결과

- `pytest tests/test_agent_providers.py -v` 통과: 13 passed.
- `pytest tests/ -q -k 'not test_parse_heartbeat_md_max_per_field'` 통과: 178 passed, 7 skipped, 1 deselected.
- `python -m compileall -q src/heartbeat` 통과.
- 전체 `pytest tests/ -v`는 178 passed, 7 skipped 뒤 기존 `test_parse_heartbeat_md_max_per_field` 한 건이
  실패한다. 선행 TASK-S051-02 보고서에도 기록된 jobs.d 격리 문제이며, 이번 작업은 해당 파서나 검사를
  수정하지 않았다.

## 남은 위험

- 실제 설치된 Claude·Codex CLI에 대한 계정과 네트워크 기반 실행은 자동 검사에서 호출하지 않았다.
- 전체 회귀의 quota 파서 검사 한 건은 사용자 jobs.d를 격리하지 않아 실패한다. 이번 provider 변경과
  독립적인 기존 문제이므로 수정하지 않았다.

## 후속 작업

- dispatcher와 실행 이력 연결은 범위 밖이다. 후속 작업은 이 provider 인터페이스와 정규화된 이벤트를
  사용해야 한다.
- quota 검사 격리는 별도 작업에서 수정해야 한다.
