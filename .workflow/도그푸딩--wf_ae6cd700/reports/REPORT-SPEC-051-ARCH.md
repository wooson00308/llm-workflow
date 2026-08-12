# SPEC-051 아키텍트 인계 보고서

- 프로젝트: workflow-labs / 활성 워크플로: 도그푸딩
- 역할: 프로젝트 아키텍트
- 대상 승인: DECISION-7DD17262, SPEC-051
- 산출 작업: TASK-S051-01부터 TASK-S051-11까지 11건, 모두 todo
- 제품 코드와 테스트 구현: 수행하지 않음

## 아키텍처 결정

1. 현재 Python Heartbeat를 provider 중립 companion runtime으로 확장한다. 사용자가 Python을 설치하지
   않아도 되도록 PyInstaller one-folder 배포물을 세 운영체제별로 만든다.
2. 앱과 runtime은 로컬 소켓이 아니라 버전화된 JSON CLI로 통신한다. 앱은 고정 인자와 표준 입력만
   사용하며 runtime의 SQLite와 상태 파일을 직접 읽지 않는다.
3. runtime의 프로젝트 설정·큐·실행·이벤트는 SQLite에 저장한다. 실제 작업 디렉터리와 project ID를
   함께 저장하고 slug 역변환을 새 경로에서 제거한다.
4. 자동 배정은 provider 시작 전에 워크플로 관리 예약 도구로 정식 lease를 획득한다. 세션은 넘겨받은
   lease를 갱신해 소유권을 검증하며 병렬 planner·architect 결과에는 lease 기반 식별자 접두어를 쓴다.
5. Claude는 비대화형 stream JSON CLI, Codex는 `codex exec --json`을 사용한다. 두 SDK와 Claude
   Agent SDK는 사용하지 않는다.
6. 앱의 주 기능은 프로젝트 `에이전트` 화면으로 옮긴다. Heartbeat는 고급 런타임 진단 이름으로 남을
   수 있고 Dream은 기존 연동에만 남는다.

## 의존 관계

```text
TASK-S051-01 ───────────────────────┐
                                    ├─ TASK-S051-04 ─ TASK-S051-05 ─ TASK-S051-06 ─ TASK-S051-07 ─ TASK-S051-09 ─┐
TASK-S051-02 ─ TASK-S051-03 ───────┘                                      └─ TASK-S051-08 ────────────────┴─ TASK-S051-10 ─ TASK-S051-11
```

- TASK-S051-01과 TASK-S051-02는 파일이 겹치지 않아 즉시 병렬 진행할 수 있다.
- runtime 저장소 작업은 계약·provider·dispatcher·패키징 순서다. 같은 CLI와 상태 파일을 단계적으로
  확장하므로 직렬화했다.
- 앱 백엔드는 패키지 설치, 설정, 실행 제어 순서다. 공통 명령·도메인·프로세스 모듈이 겹친다.
- 설정 화면은 실행 제어 백엔드와 병렬로 진행할 수 있다. 최종 실행 대시보드는 둘이 모두 끝난 뒤 붙인다.
- 마지막 작업은 두 저장소 release workflow와 최종 화면 검사를 함께 만지므로 전체 종단 게이트다.

## 요구사항 대응

- R1, R10: TASK-S051-06, TASK-S051-09
- R2: TASK-S051-03
- R3, R4, R7, R8: TASK-S051-02, TASK-S051-04, TASK-S051-05
- R5: TASK-S051-01, TASK-S051-04
- R6: TASK-S051-04, TASK-S051-08, TASK-S051-10
- R9: TASK-S051-02, TASK-S051-07, TASK-S051-08
- R11: TASK-S051-03, TASK-S051-08, TASK-S051-10
- R12: TASK-S051-07, TASK-S051-09, TASK-S051-10
- 완료 조건 1~20의 종단 대응: TASK-S051-11

## 저장소 경계

- TASK-S051-02부터 TASK-S051-05까지는 `../../Git/claude-heartbeat`를 수정한다. `scope_files`에는
  프로젝트 루트 기준 상대 경로를 정확히 선언했다.
- 나머지 작업은 workflow-labs 저장소를 수정한다. 두 저장소를 함께 만지는 것은 최종 계약·릴리스
  검증 작업 하나뿐이다.
- 외부 저장소 작업을 실행하는 개발 세션은 해당 경로의 쓰기 권한과 두 저장소의 git 상태를 별도로
  확인해야 한다. 커밋도 저장소별로 분리한다.

## 확인한 현재 계약

- 설치된 Claude CLI는 `-p`, `--output-format stream-json`, `--verbose`, `auth status --json`을 제공한다.
- 설치된 Codex CLI와 현재 공식 수동 문서는 `codex exec --json`, `--sandbox workspace-write`, `-C`,
  stdin prompt, `codex login status`를 제공한다.
- 현재 Heartbeat는 `claude -p`에 고정돼 있고 데몬 밖 `once`가 중복될 수 있다. 새 앱 실행 경로는
  이를 확장하지 않고 runtime queue로 대체한다.
- 현재 Windows Task Scheduler는 로그인 시 시작만 설정한다. 비정상 종료 복구는 TASK-S051-05가
  실제 서비스 정책으로 보강한다.

## 리스크와 인계

1. 독립 실행형 패키징은 target별 서명·공증과 앱 resource 크기를 늘린다. one-folder를 고른 이유는
   서비스의 고정 실행 경로와 원자적 버전 전환을 우선했기 때문이다.
2. runtime 재시작 뒤 자식 프로세스 stdout을 잃지 않으려면 실행별 append-only 이벤트 파일과 offset
   복구가 필요하다. 메모리 pipe만 쓰는 구현은 TASK-S051-04 완료 조건을 충족하지 못한다.
3. 예약 lease를 runtime과 세션이 함께 다루므로 소유자 불일치 정리가 가장 위험하다. runtime은 같은
   lease ID이고 provider 프로세스가 끝난 뒤인 경우만 정리한다.
4. 외부 저장소는 이 workflow-labs 저장소 밖에 있다. 자동 실행 sandbox가 외부 경로 쓰기를 허용하지
   않으면 해당 개발 작업은 권한을 넓히지 말고 구체적 blocker로 보고해야 한다.
5. 실제 provider 계정으로 성공 요청을 보내는 검증은 비용이 발생하므로 CI는 가짜 CLI를 사용하고,
   사용자 QA는 두 provider 각각 한 번의 짧은 실행으로 제한한다.

## 보호 상태

project manifest, workflow manifest, decisions, migration lock, schema version은 변경하지 않았다. 승인된
기획서와 제품 코드도 변경하지 않았다.
