//! 이 기기에 등록된 하트비트 launchd 서비스를 읽기만 하는 모듈(SPEC-036 R4·R5).
//!
//! 이 모듈은 **파일을 쓰지 않고 디렉터리를 만들지 않으며 프로세스를 띄우지 않는다.**
//! `heartbeat_setup.rs`의 머리주석이 세운 규칙이 여기서도 그대로다 — 그 모듈이 같은 디렉터리의
//! 파일 하나를 존재만 확인하고 있고, 이 모듈은 같은 디렉터리를 목록으로 읽는 것까지 간다.
//! 조회는 자동 새로고침 주기마다 불리므로 여기에 실행이 들어가면 주기마다 프로세스가 뜬다.
//!
//! 찾는 규칙은 데몬의 `LaunchdAdapter._heartbeat_plists`와 같은 것을 쓴다. 두 쪽이 서로 다른
//! 집합을 보면 `heartbeat update`의 재기동과 앱의 조작이 다른 서비스를 대상으로 삼는다.
//!
//! **답이 하나 갈린다.** 데몬의 `_label_of`는 `Label`을 읽지 못하면 파일 이름(`p.stem`)을 대신
//! 돌려주지만, 그것은 재기동이 실패해도 무해한 쪽의 선택이다. 이쪽은 R4가 "대상을 확정하지 못하면
//! 조작하지 않는다"를 명령하는 자리이고, 추측한 이름으로 `bootout`을 던지면 성공도 실패도 아닌
//! 상태가 남는다. 그래서 이 모듈은 읽지 못한 것을 읽지 못했다고만 말한다.

use std::fs;
use std::path::{Path, PathBuf};

use crate::domain::project::HeartbeatServiceTarget;

/// macOS의 사용자 LaunchAgents 디렉터리. `heartbeat_setup.rs`의 3단계가 보는 디렉터리와 같고,
/// 그 판정은 파일 하나의 존재를, 이 판정은 목록 전체를 묻는다.
const LAUNCH_AGENTS_DIRECTORY: &str = "Library";
const LAUNCH_AGENTS_SUBDIRECTORY: &str = "LaunchAgents";

/// 대상 plist를 고르는 규칙. 데몬이 `*.plist` 글롭에 `"heartbeat" in p.stem.lower()`를 걸므로
/// 확장자는 그대로 대조하고 이름은 소문자로 내려 대조한다.
const PLIST_EXTENSION: &str = "plist";
const PLIST_STEM_MARKER: &str = "heartbeat";

/// plist 최상위 사전에서 서비스 이름을 담는 키.
const LABEL_KEY: &str = "Label";

/// 이 기기에 등록된 하트비트 서비스를 해석한다. `user_home`은 판정이 볼 사용자 홈이다.
///
/// 홈을 인자로 받는 이유는 `heartbeat_setup.rs`의 `service_stage`와 같다 — 실제 홈을 함수가
/// 직접 구하면 판정이 개발 기기의 파일에 묶여 검사가 기기마다 달라진다.
pub fn resolve_service_target(user_home: &Path) -> HeartbeatServiceTarget {
    // 런타임 값이 아니라 컴파일 시점 값이다. `service_stage`·`update_guide`가 쓰는 어법과 같고,
    // macOS 밖에서는 디렉터리를 읽지도 않는다(R9).
    if !cfg!(target_os = "macos") {
        return HeartbeatServiceTarget::UnsupportedPlatform;
    }

    let directory = user_home
        .join(LAUNCH_AGENTS_DIRECTORY)
        .join(LAUNCH_AGENTS_SUBDIRECTORY);
    let Some(mut plists) = heartbeat_plists(&directory) else {
        return HeartbeatServiceTarget::Unreadable {
            path: directory.display().to_string(),
        };
    };
    // 파일시스템의 나열 순서에 결과가 기대지 않게 고정한다. 모호 상태의 목록도 이 순서로 나간다.
    plists.sort();

    match plists.as_slice() {
        [] => HeartbeatServiceTarget::NotRegistered,
        [plist] => match read_label(plist) {
            Some(label) => HeartbeatServiceTarget::Resolved {
                label,
                plist_path: plist.display().to_string(),
            },
            None => HeartbeatServiceTarget::Unreadable {
                path: plist.display().to_string(),
            },
        },
        plists => HeartbeatServiceTarget::Ambiguous {
            plist_paths: plists
                .iter()
                .map(|path| path.display().to_string())
                .collect(),
        },
    }
}

