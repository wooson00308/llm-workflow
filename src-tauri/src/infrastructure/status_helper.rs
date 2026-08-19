//! 세션이 부르는 상태 조회 도구를 앱 관리 자산으로 서술하는 모듈.
//!
//! 설치·검증·판정 규약은 [`managed_script`](super::managed_script)가 갖는다. 이 모듈에는 자산
//! 서술(본문·이름·버전)만 남는다. 공개 함수는 프로젝트 컨트롤 루트를 인자로 받고, 경로 해석은
//! 호출자가 한다. 선점 헬퍼·조건 스크립트와 같은 자리에 서는 네 번째 실행 자산이다.
//!
//! 두 구현의 본문 상수는 플랫폼과 무관하게 항상 컴파일한다. 설치에 쓰이는 것은 현재 플랫폼의
//! 구현 하나뿐이지만(SPEC-015 R2), 두 본문의 버전 줄을 대조하는 테스트가 양쪽을 모두 읽어야 한다.
//!
//! 앱은 이 도구를 설치만 하고 부르지 않는다. 부르는 것은 세션이고, 도구는 아무것도 쓰지 않는다.
// 다른 플랫폼의 본문 상수와 `status_helper_path`는 현재 플랫폼의 프로덕션 경로에서 쓰이지 않는다.
// 앞의 것은 두 구현을 대조하는 테스트가, 뒤의 것은 설치 결과를 읽는 테스트가 쓴다.
#![allow(dead_code)]

use std::path::{Path, PathBuf};

use crate::infrastructure::managed_script::{ManagedScript, PlatformScript};

/// 확장자를 뺀 상태 조회 도구 파일 이름. 구현을 가리지 않고 이 자산을 식별해야 하는 곳이 쓴다.
const STATUS_HELPER_STEM: &str = "wf-status";
const STATUS_HELPER_LABEL: &str = "상태 조회 도구";
const VERSION_PREFIX: &str = "# status_helper_version:";
const STATUS_HELPER_VERSION: u32 = 1;

/// 설치할 상태 조회 도구의 `sh` 구현.
///
/// 이 판이 담는 것은 호출 계약과 머리글까지다. 진행 집계, 사용자 대기, 활성 선점, 최근 실패는
/// 같은 그룹의 다음 작업이 이 본문에 이어서 채운다(SPEC-084 R3).
const STATUS_HELPER_SH: &str = r#"#!/bin/sh
# managed_by: workflow-labs
# status_helper_version: 1
# LLM Workflow 상태 조회 도구. 워크플로의 지금 상태를 사람용 한 화면 또는 기계용 JSON 한 문서로 낸다.
# 사용법 (프로젝트 루트에서 실행):
#   sh .workflow/rules/wf-status.sh
#   sh .workflow/rules/wf-status.sh --json
#
# 종료 코드로 결과를 판정한다. 출력 문자열로 판정하지 않는다.
#   0 정상
#   1 읽기 실패 (.workflow/project.yml을 읽지 못했다)
#   2 사용법 오류 (알 수 없는 인자, 인자 둘 이상)
#
# 일감의 유무는 종료 코드에 싣지 않는다. 무엇을 집으라는 답은 wf-eligible.sh가 맡는다.
# 이 스크립트는 읽기만 한다. 파일을 만들거나 고치거나 지우지 않고, lease를 잡거나 갱신하지 않고,
# git을 부르지 않는다. 진단 문구는 표준 오류로 내어 표준 출력의 파싱을 깨지 않는다.
#
# 지금 판이 내는 것은 머리글뿐이다. 진행 집계·사용자 대기·활성 선점·최근 실패는 다음 작업이 채운다.
set -u
LC_ALL=C
export LC_ALL

manifest=".workflow/project.yml"
migration_lock=".workflow/.runtime/migration.lock"
json=0
nl='
'

usage() {
  printf 'usage: wf-status [--json]\n' >&2
  exit 2
}

case $# in
  0) ;;
  1)
    [ "$1" = "--json" ] || usage
    json=1
    ;;
  *) usage ;;
esac

if [ ! -f "$manifest" ]; then
  printf '%s를 읽지 못했습니다.\n' "$manifest" >&2
  exit 1
