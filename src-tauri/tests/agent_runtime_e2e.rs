//! 앱 릴리스가 런타임 배포물과 조회 계약을 같은 경계에서 읽는 종단 회귀 검사.
//!
//! 실제 provider나 운영체제 서비스를 시작하지 않는다. 세 운영체제 CI가 같은 manifest와 JSON
//! fixture를 사용해 target 어휘, API 주 버전, 해시, 상태의 세 값 논리를 검사한다.

#![allow(dead_code)]

use std::fs;

use serde_json::json;
use sha2::{Digest, Sha256};
use tempfile::tempdir;

#[path = "../src/domain/agent_runtime.rs"]
pub mod agent_runtime_impl;

mod domain {
    pub use crate::agent_runtime_impl as agent_runtime;
}

#[path = "../src/infrastructure/agent_runtime_package.rs"]
mod agent_runtime_package;

use agent_runtime_impl::{
    judge, Compatibility, RuntimeStatus, MAXIMUM_RUNTIME_VERSION, MINIMUM_RUNTIME_VERSION,
    SUPPORTED_API_MAJOR,
};
use agent_runtime_package::{host_target, read_manifest, verify, PackageFailure, MANIFEST_NAME};

fn digest(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

fn write_runtime_fixture(api_major: u32) -> tempfile::TempDir {
    let root = tempdir().expect("runtime fixture directory");
    let executable_name = if cfg!(windows) {
        "heartbeat.exe"
    } else {
        "heartbeat"
    };
    let executable = root.path().join(executable_name);
    let bytes = b"standalone runtime fixture\n";
    fs::write(&executable, bytes).expect("runtime fixture executable");
    let manifest = json!({
        "schemaVersion": 1,
        "target": host_target(),
        "runtimeVersion": MINIMUM_RUNTIME_VERSION,
        "apiMajor": api_major,
        "files": [{
            "path": executable_name,
            "sha256": digest(bytes),
            "size": bytes.len(),
        }],
    });
    fs::write(
        root.path().join(MANIFEST_NAME),
        serde_json::to_vec_pretty(&manifest).expect("manifest JSON"),
    )
    .expect("manifest fixture");
    root
}

#[test]
fn the_release_manifest_matches_the_apps_target_api_and_hash_contract() {
    let runtime = write_runtime_fixture(SUPPORTED_API_MAJOR);

    let manifest = read_manifest(runtime.path()).expect("supported runtime manifest");
    verify(runtime.path(), &manifest).expect("verified runtime files");

    let executable_name = if cfg!(windows) {
        "heartbeat.exe"
    } else {
        "heartbeat"
    };
    fs::write(runtime.path().join(executable_name), b"tampered\n").expect("tampered fixture");
    assert!(matches!(
        verify(runtime.path(), &manifest),
        Err(PackageFailure::VerificationFailed { .. })
    ));
}

#[test]
fn an_api_mismatch_is_rejected_before_any_runtime_file_is_installed() {
    let runtime = write_runtime_fixture(SUPPORTED_API_MAJOR + 1);

    assert!(matches!(
        read_manifest(runtime.path()),
        Err(PackageFailure::ApiMajorMismatch { found, supported })
            if found == SUPPORTED_API_MAJOR + 1 && supported == SUPPORTED_API_MAJOR
    ));
}

#[test]
fn the_runtime_status_fixture_preserves_unknown_service_facts_and_is_compatible() {
    let raw = json!({
        "result": "ok",
        "checkedAt": "2026-08-08T09:00:00Z",
        "runtimeVersion": MINIMUM_RUNTIME_VERSION,
        "installedVersion": MINIMUM_RUNTIME_VERSION,
        "runningVersion": null,
        "apiMajor": SUPPORTED_API_MAJOR,
        "target": host_target(),
        "installResult": "installed",
        "recoverable": null,
        "service": {
            "platform": if cfg!(target_os = "macos") { "launchd" } else if cfg!(windows) { "task_scheduler" } else { "systemd" },
            "result": "permission_denied",
            "registered": null,
            "running": null,
            "label": "claude-heartbeat",
            "executable": "",
            "recoverable": null,
            "checkedAt": "2026-08-08T09:00:00Z",
            "evidence": ["permission_denied"],
        },
    });

    let status: RuntimeStatus = serde_json::from_value(raw).expect("runtime status contract");
    assert_eq!(status.service.registered, None);
    assert_eq!(status.service.running, None);
    assert_eq!(status.recoverable, None);
    assert_eq!(judge(&status), Compatibility::Compatible);
    assert!(judge(&status).allows_execution());
}

#[test]
fn the_declared_runtime_range_is_numeric_and_contains_the_release_floor() {
    let numeric = |value: &str| value.split('.').all(|part| part.parse::<u32>().is_ok());

    assert!(numeric(MINIMUM_RUNTIME_VERSION));
    assert!(numeric(MAXIMUM_RUNTIME_VERSION));
    assert_eq!(MINIMUM_RUNTIME_VERSION, "0.8.0");
    assert_eq!(SUPPORTED_API_MAJOR, 1);
}
