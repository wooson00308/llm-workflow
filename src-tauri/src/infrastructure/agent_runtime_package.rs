//! 앱 번들이 들고 있는 런타임 자산을 앱 데이터의 버전 디렉터리로 설치하는 자리.
//!
//! 설치는 **검증이 끝난 뒤에만** 파일을 만든다. manifest가 적은 모든 파일의 해시와 크기, target,
//! API 주 버전을 먼저 대조하고, 그다음에 임시 디렉터리로 옮기고, 마지막에 제자리로 바꾼다. 중간에
//! 어디서 실패하든 이전 버전 디렉터리와 stable launcher는 손대지 않은 상태로 남는다.
//!
//! **경로를 조립하지 않는다.** 설치 루트는 Tauri가 해석한 앱 데이터 디렉터리에서만 온다. 환경 변수나
//! 화면이 준 문자열로 루트를 만들면 앱이 자기 자산을 어디에 풀지 모르는 상태가 되고, 그 상태에서
//! 쓰기를 시작하면 되돌릴 자리도 잃는다.
//!
//! 번들 자산은 압축물이 아니라 **풀린 one-folder 디렉터리와 그 manifest**다. manifest가 파일마다
//! SHA-256과 크기를 적고 있어서, 푸는 단계를 없애면 검증 대상과 설치 대상이 정확히 같아진다.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::domain::agent_runtime::SUPPORTED_API_MAJOR;

/// 런타임 배포물이 자기 내용을 적는 파일 이름. 런타임 쪽 상수와 같은 값을 쓴다.
pub const MANIFEST_NAME: &str = "runtime-manifest.json";
/// 설치 루트 아래에서 버전 디렉터리들이 모이는 자리.
pub const VERSIONS_DIRECTORY: &str = "versions";

/// manifest가 적은 파일 하나.
#[derive(Debug, Clone, Deserialize)]
struct ManifestFile {
    path: String,
    sha256: String,
    size: u64,
}

/// 배포물 manifest. 런타임이 쓰고 앱은 읽기만 한다.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeManifest {
    pub schema_version: u32,
    pub target: String,
    pub runtime_version: String,
    pub api_major: u32,
    files: Vec<ManifestFile>,
}

/// 설치가 멈춘 지점. 사유마다 사용자가 할 다음 행동이 다르다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PackageFailure {
    /// 번들에 런타임 자산이 없거나 manifest를 읽지 못했다.
    ResourceUnreadable { reason: String },
    /// manifest의 모양이 앱이 아는 계약이 아니다.
    ManifestUnsupported { reason: String },
    /// 이 기기의 target과 배포물의 target이 다르다.
    TargetMismatch { bundled: String, expected: String },
    /// 계약 자체가 통하지 않는 API 주 버전이다.
    ApiMajorMismatch { found: u32, supported: u32 },
    /// manifest가 적은 내용과 실제 파일이 다르다.
    VerificationFailed { path: String },
    /// 파일을 만들지 못했다(권한 등).
    WriteFailed { reason: String },
}

impl PackageFailure {
    pub fn message(&self) -> String {
        match self {
            PackageFailure::ResourceUnreadable { reason } => {
                format!("번들의 런타임 자산을 읽지 못했습니다: {reason}")
            }
            PackageFailure::ManifestUnsupported { reason } => {
                format!("런타임 manifest가 지원 계약이 아닙니다: {reason}")
            }
            PackageFailure::TargetMismatch { bundled, expected } => {
                format!("번들 target({bundled})이 이 기기의 target({expected})과 다릅니다")
            }
            PackageFailure::ApiMajorMismatch { found, supported } => {
                format!("런타임 API 주 버전 {found}은 앱이 지원하는 {supported}과 다릅니다")
            }
            PackageFailure::VerificationFailed { path } => {
                format!("배포물 검증에 실패했습니다: {path}")
            }
            PackageFailure::WriteFailed { reason } => format!("설치에 실패했습니다: {reason}"),
        }
    }
}

/// 이 빌드가 실행되는 기기의 target 이름. 런타임의 target 어휘와 같은 값을 쓴다.
pub fn host_target() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos-universal"
    } else if cfg!(target_os = "windows") {
        "windows-x86_64"
    } else {
        "linux-x86_64"
    }
}

