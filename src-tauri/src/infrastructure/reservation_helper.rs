//! 자동 배정이 역할 대상과 기존 lease를 함께 예약하는 관리 자산.
//!
//! 이 도구는 lease 파일을 직접 바꾸지 않는다. 대상 선택은 `wf-eligible`의 기계 출력에서 받고,
//! 실제 소유권은 언제나 `wf-claim acquire`가 만든다.

#![allow(dead_code)]

use std::path::{Path, PathBuf};

use crate::infrastructure::managed_script::{ManagedScript, ManagedScriptError, PlatformScript};

pub const RESERVATION_HELPER_STEM: &str = "wf-reserve";
const RESERVATION_HELPER_LABEL: &str = "예약 헬퍼";
const VERSION_PREFIX: &str = "# reservation_helper_version:";
pub(crate) const RESERVATION_HELPER_VERSION: u32 = 2;

const RESERVATION_HELPER_SH: &str = r#"#!/bin/sh
# managed_by: workflow-labs
# reservation_helper_version: 2
# LLM Workflow runtime reservation helper.
# Usage: sh .workflow/rules/wf-reserve.sh acquire <planner|architect|developer> <agent> <minutes>
set -u

role="${2:-}"
agent="${3:-}"
minutes="${4:-}"
condition=".workflow/rules/wf-eligible.sh"
claim=".workflow/rules/wf-claim.sh"
attempt=0
max_attempts=32

usage() {
  echo "usage: wf-reserve.sh acquire <planner|architect|developer> <agent> <minutes>" >&2
  exit 2
}

json_quote() {
  # 대상·lease 식별자는 한 줄 값이지만, 프롬프트에는 공백과 문장 부호가 들어간다. JSON 한 줄 계약을
  # 지키기 위해 역슬래시와 따옴표를 이스케이프한다. 입력은 문서의 한 줄 값이라 개행은 들어오지 않는다.
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

target_from_json() {
  # `wf-eligible --json`의 대상은 선점 헬퍼가 받는 안전한 문서 식별자여야 한다. 다른 값은 새
  # 경로로 넘기지 않고 실패한다.
  printf '%s\n' "$1" | sed -n 's/.*"targetId":"\([A-Za-z0-9_-][A-Za-z0-9_-]*\)".*/\1/p' | head -1
}

expires_of() {
  sed -n 's/^expires_at: *//p' ".workflow/.runtime/leases/$1.yml" | head -1
}

# 지시문은 계약의 요약이 아니라 계약으로 가는 문이다. 계약이 요구하는 중간 단계(기획자의 초안
# 선생성)를 지시문이 생략하면 세션은 지시문의 마무리 서사만 따라가 초안 없이 끝에 한 번에 쓴다 —
# 그동안 화면에는 아무것도 보이지 않는다(2026-08-13 실측). 역할별 필수 중간 단계는 지시문에도 싣는다.
prompt_for() {
  case "$1" in
    planner) role_step="Immediately after verifying ownership, create your result specification file with status: draft and its source references, exactly as the role contract orders, so the writing is visible while you compose. " ;;
    *) role_step="" ;;
  esac
  printf '%s' "You are the $1 role for one pre-reserved LLM Workflow target. Read .workflow/project.yml, .workflow/rules/workflow.md, .workflow/rules/roles/$1.md, and the active workflow documents. The runtime already reserved target $2 with lease $3. Verify ownership first with wf-claim renew using that target and lease; do not acquire again. ${role_step}Use result prefix $4 for any new SPEC or TASK document identifiers, stop if its result path already exists, write the role report, then release the same lease."
}

[ "${1:-}" = acquire ] && [ "$#" -eq 4 ] || usage
case "$role" in planner|architect|developer) ;; *) usage ;; esac
case "$agent" in ''|*[!A-Za-z0-9_.@-]*) usage ;; esac
case "$minutes" in ''|*[!0-9]*) usage ;; esac
[ "$minutes" -gt 0 ] || usage
[ -f "$condition" ] && [ -f "$claim" ] || exit 1

