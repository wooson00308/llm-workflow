# TASK-007 개발자 핸드오프

- 대상 작업: TASK-007 (역할 잡 설치·토글·편집 액션과 전역 파일 쓰기 확인 절차)
- 출처 기획서: SPEC-002
- 승인 결정: DECISION-1265B3C7 (`outcome: approved`, `created_by: user`)
- 세션 역할: 개발자
- 작성 시각: 2026-08-02T04:40:00Z

## 결과

SPEC-002의 R2 설치 액션, R5 관리 UI, R6 쓰기 안전을 구현했다. 쓰기 커맨드 `install_heartbeat_jobs`
하나를 추가하고, TASK-003·TASK-004의 쓰기 엔진을 그 커맨드 아래에 순서대로 묶었다. 설정 화면의
연동 카드에는 역할별 토글·편집 입력과 확인 절차를 붙였다. 작업 상태를 `qa_waiting`으로 올렸다.

앱을 GUI로 띄우는 수동 검증과 실제 `~/.claude/HEARTBEAT.md` 쓰기는 하지 않았다. 사유는 아래
"수행하지 않은 검증"에 적는다. 이 세션에서 전역 파일은 변경되지 않았다.

## 선행 조건 판단

TASK-003·004·005·006은 모두 `completed`다. 활성 lease는 없었고 `migration.lock`도 없었다.
처리 가능한 `todo`는 TASK-007 하나였다.

## 변경한 파일

| 파일 | 변경 | 내용 |
| --- | --- | --- |
| `src-tauri/src/application/heartbeat_service.rs` | 수정 | `RoleJobRequest`, `HeartbeatInstallError`, `install`, `enabled_role_jobs`, 설치 테스트 7종 |
| `src-tauri/src/commands/heartbeat.rs` | 수정 | `install_heartbeat_jobs` 커맨드 |
| `src-tauri/src/infrastructure/heartbeat_jobs.rs` | 수정 | `validate_role_jobs` 공개 함수 1개(아래 참조) |
| `src-tauri/src/lib.rs` | 수정 | `invoke_handler`에 커맨드 1줄 |
| `src/features/projects/domain/types.ts` | 수정 | `RoleJobRequest`, `HeartbeatState.writeError`, 게이트웨이 시그니처 |
| `src/features/projects/infrastructure/tauriProjectGateway.ts` | 수정 | `installHeartbeatJobs` 호출 |
| `src/features/projects/application/useProjectWorkspace.ts` | 수정 | `installHeartbeatJobs`, 조회가 쓰기 오류를 지우지 않도록 상태 갱신 방식 변경 |
| `src/features/projects/components/SettingsView.tsx` | 수정 | 역할 잡 폼·확인 화면·쓰기 오류 표시 |
| `src/features/projects/components/SettingsView.test.tsx` | 수정 | 설치 테스트 10종 추가, 기존 단언 1건 변경 |
| `src/features/projects/components/WorkspaceShell.tsx` | 수정 | prop 통과 |
| `src/App.tsx` | 수정 | `installHeartbeatJobs` 전달 1줄 |
| `src/App.css` | 수정 | 폼·확인 화면 스타일 |
| `src/features/projects/components/WorkspaceShell.test.tsx` | 수정 | 새 필수 prop 6곳, `writeError` 필드 |
| `src/features/projects/application/useProjectWorkspace.test.ts` | 수정 | 게이트웨이 목에 `installHeartbeatJobs` 1줄 |

`.workflow/rules/*`, `scripts/`, `docs/`, `domain/project.rs`, `heartbeat_condition.rs`,
`heartbeat_status.rs`는 변경하지 않았다.

### 작업 문서 범위와 다른 점

작업 문서 `범위`에 없는 `heartbeat_jobs.rs`를 한 군데 고쳤다. 공개 함수
`validate_role_jobs(&[RoleJob])` 하나를 추가하고, `install_role_jobs` 앞머리의 검증 루프가 그
함수를 부르도록 바꿨다(같은 `validate_settings`를 그대로 쓴다. 판정 로직은 그대로다).

