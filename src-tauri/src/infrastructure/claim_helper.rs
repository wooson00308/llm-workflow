//! 세션이 부르는 선점 헬퍼를 앱 관리 자산으로 서술하는 모듈.
//!
//! 설치·검증·판정 규약은 [`managed_script`](super::managed_script)가 갖는다. 이 모듈에는 자산
//! 서술(본문·이름·버전)만 남는다. 공개 함수는 프로젝트 컨트롤 루트를 인자로 받고, 경로 해석은
//! 호출자가 한다.
//!
//! 두 구현의 본문 상수는 플랫폼과 무관하게 항상 컴파일한다. 설치에 쓰이는 것은 현재 플랫폼의
//! 구현 하나뿐이지만(SPEC-015 R2), 두 본문의 버전 줄을 대조하는 테스트가 양쪽을 모두 읽어야 한다.
//!
//! 앱은 헬퍼를 설치만 하고 부르지 않는다. lease를 만들거나 지우거나 갱신하는 것은 세션이고, 앱은
//! 지금처럼 lease를 읽기만 한다.
// 다른 플랫폼의 본문 상수와 `claim_helper_path`는 현재 플랫폼의 프로덕션 경로에서 쓰이지 않는다.
// 앞의 것은 두 구현을 대조하는 테스트가, 뒤의 것은 설치 결과를 읽는 테스트가 쓴다. 공개 함수 셋을
// 유지하는 것은 호출처 배선을 건드리지 않기 위한 조건이다(SPEC-015 R10).
#![allow(dead_code)]

use std::path::{Path, PathBuf};

use crate::infrastructure::managed_script::{ManagedScript, ManagedScriptError, PlatformScript};

/// 확장자를 뺀 선점 헬퍼 파일 이름. 구현을 가리지 않고 이 자산을 식별해야 하는 곳이 쓴다.
pub const CLAIM_HELPER_STEM: &str = "wf-claim";
const CLAIM_HELPER_LABEL: &str = "선점 헬퍼";
const VERSION_PREFIX: &str = "# claim_helper_version:";
const CLAIM_HELPER_VERSION: u32 = 1;

/// 설치할 선점 헬퍼의 `sh` 구현.
///
/// 조건 스크립트와 달리 저장소에 사본을 두지 않는다. 조건 스크립트의 사본이 있는 것은 하트비트 잡
/// 설정이 그 경로를 조건으로 쓰기 때문이고, 헬퍼를 부르는 것은 데몬이 아니라 세션이며 세션은
/// 설치본을 부른다. 사본을 두면 갱신이 갈라질 자리만 는다.
const CLAIM_HELPER_SH: &str = r#"#!/bin/sh
# managed_by: workflow-labs
# claim_helper_version: 1
# LLM Workflow 선점 헬퍼. 세션은 lease 파일을 직접 만들거나 고치거나 지우지 않고 이 명령만 부른다.
# 사용법 (프로젝트 루트에서 실행):
#   sh .workflow/rules/wf-claim.sh acquire <문서-id> <에이전트> <유효분>
#   sh .workflow/rules/wf-claim.sh renew   <문서-id> <lease-id> <유효분>
#   sh .workflow/rules/wf-claim.sh release <문서-id> <lease-id>
#
# 종료 코드로 결과를 판정한다. 출력 문자열로 판정하지 않는다.
#   0 성공 (acquire는 자신이 쓴 lease_id를 표준 출력에 한 줄로 낸다)
#   1 그 밖의 실패 (입출력 오류, 마이그레이션 락)
#   2 사용법 오류
#   3 대상이 이미 미만료 lease로 선점되어 있다
#   4 만료 lease 인수 경합에서 졌다
#   5 소유자가 아니다 (renew/release의 lease_id 불일치)
#
# 알아 둘 것 셋.
# 1. 만료 판정은 문자열 비교다. 파일의 expires_at이 %Y-%m-%dT%H:%M:%SZ 표기가 아니면 미만료로
#    다루고 3으로 끝낸다. 판정하지 못하는 남의 lease를 인수하는 쪽이 더 위험하다. 앱의 lease 읽기는
#    오프셋 표기도 파싱하므로 그런 파일에서는 앱과 이 헬퍼의 판정이 갈릴 수 있다. 세션이 lease를
#    직접 만들지 않게 되면 정규 표기 밖의 파일은 헬퍼 도입 이전 것만 남는다.
# 2. 인수 구간은 <문서-id>.yml.lock 디렉터리로 감싼다. 프로세스가 SIGKILL로 죽으면 그 디렉터리가
#    남고 그 대상의 인수만 막힌다. 복구는 그 디렉터리를 지우는 것이다.
# 3. 이 스크립트가 만들거나 고치는 것은 lease 디렉터리와 그 안의 파일뿐이다. 문서 상태 기록은
#    세션이 한다.
set -u
LC_ALL=C
export LC_ALL

leases=".workflow/.runtime/leases"
migration_lock=".workflow/.runtime/migration.lock"

usage() {
  echo "usage: wf-claim.sh acquire <target-id> <agent> <minutes>" >&2
  echo "       wf-claim.sh renew <target-id> <lease-id> <minutes>" >&2
  echo "       wf-claim.sh release <target-id> <lease-id>" >&2
  exit 2
}

# 문서 id가 그대로 파일 이름이 된다. 경로 구분자나 .. 가 들어오면 lease 디렉터리 밖에 쓰게 된다.
check_target() {
  case "$1" in
    '' | *[!A-Za-z0-9_-]*) usage ;;
  esac
}

check_minutes() {
  case "$1" in
    '' | *[!0-9]*) usage ;;
  esac
  [ "$1" -gt 0 ] || usage
}

now() {
  date -u +%Y-%m-%dT%H:%M:%SZ
}

