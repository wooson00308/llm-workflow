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
project_root=""
# 기기 상한 20 GiB와 볼륨 여유 하한 10 GiB. 셸 산술 폭이 좁은 환경에서도 안전하도록 KiB로 센다.
storage_limit_kib=$((20 * 1024 * 1024))
storage_min_free_kib=$((10 * 1024 * 1024))
# 검사는 상한을 낮춰 잡아 회수 순서를 재현한다. 값을 주지 않으면 위의 기본값을 그대로 쓴다.
case "${WF_ISOLATION_LIMIT_KIB:-}" in ''|*[!0-9]*) ;; *) storage_limit_kib="$WF_ISOLATION_LIMIT_KIB" ;; esac
case "${WF_ISOLATION_MIN_FREE_KIB:-}" in ''|*[!0-9]*) ;; *) storage_min_free_kib="$WF_ISOLATION_MIN_FREE_KIB" ;; esac
reclaimed_kib=0
reclaim_failed=""
reclaim_note=""

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
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" >"$isolation_root/$target.yml" 2>/dev/null || return 1
  # 회수를 수행했거나 저장 공간 때문에 대기했다면 그 결과를 같은 기록에 남긴다. 실패한 회수 단계도
  # 여기에 남으므로, 준비가 이어졌다는 사실이 회수 실패를 덮지 않는다.
  if [ -n "$reclaim_note" ]; then
    printf 'reclaim: %s\n' "$reclaim_note" >>"$isolation_root/$target.yml" 2>/dev/null || return 1
  fi
}

record_field() { # $1=준비 기록 경로 $2=키
  sed -n "s/^$2: *//p" "$1" 2>/dev/null | head -1
}

dir_kib() {
  [ -d "$1" ] || { printf '0'; return 0; }
  size=$(du -sk "$1" 2>/dev/null | awk 'NR==1 {print $1}')
  case "$size" in ''|*[!0-9]*) size=0 ;; esac
  printf '%s' "$size"
}

free_kib() {
  # 여유를 읽지 못하면 0으로 본다. 남은 용량을 모르는 채 사본을 늘리는 쪽보다 기다리는 쪽이 안전하다.
  size=$(df -Pk "$1" 2>/dev/null | awk 'NR==2 {print $4}')
  case "$size" in ''|*[!0-9]*) size=0 ;; esac
  printf '%s' "$size"
}