필요한 이유는 순서다. 작업 문서는 "2. 입력값 검증 → 3. 조건 스크립트 설치 → 4. 관리 블록 갱신"을
요구하는데, 기존에는 검증이 4단계 안에만 있었다. 그대로 두면 잘못된 `interval` 하나에도 3단계가
먼저 실행돼 프로젝트 로컬 파일이 쓰인다. 완료 조건의 "잘못된 형식 입력에서 두 대상 파일 중 어느
것도 쓰이지 않는다"를 만족하려면 쓰기 없는 검증 진입점이 있어야 한다.

검증 로직을 서비스 계층에 베껴 적는 대안은 버렸다. 두 벌이 되면 갈라진다.
`heartbeat_condition.rs`에 이미 같은 성격의 `validate_condition_script`(설치와 같은 판정만 하고
쓰지 않음)가 있어 패턴도 맞다.

## 공개 API

```rust
#[tauri::command]
pub fn install_heartbeat_jobs(
    app: tauri::AppHandle,
    path: String,
    roles: Vec<RoleJobRequest>,
) -> Result<HeartbeatIntegration, String>
```

- `HeartbeatService::install(project_root, heartbeat_home, roles)` — 홈을 인자로 받는다. 홈
  해석은 커맨드 계층에만 있다. 테스트는 이 함수를 임시 디렉터리로 부른다.
- `RoleJobRequest { role, enabled, interval, maxPer, model }` — 비활성 역할도 함께 보낸다.
  하트비트에 비활성 필드가 없으므로 "꺼짐"은 관리 블록에서 빼는 것으로 표현한다.
- 반환값은 갱신된 `HeartbeatIntegration`이다. 프론트가 쓰기 뒤에 조회를 다시 하지 않는다.

프론트는 `ProjectGateway.installHeartbeatJobs(path, roles)`와
`useProjectWorkspace().installHeartbeatJobs(roles)`로 접근한다.

## 설계 결정

- 커맨드는 하나다. 설치·토글·편집이 전부 "역할 3종의 현재 상태를 통째로 다시 쓴다"는 같은 연산이라
  나눌 이유가 없다. 부분 갱신 커맨드를 만들면 관리 블록의 최종 형태가 호출 순서에 의존한다.
- 순서는 검증 → 조건 스크립트 → 관리 블록이다. 스크립트가 먼저인 이유는 작업 문서가 적은 그대로다.
  조건 검사 실패는 하트비트에서 skip이라, 없는 스크립트를 가리키는 잡은 사용자에게 "아무 일도
  안 일어남"으로만 보인다.
- 3단계 실패 시 4단계를 하지 않는다. 4단계 실패 시 3단계 결과는 되돌리지 않는다. 잡 없이 스크립트만
  있는 상태는 무해하고, 되돌리기는 실패 경로를 두 배로 늘린다. 작업 문서의 지시와 같다.
- 잡 순서는 요청 배열이 아니라 `HeartbeatRole::ALL`이 정한다. 프론트가 순서를 바꿔 보내도 파일이
  달라지지 않는다. 토글 왕복 후 파일이 같아야 한다는 완료 조건 6이 여기에 걸려 있다.
- 알 수 없는 역할 이름은 조용히 무시하지 않고 오류다. 무시하면 프론트와 앱의 역할 목록이 어긋났을
  때 잡이 소리 없이 빠진다.
- 역할이 하나도 활성이 아니면 관리 블록을 지우고 조건 스크립트는 남긴다. 앱 관리 자산이고 다른
  실행 경로에서도 쓰인다. 이 경우에도 스크립트 설치 단계는 그대로 지난다(내용이 같으면 쓰지 않는다).
