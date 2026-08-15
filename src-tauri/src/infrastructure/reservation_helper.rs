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
pub(crate) const RESERVATION_HELPER_VERSION: u32 = 5;

const RESERVATION_HELPER_SH: &str = r#"#!/bin/sh
# managed_by: workflow-labs
# reservation_helper_version: 5
# LLM Workflow runtime reservation helper.
# Usage: sh .workflow/rules/wf-reserve.sh acquire <planner|architect|developer> <agent> <minutes>
set -u

role="${2:-}"
agent="${3:-}"
minutes="${4:-}"
condition=".workflow/rules/wf-eligible.sh"
claim=".workflow/rules/wf-claim.sh"
isolation_root=".workflow/.runtime/isolation"
worktree_root=".workflow/.runtime/worktrees"
attempt=0
max_attempts=32
workspace_path=""
control_root=""
base_commit=""
branch=""

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
prompt_for() { # $1=역할 $2=대상 $3=lease $4=결과 접두사 $5=사본 경로 $6=제어 문서 정본
  case "$1" in
    planner) role_step="Immediately after verifying ownership, create your result specification file with status: draft and its source references, exactly as the role contract orders, so the writing is visible while you compose. " ;;
    architect) role_step="For a new approval, immediately create the result work-group file with status: preparing and its source references, exactly as the role contract orders, so architecture progress is visible before you compose tasks. " ;;
    developer) role_step="Write product code, build, and run this task's checks only in the isolated working copy prepared at $5. The workflow control documents stay canonical at $6, so task status, leases, and role reports are written there and never mixed into the isolated branch. " ;;
    *) role_step="" ;;
  esac
  printf '%s' "You are the $1 role for one pre-reserved LLM Workflow target. Read .workflow/project.yml, .workflow/rules/workflow.md, .workflow/rules/roles/$1.md, and the active workflow documents. The runtime already reserved target $2 with lease $3. Verify ownership first with wf-claim renew using that target and lease; do not acquire again. ${role_step}Name any new SPEC, GROUP, or TASK document by the lineage rule in workflow.md (SPEC-NNN, GROUP-NNN, TASK-SNNN-KK); result prefix $4 names this reservation for your report only and never enters a document identifier. Stop before overwriting any existing document path, write the role report, then release the same lease."
}

# 개발 세션은 사용자가 지금 쓰고 있는 작업 공간을 함께 쓰지 않는다. 준비가 끝난 사본만 세션에
# 넘기고, 준비가 실패하면 만들다 만 자원을 지운 뒤 lease를 반납해 세션 자체를 시작하지 않는다.
write_isolation_record() { # $1=준비 단계 이름
  mkdir -p "$isolation_root" 2>/dev/null || return 1
  printf '%s\nschema_version: 1\ntarget_id: %s\nlease_id: %s\nbase_commit: %s\nbranch: %s\nworkspace_path: %s\ncontrol_root: %s\nprepared_at: %s\nstep: %s\n' \
    '# managed_by: workflow-labs. 앱이 소유하는 상태이므로 에이전트 세션이 직접 고치지 않는다.' \
    "$target" "$lease_id" "$base_commit" "$branch" "$workspace_path" "$control_root" \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" >"$isolation_root/$target.yml" 2>/dev/null
}

discard_isolation() {
  git worktree remove --force "$workspace_path" >/dev/null 2>&1 || :
  rm -rf "$workspace_path" >/dev/null 2>&1 || :
  git worktree prune >/dev/null 2>&1 || :
  git branch -D "$branch" >/dev/null 2>&1 || :
}

