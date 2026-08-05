//! 등록된 하트비트 서비스를 내리고 다시 올리는 서비스(SPEC-036 R1·R4·R5·R7·R8).
//!
//! 조회·설치·"지금 실행"·업데이트와 다른 책임이라 모듈을 나눠 둔다. **앱은 이 경로에서 어떤 파일도
//! 쓰지 않는다.** 특히 `~/Library/LaunchAgents`에 쓰거나 지우지 않는다 — 등록과 해제는 설치 마법사
//! 3단계와 `uninstall-service`의 일이고, 이 조작은 등록된 서비스를 잠깐 내렸다 올리는 것이다(R8).
//! lease 파일도 읽지도 쓰지도 않는다(R3).
//!
//! **순서는 하나다.** 대상을 확정한다 → 확정되지 않으면 프로세스를 띄우지 않는다 → 확정됐으면
//! 띄운다. R4가 "대상을 확정하지 못하면 조작하지 않는다. 확정하지 못한 채 표준 이름으로 시도하는
//! 경로를 만들지 않는다"고 못박은 자리라, 상수 `com.claude-heartbeat`을 대상으로 삼는 갈래가 이
//! 모듈에 없다.
//!
//! **화면이 보내는 것은 조작 식별자 하나다.** 명령 문자열이 아니다. 식별자 → 조작의 매핑은 이
//! 모듈의 상수이고, 그 상수에 없는 식별자는 프로세스를 띄우지 않고 실패로 끝난다
//! (`heartbeat_setup_run_service.rs`의 단계 식별자 검증이 같은 어법이다).
//!
//! **결과는 명령이 어떻게 끝났는가까지만 말한다.** 명령이 성공했다는 것과 데몬이 실제로 내려갔다는
//! 것은 다른 사실이고, 앱의 실행 여부 판정은 pid 파일 존재 하나다(확인 사실 1). 그래서 데몬 상태를
//! 단정하는 필드를 두지 않고, 종료 코드를 뜻으로 번역하지도 않는다 — `bootout`의 "No such process"와
//! `bootstrap`의 "already loaded"는 launchctl이 stderr로 말하는 것이고, 앱이 그 문장을 자기 어휘로
//! 옮기면 옮긴 만큼이 지어낸 것이 된다(R7). `heartbeat status`도 부르지 않는다 — 그 출력 형식은
//! 계약이 아니다(확인 사실 12).

use std::path::Path;

use serde::Serialize;

use crate::domain::project::HeartbeatServiceTarget;
use crate::infrastructure::launch_agents::resolve_service_target;
use crate::infrastructure::launchctl::{self, Executed, Operation};

/// 화면이 보내는 조작 식별자.
const STOP: &str = "stop";
const START: &str = "start";