- `HeartbeatState`에 `writeError`를 따로 뒀다. 기존 `error`(조회 실패)에 쓰기 실패를 담으면 2.5초
  뒤 조회가 덮어써서 사용자가 문구를 읽기 전에 사라지고, 카드 배지도 "상태를 읽을 수 없음"으로
  잘못 바뀐다. 조회는 이제 상태를 통째로 갈아끼우지 않고 `writeError`를 보존한다.
- 입력 폼은 관리 블록의 내용(`managedJobs`)이 실제로 바뀌었을 때만 파일 값으로 다시 채운다.
  2.5초 조회는 같은 값을 주므로 편집 중인 값이 주기적으로 사라지지 않는다. `useEffect`가 아니라
  렌더 중 상태 조정 패턴을 썼다.
- 관리 블록이 비어 있으면 3종을 모두 켠 상태로 시작한다. R3의 "설치 시 3종을 기본값으로 기록한다"가
  그것이다. 하나라도 설치된 뒤부터는 "블록에 없음"이 곧 "꺼짐"이고, 그때는 파일 상태를 그대로 따른다.
- 확인 화면은 `useArmedConfirm`을 쓰지 않는다. R6이 요구하는 것은 실수 클릭 방지가 아니라 대상
  경로와 변경 요지의 표시다. 두 경로(전역/프로젝트 로컬)와 기록될 잡 이름·설정, 제거될 잡, 그리고
  "블록 밖은 건드리지 않는다"를 화면에 실제로 적었다.
- 확인 화면의 내용은 프론트가 아는 값으로만 만든다. 백엔드 dry-run 커맨드를 두지 않았다. 작업 문서
  `참고 사실` 3번의 판단을 그대로 따랐다.
- 값을 바꾸거나 토글을 건드리면 열려 있던 확인 화면을 닫는다. 사용자가 검토한 요지와 실제로 쓰일
  값이 어긋난 채 확인 버튼이 눌리는 경로를 없앤다.
- 검증은 활성 역할의 입력만 한다. 꺼진 역할의 값은 파일에 쓰이지 않으므로 저장을 막을 이유가 없다.
- 오류 문구는 입력마다 그 입력 아래에 붙고 `aria-invalid`·`aria-describedby`로 연결한다. 전역
  배너를 쓰지 않는다(R5).
- 미지원 플랫폼에서는 설치 버튼을 `disabled`로 둔다. 백엔드도 `UnsupportedPlatform`으로 거부하므로
  방어선이 둘이다.
- 역할 행의 우측 표시를 기존 `20m · 6/24h · opus`에서 잡 이름(`wf-<role><slug>`)으로 바꿨다. 값은
  이제 입력 상자가 보여주므로 중복이고, 잡 이름은 `heartbeat jobs` 출력과 대조할 때 필요하다.

## 검증

```
npm run check
```

- `tsc -b` 통과, `vitest run` 10파일 43테스트 통과(신규 10, 이전 33), `vite build` 성공.

```
~/.cargo/bin/cargo test --manifest-path src-tauri/Cargo.toml
```

- `71 passed; 0 failed` (신규 7, 이전 64).

```
~/.cargo/bin/cargo build --manifest-path src-tauri/Cargo.toml
```

- 경고 0개.

```
~/.cargo/bin/cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
```

- 이번 세션이 만든 코드 지적 0건(`heartbeat_service.rs`를 `rustfmt`로 정리했다).
  `heartbeat_condition.rs` 114·246줄 지적 2건은 TASK-003 산출물이라 손대지 않았다.
  REPORT-TASK-005-DEV·REPORT-TASK-006-DEV가 같은 항목을 남겼다.

조건 스크립트 동등성(완료 조건 5)은 설치본을 `.workflow/rules/`에 실제로 깔지 않고 확인했다.
그 경로는 앱 관리 자산이고, 앱 액션 없이 손으로 까는 것은 소유 규칙에 어긋난다. 대신 Rust 상수
`CONDITION_SCRIPT`를 그대로 뽑아 임시 파일로 만들어 대조했다.

