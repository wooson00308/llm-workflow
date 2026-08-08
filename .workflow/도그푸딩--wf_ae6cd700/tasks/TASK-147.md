---
schema: workflow-labs/task@1
id: TASK-147
title: 런타임과 서비스의 기기 상태 및 업데이트 계약을 제공한다
status: todo
source_spec_id: SPEC-054
source_decision_id: DECISION-DC3ED4B7
depends_on: [TASK-S051-02, TASK-S051-05]
scope_files: [../../Git/claude-heartbeat/docs/runtime-management-contract.md, ../../Git/claude-heartbeat/src/heartbeat/agent_cli.py, ../../Git/claude-heartbeat/src/heartbeat/agent_contract.py, ../../Git/claude-heartbeat/src/heartbeat/agent_store.py, ../../Git/claude-heartbeat/src/heartbeat/cli.py, ../../Git/claude-heartbeat/src/heartbeat/legacy_migration.py, ../../Git/claude-heartbeat/src/heartbeat/runtime_management.py, ../../Git/claude-heartbeat/src/heartbeat/service/__init__.py, ../../Git/claude-heartbeat/src/heartbeat/service/base.py, ../../Git/claude-heartbeat/src/heartbeat/service/launchd.py, ../../Git/claude-heartbeat/src/heartbeat/service/systemd.py, ../../Git/claude-heartbeat/src/heartbeat/service/task_scheduler.py, ../../Git/claude-heartbeat/tests/test_agent_runtime_management.py]
updated_at: 2026-08-07T16:08:52Z
history:
  - { at: 2026-08-07T16:08:52Z, kind: created }
---

# 런타임과 서비스의 기기 상태 및 업데이트 계약을 제공한다

## 결정권자 요약

앱은 설치 버전, 실제 실행 버전과 서비스 생존 상태를 한 계약으로 조회한다.
조회와 업데이트 계획은 파일이나 서비스를 바꾸지 않고 영향받는 실행과 프로젝트를 먼저 보여 준다.
확인 뒤 상태가 달라지면 적용을 멈추고 새 영향 범위를 다시 확인하게 한다.
업데이트 결과는 검증부터 서비스 전환까지 각 단계를 구분하고 현재 실행 가능한 버전을 남긴다.
세 운영체제는 같은 의미를 사용하며 플랫폼 고유 정보는 진단 세부 정보에만 둔다.
사용자는 격리된 서비스 검사에서 무쓰기 조회와 실패 시 기존 버전 보존을 확인하면 된다.

## 목적

SPEC-054의 R5부터 R7까지를 구현한다. TASK-S051-05가 만든 독립 실행형 배포물, stable launcher와 세
운영체제 서비스 어댑터 위에 앱이 소비할 기기 단위 조회, 업데이트 계획과 단계별 적용 결과를 추가한다.
앱이 내부 상태 파일, SQLite, 서비스 등록 파일이나 운영체제 명령 출력을 직접 읽지 않게 한다.

## 현재 상태

- TASK-S051-02의 agent JSON 계약은 프로젝트 설정과 상태 조회를 제공하지만 기기 전체 설치·서비스
  상태와 업데이트 영향 계약은 제공하지 않는다.
- TASK-S051-05는 manifest 검증, 버전 디렉터리, stable launcher와 서비스 설치·탐지·재시작 기반을
  구현해 품질 확인 대기 상태다.
- 현재 서비스 탐지는 문자열 또는 플랫폼별 명령 결과에 가깝다. 등록 여부, 실제 실행 여부, 식별자,
  확인 불가와 복구 가능 여부를 같은 의미로 반환하지 않는다.
- TASK-S051-06의 Tauri 설치·업데이트 서비스와 화면은 이 작업 범위 밖이다. 이번 작업은 그 백엔드가
  고정 인자와 JSON만으로 호출할 runtime 측 계약을 제공한다.

## 기계 계약

### 읽기 전용 상태 조회

- 버전화된 `runtime inspect` 요청은 설치된 런타임 버전, 실제 실행 중 버전, API 주 버전, target과
  호출 앱의 호환 판정에 필요한 값을 한 JSON envelope로 반환한다.
- 서비스 상태는 등록 여부, 실행 여부, 운영체제가 아는 식별자, 실제 실행 경로, 마지막 확인 시각,
  복구 가능 여부와 확인 출처를 반환한다.
- stale PID나 마지막 시작 기록만으로 실행 중이라고 판단하지 않는다. 실제 확인값, 확인하지 못한 값과
  권한 때문에 확인할 수 없는 값을 구분한다.
- 등록 없음, 실행 파일 없음, 여러 등록물이 있어 모호함, 권한 부족, 지원하지 않는 플랫폼·버전을
  서로 다른 코드와 단계로 반환한다.
- 조회 전후의 runtime 파일, launcher, 서비스 정의, SQLite와 프로젝트 설정 해시가 같아야 한다.

### 업데이트 계획

- 읽기 전용 `plan update`는 대상 버전과 target, manifest 검증 결과, launcher 전환, 서비스 재시작·
  재등록 필요 여부, 실패 시 복구 가능성을 반환한다.
- AgentStore가 아는 현재 실행 중 작업 수와 중복 없는 프로젝트 식별자 목록을 반환한다. 실행 세부 이벤트,
  prompt, 도구 출력, 인증 정보는 포함하지 않는다.
- 계획 식별자는 대상 manifest, 현재 설치·실행 버전, 서비스 신원과 영향 실행 스냅샷을 묶은 지문이다.
  실행 중 작업이 없어도 계획과 적용은 분리한다.
