//! GitHub에 게시된 런타임 릴리스를 받아 번들 자산과 같은 모양의 디렉터리로 준비한다.
//!
//! 릴리스 워크플로의 staging 단계와 같은 규약을 따른다 — 배포물은 `heartbeat/` 한 겹 아래에
//! 풀리고, manifest가 자원 루트에 있어야 하며, Python zipfile이 떨어뜨린 실행 비트는 launcher에
//! 복원한다. 이렇게 준비한 디렉터리는 설치 서비스가 번들 자원과 구분하지 않고 다룬다. 파일 해시
//! 검증을 여기서 반복하지 않는 이유이기도 하다 — 설치 계획과 적용이 manifest 검증을 이미 수행하고,
//! 이 모듈이 하나 더 만들면 두 검증이 갈라질 자리가 생긴다.
//!
//! 네트워크 호출은 `ReleaseFetcher` 갈래 뒤에 둔다. 검사는 실제 GitHub를 부르지 않고 응답과
//! 배포물만 흉내 내야 하며, 조회 실패·계약 밖 응답·깨진 배포물은 기기에서 재현할 수 없기 때문이다.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;

use crate::domain::agent_runtime::{numeric_parts, within_supported_range};
use crate::infrastructure::agent_runtime_package::{host_target, MANIFEST_NAME};

/// 런타임 배포물이 게시되는 저장소. 릴리스 워크플로의 `RUNTIME_REPOSITORY`와 같은 값이다.
pub const RUNTIME_REPOSITORY: &str = "wooson00308/claude-heartbeat";
/// 런타임 릴리스 태그의 접두사. `runtime-v0.9.5` 모양이다.
const RELEASE_TAG_PREFIX: &str = "runtime-v";
/// 설치 루트 아래에서 내려받은 배포물이 설치 전까지 머무는 자리.
pub const DOWNLOADS_DIRECTORY: &str = "runtime-downloads";

/// 게시된 릴리스 조회가 멈춘 지점. 사유마다 사용자가 할 다음 행동이 다르다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReleaseFailure {
    /// 조회나 내려받기가 네트워크에서 실패했다. 다시 시도할 일이다.
    Unreachable { reason: String },
    /// 응답이 기대한 모양이 아니다 — 태그 접두사, 버전 표기, 자산 이름.
    OffContract { detail: String },
    /// 내려받은 배포물을 자원 모양으로 풀지 못했다.
    StagingFailed { reason: String },
}

impl ReleaseFailure {
    /// 화면이 그대로 보여 줄 수 있는 한 줄. 앱이 사유를 지어내지 않는다.
    pub fn message(&self) -> String {
        match self {
            ReleaseFailure::Unreachable { reason } => {
                format!("런타임 릴리스에 연결하지 못했습니다: {reason}")
            }
            ReleaseFailure::OffContract { detail } => {
                format!("런타임 릴리스 응답이 계약 밖입니다: {detail}")
            }
            ReleaseFailure::StagingFailed { reason } => {
                format!("런타임 배포물을 준비하지 못했습니다: {reason}")
            }
        }
    }
}

/// 네트워크 호출을 갈아 끼울 수 있게 하는 자리.
pub trait ReleaseFetcher {
    /// URL 하나의 본문을 문자열로 읽는다.
    fn fetch_text(&self, url: &str) -> Result<String, String>;
    /// URL 하나를 파일로 내려받는다.
    fn download(&self, url: &str, destination: &Path) -> Result<(), String>;
}

/// GitHub를 실제로 부르는 구현.
pub struct HttpReleaseFetcher;

impl ReleaseFetcher for HttpReleaseFetcher {
    fn fetch_text(&self, url: &str) -> Result<String, String> {
        client(Duration::from_secs(30))?
            .get(url)
            .header("Accept", "application/vnd.github+json")
            .send()
            .and_then(|response| response.error_for_status())
            .and_then(|response| response.text())
            .map_err(|error| error.to_string())
    }

    fn download(&self, url: &str, destination: &Path) -> Result<(), String> {
        // 배포물은 수십 MB라 조회와 같은 시한을 쓰면 느린 회선에서 항상 끊긴다.
        let response = client(Duration::from_secs(600))?
            .get(url)
            .send()
            .and_then(|response| response.error_for_status())
            .map_err(|error| error.to_string())?;
        let mut file = fs::File::create(destination).map_err(|error| error.to_string())?;
        let bytes = response.bytes().map_err(|error| error.to_string())?;
        std::io::copy(&mut bytes.as_ref(), &mut file).map_err(|error| error.to_string())?;
        Ok(())
    }
}