```sh
python3 -c "import pathlib,re; \
  src=pathlib.Path('src-tauri/src/infrastructure/heartbeat_condition.rs').read_text(); \
  pathlib.Path('/tmp/wf-eligible-installed.sh').write_text( \
    re.search(r'const CONDITION_SCRIPT: &str = r#\"(.*?)\"#;', src, re.S).group(1))"
for role in planner architect developer bogus; do
  sh scripts/wf-eligible.sh "$role" >/dev/null 2>&1; a=$?
  sh /tmp/wf-eligible-installed.sh "$role" >/dev/null 2>&1; b=$?
  echo "$role repo=$a installed=$b"
done
diff <(tail -n +2 scripts/wf-eligible.sh) <(sed '2,3d' /tmp/wf-eligible-installed.sh | tail -n +2)
```

- `planner 1 1`, `architect 1 1`, `developer 1 1`, `bogus 2 2`. 종료 코드가 모두 같다.
  `developer`가 `1`인 것은 이 세션이 TASK-007 lease를 들고 있어서다(조건이 정상 동작한 결과다).
- `diff`는 차이 없음. 앱 관리 표기 2줄을 뺀 판정 로직 본문이 저장소 스크립트와 바이트 단위로 같다.

```sh
shasum ~/.claude/HEARTBEAT.md; stat -f "%Sm" ~/.claude/HEARTBEAT.md
```

- `65e920800f328c4c7e09d70ea04de527b0a59e26`, 수정 시각 `Aug 2 13:18:35 2026`. 이 세션의 lease
  생성 시각(`2026-08-02T04:19:29Z` = 13:19:29 KST)보다 앞선다. 세션 중 전역 파일을 쓰지 않았다.
  (직전 REPORT-TASK-006-DEV가 적은 해시와 다르다. 그 보고서 작성 이후 이 세션 시작 전에 사용자
  환경에서 바뀐 것이다. 이 세션의 변경이 아니다.)

### 완료 조건 대응

| 완료 조건 | 근거 |
| --- | --- |
| 1. 관리 블록 1개·역할 잡 3종 기본값·블록 밖 불변 | `installs_the_condition_script_and_the_role_jobs_together` + 기존 `appends_block_after_user_jobs_and_preserves_them`(TASK-004). GUI 재현은 미수행 |
| 2. 두 번 실행해도 파일 동일 | `the_same_install_twice_changes_neither_file` |
| 3. `- tick:` 유지 | 기존 `appends_block_after_user_jobs_and_preserves_them`(관리 블록은 항상 파일 끝) |
| 4. 마커 손상·흡수 줄에서 실패, 원본 유지 | 기존 `rejects_a_file_with_only_one_marker`·`rejects_reversed_markers`·`rejects_a_field_line_after_the_end_marker`(TASK-004). 커맨드 경로는 그 오류를 그대로 문자열로 올린다 |
| 5. 조건 스크립트 인자·종료 코드 동일 | 위 대조표(4종 일치) + `diff` 차이 없음 |
| 6. 토글 왕복 후 파일 동일 | `turning_a_role_off_and_on_restores_the_first_install`, `disabling_every_role_removes_the_block_but_keeps_the_script` |
| 7. 잘못된 형식에서 쓰기 없음 + 입력 위치 표시 | `an_invalid_setting_writes_neither_file`(두 파일 모두 없음) + 프론트 `reports ... at its own input and writes nothing` 3종 |
| 8. 블록 밖 중복 잡 불변 | 쓰기 대상이 마커 사이 본문뿐이다(TASK-004의 `plan_block`). 앱에 삭제 경로가 없다 |
| 9. 명시적 액션에서만 쓰기 + 경로·요지 표시 | `does not write before the confirmation step`, `shows both target paths and the change summary before writing`. 훅의 쓰기 호출부는 `installHeartbeatJobs` 한 곳이고 폴링 경로에 없다 |
| 10. `npm run check` / `cargo test` 통과 | 위 검증 |

## 수행하지 않은 검증

작업 문서 `검증 절차`의 수동 확인 6종을 하지 않았다.

사유:

