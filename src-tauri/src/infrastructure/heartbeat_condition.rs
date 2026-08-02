//! 하트비트 잡의 조건 스크립트를 앱 관리 자산으로 설치하는 모듈.
//!
//! 공개 함수는 프로젝트 컨트롤 루트를 인자로 받는다. 경로 해석은 커맨드 계층이 한다.
// 설치 액션(TASK-007)이 이 모듈을 호출하기 전까지는 전부 미사용이다. 연결이 끝나면 이 줄을 지운다.
#![allow(dead_code)]

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use tempfile::NamedTempFile;
use thiserror::Error;

const RULES_DIRECTORY: &str = "rules";
const CONDITION_SCRIPT_FILE: &str = "wf-eligible.sh";
const MANAGED_MARKER: &str = "# managed_by: workflow-labs";
const VERSION_PREFIX: &str = "# condition_script_version:";
const CONDITION_SCRIPT_VERSION: u32 = 1;

/// 설치할 조건 스크립트 본문.
///
/// `#!/bin/sh` 다음 두 줄이 앱 관리 표기이고, 그 아래는 `scripts/wf-eligible.sh`와 같다.
/// 판정 로직을 여기서 고치지 않는다. 원본과 다르게 만들면 설치본과 저장소 스크립트의 동작이 갈라진다.
const CONDITION_SCRIPT: &str = r#"#!/bin/sh
# managed_by: workflow-labs
# condition_script_version: 1
# LLM Workflow 하트비트 조건 검사. 역할별 처리 가능한 대상이 있으면 0, 없으면 1을 반환한다.
# 사용법: sh scripts/wf-eligible.sh planner|architect|developer  (프로젝트 루트에서 실행)
set -u

role="${1:-}"
leases=".workflow/.runtime/leases"

[ -f ".workflow/.runtime/migration.lock" ] && exit 1

case "$role" in
planner)
  for wf in .workflow/*/; do
    [ -d "${wf}ideas" ] || continue
    for f in "${wf}"ideas/*.md; do
      [ -f "$f" ] || continue
      id=$(sed -n 's/^id: *//p' "$f" | head -1)
      [ -n "$id" ] || continue
      grep -qs "source_idea_id: *$id" "${wf}"specs/*.md 2>/dev/null && continue
      [ -f "$leases/$id.yml" ] && continue
      exit 0
    done
  done
  ;;
architect)
  for wf in .workflow/*/; do
    [ -d "${wf}decisions" ] || continue
    for d in "${wf}"decisions/*.md; do
      [ -f "$d" ] || continue
      grep -qs "^outcome: approved" "$d" || continue
      did=$(sed -n 's/^id: *//p' "$d" | head -1)
      [ -n "$did" ] || continue
      grep -qs "source_decision_id: *$did" "${wf}"tasks/*.md 2>/dev/null && continue
      spec=$(sed -n 's/^spec_id: *//p' "$d" | head -1)
      if [ -n "$spec" ] && [ -f "$leases/$spec.yml" ]; then continue; fi
      exit 0
    done
  done
  ;;
developer)
  for wf in .workflow/*/; do
    [ -d "${wf}tasks" ] || continue
    for f in "${wf}"tasks/*.md; do
      [ -f "$f" ] || continue
      grep -qs "^status: todo" "$f" || continue
      tid=$(sed -n 's/^id: *//p' "$f" | head -1)
      [ -n "$tid" ] || continue
      [ -f "$leases/$tid.yml" ] && continue
      exit 0
    done
  done
  ;;
*)
  echo "usage: wf-eligible.sh planner|architect|developer" >&2
  exit 2
  ;;
esac
exit 1
"#;

