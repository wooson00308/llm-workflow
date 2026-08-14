---
schema: workflow-labs/task@1
id: TASK-112
title: 데몬 계약의 착지를 확인하고 앱이 인용할 표면을 문서에 고정한다
status: verified
source_spec_id: SPEC-037
source_decision_id: DECISION-6C2F2639
scope_files:
- docs/heartbeat.md
updated_at: 2026-08-14T09:08:07.880257+00:00
history:
- at: 2026-08-05T03:25:00Z
  kind: created
- at: 2026-08-05T04:26:15Z
  kind: in_progress
- at: 2026-08-05T04:27:42Z
  kind: blocked
- at: 2026-08-05T05:24:36Z
  kind: in_progress
- at: 2026-08-05T05:28:35Z
  kind: qa_waiting
- at: 2026-08-05T09:08:41.780307+00:00
  kind: completed
- at: 2026-08-14T09:08:07.880257+00:00
  kind: migrated_verified
work_group_id: GROUP-DECISION-6C2F2639
work_group_revision: 1
---

# 데몬 계약의 착지를 확인하고 앱이 인용할 표면을 문서에 고정한다

SPEC-037 R7과 확인 필요 5번의 승인안이 이 작업이다. 이 기획서의 나머지 다섯 작업이 전부 이 작업을
선행으로 둔다 — 승인안이 "개발 작업의 착수는 두 가지가 끝난 뒤로 건다"이므로, 그 착수 조건을 사람의
기억이 아니라 선행 선언이 지키게 한다.

이 작업은 **이 저장소의 제품 코드를 만지지 않고, 데몬 저장소도 고치지 않는다**. 데몬 저장소의 일은
기획서 제외 범위다. 여기서 하는 것은 확인과 인용 두 가지다.

## 착수 조건 두 가지

승인안이 든 그대로다.

1. **(a) 데몬 변경이 커밋됐다.** `update.py`를 포함한 하트비트 쪽 변경이 작업 트리에만 있는 상태가
   아니어야 한다.
2. **(b) `docs/config-contract.md`에 계약이 적혔다.** `heartbeat update`의 출력과 종료 코드,
   그리고 버전 표면(`heartbeat --version`, `state.json`의 `_daemon.version`)이 계약으로 기재돼야 한다.

### 아키텍트 실측(2026-08-05T03:1xZ)

둘 다 아직 아니다. 분해 시점에 `~/Git/claude-heartbeat`에서 확인한 것을 그대로 적는다.

- `git status`: `pyproject.toml`·`src/heartbeat/__init__.py`·`cli.py`·`core.py`·`service/` 넷이 수정
  상태이고 `src/heartbeat/update.py`는 추적되지 않는다. 최신 커밋은 `25e372e commit`.
- `docs/config-contract.md`는 84줄이고 `update`·`version`·`_daemon` 어느 문자열도 없다.

즉 이 작업을 지금 착수하면 (a)·(b) 모두 미충족이다. 실측을 다시 하는 것이 이 작업의 첫 걸음이고,
아키텍트의 위 관찰을 근거로 판정하지 않는다 — 그 사이에 착지했을 수 있다.

## 미충족일 때

`blocked`으로 두고 무엇이 어떻게 미충족인지(커밋 여부, 계약 문서에서 찾지 못한 절)를 보고서에 적는다.
승인안이 그 대기를 스스로 한계로 적었다: "데몬 쪽 착지가 늦어지면 이 기획서가 승인된 채로 대기한다."

**이 상태는 스스로 풀리지 않는다.** 앱에는 `blocked`을 `todo`로 되돌리는 경로가 없고, 개발자 자격
판정은 `todo`만 후보로 센다. 데몬 쪽이 착지하면 사용자가 이 작업의 `status`를 `todo`로 되돌려야 다시
열린다. 보고서에 그 한 줄을 반드시 남긴다.

문서를 지어내서 통과시키지 않는다. 계약 문서를 이 저장소에서 대신 쓰는 것도 (b)의 충족이 아니다 —
그 문서는 데몬 저장소가 소유한다.

## 충족일 때 쓰는 것

`docs/heartbeat.md`에 절 하나를 더한다. 제목은 "앱이 의존하는 데몬 표면"이고, 다음 다섯을 적는다.

1. `heartbeat update` — stdout의 `key=value` 어휘(`step`·`status`·`detail`, 마지막 `result` 줄),
   `result`의 세 값, 종료 코드 목록. 계약 문서가 적은 값을 그대로 옮긴다.
2. `heartbeat --version` — 출력 한 줄의 모양.
3. `state.json`의 `_daemon.version` — 도는 데몬의 버전이 실리는 자리.
4. `heartbeat init` — 설치 2단계. 계약에 종료 코드의 의미가 없으면 **"0/비0만 쓴다"고 적는다.**
5. `heartbeat install-service` — 설치 3단계. 같은 규칙이다.

넷째·다섯째가 이 절에서 가장 중요한 자리다. 계약 문서가 두 명령의 종료 코드를 의미별로 적지 않았다면
앱은 그것을 원인별 문구로 번역할 근거가 없고, 그 사실이 여기 적혀야 TASK-114가 무엇을 해도 되는지가
정해진다. 반대로 계약이 그 의미를 적었다면 그것을 옮긴다.

절에는 확인한 계약 문서의 커밋 해시와 확인 일자를 함께 적는다. 뒤의 작업들이 "그때 무엇이 계약이었나"
를 이 절에서 읽는다.

## 완료 조건

1. (a)와 (b)를 실측으로 확인했고, 그 근거(커밋 해시, 계약 문서의 해당 절과 줄 번호)가 보고서에 있다.
2. `docs/heartbeat.md`에 위 다섯 표면을 적은 절이 있고, 각 항목이 계약 문서의 어느 자리를 인용한
   것인지 밝힌다.
3. 계약 문서에 없는 값을 이 절이 계약처럼 적지 않는다. 없는 것은 없다고 적는다.
4. 이 저장소의 소스 코드와 테스트가 한 줄도 바뀌지 않는다. `npm run check`와
   `cargo test --manifest-path src-tauri/Cargo.toml`이 변경 전과 같은 결과를 낸다.

## 검증 절차

1. 데몬 저장소에서 `git status --short`와 `git log --oneline -1`을 실행해 (a)를 판정하고 출력을
   보고서에 붙인다.
2. `docs/config-contract.md`에서 `update`·`--version`·`_daemon`을 찾아 (b)를 판정한다. 찾은 절의
   줄 번호를 보고서에 적는다.
3. `npm run check`, `cargo test --manifest-path src-tauri/Cargo.toml`.

## 범위 파일

- `docs/heartbeat.md` — 인용 절 하나를 더한다. 기존 절의 문구는 건드리지 않는다.

데몬 저장소의 파일은 `scope_files`에 없고 이 작업이 쓰지 않는다. 읽기만 한다.