/// 서비스 조작의 결과.
///
/// 앞의 넷은 대상이 확정되지 않아 프로세스를 띄우지 않은 채 끝난 것이고, `launch_agents.rs`의 판정을
/// 그대로 옮긴 값이다. 여섯이 서로 다른 값인 것이 R5의 "하나의 실패 문구로 뭉뚱그리지 않는다"이다.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum HeartbeatServiceRun {
    /// 등록물이 없다. 데몬이 OS 스케줄러 밖에서 손으로 떠 있거나 아예 없는 경우다.
    NotRegistered,
    /// 등록물이 여럿이라 앱이 대상을 고르지 않는다(확인 필요 3번). 찾은 경로를 전부 담는다.
    #[serde(rename_all = "camelCase")]
    Ambiguous { plist_paths: Vec<String> },
    /// macOS가 아니다. 다른 플랫폼의 정지·기동 절차를 앱이 지어내지 않는다(R9).
    UnsupportedPlatform,
    /// 읽어야 할 것을 읽지 못했다. 등록물 디렉터리를 열지 못했거나, plist는 하나인데 그 `Label`을
    /// 읽지 못했거나, 도메인을 만들 홈 소유자 uid를 읽지 못한 것이다. 셋 다 대상이 확정되지 않은
    /// 상태이고, 등록물 없음과 갈라 두지 않으면 앱이 모르는 것을 안다고 말하게 된다.
    Unreadable { path: String },
    /// 실행 수단이 없다 — `launchctl`을 띄우지 못했다(R5). 사용자가 손으로 끝낼 수 있게 명령 원문을
    /// 함께 싣는다.
    ///
    /// 기획서 R5는 이 상태를 `heartbeat` 실행 파일의 후보 탐색 실패로 적었지만, 확인 필요 1번이
    /// 승인되면서 조작 수단이 `launchctl`로 정해졌으므로 이 경로에서는 그 실행 파일을 띄우지 못한
    /// 것으로 실현된다. 상태가 없어지는 것이 아니라 실현 방식이 바뀌는 것이다.
    #[serde(rename_all = "camelCase")]
    NotRun {
        /// 띄우지 못한 사유. 파일 없음·실행 권한 없음 같은 것이고, 원문은 운영체제가 말한다.
        message: String,
        /// 사용자가 그대로 칠 수 있는 명령 원문. 빈칸이 없다 — 대상이 확정된 뒤에만 만들어진다.
        command: String,
    },
    /// 띄웠고 끝났다. 종료 코드가 0이 아닌 것은 실행 실패가 아니라 결과이므로 여기에 실린다.
    #[serde(rename_all = "camelCase")]
    Ran {
        /// 프로세스 종료 코드. `None`이면 시그널로 끝난 것이다. 뜻으로 번역하지 않는다(R7).
        code: Option<i32>,
        /// 원문. 요약하지도 잘라내지도 않는다.
        stdout: String,
        /// 사람용 진단. 실패 사유를 말하는 것은 이 원문이지 앱이 아니다.
        stderr: String,
        /// 실제로 조작한 대상. 앱이 무엇을 건드렸는지가 결과의 일부다.
        label: String,
        plist_path: String,
    },
}

#[derive(Debug, Default)]
pub struct HeartbeatServiceControlService;

impl HeartbeatServiceControlService {
    /// 조작 하나를 한 번 실행한다. 자식이 끝날 때까지 돌아오지 않으므로 호출자가 블로킹 자리를
    /// 마련해 부른다 — `bootout`은 데몬이 내려갈 때까지 걸린다.
    ///
    /// `user_home`은 등록물을 찾는 디렉터리와 도메인의 uid를 얻는 데 쓴다. 하트비트 홈이 아니다.
    ///
    /// 식별자가 상수에 없으면 대상을 읽지도 프로세스를 띄우지도 않고 오류로 끝난다.
    pub fn control(
        &self,
        user_home: &Path,
        operation: &str,
    ) -> Result<HeartbeatServiceRun, String> {
        let operation =
            operation_for(operation).ok_or_else(|| unknown_operation_message(operation))?;

        Ok(self.control_resolved(
            &launchctl::program(),
            user_home,
            resolve_service_target(user_home),
            operation,
        ))
    }