prepare_isolation() {
  # 기준을 확정하지 못하면 공유 작업 공간에서 대신 시작하지 않는다. 사본이 없으면 예약도 없다.
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 1
  base_commit=$(git rev-parse HEAD 2>/dev/null) || return 1
  [ -n "$base_commit" ] || return 1
  project_root=$(pwd) || return 1
  control_root="$project_root/.workflow"
  # 이름은 대상과 lease 식별자만으로 만든다. lease 식별자가 실행마다 달라서 같은 태스크를 다시
  # 예약해도 앞선 사본을 덮어쓰지 않는다.
  branch="wf-iso/$target/$lease_id"
  workspace_path="$project_root/$worktree_root/$target/$lease_id"
  write_isolation_record preparing || return 1
  # 기준 커밋에서 만들므로 공유 작업 공간의 미커밋 변경은 사본으로 넘어가지 않는다.
  mkdir -p "$worktree_root/$target" 2>/dev/null &&
    git worktree add -b "$branch" "$workspace_path" "$base_commit" >/dev/null 2>&1 || {
    discard_isolation
    write_isolation_record failed:worktree || :
    return 1
  }
  write_isolation_record ready || {
    discard_isolation
    write_isolation_record failed:record || :
    return 1
  }
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
  isolation_json=""
  if [ "$role" = developer ]; then
    prepare_isolation || {
      sh "$claim" release "$target" "$lease_id" >/dev/null 2>&1 || :
      exit 1
    }
    isolation_json=$(printf ',"workspacePath":"%s","controlRoot":"%s","baseCommit":"%s","branch":"%s"' \
      "$(json_quote "$workspace_path")" "$(json_quote "$control_root")" \
      "$(json_quote "$base_commit")" "$(json_quote "$branch")")
  fi
  result_prefix="RES-$(date -u +%Y%m%dT%H%M%SZ)-${lease_id#lease-}"
  role_prompt=$(prompt_for "$role" "$target" "$lease_id" "$result_prefix" "$workspace_path" "$control_root")
  printf '{"contractVersion":2,"role":"%s","targetId":"%s","leaseId":"%s","resultPrefix":"%s","expiresAt":"%s","promptVersion":1,"rolePrompt":"%s"%s}\n' \
    "$(json_quote "$role")" "$(json_quote "$target")" "$(json_quote "$lease_id")" \
    "$(json_quote "$result_prefix")" "$(json_quote "$expires_at")" "$(json_quote "$role_prompt")" \
    "$isolation_json"
  exit 0
done

# 경쟁이 계속돼도 반복 실행기는 유료 provider를 시작하지 않는다. 다음 주기에 다시 판정한다.
exit 1
"#;

const RESERVATION_HELPER_PS1: &str = r#"# LLM Workflow runtime reservation helper.
# managed_by: workflow-labs
# reservation_helper_version: 5
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
$isolationRoot = '.workflow/.runtime/isolation'
$worktreeRoot = '.workflow/.runtime/worktrees'
$maxAttempts = 32
$workspacePath = ''
$controlRoot = ''
$baseCommit = ''
$branch = ''

function Stop-Usage() {
  [Console]::Error.WriteLine('usage: wf-reserve.ps1 acquire <planner|architect|developer> <agent> <minutes>')
  exit 2
}

function Get-RolePrompt([string]$Target, [string]$LeaseId, [string]$ResultPrefix, [string]$WorkspacePath, [string]$ControlRoot) {
  # The prompt is the door to the contract, not its summary. A required mid-step the prompt
  # omits (the planner's draft-first rule) is a step sessions skip.
  $roleStep = ''
  if ($Role -ceq 'planner') {
    $roleStep = 'Immediately after verifying ownership, create your result specification file with status: draft and its source references, exactly as the role contract orders, so the writing is visible while you compose. '
  } elseif ($Role -ceq 'architect') {
    $roleStep = 'For a new approval, immediately create the result work-group file with status: preparing and its source references, exactly as the role contract orders, so architecture progress is visible before you compose tasks. '
  } elseif ($Role -ceq 'developer') {
    $roleStep = "Write product code, build, and run this task's checks only in the isolated working copy prepared at $WorkspacePath. The workflow control documents stay canonical at $ControlRoot, so task status, leases, and role reports are written there and never mixed into the isolated branch. "
  }
  return "You are the $Role role for one pre-reserved LLM Workflow target. Read .workflow/project.yml, .workflow/rules/workflow.md, .workflow/rules/roles/$Role.md, and the active workflow documents. The runtime already reserved target $Target with lease $LeaseId. Verify ownership first with wf-claim renew using that target and lease; do not acquire again. ${roleStep}Name any new SPEC, GROUP, or TASK document by the lineage rule in workflow.md (SPEC-NNN, GROUP-NNN, TASK-SNNN-KK); result prefix $ResultPrefix names this reservation for your report only and never enters a document identifier. Stop before overwriting any existing document path, write the role report, then release the same lease."
}

# 개발 세션은 사용자가 지금 쓰고 있는 작업 공간을 함께 쓰지 않는다. 준비가 끝난 사본만 세션에
# 넘기고, 준비가 실패하면 만들다 만 자원을 지운 뒤 lease를 반납해 세션 자체를 시작하지 않는다.
function Invoke-Git([string[]]$GitArguments) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = & git @GitArguments 2>&1
    return @{ Code = $LASTEXITCODE; Output = ($output | Out-String) }
  } catch {
    return @{ Code = 1; Output = '' }
  } finally {
    $ErrorActionPreference = $previous
  }
}