# 유효분에서 만료 시각을 만든다. epoch를 표기로 되돌리는 방법이 플랫폼마다 달라 두 갈래를 시도한다.
expires_after() { # $1=유효분
  epoch=$(date -u +%s) || return 1
  target=$((epoch + $1 * 60))
  date -u -r "$target" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null ||
    date -u -d "@$target" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null
}

field_of() { # $1=파일 $2=키
  sed -n "s/^$2: *//p" "$1" 2>/dev/null | head -1
}

# 만료됐는가. 정규 표기가 아니면 만료가 아닌 것으로 다룬다(머리 주석 1번).
is_expired() { # $1=expires_at 값
  case "$1" in
    [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z) ;;
    *) return 1 ;;
  esac
  # 자리수가 고정된 UTC 표기라 사전순 비교가 곧 시각 비교다. 같은 값은 만료로 본다.
  [ "$(printf '%s\n%s\n' "$1" "$(now)" | sort | head -1)" = "$1" ]
}

lease_body() { # $1=lease-id $2=에이전트 $3=문서-id $4=heartbeat_at $5=expires_at
  printf 'schema_version: 1\nlease_id: %s\nagent: %s\ntask_id: %s\nheartbeat_at: %s\nexpires_at: %s' \
    "$1" "$2" "$3" "$4" "$5"
}

# 임시 파일에 쓰고 제자리로 옮긴다. 임시 이름의 확장자가 yml이 아니라 앱의 lease 읽기와 조건
# 스크립트의 lease 검사 어느 쪽에도 걸리지 않는다.
replace_lease() { # $1=대상 파일 $2=본문
  temporary="$1.tmp.$$"
  printf '%s\n' "$2" > "$temporary" 2>/dev/null || return 1
  mv "$temporary" "$1" 2>/dev/null || {
    rm -f "$temporary"
    return 1
  }
}

command="${1:-}"
case "$command" in
  acquire | renew)
    [ "$#" -eq 4 ] || usage
    check_target "$2"
    check_minutes "$4"
    ;;
  release)
    [ "$#" -eq 3 ] || usage
    check_target "$2"
    ;;
  *)
    usage
    ;;
esac

# 락이 걸린 동안에는 lease 디렉터리를 쓰지 않는다. 공통 규칙 1절과 같은 판정이다. 사용법 오류를
# 먼저 보는 것은 그 오류가 락과 무관하게 같은 인자로 다시 실패하기 때문이다.
[ -f "$migration_lock" ] && exit 1

target_id="$2"
lease="$leases/$target_id.yml"

if [ "$command" = acquire ]; then
  mkdir -p "$leases" 2>/dev/null || exit 1
  started=$(now) || exit 1
  expires=$(expires_after "$4") || exit 1
  lease_id="lease-$$-$(printf '%s' "$started" | tr -dc 0-9)"
  body=$(lease_body "$lease_id" "$3" "$target_id" "$started" "$expires")

  # 비어 있는 대상은 배타적 생성 한 번으로 끝난다. 리다이렉트 자체가 O_EXCL이라 동시에 들어온 두
  # 호출 중 하나만 성공한다.
  if (set -C; printf '%s\n' "$body" > "$lease") 2>/dev/null; then
    printf '%s\n' "$lease_id"
    exit 0
  fi

  # 파일이 있다. 인수는 읽기·판단·쓰기 세 단계라 배타적 생성처럼 한 번에 끝나지 않으므로 그 구간을
  # 디렉터리 생성으로 감싼다. mkdir은 POSIX에서 원자적이고 이미 있으면 실패한다.
  lock="$lease.lock"
  mkdir "$lock" 2>/dev/null || exit 4
  trap 'rmdir "$lock" 2>/dev/null' EXIT
  trap 'exit 1' INT TERM HUP

  # 배타적 생성이 실패한 시점과 잠금을 잡은 시점 사이에 다른 호출이 인수를 끝냈을 수 있다.
  if [ -f "$lease" ]; then
    is_expired "$(field_of "$lease" expires_at)" || exit 3
  fi
  replace_lease "$lease" "$body" || exit 1
  printf '%s\n' "$lease_id"
  exit 0
fi

# renew와 release는 소유자를 확인한 뒤에만 파일을 건드린다. 파일이 없어도 현재 소유자가 아니라는
# 결론은 같다. 잠금을 쓰지 않는다 — 겨루는 상대인 인수는 만료된 lease에만 일어나고, 인수당한
# 세션은 여기서 lease_id가 달라 5를 받는다.
[ -f "$lease" ] || exit 5
[ "$(field_of "$lease" lease_id)" = "$3" ] || exit 5

if [ "$command" = renew ]; then
  started=$(now) || exit 1
  expires=$(expires_after "$4") || exit 1
  # heartbeat_at과 expires_at 두 줄만 바꾸고 나머지 줄은 원문 그대로 옮긴다. 계약이 선택 필드를
  # 허용하므로 아는 필드만 다시 쓰면 모르는 필드가 사라진다.
  updated=$(sed "s|^heartbeat_at: .*|heartbeat_at: $started|; s|^expires_at: .*|expires_at: $expires|" "$lease") || exit 1
  replace_lease "$lease" "$updated" || exit 1
  exit 0
fi

rm -f "$lease" 2>/dev/null || exit 1
exit 0
"#;