    /// 실행 파일과 판정을 받는 형태. 실제 `launchctl`을 띄우면 개발 기기의 도는 데몬이 내려가고,
    /// 대상 미확정 갈래는 이 기기의 등록물로는 세울 수 없어서 나눠 둔다
    /// (`HeartbeatSetupRunService::run_with`가 같은 이유로 같은 모양이다).
    fn control_resolved(
        &self,
        program: &Path,
        user_home: &Path,
        target: HeartbeatServiceTarget,
        operation: Operation,
    ) -> HeartbeatServiceRun {
        let (label, plist_path) = match target {
            HeartbeatServiceTarget::Resolved { label, plist_path } => (label, plist_path),
            HeartbeatServiceTarget::NotRegistered => return HeartbeatServiceRun::NotRegistered,
            HeartbeatServiceTarget::Ambiguous { plist_paths } => {
                return HeartbeatServiceRun::Ambiguous { plist_paths }
            }
            HeartbeatServiceTarget::UnsupportedPlatform => {
                return HeartbeatServiceRun::UnsupportedPlatform
            }
            HeartbeatServiceTarget::Unreadable { path } => {
                return HeartbeatServiceRun::Unreadable { path }
            }
        };

        // 라벨과 경로를 알아도 도메인을 만들지 못하면 대상이 확정되지 않은 것이다. 여기서 uid를
        // 지어내거나 생략한 명령을 만들면 그것이 곧 R5가 막는 빈칸이 된다.
        let Some(uid) = launchctl::user_uid(user_home) else {
            return HeartbeatServiceRun::Unreadable {
                path: user_home.display().to_string(),
            };
        };

        let arguments = launchctl::arguments(operation, uid, &label, &plist_path);

        match launchctl::run(program, &arguments) {
            Ok(Executed {
                code,
                stdout,
                stderr,
            }) => HeartbeatServiceRun::Ran {
                code,
                stdout,
                stderr,
                label,
                plist_path,
            },
            Err(error) => HeartbeatServiceRun::NotRun {
                message: format!(
                    "`{}`을(를) 띄우지 못해 데몬을 조작하지 못했습니다: {error}",
                    program.display()
                ),
                command: launchctl::manual_command(&arguments),
            },
        }
    }
}

/// 식별자를 조작으로 옮긴다. 여기 없는 값은 조작이 아니다.
fn operation_for(operation: &str) -> Option<Operation> {
    match operation {
        STOP => Some(Operation::Stop),
        START => Some(Operation::Start),
        _ => None,
    }
}

