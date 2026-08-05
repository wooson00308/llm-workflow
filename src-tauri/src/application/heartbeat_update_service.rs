//! `heartbeat update`를 실행하고 그 계약 출력을 값으로 옮기는 서비스.
//!
//! 조회·설치·"지금 실행"과 다른 책임이라 모듈을 나눠 둔다. 이 경로는 어떤 파일도 읽거나 쓰지
//! 않는다 — 파일을 쓰는 것은 데몬이다(SPEC-037 R1, 완료 조건 8).
//!
//! 앱이 읽는 표면은 `docs/heartbeat.md`의 "앱이 의존하는 데몬 표면" 절에 적힌 것뿐이다(R7).
//! 그 절에 없는 값에 기대지 않는다. 이 모듈이 쓰는 것은 그중 1번 `heartbeat update` 하나다.
//!
//! 이 모듈이 하지 않는 것이 하나 더 있다. **종료 코드를 문장으로 번역하지 않는다.** 계약이 코드로
//! 원인을 가르므로(0·10~14·20·30~32) 그 갈림을 사용자 문구로 옮기는 것은 화면의 몫이고, 여기서는
//! 숫자를 그대로 싣는다. 계약에 없는 코드가 와도 마찬가지다 — 아는 척하지 않는 쪽이 SPEC-034 R2가
//! 세운 선이고, 새 원인이 번호로 느는 것은 계약이 하위호환으로 허용한 변경이다.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::infrastructure::heartbeat_process::{
    candidates, manual_command_for, run_capturing, Captured, RunFailure,
};

/// 실행할 고정 인자. 화면이 준 문자열이 명령줄에 닿는 경로가 없다(완료 조건 9).
const ARGUMENTS: [&str; 1] = ["update"];

/// 계약 줄에서 앱이 읽는 키.
const STEP: &str = "step";
const STATUS: &str = "status";
const DETAIL: &str = "detail";
const RESULT: &str = "result";
const VERSION: &str = "version";

/// 단계 줄 하나. 데몬이 실제로 낸 줄만 값이 된다 — 앱이 단계 셋을 미리 만들어 두고 채우지
/// 않는다. 낸 적 없는 단계를 "건너뜀"으로 지어내면 그것이 R4가 막는 뭉뚱그림이다.
///
/// `status`와 `detail`이 `Option`인 것은 계약이 그 키를 뺄 수 있어서가 아니라, 없는 키를 앱이
/// 지어내지 않기 위해서다.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStep {
    pub step: String,
    pub status: Option<String>,
    pub detail: Option<String>,
}

/// 업데이트 실행의 결과. 셋을 서로 다른 값으로 구분한다(R7의 마지막 항목).
///
/// 옛 설치본에는 `update` 서브커맨드가 없다. 그때 앱이 조용히 아무 일도 하지 않은 것처럼 끝나면
/// 안 되므로, "계약대로 답했다"와 "계약 밖으로 끝났다"가 같은 값이 되지 않는다.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum HeartbeatUpdate {
    /// 계약대로 답했다. `result` 줄이 마지막에 하나 있고 stdout이 전부 계약 줄이다.
    #[serde(rename_all = "camelCase")]
    Contract {
        /// 데몬이 낸 단계 줄, 낸 순서 그대로.
        steps: Vec<UpdateStep>,
        /// `ok`·`partial`·`failed`. 세 값을 접지 않고 그대로 싣는다 — 특히 `partial`이
        /// 성공으로도 실패로도 읽히면 08-05 사고의 모양이 화면에서 사라진다.
        result: String,
        /// 갱신이 끝난 뒤 디스크에 있는 버전.
        version: Option<String>,
        /// 프로세스 종료 코드. 계약이 `result` 줄의 `exit=`과 같은 값이라고 적었고, 앱이 직접
        /// 관측하는 쪽이 이것이라 이 값을 싣는다. `None`이면 시그널로 끝난 것이다.
        code: Option<i32>,
        /// 원문. 앱이 읽지 않은 키까지 화면이 볼 수 있게 버리지 않는다.
        stdout: String,
        /// 사람용 진단. 요약하지도 잘라내지도 않는다(R4).
        stderr: String,
    },
    /// 계약 밖 출력. 실행은 됐는데 답이 계약의 모양이 아니다. 성공으로 읽지 않는다.
    #[serde(rename_all = "camelCase")]
    OffContract {
        code: Option<i32>,
        stdout: String,
        stderr: String,
    },
    /// 실행 자체가 실패했다(R5). 사용자가 손으로 끝낼 수 있게 명령 원문을 함께 싣는다.
    #[serde(rename_all = "camelCase")]
    NotRun {
        message: String,
        /// 사용자가 그대로 칠 수 있는 명령 원문. 사유와 무관하게 언제나 채운다.
        command: String,
        /// 실제로 본 후보 경로. 앱이 지어내지 않는다(R5). 탐색에서 진 것이 아니면 비어 있다.
        looked: Vec<String>,
    },
}

