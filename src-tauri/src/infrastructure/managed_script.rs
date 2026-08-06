//! 앱이 `.workflow/rules/`에 설치하는 실행 자산의 공용 설치 규약(SPEC-015 R2).
//!
//! 자산의 본문·이름·버전은 각 자산 모듈이 [`ManagedScript`] 서술로 넘기고, 이 모듈은 설치 판정과
//! 원자적 쓰기만 갖는다. 판정 규칙은 조건 스크립트가 이 규약을 혼자 쓰던 때와 같다 — 파일이 없으면
//! 설치, 관리 표기가 없으면 오류, 버전 줄을 읽지 못하면 오류, 설치본 버전이 앱 상수보다 크면 오류,
//! 내용이 같으면 쓰지 않음, 관리본이 어긋나 있으면 앱 본문으로 되돌림.
//!
//! 자산은 플랫폼마다 구현이 갈리지만(R1) 설치 액션은 현재 플랫폼의 구현 하나만 만진다(R2). 다른
//! 플랫폼용 파일이 같은 디렉터리에 있어도 읽거나 고치거나 지우지 않는다 — 그 파일은 이 모듈이
//! 조립하는 경로에 걸리지 않으므로 별도의 제외 규칙이 필요 없다.
// `relative_path`는 잡의 `condition` 문자열을 조립하는 TASK-044가 첫 호출처다. 그때까지는 미사용이다.
#![allow(dead_code)]

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use tempfile::NamedTempFile;
use thiserror::Error;

const CONTROL_DIRECTORY: &str = ".workflow";
const RULES_DIRECTORY: &str = "rules";
const MANAGED_MARKER: &str = "# managed_by: workflow-labs";

/// 한 플랫폼용 구현. 확장자와 본문만 다르다.
pub struct PlatformScript {
    /// 점을 뺀 확장자. `sh` | `ps1`.
    pub extension: &'static str,
    pub body: &'static str,
}

/// 앱이 `.workflow/rules/`에 설치하는 실행 자산 하나.
pub struct ManagedScript {
    /// 확장자를 뺀 파일 이름. 구현을 가리지 않고 자산을 식별해야 하는 곳이 쓴다.
    pub stem: &'static str,
    /// 오류 문구에 들어갈 자산 이름.
    pub label: &'static str,
    /// 버전 표기 접두사. 자산마다 다르다 — 이것이 버전 축의 분리다.
    pub version_prefix: &'static str,
    /// 두 구현이 공유하는 버전.
    pub version: u32,
    /// 현재 플랫폼에 설치할 구현.
    pub platform: PlatformScript,
}

pub(crate) struct ManagedScriptPlan {
    pub id: &'static str,
    pub label: &'static str,
    pub path: PathBuf,
    pub installed_version: Option<u32>,
    pub provided_version: u32,
    pub original: Option<Vec<u8>>,
    pub replacement: Option<String>,
}