/// 설치할 선점 헬퍼의 PowerShell 구현. `sh` 구현과 같은 계약을 지키고 같은 판정을 낸다.
/// BOM은 본문의 일부다 — Windows PowerShell 5.1이 BOM 없는 파일을 ANSI로 읽는 함정은
/// `reservation_helper.rs`의 같은 자리 주석이 기록한다.
const CLAIM_HELPER_PS1: &str = concat!(
    "\u{feff}",
    r#"# LLM Workflow claim helper.
# managed_by: workflow-labs
# claim_helper_version: 1
# A session never creates, edits, or deletes a lease file itself; it calls this script.
# Usage (run from the project root):
#   powershell -NoProfile -ExecutionPolicy Bypass -File .workflow/rules/wf-claim.ps1 acquire <target-id> <agent> <minutes>
#   powershell -NoProfile -ExecutionPolicy Bypass -File .workflow/rules/wf-claim.ps1 renew <target-id> <lease-id> <minutes>
#   powershell -NoProfile -ExecutionPolicy Bypass -File .workflow/rules/wf-claim.ps1 release <target-id> <lease-id>
#
# Judge the result by the exit code, never by the printed text.
#   0 success (acquire prints the lease_id it wrote, on one line)
#   1 other failure (I/O error, migration lock)
#   2 usage error
#   3 the target already carries an unexpired lease
#   4 lost the race to take over an expired lease
#   5 not the owner (lease_id mismatch on renew or release)
#
# This is the Windows twin of wf-claim.sh and must reach the same verdict for every input.
# The body opens with a UTF-8 BOM so Windows PowerShell 5.1 reads it as UTF-8.
#
# Three things to know.
# 1. Expiry is a string comparison. An expires_at outside the yyyy-MM-ddTHH:mm:ssZ form counts as
#    unexpired and ends in 3. Taking over a lease we cannot judge is worse than leaving it. The app
#    parses offset forms too, so on such a file the app and this helper can disagree. Once sessions
#    stop writing leases by hand, only files older than the helper carry those forms.
# 2. The takeover section is guarded by <target-id>.yml.lock inside the lease directory. The shell
#    twin makes that name a directory and this one makes it a file; each fails while the other
#    exists, so the exclusion holds even when one repository is opened from both platforms. If the
#    process is killed outright the guard survives and only that one target stops being taken over.
#    Deleting it is the recovery.
# 3. This script creates and edits nothing outside the lease directory. Recording document state is
#    the session's job.
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments = @())

$ErrorActionPreference = 'Stop'

# .NET resolves relative paths against the process directory, which does not follow the PowerShell
# location. The two agree at startup and this script never moves, but pinning it keeps every
# System.IO call below on the project root.
[System.Environment]::CurrentDirectory = (Get-Location).ProviderPath

$leases = '.workflow/.runtime/leases'
$migrationLock = '.workflow/.runtime/migration.lock'

function Write-Usage() {
  [Console]::Error.WriteLine('usage: wf-claim.ps1 acquire <target-id> <agent> <minutes>')
  [Console]::Error.WriteLine('       wf-claim.ps1 renew <target-id> <lease-id> <minutes>')
  [Console]::Error.WriteLine('       wf-claim.ps1 release <target-id> <lease-id>')
  exit 2
}

# Fixed-width UTC, the same form the shell twin writes. Both implementations and the app read it.
function Get-Stamp([int]$Offset) {
  return ([System.DateTime]::UtcNow.AddMinutes($Offset)).ToString(
    'yyyy-MM-ddTHH:mm:ssZ', [System.Globalization.CultureInfo]::InvariantCulture)
}

# Mirrors "sed -n 's/^<key>: *//p' | head -1". An unreadable file yields an empty value.
function Get-Field([string]$Path, [string]$Key) {
  $lines = @()
  try { $lines = @(Get-Content -LiteralPath $Path -ErrorAction Stop) } catch { return '' }
  foreach ($line in $lines) {
    if ($line.StartsWith($Key + ':', [System.StringComparison]::Ordinal)) {
      return ($line -creplace ('^' + $Key + ': *'), '')
    }
  }
  return ''
}

# Has it expired? A stamp outside the canonical form counts as unexpired (head comment 1). Fixed
# width means an ordinal comparison is the time comparison, and an equal stamp counts as expired.
function Test-Expired([string]$Stamp) {
  if ($Stamp -cnotmatch '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$') { return $false }
  return ([string]::CompareOrdinal($Stamp, (Get-Stamp 0)) -le 0)
}

function New-LeaseBody([string]$LeaseId, [string]$Agent, [string]$TargetId, [string]$Started, [string]$Expires) {
  return @(
    'schema_version: 1',
    ('lease_id: ' + $LeaseId),
    ('agent: ' + $Agent),
    ('task_id: ' + $TargetId),
    ('heartbeat_at: ' + $Started),
    ('expires_at: ' + $Expires))
}

# LF endings and no BOM, so both implementations leave the same bytes behind.
function ConvertTo-Text([string[]]$Lines) {
  return ([string]::Join("`n", $Lines) + "`n")
}