#[derive(Debug, Default)]
pub struct HeartbeatUpdateService;

impl HeartbeatUpdateService {
    /// 하트비트를 한 번 갱신한다. 자식이 끝날 때까지 돌아오지 않으므로 호출자가 블로킹 자리를
    /// 마련해 부른다 — `git fetch`와 `pip install`이 걸리는 조작이다.
    ///
    /// `user_home`은 실행 파일 후보(`~/.local/bin`)를 만드는 데만 쓴다. 하트비트 홈이 아니다.
    pub fn update(&self, user_home: &Path) -> HeartbeatUpdate {
        self.update_with(&candidates(user_home))
    }

    /// 후보 목록을 받는 형태. 실제로 하트비트를 띄우지 않고 결과를 확인할 수 있어야 해서
    /// 나눠 둔다(`HeartbeatRunService::run_with`가 같은 이유로 같은 모양이다).
    fn update_with(&self, candidates: &[PathBuf]) -> HeartbeatUpdate {
        match run_capturing(candidates, &ARGUMENTS) {
            Ok(captured) => classify(captured),
            Err(failure) => not_run(&failure),
        }
    }
}

/// 받아 온 출력을 계약 안과 밖으로 가른다.
///
/// 가르는 기준은 stdout의 모양 하나다. 종료 코드는 기준이 아니다 — 계약이 새 원인마다 번호를
/// 늘리므로, 모르는 코드를 "계약 밖"으로 부르면 앱이 새 데몬 앞에서 스스로 깨진다.
fn classify(captured: Captured) -> HeartbeatUpdate {
    let Captured {
        code,
        stdout,
        stderr,
        ..
    } = captured;

    match parse(&stdout) {
        Some(Contract {
            steps,
            result,
            version,
        }) => HeartbeatUpdate::Contract {
            steps,
            result,
            version,
            code,
            stdout,
            stderr,
        },
        None => HeartbeatUpdate::OffContract {
            code,
            stdout,
            stderr,
        },
    }
}

/// 파싱이 성공했을 때 나오는 값. 세 조각을 튜플로 넘기면 호출부에서 순서가 헷갈린다.
struct Contract {
    steps: Vec<UpdateStep>,
    result: String,
    version: Option<String>,
}

