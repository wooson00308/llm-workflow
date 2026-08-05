# SPEC-037 아키텍트 핸드오프

- 대상: DECISION-6C2F2639 (SPEC-037 승인, `created_by: user`, 2026-08-05T03:10:59.967916+00:00)
- 산출 작업: TASK-112 ~ TASK-117 (여섯 개 모두 `todo`)
- 세션: 2026-08-05T03:13Z~03:29Z / `wf-claim.sh acquire SPEC-037 architect-claude 30` exit 0
  (`lease-38682-20260805031303`) → `renew` exit 0 → `release`
- 자격 판정: `sh .workflow/rules/wf-eligible.sh architect` → `eligible` / 종료 코드 0.
- 자격 재검증: 클레임 직후 설치본 스크립트의 `architect)` 분기를 손으로 돌렸다. `created_by: user`
  승인 35건 중 `tasks/`의 `source_decision_id`가 참조하지 않는 것은 DECISION-6C2F2639 하나뿐이었고,
  SPEC-037의 결정도 이 하나뿐이므로 최신 앱 소유 결정이 `approved`다.
- 분해 후 재확인: `sh .workflow/rules/wf-eligible.sh architect` → `no-target` / 종료 코드 1.
- 결정 본문은 비어 있다. 기획서 "확인 필요" 머리글이 "승인 시 아래 제안대로 진행한다"이므로
  **여섯 항목 모두 제안대로**로 읽었다. 대안 A·B는 어느 것도 채택하지 않았다.

## 산출물

| 작업 | 범위 | 닫는 요구사항 | 선행 |
| --- | --- | --- | --- |
| TASK-112 | `docs/heartbeat.md` | R7 / 확인 필요 5번 · 완료 조건 6 | (없음) |
| TASK-113 | `heartbeat_process.rs`, `heartbeat_update_service.rs`(신규), `commands/heartbeat.rs`, `lib.rs`, `application/mod.rs` | R1·R4·R5·R7·R8 (백엔드) | TASK-112 |
| TASK-114 | `heartbeat_setup_run_service.rs`(신규), `heartbeat_setup.rs`, `domain/project.rs`, `commands/heartbeat.rs`, `lib.rs`, `application/mod.rs` | R2 (백엔드) / 확인 필요 1번 | TASK-113 |
| TASK-115 | `heartbeat_version_service.rs`(신규), `heartbeat_status.rs`, `commands/heartbeat.rs`, `lib.rs`, `application/mod.rs` | 확인 필요 2번 (백엔드) | TASK-114 |
| TASK-116 | `HeartbeatCard.tsx`, `HeartbeatUpdateGuide.tsx`, `IntegrationsView*.tsx`, `WorkspaceShell*.tsx`, `useProjectWorkspace*.ts`, `types.ts`, `tauriProjectGateway.ts`, `App.css` | R1·R3·R4·R5·R6 / 확인 필요 3·6번 · 완료 조건 1~4 | TASK-113 |
| TASK-117 | `HeartbeatCard.tsx`, `IntegrationsView.test.tsx`, `useProjectWorkspace*.ts`, `types.ts`, `tauriProjectGateway.ts`, `App.css` | R2 (화면) / 확인 필요 1·2번 · 완료 조건 5 | TASK-114, TASK-115, TASK-116 |

R9(완료 조건 7)는 여섯 작업 모두에 걸려 있다.

## 착수 조건을 선행 선언으로 옮긴 것 — 읽어야 할 판단

확인 필요 5번의 승인안은 "개발 작업의 착수는 (a) 데몬 변경 커밋 (b) `docs/config-contract.md`에
`update`·버전 표면 기재 뒤로 건다"이다. **분해 시점에 둘 다 미충족이다**(아래 실측).

승인안의 한계 문장이 "아키텍트가 작업을 만들 수 없는 기간이 생긴다"로 적혀 있어 두 가지로 읽힌다 —
(가) 아키텍트가 지금 아무것도 만들지 않는다, (나) 만들되 착수가 막혀 있다. **(나)로 읽고 분해했다.**

근거는 셋이다.

1. 승인안이 건 것은 "착수"이고, 분해는 착수가 아니다. 이 세션은 제품 코드를 한 줄도 만들지 않았다.
2. (가)로 읽으면 승인은 처리되지 않은 채 남고, 아키텍트 자격 판정이 30분마다 같은 승인을 계속
   `eligible`로 낸다. 세션이 깨어나 아무것도 하지 않고 끝나는 상태가 무기한 반복된다.
3. 착수 금지를 사람의 기억이 아니라 **선행 선언**이 지키게 하면 (가)가 지키려던 것이 그대로 지켜진다.
   TASK-112가 게이트이고 나머지 다섯이 전부 그것을 선행으로 두므로, 게이트가 열리기 전에는 개발자
   자격 판정이 어느 구현 작업도 후보로 세지 않는다.

이 읽기가 틀렸다면 되돌리는 비용은 여섯 문서 삭제뿐이고 코드는 손대지 않았다. 사용자가 (가)로
의도했다면 알려 주면 된다.

### 게이트 실측 (2026-08-05T03:1xZ, `~/Git/claude-heartbeat`)

- `git status --short`: `pyproject.toml`·`src/heartbeat/__init__.py`·`cli.py`·`core.py`·`service/` 넷
  수정 상태, `src/heartbeat/update.py` 추적되지 않음. 최신 커밋 `25e372e commit`.
- `docs/config-contract.md` 84줄. `update`·`version`·`_daemon` 문자열 없음.
- 즉 (a)·(b) 모두 미충족. 기획서 확인 사실 6·7이 분해 시점에도 그대로다.

### 게이트가 미충족일 때 생기는 막다른 길