# The exclusive create. FileMode.CreateNew fails when the path exists, which is the O_EXCL that
# "set -C" gives the shell twin.
function New-FileExclusive([string]$Path, [string]$Text) {
  try {
    $stream = [System.IO.File]::Open(
      $Path, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
  } catch { return $false }
  try {
    $bytes = [System.Text.UTF8Encoding]::new($false).GetBytes($Text)
    $stream.Write($bytes, 0, $bytes.Length)
  } finally { $stream.Dispose() }
  return $true
}

# Write to a temporary name and move it into place. That name does not end in .yml, so neither the
# app's lease read nor the condition script's lease check sees it.
function Set-Lease([string]$Path, [string]$Text) {
  $temporary = $Path + '.tmp.' + $PID
  try {
    [System.IO.File]::WriteAllText($temporary, $Text, [System.Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporary -Destination $Path -Force
  } catch {
    Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
    return $false
  }
  return $true
}

if ($null -eq $Arguments -or $Arguments.Count -eq 0) { Write-Usage }
$command = $Arguments[0]
switch -CaseSensitive ($command) {
  'acquire' { if ($Arguments.Count -ne 4) { Write-Usage } }
  'renew' { if ($Arguments.Count -ne 4) { Write-Usage } }
  'release' { if ($Arguments.Count -ne 3) { Write-Usage } }
  default { Write-Usage }
}

# The target id becomes the file name. A path separator or .. would write outside the lease
# directory.
$targetId = $Arguments[1]
if ($targetId -cnotmatch '^[A-Za-z0-9_-]+$') { Write-Usage }
if ($command -cne 'release') {
  if ($Arguments[3] -cnotmatch '^[0-9]+$') { Write-Usage }
  if ([int]$Arguments[3] -le 0) { Write-Usage }
}

# Nothing is written to the lease directory while the lock is up, the same verdict as section 1 of
# the shared rules. Usage errors come first because they fail again with the same arguments anyway.
if (Test-Path -LiteralPath $migrationLock -PathType Leaf) { exit 1 }

$lease = Join-Path $leases ($targetId + '.yml')

if ($command -ceq 'acquire') {
  try { [void][System.IO.Directory]::CreateDirectory($leases) } catch { exit 1 }
  $started = Get-Stamp 0
  $expires = Get-Stamp ([int]$Arguments[3])
  $leaseId = 'lease-' + $PID + '-' + ($started -creplace '[^0-9]', '')
  $text = ConvertTo-Text (New-LeaseBody $leaseId $Arguments[2] $targetId $started $expires)

  # An empty target is done in one exclusive create: of two calls arriving together, one wins.
  if (New-FileExclusive $lease $text) {
    [Console]::Out.WriteLine($leaseId)
    exit 0
  }

  # The file exists. Taking over is read, judge, write, so it does not finish in one step the way
  # the exclusive create does; that section is guarded by a lock whose creation is atomic.
  $lock = $lease + '.lock'
  if (-not (New-FileExclusive $lock '')) { exit 4 }
  try {
    # Another call may have finished its takeover between the failed create and the lock.
    if (Test-Path -LiteralPath $lease -PathType Leaf) {
      if (-not (Test-Expired (Get-Field $lease 'expires_at'))) { exit 3 }
    }
    if (-not (Set-Lease $lease $text)) { exit 1 }
    [Console]::Out.WriteLine($leaseId)
    exit 0
  } finally {
    Remove-Item -LiteralPath $lock -Force -ErrorAction SilentlyContinue
  }
}

# renew and release touch the file only after checking the owner. A missing file reaches the same
# conclusion: not the current owner. No lock is taken. The contender is a takeover, which happens
# only to an expired lease, and a session that was taken over finds a different lease_id here.
if (-not (Test-Path -LiteralPath $lease -PathType Leaf)) { exit 5 }
if ((Get-Field $lease 'lease_id') -cne $Arguments[2]) { exit 5 }

if ($command -ceq 'renew') {
  $started = Get-Stamp 0
  $expires = Get-Stamp ([int]$Arguments[3])
  # Only those two lines change; every other line moves across as written. The contract allows
  # optional fields, so rewriting only the known ones would drop what this helper does not know.
  $updated = @()
  foreach ($line in @(Get-Content -LiteralPath $lease)) {
    if ($line.StartsWith('heartbeat_at: ', [System.StringComparison]::Ordinal)) {
      $updated += ('heartbeat_at: ' + $started)
    } elseif ($line.StartsWith('expires_at: ', [System.StringComparison]::Ordinal)) {
      $updated += ('expires_at: ' + $expires)
    } else {
      $updated += $line
    }
  }
  if (-not (Set-Lease $lease (ConvertTo-Text $updated))) { exit 1 }
  exit 0
}

try { Remove-Item -LiteralPath $lease -Force } catch { exit 1 }
exit 0
"#
);

/// 현재 플랫폼에 설치할 구현. 런타임 분기가 아니라 컴파일 시점 분기다 — 앱은 자기가 도는 플랫폼의
/// 자산만 쓴다(SPEC-015 R2).
#[cfg(not(windows))]
const PLATFORM: PlatformScript = PlatformScript {
    extension: "sh",
    body: CLAIM_HELPER_SH,
};

#[cfg(windows)]
const PLATFORM: PlatformScript = PlatformScript {
    extension: "ps1",
    body: CLAIM_HELPER_PS1,
};

/// 선점 헬퍼 자산. 설치 규약은 [`ManagedScript`]가 갖는다.
pub const CLAIM_HELPER: ManagedScript = ManagedScript {
    stem: CLAIM_HELPER_STEM,
    label: CLAIM_HELPER_LABEL,
    version_prefix: VERSION_PREFIX,
    version: CLAIM_HELPER_VERSION,
    platform: PLATFORM,
};

/// 공용 규약으로 옮기기 전의 이름. 호출처의 `#[from]` 배선을 그대로 두려고 별칭으로 잇는다.
pub type ClaimHelperError = ManagedScriptError;

/// 컨트롤 루트 기준 선점 헬퍼 경로. 파일 이름은 현재 플랫폼의 구현을 따른다.
pub fn claim_helper_path(control_root: &Path) -> PathBuf {
    CLAIM_HELPER.path(control_root)
}

/// 선점 헬퍼를 앱 버전으로 설치한다. 내용이 이미 같으면 파일을 쓰지 않는다.
pub fn install_claim_helper(control_root: &Path) -> Result<(), ClaimHelperError> {
    CLAIM_HELPER.install(control_root)
}

/// 설치와 같은 판정만 하고 파일은 쓰지 않는다.
pub fn validate_claim_helper(control_root: &Path) -> Result<(), ClaimHelperError> {
    CLAIM_HELPER.validate(control_root)
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::{Path, PathBuf};

    use chrono::{Duration, Utc};
    use tempfile::{tempdir, TempDir};

    #[test]
    fn the_powershell_body_carries_a_byte_order_mark_and_the_shell_body_does_not() {
        assert!(super::CLAIM_HELPER_PS1.starts_with('\u{feff}'));
        assert!(super::CLAIM_HELPER_SH.starts_with("#!/bin/sh"));
    }

    use super::{
        claim_helper_path, install_claim_helper, validate_claim_helper, ClaimHelperError,
        CLAIM_HELPER, CLAIM_HELPER_PS1, CLAIM_HELPER_SH, CLAIM_HELPER_STEM, CLAIM_HELPER_VERSION,
        VERSION_PREFIX,
    };

    /// 프로젝트 루트와 그 안의 컨트롤 루트를 만든다.
    fn project() -> (TempDir, PathBuf) {
        let root = tempdir().expect("project root");
        let control = root.path().join(".workflow");
        fs::create_dir(&control).expect("control root");
        (root, control)
    }

    #[test]
    fn installs_claim_helper_with_managed_markers() {
        let (_root, control) = project();

        install_claim_helper(&control).expect("install claim helper");

        let helper = fs::read_to_string(claim_helper_path(&control)).expect("helper");
        assert_eq!(helper, CLAIM_HELPER.platform.body);
        assert!(helper.contains("# managed_by: workflow-labs"));
        assert!(helper.contains("# claim_helper_version: 1"));
        assert!(helper.contains("migration.lock"));
    }

    #[test]
    fn installs_the_implementation_for_the_current_platform() {
        let (_root, control) = project();

        install_claim_helper(&control).expect("install claim helper");

        let installed = claim_helper_path(&control);
        let expected = if cfg!(windows) {
            "wf-claim.ps1"
        } else {
            "wf-claim.sh"
        };
        assert_eq!(
            installed.file_name().expect("file name").to_string_lossy(),
            expected
        );
        assert!(installed.exists());
    }

    /// 다른 플랫폼용 구현이 같은 디렉터리에 있어도 설치가 그 파일을 만들거나 고치거나 지우지 않는다.
    #[test]
    fn leaves_the_other_platform_asset_untouched() {
        let (_root, control) = project();
        let rules = control.join("rules");
        fs::create_dir_all(&rules).expect("rules root");
        let other = rules.join(if cfg!(windows) {
            "wf-claim.sh"
        } else {
            "wf-claim.ps1"
        });
        let foreign = "# managed_by: workflow-labs\n# claim_helper_version: 1\nother platform\n";
        fs::write(&other, foreign).expect("other platform asset");
        let before = fs::metadata(&other).expect("metadata").modified().ok();

        install_claim_helper(&control).expect("install must not mind the other platform");
        validate_claim_helper(&control).expect("validate must not mind the other platform");

        assert_eq!(fs::read_to_string(&other).expect("other asset"), foreign);
        assert_eq!(
            before,
            fs::metadata(&other)
                .expect("metadata again")
                .modified()
                .ok()
        );
    }

    #[test]
    fn both_implementations_share_the_managed_markers_and_version() {
        let expected = format!("{VERSION_PREFIX} {CLAIM_HELPER_VERSION}");
        for body in [CLAIM_HELPER_SH, CLAIM_HELPER_PS1] {
            assert!(body
                .lines()
                .any(|line| line.trim() == "# managed_by: workflow-labs"));
            assert!(
                body.lines().any(|line| line.trim() == expected),
                "버전 줄이 자산 서술의 값과 다르다"
            );
        }
    }

    #[test]
    fn the_powershell_implementation_is_ascii_after_its_byte_order_mark() {
        assert!(CLAIM_HELPER_PS1.trim_start_matches('\u{feff}').is_ascii());
    }

    /// 두 구현이 같은 하위 명령과 같은 종료 코드를 문서화한다. 계약이 갈리면 여기서 드러난다.
    #[test]
    fn both_implementations_carry_the_same_interface() {
        for body in [CLAIM_HELPER_SH, CLAIM_HELPER_PS1] {
            for token in ["acquire", "renew", "release", ".yml.lock", "migration.lock"] {
                assert!(body.contains(token), "{token}이 한쪽 구현에 없다");
            }
        }
    }

    #[test]
    fn installing_twice_leaves_the_file_unchanged() {
        let (_root, control) = project();
        let path = claim_helper_path(&control);

        install_claim_helper(&control).expect("first install");
        let first = fs::read_to_string(&path).expect("helper");
        let first_modified = fs::metadata(&path).expect("metadata").modified().ok();
        install_claim_helper(&control).expect("second install");

        assert_eq!(first, fs::read_to_string(&path).expect("helper again"));
        assert_eq!(
            first_modified,
            fs::metadata(&path).expect("metadata again").modified().ok()
        );
    }

    #[test]
    fn refuses_to_overwrite_an_unmanaged_helper() {
        let (_root, control) = project();
        let path = claim_helper_path(&control);
        fs::create_dir_all(path.parent().expect("rules root")).expect("rules root");
        let foreign = "#!/bin/sh\nexit 0\n";
        fs::write(&path, foreign).expect("foreign helper");

        let error =
            install_claim_helper(&control).expect_err("unmanaged helper must not be replaced");

        assert!(matches!(error, ClaimHelperError::Unmanaged(_)));
        assert_eq!(fs::read_to_string(&path).expect("helper"), foreign);
    }

    #[test]
    fn refuses_a_helper_without_a_readable_version() {
        let (_root, control) = project();
        let path = claim_helper_path(&control);
        fs::create_dir_all(path.parent().expect("rules root")).expect("rules root");
        let broken = "#!/bin/sh\n# managed_by: workflow-labs\nexit 1\n";
        fs::write(&path, broken).expect("versionless helper");

        let error = install_claim_helper(&control)
            .expect_err("a helper without a version must not be replaced");

        assert!(matches!(error, ClaimHelperError::Unmanaged(_)));
        assert_eq!(fs::read_to_string(&path).expect("helper"), broken);
    }

    #[test]
    fn refuses_to_downgrade_a_future_helper() {
        let (_root, control) = project();
        let path = claim_helper_path(&control);
        fs::create_dir_all(path.parent().expect("rules root")).expect("rules root");
        let future =
            "#!/bin/sh\n# managed_by: workflow-labs\n# claim_helper_version: 999\nexit 1\n";
        fs::write(&path, future).expect("future helper");

        let error =
            install_claim_helper(&control).expect_err("future helper must not be downgraded");

        assert!(matches!(
            error,
            ClaimHelperError::Downgrade { found: 999, .. }
        ));
        assert_eq!(fs::read_to_string(&path).expect("helper"), future);
    }

    #[test]
    fn rewrites_a_managed_helper_that_drifted() {
        let (_root, control) = project();
        let path = claim_helper_path(&control);
        fs::create_dir_all(path.parent().expect("rules root")).expect("rules root");
        fs::write(
            &path,
            "#!/bin/sh\n# managed_by: workflow-labs\n# claim_helper_version: 1\nexit 1\n",
        )
        .expect("drifted helper");

        install_claim_helper(&control).expect("install claim helper");

        assert_eq!(
            fs::read_to_string(&path).expect("helper"),
            CLAIM_HELPER.platform.body
        );
    }

    /// 두 관리 자산은 서로 다른 버전 축을 쓴다. 한쪽 상수만 올려도 다른 쪽 설치본은 갱신 대상이
    /// 되지 않아야 한다.
    #[test]
    fn keeps_the_version_axis_separate_from_the_condition_script() {
        use crate::infrastructure::heartbeat_condition::{
            condition_script_path, install_condition_script,
        };

        let (_root, control) = project();
        install_claim_helper(&control).expect("install claim helper");
        install_condition_script(&control).expect("install condition script");

        let helper = fs::read_to_string(claim_helper_path(&control)).expect("helper");
        let condition = fs::read_to_string(condition_script_path(&control)).expect("condition");
        assert!(helper.contains("# claim_helper_version:"));
        assert!(!helper.contains("# condition_script_version:"));
        assert!(condition.contains("# condition_script_version:"));
        assert!(!condition.contains("# claim_helper_version:"));
    }

    #[test]
    fn the_asset_description_carries_its_own_version_axis() {
        assert_eq!(CLAIM_HELPER.version_prefix, VERSION_PREFIX);
        assert_eq!(CLAIM_HELPER.version, CLAIM_HELPER_VERSION);
        assert_eq!(CLAIM_HELPER.stem, CLAIM_HELPER_STEM);
        assert_eq!(CLAIM_HELPER.label, "선점 헬퍼");
        assert_eq!(CLAIM_HELPER.relative_path(), {
            let name = if cfg!(windows) {
                "wf-claim.ps1"
            } else {
                "wf-claim.sh"
            };
            format!(".workflow/rules/{name}")
        });
    }

    /// 공용 규약으로 옮겨도 오류 문구가 TASK-039가 낸 것과 같아야 한다.
    #[test]
    fn the_error_messages_name_the_claim_helper() {
        let (_root, control) = project();
        let path = claim_helper_path(&control);
        fs::create_dir_all(path.parent().expect("rules root")).expect("rules root");

        fs::write(&path, "unmanaged\n").expect("unmanaged helper");
        let unmanaged = install_claim_helper(&control).expect_err("unmanaged");
        assert_eq!(
            unmanaged.to_string(),
            format!(
                "{}에 앱이 관리하지 않는 파일이 있어 덮어쓰지 않았습니다. 그 파일을 옮기거나 지운 뒤 다시 시도하세요.",
                path.display()
            )
        );

        fs::write(
            &path,
            "# managed_by: workflow-labs\n# claim_helper_version: 999\n",
        )
        .expect("future helper");
        let downgrade = install_claim_helper(&control).expect_err("downgrade");
        assert_eq!(
            downgrade.to_string(),
            format!(
                "{}의 선점 헬퍼 버전 999이 앱이 아는 버전 1보다 높아 덮어쓰지 않았습니다. 앱을 최신 버전으로 올린 뒤 다시 시도하세요.",
                path.display()
            )
        );
    }

    fn helper_project() -> (TempDir, PathBuf) {
        let (root, control) = project();
        install_claim_helper(&control).expect("install claim helper");
        (root, control)
    }

    /// 현재 플랫폼의 설치본을 그 플랫폼의 방식으로 실행하고 종료 코드와 표준 출력을 돌려준다.
    fn run_claim(project_root: &Path, arguments: &[&str]) -> (i32, String) {
        use std::process::Command;

        let script = CLAIM_HELPER.relative_path();
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
            .expect("run claim helper");
        (
            output.status.code().expect("exit code"),
            String::from_utf8_lossy(&output.stdout).trim().to_owned(),
        )
    }

    fn lease_path(control_root: &Path, target: &str) -> PathBuf {
        control_root
            .join(".runtime/leases")
            .join(format!("{target}.yml"))
    }

    /// 남이 잡아 둔 lease 하나. `expires_at`을 그대로 받아 만료·미만료·정규 표기 밖을 모두 만든다.
    fn write_lease(control_root: &Path, target: &str, lease_id: &str, expires_at: &str) -> PathBuf {
        let path = lease_path(control_root, target);
        fs::create_dir_all(path.parent().expect("leases root")).expect("leases root");
        fs::write(
            &path,
            format!(
                "schema_version: 1\nlease_id: {lease_id}\nagent: other\ntask_id: {target}\nheartbeat_at: 2026-08-03T00:00:00Z\nexpires_at: {expires_at}\n"
            ),
        )
        .expect("write lease");
        path
    }

    fn stamp(minutes_from_now: i64) -> String {
        (Utc::now() + Duration::minutes(minutes_from_now))
            .format("%Y-%m-%dT%H:%M:%SZ")
            .to_string()
    }

    fn field_of(path: &Path, key: &str) -> String {
        fs::read_to_string(path)
            .expect("lease")
            .lines()
            .find_map(|line| line.strip_prefix(&format!("{key}: ")))
            .unwrap_or_default()
            .to_owned()
    }

    #[test]
    fn acquires_an_empty_target_and_prints_the_lease_id() {
        let (root, control) = helper_project();

        let (code, printed) = run_claim(root.path(), &["acquire", "TASK-001", "dev-a", "30"]);

        assert_eq!(code, 0);
        let path = lease_path(&control, "TASK-001");
        let contents = fs::read_to_string(&path).expect("lease");
        // R7이 정한 현행 형식 그대로다. 헬퍼는 이 키들만 쓰고 스키마를 늘리지 않는다.
        assert_eq!(
            contents
                .lines()
                .filter_map(|line| line.split(':').next())
                .collect::<Vec<_>>(),
            vec![
                "schema_version",
                "lease_id",
                "agent",
                "task_id",
                "heartbeat_at",
                "expires_at",
            ],
            "{contents}"
        );
        assert!(contents.starts_with("schema_version: 1\n"));
        assert_eq!(field_of(&path, "lease_id"), printed);
        assert_eq!(field_of(&path, "agent"), "dev-a");
        assert_eq!(field_of(&path, "task_id"), "TASK-001");
        assert_eq!(field_of(&path, "expires_at").len(), 20);
        assert!(field_of(&path, "heartbeat_at").ends_with('Z'));
        assert!(
            !path.with_extension("yml.lock").exists(),
            "성공한 선점 뒤 잠금 디렉터리가 남았다"
        );
    }

    #[test]
    fn refuses_a_target_that_an_unexpired_lease_covers() {
        let (root, control) = helper_project();
        let path = write_lease(&control, "TASK-001", "held", &stamp(30));
        let before = fs::read_to_string(&path).expect("lease");

        let (code, _) = run_claim(root.path(), &["acquire", "TASK-001", "dev-a", "30"]);

        assert_eq!(code, 3);
        assert_eq!(fs::read_to_string(&path).expect("lease"), before);
    }

    #[test]
    fn takes_over_an_expired_lease() {
        let (root, control) = helper_project();
        let path = write_lease(&control, "TASK-001", "expired-owner", &stamp(-5));

        let (code, printed) = run_claim(root.path(), &["acquire", "TASK-001", "dev-a", "30"]);

        assert_eq!(code, 0);
        assert_eq!(field_of(&path, "lease_id"), printed);
        assert_ne!(field_of(&path, "lease_id"), "expired-owner");
        assert_eq!(field_of(&path, "agent"), "dev-a");
        assert!(field_of(&path, "expires_at") > stamp(0));
    }

    /// 정규 표기가 아닌 `expires_at`은 미만료로 다룬다. 판정하지 못하는 남의 lease를 인수하는 쪽이
    /// 더 위험하다.
    #[test]
    fn never_takes_over_a_lease_it_cannot_judge() {
        let (root, control) = helper_project();

        for expires_at in ["2026-08-03T00:10:00+00:00", "2026-08-03T00:10:00.5Z", ""] {
            let path = write_lease(&control, "TASK-001", "held", expires_at);
            let before = fs::read_to_string(&path).expect("lease");

            let (code, _) = run_claim(root.path(), &["acquire", "TASK-001", "dev-a", "30"]);

            assert_eq!(code, 3, "{expires_at:?}는 판정할 수 없다");
            assert_eq!(fs::read_to_string(&path).expect("lease"), before);
        }
    }

    #[test]
    fn loses_the_takeover_when_the_lock_directory_exists() {
        let (root, control) = helper_project();
        let path = write_lease(&control, "TASK-001", "expired-owner", &stamp(-5));
        let before = fs::read_to_string(&path).expect("lease");
        let lock = control.join(".runtime/leases/TASK-001.yml.lock");
        fs::create_dir(&lock).expect("lock directory");

        let (code, _) = run_claim(root.path(), &["acquire", "TASK-001", "dev-a", "30"]);

        assert_eq!(code, 4);
        assert_eq!(fs::read_to_string(&path).expect("lease"), before);
        assert!(lock.is_dir(), "남의 잠금을 지우지 않는다");
    }

    /// 같은 만료 lease를 동시에 인수하려 한 두 호출 중 정확히 하나만 성공한다.
    #[test]
    fn exactly_one_call_wins_the_race_for_an_expired_lease() {
        let (root, control) = helper_project();
        let path = write_lease(&control, "TASK-001", "expired-owner", &stamp(-5));

        let first_root = root.path().to_owned();
        let second_root = root.path().to_owned();
        let first = std::thread::spawn(move || {
            run_claim(&first_root, &["acquire", "TASK-001", "first", "30"])
        });
        let second = std::thread::spawn(move || {
            run_claim(&second_root, &["acquire", "TASK-001", "second", "30"])
        });
        let first = first.join().expect("first call");
        let second = second.join().expect("second call");

        let winners = [&first, &second]
            .into_iter()
            .filter(|(code, _)| *code == 0)
            .collect::<Vec<_>>();
        assert_eq!(
            winners.len(),
            1,
            "정확히 하나만 성공해야 한다: {:?}",
            (first.0, second.0)
        );
        let loser = if first.0 == 0 { second.0 } else { first.0 };
        assert!(matches!(loser, 3 | 4), "진 쪽은 3이나 4다: {loser}");
        assert_eq!(field_of(&path, "lease_id"), winners[0].1);
        assert!(!control.join(".runtime/leases/TASK-001.yml.lock").exists());
    }

    #[test]
    fn renews_only_for_the_owner() {
        let (root, control) = helper_project();
        let (code, lease_id) = run_claim(root.path(), &["acquire", "TASK-001", "dev-a", "1"]);
        assert_eq!(code, 0);
        let path = lease_path(&control, "TASK-001");
        let before = fs::read_to_string(&path).expect("lease");

        let (rejected, _) = run_claim(root.path(), &["renew", "TASK-001", "someone-else", "60"]);
        assert_eq!(rejected, 5);
        assert_eq!(fs::read_to_string(&path).expect("lease"), before);

        let (accepted, _) = run_claim(root.path(), &["renew", "TASK-001", &lease_id, "60"]);
        assert_eq!(accepted, 0);
        assert_eq!(field_of(&path, "lease_id"), lease_id);
        assert_eq!(field_of(&path, "agent"), "dev-a");
        assert_eq!(field_of(&path, "task_id"), "TASK-001");
        assert!(
            field_of(&path, "expires_at") > stamp(30),
            "유효 기간이 미뤄지지 않았다"
        );
    }

    /// 계약이 선택 필드를 허용하므로 갱신은 아는 두 줄만 바꾸고 나머지 줄을 원문 그대로 옮긴다.
    #[test]
    fn renewing_keeps_fields_the_helper_does_not_know() {
        let (root, control) = helper_project();
        let path = lease_path(&control, "TASK-001");
        fs::create_dir_all(path.parent().expect("leases root")).expect("leases root");
        fs::write(
            &path,
            format!(
                "schema_version: 1\nlease_id: mine\nagent: dev-a\nrole: developer\ntask_id: TASK-001\nheartbeat_at: 2026-08-03T00:00:00Z\nexpires_at: {}\n",
                stamp(30)
            ),
        )
        .expect("lease with a role");

        let (code, _) = run_claim(root.path(), &["renew", "TASK-001", "mine", "60"]);

        assert_eq!(code, 0);
        assert_eq!(field_of(&path, "role"), "developer");
        assert_eq!(field_of(&path, "lease_id"), "mine");
        assert!(field_of(&path, "expires_at") > stamp(30));
    }

    #[test]
    fn releases_only_for_the_owner() {
        let (root, control) = helper_project();
        let (code, lease_id) = run_claim(root.path(), &["acquire", "TASK-001", "dev-a", "30"]);
        assert_eq!(code, 0);
        let path = lease_path(&control, "TASK-001");
        let before = fs::read_to_string(&path).expect("lease");

        let (rejected, _) = run_claim(root.path(), &["release", "TASK-001", "someone-else"]);
        assert_eq!(rejected, 5);
        assert_eq!(fs::read_to_string(&path).expect("lease"), before);

        let (accepted, _) = run_claim(root.path(), &["release", "TASK-001", &lease_id]);
        assert_eq!(accepted, 0);
        assert!(!path.exists());
    }

    /// 인수당한 세션이 뒤늦게 끝나면서 새 소유자의 lease를 지우는 경로를 막는다.
    #[test]
    fn the_replaced_owner_cannot_release_the_new_lease() {
        let (root, control) = helper_project();
        write_lease(&control, "TASK-001", "expired-owner", &stamp(-5));
        let (code, new_owner) = run_claim(root.path(), &["acquire", "TASK-001", "dev-a", "30"]);
        assert_eq!(code, 0);
        let path = lease_path(&control, "TASK-001");

        let (released, _) = run_claim(root.path(), &["release", "TASK-001", "expired-owner"]);
        let (renewed, _) = run_claim(root.path(), &["renew", "TASK-001", "expired-owner", "30"]);

        assert_eq!(released, 5);
        assert_eq!(renewed, 5);
        assert_eq!(field_of(&path, "lease_id"), new_owner);
    }

    #[test]
    fn treats_a_missing_lease_as_not_owned() {
        let (root, _control) = helper_project();

        assert_eq!(
            run_claim(root.path(), &["renew", "TASK-404", "any", "30"]).0,
            5
        );
        assert_eq!(run_claim(root.path(), &["release", "TASK-404", "any"]).0, 5);
    }

    #[test]
    fn does_not_touch_leases_while_the_migration_lock_exists() {
        let (root, control) = helper_project();
        let held = write_lease(&control, "TASK-002", "mine", &stamp(30));
        fs::create_dir_all(control.join(".runtime")).expect("runtime root");
        fs::write(control.join(".runtime/migration.lock"), "").expect("migration lock");

        assert_eq!(
            run_claim(root.path(), &["acquire", "TASK-001", "dev-a", "30"]).0,
            1
        );
        assert_eq!(
            run_claim(root.path(), &["renew", "TASK-002", "mine", "30"]).0,
            1
        );
        assert_eq!(
            run_claim(root.path(), &["release", "TASK-002", "mine"]).0,
            1
        );
        assert!(!lease_path(&control, "TASK-001").exists());
        assert!(held.is_file());
    }

    /// 문서 id가 그대로 파일 이름이 되므로 경로가 섞인 id는 사용법 오류다.
    #[test]
    fn rejects_calls_that_do_not_match_the_contract() {
        let (root, _control) = helper_project();
        let cases: [&[&str]; 8] = [
            &[],
            &["claim", "TASK-001", "dev-a", "30"],
            &["acquire", "TASK-001", "dev-a"],
            &["release", "TASK-001", "lease", "extra"],
            &["acquire", "TASK-001", "dev-a", "0"],
            &["acquire", "TASK-001", "dev-a", "half"],
            &["acquire", "../outside", "dev-a", "30"],
            &["acquire", "wf/TASK-001", "dev-a", "30"],
        ];

        for arguments in cases {
            assert_eq!(
                run_claim(root.path(), arguments).0,
                2,
                "{arguments:?}는 사용법 오류다"
            );
        }
    }
}