- 이 세션은 비대화형이라 `npm run tauri dev`로 앱 창을 띄우고 프로젝트를 열 수 없다. 설치 액션은
  화면에서만 눌린다.
- 더 중요한 이유는 그 절차가 실제 `~/.claude/HEARTBEAT.md`를 쓴다는 것이다. 그 파일은 지금 이
  세션을 깨운 하트비트 데몬이 읽고 있고, 쓰면 사용자 환경에 역할 잡 3종이 실제로 등록된다. R6은
  전역 파일 쓰기를 명시적 사용자 액션으로 제한한다. 그 원칙을 구현한 세션이 사용자 대신 그 파일을
  쓰는 것은 앞뒤가 맞지 않는다.

대신 같은 성질을 자동화로 덮었다. 파일 조작의 정확성은 임시 디렉터리에서 도는 Rust 테스트가
(마커 손상·흡수 줄·멱등·토글 왕복·순서·실패 시 불변), 확인 절차와 검증 표시는 프론트 테스트가,
조건 스크립트 동등성은 위 종료 코드 대조가 담당한다. GUI와 실제 전역 파일 확인은 아래 QA로 넘긴다.

## 사용자 QA 제안

시작 전에 반드시 백업한다.

```sh
cp ~/.claude/HEARTBEAT.md /tmp/HEARTBEAT.md.bak
shasum ~/.claude/HEARTBEAT.md
npm run tauri dev
```

1. 설정 → 연동. 역할 3종이 모두 켜진 채 기본값(기획자·아키텍트 `30m`/`4/24h`/`opus`, 개발자
   `20m`/`6/24h`/`opus`)으로 보이는지, 각 행 우측에 잡 이름이 보이는지 확인한다.
2. "이 프로젝트에 역할 잡 설치"를 누른다. 확인 화면에 `~/.claude/HEARTBEAT.md`(전역)과
   `.workflow/rules/wf-eligible.sh`(프로젝트 로컬) 두 경로, 기록될 잡 3종, "블록 밖의 잡과 전역
   설정은 읽기만 한다"가 보이는지 확인한다. 여기서 취소해도 파일이 안 바뀌는지(해시 대조) 먼저 본다.
3. 확인하고 쓰기. 그 뒤 아래를 확인한다.

```sh
diff <(sed -n '1,/workflow-labs:heartbeat-jobs:start/p' ~/.claude/HEARTBEAT.md | sed '$d') /tmp/HEARTBEAT.md.bak
heartbeat jobs
md5 ~/.claude/HEARTBEAT.md
```

- `diff`에 차이가 없어야 한다(블록 앞부분이 원본과 동일).
- `heartbeat jobs`에 새 잡 3종이 뜨고 기존 잡과 `tick`이 그대로여야 한다.

4. 같은 설치를 한 번 더 실행하고 `md5`가 같은지 본다.
5. 역할 하나를 껐다 켜고 `md5`가 3번 직후 값과 같은지 본다.
6. `interval`에 `30분`, `max_per`에 `4회`, `model`에 공백이 든 값을 넣고 저장을 눌러 각각 그 입력
   아래에 사유가 뜨는지, 확인 화면이 열리지 않는지, `md5`가 그대로인지 본다.
7. 손상 재현. 종료 마커 뒤에 `- tick: 5m`을 넣은 뒤 설치를 시도해 실패 문구와 해시 유지를 확인한다.
8. 조건 스크립트 설치본을 확인한다.

```sh
sh .workflow/rules/wf-eligible.sh planner; echo $?
sh .workflow/rules/wf-eligible.sh bogus; echo $?   # 2 여야 한다
```

9. 원상 복구.

```sh
cp /tmp/HEARTBEAT.md.bak ~/.claude/HEARTBEAT.md
shasum ~/.claude/HEARTBEAT.md
```