/// 번들 자산의 manifest를 읽고 계약과 target을 대조한다. 아무것도 쓰지 않는다.
///
/// 계획 단계가 부르는 자리다. 여기서 걸리는 것은 파일을 하나도 만들기 전에 걸린다.
pub fn read_manifest(resource: &Path) -> Result<RuntimeManifest, PackageFailure> {
    let raw = fs::read_to_string(resource.join(MANIFEST_NAME)).map_err(|error| {
        PackageFailure::ResourceUnreadable {
            reason: error.to_string(),
        }
    })?;
    let manifest: RuntimeManifest =
        serde_json::from_str(&raw).map_err(|error| PackageFailure::ManifestUnsupported {
            reason: error.to_string(),
        })?;
    if manifest.schema_version != 1 {
        return Err(PackageFailure::ManifestUnsupported {
            reason: format!("schemaVersion {}", manifest.schema_version),
        });
    }
    if manifest.api_major != SUPPORTED_API_MAJOR {
        return Err(PackageFailure::ApiMajorMismatch {
            found: manifest.api_major,
            supported: SUPPORTED_API_MAJOR,
        });
    }
    if manifest.target != host_target() {
        return Err(PackageFailure::TargetMismatch {
            bundled: manifest.target.clone(),
            expected: host_target().to_owned(),
        });
    }
    Ok(manifest)
}

/// manifest가 적은 모든 파일을 실제 내용과 대조한다. 아무것도 쓰지 않는다.
pub fn verify(resource: &Path, manifest: &RuntimeManifest) -> Result<(), PackageFailure> {
    for entry in &manifest.files {
        let candidate = resource.join(&entry.path);
        // 상위 경로 조각이 섞인 항목은 번들 밖으로 나가는 길이다. 검증 대상이 아니라 거절 대상이다.
        if !candidate.starts_with(resource) || entry.path.contains("..") {
            return Err(PackageFailure::VerificationFailed {
                path: entry.path.clone(),
            });
        }
        let bytes = fs::read(&candidate).map_err(|_| PackageFailure::VerificationFailed {
            path: entry.path.clone(),
        })?;
        if bytes.len() as u64 != entry.size || digest(&bytes) != entry.sha256 {
            return Err(PackageFailure::VerificationFailed {
                path: entry.path.clone(),
            });
        }
    }
    Ok(())
}

/// 검증이 끝난 자산을 버전 디렉터리로 설치하고 그 경로를 돌려준다.
///
/// 임시 디렉터리에 먼저 모두 만들고 마지막에 한 번 이동한다. 도중에 실패하면 임시 디렉터리를 지우고
/// 물러나므로, 이전 버전 디렉터리는 이 함수가 성공하든 실패하든 그대로다.
pub fn install(
    resource: &Path,
    install_root: &Path,
    manifest: &RuntimeManifest,
) -> Result<PathBuf, PackageFailure> {
    verify(resource, manifest)?;
    let versions = install_root.join(VERSIONS_DIRECTORY);
    let destination = versions.join(&manifest.runtime_version);
    if destination.is_dir() {
        // 같은 버전이 이미 있으면 다시 풀지 않는다. 도는 프로세스가 그 파일을 쓰고 있을 수 있다.
        return Ok(destination);
    }
    fs::create_dir_all(&versions).map_err(write_failed)?;
    let staging = tempfile::Builder::new()
        .prefix(".runtime-staging-")
        .tempdir_in(&versions)
        .map_err(write_failed)?;

    for entry in &manifest.files {
        let source = resource.join(&entry.path);
        let target = staging.path().join(&entry.path);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(write_failed)?;
        }
        fs::copy(&source, &target).map_err(write_failed)?;
    }
    fs::copy(resource.join(MANIFEST_NAME), staging.path().join(MANIFEST_NAME))
        .map_err(write_failed)?;
    restore_executable_bits(staging.path(), manifest)?;

    let staged = staging.keep();
    match fs::rename(&staged, &destination) {
        Ok(()) => Ok(destination),
        Err(error) => {
            let _ = fs::remove_dir_all(&staged);
            Err(write_failed(error))
        }
    }
}