fn client(timeout: Duration) -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        // GitHub API는 User-Agent 없는 요청을 거절한다.
        .user_agent("llm-workflow")
        .timeout(timeout)
        .build()
        .map_err(|error| error.to_string())
}

/// 게시된 런타임 릴리스 하나.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeRelease {
    pub version: String,
    pub asset_url: String,
}

/// 조회 결과를 화면이 읽을 모양. 설치 여부 비교는 설치 버전을 이미 아는 화면이 한다.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseCheck {
    pub version: String,
    pub within_supported_range: bool,
}

/// 게시된 최신 런타임을 조회해 화면이 읽을 모양으로 답한다. 아무것도 내려받지 않는다.
pub fn check(fetch: &dyn ReleaseFetcher) -> Result<ReleaseCheck, ReleaseFailure> {
    let release = latest_release(fetch)?;
    Ok(ReleaseCheck {
        within_supported_range: within_supported_range(&release.version),
        version: release.version,
    })
}

/// 게시된 최신 런타임 릴리스를 조회한다. 아무것도 내려받지 않는다.
pub fn latest_release(fetch: &dyn ReleaseFetcher) -> Result<RuntimeRelease, ReleaseFailure> {
    let url = format!("https://api.github.com/repos/{RUNTIME_REPOSITORY}/releases/latest");
    let body = fetch
        .fetch_text(&url)
        .map_err(|reason| ReleaseFailure::Unreachable { reason })?;
    parse_release(&body)
}

/// 릴리스 응답 하나를 읽는다. 태그가 접두사와 점으로 나뉜 숫자 버전이 아니면 계약 밖이다.
///
/// 버전 표기를 여기서 굳히는 것은 표시용이 아니다 — 이 값이 내려받기 디렉터리 이름이 되므로,
/// 숫자와 점 밖의 글자가 들어오면 경로로 새어 나간다.
fn parse_release(body: &str) -> Result<RuntimeRelease, ReleaseFailure> {
    let value: Value = serde_json::from_str(body).map_err(|_| ReleaseFailure::OffContract {
        detail: "응답이 JSON이 아닙니다".to_owned(),
    })?;
    let tag = value
        .get("tag_name")
        .and_then(Value::as_str)
        .ok_or_else(|| ReleaseFailure::OffContract {
            detail: "tag_name이 없습니다".to_owned(),
        })?;
    let version =
        tag.strip_prefix(RELEASE_TAG_PREFIX)
            .ok_or_else(|| ReleaseFailure::OffContract {
                detail: format!("태그가 {RELEASE_TAG_PREFIX} 접두사가 아닙니다: {tag}"),
            })?;
    if numeric_parts(version).is_none() {
        return Err(ReleaseFailure::OffContract {
            detail: format!("버전이 점으로 나뉜 숫자가 아닙니다: {version}"),
        });
    }
    let asset_name = format!("heartbeat-{}.zip", host_target());
    let asset_url = value
        .get("assets")
        .and_then(Value::as_array)
        .and_then(|assets| {
            assets.iter().find(|asset| {
                asset.get("name").and_then(Value::as_str) == Some(asset_name.as_str())
            })
        })
        .and_then(|asset| asset.get("browser_download_url").and_then(Value::as_str))
        .ok_or_else(|| ReleaseFailure::OffContract {
            detail: format!("{asset_name} 자산이 없습니다"),
        })?;
    Ok(RuntimeRelease {
        version: version.to_owned(),
        asset_url: asset_url.to_owned(),
    })
}

