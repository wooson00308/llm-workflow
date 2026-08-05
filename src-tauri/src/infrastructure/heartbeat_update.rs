//! 하트비트 갱신 안내의 명령 원문(SPEC-034 R3·R4). 084 경고가 "갱신하세요"로 끝나는 자리에서
//! 화면이 보여줄 완성 문자열을 만든다.
//!
//! 이 모듈은 파일을 읽지 않고 외부 명령을 실행하지 않는다. 다섯 값 중 셋은 상수이고, 나머지 둘의
//! 갈림은 컴파일 시점 플랫폼 하나다. 데몬 버전도 읽지 않는다 — 이 기기에서 "데몬 버전"의 답이
//! 셋이고 셋이 다르므로(SPEC-034 확인 사실 5·6) 값을 신뢰할 근거가 없다.
//!
//! `heartbeat_setup.rs`의 머리주석이 같은 규칙을 적어 두었고, 그 규칙이 여기서도 그대로다.

use crate::domain::project::HeartbeatUpdateGuide;

/// 갈래를 판별하는 명령. `Editable project location` 줄이 있으면 소스 체크아웃 설치다
/// (SPEC-034 확인 사실 4).
const IDENTIFY_COMMAND: &str = "pip show claude-heartbeat";

/// pip 갈래의 갱신 명령. 설치 마법사 1단계와 같은 설치 모델을 말한다(R6).
const PACKAGE_COMMAND: &str = "pip install -U claude-heartbeat";

/// 소스 체크아웃 갈래의 갱신 명령. **경로를 붙이지 않는다** — 체크아웃 디렉터리는 앱이 알지 못하는
/// 값이고, 지어내면 R2가 막는 "모르는 값을 사실처럼 적는 일"이 된다.
const SOURCE_COMMAND: &str = "git pull";

/// 공통 재시작 걸음의 첫 줄. 사용자가 자기 등록물의 라벨을 확인하는 방법이다(R4).
const SERVICE_LOOKUP_COMMAND: &str = "launchctl list | grep heartbeat";

/// 공통 재시작 걸음의 마지막 줄. `<라벨>`은 **사용자가 바꿔 넣는 빈자리**다. 표준 라벨 하나를 골라
/// 넣으면 그것이 사실처럼 적는 일이고, 이 기기의 `com.catze.dream-heartbeat`에서 바로 틀린다
/// (확인 사실 11). `KeepAlive`가 참이므로 이 한 줄이 재시작이다.
const SERVICE_RESTART_COMMAND: &str = "launchctl kickstart -k gui/$(id -u)/<라벨>";

/// 갱신 안내를 만든다. 입력이 없다 — 설치 여부·데몬 실행 여부·잡 존재 어느 것도 보지 않으므로
/// 조회 상태에 따라 값이 달라지지 않는다(R2·완료 조건 5).
///
/// 재시작 두 값은 macOS에서만 실린다. `heartbeat_setup.rs`의 `service_stage`가 같은 어법을 쓴다 —
/// 이 플랫폼에서 볼 것이 없으면 `None`을 싣고, 화면이 "없다"와 "확인할 방법이 없다"를 그 있음·없음
/// 으로 구분해 말한다. Linux(systemd)·Windows(Task Scheduler)의 재시작 절차는 이 저장소가 확인한
/// 적이 없고, 확인하지 않은 명령을 싣는 것이 R2가 막는 바로 그 일이다.
pub(crate) fn update_guide() -> HeartbeatUpdateGuide {
    // 런타임 값이 아니라 컴파일 시점 값이다. 테스트도 같은 조건으로 갈라 쓴다.
    let macos = cfg!(target_os = "macos");
    HeartbeatUpdateGuide {
        identify_command: IDENTIFY_COMMAND.to_owned(),
        package_command: PACKAGE_COMMAND.to_owned(),
        source_command: SOURCE_COMMAND.to_owned(),
        service_lookup_command: macos.then(|| SERVICE_LOOKUP_COMMAND.to_owned()),
        service_restart_command: macos.then(|| SERVICE_RESTART_COMMAND.to_owned()),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        update_guide, IDENTIFY_COMMAND, PACKAGE_COMMAND, SERVICE_LOOKUP_COMMAND,
        SERVICE_RESTART_COMMAND, SOURCE_COMMAND,
    };

    /// 다섯 값이 상수 그대로다. 화면이 조각을 붙일 자리가 없다(R3).
    #[test]
    fn the_guide_carries_the_command_constants_as_they_are() {
        let guide = update_guide();

        assert_eq!(guide.identify_command, IDENTIFY_COMMAND);
        assert_eq!(guide.package_command, PACKAGE_COMMAND);
        assert_eq!(guide.source_command, SOURCE_COMMAND);
    }

    /// R4·완료 조건 3. 재시작 두 값은 macOS에서만 있다. 확인하지 않은 플랫폼의 절차를 지어내지
    /// 않는다. `heartbeat_setup.rs`의 3단계 갈래 검사와 같은 어법이다.
    #[test]
    fn the_restart_commands_are_present_only_on_macos() {
        let guide = update_guide();

        if cfg!(target_os = "macos") {
            assert_eq!(
                guide.service_lookup_command.as_deref(),
                Some(SERVICE_LOOKUP_COMMAND)
            );
            assert_eq!(
                guide.service_restart_command.as_deref(),
                Some(SERVICE_RESTART_COMMAND)
            );
        } else {
            assert_eq!(guide.service_lookup_command, None);
            assert_eq!(guide.service_restart_command, None);
        }
    }

    /// R2·완료 조건 4. 앱이 알아낼 수 없는 값(설치 경로, 파이썬 환경, launchd 라벨)이 명령 원문에
    /// 박혀 있지 않다. 사용자가 바꿔 넣을 빈자리는 재시작 명령의 `<라벨>` 하나뿐이다.
    #[test]
    fn no_command_carries_a_value_the_app_cannot_know() {
        let guide = update_guide();

        for command in [
            &guide.identify_command,
            &guide.package_command,
            &guide.source_command,
        ] {
            for unknown in ["/Users/", ".pyenv", "com."] {
                assert!(
                    !command.contains(unknown),
                    "`{command}`에 앱이 알 수 없는 조각 `{unknown}`이 있다"
                );
            }
        }

        for command in [
            &guide.service_lookup_command,
            &guide.service_restart_command,
        ] {
            let Some(command) = command else { continue };
            for unknown in ["/Users/", ".pyenv", "com."] {
                assert!(
                    !command.contains(unknown),
                    "`{command}`에 앱이 알 수 없는 조각 `{unknown}`이 있다"
                );
            }
        }

        if let Some(restart) = guide.service_restart_command.as_deref() {
            assert_eq!(restart.matches('<').count(), 1);
            assert!(restart.contains("<라벨>"));
        }
    }
}