managed_copy_count() {
  count=0
  for target_dir in "$worktree_root"/*; do
    [ -d "$target_dir" ] || continue
    for copy_dir in "$target_dir"/*; do
      [ -d "$copy_dir" ] && count=$((count + 1))
    done
  done
  printf '%s' "$count"
}

storage_within_limits() {
  managed_kib=$(dir_kib "$worktree_root")
  copies=$(managed_copy_count)
  # 새 사본이 얼마를 쓸지는 만들어 보기 전에는 알 수 없다. 관리 중인 사본의 평균 크기를 그 몫으로
  # 잡고, 사본이 하나도 없으면 회수할 것도 없으므로 0으로 둔다.
  if [ "$copies" -gt 0 ]; then
    expected_kib=$((managed_kib / copies))
  else
    expected_kib=0
  fi
  [ $((managed_kib + expected_kib)) -le "$storage_limit_kib" ] &&
    [ "$(free_kib "$project_root")" -ge "$storage_min_free_kib" ]
}

# 재생성 가능한 산출물만 걷어낸다. 사본 안에서 Git이 무시하는 경로인지 직접 확인하므로 추적 중인
# 파일과 사용자가 직접 만든 파일은 대상이 되지 않는다.
reclaim_artifacts() { # $1=사본 경로
  for candidate in src-tauri/target target node_modules dist coverage; do
    artifact="$1/$candidate"
    [ -d "$artifact" ] || continue
    git -C "$1" check-ignore -q "$candidate" 2>/dev/null || continue
    artifact_kib=$(dir_kib "$artifact")
    rm -rf "$artifact" >/dev/null 2>&1 || :
    if [ -d "$artifact" ]; then
      reclaim_failed="artifacts"
    else
      reclaimed_kib=$((reclaimed_kib + artifact_kib))
    fi
  done
}

# 삭제는 관리 대상 사본 하나만 다룬다. 경로를 기록 본문에서 받지 않고 대상과 lease 이름으로 직접
# 조립하므로 관리 경로 밖으로 나갈 수 없고, 상위 디렉터리는 대상이 되지 않는다.
reclaim_copy() { # $1=대상 $2=lease
  case "$1" in ''|*[!A-Za-z0-9_-]*) return 1 ;; esac
  case "$2" in ''|*[!A-Za-z0-9_-]*) return 1 ;; esac
  copy="$worktree_root/$1/$2"
  [ -d "$copy" ] || return 0
  [ -f "$isolation_root/$1.yml" ] || return 1
  [ "$(record_field "$isolation_root/$1.yml" lease_id)" = "$2" ] || return 1
  copy_kib=$(dir_kib "$copy")
  # 변경 커밋을 담은 전용 브랜치와 준비 기록은 남긴다. 사본만 걷어내면 같은 기준에서 다시 만들 수 있다.
  git worktree remove --force "$copy" >/dev/null 2>&1 || :
  [ -d "$copy" ] && { rm -rf "$copy" >/dev/null 2>&1 || :; }
  git worktree prune >/dev/null 2>&1 || :
  [ -d "$copy" ] && return 1
  reclaimed_kib=$((reclaimed_kib + copy_kib))
  return 0
}

failed_copies_oldest_first() {
  for record in "$isolation_root"/*.yml; do
    [ -f "$record" ] || continue
    case "$(record_field "$record" step)" in failed*) ;; *) continue ;; esac
    printf '%s|%s|%s\n' "$(record_field "$record" prepared_at)" \
      "$(record_field "$record" target_id)" "$(record_field "$record" lease_id)"
  done | sort
}

# 회수는 정해진 순서로만 한다. 한 대상을 정리할 때마다 조건을 다시 보고, 만족하는 순간 멈춘다.
reclaim_storage() {
  for target_dir in "$worktree_root"/*; do
    [ -d "$target_dir" ] || continue
    for copy_dir in "$target_dir"/*; do
      [ -d "$copy_dir" ] || continue
      storage_within_limits && return 0
      reclaim_artifacts "$copy_dir"
    done
  done
  for record in "$isolation_root"/*.yml; do
    [ -f "$record" ] || continue
    case "$(record_field "$record" step)" in integrated|cancelled) ;; *) continue ;; esac
    storage_within_limits && return 0
    reclaim_copy "$(record_field "$record" target_id)" "$(record_field "$record" lease_id)" ||
      reclaim_failed="finished"
  done
  for entry in $(failed_copies_oldest_first); do
    storage_within_limits && return 0
    stale_target=${entry#*|}
    stale_lease=${stale_target#*|}
    reclaim_copy "${stale_target%%|*}" "$stale_lease" || reclaim_failed="stale"
  done
}

# 요약에는 사본 경로, 사용자 파일 이름, prompt 원문, 인증 값을 넣지 않는다. 숫자와 단계 이름뿐이다.
storage_summary() { # $1=결과
  reclaim_note="result=$1 freed=${reclaimed_kib}K remaining=$(dir_kib "$worktree_root")K limit=${storage_limit_kib}K"
  [ -n "$reclaim_failed" ] && reclaim_note="$reclaim_note failed_step=$reclaim_failed"
  [ "$1" = waiting ] && reclaim_note="$reclaim_note action=free-disk-space"
  echo "wf-reserve storage: $reclaim_note" >&2
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
  # 사본을 늘리기 전에 관리 중인 사본이 차지한 용량과 볼륨 여유를 본다. 상한에 걸리면 회수를 먼저
  # 하고, 회수해도 조건을 못 채우면 사본을 만들지 않는다. 디스크가 조용히 차는 것보다 대기가 낫다.
  if ! storage_within_limits; then
    reclaim_storage
    if ! storage_within_limits; then
      storage_summary waiting
      write_isolation_record waiting:storage || :
      return 1
    fi
    storage_summary reclaimed
  fi
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

// Windows PowerShell 5.1은 BOM 없는 파일을 ANSI로 읽어, 본문의 한글 바이트가 따옴표 문자로
// 오독되며 스크립트 전체가 구문 오류로 죽는다(2026-08-15 실측: 예약 전부 exit 1). BOM은 쓰기
// 시점이 아니라 본문에 둔다 — 설치 판정이 본문과 파일을 그대로 비교하기 때문이다.
const RESERVATION_HELPER_PS1: &str = concat!(
    "\u{feff}",
    r#"# LLM Workflow runtime reservation helper.
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
$projectRoot = ''
# 기기 상한 20 GiB와 볼륨 여유 하한 10 GiB. 셸 산술 폭이 좁은 환경에서도 안전하도록 KiB로 센다.
$storageLimitKib = [int64](20 * 1024 * 1024)
$storageMinFreeKib = [int64](10 * 1024 * 1024)
# 검사는 상한을 낮춰 잡아 회수 순서를 재현한다. 값을 주지 않으면 위의 기본값을 그대로 쓴다.
if ($env:WF_ISOLATION_LIMIT_KIB -match '^[0-9]+$') { $storageLimitKib = [int64]$env:WF_ISOLATION_LIMIT_KIB }
if ($env:WF_ISOLATION_MIN_FREE_KIB -match '^[0-9]+$') { $storageMinFreeKib = [int64]$env:WF_ISOLATION_MIN_FREE_KIB }
$reclaimedKib = [int64]0
$reclaimFailed = ''
$reclaimNote = ''

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
    # 회수를 수행했거나 저장 공간 때문에 대기했다면 그 결과를 같은 기록에 남긴다. 실패한 회수 단계도
    # 여기에 남으므로, 준비가 이어졌다는 사실이 회수 실패를 덮지 않는다.
    if ($reclaimNote.Length -gt 0) { $lines += "reclaim: $reclaimNote" }
    Set-Content -LiteralPath (Join-Path $isolationRoot ($Target + '.yml')) -Value $lines -Encoding UTF8 -ErrorAction Stop
    return $true
  } catch {
    return $false
  }
}

function Get-RecordField([string]$RecordPath, [string]$Key) {
  try {
    $line = Get-Content -LiteralPath $RecordPath -ErrorAction Stop |
      Where-Object { $_.StartsWith($Key + ': ', [System.StringComparison]::Ordinal) } |
      Select-Object -First 1
    if ($null -eq $line) { return '' }
    return $line.Substring($Key.Length + 2).Trim()
  } catch {
    return ''
  }
}

function Get-DirectoryKib([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Container)) { return [int64]0 }
  try {
    $bytes = (Get-ChildItem -LiteralPath $Path -Recurse -Force -File -ErrorAction SilentlyContinue |
      Measure-Object -Property Length -Sum).Sum
    if ($null -eq $bytes) { return [int64]0 }
    return [int64][math]::Ceiling($bytes / 1024)
  } catch {
    return [int64]0
  }
}

function Get-FreeKib([string]$Path) {
  # 여유를 읽지 못하면 0으로 본다. 남은 용량을 모르는 채 사본을 늘리는 쪽보다 기다리는 쪽이 안전하다.
  try {
    $root = [System.IO.Path]::GetPathRoot([System.IO.Path]::GetFullPath($Path))
    return [int64]((New-Object System.IO.DriveInfo($root)).AvailableFreeSpace / 1024)
  } catch {
    return [int64]0
  }
}

function Get-ManagedCopy() {
  $copies = @()
  if (-not (Test-Path -LiteralPath $worktreeRoot -PathType Container)) { return $copies }
  foreach ($targetDir in Get-ChildItem -LiteralPath $worktreeRoot -Directory -ErrorAction SilentlyContinue) {
    foreach ($copyDir in Get-ChildItem -LiteralPath $targetDir.FullName -Directory -ErrorAction SilentlyContinue) {
      $copies += $copyDir.FullName
    }
  }
  return $copies
}

function Test-StorageWithinLimits() {
  $managedKib = Get-DirectoryKib $worktreeRoot
  $copies = @(Get-ManagedCopy).Count
  # 새 사본이 얼마를 쓸지는 만들어 보기 전에는 알 수 없다. 관리 중인 사본의 평균 크기를 그 몫으로
  # 잡고, 사본이 하나도 없으면 회수할 것도 없으므로 0으로 둔다.
  $expectedKib = [int64]0
  if ($copies -gt 0) { $expectedKib = [int64]($managedKib / $copies) }
  return (($managedKib + $expectedKib) -le $storageLimitKib -and
    (Get-FreeKib $projectRoot) -ge $storageMinFreeKib)
}

# 재생성 가능한 산출물만 걷어낸다. 사본 안에서 Git이 무시하는 경로인지 직접 확인하므로 추적 중인
# 파일과 사용자가 직접 만든 파일은 대상이 되지 않는다.
function Remove-BuildArtifact([string]$CopyPath) {
  foreach ($candidate in @('src-tauri/target', 'target', 'node_modules', 'dist', 'coverage')) {
    $artifact = Join-Path $CopyPath $candidate
    if (-not (Test-Path -LiteralPath $artifact -PathType Container)) { continue }
    if ((Invoke-Git @('-C', $CopyPath, 'check-ignore', '-q', $candidate)).Code -ne 0) { continue }
    $artifactKib = Get-DirectoryKib $artifact
    Remove-Item -LiteralPath $artifact -Recurse -Force -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $artifact) {
      $script:reclaimFailed = 'artifacts'
    } else {
      $script:reclaimedKib += $artifactKib
    }
  }
}

# 삭제는 관리 대상 사본 하나만 다룬다. 경로를 기록 본문에서 받지 않고 대상과 lease 이름으로 직접
# 조립하므로 관리 경로 밖으로 나갈 수 없고, 상위 디렉터리는 대상이 되지 않는다.
function Remove-ManagedCopy([string]$Target, [string]$LeaseId) {
  if ($Target -notmatch '^[A-Za-z0-9_-]+$') { return $false }
  if ($LeaseId -notmatch '^[A-Za-z0-9_-]+$') { return $false }
  $copy = Join-Path $worktreeRoot (Join-Path $Target $LeaseId)
  if (-not (Test-Path -LiteralPath $copy -PathType Container)) { return $true }
  $record = Join-Path $isolationRoot ($Target + '.yml')
  if (-not (Test-Path -LiteralPath $record -PathType Leaf)) { return $false }
  if ((Get-RecordField $record 'lease_id') -cne $LeaseId) { return $false }
  $copyKib = Get-DirectoryKib $copy
  # 변경 커밋을 담은 전용 브랜치와 준비 기록은 남긴다. 사본만 걷어내면 같은 기준에서 다시 만들 수 있다.
  $null = Invoke-Git @('worktree', 'remove', '--force', $copy)
  if (Test-Path -LiteralPath $copy) {
    Remove-Item -LiteralPath $copy -Recurse -Force -ErrorAction SilentlyContinue
  }
  $null = Invoke-Git @('worktree', 'prune')
  if (Test-Path -LiteralPath $copy) { return $false }
  $script:reclaimedKib += $copyKib
  return $true
}

function Get-IsolationRecord() {
  if (-not (Test-Path -LiteralPath $isolationRoot -PathType Container)) { return @() }
  return @(Get-ChildItem -LiteralPath $isolationRoot -Filter '*.yml' -File -ErrorAction SilentlyContinue)
}

# 회수는 정해진 순서로만 한다. 한 대상을 정리할 때마다 조건을 다시 보고, 만족하는 순간 멈춘다.
function Invoke-StorageReclaim() {
  foreach ($copy in Get-ManagedCopy) {
    if (Test-StorageWithinLimits) { return }
    Remove-BuildArtifact $copy
  }
  foreach ($record in Get-IsolationRecord) {
    $step = Get-RecordField $record.FullName 'step'
    if ($step -cne 'integrated' -and $step -cne 'cancelled') { continue }
    if (Test-StorageWithinLimits) { return }
    if (-not (Remove-ManagedCopy (Get-RecordField $record.FullName 'target_id') (Get-RecordField $record.FullName 'lease_id'))) {
      $script:reclaimFailed = 'finished'
    }
  }
  $stale = @()
  foreach ($record in Get-IsolationRecord) {
    if ((Get-RecordField $record.FullName 'step') -notlike 'failed*') { continue }
    $stale += [pscustomobject]@{
      PreparedAt = Get-RecordField $record.FullName 'prepared_at'
      TargetId = Get-RecordField $record.FullName 'target_id'
      LeaseId = Get-RecordField $record.FullName 'lease_id'
    }
  }
  foreach ($entry in ($stale | Sort-Object -Property PreparedAt)) {
    if (Test-StorageWithinLimits) { return }
    if (-not (Remove-ManagedCopy $entry.TargetId $entry.LeaseId)) { $script:reclaimFailed = 'stale' }
  }
}

# 요약에는 사본 경로, 사용자 파일 이름, prompt 원문, 인증 값을 넣지 않는다. 숫자와 단계 이름뿐이다.
function Write-StorageSummary([string]$Result) {
  $remainingKib = Get-DirectoryKib $worktreeRoot
  $script:reclaimNote = "result=$Result freed=${script:reclaimedKib}K remaining=${remainingKib}K limit=${storageLimitKib}K"
  if ($script:reclaimFailed.Length -gt 0) { $script:reclaimNote += " failed_step=$script:reclaimFailed" }
  if ($Result -ceq 'waiting') { $script:reclaimNote += ' action=free-disk-space' }
  [Console]::Error.WriteLine("wf-reserve storage: $script:reclaimNote")
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
  $script:projectRoot = $root
  $script:controlRoot = Join-Path $root '.workflow'
  # 이름은 대상과 lease 식별자만으로 만든다. lease 식별자가 실행마다 달라서 같은 태스크를 다시
  # 예약해도 앞선 사본을 덮어쓰지 않는다.
  $script:branch = "wf-iso/$Target/$LeaseId"
  $script:workspacePath = Join-Path $root (Join-Path $worktreeRoot (Join-Path $Target $LeaseId))
  if (-not (Write-IsolationRecord $Target $LeaseId 'preparing')) { return $false }
  # 사본을 늘리기 전에 관리 중인 사본이 차지한 용량과 볼륨 여유를 본다. 상한에 걸리면 회수를 먼저
  # 하고, 회수해도 조건을 못 채우면 사본을 만들지 않는다. 디스크가 조용히 차는 것보다 대기가 낫다.
  if (-not (Test-StorageWithinLimits)) {
    Invoke-StorageReclaim
    if (-not (Test-StorageWithinLimits)) {
      Write-StorageSummary 'waiting'
      $null = Write-IsolationRecord $Target $LeaseId 'waiting:storage'
      return $false
    }
    Write-StorageSummary 'reclaimed'
  }
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
"#
);

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

    /// Windows PowerShell 5.1은 BOM 없는 `.ps1`을 ANSI로 읽는다. 본문의 한국어가 따옴표 문자로
    /// 오독되어 세 OS 중 Windows에서만 예약 전체가 죽었다(2026-08-15 실측). BOM이 그 계약이다.
    #[test]
    fn the_powershell_body_carries_a_byte_order_mark_and_the_shell_body_does_not() {
        assert!(super::RESERVATION_HELPER_PS1.starts_with('\u{feff}'));
        assert!(super::RESERVATION_HELPER_SH.starts_with("#!/bin/sh"));
    }

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
        fs::write(
            root.path().join(".gitignore"),
            ".workflow/.runtime/\nnode_modules\ndist\ncoverage\nsrc-tauri/target\n",
        )
        .expect("gitignore");
        fs::write(root.path().join("README.md"), "base\n").expect("tracked file");
        assert_eq!(run_git(root.path(), &["init", "-b", "main"]).0, 0);
        // Windows 러너의 전역 autocrlf가 사본 체크아웃에서 줄바꿈을 바꿔, 바이트 그대로를
        // 대조하는 검사가 플랫폼마다 갈라진다. 픽스처 저장소는 변환 없이 커밋 그대로 낸다.
        assert_eq!(
            run_git(root.path(), &["config", "core.autocrlf", "false"]).0,
            0
        );
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

    /// 저장 공간 검사는 상한을 검사용으로 낮춰 잡는다. 기본값 20 GiB와 10 GiB는 본문에 그대로 있고,
    /// 여유 기준도 함께 낮춰 검사 결과가 실행 기기의 남은 용량에 좌우되지 않게 한다.
    fn storage_env(limit_kib: &str, min_free_kib: &str) -> Vec<(&'static str, String)> {
        vec![
            ("WF_ISOLATION_LIMIT_KIB", limit_kib.to_owned()),
            ("WF_ISOLATION_MIN_FREE_KIB", min_free_kib.to_owned()),
        ]
    }

    fn seed_copy(control: &Path, target: &str, lease: &str, relative: &str, kib: usize) -> PathBuf {
        let copy = control.join(".runtime/worktrees").join(target).join(lease);
        let filler = copy.join(relative);
        fs::create_dir_all(filler.parent().expect("filler parent")).expect("filler directory");
        fs::write(&filler, vec![b'x'; kib * 1024]).expect("filler");
        copy
    }

    fn seed_record(control: &Path, target: &str, lease: &str, step: &str, prepared_at: &str) {
        let root = control.join(".runtime/isolation");
        fs::create_dir_all(&root).expect("isolation root");
        fs::write(
            root.join(format!("{target}.yml")),
            format!(
                "# managed_by: workflow-labs\nschema_version: 1\ntarget_id: {target}\nlease_id: {lease}\nbase_commit: 0000000\nbranch: wf-iso/{target}/{lease}\nworkspace_path: seeded\ncontrol_root: seeded\nprepared_at: {prepared_at}\nstep: {step}\n"
            ),
        )
        .expect("isolation record");
    }

    fn set_task_status(control: &Path, id: &str, status: &str) {
        let task = control.join("wf-demo/tasks").join(format!("{id}.md"));
        let body = fs::read_to_string(&task).expect("task document");
        fs::write(
            &task,
            body.replace("status: todo", &format!("status: {status}")),
        )
        .expect("task status");
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
        // 저장 공간을 확인하지 않는 검사는 기기의 실제 여유 용량에 좌우되면 안 된다. 상한을 넉넉히
        // 잡고 여유 하한을 0으로 두어, 회수와 대기가 끼어들지 않는 조건에서 예약 동작만 확인한다.
        // 본문의 기본값 20 GiB와 10 GiB는 그대로 있고, 판 번호 대조 검사가 그 값을 직접 확인한다.
        run_reservation_with(project_root, arguments, &storage_env("1073741824", "0"))
    }

    fn run_reservation_with(
        project_root: &Path,
        arguments: &[&str],
        environment: &[(&str, String)],
    ) -> (i32, String, String) {
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
        for (key, value) in environment {
            command.env(key, value);
        }
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

        // 상한과 여유 기준을 어떤 개발 예약도 통과할 수 없게 잡아도, 두 역할은 그대로 예약된다.
        let forcing = storage_env("1", "999999999999");
        let (architect_code, architect_stdout, architect_stderr) = run_reservation_with(
            root.path(),
            &["acquire", "architect", "dispatcher-a", "30"],
            &forcing,
        );
        let (planner_code, planner_stdout, planner_stderr) = run_reservation_with(
            root.path(),
            &["acquire", "planner", "dispatcher-b", "30"],
            &forcing,
        );

        assert_eq!(architect_code, 0);
        assert_eq!(planner_code, 0);
        assert!(architect_stderr.is_empty(), "no reclaim for an architect");
        assert!(planner_stderr.is_empty(), "no reclaim for a planner");
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
            // Windows 헬퍼는 역슬래시로 경로를 조립한다. 비교는 구분자를 접고 구성만 본다.
            let normalized = workspace.replace('\\', "/");
            assert!(
                normalized.ends_with(&format!(".workflow/.runtime/worktrees/TASK-001/{lease}")),
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

    #[test]
    fn storage_reclaims_build_artifacts_first_and_stops_once_the_limit_is_met() {
        let (root, control) = git_project();
        write_task(&control, "TASK-001");
        let artifact_copy = seed_copy(&control, "TASK-ART", "lease-art", "node_modules/blob", 4096);
        seed_record(
            &control,
            "TASK-ART",
            "lease-art",
            "ready",
            "2026-08-01T00:00:00Z",
        );
        let finished_copy = seed_copy(&control, "TASK-DONE", "lease-done", "src/keep.rs", 4096);
        seed_record(
            &control,
            "TASK-DONE",
            "lease-done",
            "integrated",
            "2026-08-02T00:00:00Z",
        );

        let (code, stdout, stderr) = run_reservation_with(
            root.path(),
            &["acquire", "developer", "dispatcher-a", "30"],
            &storage_env("7000", "1"),
        );
        let reservation: serde_json::Value =
            serde_json::from_str(stdout.trim()).expect("developer reservation JSON");

        assert_eq!(code, 0, "reservation stderr: {stderr}");
        assert!(
            !artifact_copy.join("node_modules").exists(),
            "regenerable build output is reclaimed first"
        );
        assert!(
            finished_copy.join("src/keep.rs").is_file(),
            "reclaim stops once the limit is met, before reaching the finished copy"
        );
        assert!(
            Path::new(
                reservation["workspacePath"]
                    .as_str()
                    .expect("workspace path")
            )
            .is_dir(),
            "the copy is prepared after the reclaim"
        );
        assert!(stderr.contains("result=reclaimed"), "summary: {stderr}");
    }

    #[test]
    fn reclaiming_a_finished_copy_keeps_its_commits_and_its_record() {
        let (root, control) = git_project();
        write_task(&control, "TASK-001");
        write_task(&control, "TASK-002");
        let (first_code, first_stdout, _) =
            run_reservation(root.path(), &["acquire", "developer", "dispatcher-a", "30"]);
        let first: serde_json::Value =
            serde_json::from_str(first_stdout.trim()).expect("first reservation JSON");
        let first_lease = first["leaseId"].as_str().expect("lease id");
        let first_copy = PathBuf::from(first["workspacePath"].as_str().expect("workspace path"));
        let first_branch = first["branch"].as_str().expect("branch").to_owned();
        fs::write(first_copy.join("README.md"), "isolated work\n").expect("isolated change");
        assert_eq!(first_code, 0);
        assert_eq!(
            run_git(
                &first_copy,
                &[
                    "-c",
                    "user.email=agent@workflow-labs.test",
                    "-c",
                    "user.name=workflow-labs",
                    "-c",
                    "commit.gpgsign=false",
                    "commit",
                    "-am",
                    "isolated",
                ],
            )
            .0,
            0
        );
        assert_eq!(
            run_claim(root.path(), &["release", "TASK-001", first_lease]),
            0
        );
        set_task_status(&control, "TASK-001", "verified");
        seed_record(
            &control,
            "TASK-001",
            first_lease,
            "integrated",
            "2026-08-01T00:00:00Z",
        );
        // 끝난 사본이 한도를 확실히 넘게 채운다. 한도를 1로 두면 파일시스템의 디렉터리
        // 오버헤드(ext4 4K 블록)만으로도 회수 뒤 판정이 실패해 플랫폼마다 결과가 갈라진다.
        fs::write(first_copy.join("pad.bin"), vec![0u8; 256 * 1024]).expect("pad");

        let (code, _stdout, stderr) = run_reservation_with(
            root.path(),
            &["acquire", "developer", "dispatcher-b", "30"],
            &storage_env("64", "1"),
        );

        assert_eq!(code, 0, "reservation stderr: {stderr}");
        assert!(!first_copy.exists(), "the finished copy is reclaimed");
        assert!(
            run_git(root.path(), &["branch", "--list", &first_branch])
                .1
                .contains(&first_branch),
            "the change commits stay on the isolated branch"
        );
        assert!(
            control.join(".runtime/isolation/TASK-001.yml").is_file(),
            "the preparation record stays so the copy can be built again"
        );
        let rebuilt = root.path().join("rebuilt");
        assert_eq!(
            run_git(
                root.path(),
                &[
                    "worktree",
                    "add",
                    rebuilt.to_str().expect("rebuilt path"),
                    &first_branch,
                ],
            )
            .0,
            0,
            "the same base must produce the copy again"
        );
        assert_eq!(
            fs::read_to_string(rebuilt.join("README.md")).expect("rebuilt copy"),
            "isolated work\n"
        );
    }

    #[test]
    fn a_reservation_waits_instead_of_filling_the_volume_and_keeps_everything_else() {
        let (root, control) = git_project();
        write_task(&control, "TASK-001");
        let finished = seed_copy(&control, "TASK-DONE", "lease-done", "blob", 1024);
        seed_record(
            &control,
            "TASK-DONE",
            "lease-done",
            "cancelled",
            "2026-08-02T00:00:00Z",
        );
        let stale = seed_copy(&control, "TASK-OLD", "lease-old", "blob", 1024);
        seed_record(
            &control,
            "TASK-OLD",
            "lease-old",
            "failed:worktree",
            "2026-08-01T00:00:00Z",
        );
        // 회수 대상에서 제외해야 하는 것들: 사용자 브랜치, 역할 보고서, 관리 경로 밖, 사용자 파일.
        assert_eq!(run_git(root.path(), &["branch", "user-work"]).0, 0);
        let reports = control.join("wf-demo/reports");
        fs::create_dir_all(&reports).expect("reports root");
        fs::write(reports.join("REPORT-001.md"), "role report\n").expect("role report");
        let outside = control.join(".runtime/keep-me");
        fs::create_dir_all(&outside).expect("outside directory");
        fs::write(outside.join("state.yml"), "outside\n").expect("outside file");
        fs::write(root.path().join("draft.txt"), "user draft\n").expect("user draft");

        let (code, stdout, stderr) = run_reservation_with(
            root.path(),
            &["acquire", "developer", "dispatcher-a", "30"],
            &storage_env("1", "999999999999"),
        );

        assert_ne!(code, 0, "a reservation that waits starts no session");
        assert!(stdout.is_empty());
        assert!(!control.join(".runtime/leases/TASK-001.yml").exists());
        assert!(!control.join(".runtime/worktrees/TASK-001").exists());
        let record = fs::read_to_string(control.join(".runtime/isolation/TASK-001.yml"))
            .expect("isolation record");
        assert!(record.contains("step: waiting:storage"), "record: {record}");
        assert!(
            record.contains("reclaim: result=waiting"),
            "record: {record}"
        );
        assert!(!finished.exists(), "a cancelled copy is reclaimed");
        assert!(!stale.exists(), "a failed copy is reclaimed");
        assert!(control.join(".runtime/isolation/TASK-DONE.yml").is_file());
        assert!(run_git(root.path(), &["branch", "--list", "user-work"])
            .1
            .contains("user-work"));
        assert!(reports.join("REPORT-001.md").is_file());
        assert!(outside.join("state.yml").is_file());
        assert!(root.path().join("draft.txt").is_file());
        assert!(stderr.contains("result=waiting"), "summary: {stderr}");
        assert!(stderr.contains("freed=") && stderr.contains("remaining="));
        assert!(stderr.contains("limit=") && stderr.contains("action=free-disk-space"));
        assert!(
            !stderr.contains('/'),
            "the summary carries no path: {stderr}"
        );
        assert!(
            !stderr.contains("draft.txt"),
            "the summary names no user file: {stderr}"
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_failed_reclaim_step_never_reads_as_overall_success() {
        use std::os::unix::fs::PermissionsExt;

        let (root, control) = git_project();
        write_task(&control, "TASK-001");
        let blocked = seed_copy(&control, "TASK-DONE", "lease-done", "blob", 1024);
        seed_record(
            &control,
            "TASK-DONE",
            "lease-done",
            "integrated",
            "2026-08-02T00:00:00Z",
        );
        // 사본 디렉터리에서 쓰기 권한을 빼면 그 안의 파일을 지울 수 없어 회수 단계가 실패한다.
        fs::set_permissions(&blocked, fs::Permissions::from_mode(0o500)).expect("read-only copy");

        let (code, stdout, stderr) = run_reservation_with(
            root.path(),
            &["acquire", "developer", "dispatcher-a", "30"],
            &storage_env("1", "1"),
        );
        fs::set_permissions(&blocked, fs::Permissions::from_mode(0o700)).expect("restore mode");

        assert_ne!(code, 0);
        assert!(stdout.is_empty());
        assert!(
            blocked.join("blob").is_file(),
            "the copy could not be removed"
        );
        let record = fs::read_to_string(control.join(".runtime/isolation/TASK-001.yml"))
            .expect("isolation record");
        assert!(record.contains("failed_step=finished"), "record: {record}");
        assert!(stderr.contains("failed_step=finished"), "summary: {stderr}");
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
            // 저장 공간 상한, 회수 순서, 대기 결과가 두 본문에서 같은 값으로 서 있어야 한다.
            "20 * 1024 * 1024",
            "10 * 1024 * 1024",
            "WF_ISOLATION_LIMIT_KIB",
            "WF_ISOLATION_MIN_FREE_KIB",
            "waiting:storage",
            "reclaim: ",
            "src-tauri/target",
            "node_modules",
            "check-ignore",
            "integrated",
            "cancelled",
            "failed_step=",
            "action=free-disk-space",
            "result=",
            "freed=",
            "remaining=",
            "limit=",
            "wf-reserve storage: ",
            "artifacts",
            "finished",
            "stale",
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