/// 릴리스 배포물을 내려받아 `downloads_root/<버전>`에 자원 모양으로 풀어 놓는다.
///
/// 완성본만 최종 이름을 가진다 — 임시 디렉터리에 풀고 마지막에 이름을 바꾸므로, 최종 경로에
/// manifest가 있다는 것이 곧 풀기가 끝났다는 뜻이고 그 경우 다시 내려받지 않는다. 내용이 온전한지는
/// 설치 경로의 manifest 검증이 판정한다.
pub fn stage_release(
    fetch: &dyn ReleaseFetcher,
    release: &RuntimeRelease,
    downloads_root: &Path,
) -> Result<PathBuf, ReleaseFailure> {
    let destination = downloads_root.join(&release.version);
    if destination.join(MANIFEST_NAME).is_file() {
        return Ok(destination);
    }
    fs::create_dir_all(downloads_root).map_err(|error| ReleaseFailure::StagingFailed {
        reason: error.to_string(),
    })?;
    let workspace = tempfile::Builder::new()
        .prefix(".release-staging-")
        .tempdir_in(downloads_root)
        .map_err(|error| ReleaseFailure::StagingFailed {
            reason: error.to_string(),
        })?;
    let archive = workspace.path().join("archive.zip");
    fetch
        .download(&release.asset_url, &archive)
        .map_err(|reason| ReleaseFailure::Unreachable { reason })?;
    let unpacked = workspace.path().join("unpacked");
    unpack(&archive, &unpacked)?;
    let root = single_root(&unpacked)?;
    if !root.join(MANIFEST_NAME).is_file() {
        return Err(ReleaseFailure::StagingFailed {
            reason: "배포물에 manifest가 없습니다".to_owned(),
        });
    }
    restore_launcher_bit(&root)?;
    match fs::rename(&root, &destination) {
        Ok(()) => Ok(destination),
        // 다른 계획 호출이 먼저 끝냈다면 그 완성본을 쓴다.
        Err(_) if destination.join(MANIFEST_NAME).is_file() => Ok(destination),
        Err(error) => Err(ReleaseFailure::StagingFailed {
            reason: error.to_string(),
        }),
    }
}

/// 내려받아 둔 배포물의 자리를 찾는다. 내려받은 적이 없으면 계획을 다시 만들 일이다.
pub fn staged_directory(downloads_root: &Path, version: &str) -> Result<PathBuf, ReleaseFailure> {
    if numeric_parts(version).is_none() {
        return Err(ReleaseFailure::OffContract {
            detail: format!("버전이 점으로 나뉜 숫자가 아닙니다: {version}"),
        });
    }
    let destination = downloads_root.join(version);
    if !destination.join(MANIFEST_NAME).is_file() {
        return Err(ReleaseFailure::StagingFailed {
            reason: "내려받아 둔 배포물이 없습니다. 계획을 다시 만들어 주세요.".to_owned(),
        });
    }
    Ok(destination)
}

/// 설치를 마친 배포물 사본을 지운다. 실패해도 설치 결과에는 영향이 없다.
pub fn discard_staged(staged: &Path) {
    let _ = fs::remove_dir_all(staged);
}

fn unpack(archive: &Path, destination: &Path) -> Result<(), ReleaseFailure> {
    let file = fs::File::open(archive).map_err(|error| ReleaseFailure::StagingFailed {
        reason: error.to_string(),
    })?;
    let mut zip = zip::ZipArchive::new(file).map_err(|error| ReleaseFailure::StagingFailed {
        reason: error.to_string(),
    })?;
    zip.extract(destination)
        .map_err(|error| ReleaseFailure::StagingFailed {
            reason: error.to_string(),
        })
}

/// 배포물의 최상위 디렉터리 하나를 찾는다. 릴리스 워크플로와 같은 규약이다.
fn single_root(unpacked: &Path) -> Result<PathBuf, ReleaseFailure> {
    let entries: Vec<PathBuf> = fs::read_dir(unpacked)
        .map_err(|error| ReleaseFailure::StagingFailed {
            reason: error.to_string(),
        })?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.is_dir())
        .collect();
    match entries.as_slice() {
        [root] => Ok(root.clone()),
        _ => Err(ReleaseFailure::StagingFailed {
            reason: format!(
                "배포물의 최상위 디렉터리가 하나가 아닙니다: {}개",
                entries.len()
            ),
        }),
    }
}