while [ "$attempt" -lt "$max_attempts" ]; do
  attempt=$((attempt + 1))
  condition_output=$(sh "$condition" "$role" --json)
  condition_status=$?
  case "$condition_status" in
    0) ;;
    1) exit 1 ;;
    2) exit 2 ;;
    *) exit 1 ;;
  esac
  target=$(target_from_json "$condition_output")
  [ -n "$target" ] || exit 1

  lease_id=$(sh "$claim" acquire "$target" "$agent" "$minutes")
  claim_status=$?
  case "$claim_status" in
    0) ;;
    3|4) continue ;;
    2) exit 2 ;;
    *) exit 1 ;;
  esac

  expires_at=$(expires_of "$target")
  [ -n "$expires_at" ] || {
    sh "$claim" release "$target" "$lease_id" >/dev/null 2>&1 || :
    exit 1
  }
  result_prefix="RES-$(date -u +%Y%m%dT%H%M%SZ)-${lease_id#lease-}"
  role_prompt=$(prompt_for "$role" "$target" "$lease_id" "$result_prefix")
  printf '{"contractVersion":1,"role":"%s","targetId":"%s","leaseId":"%s","resultPrefix":"%s","expiresAt":"%s","promptVersion":1,"rolePrompt":"%s"}\n' \
    "$(json_quote "$role")" "$(json_quote "$target")" "$(json_quote "$lease_id")" \
    "$(json_quote "$result_prefix")" "$(json_quote "$expires_at")" "$(json_quote "$role_prompt")"
  exit 0
done

# 경쟁이 계속돼도 반복 실행기는 유료 provider를 시작하지 않는다. 다음 주기에 다시 판정한다.
exit 1
"#;

const RESERVATION_HELPER_PS1: &str = r#"# LLM Workflow runtime reservation helper.
# managed_by: workflow-labs
# reservation_helper_version: 2
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File .workflow/rules/wf-reserve.ps1 acquire <role> <agent> <minutes>
param(
  [string]$Command = '',
  [string]$Role = '',
  [string]$Agent = '',
  [string]$Minutes = ''
)

$ErrorActionPreference = 'Stop'
$condition = '.workflow/rules/wf-eligible.ps1'
$claim = '.workflow/rules/wf-claim.ps1'
$maxAttempts = 32

function Stop-Usage() {
  [Console]::Error.WriteLine('usage: wf-reserve.ps1 acquire <planner|architect|developer> <agent> <minutes>')
  exit 2
}

function Get-RolePrompt([string]$Target, [string]$LeaseId, [string]$ResultPrefix) {
  # The prompt is the door to the contract, not its summary. A required mid-step the prompt
  # omits (the planner's draft-first rule) is a step sessions skip.
  $roleStep = ''
  if ($Role -ceq 'planner') {
    $roleStep = 'Immediately after verifying ownership, create your result specification file with status: draft and its source references, exactly as the role contract orders, so the writing is visible while you compose. '
  }
  return "You are the $Role role for one pre-reserved LLM Workflow target. Read .workflow/project.yml, .workflow/rules/workflow.md, .workflow/rules/roles/$Role.md, and the active workflow documents. The runtime already reserved target $Target with lease $LeaseId. Verify ownership first with wf-claim renew using that target and lease; do not acquire again. ${roleStep}Use result prefix $ResultPrefix for any new SPEC or TASK document identifiers, stop if its result path already exists, write the role report, then release the same lease."
}

if ($Command -cne 'acquire') { Stop-Usage }
if ($Role -cnotin @('planner', 'architect', 'developer')) { Stop-Usage }
if ($Agent -notmatch '^[A-Za-z0-9_.@-]+$') { Stop-Usage }
if ($Minutes -notmatch '^[0-9]+$' -or [int]$Minutes -le 0) { Stop-Usage }
if (-not (Test-Path -LiteralPath $condition -PathType Leaf) -or
    -not (Test-Path -LiteralPath $claim -PathType Leaf)) { exit 1 }

for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
  $conditionOutput = & powershell -NoProfile -ExecutionPolicy Bypass -File $condition $Role '--json'
  $conditionStatus = $LASTEXITCODE
  if ($conditionStatus -eq 1) { exit 1 }
  if ($conditionStatus -eq 2) { exit 2 }
  if ($conditionStatus -ne 0) { exit 1 }
  try { $conditionResult = $conditionOutput | ConvertFrom-Json -ErrorAction Stop } catch { exit 1 }
  $target = [string]$conditionResult.targetId
  if ($target -notmatch '^[A-Za-z0-9_-]+$') { exit 1 }

  $leaseId = & powershell -NoProfile -ExecutionPolicy Bypass -File $claim acquire $target $Agent $Minutes
  $claimStatus = $LASTEXITCODE
  if ($claimStatus -eq 3 -or $claimStatus -eq 4) { continue }
  if ($claimStatus -eq 2) { exit 2 }
  if ($claimStatus -ne 0) { exit 1 }
  $leaseId = ([string]$leaseId).Trim()
  $leasePath = Join-Path '.workflow/.runtime/leases' ($target + '.yml')
  $expiresAt = ''
  try {
    $expiresAt = (Get-Content -LiteralPath $leasePath -ErrorAction Stop |
      Where-Object { $_.StartsWith('expires_at:', [System.StringComparison]::Ordinal) } |
      Select-Object -First 1).Substring(11).Trim()
  } catch {
    & powershell -NoProfile -ExecutionPolicy Bypass -File $claim release $target $leaseId | Out-Null
    exit 1
  }
  if ($expiresAt.Length -eq 0) {
    & powershell -NoProfile -ExecutionPolicy Bypass -File $claim release $target $leaseId | Out-Null
    exit 1
  }
  $resultPrefix = 'RES-' + (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ') + '-' + ($leaseId -replace '^lease-', '')
  [ordered]@{
    contractVersion = 1
    role = $Role
    targetId = $target
    leaseId = $leaseId
    resultPrefix = $resultPrefix
    expiresAt = $expiresAt
    promptVersion = 1
    rolePrompt = Get-RolePrompt $target $leaseId $resultPrefix
  } | ConvertTo-Json -Compress -Depth 3
  exit 0
}