fi

# 값 앞뒤의 공백류와 값을 감싼 따옴표를 걷어낸 결과를 $value에 담는다. serde_yaml은 필요할 때만
# 값을 따옴표로 감싸므로 두 모양이 모두 온다.
trim_value() { # $1=원본 값
  value=$1
  while :; do
    case "$value" in [[:space:]]*) value=${value#?} ;; *) break ;; esac
  done
  while :; do
    case "$value" in *[[:space:]]) value=${value%?} ;; *) break ;; esac
  done
  case "$value" in
    '"'*'"') value=${value#?}; value=${value%?} ;;
    "'"*"'") value=${value#?}; value=${value%?} ;;
  esac
}

# 기계 출력이 담는 값은 문서에서 읽은 한 줄짜리 값이다. 개행이 들어올 수 없으므로 역슬래시와
# 큰따옴표만 이스케이프하면 JSON 문자열 자리가 유효하다.
json_quote() { # $1=원본 값
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

project_name=""
workflows=""
in_list=0
entry_id=""
entry_name=""
entry_status=""

# 모아 둔 항목 하나를 목록에 넣는다. 활성으로 등록된 워크플로만 대상이다(SPEC-084 R7).
# id에는 공백이 들어오지 않으므로 첫 공백이 이름과의 경계가 된다.
flush_entry() {
  if [ -n "$entry_id" ] && [ "$entry_status" = "active" ]; then
    workflows="${workflows}${entry_id} ${entry_name}${nl}"
  fi
  entry_id=""
  entry_name=""
  entry_status=""
}

# project.yml을 한 번 훑어 프로젝트 이름과 활성 워크플로를 모은다. 앱이 serde_yaml로 쓰는 블록
# 표기가 입력이다 — 최상위 키는 0열에서 시작하고, 목록 항목은 "- "로 열려 이어지는 키가 들여쓰인다.
while IFS= read -r line || [ -n "$line" ]; do
  if [ "$in_list" -eq 1 ]; then
    case "$line" in
      '- '*|' '*)
        item=$line
        case "$item" in '- '*) flush_entry; item=${item#- } ;; esac
        trim_value "$item"
        item=$value
        case "$item" in
          'id:'*) trim_value "${item#id:}"; entry_id=$value ;;
          'name:'*) trim_value "${item#name:}"; entry_name=$value ;;
          'status:'*) trim_value "${item#status:}"; entry_status=$value ;;
        esac
        continue
        ;;
      *)
        flush_entry
        in_list=0
        ;;
    esac
  fi
  case "$line" in
    'workflows:'*) in_list=1 ;;
    'name:'*)
      if [ -z "$project_name" ]; then
        trim_value "${line#name:}"
        project_name=$value
      fi
      ;;
  esac
done < "$manifest"
flush_entry

now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
locked=0
[ -f "$migration_lock" ] && locked=1

if [ "$json" -eq 1 ]; then
  if [ "$locked" -eq 1 ]; then locked_json=true; else locked_json=false; fi
  printf '{"schemaVersion":1,"projectName":"%s","generatedAt":"%s","migrationLock":%s,"workflows":[' \
    "$(json_quote "$project_name")" "$now" "$locked_json"
  first=1
  while IFS=' ' read -r wf_id wf_name; do
    [ -n "$wf_id" ] || continue
    [ "$first" -eq 1 ] || printf ','
    first=0
    printf '{"id":"%s","name":"%s"}' "$(json_quote "$wf_id")" "$(json_quote "$wf_name")"
  done <<WORKFLOWS
$workflows
WORKFLOWS
  printf ']}\n'
  exit 0
fi

printf '프로젝트: %s\n' "$project_name"
while IFS=' ' read -r wf_id wf_name; do
  [ -n "$wf_id" ] || continue
  printf '워크플로: %s (%s)\n' "$wf_name" "$wf_id"
done <<WORKFLOWS
$workflows
WORKFLOWS
printf '판정 시각: %s\n' "$now"
if [ "$locked" -eq 1 ]; then
  printf '마이그레이션 락: 걸려 있음\n'
fi
exit 0
"#;