/// 디렉터리에서 대상 plist를 모은다. 디렉터리가 없거나 읽지 못하면 `None`이고, 그것은 빈 목록과
/// 다른 답이다(완료 조건 7). 항목 하나를 읽지 못한 것도 목록 전체를 믿을 수 없게 만든다.
fn heartbeat_plists(directory: &Path) -> Option<Vec<PathBuf>> {
    let entries = fs::read_dir(directory).ok()?;
    let mut plists = Vec::new();
    for entry in entries {
        let path = entry.ok()?.path();
        if is_heartbeat_plist(&path) {
            plists.push(path);
        }
    }
    Some(plists)
}

/// 데몬의 `_heartbeat_plists`와 같은 집합을 만든다 — 확장자가 `.plist`이고, 확장자를 뺀 이름에
/// 소문자로 `heartbeat`가 들어간 파일이다.
fn is_heartbeat_plist(path: &Path) -> bool {
    path.extension().and_then(|extension| extension.to_str()) == Some(PLIST_EXTENSION)
        && path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .is_some_and(|stem| stem.to_lowercase().contains(PLIST_STEM_MARKER))
}

/// plist 최상위 사전의 `Label` 값. 읽지 못하면 `None`이고, 파일 이름으로 대신하지 않는다(R4).
///
/// 최상위 사전만 본다. 중첩 사전 안의 같은 키를 집으면 그것이 곧 "엉뚱한 서비스를 내린다"가 된다.
fn read_label(plist: &Path) -> Option<String> {
    plist::Value::from_file(plist)
        .ok()?
        .as_dictionary()?
        .get(LABEL_KEY)?
        .as_string()
        .map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::fs;
    use std::path::Path;
    use std::time::SystemTime;

    use tempfile::{tempdir, TempDir};

    use super::resolve_service_target;
    use crate::domain::project::HeartbeatServiceTarget;

    /// 이 기기의 실제 `~/Library/LaunchAgents`를 보면 판정이 기기마다 달라진다. 픽스처는 언제나
    /// 임시 홈이다 — `heartbeat_setup.rs`의 `homes()`가 같은 이유로 쓰는 어법이다.
    fn home() -> TempDir {
        tempdir().expect("temporary directory")
    }

    /// 테스트 픽스처만 쓴다. 대상 모듈은 아무것도 쓰지 않는다.
    fn write_agent(home: &Path, name: &str, contents: &str) {
        let directory = home.join("Library").join("LaunchAgents");
        fs::create_dir_all(&directory).expect("fixture directory");
        fs::write(directory.join(name), contents).expect("fixture file");
    }

    fn plist_with_label(label: &str) -> String {
        format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>{label}</string>
  <key>KeepAlive</key>
  <true/>
</dict>
</plist>
"#
        )
    }

    /// 확정·모호·읽지 못함이 담는 경로. 그 셋은 macOS에서만 나오므로 이 헬퍼도 같은 조건으로
    /// 갈라 둔다 — 다른 플랫폼에서는 쓰이지 않는 항목이 되어 clippy가 막는다.
    #[cfg(target_os = "macos")]
    fn agent_path(home: &Path, name: &str) -> String {
        home.join("Library")
            .join("LaunchAgents")
            .join(name)
            .display()
            .to_string()
    }

    /// 완료 조건 1. 대상이 하나면 그 `Label`과 plist 경로가 함께 나온다. 경로는 TASK-123의
    /// `bootstrap`이 인자로 쓴다.
    #[test]
    #[cfg(target_os = "macos")]
    fn a_single_heartbeat_plist_resolves_to_its_label_and_path() {
        let directory = home();
        write_agent(
            directory.path(),
            "com.catze.dream-heartbeat.plist",
            &plist_with_label("com.catze.dream-heartbeat"),
        );

        assert_eq!(
            resolve_service_target(directory.path()),
            HeartbeatServiceTarget::Resolved {
                label: "com.catze.dream-heartbeat".to_owned(),
                plist_path: agent_path(directory.path(), "com.catze.dream-heartbeat.plist"),
            }
        );
    }

    /// 라벨은 파일 이름이 아니라 파일 안의 값이다. 둘이 다른 픽스처가 그 사실을 고정한다.
    #[test]
    #[cfg(target_os = "macos")]
    fn the_label_comes_from_the_file_and_not_from_its_name() {
        let directory = home();
        write_agent(
            directory.path(),
            "my-heartbeat.plist",
            &plist_with_label("com.example.renamed-heartbeat"),
        );

        assert_eq!(
            resolve_service_target(directory.path()),
            HeartbeatServiceTarget::Resolved {
                label: "com.example.renamed-heartbeat".to_owned(),
                plist_path: agent_path(directory.path(), "my-heartbeat.plist"),
            }
        );
    }

    /// 완료 조건 2. 찾는 집합이 데몬의 `_heartbeat_plists`와 같다 — 확장자가 `.plist`가 아니거나
    /// 이름에 `heartbeat`가 없는 파일은 대상이 아니고, 대소문자는 가리지 않는다.
    #[test]
    #[cfg(target_os = "macos")]
    fn only_plists_whose_stem_contains_heartbeat_are_targets() {
        let directory = home();
        write_agent(
            directory.path(),
            "com.google.keystone.agent.plist",
            &plist_with_label("com.google.keystone.agent"),
        );
        write_agent(directory.path(), "heartbeat.txt", "not a plist");
        write_agent(
            directory.path(),
            "com.example.HeartBeat.plist",
            &plist_with_label("com.example.HeartBeat"),
        );

        assert_eq!(
            resolve_service_target(directory.path()),
            HeartbeatServiceTarget::Resolved {
                label: "com.example.HeartBeat".to_owned(),
                plist_path: agent_path(directory.path(), "com.example.HeartBeat.plist"),
            }
        );
    }

    /// 디렉터리는 읽었는데 대상이 없는 상태다. 아래 "읽지 못함"과 갈린다(완료 조건 7).
    #[test]
    #[cfg(target_os = "macos")]
    fn an_empty_directory_is_not_registered() {
        let directory = home();
        fs::create_dir_all(directory.path().join("Library").join("LaunchAgents"))
            .expect("fixture directory");

        assert_eq!(
            resolve_service_target(directory.path()),
            HeartbeatServiceTarget::NotRegistered
        );
    }

    /// 완료 조건 7. 디렉터리가 아예 없는 것은 "등록물 없음"이 아니다. 앱은 등록물을 확인한 적이
    /// 없으므로 없다고 말할 근거가 없다.
    #[test]
    #[cfg(target_os = "macos")]
    fn a_missing_directory_is_unreadable_and_not_not_registered() {
        let directory = home();

        assert_eq!(
            resolve_service_target(directory.path()),
            HeartbeatServiceTarget::Unreadable {
                path: directory
                    .path()
                    .join("Library")
                    .join("LaunchAgents")
                    .display()
                    .to_string(),
            }
        );
    }

    /// 완료 조건 4. 대상이 둘이면 앱이 고르지 않고 찾은 경로를 전부 싣는다(확인 필요 3번).
    #[test]
    #[cfg(target_os = "macos")]
    fn two_targets_are_ambiguous_and_the_app_picks_neither() {
        let directory = home();
        write_agent(
            directory.path(),
            "com.claude-heartbeat.plist",
            &plist_with_label("com.claude-heartbeat"),
        );
        write_agent(
            directory.path(),
            "com.catze.dream-heartbeat.plist",
            &plist_with_label("com.catze.dream-heartbeat"),
        );

        assert_eq!(
            resolve_service_target(directory.path()),
            HeartbeatServiceTarget::Ambiguous {
                plist_paths: vec![
                    agent_path(directory.path(), "com.catze.dream-heartbeat.plist"),
                    agent_path(directory.path(), "com.claude-heartbeat.plist"),
                ],
            }
        );
    }

    /// 완료 조건 5. `Label`을 읽지 못한 경우 파일 이름으로 대신하지 않는다. 데몬의 `_label_of`와
    /// 답이 갈리는 자리다.
    #[test]
    #[cfg(target_os = "macos")]
    fn a_plist_without_a_readable_label_does_not_fall_back_to_the_file_name() {
        let without_key = home();
        write_agent(
            without_key.path(),
            "com.catze.dream-heartbeat.plist",
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>KeepAlive</key>
  <true/>
</dict>
</plist>
"#,
        );
        let not_a_plist = home();
        write_agent(
            not_a_plist.path(),
            "com.catze.dream-heartbeat.plist",
            "이건 plist가 아니다\n",
        );
        let not_a_string = home();
        write_agent(
            not_a_string.path(),
            "com.catze.dream-heartbeat.plist",
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <integer>3</integer>
</dict>
</plist>
"#,
        );

        for directory in [&without_key, &not_a_plist, &not_a_string] {
            assert_eq!(
                resolve_service_target(directory.path()),
                HeartbeatServiceTarget::Unreadable {
                    path: agent_path(directory.path(), "com.catze.dream-heartbeat.plist"),
                }
            );
        }
    }

    /// 중첩 사전 안의 `Label`을 최상위 값으로 잘못 집지 않는다. 잘못 집으면 그것이 곧 엉뚱한
    /// 서비스를 내리는 조작이 된다.
    #[test]
    #[cfg(target_os = "macos")]
    fn a_label_nested_inside_another_dictionary_is_not_the_service_name() {
        let directory = home();
        write_agent(
            directory.path(),
            "com.catze.dream-heartbeat.plist",
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>EnvironmentVariables</key>
  <dict>
    <key>Label</key>
    <string>com.example.nested</string>
  </dict>
</dict>
</plist>
"#,
        );

        assert_eq!(
            resolve_service_target(directory.path()),
            HeartbeatServiceTarget::Unreadable {
                path: agent_path(directory.path(), "com.catze.dream-heartbeat.plist"),
            }
        );
    }

    /// 완료 조건 6. macOS 밖은 언제나 "이 플랫폼이 아님"이고, 등록물이 있어도 디렉터리를 읽지 않는다.
    #[test]
    #[cfg(not(target_os = "macos"))]
    fn outside_macos_the_platform_is_unsupported_whatever_the_directory_holds() {
        let directory = home();
        write_agent(
            directory.path(),
            "com.catze.dream-heartbeat.plist",
            &plist_with_label("com.catze.dream-heartbeat"),
        );

        assert_eq!(
            resolve_service_target(directory.path()),
            HeartbeatServiceTarget::UnsupportedPlatform
        );
    }

    /// 완료 조건 10. 이 경로에서 앱이 파일을 쓰지 않는다. 특히 `~/Library/LaunchAgents`에 쓰기가
    /// 없다. `heartbeat_run_service.rs`가 쓰는 검사 어법(실행 전후 디렉터리 스냅샷 비교)이다.
    #[test]
    fn resolving_the_target_does_not_touch_the_user_home() {
        let directory = home();
        write_agent(
            directory.path(),
            "com.catze.dream-heartbeat.plist",
            &plist_with_label("com.catze.dream-heartbeat"),
        );

        let before = snapshot(directory.path());
        resolve_service_target(directory.path());
        assert_eq!(snapshot(directory.path()), before);
    }

    fn snapshot(home: &Path) -> BTreeMap<String, SystemTime> {
        let mut entries = BTreeMap::new();
        collect(home, &mut entries);
        entries
    }

    fn collect(directory: &Path, entries: &mut BTreeMap<String, SystemTime>) {
        for entry in fs::read_dir(directory).expect("directory listing") {
            let path = entry.expect("directory entry").path();
            let metadata = fs::symlink_metadata(&path).expect("entry metadata");
            entries.insert(
                path.display().to_string(),
                metadata.modified().expect("modified time"),
            );
            if metadata.is_dir() {
                collect(&path, entries);
            }
        }
    }
}