exit 1
"#;

#[cfg(not(windows))]
const PLATFORM: PlatformScript = PlatformScript {
    extension: "sh",
    body: RESERVATION_HELPER_SH,
};

#[cfg(windows)]
const PLATFORM: PlatformScript = PlatformScript {
    extension: "ps1",
    body: RESERVATION_HELPER_PS1,
};

pub const RESERVATION_HELPER: ManagedScript = ManagedScript {
    stem: RESERVATION_HELPER_STEM,
    label: RESERVATION_HELPER_LABEL,
    version_prefix: VERSION_PREFIX,
    version: RESERVATION_HELPER_VERSION,
    platform: PLATFORM,
};

pub fn reservation_helper_path(control_root: &Path) -> PathBuf {
    RESERVATION_HELPER.path(control_root)
}

pub fn install_reservation_helper(control_root: &Path) -> Result<(), ManagedScriptError> {
    RESERVATION_HELPER.install(control_root)
}

pub fn validate_reservation_helper(control_root: &Path) -> Result<(), ManagedScriptError> {
    RESERVATION_HELPER.validate(control_root)
}

pub(crate) fn plan_reservation_helper(
    control_root: &Path,
) -> Result<crate::infrastructure::managed_script::ManagedScriptPlan, ManagedScriptError> {
    RESERVATION_HELPER.plan_install(control_root)
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process::Command;

    use tempfile::{tempdir, TempDir};

    use super::{
        install_reservation_helper, reservation_helper_path, RESERVATION_HELPER,
        RESERVATION_HELPER_VERSION,
    };
    use crate::infrastructure::claim_helper::{claim_helper_path, install_claim_helper};
    use crate::infrastructure::heartbeat_condition::install_condition_script;

    fn project() -> (TempDir, PathBuf) {
        let root = tempdir().expect("project root");
        let control = root.path().join(".workflow");
        fs::create_dir(&control).expect("control root");
        install_condition_script(&control).expect("condition script");
        install_claim_helper(&control).expect("claim helper");
        install_reservation_helper(&control).expect("reservation helper");
        (root, control)
    }

    fn write_task(control: &Path, id: &str) {
        let tasks = control.join("wf-demo/tasks");
        fs::create_dir_all(&tasks).expect("tasks root");
        fs::write(
            tasks.join(format!("{id}.md")),
            format!(
                "---\nschema: workflow-labs/task@1\nid: {id}\nstatus: todo\nscope_files: [src/{id}.rs]\n---\n"
            ),
        )
        .expect("task");
    }

    fn run_reservation(project_root: &Path, arguments: &[&str]) -> (i32, String, String) {
        let script = RESERVATION_HELPER.relative_path();
        let mut command = if cfg!(windows) {
            let mut command = Command::new("powershell");
            command.args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", &script]);
            command
        } else {
            let mut command = Command::new("sh");
            command.arg(&script);
            command
        };
        let output = command
            .args(arguments)
            .current_dir(project_root)
            .output()
            .expect("run reservation helper");
        (
            output.status.code().expect("exit code"),
            String::from_utf8(output.stdout).expect("reservation stdout"),
            String::from_utf8(output.stderr).expect("reservation stderr"),
        )
    }

    fn run_claim_renew(project_root: &Path, target: &str, lease_id: &str) -> i32 {
        let script = claim_helper_path(&project_root.join(".workflow"));
        let mut command = if cfg!(windows) {
            let mut command = Command::new("powershell");
            command.args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"]);
            command.arg(script);
            command
        } else {
            let mut command = Command::new("sh");
            command.arg(script);
            command
        };
        command
            .args(["renew", target, lease_id, "30"])
            .current_dir(project_root)
            .status()
            .expect("renew claim")
            .code()
            .expect("renew exit")
    }

    #[test]
    fn reserves_a_target_and_returns_the_handoff_contract() {
        let (root, control) = project();
        write_task(&control, "TASK-001");
        write_task(&control, "TASK-002");

        let (first_code, first_stdout, first_stderr) =
            run_reservation(root.path(), &["acquire", "developer", "dispatcher-a", "30"]);
        let first: serde_json::Value =
            serde_json::from_str(first_stdout.trim()).expect("first reservation JSON");
        let (second_code, second_stdout, second_stderr) =
            run_reservation(root.path(), &["acquire", "developer", "dispatcher-b", "30"]);
        let second: serde_json::Value =
            serde_json::from_str(second_stdout.trim()).expect("second reservation JSON");

        assert_eq!(first_code, 0);
        assert_eq!(second_code, 0);
        assert!(first_stderr.is_empty());
        assert!(second_stderr.is_empty());
        assert_eq!(first["contractVersion"], 1);
        assert_eq!(first["role"], "developer");
        assert_eq!(first["targetId"], "TASK-001");
        assert_eq!(second["targetId"], "TASK-002");
        assert_ne!(first["resultPrefix"], second["resultPrefix"]);
        assert_eq!(first["promptVersion"], 1);
        assert!(first["rolePrompt"]
            .as_str()
            .expect("role prompt")
            .contains("wf-claim renew"));
        assert!(!first["rolePrompt"]
            .as_str()
            .expect("role prompt")
            .contains("Codex"));
        let lease_id = first["leaseId"].as_str().expect("lease id");
        assert_eq!(
            run_claim_renew(root.path(), "TASK-001", lease_id),
            0,
            "handoff lease must renew without a second acquire"
        );
        assert!(control.join(".runtime/leases/TASK-001.yml").is_file());
        assert!(control.join(".runtime/leases/TASK-002.yml").is_file());
    }

    #[test]
    fn racing_reservations_create_only_one_lease_for_one_target() {
        let (root, control) = project();
        write_task(&control, "TASK-001");
        let first_root = root.path().to_owned();
        let second_root = root.path().to_owned();
        let first = std::thread::spawn(move || {
            run_reservation(&first_root, &["acquire", "developer", "dispatcher-a", "30"])
        });
        let second = std::thread::spawn(move || {
            run_reservation(
                &second_root,
                &["acquire", "developer", "dispatcher-b", "30"],
            )
        });
        let first = first.join().expect("first reservation");
        let second = second.join().expect("second reservation");

        assert_eq!(
            [first.0, second.0]
                .into_iter()
                .filter(|code| *code == 0)
                .count(),
            1
        );
        assert_eq!(
            [first.0, second.0]
                .into_iter()
                .filter(|code| *code == 1)
                .count(),
            1
        );
        assert!(control.join(".runtime/leases/TASK-001.yml").is_file());
    }

    #[test]
    fn migration_lock_never_creates_a_reservation() {
        let (root, control) = project();
        write_task(&control, "TASK-001");
        fs::create_dir_all(control.join(".runtime")).expect("runtime root");
        fs::write(control.join(".runtime/migration.lock"), "").expect("migration lock");

        let (code, stdout, _stderr) =
            run_reservation(root.path(), &["acquire", "developer", "dispatcher-a", "30"]);

        assert_eq!(code, 1);
        assert!(stdout.is_empty());
        assert!(!control.join(".runtime/leases/TASK-001.yml").exists());
    }

    #[test]
    fn installs_a_versioned_asset_without_touching_the_other_platform() {
        let (_root, control) = project();
        let helper = reservation_helper_path(&control);
        assert!(helper.is_file());
        assert!(fs::read_to_string(&helper)
            .expect("reservation helper")
            .contains("# reservation_helper_version: 2"));
        let other = control.join("rules").join(if cfg!(windows) {
            "wf-reserve.sh"
        } else {
            "wf-reserve.ps1"
        });
        let foreign = "# managed_by: workflow-labs\n# reservation_helper_version: 999\nforeign\n";
        fs::write(&other, foreign).expect("other platform helper");
        install_reservation_helper(&control).expect("current platform install");
        assert_eq!(fs::read_to_string(other).expect("other helper"), foreign);
        assert_eq!(RESERVATION_HELPER_VERSION, 2);
    }

    #[test]
    fn refuses_to_overwrite_a_future_reservation_helper() {
        let (_root, control) = project();
        let helper = reservation_helper_path(&control);
        let future = fs::read_to_string(&helper)
            .expect("reservation helper")
            .replace(
                "# reservation_helper_version: 2",
                "# reservation_helper_version: 999",
            );
        fs::write(&helper, &future).expect("future helper");

        let error = install_reservation_helper(&control).expect_err("future helper must remain");

        assert!(error.to_string().contains("999"));
        assert_eq!(fs::read_to_string(helper).expect("future helper"), future);
    }
}