TASK-112를 개발자가 집었는데 게이트가 미충족이면 그 작업은 `blocked`이 된다. **앱에는 `blocked`을
`todo`로 되돌리는 경로가 없고**, 개발자 자격 판정은 `todo`만 후보로 센다. 데몬 쪽이 착지한 뒤
**사용자가 TASK-112의 `status`를 `todo`로 되돌려야** 이 기획서의 여섯 작업이 다시 열린다.
TASK-112 본문에도 같은 문장을 적어 두었다.

## 순서를 정한 근거

파일 겹침이 순서의 전부다. 겹치지 않는 것은 묶지 않았다.

- **백엔드 셋(113 → 114 → 115)**: 셋 다 `commands/heartbeat.rs`와 `lib.rs`에 커맨드를 하나씩 더한다.
  겹치므로 순서를 준다. 113이 먼저인 것은 114·115가 그 캡처 실행 기반을 쓰기 때문이다.
- **화면 둘(116 → 117)**: 둘 다 `HeartbeatCard.tsx`·`types.ts`·`tauriProjectGateway.ts`·`App.css`를
  만진다.
- **116은 113만 기다린다.** 화면과 백엔드는 파일이 겹치지 않으므로, 113이 끝나면 114·115와 116이
  나란히 갈 수 있다. 여기가 이 분해의 유일한 병렬 자리다.
- 117이 114·115·116 셋을 모두 기다리는 것은 payload 둘(114·115)과 파일 하나(116) 때문이다.

`scope_files`는 여섯 작업 모두에 있다. 신규 모듈 셋(`heartbeat_update_service.rs`,
`heartbeat_setup_run_service.rs`, `heartbeat_version_service.rs`)의 이름을 아키텍트가 고정한 것은
그 이름이 선언에 들어가야 겹침 판정이 성립하기 때문이다.

## 아키텍트가 고정한 설계 결정

기획서가 아키텍트의 자리로 남긴 것들이다. 개발자가 임의로 바꾸지 않는다. 바꿔야 할 이유가 나오면
고쳐서 진행하지 말고 보고서에 적고 아키텍트 후속으로 넘긴다.

1. **stderr는 버리지 않고 원문 그대로 payload에 싣는다.** R4가 "어느 쪽을 화면에 어떻게 싣는지는
   아키텍트의 자리이나 버려서는 안 된다"로 남긴 자리다. 화면은 접힌 자리에 원문을 둔다.
2. **설치 실행 대상은 정확히 2·3단계 둘이다.** 4단계(`heartbeat install dream`)도 실행하지 않는다 —
   승인안이 든 것이 둘이고, 승인 범위를 앱이 넓히지 않는다.
3. **설치 두 명령의 종료 코드를 원인별로 번역하지 않는다.** 확인 필요 5번이 계약 착지를 요구한 대상은
   `update`와 버전 표면이고, `init`·`install-service`의 코드 의미는 계약에 없다. 0/비0과 stderr
   원문까지가 앱의 몫이다. TASK-112의 인용 절이 이 판단의 기준을 문서에 고정한다.
4. **버전 판정은 조회 주기에 얹지 않는다.** 프로세스를 띄우는 조작이라 전용 커맨드로 두고, 화면은
   카드가 펼쳐질 때와 업데이트가 끝난 뒤에만 부른다. `heartbeat_setup.rs`가 "실행 파일을 찾아 다니지도
   않는다"로 세운 선을 조회 경로에서 유지한다.
5. **앱은 실행 가능 여부를 사전 탐색으로 판정하지 않는다.** 확인 필요 6번의 "실행 가능한 상태"와
   "찾지 못한 상태"를 가르는 것은 직전 실행이 무엇으로 끝났는가 하나다. 4번과 같은 이유다.
6. **끊기는 세션의 원천은 `project.activeLeases`다.** 앱이 새로 계산하지 않고 활동 뷰가 쓰는 값을
   그대로 내린다. 앱은 lease를 지우지도 드레이닝을 기다리지도 않는다.
7. **`HeartbeatUpdateGuide`의 문구와 다섯 값은 바꾸지 않는다.** dream 카드에서는 안내가 계속 주
   통로다. 하트비트 카드 쪽의 접기는 감싸기이지 컴포넌트의 문구 변경이 아니다(SPEC-034 R7).

## 역할 밖 관찰 (핸드오프 노트)

고치지 않고 남긴다.

1. **TASK-104가 `in_progress`인 채 lease가 만료돼 있다.** 기획서 확인 사실이 든 08-05 재기동 사고의
   실물이다. SPEC-035/TASK-110이 그 회수를 다루므로 이 기획서에서 건드리지 않았다.
2. **기획서 확인 사실 2가 낡았다.** TASK-107·108·109는 분해 시점에 셋 다 `completed`다(QA 통과).
   확인 필요 6번의 전제("안내가 되돌아가면 제안의 전제가 흔들린다")는 해소된 상태이고, R6이 가리키는
   안내가 그대로 있다.
3. **이 기기에서 실행형이 실패 경로로 떨어질 가능성이 높다.** 확인 사실 11(pyenv 아래 실행 파일,
   앱 후보는 PATH와 `~/.local/bin` 둘)은 분해 시점에도 그대로다. 확인 필요 4번이 "다루지 않고 폴백"으로
   승인됐으므로 그대로 두었으나, 여섯 작업을 다 끝내도 이 기기에서 원클릭이 안 될 수 있다. 탐색 후보를
   넓히는 일은 별도 아이디어/기획서의 자리다.
4. **`docs/todo-list.md`와 개발 로그는 이 세션이 손대지 않았다.** 개발 로그 한 절만 별도로 적는다.