/// Python zipfile이 떨어뜨린 launcher의 실행 비트를 복원한다. 릴리스 워크플로와 같은 규약이다.
#[cfg(unix)]
fn restore_launcher_bit(root: &Path) -> Result<(), ReleaseFailure> {
    use std::os::unix::fs::PermissionsExt;
    let launcher = root.join("heartbeat");
    if !launcher.is_file() {
        return Err(ReleaseFailure::StagingFailed {
            reason: "배포물에 런타임 실행 파일이 없습니다".to_owned(),
        });
    }
    let metadata = fs::metadata(&launcher).map_err(|error| ReleaseFailure::StagingFailed {
        reason: error.to_string(),
    })?;
    let mut permissions = metadata.permissions();
    permissions.set_mode(permissions.mode() | 0o755);
    fs::set_permissions(&launcher, permissions).map_err(|error| ReleaseFailure::StagingFailed {
        reason: error.to_string(),
    })
}

#[cfg(not(unix))]
fn restore_launcher_bit(root: &Path) -> Result<(), ReleaseFailure> {
    if root.join("heartbeat.exe").is_file() {
        Ok(())
    } else {
        Err(ReleaseFailure::StagingFailed {
            reason: "배포물에 런타임 실행 파일이 없습니다".to_owned(),
        })
    }
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::io::Write;

    use super::*;

    fn release_body(tag: &str, asset: &str) -> String {
        serde_json::json!({
            "tag_name": tag,
            "assets": [
                {"name": "latest.json", "browser_download_url": "https://example.invalid/latest.json"},
                {"name": asset, "browser_download_url": format!("https://example.invalid/{asset}")},
            ],
        })
        .to_string()
    }

    fn host_asset() -> String {
        format!("heartbeat-{}.zip", host_target())
    }

    struct FakeFetcher {
        body: String,
        archive: Vec<u8>,
        downloads: RefCell<u32>,
    }

    impl FakeFetcher {
        fn new(body: String, archive: Vec<u8>) -> Self {
            Self {
                body,
                archive,
                downloads: RefCell::new(0),
            }
        }
    }

    impl ReleaseFetcher for FakeFetcher {
        fn fetch_text(&self, _url: &str) -> Result<String, String> {
            Ok(self.body.clone())
        }

        fn download(&self, _url: &str, destination: &Path) -> Result<(), String> {
            *self.downloads.borrow_mut() += 1;
            fs::write(destination, &self.archive).map_err(|error| error.to_string())
        }
    }

    /// 릴리스 워크플로가 만드는 모양의 배포물 — `heartbeat/` 한 겹 아래에 manifest와 실행 파일.
    /// 실행 파일 이름은 target을 따라간다. 윈도우 배포물에는 `heartbeat`가 아니라 `heartbeat.exe`가
    /// 들어 있으므로, 픽스처가 이름을 고정하면 윈도우 검사만 배포물 없음으로 깨진다.
    fn archive_with_root(root: &str) -> Vec<u8> {
        let launcher = if cfg!(windows) {
            "heartbeat.exe"
        } else {
            "heartbeat"
        };
        let mut buffer = std::io::Cursor::new(Vec::new());
        {
            let mut writer = zip::ZipWriter::new(&mut buffer);
            let options = zip::write::SimpleFileOptions::default();
            writer
                .start_file(format!("{root}/{MANIFEST_NAME}"), options)
                .unwrap();
            writer.write_all(b"{\"schemaVersion\":1}").unwrap();
            writer
                .start_file(format!("{root}/{launcher}"), options)
                .unwrap();
            writer.write_all(b"runtime fixture").unwrap();
            writer.finish().unwrap();
        }
        buffer.into_inner()
    }

    #[test]
    fn the_latest_release_is_read_from_the_tag_and_the_host_asset() {
        let fetch = FakeFetcher::new(release_body("runtime-v0.9.5", &host_asset()), Vec::new());

        let release = latest_release(&fetch).expect("release");

        assert_eq!(release.version, "0.9.5");
        assert_eq!(
            release.asset_url,
            format!("https://example.invalid/{}", host_asset())
        );
    }

    #[test]
    fn a_tag_outside_the_contract_is_rejected_before_any_download() {
        for tag in ["v0.9.5", "runtime-v0.9.5-rc1", "runtime-v../evil"] {
            let fetch = FakeFetcher::new(release_body(tag, &host_asset()), Vec::new());
            let error = latest_release(&fetch).expect_err(tag);
            assert!(matches!(error, ReleaseFailure::OffContract { .. }), "{tag}");
        }
    }

    #[test]
    fn a_release_without_the_host_asset_is_off_contract() {
        let fetch = FakeFetcher::new(
            release_body("runtime-v0.9.5", "heartbeat-other-target.zip"),
            Vec::new(),
        );

        let error = latest_release(&fetch).expect_err("asset");

        assert!(matches!(error, ReleaseFailure::OffContract { .. }));
    }

    #[test]
    fn a_staged_release_looks_like_a_bundle_resource() {
        let downloads = tempfile::tempdir().expect("tempdir");
        let fetch = FakeFetcher::new(String::new(), archive_with_root("heartbeat"));
        let release = RuntimeRelease {
            version: "0.9.5".to_owned(),
            asset_url: "https://example.invalid/archive.zip".to_owned(),
        };

        let staged = stage_release(&fetch, &release, downloads.path()).expect("staged");

        assert_eq!(staged, downloads.path().join("0.9.5"));
        assert!(staged.join(MANIFEST_NAME).is_file());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(staged.join("heartbeat"))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o111, 0o111, "launcher는 실행 가능해야 한다");
        }
        assert_eq!(
            staged_directory(downloads.path(), "0.9.5").expect("reuse"),
            staged
        );
    }

    #[test]
    fn a_finished_staging_is_reused_instead_of_downloaded_again() {
        let downloads = tempfile::tempdir().expect("tempdir");
        let fetch = FakeFetcher::new(String::new(), archive_with_root("heartbeat"));
        let release = RuntimeRelease {
            version: "0.9.5".to_owned(),
            asset_url: "https://example.invalid/archive.zip".to_owned(),
        };

        stage_release(&fetch, &release, downloads.path()).expect("first");
        stage_release(&fetch, &release, downloads.path()).expect("second");

        assert_eq!(*fetch.downloads.borrow(), 1);
    }

    #[test]
    fn an_archive_without_a_single_root_or_manifest_stages_nothing() {
        let downloads = tempfile::tempdir().expect("tempdir");
        let release = RuntimeRelease {
            version: "0.9.5".to_owned(),
            asset_url: "https://example.invalid/archive.zip".to_owned(),
        };
        let mut flat = std::io::Cursor::new(Vec::new());
        {
            let mut writer = zip::ZipWriter::new(&mut flat);
            let options = zip::write::SimpleFileOptions::default();
            writer.start_file(MANIFEST_NAME, options).unwrap();
            writer.write_all(b"{}").unwrap();
            writer.finish().unwrap();
        }
        let mut two_roots = std::io::Cursor::new(Vec::new());
        {
            let mut writer = zip::ZipWriter::new(&mut two_roots);
            let options = zip::write::SimpleFileOptions::default();
            for root in ["heartbeat", "extra"] {
                writer
                    .start_file(format!("{root}/{MANIFEST_NAME}"), options)
                    .unwrap();
                writer.write_all(b"{}").unwrap();
            }
            writer.finish().unwrap();
        }

        for archive in [flat.into_inner(), two_roots.into_inner()] {
            let fetch = FakeFetcher::new(String::new(), archive);
            let error = stage_release(&fetch, &release, downloads.path()).expect_err("staging");
            assert!(matches!(error, ReleaseFailure::StagingFailed { .. }));
            assert!(!downloads.path().join("0.9.5").exists());
        }
    }

    #[test]
    fn an_unknown_version_never_becomes_a_path() {
        let downloads = tempfile::tempdir().expect("tempdir");

        for version in ["../escape", "0.9.5-rc1", ""] {
            let error = staged_directory(downloads.path(), version).expect_err(version);
            assert!(
                matches!(error, ReleaseFailure::OffContract { .. }),
                "{version}"
            );
        }
        assert!(matches!(
            staged_directory(downloads.path(), "9.9.9").expect_err("missing"),
            ReleaseFailure::StagingFailed { .. }
        ));
    }

    #[test]
    fn the_check_carries_the_supported_range_verdict() {
        let fetch = FakeFetcher::new(release_body("runtime-v0.9.5", &host_asset()), Vec::new());
        assert_eq!(
            check(&fetch).expect("check"),
            ReleaseCheck {
                version: "0.9.5".to_owned(),
                within_supported_range: true,
            }
        );

        let fetch = FakeFetcher::new(release_body("runtime-v2.0.0", &host_asset()), Vec::new());
        assert_eq!(
            check(&fetch).expect("check"),
            ReleaseCheck {
                version: "2.0.0".to_owned(),
                within_supported_range: false,
            }
        );
    }
}