/// 실행 파일의 실행 권한을 되돌린다. `fs::copy`가 모드를 옮기지만 명시해 두는 편이 안전하다.
#[cfg(unix)]
fn restore_executable_bits(staged: &Path, manifest: &RuntimeManifest) -> Result<(), PackageFailure> {
    use std::os::unix::fs::PermissionsExt;

    for entry in &manifest.files {
        if entry.path.contains('/') {
            continue;
        }
        let path = staged.join(&entry.path);
        let mut permissions = fs::metadata(&path).map_err(write_failed)?.permissions();
        if permissions.mode() & 0o111 != 0 {
            permissions.set_mode(permissions.mode() | 0o755);
            fs::set_permissions(&path, permissions).map_err(write_failed)?;
        }
    }
    Ok(())
}

#[cfg(not(unix))]
fn restore_executable_bits(_staged: &Path, _manifest: &RuntimeManifest) -> Result<(), PackageFailure> {
    Ok(())
}

/// 설치된 launcher가 있어야 할 자리. 런타임이 만드는 이름과 같다.
pub fn launcher_path(install_root: &Path) -> PathBuf {
    let name = if cfg!(windows) { "heartbeat.cmd" } else { "heartbeat" };
    install_root.join("bin").join(name)
}

fn digest(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

fn write_failed(error: std::io::Error) -> PackageFailure {
    PackageFailure::WriteFailed {
        reason: error.to_string(),
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use std::fs;
    use std::path::{Path, PathBuf};

    use pretty_assertions::assert_eq;
    use tempfile::{tempdir, TempDir};

    use super::{
        digest, host_target, install, read_manifest, verify, PackageFailure, MANIFEST_NAME,
        VERSIONS_DIRECTORY,
    };
    use crate::domain::agent_runtime::SUPPORTED_API_MAJOR;

    /// 번들 자산을 흉내 낸다. 실제 런타임 배포물을 검사에 넣지 않는다.
    pub(crate) fn bundled(version: &str) -> TempDir {
        let resource = tempdir().expect("temporary directory");
        write_resource(resource.path(), version, host_target(), SUPPORTED_API_MAJOR);
        resource
    }

    pub(crate) fn write_resource(root: &Path, version: &str, target: &str, api_major: u32) {
        // 실제로 실행되는 스크립트로 둔다. 설치 뒤 launcher 전환은 이 파일을 띄우므로, 텍스트
        // 조각이면 그 단계가 늘 실패해 검사가 한쪽 경로만 보게 된다.
        let executable = format!("#!/bin/sh\n# runtime {version}\nexit 0\n");
        let inner = b"runtime".to_vec();
        fs::create_dir_all(root.join("_internal")).expect("fixture directory");
        fs::write(root.join("heartbeat"), executable.as_bytes()).expect("fixture file");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(root.join("heartbeat"), fs::Permissions::from_mode(0o755))
                .expect("fixture permissions");
        }
        fs::write(root.join("_internal/runtime.bin"), &inner).expect("fixture file");
        let manifest = serde_json::json!({
            "schemaVersion": 1,
            "target": target,
            "runtimeVersion": version,
            "apiMajor": api_major,
            "files": [
                {"path": "heartbeat", "sha256": digest(executable.as_bytes()), "size": executable.len()},
                {"path": "_internal/runtime.bin", "sha256": digest(&inner), "size": inner.len()},
            ],
        });
        fs::write(root.join(MANIFEST_NAME), manifest.to_string()).expect("fixture manifest");
    }

    fn install_root() -> TempDir {
        tempdir().expect("temporary directory")
    }

    fn entries(path: &Path) -> Vec<String> {
        let mut found: Vec<String> = fs::read_dir(path)
            .map(|reader| {
                reader
                    .filter_map(Result::ok)
                    .map(|entry| entry.file_name().to_string_lossy().into_owned())
                    .collect()
            })
            .unwrap_or_default();
        found.sort();
        found
    }

    #[test]
    fn a_verified_resource_lands_in_its_version_directory() {
        let resource = bundled("0.9.0");
        let root = install_root();
        let manifest = read_manifest(resource.path()).expect("manifest");

        let installed = install(resource.path(), root.path(), &manifest).expect("install");

        assert_eq!(installed, root.path().join(VERSIONS_DIRECTORY).join("0.9.0"));
        assert!(installed.join("heartbeat").is_file());
        assert!(installed.join("_internal/runtime.bin").is_file());
        assert!(installed.join(MANIFEST_NAME).is_file());
    }

    #[test]
    fn a_tampered_file_is_refused_before_anything_is_written() {
        let resource = bundled("0.9.0");
        let root = install_root();
        let manifest = read_manifest(resource.path()).expect("manifest");
        fs::write(resource.path().join("_internal/runtime.bin"), b"tampered").expect("tamper");

        let failure = install(resource.path(), root.path(), &manifest).expect_err("refused");

        assert_eq!(
            failure,
            PackageFailure::VerificationFailed {
                path: "_internal/runtime.bin".to_owned(),
            }
        );
        assert_eq!(entries(root.path()), Vec::<String>::new());
    }

    #[test]
    fn a_foreign_target_never_reaches_verification() {
        let resource = tempdir().expect("temporary directory");
        write_resource(resource.path(), "0.9.0", "other-target", SUPPORTED_API_MAJOR);

        let failure = read_manifest(resource.path()).expect_err("refused");

        assert_eq!(
            failure,
            PackageFailure::TargetMismatch {
                bundled: "other-target".to_owned(),
                expected: host_target().to_owned(),
            }
        );
    }

    #[test]
    fn an_incompatible_api_major_is_refused_before_the_target_is_even_read() {
        let resource = tempdir().expect("temporary directory");
        write_resource(resource.path(), "0.9.0", host_target(), SUPPORTED_API_MAJOR + 1);

        let failure = read_manifest(resource.path()).expect_err("refused");

        assert_eq!(
            failure,
            PackageFailure::ApiMajorMismatch {
                found: SUPPORTED_API_MAJOR + 1,
                supported: SUPPORTED_API_MAJOR,
            }
        );
    }

    #[test]
    fn a_failed_install_leaves_no_staging_directory_behind() {
        let resource = bundled("0.9.0");
        let root = install_root();
        let manifest = read_manifest(resource.path()).expect("manifest");
        let previous = install(resource.path(), root.path(), &manifest).expect("first install");
        fs::write(resource.path().join("heartbeat"), b"tampered").expect("tamper");

        let second = tempdir().expect("temporary directory");
        write_resource(second.path(), "1.0.0", host_target(), SUPPORTED_API_MAJOR);
        let broken = read_manifest(second.path()).expect("manifest");
        fs::write(second.path().join("heartbeat"), b"tampered").expect("tamper");
        let failure = install(second.path(), root.path(), &broken).expect_err("refused");

        assert!(matches!(failure, PackageFailure::VerificationFailed { .. }));
        assert!(previous.join("heartbeat").is_file());
        assert_eq!(entries(&root.path().join(VERSIONS_DIRECTORY)), vec!["0.9.0"]);
    }

    #[test]
    fn installing_the_same_version_twice_does_not_disturb_the_first_one() {
        let resource = bundled("0.9.0");
        let root = install_root();
        let manifest = read_manifest(resource.path()).expect("manifest");
        let first = install(resource.path(), root.path(), &manifest).expect("install");
        let marker: PathBuf = first.join("_internal/runtime.bin");
        let before = fs::read(&marker).expect("read");

        let again = install(resource.path(), root.path(), &manifest).expect("install");

        assert_eq!(again, first);
        assert_eq!(fs::read(&marker).expect("read"), before);
    }

    #[test]
    fn verification_refuses_a_manifest_that_points_outside_the_resource() {
        let resource = tempdir().expect("temporary directory");
        write_resource(resource.path(), "0.9.0", host_target(), SUPPORTED_API_MAJOR);
        let manifest = serde_json::json!({
            "schemaVersion": 1, "target": host_target(), "runtimeVersion": "0.9.0",
            "apiMajor": SUPPORTED_API_MAJOR,
            "files": [{"path": "../escape", "sha256": digest(b"x"), "size": 1}],
        });
        fs::write(resource.path().join(MANIFEST_NAME), manifest.to_string()).expect("manifest");
        let manifest = read_manifest(resource.path()).expect("manifest");

        let failure = verify(resource.path(), &manifest).expect_err("refused");

        assert_eq!(
            failure,
            PackageFailure::VerificationFailed {
                path: "../escape".to_owned(),
            }
        );
    }
}