fn unknown_operation_message(operation: &str) -> String {
    format!(
        "`{operation}`은(는) 앱이 아는 조작이 아니라 아무것도 실행하지 않았습니다. \
         앱이 하는 것은 데몬을 내리는 것과 다시 올리는 것 둘뿐입니다."
    )
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use pretty_assertions::assert_eq;
    use tempfile::{tempdir, TempDir};

    use super::{operation_for, HeartbeatServiceControlService, HeartbeatServiceRun, Operation};
    // 실행까지 가는 검사는 recorder 스크립트를 쓰므로 unix 갈래에만 있다.
    #[cfg(unix)]
    use super::{launchctl, START, STOP};
    use crate::domain::project::HeartbeatServiceTarget;

    const LABEL: &str = "com.catze.dream-heartbeat";

    /// 대상이 확정되지 않은 넷. 값을 담는 둘(모호·읽지 못함)과 담지 않는 둘이 섞여 있다.
    fn unresolved(plist: &str) -> [HeartbeatServiceTarget; 4] {
        [
            HeartbeatServiceTarget::NotRegistered,
            HeartbeatServiceTarget::Ambiguous {
                plist_paths: vec![plist.to_owned()],
            },
            HeartbeatServiceTarget::UnsupportedPlatform,
            HeartbeatServiceTarget::Unreadable {
                path: plist.to_owned(),
            },
        ]
    }

    fn resolved(home: &TempDir) -> HeartbeatServiceTarget {
        HeartbeatServiceTarget::Resolved {
            label: LABEL.to_owned(),
            plist_path: plist_path(home),
        }
    }

    fn plist_path(home: &TempDir) -> String {
        home.path()
            .join("Library")
            .join("LaunchAgents")
            .join("com.catze.dream-heartbeat.plist")
            .display()
            .to_string()
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

    /// 받은 인자를 파일에 적고 끝나는 스크립트. 실제 `launchctl`을 띄우면 이 기기의 도는 데몬이
    /// 내려간다 — 검사가 개발 기기를 조작하면 안 된다.
    #[cfg(unix)]
    fn recorder(directory: &TempDir, body: &str) -> PathBuf {
        use std::fs;
        use std::os::unix::fs::PermissionsExt;

        let script = directory.path().join("recorder");
        fs::write(&script, body).expect("write recorder");
        fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).expect("chmod recorder");
        script
    }

    #[cfg(unix)]
    fn recording_recorder(directory: &TempDir) -> PathBuf {
        recorder(
            directory,
            "#!/bin/sh\nprintf '%s' \"$*\" > \"$(dirname \"$0\")/arguments\"\n",
        )
    }

    #[cfg(unix)]
    fn recorded_arguments(directory: &TempDir) -> Option<String> {
        std::fs::read_to_string(directory.path().join("arguments")).ok()
    }

    fn missing(directory: &TempDir) -> PathBuf {
        directory.path().join("없는-실행-파일")
    }

    /// 완료 조건 1·2. 식별자 하나가 승인된 두 명령의 인자가 되어 나가고, 라벨과 plist 경로는 판정이
    /// 낸 값이다. 화면이 준 문자열이 인자에 섞이는 자리가 없다.
    #[cfg(unix)]
    #[test]
    fn each_operation_runs_with_the_approved_command_for_the_resolved_target() {
        let home = tempdir().expect("user home");
        let uid = launchctl::user_uid(home.path()).expect("홈의 uid");
        let plist = plist_path(&home);

        for (identifier, expected) in [
            (STOP, format!("bootout gui/{uid}/{LABEL}")),
            (START, format!("bootstrap gui/{uid} {plist}")),
        ] {
            let directory = tempdir().expect("temp dir");
            let script = recording_recorder(&directory);

            let run = HeartbeatServiceControlService.control_resolved(
                &script,
                home.path(),
                resolved(&home),
                operation_for(identifier).expect("아는 조작이다"),
            );

            assert!(
                matches!(run, HeartbeatServiceRun::Ran { .. }),
                "{identifier}은 실행까지 가야 한다: {run:?}"
            );
            assert_eq!(
                recorded_arguments(&directory).as_deref(),
                Some(expected.as_str())
            );
        }
    }

    /// 완료 조건 4. 대상이 확정되지 않은 넷에서 프로세스가 뜨지 않는다. 표준 라벨로 대신 시도하는
    /// 갈래도 없다 — 띄웠으면 남았을 흔적이 없다는 것으로 확인한다.
    #[cfg(unix)]
    #[test]
    fn an_unresolved_target_never_spawns_the_program() {
        for target in unresolved("/Users/tester/Library/LaunchAgents/com.example.heartbeat.plist") {
            for identifier in [STOP, START] {
                let home = tempdir().expect("user home");
                let directory = tempdir().expect("temp dir");
                let script = recording_recorder(&directory);

                let run = HeartbeatServiceControlService.control_resolved(
                    &script,
                    home.path(),
                    target.clone(),
                    operation_for(identifier).expect("아는 조작이다"),
                );

                assert!(
                    !matches!(
                        run,
                        HeartbeatServiceRun::Ran { .. } | HeartbeatServiceRun::NotRun { .. }
                    ),
                    "{target:?}에서는 실행 갈래로 가면 안 된다: {run:?}"
                );
                assert_eq!(
                    recorded_arguments(&directory),
                    None,
                    "{target:?}에서 프로세스를 띄우면 안 된다"
                );
            }
        }
    }

    /// 완료 조건 5. 대상 판정 넷이 결과에서도 서로 다른 값으로 남는다. 어느 둘도 같은 값으로
    /// 접히지 않는다.
    #[test]
    fn the_four_unresolved_judgements_stay_four_distinct_results() {
        let home = tempdir().expect("user home");
        let plist = "/Users/tester/Library/LaunchAgents/com.example.heartbeat.plist";
        let missing = missing(&home);

        let results: Vec<HeartbeatServiceRun> = unresolved(plist)
            .into_iter()
            .map(|target| {
                HeartbeatServiceControlService.control_resolved(
                    &missing,
                    home.path(),
                    target,
                    Operation::Stop,
                )
            })
            .collect();

        assert_eq!(
            results,
            vec![
                HeartbeatServiceRun::NotRegistered,
                HeartbeatServiceRun::Ambiguous {
                    plist_paths: vec![plist.to_owned()],
                },
                HeartbeatServiceRun::UnsupportedPlatform,
                HeartbeatServiceRun::Unreadable {
                    path: plist.to_owned(),
                },
            ]
        );
    }

    /// 완료 조건 6. 실행 수단이 없으면 사유와 함께 사용자가 그대로 칠 명령 원문이 실리고, 그 원문에
    /// 빈칸이 없다.
    ///
    /// unix 밖에서는 읽을 uid가 없어 대상이 확정되지 않는 것이 먼저이므로 이 갈래에 닿지 않는다.
    #[cfg(unix)]
    #[test]
    fn a_program_that_cannot_be_spawned_reports_the_reason_and_the_command_to_type() {
        let home = tempdir().expect("user home");
        let uid = launchctl::user_uid(home.path()).expect("홈의 uid");

        let run = HeartbeatServiceControlService.control_resolved(
            &missing(&home),
            home.path(),
            resolved(&home),
            Operation::Stop,
        );

        let HeartbeatServiceRun::NotRun { message, command } = run else {
            panic!("띄우지 못한 것은 실행 수단 없음이다: {run:?}");
        };

        assert!(
            message.contains("없는-실행-파일"),
            "무엇을 띄우지 못했는지 밝혀야 한다: {message}"
        );
        assert_eq!(
            command,
            format!("launchctl bootout gui/{uid}/{LABEL}"),
            "명령 원문은 실제로 띄울 인자에서 나온다"
        );
        assert!(
            !command.contains('<'),
            "명령 원문에 빈칸이 남았다: {command}"
        );
    }

    /// 완료 조건 8. 0이 아닌 종료 코드가 실행 실패로 접히지 않고 원문과 함께 결과에 실린다.
    /// `bootout`이 로드되지 않은 서비스에 대해 끝나는 모양이고, 그 값이 곧 사유다.
    #[cfg(unix)]
    #[test]
    fn a_nonzero_exit_code_lands_in_the_result_with_the_output_verbatim() {
        let home = tempdir().expect("user home");
        let directory = tempdir().expect("temp dir");
        let script = recorder(
            &directory,
            "#!/bin/sh\nprintf 'Boot-out failed: 3: No such process\\n' >&2\nexit 3\n",
        );

        assert_eq!(
            HeartbeatServiceControlService.control_resolved(
                &script,
                home.path(),
                resolved(&home),
                Operation::Stop,
            ),
            HeartbeatServiceRun::Ran {
                code: Some(3),
                stdout: String::new(),
                stderr: "Boot-out failed: 3: No such process\n".to_owned(),
                label: LABEL.to_owned(),
                plist_path: plist_path(&home),
            }
        );
    }

    /// 완료 조건 9. 결과에 데몬 상태를 단정하는 필드가 없다. 종료 코드가 0인 결과와 0이 아닌 결과가
    /// 같은 모양이고, 성공·실패를 뜻으로 옮긴 필드가 어느 쪽에도 붙지 않는다.
    #[cfg(unix)]
    #[test]
    fn the_result_never_claims_what_the_daemon_is_doing_now() {
        let home = tempdir().expect("user home");

        for (body, code) in [("#!/bin/sh\nexit 0\n", 0), ("#!/bin/sh\nexit 3\n", 3)] {
            let directory = tempdir().expect("temp dir");
            let script = recorder(&directory, body);

            let run = HeartbeatServiceControlService.control_resolved(
                &script,
                home.path(),
                resolved(&home),
                Operation::Stop,
            );

            let json = serde_json::to_value(&run).expect("run json");
            let object = json.as_object().expect("결과는 객체다");

            assert_eq!(object["code"], code);
            assert_eq!(
                object.keys().map(String::as_str).collect::<Vec<_>>(),
                vec!["code", "kind", "label", "plistPath", "stderr", "stdout"],
                "결과가 말하는 것은 명령이 어떻게 끝났는가까지다: {json}"
            );
        }
    }

    /// 아는 조작은 둘뿐이다. 그 밖의 식별자는 대상을 읽지도 프로세스를 띄우지도 않는다.
    #[test]
    fn an_unknown_operation_identifier_runs_nothing() {
        let home = tempdir().expect("user home");

        for identifier in ["restart", "bootout", "정체불명", ""] {
            assert_eq!(operation_for(identifier), None);

            let run = HeartbeatServiceControlService.control(home.path(), identifier);

            assert!(run.is_err(), "`{identifier}`은 조작이 아니다: {run:?}");
        }
    }

    /// 완료 조건 12. 앱이 이 경로에서 파일을 쓰지 않는다. 실행 전후로 사용자 홈과 하트비트 홈의
    /// 목록이 같다는 것으로 확인한다(`heartbeat_setup_run_service.rs`가 쓰는 어법이다).
    ///
    /// 검사는 `control_resolved`로만 들어간다. `control`은 실제 `launchctl`을 띄우므로 이 기기의
    /// 도는 데몬이 내려간다.
    #[test]
    fn controlling_the_service_writes_no_files_from_the_app() {
        let home = tempdir().expect("user home");
        let heartbeat_home = tempdir().expect("heartbeat home");
        let missing = missing(&home);

        for target in unresolved("/Users/tester/Library/LaunchAgents/com.example.heartbeat.plist") {
            HeartbeatServiceControlService.control_resolved(
                &missing,
                home.path(),
                target,
                Operation::Start,
            );
        }
        HeartbeatServiceControlService.control_resolved(
            &missing,
            home.path(),
            resolved(&home),
            Operation::Stop,
        );

        assert_eq!(entries(&home), Vec::<String>::new());
        assert_eq!(entries(&heartbeat_home), Vec::<String>::new());
    }

    #[test]
    fn the_results_serialize_to_the_wire_contract() {
        let home = tempdir().expect("user home");
        let plist = "/Users/tester/Library/LaunchAgents/com.example.heartbeat.plist";

        assert_eq!(
            serde_json::to_value(HeartbeatServiceControlService.control_resolved(
                &missing(&home),
                home.path(),
                HeartbeatServiceTarget::NotRegistered,
                Operation::Stop,
            ))
            .expect("not registered json"),
            serde_json::json!({ "kind": "notRegistered" })
        );

        assert_eq!(
            serde_json::to_value(HeartbeatServiceControlService.control_resolved(
                &missing(&home),
                home.path(),
                HeartbeatServiceTarget::Ambiguous {
                    plist_paths: vec![plist.to_owned()],
                },
                Operation::Stop,
            ))
            .expect("ambiguous json"),
            serde_json::json!({ "kind": "ambiguous", "plistPaths": [plist] })
        );

        assert_eq!(
            serde_json::to_value(HeartbeatServiceControlService.control_resolved(
                &missing(&home),
                home.path(),
                HeartbeatServiceTarget::UnsupportedPlatform,
                Operation::Stop,
            ))
            .expect("unsupported json"),
            serde_json::json!({ "kind": "unsupportedPlatform" })
        );

        assert_eq!(
            serde_json::to_value(HeartbeatServiceControlService.control_resolved(
                &missing(&home),
                home.path(),
                HeartbeatServiceTarget::Unreadable {
                    path: plist.to_owned(),
                },
                Operation::Stop,
            ))
            .expect("unreadable json"),
            serde_json::json!({ "kind": "unreadable", "path": plist })
        );

        let not_run = serde_json::to_value(HeartbeatServiceRun::NotRun {
            message: "띄우지 못했습니다".to_owned(),
            command: "launchctl bootout gui/501/com.catze.dream-heartbeat".to_owned(),
        })
        .expect("not run json");

        assert_eq!(
            not_run,
            serde_json::json!({
                "kind": "notRun",
                "message": "띄우지 못했습니다",
                "command": "launchctl bootout gui/501/com.catze.dream-heartbeat",
            })
        );

        assert_eq!(
            serde_json::to_value(HeartbeatServiceRun::Ran {
                code: Some(0),
                stdout: String::new(),
                stderr: String::new(),
                label: LABEL.to_owned(),
                plist_path: plist.to_owned(),
            })
            .expect("ran json"),
            serde_json::json!({
                "kind": "ran",
                "code": 0,
                "stdout": "",
                "stderr": "",
                "label": LABEL,
                "plistPath": plist,
            })
        );
    }
}