/// 설치할 상태 조회 도구의 PowerShell 구현.
///
/// 본문은 BOM으로 시작한다. Windows PowerShell 5.1은 BOM 없는 `.ps1`을 시스템 코드페이지로 읽어,
/// 비ASCII 문자가 들어가면 본문이 깨지고 문자열 리터럴 안이었다면 출력까지 바뀐다. 설치 판정이
/// 본문과 파일을 그대로 비교하므로 BOM을 본문에 둔다. 세 `.ps1` 관리 자산이 같은 규약을 쓴다.
const STATUS_HELPER_PS1: &str = concat!(
    "\u{feff}",
    r#"# LLM Workflow status reader.
# managed_by: workflow-labs
# status_helper_version: 1
# Usage (run from the project root):
#   powershell -NoProfile -ExecutionPolicy Bypass -File .workflow/rules/wf-status.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File .workflow/rules/wf-status.ps1 --json
#
# Exit codes: 0 normal, 1 read failure, 2 usage error. Whether work exists is never carried by the
# exit code; wf-eligible answers that question.
# This is the Windows twin of wf-status.sh and must produce the same output for every input.
# The body opens with a UTF-8 BOM so PowerShell 5.1 reads UTF-8.
# The script only reads. It creates, edits and deletes nothing, takes no lease, and calls no git.
# Diagnostics go to stderr so stdout stays parseable.
param([string]$Output = '')

$ErrorActionPreference = 'Stop'

$manifest = '.workflow/project.yml'
$migrationLock = '.workflow/.runtime/migration.lock'

function Write-Usage() {
  [Console]::Error.WriteLine('usage: wf-status [--json]')
  exit 2
}

# Windows PowerShell binds a token beginning with `--` to $args instead of the positional
# parameter on some runner versions. Count both paths together so the usage contract holds.
$given = @()
if ($Output -cne '') { $given += $Output }
foreach ($extra in $args) { $given += [string]$extra }
if ($given.Count -gt 1) { Write-Usage }
if ($given.Count -eq 1 -and $given[0] -cne '--json') { Write-Usage }
$json = ($given.Count -eq 1)

if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) {
  [Console]::Error.WriteLine($manifest + '를 읽지 못했습니다.')
  exit 1
}
$lines = @()
try {
  # The manifest is UTF-8 without a BOM. Windows PowerShell 5.1 would otherwise read it in the
  # ANSI code page and mangle every non-ASCII workflow name.
  $lines = @(Get-Content -LiteralPath $manifest -Encoding UTF8 -ErrorAction Stop)
} catch {
  [Console]::Error.WriteLine($manifest + '를 읽지 못했습니다.')
  exit 1
}

# Mirrors trim_value: strips surrounding whitespace and one layer of matching quotes.
function Get-ScalarValue([string]$Raw) {
  $value = $Raw.Trim()
  if ($value.Length -ge 2) {
    $head = $value[0]
    $tail = $value[$value.Length - 1]
    if (($head -ceq '"' -and $tail -ceq '"') -or ($head -ceq "'" -and $tail -ceq "'")) {
      $value = $value.Substring(1, $value.Length - 2)
    }
  }
  return $value
}

