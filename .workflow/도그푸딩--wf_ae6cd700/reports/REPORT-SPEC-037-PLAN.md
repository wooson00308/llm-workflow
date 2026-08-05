# SPEC-037 기획자 핸드오프

- 대상: IDEA-A44C6F75 (하트비트 데몬의 설치·업데이트를 앱이 직접 실행)
- 산출: SPEC-037 `앱이 하트비트 설치와 업데이트를 대신 실행한다` (`status: user_review`)
- 역할: 기획자 (planner-claude)
- 선점: `acquire IDEA-A44C6F75 planner-claude 30` exit 0 → `lease-4061-20260805013711` →
  skeleton(`status: draft`, 2026-08-05T01:40:00Z) → 본문 작성 → `user_review` → `release` exit 0.
  중간에 `renew ... 30` exit 0 1회.

## 대상 선정

- `sh .workflow/rules/wf-eligible.sh planner` → `eligible`, exit 0.
- 미답 수정 요청 없음. `decisions/`의 `workflow-labs/decision@1` 중 `outcome: revision_requested`는
  DECISION-FEB99DAB(SPEC-010)·DECISION-2F71D20D(SPEC-014) 둘이고, 둘 다 `specs/`의
  `source_decision_id`에 이미 실려 있다. 그래서 미처리 아이디어로 내려갔다.
- 미처리 아이디어는 IDEA-A44C6F75 하나. `ideas/` 35건 중 `specs/`의 `source_idea_id`가 가리키지 않는
  것이 이것뿐이다.
- 착수 시점 `.workflow/.runtime/leases/`는 셋 다 만료였다 — IDEA-886DAB21(`2026-08-05T00:25:31Z`),
  SPEC-009(`2026-08-03T01:20:00Z`), TASK-104(`2026-08-04T19:37:05Z`). 판정 시각 2026-08-05T01:37Z.
- `.workflow/.runtime/migration.lock` 없음.

## 기획서가 선 자리

이 아이디어는 SPEC-034 R5(`앱이 갱신을 대신 실행하지 않는다`)를 뒤집는다. SPEC-034는 승인된
기획서이고(DECISION-3ECEDCA1, `created_by: user`, 2026-08-04T16:56:16Z), 뒤집는 근거는 아이디어
등록 경위에 적힌 2026-08-05 사용자 결정 하나다. 아이디어가 "실행형 자체를 되묻지 않아도 된다"를
명시했으므로 확인 필요는 실행형의 형태에만 썼다.

## 아키텍트가 먼저 확인할 것

1. **데몬 계약이 아직 착지하지 않았다.** 기획서 확인 사실 4~7이 그 상태다. `heartbeat update`·
   `heartbeat --version`·`state.json`의 `_daemon.version`은 claude-heartbeat **작업 트리**에만 있고
   (`update.py`는 untracked, 아홉 파일이 미커밋), `docs/config-contract.md`(84줄)에는 `update` 절도
   버전 절도 없다. 기획서가 인용한 종료 코드·`key=value` 어휘는 계약 문서가 아니라 소스를 직접 읽어
   확인한 값이다. 확인 필요 5번이 이 순서를 사용자 결정으로 올린다 — 승인 내용에 따라 작업 착수
   시점 자체가 달라진다.
2. **이 기기에서 실행 경로가 거의 늘 실패한다.** 앱의 실행 파일 후보는 PATH와 `~/.local/bin` 둘인데
   (`heartbeat_process.rs`) 이 기기의 실행 파일은 pyenv 아래다(SPEC-034 확인 사실 10). 확인 필요
   4번의 승인 내용이 이 기능의 실제 값에 크게 걸린다.
3. **TASK-107~109가 셋 다 `qa_waiting`이다.** SPEC-034의 안내 UI는 사용자 QA를 통과하지 않았고,
   R6과 확인 필요 6번이 그 UI의 존재를 전제로 쓰였다.

## 역할 밖 발견 (고치지 않고 남김)

- `specs/SPEC-036.md`가 본문 `작성 중입니다` 한 줄뿐인 `status: draft`다. IDEA-886DAB21을 선점한
  세션(`tl-plan-toggle`)이 뼈대만 쓰고 끝났고 그 lease는 2026-08-05T00:25:31Z에 만료됐다.
  `.workflow/rules/roles/planner.md`의 자격 판정은 "어떤 기획서가 `source_idea_id`로 가리키면
  처리된 것"이므로, **이 뼈대가 IDEA-886DAB21을 앞으로도 계속 처리됨으로 만든다.** 뒤에 오는 기획자
  세션은 그 아이디어를 대상으로 잡지 못한다. 이 세션의 대상이 아니라 손대지 않았다.
  SPEC-037 확인 필요 3번이 이 공백(재기동·정지와 라이브 세션의 규칙이 아직 없음)을 사용자 결정으로
  올려 두었다.
- `.workflow/rules/wf-eligible.sh`가 커밋되지 않은 수정 상태다(git status `M`). 규칙 디렉터리는 앱
  소유라 읽기만 했다.