예상 동작으로 봐야 할 것: 설치 직후 중복 잡 경고가 3건 뜬다. 손으로 적은
`wf-planner`·`wf-architect`·`wf-developer`가 관리 블록 밖에 남아 있기 때문이다(작업 문서
`참고 사실` 마지막 항목). 사용자가 수동 잡을 지우기 전까지 역할당 두 세션이 깨어난다.

## 남은 리스크

- 역할 기본값이 백엔드(`HeartbeatRole::default_settings`)와 프론트(`roleJobDefaults`) 두 곳에 있다.
  실제로 파일에 쓰이는 값은 프론트가 보낸 것이고, 백엔드 쪽은 이제 테스트에서만 쓰인다. R3 값을
  바꿀 때 두 곳을 같이 고쳐야 하고, 어긋나도 컴파일러가 잡지 못한다. 폼이 최초 설치 전에도 값을
  보여줘야 해서 생긴 중복이라 이번 범위에서 한쪽으로 모으지 않았다. 기본값을 백엔드가 내려 주는
  조회 필드로 만드는 방법이 있지만 커맨드 결과 타입을 바꾸는 일이라 별도로 다루는 편이 낫다.
- 편집 중 관리 블록이 외부에서 바뀌면(다른 창, 손 편집) 입력이 파일 값으로 되돌아간다. 편집 내용을
  지키는 쪽보다 파일을 진실로 두는 쪽을 골랐다. 충돌 경고는 넣지 않았다.
- 토글을 끈 역할의 편집값은 저장하지 않는다. 작업 문서 `범위 밖`이 명시한 대로다. UI에 그 사실을
  적어 두었다.
- 앱은 잡 이름으로 관리 블록의 역할 잡을 식별한다. 사용자가 블록 안 잡 이름을 손으로 바꾸면 "역할
  잡 미설치"로 보이고, 그 상태에서 설치하면 폼이 3종 모두 켜진 기본값으로 다시 채워진다. R2의
  "잡 이름은 앱 소유" 전제 위에서 받아들인 범위다.

## 역할 밖 발견 사항

개발자 역할에서 고치지 않고 남긴다.

- `cargo fmt --check`가 `heartbeat_condition.rs` 114·246줄에 지적 2건을 낸다. TASK-003 산출물이고
  세 번째 보고서가 같은 항목을 반복해 남기는 중이다. 별도 정리 작업으로 다루는 편이 낫다.
- `heartbeat_jobs.rs`·`heartbeat_condition.rs`·`heartbeat_status.rs`의 `#![allow(dead_code)]`는
  "연결이 끝나면 지운다"는 주석과 함께 남아 있다. 이번 세션이 그 연결의 마지막이라 실제로 지워
  보았더니 경고 2건이 남았다: `validate_condition_script`(TASK-003이 만든 dry-run 진입점, 쓰는 곳
  없음)와 `HeartbeatRole::default_settings`(위 리스크의 백엔드 기본값, 테스트에서만 쓰임). 둘 다 이
  작업이 만든 코드가 아니라 지우지 않고 `allow`를 되돌렸다. 세 파일의 `allow` 제거와 이 두 함수의
  거취는 함께 정할 문제다.
- 작업 문서 `범위`가 `heartbeat_jobs.rs`를 빠뜨렸다. 검증 순서 요구(2단계가 3단계보다 앞)를 지키려면
  쓰기 없는 검증 진입점이 필요한데, 그 진입점이 있어야 할 곳이 범위 밖이었다. 아키텍트가 작업을
  쪼갤 때 "순서 요구"가 만드는 인터페이스 변경을 파일 목록에 반영하면 이런 차이가 준다.

## 다음 작업

- 이 작업으로 SPEC-002의 모든 요구사항이 구현됐다. 남은 것은 사용자 QA다.
- QA 통과 후 별도 아이디어로 다룰 것: 저장소 `scripts/wf-eligible.sh` 제거와 `docs/heartbeat.md`
  문구 정리. SPEC-002 `확인 필요` 1번이 승인 시 별도로 다루기로 한 항목이고, 이제 두 산출물이 모두
  존재하게 됐다.