# Mirrors json_quote. Values come from one manifest line each, so no newline can reach here.
function ConvertTo-JsonString([string]$Value) {
  return $Value.Replace('\', '\\').Replace('"', '\"')
}

$script:projectName = ''
$script:workflows = @()
$script:entryId = ''
$script:entryName = ''
$script:entryStatus = ''
$inList = $false

# Mirrors flush_entry. Only workflows registered as active are collected (SPEC-084 R7).
function Add-Entry() {
  if ($script:entryId -cne '' -and $script:entryStatus -ceq 'active') {
    $script:workflows += , @($script:entryId, $script:entryName)
  }
  $script:entryId = ''
  $script:entryName = ''
  $script:entryStatus = ''
}

foreach ($line in $lines) {
  $item = $null
  if ($inList) {
    if ($line.StartsWith('- ', [System.StringComparison]::Ordinal)) {
      Add-Entry
      $item = Get-ScalarValue $line.Substring(2)
    } elseif ($line.StartsWith(' ', [System.StringComparison]::Ordinal)) {
      $item = Get-ScalarValue $line
    } else {
      Add-Entry
      $inList = $false
    }
  }
  if ($null -ne $item) {
    if ($item.StartsWith('id:', [System.StringComparison]::Ordinal)) {
      $script:entryId = Get-ScalarValue $item.Substring(3)
    } elseif ($item.StartsWith('name:', [System.StringComparison]::Ordinal)) {
      $script:entryName = Get-ScalarValue $item.Substring(5)
    } elseif ($item.StartsWith('status:', [System.StringComparison]::Ordinal)) {
      $script:entryStatus = Get-ScalarValue $item.Substring(7)
    }
    continue
  }
  if ($line.StartsWith('workflows:', [System.StringComparison]::Ordinal)) {
    $inList = $true
  } elseif ($line.StartsWith('name:', [System.StringComparison]::Ordinal) -and
    $script:projectName -ceq '') {
    $script:projectName = Get-ScalarValue $line.Substring(5)
  }
}
Add-Entry

$now = [DateTime]::UtcNow.ToString('yyyy-MM-dd\THH:mm:ss\Z')
$locked = Test-Path -LiteralPath $migrationLock -PathType Leaf

if ($json) {
  $entries = @()
  foreach ($workflow in $script:workflows) {
    $entries += ('{"id":"' + (ConvertTo-JsonString $workflow[0]) + '","name":"' +
      (ConvertTo-JsonString $workflow[1]) + '"}')
  }
  $lockText = 'false'
  if ($locked) { $lockText = 'true' }
  [Console]::Out.WriteLine('{"schemaVersion":1,"projectName":"' +
    (ConvertTo-JsonString $script:projectName) + '","generatedAt":"' + $now +
    '","migrationLock":' + $lockText + ',"workflows":[' + ($entries -join ',') + ']}')
  exit 0
}

[Console]::Out.WriteLine('프로젝트: ' + $script:projectName)
foreach ($workflow in $script:workflows) {
  [Console]::Out.WriteLine('워크플로: ' + $workflow[1] + ' (' + $workflow[0] + ')')
}
[Console]::Out.WriteLine('판정 시각: ' + $now)
if ($locked) {
  [Console]::Out.WriteLine('마이그레이션 락: 걸려 있음')
}
exit 0
"#
);

/// 현재 플랫폼에 설치할 구현. 런타임 분기가 아니라 컴파일 시점 분기다 — 앱은 자기가 도는 플랫폼의
/// 자산만 쓴다(SPEC-015 R2).
#[cfg(not(windows))]
const PLATFORM: PlatformScript = PlatformScript {
    extension: "sh",
    body: STATUS_HELPER_SH,
};

#[cfg(windows)]
const PLATFORM: PlatformScript = PlatformScript {
    extension: "ps1",
    body: STATUS_HELPER_PS1,
};

/// 상태 조회 도구 자산. 설치 규약은 [`ManagedScript`]가 갖는다.
pub const STATUS_HELPER: ManagedScript = ManagedScript {
    stem: STATUS_HELPER_STEM,
    label: STATUS_HELPER_LABEL,
    version_prefix: VERSION_PREFIX,
    version: STATUS_HELPER_VERSION,
    platform: PLATFORM,
};

/// 컨트롤 루트 기준 상태 조회 도구 경로. 파일 이름은 현재 플랫폼의 구현을 따른다.
pub fn status_helper_path(control_root: &Path) -> PathBuf {
    STATUS_HELPER.path(control_root)
}

#[cfg(test)]
mod tests {
    use std::collections::hash_map::DefaultHasher;
    use std::fs;
    use std::hash::{Hash, Hasher};
    use std::path::{Path, PathBuf};
    use std::process::Command;

    use tempfile::{tempdir, TempDir};

    use crate::infrastructure::managed_script::ManagedScriptError;

    use super::{
        status_helper_path, STATUS_HELPER, STATUS_HELPER_PS1, STATUS_HELPER_SH, STATUS_HELPER_STEM,
        STATUS_HELPER_VERSION, VERSION_PREFIX,
    };