#[derive(Debug, Error)]
pub enum ConditionScriptError {
    #[error("{0} 경로가 일반 파일이 아니어서 조건 스크립트를 설치할 수 없습니다.")]
    NotRegularFile(String),
    #[error("{0}에 앱이 관리하지 않는 파일이 있어 덮어쓰지 않았습니다. 그 파일을 옮기거나 지운 뒤 다시 시도하세요.")]
    Unmanaged(String),
    #[error("{path}의 조건 스크립트 버전 {found}이 앱이 아는 버전 {known}보다 높아 덮어쓰지 않았습니다. 앱을 최신 버전으로 올린 뒤 다시 시도하세요.")]
    Downgrade {
        path: String,
        found: u32,
        known: u32,
    },
    #[error("조건 스크립트를 읽거나 쓰지 못했습니다: {0}")]
    Io(#[from] std::io::Error),
    #[error("임시 파일을 대상 경로로 옮기지 못했습니다: {0}")]
    Persist(String),
}

/// 컨트롤 루트 기준 조건 스크립트 경로. 프로젝트 루트에서 보면 `.workflow/rules/wf-eligible.sh`다.
pub fn condition_script_path(control_root: &Path) -> PathBuf {
    control_root
        .join(RULES_DIRECTORY)
        .join(CONDITION_SCRIPT_FILE)
}

/// 조건 스크립트를 앱 버전으로 설치한다. 내용이 이미 같으면 파일을 쓰지 않는다.
pub fn install_condition_script(control_root: &Path) -> Result<(), ConditionScriptError> {
    let path = condition_script_path(control_root);
    let Some(contents) = plan_condition_script(&path)? else {
        return Ok(());
    };
    fs::create_dir_all(path.parent().expect("condition script always has a parent"))?;
    write_text_atomically(&path, &contents)
}

/// 설치와 같은 판정만 하고 파일은 쓰지 않는다.
pub fn validate_condition_script(control_root: &Path) -> Result<(), ConditionScriptError> {
    plan_condition_script(&condition_script_path(control_root)).map(|_| ())
}

/// 써야 할 본문을 결정한다. 쓸 필요가 없으면 `None`, 덮어쓰면 안 되는 파일이면 오류다.
fn plan_condition_script(path: &Path) -> Result<Option<String>, ConditionScriptError> {
    if !path.exists() {
        return Ok(Some(CONDITION_SCRIPT.to_owned()));
    }
    ensure_regular_file(path)?;
    let contents = fs::read_to_string(path)?;
    if !contents.lines().any(|line| line.trim() == MANAGED_MARKER) {
        return Err(ConditionScriptError::Unmanaged(path.display().to_string()));
    }
    let version = contents
        .lines()
        .find_map(|line| line.trim().strip_prefix(VERSION_PREFIX))
        .and_then(|value| value.trim().parse::<u32>().ok())
        .ok_or_else(|| ConditionScriptError::Unmanaged(path.display().to_string()))?;
    if version > CONDITION_SCRIPT_VERSION {
        return Err(ConditionScriptError::Downgrade {
            path: path.display().to_string(),
            found: version,
            known: CONDITION_SCRIPT_VERSION,
        });
    }
    if contents == CONDITION_SCRIPT {
        Ok(None)
    } else {
        Ok(Some(CONDITION_SCRIPT.to_owned()))
    }
}

fn ensure_regular_file(path: &Path) -> Result<(), ConditionScriptError> {
    if !fs::symlink_metadata(path)?.file_type().is_file() {
        return Err(ConditionScriptError::NotRegularFile(
            path.display().to_string(),
        ));
    }
    Ok(())
}

fn write_text_atomically(path: &Path, value: &str) -> Result<(), ConditionScriptError> {
    let parent = path
        .parent()
        .ok_or_else(|| ConditionScriptError::Persist(path.display().to_string()))?;
    let mut temporary = NamedTempFile::new_in(parent)?;
    temporary.write_all(value.as_bytes())?;
    temporary.as_file().sync_all()?;
    temporary
        .persist(path)
        .map_err(|error| ConditionScriptError::Persist(error.to_string()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::fs;
    #[cfg(unix)]
    use std::path::Path;
    use std::path::PathBuf;

    use tempfile::{tempdir, TempDir};

    use super::{
        condition_script_path, install_condition_script, ConditionScriptError, CONDITION_SCRIPT,
    };

    /// 프로젝트 루트와 그 안의 컨트롤 루트를 만든다.
    fn project() -> (TempDir, PathBuf) {
        let root = tempdir().expect("project root");
        let control = root.path().join(".workflow");
        fs::create_dir(&control).expect("control root");
        (root, control)
    }

    #[test]
    fn installs_condition_script_with_managed_markers() {
        let (_root, control) = project();

        install_condition_script(&control).expect("install condition script");

        let script = fs::read_to_string(condition_script_path(&control)).expect("script");
        assert!(script.starts_with("#!/bin/sh\n"));
        assert!(script.contains("# managed_by: workflow-labs"));
        assert!(script.contains("# condition_script_version: 1"));
        assert!(script.contains("migration.lock"));
    }

    #[test]
    fn installing_twice_leaves_the_file_unchanged() {
        let (_root, control) = project();
        let path = condition_script_path(&control);

        install_condition_script(&control).expect("first install");
        let first = fs::read_to_string(&path).expect("script");
        let first_modified = fs::metadata(&path).expect("metadata").modified().ok();
        install_condition_script(&control).expect("second install");

        assert_eq!(first, fs::read_to_string(&path).expect("script again"));
        assert_eq!(
            first_modified,
            fs::metadata(&path).expect("metadata again").modified().ok()
        );
    }

    #[test]
    fn refuses_to_overwrite_an_unmanaged_script() {
        let (_root, control) = project();
        let path = condition_script_path(&control);
        fs::create_dir_all(path.parent().expect("rules root")).expect("rules root");
        let foreign = "#!/bin/sh\nexit 0\n";
        fs::write(&path, foreign).expect("foreign script");

        let error =
            install_condition_script(&control).expect_err("unmanaged script must not be replaced");

        assert!(matches!(error, ConditionScriptError::Unmanaged(_)));
        assert_eq!(fs::read_to_string(&path).expect("script"), foreign);
    }

    #[test]
    fn refuses_to_downgrade_a_future_script() {
        let (_root, control) = project();
        let path = condition_script_path(&control);
        fs::create_dir_all(path.parent().expect("rules root")).expect("rules root");
        let future =
            "#!/bin/sh\n# managed_by: workflow-labs\n# condition_script_version: 999\nexit 1\n";
        fs::write(&path, future).expect("future script");

        let error =
            install_condition_script(&control).expect_err("future script must not be downgraded");

        assert!(matches!(
            error,
            ConditionScriptError::Downgrade { found: 999, .. }
        ));
        assert_eq!(fs::read_to_string(&path).expect("script"), future);
    }

    #[test]
    fn refuses_a_script_without_a_readable_version() {
        let (_root, control) = project();
        let path = condition_script_path(&control);
        fs::create_dir_all(path.parent().expect("rules root")).expect("rules root");
        let broken = "#!/bin/sh\n# managed_by: workflow-labs\nexit 1\n";
        fs::write(&path, broken).expect("versionless script");

        let error = install_condition_script(&control)
            .expect_err("a script without a version must not be replaced");

        assert!(matches!(error, ConditionScriptError::Unmanaged(_)));
        assert_eq!(fs::read_to_string(&path).expect("script"), broken);
    }

    #[test]
    fn rewrites_a_managed_script_that_drifted() {
        let (_root, control) = project();
        let path = condition_script_path(&control);
        fs::create_dir_all(path.parent().expect("rules root")).expect("rules root");
        fs::write(
            &path,
            "#!/bin/sh\n# managed_by: workflow-labs\n# condition_script_version: 1\nexit 1\n",
        )
        .expect("drifted script");

        install_condition_script(&control).expect("install condition script");

        assert_eq!(fs::read_to_string(&path).expect("script"), CONDITION_SCRIPT);
    }

    #[cfg(unix)]
    fn run_condition(project_root: &Path, role: &str) -> i32 {
        use std::process::Command;

        Command::new("sh")
            .arg(".workflow/rules/wf-eligible.sh")
            .arg(role)
            .current_dir(project_root)
            .status()
            .expect("run condition script")
            .code()
            .expect("exit code")
    }

    #[cfg(unix)]
    #[test]
    fn installed_script_reports_eligible_work() {
        let (root, control) = project();
        install_condition_script(&control).expect("install condition script");
        let tasks = control.join("wf-demo/tasks");
        fs::create_dir_all(&tasks).expect("tasks root");
        fs::write(
            tasks.join("TASK-001.md"),
            "---\nschema: workflow-labs/task@1\nid: TASK-001\nstatus: todo\n---\n",
        )
        .expect("todo task");

        assert_eq!(run_condition(root.path(), "developer"), 0);
    }

    #[cfg(unix)]
    #[test]
    fn installed_script_reports_no_eligible_work() {
        let (root, control) = project();
        install_condition_script(&control).expect("install condition script");
        let tasks = control.join("wf-demo/tasks");
        fs::create_dir_all(&tasks).expect("tasks root");
        fs::write(
            tasks.join("TASK-001.md"),
            "---\nschema: workflow-labs/task@1\nid: TASK-001\nstatus: qa_waiting\n---\n",
        )
        .expect("claimed task");
        fs::create_dir_all(control.join("wf-demo/decisions")).expect("decisions root");

        assert_eq!(run_condition(root.path(), "developer"), 1);
        assert_eq!(run_condition(root.path(), "planner"), 1);
        assert_eq!(run_condition(root.path(), "architect"), 1);
    }

    #[cfg(unix)]
    #[test]
    fn installed_script_rejects_an_unknown_role() {
        let (root, control) = project();
        install_condition_script(&control).expect("install condition script");

        assert_eq!(run_condition(root.path(), "reviewer"), 2);
    }

    #[cfg(unix)]
    #[test]
    fn installed_script_reports_no_work_while_migration_lock_exists() {
        let (root, control) = project();
        install_condition_script(&control).expect("install condition script");
        let tasks = control.join("wf-demo/tasks");
        fs::create_dir_all(&tasks).expect("tasks root");
        fs::write(
            tasks.join("TASK-001.md"),
            "---\nschema: workflow-labs/task@1\nid: TASK-001\nstatus: todo\n---\n",
        )
        .expect("todo task");
        fs::create_dir_all(control.join(".runtime")).expect("runtime root");
        fs::write(control.join(".runtime/migration.lock"), "").expect("migration lock");

        assert_eq!(run_condition(root.path(), "developer"), 1);
    }
}