- 계획은 파일, launcher, 서비스와 SQLite를 변경하지 않는다. 읽지 못한 사실을 정상값으로 채우지 않는다.

### 업데이트 적용과 복구

- `apply update`는 직전 계획 식별자와 사용자 확인을 요구하고 적용 직전에 같은 사실을 다시 읽는다.
  지문이 달라지면 아무것도 쓰지 않고 새로운 계획을 요구한다.
- 적용 결과는 manifest 검증, 새 버전 설치, stable launcher 전환, 서비스 재시작 또는 재등록, 실행
  버전 확인을 정해진 단계와 순서로 반환한다.
- 검증이나 설치가 실패하면 launcher와 서비스가 바뀌지 않는다. launcher 전환 뒤 서비스 단계가
  실패하면 현재 실행 가능한 버전, 성공·실패 단계와 사용자가 수행할 복구 행동을 반환한다.
- 세 운영체제는 같은 상태, 단계와 오류 코드를 사용한다. launchd, systemd와 Task Scheduler 이름이나
  명령 출력은 선택적 진단 세부 정보에만 둔다.
- 적용은 실행 중 작업을 자동 종료하지 않는다. 영향이 남아 있는 계획은 사용자가 확인했더라도 정책이
  허용한 행동만 수행하고, 확인 범위를 넘어선 종료를 만들지 않는다.

## 저장과 호환성 경계

- 기존 manifest와 stable launcher 형식은 재사용하고 새 앱 전용 사본을 만들지 않는다.
- 서비스 어댑터는 구조화된 inspect를 제공하되 기존 설치·해제·재시작 공개 동작을 유지한다.
- 새 계약은 API 주 버전의 하위호환 규칙을 따르고 모르는 선택 필드는 무시할 수 있게 문서화한다.
- Dream, 기존 editable checkout 업데이트와 일반 jobs.d 실행은 상태 판정과 적용 대상에 섞지 않는다.
- 실제 앱 resource 설치, Tauri 명령과 설치·업데이트 화면은 구현하지 않는다.

## 완료 조건

1. 기기 조회가 설치 버전, 실행 버전, API 호환 정보, target, 서비스 등록·실행, 식별자, 확인 시각과
   복구 가능 여부를 한 JSON 응답으로 반환한다.
2. 등록 없음, stale PID, 여러 등록물, 실행 파일 없음, 권한 부족과 지원하지 않는 플랫폼·버전이 서로
   다른 결과로 구분된다.
3. 조회와 계획 전후에 runtime 파일, launcher, 서비스, SQLite와 프로젝트 설정이 바뀌지 않는다.
4. 업데이트 계획이 실행 중 전체 작업 수와 프로젝트 식별자 목록을 반환하고 prompt, 이벤트 원문,
   도구 출력과 인증 정보는 포함하지 않는다.
5. 실행 중 작업이 없어도 계획 식별자와 사용자 확인 없이 적용할 수 없다.
6. 계획 확인 뒤 실행 집합, 서비스 신원, 설치 버전이나 manifest가 바뀌면 적용은 0단계에서 중단되고
   새 계획을 요구한다.
7. manifest 검증 실패와 설치 실패에서 기존 launcher와 서비스가 유지된다.
8. 서비스 전환이 부분 실패하면 전체 성공으로 표시하지 않고 단계별 결과, 현재 실행 가능 버전과 복구
   행동을 반환한다.
9. macOS, Linux와 Windows의 가짜 또는 격리 서비스 검사에서 계약 필드, 상태와 단계 의미가 같다.
10. 앱이 필요한 모든 사실을 JSON으로 얻을 수 있고 SQLite, plist, unit 파일과 Task Scheduler 출력을
    직접 파싱할 필요가 없다.
11. 기존 runtime manifest, 서비스 설치·탐지·재시작과 일반 Heartbeat 회귀 검사가 통과한다.
12. 기존 자동 검사를 삭제하거나 약화하지 않는다.

## 검증 절차

1. `pytest tests/test_agent_runtime_management.py -v`를 실행한다.
2. 설치 없음, 정상 실행, stale PID, 중복 등록, 실행 파일 없음과 권한 부족 픽스처의 JSON을 대조한다.
3. 조회와 계획 전후에 설치 루트, launcher, 서비스 픽스처, SQLite와 설정의 해시가 같은지 확인한다.
4. 두 프로젝트의 실행을 저장한 뒤 영향 수와 프로젝트 목록을 확인하고 비밀 문자열이 응답에 없는지
   검색한다.
5. 계획 뒤 실행 추가, 서비스 식별자 변경, manifest 변경과 설치 버전 변경을 각각 주입해 적용이 쓰기
   전에 거절되는지 확인한다.
6. 검증 실패, 설치 실패와 서비스 재시작 실패를 주입해 기존 launcher 보존과 단계별 복구 결과를
   검사한다.
7. launchd, systemd와 Task Scheduler 가짜 어댑터에 같은 표를 적용해 공통 상태와 플랫폼 진단을
   구분한다.
8. `pytest tests/test_agent_contract.py tests/test_agent_cli.py tests/test_agent_runtime_management.py tests/test_service.py tests/test_agent_package.py -v`를 실행한다.
9. `pytest tests/ -v`를 실행한다.

## 범위와 선행

TASK-S051-02의 agent 계약·저장소와 TASK-S051-05의 패키징·서비스 기반을 사용하므로 두 작업이 선행한다.
TASK-146과 파일이 겹치지 않아 병렬로 진행할 수 있다. TASK-S051-06의 앱 설치 서비스 파일은 수정하지
않으며, 이후 사용자가 이 작업의 검증 근거를 확인하고 원래 작업을 재개한다.