function Write-IsolationRecord([string]$Target, [string]$LeaseId, [string]$Step) {
  try {
    $null = New-Item -ItemType Directory -Force -Path $isolationRoot -ErrorAction Stop
    $preparedAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    $lines = @(
      '# managed_by: workflow-labs. 앱이 소유하는 상태이므로 에이전트 세션이 직접 고치지 않는다.',
      'schema_version: 1',
      "target_id: $Target",
      "lease_id: $LeaseId",
      "base_commit: $baseCommit",
      "branch: $branch",
      "workspace_path: $workspacePath",
      "control_root: $controlRoot",
      "prepared_at: $preparedAt",
      "step: $Step"
    )
    Set-Content -LiteralPath (Join-Path $isolationRoot ($Target + '.yml')) -Value $lines -Encoding UTF8 -ErrorAction Stop
    return $true
  } catch {
    return $false
  }
}

function Remove-Isolation() {
  $null = Invoke-Git @('worktree', 'remove', '--force', $workspacePath)
  if ($workspacePath.Length -gt 0 -and (Test-Path -LiteralPath $workspacePath)) {
    Remove-Item -LiteralPath $workspacePath -Recurse -Force -ErrorAction SilentlyContinue
  }
  $null = Invoke-Git @('worktree', 'prune')
  $null = Invoke-Git @('branch', '-D', $branch)
}

