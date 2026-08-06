use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use chrono::Utc;
use thiserror::Error;

const RUNTIME_DIRECTORY: &str = ".runtime";
const WRITE_LOCK_FILE: &str = "migration.lock";

#[derive(Debug, Error)]
pub enum ProjectWriteLockError {
    #[error("다른 프로젝트 쓰기 작업이 진행 중입니다.")]
    Busy,
    #[error("프로젝트 쓰기 잠금을 처리하지 못했습니다: {0}")]
    Io(#[from] std::io::Error),
}

/// 관리 자산 동기화와 문서 마이그레이션이 공유하는 배타적 쓰기 잠금.
///
/// 기존 에이전트 계약과 호환되도록 파일 이름은 `migration.lock`을 유지한다.
/// `create_new` 한 번으로 소유자를 결정하므로 존재 확인과 생성 사이의 경합이 없다.
pub struct ProjectWriteLock {
    path: PathBuf,
}

impl ProjectWriteLock {
    pub fn acquire(control_root: &Path) -> Result<Self, ProjectWriteLockError> {
        let runtime = control_root.join(RUNTIME_DIRECTORY);
        fs::create_dir_all(&runtime)?;
        let path = runtime.join(WRITE_LOCK_FILE);
        let mut file = match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                return Err(ProjectWriteLockError::Busy)
            }
            Err(error) => return Err(error.into()),
        };

        if let Err(error) =
            writeln!(file, "created_at: {}", Utc::now().to_rfc3339()).and_then(|_| file.sync_all())
        {
            let _ = fs::remove_file(&path);
            return Err(error.into());
        }

        Ok(Self { path })
    }
}

impl Drop for ProjectWriteLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    use super::{ProjectWriteLock, ProjectWriteLockError};

    #[test]
    fn only_one_writer_can_hold_the_project_lock() {
        let root = tempdir().expect("root");
        let control = root.path().join(".workflow");
        let first = ProjectWriteLock::acquire(&control).expect("first lock");

        assert!(matches!(
            ProjectWriteLock::acquire(&control),
            Err(ProjectWriteLockError::Busy)
        ));

        drop(first);
        ProjectWriteLock::acquire(&control).expect("lock after release");
    }

    #[test]
    fn a_failed_lock_body_write_does_not_leave_a_lock() {
        let root = tempdir().expect("root");
        let control = root.path().join(".workflow");
        let runtime = control.join(".runtime");
        fs::create_dir_all(&runtime).expect("runtime");
        fs::create_dir(runtime.join("migration.lock")).expect("directory at lock path");

        assert!(ProjectWriteLock::acquire(&control).is_err());
        assert!(runtime.join("migration.lock").is_dir());
    }
}