/// stdout을 계약 줄로 읽는다. 한 군데라도 모양이 어긋나면 `None`이고, 그것이 "계약 밖"이다.
///
/// 계약이 정한 모양은 "단계 줄 0~3개 다음에 `result=` 줄 정확히 하나이고 그 줄이 마지막"이다.
/// 그래서 마지막 줄은 `result` 키를 가져야 하고, 앞의 줄은 전부 `step` 키를 가져야 한다.
/// 마지막이 아닌 자리에 두 번째 `result` 줄이 오는 경우도 이 검사에 걸린다.
fn parse(stdout: &str) -> Option<Contract> {
    let lines: Vec<&str> = stdout
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect();
    let (last, preceding) = lines.split_last()?;

    let result_line = pairs(last)?;
    let result = value(&result_line, RESULT)?;

    let mut steps = Vec::with_capacity(preceding.len());
    for line in preceding {
        let step_line = pairs(line)?;
        steps.push(UpdateStep {
            step: value(&step_line, STEP)?,
            status: value(&step_line, STATUS),
            detail: value(&step_line, DETAIL),
        });
    }

    Some(Contract {
        steps,
        result,
        version: value(&result_line, VERSION),
    })
}

/// 한 줄을 공백으로 나눈 `key=value` 목록으로 읽는다. `=` 없는 토큰이나 빈 키가 하나라도 있으면
/// 계약 줄이 아니다. 값 안의 `=`은 값의 일부다(첫 `=`에서만 나눈다).
fn pairs(line: &str) -> Option<Vec<(&str, &str)>> {
    line.split_whitespace()
        .map(|token| {
            let (key, value) = token.split_once('=')?;
            (!key.is_empty()).then_some((key, value))
        })
        .collect()
}

/// 앱이 아는 키만 꺼낸다. 모르는 키는 그대로 두고 무시한다 — 키 추가는 계약이 하위호환으로
/// 허용한 변경이고, `stdout` 원문이 결과에 실리므로 화면이 필요하면 거기서 본다.
fn value(pairs: &[(&str, &str)], key: &str) -> Option<String> {
    pairs
        .iter()
        .find(|(name, _)| *name == key)
        .map(|(_, value)| (*value).to_owned())
}