function Initialize-Isolation([string]$Target, [string]$LeaseId) {
  # 기준을 확정하지 못하면 공유 작업 공간에서 대신 시작하지 않는다. 사본이 없으면 예약도 없다.
  if ((Invoke-Git @('rev-parse', '--is-inside-work-tree')).Code -ne 0) { return $false }
  $head = Invoke-Git @('rev-parse', 'HEAD')
  if ($head.Code -ne 0) { return $false }
  $script:baseCommit = $head.Output.Trim()
  if ($script:baseCommit.Length -eq 0) { return $false }
  $root = (Get-Location).Path
  $script:controlRoot = Join-Path $root '.workflow'
  # 이름은 대상과 lease 식별자만으로 만든다. lease 식별자가 실행마다 달라서 같은 태스크를 다시
  # 예약해도 앞선 사본을 덮어쓰지 않는다.
  $script:branch = "wf-iso/$Target/$LeaseId"
  $script:workspacePath = Join-Path $root (Join-Path $worktreeRoot (Join-Path $Target $LeaseId))
  if (-not (Write-IsolationRecord $Target $LeaseId 'preparing')) { return $false }
  # 기준 커밋에서 만들므로 공유 작업 공간의 미커밋 변경은 사본으로 넘어가지 않는다.
  $prepared = $false
  try {
    $null = New-Item -ItemType Directory -Force -Path (Join-Path $worktreeRoot $Target) -ErrorAction Stop
    $prepared = ((Invoke-Git @('worktree', 'add', '-b', $script:branch, $script:workspacePath, $script:baseCommit)).Code -eq 0)
  } catch {
    $prepared = $false
  }
  if (-not $prepared) {
    Remove-Isolation
    $null = Write-IsolationRecord $Target $LeaseId 'failed:worktree'
    return $false
  }
  if (-not (Write-IsolationRecord $Target $LeaseId 'ready')) {
    Remove-Isolation
    $null = Write-IsolationRecord $Target $LeaseId 'failed:record'
    return $false
  }
  return $true
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
  if ($Role -ceq 'developer') {
    if (-not (Initialize-Isolation $target $leaseId)) {
      & powershell -NoProfile -ExecutionPolicy Bypass -File $claim release $target $leaseId | Out-Null
      exit 1
    }
  }
  $resultPrefix = 'RES-' + (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ') + '-' + ($leaseId -replace '^lease-', '')
  $handoff = [ordered]@{
    contractVersion = 2
    role = $Role
    targetId = $target
    leaseId = $leaseId
    resultPrefix = $resultPrefix
    expiresAt = $expiresAt
    promptVersion = 1
    rolePrompt = Get-RolePrompt $target $leaseId $resultPrefix $workspacePath $controlRoot
  }
  if ($Role -ceq 'developer') {
    $handoff['workspacePath'] = $workspacePath
    $handoff['controlRoot'] = $controlRoot
    $handoff['baseCommit'] = $baseCommit
    $handoff['branch'] = $branch
  }
  $handoff | ConvertTo-Json -Compress -Depth 3
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
        RESERVATION_HELPER_PS1, RESERVATION_HELPER_SH, RESERVATION_HELPER_VERSION,
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

    fn run_git(project_root: &Path, arguments: &[&str]) -> (i32, String) {
        let output = Command::new("git")
            .args(arguments)
            .current_dir(project_root)
            .output()
            .expect("run git");
        (
            output.status.code().expect("git exit code"),
            String::from_utf8_lossy(&output.stdout).into_owned(),
        )
    }

    /// 격리 준비는 확정된 기준 커밋을 요구하므로, 사본을 검사하는 픽스처는 Git 저장소와 첫
    /// 커밋까지 갖춘다. `.workflow/.runtime/`를 무시하는 것도 실제 프로젝트와 같게 둔다.
    fn git_project() -> (TempDir, PathBuf) {
        let (root, control) = project();
        fs::write(root.path().join(".gitignore"), ".workflow/.runtime/\n").expect("gitignore");
        fs::write(root.path().join("README.md"), "base\n").expect("tracked file");
        assert_eq!(run_git(root.path(), &["init", "-b", "main"]).0, 0);
        assert_eq!(
            run_git(root.path(), &["add", ".gitignore", "README.md"]).0,
            0
        );
        assert_eq!(
            run_git(
                root.path(),
                &[
                    "-c",
                    "user.email=agent@workflow-labs.test",
                    "-c",
                    "user.name=workflow-labs",
                    "-c",
                    "commit.gpgsign=false",
                    "commit",
                    "-m",
                    "base",
                ],
            )
            .0,
            0
        );
        (root, control)
    }

    fn write_task(control: &Path, id: &str) {
        let tasks = control.join("wf-demo/tasks");
        let groups = control.join("wf-demo/groups");
        let decisions = control.join("wf-demo/decisions");
        fs::create_dir_all(&tasks).expect("tasks root");
        fs::create_dir_all(&groups).expect("groups root");
        fs::create_dir_all(&decisions).expect("decisions root");
        let group = groups.join("GROUP-DEFAULT.md");
        if !group.is_file() {
            fs::write(
                &group,
                "---\nschema: workflow-labs/work-group@1\nid: GROUP-DEFAULT\nstatus: active\nrevision: 1\nsource_spec_id: SPEC-DEFAULT\nsource_decision_id: DECISION-DEFAULT\n---\n",
            )
            .expect("default group");
        }
        let approval = decisions.join("DECISION-DEFAULT.md");
        if !approval.is_file() {
            fs::write(
                &approval,
                "---\nschema: workflow-labs/decision@1\nid: DECISION-DEFAULT\nspec_id: SPEC-DEFAULT\noutcome: approved\ncreated_by: user\ncreated_at: 2026-08-01T00:00:00Z\n---\n",
            )
            .expect("source approval");
        }
        fs::write(
            tasks.join(format!("{id}.md")),
            format!(
                "---\nschema: workflow-labs/task@1\nid: {id}\nstatus: todo\nsource_spec_id: SPEC-DEFAULT\nsource_decision_id: DECISION-DEFAULT\nwork_group_id: GROUP-DEFAULT\nwork_group_revision: 1\nscope_files: [src/{id}.rs]\n---\n"
            ),
        )
        .expect("task");
    }

    fn write_approval(control: &Path, id: &str) {
        let decisions = control.join("wf-demo/decisions");
        fs::create_dir_all(&decisions).expect("decisions root");
        fs::create_dir_all(control.join("wf-demo/groups")).expect("groups root");
        fs::write(
            decisions.join(format!("{id}.md")),
            format!("---\nschema: workflow-labs/decision@1\nid: {id}\nspec_id: SPEC-001\noutcome: approved\ncreated_by: user\ncreated_at: 2026-08-01T00:00:00Z\n---\n"),
        )
        .expect("approval");
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

    fn run_claim(project_root: &Path, arguments: &[&str]) -> i32 {
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
            .args(arguments)
            .current_dir(project_root)
            .status()
            .expect("run claim helper")
            .code()
            .expect("claim exit")
    }

    #[test]
    fn reserves_a_target_and_returns_the_handoff_contract() {
        let (root, control) = git_project();
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
        assert_eq!(first["contractVersion"], 2);
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
            run_claim(root.path(), &["renew", "TASK-001", lease_id, "30"]),
            0,
            "handoff lease must renew without a second acquire"
        );
        assert!(control.join(".runtime/leases/TASK-001.yml").is_file());
        assert!(control.join(".runtime/leases/TASK-002.yml").is_file());
    }

    #[test]
    fn architect_handoff_requires_a_preparing_work_group_before_tasks() {
        let (root, control) = project();
        write_approval(&control, "DECISION-001");

        let (code, stdout, stderr) =
            run_reservation(root.path(), &["acquire", "architect", "dispatcher-a", "30"]);
        let reservation: serde_json::Value =
            serde_json::from_str(stdout.trim()).expect("architect reservation JSON");
        let prompt = reservation["rolePrompt"].as_str().expect("role prompt");

        assert_eq!(code, 0);
        assert!(stderr.is_empty());
        assert_eq!(reservation["targetId"], "DECISION-001");
        assert!(prompt.contains("work-group file with status: preparing"));
        assert!(prompt.contains("SPEC, GROUP, or TASK"));
    }

    #[test]
    fn a_developer_reservation_prepares_an_isolated_copy_and_publishes_its_location() {
        let (root, control) = git_project();
        write_task(&control, "TASK-001");
        fs::write(root.path().join("README.md"), "uncommitted\n").expect("uncommitted change");

        let (code, stdout, stderr) =
            run_reservation(root.path(), &["acquire", "developer", "dispatcher-a", "30"]);
        let reservation: serde_json::Value =
            serde_json::from_str(stdout.trim()).expect("developer reservation JSON");

        assert_eq!(code, 0, "reservation stderr: {stderr}");
        assert_eq!(reservation["contractVersion"], 2);
        let lease_id = reservation["leaseId"].as_str().expect("lease id");
        let workspace = reservation["workspacePath"]
            .as_str()
            .expect("workspace path");
        let branch = reservation["branch"].as_str().expect("branch");
        let base_commit = reservation["baseCommit"].as_str().expect("base commit");
        assert_eq!(branch, format!("wf-iso/TASK-001/{lease_id}"));
        assert_eq!(
            base_commit,
            run_git(root.path(), &["rev-parse", "HEAD"]).1.trim()
        );
        assert_eq!(
            fs::canonicalize(workspace).expect("prepared copy"),
            fs::canonicalize(control.join(".runtime/worktrees/TASK-001").join(lease_id))
                .expect("declared copy path")
        );
        assert_eq!(
            fs::canonicalize(reservation["controlRoot"].as_str().expect("control root"))
                .expect("control root"),
            fs::canonicalize(&control).expect("shared control root")
        );
        assert_eq!(
            fs::read_to_string(Path::new(workspace).join("README.md")).expect("copied file"),
            "base\n",
            "the copy starts from the base commit, never from uncommitted shared work"
        );
        assert!(run_git(root.path(), &["branch", "--list", branch])
            .1
            .contains(branch));

        let record = fs::read_to_string(control.join(".runtime/isolation/TASK-001.yml"))
            .expect("isolation record");
        assert!(record.starts_with("# managed_by: workflow-labs"));
        for expected in [
            "target_id: TASK-001".to_owned(),
            format!("lease_id: {lease_id}"),
            format!("base_commit: {base_commit}"),
            format!("branch: {branch}"),
            format!("workspace_path: {workspace}"),
            "control_root: ".to_owned(),
            "prepared_at: 20".to_owned(),
            "step: ready".to_owned(),
        ] {
            assert!(
                record.contains(&expected),
                "isolation record misses {expected}"
            );
        }

        let prompt = reservation["rolePrompt"].as_str().expect("role prompt");
        assert!(prompt.contains(workspace));
        assert!(prompt.contains(reservation["controlRoot"].as_str().expect("control root")));
    }

    #[test]
    fn planner_and_architect_reservations_prepare_no_isolated_copy() {
        let (root, control) = git_project();
        write_approval(&control, "DECISION-001");
        let ideas = control.join("wf-demo/ideas");
        fs::create_dir_all(&ideas).expect("ideas root");
        fs::write(
            ideas.join("IDEA-001.md"),
            "---\nschema: workflow-labs/idea@1\nid: IDEA-001\n---\n",
        )
        .expect("idea");

        let (architect_code, architect_stdout, _) =
            run_reservation(root.path(), &["acquire", "architect", "dispatcher-a", "30"]);
        let (planner_code, planner_stdout, _) =
            run_reservation(root.path(), &["acquire", "planner", "dispatcher-b", "30"]);

        assert_eq!(architect_code, 0);
        assert_eq!(planner_code, 0);
        for stdout in [architect_stdout, planner_stdout] {
            let reservation: serde_json::Value =
                serde_json::from_str(stdout.trim()).expect("reservation JSON");
            assert_eq!(reservation["contractVersion"], 2);
            for absent in ["workspacePath", "controlRoot", "baseCommit", "branch"] {
                assert!(
                    reservation.get(absent).is_none(),
                    "{absent} belongs to a developer reservation only"
                );
            }
        }
        assert!(!control.join(".runtime/worktrees").exists());
        assert!(!control.join(".runtime/isolation").exists());
        assert!(run_git(root.path(), &["branch", "--list", "wf-iso/*"])
            .1
            .trim()
            .is_empty());
    }

    #[test]
    fn a_project_without_git_starts_no_developer_session() {
        let (root, control) = project();
        write_task(&control, "TASK-001");

        let (code, stdout, _stderr) =
            run_reservation(root.path(), &["acquire", "developer", "dispatcher-a", "30"]);

        assert_ne!(code, 0);
        assert!(stdout.is_empty());
        assert!(!control.join(".runtime/leases/TASK-001.yml").exists());
        assert!(!control.join(".runtime/worktrees").exists());
    }

    #[test]
    fn a_failed_isolation_leaves_no_copy_and_returns_the_lease() {
        let (root, control) = git_project();
        write_task(&control, "TASK-001");
        // 사본이 들어갈 자리를 파일이 차지하고 있으면 사본 준비가 실패한다.
        fs::create_dir_all(control.join(".runtime/worktrees")).expect("worktree root");
        fs::write(control.join(".runtime/worktrees/TASK-001"), "occupied\n")
            .expect("occupied copy path");

        let (code, stdout, _stderr) =
            run_reservation(root.path(), &["acquire", "developer", "dispatcher-a", "30"]);

        assert_ne!(code, 0);
        assert!(stdout.is_empty(), "a failed reservation starts no session");
        assert!(!control.join(".runtime/leases/TASK-001.yml").exists());
        assert!(control.join(".runtime/worktrees/TASK-001").is_file());
        assert!(run_git(root.path(), &["branch", "--list", "wf-iso/*"])
            .1
            .trim()
            .is_empty());
        let record = fs::read_to_string(control.join(".runtime/isolation/TASK-001.yml"))
            .expect("isolation record");
        assert!(record.contains("step: failed:worktree"), "record: {record}");
    }

    #[test]
    fn reserving_the_same_task_twice_keeps_the_earlier_copy() {
        let (root, control) = git_project();
        write_task(&control, "TASK-001");

        let (first_code, first_stdout, _) =
            run_reservation(root.path(), &["acquire", "developer", "dispatcher-a", "30"]);
        let first: serde_json::Value =
            serde_json::from_str(first_stdout.trim()).expect("first reservation JSON");
        let first_lease = first["leaseId"].as_str().expect("first lease id");
        assert_eq!(
            run_claim(root.path(), &["release", "TASK-001", first_lease]),
            0
        );
        let (second_code, second_stdout, _) =
            run_reservation(root.path(), &["acquire", "developer", "dispatcher-b", "30"]);
        let second: serde_json::Value =
            serde_json::from_str(second_stdout.trim()).expect("second reservation JSON");
        let second_lease = second["leaseId"].as_str().expect("second lease id");

        assert_eq!(first_code, 0);
        assert_eq!(second_code, 0);
        assert_ne!(first["workspacePath"], second["workspacePath"]);
        assert_ne!(first["branch"], second["branch"]);
        for (reservation, lease) in [(&first, first_lease), (&second, second_lease)] {
            let workspace = reservation["workspacePath"]
                .as_str()
                .expect("workspace path");
            assert!(Path::new(workspace).is_dir(), "{workspace} must remain");
            assert_eq!(
                reservation["branch"].as_str().expect("branch"),
                format!("wf-iso/TASK-001/{lease}")
            );
            assert!(
                workspace.ends_with(&format!(".workflow/.runtime/worktrees/TASK-001/{lease}")),
                "the copy path is built from the target and the lease alone: {workspace}"
            );
        }
        let branches = run_git(root.path(), &["branch", "--list", "wf-iso/*"]).1;
        assert!(branches.contains(first_lease) && branches.contains(second_lease));
    }

    #[test]
    fn a_reservation_leaves_the_shared_working_tree_untouched() {
        let (root, control) = git_project();
        write_task(&control, "TASK-001");
        fs::write(root.path().join("README.md"), "user edit\n").expect("user edit");
        fs::write(root.path().join("draft.txt"), "user draft\n").expect("user draft");
        let before = run_git(root.path(), &["status", "--porcelain"]).1;

        let (code, _stdout, _stderr) =
            run_reservation(root.path(), &["acquire", "developer", "dispatcher-a", "30"]);
        let after = run_git(root.path(), &["status", "--porcelain"]).1;

        assert_eq!(code, 0);
        assert_eq!(
            before, after,
            "the reservation must not move the user's work"
        );
        assert_eq!(
            fs::read_to_string(root.path().join("README.md")).expect("user edit"),
            "user edit\n"
        );
    }

    /// PowerShell 본문은 macOS·Linux에서 실행할 수 없으므로, 두 본문이 같은 계약을 담는지
    /// 필드 이름과 분기 조건을 나란히 비교해 확인한다.
    #[test]
    fn both_platform_bodies_carry_the_same_reservation_contract() {
        for field in [
            "contractVersion",
            "targetId",
            "leaseId",
            "resultPrefix",
            "expiresAt",
            "promptVersion",
            "rolePrompt",
            "workspacePath",
            "controlRoot",
            "baseCommit",
            "branch",
        ] {
            assert!(RESERVATION_HELPER_SH.contains(field), "POSIX body: {field}");
            assert!(
                RESERVATION_HELPER_PS1.contains(field),
                "PowerShell body: {field}"
            );
        }
        for marker in [
            ".workflow/.runtime/isolation",
            ".workflow/.runtime/worktrees",
            "wf-iso/",
            "schema_version: 1",
            "target_id: ",
            "lease_id: ",
            "base_commit: ",
            "workspace_path: ",
            "control_root: ",
            "prepared_at: ",
            "step: ",
            "failed:worktree",
            "failed:record",
            "worktree",
            "isolated working copy prepared at",
        ] {
            assert!(
                RESERVATION_HELPER_SH.contains(marker),
                "POSIX body: {marker}"
            );
            assert!(
                RESERVATION_HELPER_PS1.contains(marker),
                "PowerShell body: {marker}"
            );
        }
        assert!(RESERVATION_HELPER_SH.contains(r#""contractVersion":2"#));
        assert!(RESERVATION_HELPER_PS1.contains("contractVersion = 2"));
        assert!(RESERVATION_HELPER_SH.contains(r#"[ "$role" = developer ]"#));
        assert!(RESERVATION_HELPER_PS1.contains("$Role -ceq 'developer'"));
    }

    #[test]
    fn racing_reservations_create_only_one_lease_for_one_target() {
        let (root, control) = git_project();
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
            .contains("# reservation_helper_version: 5"));
        let other = control.join("rules").join(if cfg!(windows) {
            "wf-reserve.sh"
        } else {
            "wf-reserve.ps1"
        });
        let foreign = "# managed_by: workflow-labs\n# reservation_helper_version: 999\nforeign\n";
        fs::write(&other, foreign).expect("other platform helper");
        install_reservation_helper(&control).expect("current platform install");
        assert_eq!(fs::read_to_string(other).expect("other helper"), foreign);
        assert_eq!(RESERVATION_HELPER_VERSION, 5);
    }

    #[test]
    fn refuses_to_overwrite_a_future_reservation_helper() {
        let (_root, control) = project();
        let helper = reservation_helper_path(&control);
        let future = fs::read_to_string(&helper)
            .expect("reservation helper")
            .replace(
                "# reservation_helper_version: 5",
                "# reservation_helper_version: 999",
            );
        fs::write(&helper, &future).expect("future helper");

        let error = install_reservation_helper(&control).expect_err("future helper must remain");

        assert!(error.to_string().contains("999"));
        assert_eq!(fs::read_to_string(helper).expect("future helper"), future);
    }
}