    /// 픽스처가 등록하는 워크플로 하나. `(id, 이름, 상태)`다.
    type WorkflowEntry = (&'static str, &'static str, &'static str);

    const ONE_ACTIVE: &[WorkflowEntry] = &[("wf_ae6cd700", "도그푸딩", "active")];

    /// 프로젝트 루트와 그 안의 컨트롤 루트를 만들고, 앱이 쓰는 모양의 `project.yml`을 둔다.
    fn project(workflows: &[WorkflowEntry]) -> (TempDir, PathBuf) {
        let root = tempdir().expect("project root");
        let control = root.path().join(".workflow");
        fs::create_dir(&control).expect("control root");
        let mut manifest = String::from(
            "schema_version: 2\nproject_id: prj_fixture\nname: workflow-labs\nworkflows:\n",
        );
        for (id, name, status) in workflows {
            manifest.push_str(&format!(
                "- id: {id}\n  directory: {name}--{id}\n  name: {name}\n  status: {status}\n  created_at: 2026-08-01T00:00:00Z\n"
            ));
        }
        fs::write(control.join("project.yml"), manifest).expect("project manifest");
        (root, control)
    }

    /// 상태 조회 도구 한 번 실행의 결과.
    struct StatusRun {
        code: i32,
        stdout: String,
        stderr: String,
    }

    /// 설치된 도구를 그 플랫폼의 방식으로 실행하고 종료 코드와 두 출력을 돌려준다.
    ///
    /// 상대 경로는 자산 서술에서 받는다. 파일 이름을 여기 다시 적으면 그것이 세 번째 사본이 된다.
    /// `current_dir`이 프로젝트 루트인 것은 도구가 상대 경로를 쓰기 때문이다. 플랫폼 분기는 `cfg!`로
    /// 둬서 두 갈래가 모든 러너에서 컴파일된다.
    fn run_status(project_root: &Path, arguments: &[&str]) -> StatusRun {
        let script = STATUS_HELPER.relative_path();
        let mut command = if cfg!(windows) {
            let mut powershell = Command::new("powershell");
            powershell.args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"]);
            powershell.arg(&script);
            powershell
        } else {
            let mut shell = Command::new("sh");
            shell.arg(&script);
            shell
        };
        let output = command
            .args(arguments)
            .current_dir(project_root)
            .output()
            .expect("run status helper");
        StatusRun {
            code: output.status.code().expect("exit code"),
            stdout: String::from_utf8(output.stdout).expect("status stdout is utf-8"),
            stderr: String::from_utf8(output.stderr).expect("status stderr is utf-8"),
        }
    }

    /// 프로젝트 디렉터리의 경로 목록과 파일 내용 해시. 실행 전후로 이 값이 같으면 읽기 전용이다.
    fn snapshot(root: &Path) -> Vec<(String, Option<u64>)> {
        let mut entries = Vec::new();
        collect(root, root, &mut entries);
        entries.sort();
        entries
    }

    fn collect(root: &Path, directory: &Path, entries: &mut Vec<(String, Option<u64>)>) {
        for entry in fs::read_dir(directory).expect("read directory") {
            let path = entry.expect("directory entry").path();
            let relative = path
                .strip_prefix(root)
                .expect("path under root")
                .display()
                .to_string();
            if path.is_dir() {
                entries.push((relative, None));
                collect(root, &path, entries);
            } else {
                let mut hasher = DefaultHasher::new();
                fs::read(&path).expect("file contents").hash(&mut hasher);
                entries.push((relative, Some(hasher.finish())));
            }
        }
    }

    /// C1. 자산이 컨트롤 루트에 현재 플랫폼의 확장자로 서고, 관리 표기와 버전 줄을 달고 있다.
    #[test]
    fn installs_the_status_helper_with_managed_markers() {
        let (_root, control) = project(ONE_ACTIVE);

        STATUS_HELPER.install(&control).expect("install");

        let installed = status_helper_path(&control);
        let expected = if cfg!(windows) {
            "wf-status.ps1"
        } else {
            "wf-status.sh"
        };
        assert_eq!(
            installed.file_name().expect("file name").to_string_lossy(),
            expected
        );
        let body = fs::read_to_string(&installed).expect("installed body");
        assert_eq!(body, STATUS_HELPER.platform.body);
        assert!(body.contains("# managed_by: workflow-labs"));
        assert!(body.contains("# status_helper_version: 1"));
    }

    /// C2. 내용이 이미 같으면 파일을 다시 쓰지 않는다.
    #[test]
    fn installing_twice_leaves_the_file_unchanged() {
        let (_root, control) = project(ONE_ACTIVE);
        let path = status_helper_path(&control);

        STATUS_HELPER.install(&control).expect("first install");
        let first = fs::read_to_string(&path).expect("helper");
        let first_modified = fs::metadata(&path).expect("metadata").modified().ok();
        STATUS_HELPER.install(&control).expect("second install");

        assert_eq!(first, fs::read_to_string(&path).expect("helper again"));
        assert_eq!(
            first_modified,
            fs::metadata(&path).expect("metadata again").modified().ok()
        );
    }

    /// C2. 관리본이 어긋나 있으면 앱 본문으로 되돌린다.
    #[test]
    fn rewrites_a_managed_helper_that_drifted() {
        let (_root, control) = project(ONE_ACTIVE);
        let path = status_helper_path(&control);
        fs::create_dir_all(path.parent().expect("rules root")).expect("rules root");
        fs::write(
            &path,
            "#!/bin/sh\n# managed_by: workflow-labs\n# status_helper_version: 1\nexit 1\n",
        )
        .expect("drifted helper");

        STATUS_HELPER.install(&control).expect("install");

        assert_eq!(
            fs::read_to_string(&path).expect("helper"),
            STATUS_HELPER.platform.body
        );
    }

    /// C3. 관리 표기가 없는 파일은 덮어쓰지 않고 충돌로 끝낸다.
    #[test]
    fn refuses_to_overwrite_an_unmanaged_helper() {
        let (_root, control) = project(ONE_ACTIVE);
        let path = status_helper_path(&control);
        fs::create_dir_all(path.parent().expect("rules root")).expect("rules root");
        let foreign = "#!/bin/sh\nexit 0\n";
        fs::write(&path, foreign).expect("foreign helper");

        let error = STATUS_HELPER
            .install(&control)
            .expect_err("unmanaged helper must not be replaced");

        assert!(matches!(error, ManagedScriptError::Unmanaged(_)));
        assert_eq!(fs::read_to_string(&path).expect("helper"), foreign);
    }

    /// C3. 설치본 버전이 앱 상수보다 높으면 덮어쓰지 않는다.
    #[test]
    fn refuses_to_downgrade_a_future_helper() {
        let (_root, control) = project(ONE_ACTIVE);
        let path = status_helper_path(&control);
        fs::create_dir_all(path.parent().expect("rules root")).expect("rules root");
        let future =
            "#!/bin/sh\n# managed_by: workflow-labs\n# status_helper_version: 999\nexit 1\n";
        fs::write(&path, future).expect("future helper");

        let error = STATUS_HELPER
            .install(&control)
            .expect_err("future helper must not be downgraded");

        assert!(matches!(
            error,
            ManagedScriptError::Downgrade { found: 999, .. }
        ));
        assert_eq!(fs::read_to_string(&path).expect("helper"), future);
    }

    /// C11. 두 구현이 한 버전 상수를 공유하고 관리 표기를 함께 갖는다.
    #[test]
    fn both_implementations_share_the_managed_markers_and_version() {
        let expected = format!("{VERSION_PREFIX} {STATUS_HELPER_VERSION}");
        for body in [STATUS_HELPER_SH, STATUS_HELPER_PS1] {
            assert!(body
                .lines()
                .any(|line| line.trim() == "# managed_by: workflow-labs"));
            assert!(
                body.lines().any(|line| line.trim() == expected),
                "버전 줄이 자산 서술의 값과 다르다"
            );
        }
    }

    /// C11. PowerShell 본문은 바이트 순서 표시로 시작하고 셸 본문은 그렇지 않다.
    #[test]
    fn the_powershell_body_carries_a_byte_order_mark_and_the_shell_body_does_not() {
        assert!(STATUS_HELPER_PS1.starts_with('\u{feff}'));
        assert!(STATUS_HELPER_SH.starts_with("#!/bin/sh"));
    }

    /// 두 구현이 같은 호출 계약과 같은 출력 표기를 문서화한다. 계약이 갈리면 여기서 드러난다.
    #[test]
    fn both_implementations_carry_the_same_interface() {
        for body in [STATUS_HELPER_SH, STATUS_HELPER_PS1] {
            for token in [
                "--json",
                "usage: wf-status",
                "schemaVersion",
                "projectName",
                "generatedAt",
                "migrationLock",
                ".workflow/project.yml",
                ".workflow/.runtime/migration.lock",
                "프로젝트: ",
                "워크플로: ",
                "판정 시각: ",
                "마이그레이션 락: 걸려 있음",
            ] {
                assert!(body.contains(token), "{token}이 한쪽 구현에 없다");
            }
        }
    }

    /// 자산 서술이 자기 버전 축을 갖는다. 선점 헬퍼·조건 스크립트와 접두사가 갈려 있어야
    /// 한쪽 상수만 올려도 다른 설치본이 갱신 대상이 되지 않는다.
    #[test]
    fn the_asset_description_carries_its_own_version_axis() {
        assert_eq!(STATUS_HELPER.version_prefix, VERSION_PREFIX);
        assert_eq!(STATUS_HELPER.version, STATUS_HELPER_VERSION);
        assert_eq!(STATUS_HELPER.stem, STATUS_HELPER_STEM);
        assert_eq!(STATUS_HELPER.relative_path(), {
            let name = if cfg!(windows) {
                "wf-status.ps1"
            } else {
                "wf-status.sh"
            };
            format!(".workflow/rules/{name}")
        });
    }

    /// C6. 인자 없는 호출이 0으로 끝나고 머리글에 프로젝트 이름과 워크플로와 판정 시각이 나온다.
    #[test]
    fn the_human_output_carries_the_header() {
        let (root, control) = project(ONE_ACTIVE);
        STATUS_HELPER.install(&control).expect("install");

        let run = run_status(root.path(), &[]);

        assert_eq!(run.code, 0, "stderr: {}", run.stderr);
        assert!(
            run.stdout.contains("프로젝트: workflow-labs"),
            "{}",
            run.stdout
        );
        assert!(
            run.stdout.contains("워크플로: 도그푸딩 (wf_ae6cd700)"),
            "{}",
            run.stdout
        );
        let stamp = run
            .stdout
            .lines()
            .find_map(|line| line.strip_prefix("판정 시각: "))
            .expect("판정 시각 줄");
        assert_eq!(stamp.len(), 20, "UTC 표기가 아니다: {stamp}");
        assert!(stamp.ends_with('Z'), "UTC 표기가 아니다: {stamp}");
        assert!(!run.stdout.contains("마이그레이션 락"));
    }

    /// C7. `--json` 호출이 0으로 끝나고 표준 출력 전체가 JSON 한 문서로 파싱된다.
    #[test]
    fn the_machine_output_is_one_json_document() {
        let (root, control) = project(ONE_ACTIVE);
        STATUS_HELPER.install(&control).expect("install");

        let run = run_status(root.path(), &["--json"]);

        assert_eq!(run.code, 0, "stderr: {}", run.stderr);
        let value: serde_json::Value =
            serde_json::from_str(&run.stdout).expect("표준 출력 전체가 JSON 한 문서다");
        assert_eq!(value["schemaVersion"], 1);
        assert_eq!(value["projectName"], "workflow-labs");
        assert_eq!(value["migrationLock"], false);
        assert_eq!(value["workflows"][0]["id"], "wf_ae6cd700");
        assert_eq!(value["workflows"][0]["name"], "도그푸딩");
        assert_eq!(value["generatedAt"].as_str().expect("판정 시각").len(), 20);
    }

    /// C8. 알 수 없는 인자와 인자 둘 이상은 사용법 오류다. 진단 문구는 표준 오류로만 나간다.
    #[test]
    fn an_unusable_argument_list_ends_with_the_usage_code() {
        let (root, control) = project(ONE_ACTIVE);
        STATUS_HELPER.install(&control).expect("install");

        for arguments in [
            vec!["--verbose"],
            vec!["json"],
            vec!["--json", "--json"],
            vec!["--json", "extra"],
        ] {
            let run = run_status(root.path(), &arguments);

            assert_eq!(run.code, 2, "{arguments:?}");
            assert!(run.stdout.is_empty(), "{arguments:?}: {}", run.stdout);
            assert!(run.stderr.contains("usage: wf-status"), "{arguments:?}");
        }
    }

    /// C9. 마이그레이션 락이 있어도 두 호출이 0으로 끝나고, 락이 걸린 사실이 머리글에 나온다.
    #[test]
    fn a_migration_lock_is_reported_and_does_not_stop_the_query() {
        let (root, control) = project(ONE_ACTIVE);
        STATUS_HELPER.install(&control).expect("install");
        fs::create_dir_all(control.join(".runtime")).expect("runtime root");
        fs::write(control.join(".runtime/migration.lock"), "").expect("migration lock");

        let human = run_status(root.path(), &[]);
        let machine = run_status(root.path(), &["--json"]);

        assert_eq!(human.code, 0, "stderr: {}", human.stderr);
        assert!(
            human.stdout.contains("마이그레이션 락: 걸려 있음"),
            "{}",
            human.stdout
        );
        assert_eq!(machine.code, 0, "stderr: {}", machine.stderr);
        let value: serde_json::Value = serde_json::from_str(&machine.stdout).expect("json");
        assert_eq!(value["migrationLock"], true);
    }

    /// C10. 실행 전후로 프로젝트 디렉터리의 경로 목록과 내용 해시가 같다(SPEC-084 R6).
    #[test]
    fn running_the_command_changes_no_file() {
        let (root, control) = project(ONE_ACTIVE);
        STATUS_HELPER.install(&control).expect("install");
        let before = snapshot(root.path());

        run_status(root.path(), &[]);
        run_status(root.path(), &["--json"]);
        run_status(root.path(), &["--verbose"]);

        assert_eq!(before, snapshot(root.path()));
    }

    /// C12. 활성 워크플로가 둘이면 둘 다, 서로 구분되게 나온다. 보관된 워크플로는 대상이 아니다.
    #[test]
    fn two_active_workflows_are_reported_separately() {
        let (root, control) = project(&[
            ("wf_ae6cd700", "도그푸딩", "active"),
            ("wf_11112222", "두번째 흐름", "active"),
            ("wf_99998888", "접은 흐름", "archived"),
        ]);
        STATUS_HELPER.install(&control).expect("install");

        let human = run_status(root.path(), &[]);
        let machine = run_status(root.path(), &["--json"]);

        assert_eq!(human.code, 0, "stderr: {}", human.stderr);
        let listed = human
            .stdout
            .lines()
            .filter_map(|line| line.strip_prefix("워크플로: "))
            .collect::<Vec<_>>();
        assert_eq!(
            listed,
            vec!["도그푸딩 (wf_ae6cd700)", "두번째 흐름 (wf_11112222)"]
        );

        assert_eq!(machine.code, 0, "stderr: {}", machine.stderr);
        let value: serde_json::Value = serde_json::from_str(&machine.stdout).expect("json");
        let workflows = value["workflows"].as_array().expect("workflows");
        assert_eq!(workflows.len(), 2);
        assert_eq!(workflows[0]["id"], "wf_ae6cd700");
        assert_eq!(workflows[1]["id"], "wf_11112222");
        assert_eq!(workflows[1]["name"], "두번째 흐름");
    }

    /// 읽기 실패는 1이다. 종료 코드 계약의 세 번째 값이고, 다른 두 값과 갈려 있어야 한다.
    #[test]
    fn a_missing_manifest_ends_with_the_read_failure_code() {
        let (root, control) = project(ONE_ACTIVE);
        STATUS_HELPER.install(&control).expect("install");
        fs::remove_file(control.join("project.yml")).expect("remove manifest");

        let run = run_status(root.path(), &[]);

        assert_eq!(run.code, 1);
        assert!(run.stdout.is_empty(), "{}", run.stdout);
        assert!(
            run.stderr.contains(".workflow/project.yml"),
            "{}",
            run.stderr
        );
    }
}