#[derive(Debug, Error)]
pub enum ManagedScriptError {
    #[error("{path} 경로가 일반 파일이 아니어서 {label}를 설치할 수 없습니다.")]
    NotRegularFile { label: &'static str, path: String },
    #[error("{0}에 앱이 관리하지 않는 파일이 있어 덮어쓰지 않았습니다. 그 파일을 옮기거나 지운 뒤 다시 시도하세요.")]
    Unmanaged(String),
    #[error("{path}의 {label} 버전 {found}이 앱이 아는 버전 {known}보다 높아 덮어쓰지 않았습니다. 앱을 최신 버전으로 올린 뒤 다시 시도하세요.")]
    Downgrade {
        label: &'static str,
        path: String,
        found: u32,
        known: u32,
    },
    #[error("{path}의 {label}가 유효한 UTF-8 파일이 아니어서 관리 자산을 확인할 수 없습니다.")]
    InvalidEncoding { label: &'static str, path: String },
    #[error("{label}를 읽거나 쓰지 못했습니다: {source}")]
    Io {
        label: &'static str,
        source: std::io::Error,
    },
    #[error("임시 파일을 대상 경로로 옮기지 못했습니다: {0}")]
    Persist(String),
}

impl ManagedScript {
    /// 확장자를 붙인 설치 파일 이름.
    pub fn file_name(&self) -> String {
        format!("{}.{}", self.stem, self.platform.extension)
    }

    /// 컨트롤 루트 기준 설치 경로.
    pub fn path(&self, control_root: &Path) -> PathBuf {
        control_root.join(RULES_DIRECTORY).join(self.file_name())
    }

    /// 프로젝트 루트 기준 상대 경로. 항상 `/` 구분자다 — `Path`로 조립한 값을 그대로 쓰면
    /// Windows에서 `\`가 섞인다(`7b6fc69`).
    pub fn relative_path(&self) -> String {
        format!("{CONTROL_DIRECTORY}/{RULES_DIRECTORY}/{}", self.file_name())
    }

    /// 자산을 앱 버전으로 설치한다. 내용이 이미 같으면 파일을 쓰지 않는다.
    pub fn install(&self, control_root: &Path) -> Result<(), ManagedScriptError> {
        let plan = self.plan_install(control_root)?;
        let Some(contents) = plan.replacement else {
            return Ok(());
        };
        let parent = plan
            .path
            .parent()
            .expect("managed script always has a parent");
        fs::create_dir_all(parent).map_err(|error| self.io(error))?;
        self.write_atomically(&plan.path, &contents)
    }

    /// 설치와 같은 판정만 하고 파일은 쓰지 않는다.
    pub fn validate(&self, control_root: &Path) -> Result<(), ManagedScriptError> {
        self.plan_install(control_root).map(|_| ())
    }

    /// 설치 판정과 동일한 읽기 전용 계획을 만든다.
    pub(crate) fn plan_install(
        &self,
        control_root: &Path,
    ) -> Result<ManagedScriptPlan, ManagedScriptError> {
        let path = self.path(control_root);
        if !path.exists() {
            return Ok(ManagedScriptPlan {
                id: "claim_helper",
                label: self.label,
                path,
                installed_version: None,
                provided_version: self.version,
                original: None,
                replacement: Some(self.platform.body.to_owned()),
            });
        }
        self.ensure_regular_file(&path)?;
        let original = fs::read(&path).map_err(|error| self.io(error))?;
        let contents = String::from_utf8(original.clone()).map_err(|_| {
            ManagedScriptError::InvalidEncoding {
                label: self.label,
                path: path.display().to_string(),
            }
        })?;
        if !contents.lines().any(|line| line.trim() == MANAGED_MARKER) {
            return Err(ManagedScriptError::Unmanaged(path.display().to_string()));
        }
        let version = contents
            .lines()
            .find_map(|line| line.trim().strip_prefix(self.version_prefix))
            .and_then(|value| value.trim().parse::<u32>().ok())
            .ok_or_else(|| ManagedScriptError::Unmanaged(path.display().to_string()))?;
        if version > self.version {
            return Err(ManagedScriptError::Downgrade {
                label: self.label,
                path: path.display().to_string(),
                found: version,
                known: self.version,
            });
        }
        let replacement = if contents == self.platform.body {
            None
        } else {
            Some(self.platform.body.to_owned())
        };
        Ok(ManagedScriptPlan {
            id: "claim_helper",
            label: self.label,
            path,
            installed_version: Some(version),
            provided_version: self.version,
            original: Some(original),
            replacement,
        })
    }

    fn ensure_regular_file(&self, path: &Path) -> Result<(), ManagedScriptError> {
        let metadata = fs::symlink_metadata(path).map_err(|error| self.io(error))?;
        if !metadata.file_type().is_file() {
            return Err(ManagedScriptError::NotRegularFile {
                label: self.label,
                path: path.display().to_string(),
            });
        }
        Ok(())
    }

    fn write_atomically(&self, path: &Path, value: &str) -> Result<(), ManagedScriptError> {
        let parent = path
            .parent()
            .ok_or_else(|| ManagedScriptError::Persist(path.display().to_string()))?;
        let mut temporary = NamedTempFile::new_in(parent).map_err(|error| self.io(error))?;
        temporary
            .write_all(value.as_bytes())
            .map_err(|error| self.io(error))?;
        temporary
            .as_file()
            .sync_all()
            .map_err(|error| self.io(error))?;
        temporary
            .persist(path)
            .map_err(|error| ManagedScriptError::Persist(error.to_string()))?;
        Ok(())
    }

    fn io(&self, source: std::io::Error) -> ManagedScriptError {
        ManagedScriptError::Io {
            label: self.label,
            source,
        }
    }
}
