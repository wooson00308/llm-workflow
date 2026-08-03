# SPEC-003 기획자 핸드오프

- 대상 아이디어: IDEA-225421F7 (dream을 두 번째 연동으로 추가, 연동 공통 구조 추상화)
- 산출 기획서: SPEC-003 (`status: user_review`)
- 세션 역할: 기획자
- 작성 시각: 2026-08-02T04:46:49Z

## 결과

미처리 아이디어 IDEA-225421F7을 선점해 SPEC-003을 작성하고 `user_review`로 올렸다. 요구사항은 R1~R7, 확인 필요 2건, 완료 조건 15개다. 작업 분해도 구현도 하지 않았다.

## 대상 도구 실측 확인

기획서 R2~R6의 근거로 실제 설치본을 읽고 실행해 확인한 사실이다. 추정으로 쓴 항목은 없다.

- `dream`은 `claude-heartbeat` 저장소 안의 스킬이다. 모듈 경로는 `~/Git/claude-heartbeat/skills/dream/`이고 같은 저장소에 `heartbeat-register` 스킬이 함께 있다. 아이디어의 "claude-heartbeat 저장소의 스킬로 설치된다"는 전제가 실제로 성립한다.
- `heartbeat skills`가 설치 여부를 `[✓] dream — dream skill` 형태로 보여주고, `heartbeat install dream [--slug SLUG]`로 설치한다. 스킬 설치본은 `~/.claude/skills/dream/SKILL.md`에 놓인다.
- `dream-prep check-unprocessed --slug SLUG`는 도움말에 `for heartbeat condition`이라고 명시되어 있고 미처리 유무로 exit 0/1을 반환한다. 그래서 dream 잡은 `wf-eligible.sh` 같은 앱 관리 조건 스크립트를 새로 만들 필요가 없다. R4·R5가 조건 스크립트 설치를 요구하지 않는 이유다.
- **`dream-prep status`의 `처리됨`은 "정제 완료 수"가 아니다.** 구현은 `전체 − find_unprocessed_transcripts()`이고, 이 함수는 마킹(`processed` / `processed_v2` `sealed`)뿐 아니라 활성 파일 게이트(mtime quiet 30분, 10MB 강제 처리)까지 적용한다. 이 저장소 slug에서 `status`는 `처리됨: 3`을 보고했지만 `classify`로 확인한 그 3개는 마킹된 파일이 아니라 지금 열려 있는 활성 트랜스크립트였다(해당 slug에는 `dream_meta.md`가 아예 없어 마킹은 0이다). 아이디어 문구를 그대로 따라 이 값을 화면에 옮겼으면 사실과 다른 표시가 됐다. 확인 필요 1번의 핵심 근거다.
- `dream-prep status`에는 JSON 출력 옵션이 없고 출력은 한국어 한 줄이다.
- 정제 메타는 `~/.claude/projects/<slug>/memory/dream_meta.md`(`last_dream`, `last_lint`, `processed_v2:`)이며, 한 번도 정제하지 않은 프로젝트에는 파일 자체가 없다. R3에 "정제 기록 없음"을 오류가 아닌 정상 상태로 넣은 이유다.
- `~/.claude/heartbeat/state.json`에 `dream-catze`, `dream-unity` 기록이 남아 있다. 사용자가 dream 잡을 손으로 구성해 온 이력이 실제로 있으므로 R6의 중복 감지는 가정이 아니라 관측된 위험이다.
- SPEC-002 구현본(`heartbeat_service.rs`, `heartbeat_jobs.rs`, `heartbeat_status.rs`, `heartbeat_condition.rs`, `SettingsView.tsx`)은 전부 파일 읽기 기반이고 외부 명령을 실행하는 경로가 없다. 확인 필요 1번의 제안이 "기존 방식 유지"인 이유다.

## 확인 필요 2건의 배경

1. **미처리 수의 출처**: 아이디어는 `dream-prep status` 출력 활용을 지시했지만, 그대로 하려면 앱이 외부 프로세스를 실행해야 한다. 확인된 `dream-prep`은 pyenv 아래에 있어 GUI로 띄운 앱의 PATH에 없을 수 있고, 출력 파싱 대상인 `처리됨` 값의 의미도 위와 같이 어긋난다. 아이디어 지시와 다른 방향을 제안하는 항목이라 조용히 결정하지 않고 확인 필요로 올렸다.
2. **Windows**: dream 잡의 조건은 `sh`를 거치지 않아 원리상 Windows에서 동작할 여지가 있다. 그래서 SPEC-002의 일괄 차단을 유지할지가 실제 선택지가 된다. 제안은 현행 유지이고, 근거는 연동 × 플랫폼 조합을 지금 열면 검증 상태 수만 늘어난다는 것이다.

## 핸드오프 노트 (이 세션 범위 밖)

- **조건 스크립트 이중화가 실제로 시작됐다**: SPEC-002 확인 필요 1번이 예상한 상태가 현실이 됐다. 지금 `scripts/wf-eligible.sh`와 `.workflow/rules/wf-eligible.sh`가 둘 다 존재하고, 차이는 관리 표기 두 줄(`# managed_by:`, `# condition_script_version: 1`)뿐이라 판정 로직은 아직 같다. 갈라지기 전에 정리하는 편이 싸다. SPEC-002가 "별도 아이디어로 다룬다"고 명시했으므로 이 기획서에 끌어오지 않았고, 사용자 아이디어 등록이 필요하다.
- **`heartbeat state.json`에 이름이 바뀐 잡의 고아 기록이 남는다**: 현재 `wf-planner`, `wf-architect`, `wf-developer`(구 이름)와 `wf-planner-Users-catze-project-workflow-labs`(신 이름)가 함께 있다. 상태 키가 잡 이름이므로 이름을 바꾸면 이전 실행 이력과 쿼터가 끊긴다. 이번 범위와 무관하지만, 앞으로 잡 이름 규칙을 바꿀 때 고려할 사실이다.
- **역할 잡 condition의 `revision_requested` 공백은 여전히 미해결**: REPORT-SPEC-001-ARCH와 REPORT-SPEC-002-PLAN이 이미 지적한 항목이다. `wf-eligible.sh`의 `planner` 판정은 미처리 아이디어만 보고 `revision_requested` 결정을 감지하지 못한다. 즉 기획서 재작업 루프는 아직 하트비트로 자동 기동되지 않는다.
- SPEC-003은 신규 기능보다 기존 코드의 구조 변경 비중이 크다. 승인되면 아키텍트 분해 시 "공통 구조 분리(동작 변화 없음)"와 "dream 연동 추가"를 다른 작업으로 나누는 편이 회귀 검증이 쉽다. 완료 조건 12·13을 앞 작업의 검증 조건으로 쓸 수 있다. 판단은 아키텍트 몫이다.

## 상태

SPEC-003은 `user_review`로 사용자 결정을 기다린다. IDEA-225421F7 lease는 해제했다. 작업 분해나 구현으로 넘어가지 않는다.