/// 실행 자체가 실패한 경로. 사유마다 사용자가 할 다음 행동이 다르므로 문구를 나눈다.
fn not_run(failure: &RunFailure) -> HeartbeatUpdate {
    let (message, looked) = match failure {
        RunFailure::NotFound { looked } => (
            "하트비트 실행 파일을 찾지 못해 업데이트를 실행하지 못했습니다.".to_owned(),
            looked
                .iter()
                .map(|path| path.display().to_string())
                .collect(),
        ),
        // 0이 아닌 종료 코드는 `run_capturing`에서 실패가 아니므로, 후보를 찾은 뒤에 실패하는
        // 사유는 "띄우지 못했다" 하나뿐이다. 남은 변형은 그 경로에서 나오지 않는다.
        RunFailure::NotStarted { program, reason } => (
            format!(
                "`{}`을(를) 찾았지만 실행을 시작하지 못했습니다: {reason}",
                program.display()
            ),
            Vec::new(),
        ),
        RunFailure::ExitStatus { program, .. } => (
            format!(
                "`{}`을(를) 띄웠지만 출력을 받지 못했습니다.",
                program.display()
            ),
            Vec::new(),
        ),
    };

    HeartbeatUpdate::NotRun {
        message,
        command: manual_command_for(&ARGUMENTS),
        looked,
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use pretty_assertions::assert_eq;
    use tempfile::{tempdir, TempDir};

    use super::{HeartbeatUpdate, HeartbeatUpdateService, UpdateStep};

    /// 계약 출력의 대표 다섯 중 첫째. 세 단계가 다 돌고 성공한 모양이다.
    const OK: &str = "step=repo status=ok detail=updated from=25e372e to=a91f0c4\n\
                      step=deps status=ok detail=reinstalled\n\
                      step=service status=ok detail=restarted label=com.claude-heartbeat\n\
                      result=ok version=0.8.1 exit=0\n";

    /// 둘째. 저장소 단계에서 멈춰 뒤 단계 줄이 나오지 않은 모양(종료 코드 11).
    const FAILED: &str = "step=repo status=failed detail=dirty-tree\n\
                          result=failed version=0.8.0 exit=11\n";

    /// 셋째. 코드는 갱신됐는데 재기동이 못 따라온 모양(종료 코드 31).
    const PARTIAL: &str = "step=repo status=ok detail=updated from=25e372e to=a91f0c4\n\
                           step=deps status=ok detail=reinstalled\n\
                           step=service status=failed detail=restart-failed\n\
                           result=partial version=0.8.1 exit=31\n";

    /// 넷째. `update` 서브커맨드를 모르는 옛 설치본이 낼 법한 모양.
    const NO_RESULT: &str = "usage: heartbeat [-h] {once,status,install} ...\n";

    fn missing(home: &TempDir) -> Vec<PathBuf> {
        vec![home.path().join("없는-후보")]
    }

    fn entries(directory: &TempDir) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(directory.path())
            .expect("read dir")
            .map(|entry| {
                entry
                    .expect("entry")
                    .file_name()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        names.sort();
        names
    }

    fn step(step: &str, status: &str, detail: &str) -> UpdateStep {
        UpdateStep {
            step: step.to_owned(),
            status: Some(status.to_owned()),
            detail: Some(detail.to_owned()),
        }
    }

    /// 파싱은 stdout 문자열을 직접 넣어 확인한다. 실제 하트비트를 띄우지 않는다.
    fn parsed(stdout: &str, code: Option<i32>, stderr: &str) -> HeartbeatUpdate {
        super::classify(crate::infrastructure::heartbeat_process::Captured {
            program: PathBuf::from("heartbeat"),
            code,
            stdout: stdout.to_owned(),
            stderr: stderr.to_owned(),
        })
    }

    fn contract(update: &HeartbeatUpdate) -> (&[UpdateStep], &str, Option<&str>, Option<i32>) {
        match update {
            HeartbeatUpdate::Contract {
                steps,
                result,
                version,
                code,
                ..
            } => (steps, result, version.as_deref(), *code),
            other => panic!("계약대로 읽혀야 한다: {other:?}"),
        }
    }

    #[test]
    fn a_successful_update_carries_every_step_in_the_order_the_daemon_emitted_them() {
        let update = parsed(OK, Some(0), "");
        let (steps, result, version, code) = contract(&update);

        assert_eq!(
            steps,
            [
                step("repo", "ok", "updated"),
                step("deps", "ok", "reinstalled"),
                step("service", "ok", "restarted"),
            ]
        );
        assert_eq!(result, "ok");
        assert_eq!(version, Some("0.8.1"));
        assert_eq!(code, Some(0));
    }

    /// 앞 단계가 실패하면 뒤 단계 줄이 나오지 않는다. 앱이 그 자리를 "건너뜀"으로 채우지 않는다.
    #[test]
    fn a_step_the_daemon_never_emitted_is_not_invented() {
        let update = parsed(FAILED, Some(11), "");
        let (steps, result, _, code) = contract(&update);

        assert_eq!(steps, [step("repo", "failed", "dirty-tree")]);
        assert_eq!(result, "failed");
        assert_eq!(code, Some(11));
    }

    /// `partial`은 `ok`로도 `failed`로도 접히지 않는다. 08-05 사고의 모양이 이것이다.
    #[test]
    fn partial_stays_partial() {
        let update = parsed(PARTIAL, Some(31), "");
        let (steps, result, version, code) = contract(&update);

        assert_eq!(result, "partial");
        assert_eq!(code, Some(31));
        assert_eq!(version, Some("0.8.1"));
        assert_eq!(
            steps.last(),
            Some(&step("service", "failed", "restart-failed"))
        );
    }

    /// 계약 출력의 대표 다섯 중 넷째. `result` 줄이 없는 출력은 성공이 아니다.
    #[test]
    fn output_without_a_result_line_is_not_read_as_success() {
        let update = parsed(NO_RESULT, Some(2), "unrecognized arguments: update\n");

        assert_eq!(
            update,
            HeartbeatUpdate::OffContract {
                code: Some(2),
                stdout: NO_RESULT.to_owned(),
                stderr: "unrecognized arguments: update\n".to_owned(),
            }
        );
    }

    /// 다섯째. 빈 stdout에는 마지막 줄이 없으므로 계약 밖이다.
    #[test]
    fn empty_output_is_off_contract() {
        let update = parsed("", Some(0), "");

        assert_eq!(
            update,
            HeartbeatUpdate::OffContract {
                code: Some(0),
                stdout: String::new(),
                stderr: String::new(),
            }
        );
    }

    /// 마지막 줄이 계약 줄이어도 앞의 줄이 아니면 계약 밖이다. 절반만 읽고 나머지를 버리면
    /// 무엇을 못 읽었는지가 사라진다.
    #[test]
    fn a_line_that_is_not_key_value_makes_the_whole_output_off_contract() {
        let update = parsed(
            "Traceback (most recent call last):\nresult=ok version=0.8.1 exit=0\n",
            Some(0),
            "",
        );

        assert!(
            matches!(update, HeartbeatUpdate::OffContract { .. }),
            "한 줄이라도 어긋나면 계약 밖이다: {update:?}"
        );
    }

    /// `result` 줄이 마지막이 아닌 출력도 계약 밖이다. 계약은 그 줄이 정확히 하나이고 마지막이라고
    /// 적었으므로, 두 번째 `result` 줄은 앱이 읽을 모양이 아니다.
    #[test]
    fn a_result_line_that_is_not_last_is_off_contract() {
        let update = parsed(
            "result=ok version=0.8.1 exit=0\nresult=failed exit=11\n",
            Some(11),
            "",
        );

        assert!(
            matches!(update, HeartbeatUpdate::OffContract { .. }),
            "`result` 줄은 하나이고 마지막이다: {update:?}"
        );
    }

    /// 계약에 없는 종료 코드를 번역하지도, 계약 밖으로 밀어내지도 않는다. 새 원인이 번호로 느는
    /// 것은 계약이 허용한 변경이라, 모르는 코드를 계약 밖으로 부르면 새 데몬 앞에서 앱이 깨진다.
    #[test]
    fn an_exit_code_the_contract_does_not_list_is_carried_as_the_number_it_is() {
        let update = parsed("result=failed version=0.9.0 exit=15\n", Some(15), "");
        let (_, result, _, code) = contract(&update);

        assert_eq!(result, "failed");
        assert_eq!(code, Some(15));
    }

    /// stderr는 요약하지도 잘라내지도 않는다(R4). 비어 있으면 비어 있는 것으로 실린다.
    #[test]
    fn stderr_is_carried_verbatim() {
        let diagnosis = "갱신: pip install -U claude-heartbeat\n두 번째 줄\n";
        let update = parsed(FAILED, Some(11), diagnosis);

        match &update {
            HeartbeatUpdate::Contract { stderr, stdout, .. } => {
                assert_eq!(stderr, diagnosis);
                assert_eq!(stdout, FAILED);
            }
            other => panic!("계약대로 읽혀야 한다: {other:?}"),
        }

        match parsed(FAILED, Some(11), "") {
            HeartbeatUpdate::Contract { stderr, .. } => assert_eq!(stderr, ""),
            other => panic!("계약대로 읽혀야 한다: {other:?}"),
        }
    }

    #[test]
    fn a_missing_executable_reports_the_paths_it_looked_at_and_the_command_to_type() {
        let home = tempdir().expect("temp home");
        let looked = missing(&home);

        let update = HeartbeatUpdateService.update_with(&looked);

        assert_eq!(
            update,
            HeartbeatUpdate::NotRun {
                message: "하트비트 실행 파일을 찾지 못해 업데이트를 실행하지 못했습니다."
                    .to_owned(),
                command: "heartbeat update".to_owned(),
                looked: looked
                    .iter()
                    .map(|path| path.display().to_string())
                    .collect(),
            }
        );
    }

    /// 업데이트 경로가 파일을 쓰지 않는다는 것을, 실행 전후로 목록이 같다는 것으로 확인한다.
    /// 파일을 쓰는 것은 데몬이고 앱이 아니다(완료 조건 8).
    ///
    /// 검사는 `update_with`로만 들어간다. `update`는 `candidates`가 만드는 맨 이름 `heartbeat`를
    /// 첫 후보로 두고, 그 이름은 검사를 돌리는 셸의 PATH에서 해석된다 — 실제로 설치된 기기에서는
    /// 검사가 진짜 `heartbeat update`를 실행해 저장소를 당기고 데몬을 재기동한다.
    /// `heartbeat_run_service.rs`의 같은 검사가 후보를 직접 주는 것도 같은 이유다.
    #[test]
    fn updating_writes_no_files_to_the_home_or_the_project() {
        let project = tempdir().expect("temp project");
        let home = tempdir().expect("temp home");

        HeartbeatUpdateService.update_with(&missing(&home));

        assert_eq!(entries(&project), Vec::<String>::new());
        assert_eq!(entries(&home), Vec::<String>::new());
    }

    #[test]
    fn the_contract_result_serializes_to_the_wire_contract() {
        let update = parsed(FAILED, Some(11), "미커밋 변경이 있습니다\n");

        assert_eq!(
            serde_json::to_value(&update).expect("update json"),
            serde_json::json!({
                "kind": "contract",
                "steps": [
                    { "step": "repo", "status": "failed", "detail": "dirty-tree" },
                ],
                "result": "failed",
                "version": "0.8.0",
                "code": 11,
                "stdout": FAILED,
                "stderr": "미커밋 변경이 있습니다\n",
            })
        );
    }

    #[test]
    fn the_failure_results_serialize_to_the_wire_contract() {
        assert_eq!(
            serde_json::to_value(parsed("", Some(127), "not found\n")).expect("off contract json"),
            serde_json::json!({
                "kind": "offContract",
                "code": 127,
                "stdout": "",
                "stderr": "not found\n",
            })
        );

        let home = tempdir().expect("temp home");
        let update = HeartbeatUpdateService.update_with(&missing(&home));

        assert_eq!(
            serde_json::to_value(&update).expect("not run json"),
            serde_json::json!({
                "kind": "notRun",
                "message": "하트비트 실행 파일을 찾지 못해 업데이트를 실행하지 못했습니다.",
                "command": "heartbeat update",
                "looked": [home.path().join("없는-후보").display().to_string()],
            })
        );
    }

    /// 실행 경로는 recorder 스크립트로 세운다. 인자가 `update` 하나로 나가는 것과, 그 출력이
    /// 그대로 값이 되는 것을 한 번에 확인한다.
    #[cfg(unix)]
    #[test]
    fn the_update_runs_with_the_fixed_argument_and_its_output_becomes_the_result() {
        use std::fs;
        use std::os::unix::fs::PermissionsExt;

        let directory = tempdir().expect("temp dir");
        let script = directory.path().join("recorder");
        fs::write(
            &script,
            "#!/bin/sh\nprintf '%s' \"$*\" > \"$(dirname \"$0\")/arguments\"\n\
             printf 'step=repo status=ok detail=up-to-date\\n'\n\
             printf 'result=ok version=0.8.1 exit=0\\n'\nexit 0\n",
        )
        .expect("write recorder");
        fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).expect("chmod recorder");

        let update = HeartbeatUpdateService.update_with(&[script]);
        let (steps, result, version, code) = contract(&update);

        assert_eq!(steps, [step("repo", "ok", "up-to-date")]);
        assert_eq!(result, "ok");
        assert_eq!(version, Some("0.8.1"));
        assert_eq!(code, Some(0));
        assert_eq!(
            fs::read_to_string(directory.path().join("arguments")).ok(),
            Some("update".to_owned())
        );
    }
}
