//! Windows에서 콘솔 창을 만들지 않는 자식 프로세스 생성.

use std::ffi::OsStr;
use std::process::Command;

/// `Command::new`와 같되, Windows에서는 자식에게 콘솔 창을 만들어 주지 않는다.
///
/// 이 앱은 콘솔 없는 GUI 프로세스다(`main.rs`의 `windows_subsystem`). 그런 프로세스가 콘솔
/// 실행 파일을 그대로 띄우면 Windows는 호출마다 새 콘솔 창을 만들고, 프로젝트를 열어 두는 동안
/// 상태 조회의 git 호출과 런타임 CLI 호출이 화면에서 주기적으로 창을 깜빡이게 했다(2026-08-18
/// Windows 실측). 앱이 띄우는 자식은 전부 파이프이거나 닫힌 표준 입출력으로 끝나므로, 콘솔이
/// 필요한 자식은 없다.
pub(crate) fn quiet_command(program: impl AsRef<OsStr>) -> Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW: 새 콘솔을 만들지 않는다. 부모에게 콘솔이 없으므로 자식은 콘솔 없이 돈다.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let mut command = Command::new(program);
        command.creation_flags(CREATE_NO_WINDOW);
        command
    }
    #[cfg(not(windows))]
    Command::new(program)
}
