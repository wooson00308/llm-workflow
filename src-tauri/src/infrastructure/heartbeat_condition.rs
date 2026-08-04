//! 하트비트 잡의 조건 스크립트를 앱 관리 자산으로 서술하는 모듈.
//!
//! 설치·검증·판정 규약은 [`managed_script`](super::managed_script)가 갖는다. 이 모듈에는 자산
//! 서술(본문·이름·버전)만 남는다. 공개 함수는 프로젝트 컨트롤 루트를 인자로 받고, 경로 해석은
//! 커맨드 계층이 한다.
//!
//! 두 구현의 본문 상수는 플랫폼과 무관하게 항상 컴파일한다. 설치에 쓰이는 것은 현재 플랫폼의
//! 구현 하나뿐이지만(R2), 두 본문의 버전 줄을 대조하는 테스트가 양쪽을 모두 읽어야 한다.
// 설치 액션(TASK-007)이 이 모듈을 호출하기 전까지는 전부 미사용이다. 연결이 끝나면 이 줄을 지운다.
#![allow(dead_code)]

use std::path::{Path, PathBuf};

use crate::infrastructure::managed_script::{ManagedScript, ManagedScriptError, PlatformScript};

/// 확장자를 뺀 조건 스크립트 파일 이름. 구현을 가리지 않고 이 자산을 식별해야 하는 곳이 쓴다.
pub const CONDITION_SCRIPT_STEM: &str = "wf-eligible";
const CONDITION_SCRIPT_LABEL: &str = "조건 스크립트";
const VERSION_PREFIX: &str = "# condition_script_version:";
const CONDITION_SCRIPT_VERSION: u32 = 6;

/// 설치할 조건 스크립트의 `sh` 구현. `#!/bin/sh` 다음 두 줄이 앱 관리 표기다.
///
/// 이 본문이 `sh` 판정의 단일 원본이다. TASK-075가 저장소 사본을 지운 뒤로 맞춰야 할 두 번째
/// 파일이 없다. 판정 규칙을 고치면 PowerShell 본문과 `role_eligibility.rs`의 이식본까지 셋을
/// 함께 고쳐야 한다.
const CONDITION_SCRIPT_SH: &str = r#"#!/bin/sh
# managed_by: workflow-labs
# condition_script_version: 6
# LLM Workflow 하트비트 조건 검사. 역할별 처리 가능한 대상이 있으면 0, 없으면 1을 반환한다.
# 판정 사유는 표준 출력 첫 줄에 ASCII 코드 한 줄로 나간다.
# 사용법: sh .workflow/rules/wf-eligible.sh planner|architect|developer  (프로젝트 루트에서 실행)
set -u

role="${1:-}"
leases=".workflow/.runtime/leases"

# 판정 사유를 표준 출력 첫 줄에 내고 종료한다. 하트비트가 그 줄을 state.json의
# last_condition_output으로 옮기고, 앱이 코드를 사용자 문장으로 옮긴다.
# 사유는 ASCII 코드 한 줄이다. 문장을 본문에 두면 PowerShell 본문이 같은 문장을 낼 수 없다.
# 표준 출력에 쓰는 것은 이 함수뿐이다. deps_of의 목록 출력은 언제나 명령 치환이 받아 가므로
# 이 줄과 섞이지 않는다 — 그래서 사유가 표준 출력의 첫 줄이자 유일한 줄이 된다.
# 사유는 판정을 바꾸지 않는다. 종료 코드는 이 함수를 쓰기 전과 같다.
verdict() { # $1=사유 코드 $2=종료 코드
  printf '%s\n' "$1"
  exit "$2"
}

[ -f ".workflow/.runtime/migration.lock" ] && verdict migration-lock 1

# 유효한(미만료) lease가 있으면 0. 파일이 없거나 시각을 읽을 수 없으면 1.
# 자리수가 고정된 UTC 표기는 사전순 비교가 곧 시각 비교다. POSIX sh에는 이식 가능한 날짜 파싱이 없다.
# 읽을 수 없는 표기를 선점으로 세지 않는다. 선점 헬퍼(wf-claim.sh)는 같은 상황을 반대로 다루는데,
# 헬퍼가 지는 위험은 살아 있는 남의 lease를 인수하는 것이고 이 판정이 지는 위험은 대상이 영원히
# 열리지 않는 것이다. 실제 선점은 배타적 생성이 막으므로 이 판정이 관대해도 중복 선점이 되지 않는다.
# 판정은 lease 파일을 읽기만 한다. 지우거나 고치거나 새로 만들지 않는다.
lease_blocks() { # $1=대상 id
  lease="$leases/$1.yml"
  [ -f "$lease" ] || return 1
  exp=$(sed -n 's/^expires_at: *//p' "$lease" | head -1 | tr -d '"'\''')
  case "$exp" in
    ????-??-??T??:??:??Z) [ "$exp" '>' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" ] ;;
    *) return 1 ;;
  esac
}

# 프론트매터의 한 줄 선언을 읽어 표준 출력에 공백으로 구분한 id 목록을 낸다.
# 반환값 1은 "키는 있는데 계약 형식이 아니다"이고, 그 작업은 미충족이다.
deps_of() { # $1=작업 파일
  count=$(grep -c '^depends_on:' "$1" 2>/dev/null || true)
  case "$count" in '' | *[!0-9]*) count=0 ;; esac
  [ "$count" -eq 0 ] && return 0
  [ "$count" -gt 1 ] && return 1
  value=$(sed -n 's/^depends_on:[[:space:]]*//p' "$1" | head -1 | sed 's/[[:space:]]*$//')
  [ -n "$value" ] || return 1
  case "$value" in '['*']') ;; *) return 1 ;; esac
  inner=${value#?}
  inner=${inner%?}
  case "$inner" in *[![:space:],]*) ;; *) return 0 ;; esac
  out=""
  rest="$inner,"
  while [ -n "$rest" ]; do
    token=$(printf '%s' "${rest%%,*}" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    rest=${rest#*,}
    [ -n "$token" ] || return 1
    case "$token" in *[!A-Za-z0-9_-]*) return 1 ;; esac
    out="$out $token"
  done
  printf '%s\n' "${out# }"
}

# 선행 작업 문서를 문서 id로 찾는다. 없으면 미충족이다.
task_file() { # $1=워크플로우 경로 $2=문서 id
  grep -ls "^id: *$2\$" "$1"tasks/*.md 2>/dev/null | head -1
}

# 선행 작업이 충족 상태인가. qa_waiting과 completed만 충족이다.
dep_satisfied() { # $1=선행 작업 파일
  grep -qs "^status: qa_waiting" "$1" || grep -qs "^status: completed" "$1"
}

# $2에서 선언을 따라가 $3에 닿는가. 방문 집합이 종료를 보장한다.
reaches() { # $1=워크플로우 경로 $2=출발 id $3=목표 id
  visited=" "
  frontier="$2"
  while [ -n "$frontier" ]; do
    next=""
    for node in $frontier; do
      case "$visited" in *" $node "*) continue ;; esac
      visited="$visited$node "
      [ "$node" = "$3" ] && return 0
      nf=$(task_file "$1" "$node")
      [ -n "$nf" ] || continue
      next="$next $(deps_of "$nf" || true)"
    done
    frontier="$next"
  done
  return 1
}

case "$role" in
planner)
  for wf in .workflow/*/; do
    # (가) 미처리 아이디어. 어떤 기획서도 참조하지 않고 선점되지 않은 것.
    if [ -d "${wf}ideas" ]; then
      for f in "${wf}"ideas/*.md; do
        [ -f "$f" ] || continue
        id=$(sed -n 's/^id: *//p' "$f" | head -1)
        [ -n "$id" ] || continue
        grep -qs "source_idea_id: *$id" "${wf}"specs/*.md 2>/dev/null && continue
        lease_blocks "$id" && continue
        verdict eligible 0
      done
    fi
    # (나) 후속 기획서가 없는 수정 요청 결정. 아이디어가 없어도 이 루프는 돈다.
    [ -d "${wf}decisions" ] || continue
    for d in "${wf}"decisions/*.md; do
      [ -f "$d" ] || continue
      # 스키마와 spec_id가 QA 결정을 걸러낸다. QA 결정도 revision_requested를 쓰지만
      # task_id를 갖고 spec_id가 없다. 이 두 줄이 없으면 작업 QA 반려가 기획자 잡을 깨운다.
      grep -qs "^schema: workflow-labs/decision@1" "$d" || continue
      sid=$(sed -n 's/^spec_id: *//p' "$d" | head -1)
      [ -n "$sid" ] || continue
      grep -qs "^outcome: revision_requested" "$d" || continue
      did=$(sed -n 's/^id: *//p' "$d" | head -1)
      [ -n "$did" ] || continue
      # 같은 기획서의 더 늦은 결정이 있으면 이 결정은 최신이 아니다. 동률은 최신으로 본다.
      at=$(sed -n 's/^created_at: *//p' "$d" | head -1)
      newer=0
      for o in "${wf}"decisions/*.md; do
        [ -f "$o" ] || continue
        [ "$o" = "$d" ] && continue
        grep -qs "^schema: workflow-labs/decision@1" "$o" || continue
        osid=$(sed -n 's/^spec_id: *//p' "$o" | head -1)
        [ "$osid" = "$sid" ] || continue
        oat=$(sed -n 's/^created_at: *//p' "$o" | head -1)
        if [ "$oat" '>' "$at" ]; then newer=1; break; fi
      done
      [ "$newer" -eq 1 ] && continue
      # 판정 키는 결정 id다. 기획서 id로 보면 한 기획서가 여러 번 반려됐을 때 구분되지 않는다.
      grep -qs "source_decision_id: *$did" "${wf}"specs/*.md 2>/dev/null && continue
      lease_blocks "$did" && continue
      verdict eligible 0
    done
  done
  ;;
architect)
  for wf in .workflow/*/; do
    [ -d "${wf}decisions" ] || continue
    for d in "${wf}"decisions/*.md; do
      [ -f "$d" ] || continue
      grep -qs "^outcome: approved" "$d" || continue
      # 앱은 `created_by`가 `user`인 결정만 센다. 값 전체를 비교한다 — 접두 일치로 두면
      # 위임 대리 결정의 `user-delegate`가 걸러지지 않는다.
      cb=$(sed -n 's/^created_by: *//p' "$d" | head -1)
      [ "$cb" = "user" ] || continue
      did=$(sed -n 's/^id: *//p' "$d" | head -1)
      [ -n "$did" ] || continue
      spec=$(sed -n 's/^spec_id: *//p' "$d" | head -1)
      # 같은 기획서의 더 늦은 결정이 있으면 이 결정은 최신이 아니다. 동률은 최신으로 본다.
      # 기획자 분기와 같은 어법이다. 비교 대상도 `created_by`로 거른다 — 앱이 세지 않는 결정을
      # 여기서만 더 늦은 것으로 세면 두 판정이 갈라진다.
      at=$(sed -n 's/^created_at: *//p' "$d" | head -1)
      newer=0
      for o in "${wf}"decisions/*.md; do
        [ -f "$o" ] || continue
        [ "$o" = "$d" ] && continue
        grep -qs "^schema: workflow-labs/decision@1" "$o" || continue
        ocb=$(sed -n 's/^created_by: *//p' "$o" | head -1)
        [ "$ocb" = "user" ] || continue
        osid=$(sed -n 's/^spec_id: *//p' "$o" | head -1)
        [ "$osid" = "$spec" ] || continue
        oat=$(sed -n 's/^created_at: *//p' "$o" | head -1)
        if [ "$oat" '>' "$at" ]; then newer=1; break; fi
      done
      [ "$newer" -eq 1 ] && continue
      grep -qs "source_decision_id: *$did" "${wf}"tasks/*.md 2>/dev/null && continue
      if [ -n "$spec" ] && lease_blocks "$spec"; then continue; fi
      verdict eligible 0
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
      lease_blocks "$tid" && continue
      deps=$(deps_of "$f") || continue
      ok=1
      for dep in $deps; do
        df=$(task_file "$wf" "$dep")
        [ -n "$df" ] || { ok=0; break; }
        reaches "$wf" "$dep" "$tid" && { ok=0; break; }
        dep_satisfied "$df" || { ok=0; break; }
      done
      [ "$ok" -eq 1 ] && verdict eligible 0
    done
  done
  ;;
*)
  # 사용법 문구는 사람이 읽는 자리인 표준 오류에 그대로 둔다. 사유 코드는 데몬이 옮기는
  # 표준 출력으로 따로 나간다. 두 자리가 서로를 대신하지 않는다.
  echo "usage: wf-eligible.sh planner|architect|developer" >&2
  verdict usage 2
  ;;
esac
verdict no-target 1
"#;

/// 설치할 조건 스크립트의 PowerShell 구현.
///
/// `sh` 구현과 같은 인터페이스(인자 하나, 종료 코드 `0`·`1`·`2`, 마이그레이션 락 존중)를 갖고 같은
/// 판정을 낸다. `sh` 구현의 성질 다섯 — 파일 아무 곳이나 보는 검사, 참조의 부분 일치, `id:` 줄이 없는
/// 문서 건너뛰기, 등록 여부를 보지 않는 워크플로우 순회, 자리수만 보고 사전순으로 비교하는 lease 만료
/// 판정 — 도 그대로 옮긴다. 고치면 두 플랫폼의 판정이 갈라지고 `role_eligibility.rs`가 적어 둔 알려진
/// 차이가 플랫폼마다 달라진다.
///
/// 본문은 ASCII만 쓴다. 설치 경로가 BOM 없는 UTF-8로 쓰는데 Windows PowerShell 5.1은 그런 `.ps1`을
/// 시스템 코드페이지로 읽어, 비ASCII 문자가 들어가면 본문이 깨지고 문자열 리터럴 안이었다면 판정까지
/// 바뀐다. `sh` 본문은 한국어 주석을 그대로 갖는다 — 두 본문이 주석까지 같을 필요는 없다.
const CONDITION_SCRIPT_PS1: &str = r#"# LLM Workflow heartbeat condition check.
# managed_by: workflow-labs
# condition_script_version: 6
# Exits 0 when the role has work, 1 when it does not, 2 for an unknown role.
# The verdict reason goes to the first stdout line as a single ASCII code.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File .workflow/rules/wf-eligible.ps1 <role>
# Run from the project root. This is the Windows twin of wf-eligible.sh and must reach the same
# verdict for every input. ASCII only: the installer writes UTF-8 without a BOM.
param([string]$Role = '')

$ErrorActionPreference = 'Stop'

$leases = '.workflow/.runtime/leases'
$lineCache = @{}

# Reads a file as lines. An unreadable file reads as empty, which is what "grep -s" does.
function Get-Lines([string]$Path) {
  if ($lineCache.ContainsKey($Path)) { return $lineCache[$Path] }
  $lines = @()
  try { $lines = @(Get-Content -LiteralPath $Path -ErrorAction Stop) } catch { $lines = @() }
  $lineCache[$Path] = $lines
  return $lines
}

# Mirrors "grep -qs". The pattern may match anywhere in the file, not only the front matter.
# Every comparison here is case sensitive: PowerShell defaults to case insensitive and grep
# does not, so the unprefixed operators would make the two implementations disagree.
function Test-Match([string[]]$Lines, [string]$Pattern) {
  foreach ($line in $Lines) {
    if ($line -cmatch $Pattern) { return $true }
  }
  return $false
}

# Mirrors "sed -n 's/^<key>: *//p' | head -1".
function Get-Value([string[]]$Lines, [string]$Key) {
  foreach ($line in $Lines) {
    if ($line.StartsWith($Key + ':', [System.StringComparison]::Ordinal)) {
      return ($line -creplace ('^' + $Key + ': *'), '')
    }
  }
  return ''
}

# Mirrors the "for wf in .workflow/*/" glob, which skips names beginning with a dot.
function Get-WorkflowRoots() {
  if (-not (Test-Path -LiteralPath '.workflow' -PathType Container)) { return @() }
  return @(Get-ChildItem -LiteralPath '.workflow' -Directory -ErrorAction SilentlyContinue |
    Where-Object { -not $_.Name.StartsWith('.', [System.StringComparison]::Ordinal) } |
    Sort-Object -Property Name -CaseSensitive |
    ForEach-Object { $_.FullName })
}

function Get-Documents([string]$Root, [string]$Kind) {
  $directory = Join-Path $Root $Kind
  if (-not (Test-Path -LiteralPath $directory -PathType Container)) { return @() }
  return @(Get-ChildItem -LiteralPath $directory -Filter '*.md' -File -ErrorAction SilentlyContinue |
    Sort-Object -Property Name -CaseSensitive |
    ForEach-Object { $_.FullName })
}

# A lease blocks its target only while it is unexpired. A missing file, an absent expires_at, or a
# stamp outside the fixed-width UTC form does not block: the risk this verdict runs is a target that
# never reopens, not a double claim, which exclusive creation prevents. The shape test mirrors the
# shell "case" glob, which counts characters and not digits, so both implementations accept and
# reject the same stamps. Fixed-width UTC compares lexicographically, so ordinal comparison is the
# time comparison. This reads the lease file and never writes it.
function Test-Leased([string]$Id) {
  $path = Join-Path $leases ($Id + '.yml')
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return $false }
  $stamp = Get-Value (Get-Lines $path) 'expires_at'
  $stamp = $stamp.Replace([string][char]34, '').Replace([string][char]39, '')
  if ($stamp -cnotmatch '^.{4}-.{2}-.{2}T.{2}:.{2}:.{2}Z$') { return $false }
  $now = [System.DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ',
    [System.Globalization.CultureInfo]::InvariantCulture)
  return ([string]::CompareOrdinal($stamp, $now) -gt 0)
}

# Reads the one-line declaration. Ok=$false means the key is present but not in contract form,
# and that task is unsatisfied. An absent key yields an empty list.
function Get-Declaration([string[]]$Lines) {
  $found = @()
  foreach ($line in $Lines) {
    if ($line.StartsWith('depends_on:', [System.StringComparison]::Ordinal)) { $found += $line }
  }
  if ($found.Count -eq 0) { return @{ Ok = $true; Ids = @() } }
  if ($found.Count -gt 1) { return @{ Ok = $false; Ids = @() } }
  $value = ($found[0].Substring('depends_on:'.Length)).Trim()
  if ($value.Length -lt 2) { return @{ Ok = $false; Ids = @() } }
  if (-not $value.StartsWith('[', [System.StringComparison]::Ordinal)) { return @{ Ok = $false; Ids = @() } }
  if (-not $value.EndsWith(']', [System.StringComparison]::Ordinal)) { return @{ Ok = $false; Ids = @() } }
  $inner = $value.Substring(1, $value.Length - 2)
  $tokens = @($inner -split ',' | ForEach-Object { $_.Trim() })
  $named = @($tokens | Where-Object { $_.Length -gt 0 })
  if ($named.Count -eq 0) { return @{ Ok = $true; Ids = @() } }
  foreach ($token in $tokens) {
    if ($token -cnotmatch '^[A-Za-z0-9_-]+$') { return @{ Ok = $false; Ids = @() } }
  }
  return @{ Ok = $true; Ids = $tokens }
}

# Mirrors "grep -ls '^id: *<id>$' <workflow>/tasks/*.md | head -1".
function Find-TaskFile([string]$Root, [string]$Id) {
  $pattern = '^id: *' + [regex]::Escape($Id) + '$'
  foreach ($path in (Get-Documents $Root 'tasks')) {
    if (Test-Match (Get-Lines $path) $pattern) { return $path }
  }
  return ''
}

# Only qa_waiting and completed count as satisfied. Any other state, including one outside the
# contract, is unsatisfied.
function Test-DependencySatisfied([string]$Path) {
  $lines = Get-Lines $Path
  if (Test-Match $lines '^status: qa_waiting') { return $true }
  return (Test-Match $lines '^status: completed')
}

# Does the declaration graph lead from $From back to $Target? The visited set guarantees
# termination, so a cycle cannot spin forever. A malformed declaration has no outgoing edges.
# The visited set is ordinal so that two ids differing only in case stay distinct, the way the
# shell implementation treats them.
function Test-Reaches([string]$Root, [string]$From, [string]$Target) {
  $visited = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
  $frontier = @($From)
  while ($frontier.Count -gt 0) {
    $next = @()
    foreach ($node in $frontier) {
      if (-not $visited.Add($node)) { continue }
      if ($node -ceq $Target) { return $true }
      $file = Find-TaskFile $Root $node
      if ($file.Length -eq 0) { continue }
      $declaration = Get-Declaration (Get-Lines $file)
      if ($declaration.Ok) { $next += $declaration.Ids }
    }
    $frontier = @($next)
  }
  return $false
}

# Writes the verdict reason as the first stdout line and exits. The heartbeat daemon copies that
# line into state.json as last_condition_output, and the app turns the code into a sentence.
# ASCII codes only: a sentence here could not match the one the sh body would have to print.
# This function is the only writer to stdout, so the reason is the first and only line.
# The reason does not change the verdict. Exit codes are what they were before it existed.
function Write-Verdict([string]$Code, [int]$ExitCode) {
  [Console]::Out.WriteLine($Code)
  exit $ExitCode
}

if (Test-Path -LiteralPath '.workflow/.runtime/migration.lock' -PathType Leaf) {
  Write-Verdict 'migration-lock' 1
}

switch -CaseSensitive ($Role) {
  'planner' {
    foreach ($root in (Get-WorkflowRoots)) {
      # (a) An unprocessed idea: referenced by no spec and not claimed.
      foreach ($path in (Get-Documents $root 'ideas')) {
        $id = Get-Value (Get-Lines $path) 'id'
        if ($id.Length -eq 0) { continue }
        $adopted = $false
        foreach ($spec in (Get-Documents $root 'specs')) {
          if (Test-Match (Get-Lines $spec) ('source_idea_id: *' + $id)) { $adopted = $true; break }
        }
        if ($adopted) { continue }
        if (Test-Leased $id) { continue }
        Write-Verdict 'eligible' 0
      }
      # (b) A revision request with no follow-up spec. This runs even with no ideas directory.
      foreach ($path in (Get-Documents $root 'decisions')) {
        $lines = Get-Lines $path
        # The schema and spec_id lines screen out QA decisions, which also use
        # revision_requested but carry task_id and no spec_id.
        if (-not (Test-Match $lines '^schema: workflow-labs/decision@1')) { continue }
        $sid = Get-Value $lines 'spec_id'
        if ($sid.Length -eq 0) { continue }
        if (-not (Test-Match $lines '^outcome: revision_requested')) { continue }
        $did = Get-Value $lines 'id'
        if ($did.Length -eq 0) { continue }
        # A later decision on the same spec supersedes this one. A tie stays latest.
        $at = Get-Value $lines 'created_at'
        $superseded = $false
        foreach ($other in (Get-Documents $root 'decisions')) {
          if ($other -ceq $path) { continue }
          $otherLines = Get-Lines $other
          if (-not (Test-Match $otherLines '^schema: workflow-labs/decision@1')) { continue }
          if ((Get-Value $otherLines 'spec_id') -cne $sid) { continue }
          # Ordinal like the shell's string comparison. A culture-aware compare can treat
          # characters such as the hyphen as ignorable and reorder timestamps.
          if ([string]::CompareOrdinal((Get-Value $otherLines 'created_at'), $at) -gt 0) {
            $superseded = $true
            break
          }
        }
        if ($superseded) { continue }
        # The decision id is the key, not the spec id: one spec can be sent back more than once.
        $answered = $false
        foreach ($spec in (Get-Documents $root 'specs')) {
          if (Test-Match (Get-Lines $spec) ('source_decision_id: *' + $did)) { $answered = $true; break }
        }
        if ($answered) { continue }
        if (Test-Leased $did) { continue }
        Write-Verdict 'eligible' 0
      }
    }
  }
  'architect' {
    foreach ($root in (Get-WorkflowRoots)) {
      $decisions = Get-Documents $root 'decisions'
      foreach ($path in $decisions) {
        $lines = Get-Lines $path
        if (-not (Test-Match $lines '^outcome: approved')) { continue }
        # The app counts only decisions whose created_by is exactly user. The whole value is
        # compared: a prefix test would let the delegate value user-delegate through.
        if ((Get-Value $lines 'created_by') -cne 'user') { continue }
        $did = Get-Value $lines 'id'
        if ($did.Length -eq 0) { continue }
        $spec = Get-Value $lines 'spec_id'
        # A later decision on the same spec supersedes this one. A tie stays latest. Same
        # wording as the planner branch. The pool is filtered by created_by too: counting a
        # decision the app never reads would split the two verdicts.
        $at = Get-Value $lines 'created_at'
        $superseded = $false
        foreach ($other in $decisions) {
          if ($other -ceq $path) { continue }
          $otherLines = Get-Lines $other
          if (-not (Test-Match $otherLines '^schema: workflow-labs/decision@1')) { continue }
          if ((Get-Value $otherLines 'created_by') -cne 'user') { continue }
          if ((Get-Value $otherLines 'spec_id') -cne $spec) { continue }
          # Ordinal like the shell's string comparison, for the reason the planner branch gives.
          if ([string]::CompareOrdinal((Get-Value $otherLines 'created_at'), $at) -gt 0) {
            $superseded = $true
            break
          }
        }
        if ($superseded) { continue }
        $decomposed = $false
        foreach ($task in (Get-Documents $root 'tasks')) {
          if (Test-Match (Get-Lines $task) ('source_decision_id: *' + $did)) { $decomposed = $true; break }
        }
        if ($decomposed) { continue }
        if ($spec.Length -gt 0 -and (Test-Leased $spec)) { continue }
        Write-Verdict 'eligible' 0
      }
    }
  }
  'developer' {
    foreach ($root in (Get-WorkflowRoots)) {
      foreach ($path in (Get-Documents $root 'tasks')) {
        $lines = Get-Lines $path
        if (-not (Test-Match $lines '^status: todo')) { continue }
        $tid = Get-Value $lines 'id'
        if ($tid.Length -eq 0) { continue }
        if (Test-Leased $tid) { continue }
        $declaration = Get-Declaration $lines
        if (-not $declaration.Ok) { continue }
        $ok = $true
        foreach ($dep in $declaration.Ids) {
          $file = Find-TaskFile $root $dep
          if ($file.Length -eq 0) { $ok = $false; break }
          if (Test-Reaches $root $dep $tid) { $ok = $false; break }
          if (-not (Test-DependencySatisfied $file)) { $ok = $false; break }
        }
        if ($ok) { Write-Verdict 'eligible' 0 }
      }
    }
  }
  default {
    # The usage text stays on stderr, where a person reads it. The reason code goes to stdout,
    # which is what the daemon carries. Neither stands in for the other.
    [Console]::Error.WriteLine('usage: wf-eligible.ps1 planner|architect|developer')
    Write-Verdict 'usage' 2
  }
}
Write-Verdict 'no-target' 1
"#;

/// 현재 플랫폼에 설치할 구현. 런타임 분기가 아니라 컴파일 시점 분기다 — 앱은 자기가 도는 플랫폼의
/// 자산만 쓴다(R2).
#[cfg(not(windows))]
const PLATFORM: PlatformScript = PlatformScript {
    extension: "sh",
    body: CONDITION_SCRIPT_SH,
};

#[cfg(windows)]
const PLATFORM: PlatformScript = PlatformScript {
    extension: "ps1",
    body: CONDITION_SCRIPT_PS1,
};

/// 조건 스크립트 자산. 설치 규약은 [`ManagedScript`]가 갖는다.
pub const CONDITION_SCRIPT: ManagedScript = ManagedScript {
    stem: CONDITION_SCRIPT_STEM,
    label: CONDITION_SCRIPT_LABEL,
    version_prefix: VERSION_PREFIX,
    version: CONDITION_SCRIPT_VERSION,
    platform: PLATFORM,
};

/// 공용 규약으로 옮기기 전의 이름. 호출처의 `#[from]` 배선을 그대로 두려고 별칭으로 잇는다.
pub type ConditionScriptError = ManagedScriptError;

/// 컨트롤 루트 기준 조건 스크립트 경로. 파일 이름은 현재 플랫폼의 구현을 따른다.
pub fn condition_script_path(control_root: &Path) -> PathBuf {
    CONDITION_SCRIPT.path(control_root)
}

/// 조건 스크립트를 앱 버전으로 설치한다. 내용이 이미 같으면 파일을 쓰지 않는다.
pub fn install_condition_script(control_root: &Path) -> Result<(), ConditionScriptError> {
    CONDITION_SCRIPT.install(control_root)
}

/// 설치와 같은 판정만 하고 파일은 쓰지 않는다.
pub fn validate_condition_script(control_root: &Path) -> Result<(), ConditionScriptError> {
    CONDITION_SCRIPT.validate(control_root)
}

/// 설치된 조건 스크립트를 실행하는 테스트 헬퍼. 이 자산을 대조하는 모듈이 둘이므로 한 곳에만 둔다 —
/// 두 곳이 서로 다른 명령으로 스크립트를 부르면 대조의 뜻이 사라진다.
///
/// TASK-044가 잡의 `condition` 문자열을 조립하는 함수를 제품 코드에 만들면, 그때 이 헬퍼가 그 함수를
/// 쓰도록 옮긴다. 지금은 테스트 안에 둔다.
#[cfg(test)]
pub(crate) mod test_support {
    use std::path::Path;
    use std::process::Command;

    use super::CONDITION_SCRIPT;

    /// 조건 스크립트 한 번 실행의 결과.
    ///
    /// 판정은 종료 코드다. `stdout`은 그 판정을 설명하는 사유이고, 하트비트 데몬이 첫 줄을
    /// `state.json`의 `last_condition_output`으로 옮긴다(SPEC-023 R4).
    pub(crate) struct ConditionRun {
        pub(crate) code: i32,
        pub(crate) stdout: String,
    }

    impl ConditionRun {
        /// 데몬이 실어 나르는 값. 표준 출력 첫 줄이고, 아무것도 나오지 않았으면 빈 문자열이다.
        pub(crate) fn reason(&self) -> &str {
            self.stdout.lines().next().unwrap_or_default()
        }
    }

    /// 설치된 조건 스크립트를 그 플랫폼의 방식으로 실행하고 종료 코드와 표준 출력을 돌려준다.
    ///
    /// 상대 경로는 자산 서술에서 받는다. 파일 이름을 여기 다시 적으면 그것이 세 번째 사본이 된다.
    /// `current_dir`이 프로젝트 루트인 것은 조건이 상대 경로를 쓰기 때문이다. 플랫폼 분기는 `cfg!`로
    /// 둬서 두 갈래가 모든 러너에서 컴파일된다 — 한쪽이 컴파일되지 않는 상태가 이 작업이 막으려는 것이다.
    ///
    /// 표준 출력을 잡아 오므로 `status`가 아니라 `output`을 쓴다. 사유가 판정과 함께 와야 두 값이
    /// 어긋나는 경우를 표가 잡는다.
    pub(crate) fn run_condition(project_root: &Path, role: &str) -> ConditionRun {
        let script = CONDITION_SCRIPT.relative_path();
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
            .arg(role)
            .current_dir(project_root)
            .output()
            .expect("run condition script");
        ConditionRun {
            code: output.status.code().expect("exit code"),
            stdout: String::from_utf8(output.stdout).expect("condition stdout is utf-8"),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::{Path, PathBuf};

    use tempfile::{tempdir, TempDir};

    use super::test_support::run_condition;
    use super::{
        condition_script_path, install_condition_script, validate_condition_script,
        ConditionScriptError, CONDITION_SCRIPT, CONDITION_SCRIPT_PS1, CONDITION_SCRIPT_SH,
        CONDITION_SCRIPT_STEM, CONDITION_SCRIPT_VERSION, VERSION_PREFIX,
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
        assert_eq!(script, CONDITION_SCRIPT.platform.body);
        assert!(script.contains("# managed_by: workflow-labs"));
        assert!(script.contains("# condition_script_version: 6"));
        assert!(script.contains("migration.lock"));
        #[cfg(not(windows))]
        assert!(script.starts_with("#!/bin/sh\n"));
    }

    /// 버전 줄만 이전 값인 관리본도 갱신 대상이다. 상수와 본문의 버전이 어긋나면 설치본이 매번
    /// 다시 쓰이므로, 그 둘이 함께 올라갔는지를 여기서 고정한다.
    #[test]
    fn updates_a_managed_script_from_the_previous_version() {
        let (_root, control) = project();
        let path = condition_script_path(&control);
        fs::create_dir_all(path.parent().expect("rules root")).expect("rules root");
        let previous = CONDITION_SCRIPT.platform.body.replace(
            "# condition_script_version: 6",
            "# condition_script_version: 5",
        );
        assert_ne!(previous, CONDITION_SCRIPT.platform.body);
        fs::write(&path, &previous).expect("previous version script");

        install_condition_script(&control).expect("install condition script");

        assert_eq!(
            fs::read_to_string(&path).expect("script"),
            CONDITION_SCRIPT.platform.body
        );
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

        assert_eq!(
            fs::read_to_string(&path).expect("script"),
            CONDITION_SCRIPT.platform.body
        );
    }

    /// 현재 플랫폼의 구현 하나만 설치된다. 파일 이름이 그 선택을 드러낸다.
    #[test]
    fn installs_the_implementation_for_the_current_platform() {
        let (_root, control) = project();

        install_condition_script(&control).expect("install condition script");

        let installed = condition_script_path(&control);
        let expected = if cfg!(windows) {
            "wf-eligible.ps1"
        } else {
            "wf-eligible.sh"
        };
        assert_eq!(
            installed.file_name().expect("file name").to_string_lossy(),
            expected
        );
        assert!(installed.exists());
    }

    /// 다른 플랫폼용 자산이 같은 디렉터리에 있어도 설치가 그 파일을 만들거나 고치거나 지우지 않고,
    /// 그 상태가 오류나 경고가 아니다(R9). `.workflow/`를 커밋하는 저장소에서는 정상적인 상태다.
    #[test]
    fn leaves_the_other_platform_asset_untouched() {
        let (_root, control) = project();
        let rules = control.join("rules");
        fs::create_dir_all(&rules).expect("rules root");
        let other = rules.join(if cfg!(windows) {
            "wf-eligible.sh"
        } else {
            "wf-eligible.ps1"
        });
        let foreign =
            "# managed_by: workflow-labs\n# condition_script_version: 1\nother platform\n";
        fs::write(&other, foreign).expect("other platform asset");
        let before = fs::metadata(&other).expect("metadata").modified().ok();

        install_condition_script(&control).expect("install must not mind the other platform");
        validate_condition_script(&control).expect("validate must not mind the other platform");

        assert_eq!(fs::read_to_string(&other).expect("other asset"), foreign);
        assert_eq!(
            before,
            fs::metadata(&other)
                .expect("metadata again")
                .modified()
                .ok()
        );
    }

    /// 두 구현이 한 버전 상수를 공유한다. 같은 판정을 담은 두 파일이 서로 다른 버전을 갖는 상태를
    /// 만들지 않는다(R2).
    #[test]
    fn both_implementations_share_the_managed_markers_and_version() {
        let expected = format!("{VERSION_PREFIX} {CONDITION_SCRIPT_VERSION}");
        for body in [CONDITION_SCRIPT_SH, CONDITION_SCRIPT_PS1] {
            assert!(body
                .lines()
                .any(|line| line.trim() == "# managed_by: workflow-labs"));
            assert!(
                body.lines().any(|line| line.trim() == expected),
                "버전 줄이 자산 서술의 값과 다르다"
            );
        }
    }

    /// PowerShell 본문은 ASCII만 쓴다. 설치가 BOM 없는 UTF-8로 쓰는데 Windows PowerShell 5.1은
    /// 그런 `.ps1`을 시스템 코드페이지로 읽는다.
    #[test]
    fn the_powershell_implementation_is_ascii() {
        assert!(CONDITION_SCRIPT_PS1.is_ascii());
    }

    /// 스크립트가 낼 수 있는 사유 코드 전부. 앱이 이 코드를 사용자 문장으로 옮긴다(SPEC-023
    /// 확인 필요 3번). 목록을 늘리면 두 본문과 시나리오 표를 함께 고쳐야 하고, 아래 두 테스트가
    /// 그 셋 중 하나라도 빠지면 실패한다.
    ///
    /// ASCII만 쓴다. PowerShell 본문이 같은 코드를 내야 하는데 그 본문은 ASCII 제약이 있다.
    const REASON_CODES: &[&str] = &["eligible", "no-target", "migration-lock", "usage"];

    /// 판정 로직이 조건 문자열이 아니라 파일에 있다(D1). 두 본문 모두 역할 셋과 종료 코드를 갖는다.
    #[test]
    fn both_implementations_carry_the_same_interface() {
        for body in [CONDITION_SCRIPT_SH, CONDITION_SCRIPT_PS1] {
            for role in ["planner", "architect", "developer"] {
                assert!(body.contains(role), "{role} 분기가 없다");
            }
            assert!(body.contains("migration.lock"));
            assert!(body.contains("usage: wf-eligible"));
            for code in REASON_CODES {
                assert!(body.contains(code), "{code} 사유 코드가 없다");
            }
        }
    }

    /// 사유 코드는 ASCII다. `the_powershell_implementation_is_ascii`가 본문 전체를 보지만, 어휘를
    /// 정하는 자리에서도 같은 제약을 걸어 둔다 — 비ASCII 코드를 표에만 적고 본문에 못 넣는 상태로
    /// 시간을 쓰지 않기 위해서다.
    #[test]
    fn the_reason_codes_are_ascii_and_fit_the_one_line_contract() {
        for code in REASON_CODES {
            assert!(code.is_ascii(), "{code}가 ASCII가 아니다");
            assert!(!code.is_empty());
            assert!(code.len() <= 200, "{code}가 200자 계약을 넘는다");
            assert!(!code.contains(['\n', '\r']), "{code}가 한 줄 계약을 깬다");
        }
    }

    /// 시나리오 표가 어휘 밖의 사유를 기대하지 않는다. 표에만 있는 코드는 앱이 모르는 코드가 되고,
    /// 그때 화면은 받은 문자열을 그대로 보여주는 폴백으로 떨어진다.
    #[test]
    fn the_scenario_table_only_expects_known_reason_codes() {
        for scenario in SCENARIOS {
            assert!(
                REASON_CODES.contains(&scenario.reason),
                "{}: 어휘에 없는 사유 {}",
                scenario.name,
                scenario.reason
            );
        }
    }

    /// 버전 축의 분리는 자산 서술의 접두사가 만든다. 선점 헬퍼가 같은 규약으로 옮겨 오면
    /// (TASK-047) 그 자산이 다른 접두사를 갖는지도 같은 자리에서 본다.
    #[test]
    fn the_asset_description_carries_its_own_version_axis() {
        assert_eq!(CONDITION_SCRIPT.version_prefix, VERSION_PREFIX);
        assert_eq!(CONDITION_SCRIPT.version, CONDITION_SCRIPT_VERSION);
        assert_eq!(CONDITION_SCRIPT.stem, CONDITION_SCRIPT_STEM);
        assert_eq!(CONDITION_SCRIPT.relative_path(), {
            let name = if cfg!(windows) {
                "wf-eligible.ps1"
            } else {
                "wf-eligible.sh"
            };
            format!(".workflow/rules/{name}")
        });
    }

    /// 사용자에게 보이는 문구가 공용 규약으로 옮기면서 바뀌면 안 된다.
    #[test]
    fn the_error_messages_are_unchanged() {
        let (_root, control) = project();
        let path = condition_script_path(&control);
        fs::create_dir_all(path.parent().expect("rules root")).expect("rules root");

        fs::write(&path, "unmanaged\n").expect("unmanaged script");
        let unmanaged = install_condition_script(&control).expect_err("unmanaged");
        assert_eq!(
            unmanaged.to_string(),
            format!(
                "{}에 앱이 관리하지 않는 파일이 있어 덮어쓰지 않았습니다. 그 파일을 옮기거나 지운 뒤 다시 시도하세요.",
                path.display()
            )
        );

        fs::write(
            &path,
            "# managed_by: workflow-labs\n# condition_script_version: 999\n",
        )
        .expect("future script");
        let downgrade = install_condition_script(&control).expect_err("downgrade");
        assert_eq!(
            downgrade.to_string(),
            format!(
                "{}의 조건 스크립트 버전 999이 앱이 아는 버전 6보다 높아 덮어쓰지 않았습니다. 앱을 최신 버전으로 올린 뒤 다시 시도하세요.",
                path.display()
            )
        );
    }

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

        assert_eq!(run_condition(root.path(), "developer").code, 0);
    }

    /// SPEC-023 완료 조건 6·8. 한 픽스처에서 인자만 바꿔 네 경로를 본다 — 사유가 저장소 상태가
    /// 아니라 그 역할의 판정을 설명한다는 것이 여기서 보인다. 시나리오 표는 반대로 픽스처를 바꿔
    /// 가며 같은 계약을 넓게 덮는다.
    ///
    /// 종료 코드와 첫 줄을 한 자리에서 함께 단언한다. 둘이 어긋나면(예: 사유는 `no-target`인데
    /// 종료 코드가 0) 화면이 실제와 다른 말을 하게 된다.
    #[test]
    fn the_installed_script_explains_every_verdict_in_one_line() {
        let (root, control) = project();
        install_condition_script(&control).expect("install condition script");
        // 개발자만 깨우는 저장소. 아이디어도 결정도 없으므로 나머지 둘은 대상이 없다.
        let tasks = control.join("wf-demo/tasks");
        fs::create_dir_all(&tasks).expect("tasks root");
        fs::write(
            tasks.join("TASK-001.md"),
            "---\nschema: workflow-labs/task@1\nid: TASK-001\nstatus: todo\n---\n",
        )
        .expect("todo task");

        for (role, code, reason) in [
            ("developer", 0, "eligible"),
            ("planner", 1, "no-target"),
            ("architect", 1, "no-target"),
            ("reviewer", 2, "usage"),
        ] {
            let run = run_condition(root.path(), role);

            assert_eq!(run.code, code, "{role}: 종료 코드");
            assert_eq!(run.reason(), reason, "{role}: 사유");
            assert_eq!(
                run.stdout.lines().count(),
                1,
                "{role}: 사유는 한 줄이어야 한다: {:?}",
                run.stdout
            );
            assert!(run.reason().len() <= 200, "{role}: 사유가 200자를 넘는다");
        }
    }

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

        assert_eq!(run_condition(root.path(), "developer").code, 1);
        assert_eq!(run_condition(root.path(), "planner").code, 1);
        assert_eq!(run_condition(root.path(), "architect").code, 1);
    }

    #[test]
    fn installed_script_rejects_an_unknown_role() {
        let (root, control) = project();
        install_condition_script(&control).expect("install condition script");

        assert_eq!(run_condition(root.path(), "reviewer").code, 2);
    }

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

        assert_eq!(run_condition(root.path(), "developer").code, 1);
    }

    /// 픽스처 작업 하나. `declaration`은 프론트매터에 그대로 들어갈 한 줄이다.
    fn write_task(tasks_root: &Path, id: &str, status: &str, declaration: Option<&str>) {
        let line = declaration
            .map(|value| format!("{value}\n"))
            .unwrap_or_default();
        fs::write(
            tasks_root.join(format!("{id}.md")),
            format!("---\nschema: workflow-labs/task@1\nid: {id}\nstatus: {status}\n{line}---\n"),
        )
        .expect("write task");
    }

    /// 스크립트는 만료 전인 lease만 선점으로 센다. 시각은 자리수가 고정된 UTC 표기여야 한다 —
    /// 다른 표기는 읽히지 않아 선점으로 세어지지 않는다.
    fn write_lease(control_root: &Path, target_id: &str) {
        let leases = control_root.join(".runtime/leases");
        fs::create_dir_all(&leases).expect("leases root");
        let expires_at = (chrono::Utc::now() + chrono::Duration::minutes(30))
            .format("%Y-%m-%dT%H:%M:%SZ")
            .to_string();
        fs::write(
            leases.join(format!("{target_id}.yml")),
            format!("schema_version: 1\nlease_id: lease-{target_id}\nagent: agent\ntask_id: {target_id}\nheartbeat_at: {expires_at}\nexpires_at: {expires_at}\n"),
        )
        .expect("write lease");
    }

    /// 작업 목록과 lease만 다른 픽스처에서 `developer` 종료 코드를 본다.
    fn developer_exit_code(tasks: &[(&str, &str, Option<&str>)], leased: &[&str]) -> i32 {
        let (root, control) = project();
        install_condition_script(&control).expect("install condition script");
        let tasks_root = control.join("wf-demo/tasks");
        fs::create_dir_all(&tasks_root).expect("tasks root");
        for (id, status, declaration) in tasks {
            write_task(&tasks_root, id, status, *declaration);
        }
        for target in leased {
            write_lease(&control, target);
        }
        run_condition(root.path(), "developer").code
    }

    #[test]
    fn a_task_without_a_declaration_stays_eligible() {
        assert_eq!(developer_exit_code(&[("TASK-001", "todo", None)], &[]), 0);
    }

    #[test]
    fn a_finished_dependency_satisfies_the_declaration() {
        for status in ["qa_waiting", "completed"] {
            assert_eq!(
                developer_exit_code(
                    &[
                        ("TASK-001", "todo", Some("depends_on: [TASK-002]")),
                        ("TASK-002", status, None),
                    ],
                    &["TASK-002"],
                ),
                0,
                "{status}인 선행은 충족이다"
            );
        }
    }

    /// 선행 자신이 후보가 되지 않도록 lease로 제외한 뒤, 후행만 남았을 때의 판정을 본다.
    #[test]
    fn an_unfinished_dependency_blocks_the_task() {
        for status in ["todo", "in_progress", "blocked", "archived"] {
            assert_eq!(
                developer_exit_code(
                    &[
                        ("TASK-001", "todo", Some("depends_on: [TASK-002]")),
                        ("TASK-002", status, None),
                    ],
                    &["TASK-002"],
                ),
                1,
                "{status}인 선행은 미충족이다"
            );
        }
    }

    #[test]
    fn a_partially_satisfied_declaration_blocks_the_task() {
        assert_eq!(
            developer_exit_code(
                &[
                    ("TASK-001", "todo", Some("depends_on: [TASK-002, TASK-003]")),
                    ("TASK-002", "completed", None),
                    ("TASK-003", "todo", None),
                ],
                &["TASK-003"],
            ),
            1
        );
    }

    #[test]
    fn a_missing_dependency_id_blocks_the_task() {
        assert_eq!(
            developer_exit_code(&[("TASK-001", "todo", Some("depends_on: [TASK-999]"))], &[]),
            1
        );
    }

    #[test]
    fn a_self_reference_blocks_the_task() {
        assert_eq!(
            developer_exit_code(&[("TASK-001", "todo", Some("depends_on: [TASK-001]"))], &[]),
            1
        );
    }

    #[test]
    fn mutually_declared_tasks_block_each_other() {
        assert_eq!(
            developer_exit_code(
                &[
                    ("TASK-001", "todo", Some("depends_on: [TASK-002]")),
                    ("TASK-002", "todo", Some("depends_on: [TASK-001]")),
                ],
                &[],
            ),
            1
        );
    }

    /// 순환이 상태 판정보다 앞선다. 상태를 먼저 보면 여기서 갈라진다.
    #[test]
    fn a_cycle_outranks_the_dependency_status() {
        assert_eq!(
            developer_exit_code(
                &[
                    ("TASK-001", "todo", Some("depends_on: [TASK-002]")),
                    ("TASK-002", "completed", Some("depends_on: [TASK-001]")),
                ],
                &[],
            ),
            1
        );
    }

    #[test]
    fn a_malformed_declaration_blocks_the_task() {
        for declaration in [
            "depends_on:",
            "depends_on:   ",
            "depends_on: [TASK-002",
            "depends_on: [\"TASK-002\"]",
            "depends_on: [TASK-002,]",
        ] {
            assert_eq!(
                developer_exit_code(
                    &[
                        ("TASK-001", "todo", Some(declaration)),
                        ("TASK-002", "completed", None),
                    ],
                    &[],
                ),
                1,
                "{declaration}는 형식 오류다"
            );
        }
    }

    #[test]
    fn an_empty_list_declaration_is_the_same_as_no_declaration() {
        assert_eq!(
            developer_exit_code(&[("TASK-001", "todo", Some("depends_on: []"))], &[]),
            0
        );
    }

    #[test]
    fn a_lease_excludes_a_task_whose_dependencies_are_satisfied() {
        assert_eq!(
            developer_exit_code(
                &[
                    ("TASK-001", "todo", Some("depends_on: [TASK-002]")),
                    ("TASK-002", "completed", None),
                ],
                &["TASK-001"],
            ),
            1
        );
    }

    /// 하나라도 자격이 있으면 자격 있음이다.
    #[test]
    fn one_eligible_task_is_enough() {
        assert_eq!(
            developer_exit_code(
                &[
                    ("TASK-001", "todo", Some("depends_on: [TASK-999]")),
                    ("TASK-002", "todo", None),
                ],
                &[],
            ),
            0
        );
    }

    /// 형식 오류는 그 문서를 미충족으로 만들 뿐, 그 문서에 기대는 문서의 판정을 바꾸지 않는다.
    #[test]
    fn a_malformed_declaration_does_not_spread_to_its_dependents() {
        assert_eq!(
            developer_exit_code(
                &[
                    ("TASK-001", "todo", Some("depends_on: [TASK-002]")),
                    ("TASK-002", "completed", Some("depends_on: [oops!]")),
                ],
                &[],
            ),
            0
        );
    }

    /// 판정 범위는 워크플로우 안이다. 다른 워크플로우의 같은 id는 선행으로 인정되지 않는다.
    #[test]
    fn a_dependency_in_another_workflow_is_never_satisfied() {
        let (root, control) = project();
        install_condition_script(&control).expect("install condition script");
        let first = control.join("wf-first/tasks");
        let second = control.join("wf-second/tasks");
        fs::create_dir_all(&first).expect("first tasks root");
        fs::create_dir_all(&second).expect("second tasks root");
        write_task(&first, "TASK-001", "todo", Some("depends_on: [TASK-002]"));
        write_task(&second, "TASK-002", "completed", None);

        assert_eq!(run_condition(root.path(), "developer").code, 1);
    }

    /// 선언은 `developer` 분기만 본다. 같은 문서를 두고 다른 두 역할의 판정은 그대로다.
    #[test]
    fn a_declaration_does_not_change_the_other_roles() {
        let (root, control) = project();
        install_condition_script(&control).expect("install condition script");
        let workflow = control.join("wf-demo");
        fs::create_dir_all(workflow.join("tasks")).expect("tasks root");
        fs::create_dir_all(workflow.join("ideas")).expect("ideas root");
        fs::create_dir_all(workflow.join("decisions")).expect("decisions root");
        fs::write(
            workflow.join("ideas/IDEA-001.md"),
            "---\nschema: workflow-labs/idea@1\nid: IDEA-001\n---\n",
        )
        .expect("idea without a spec");
        fs::write(
            workflow.join("decisions/DECISION-001.md"),
            "---\nid: DECISION-001\nspec_id: SPEC-001\noutcome: approved\ncreated_by: user\n---\n",
        )
        .expect("approved decision");
        fs::write(
            workflow.join("tasks/TASK-001.md"),
            "---\nschema: workflow-labs/task@1\nid: TASK-001\nstatus: todo\nsource_decision_id: DECISION-001\ndepends_on: [TASK-999]\n---\n",
        )
        .expect("task with a declaration");

        assert_eq!(run_condition(root.path(), "developer").code, 1);
        assert_eq!(run_condition(root.path(), "planner").code, 0);
        assert_eq!(run_condition(root.path(), "architect").code, 1);
    }

    /// 결정 문서 하나만 둔 픽스처에서 `planner` 종료 코드를 본다. `decisions/`만 만들어 아이디어
    /// 루프가 없는 워크플로우에서도 결정 루프가 도는지 함께 고정한다.
    fn planner_exit_code(
        decisions: &[(&str, &str)],
        specs: &[(&str, &str)],
        leased: &[&str],
    ) -> i32 {
        let (root, control) = project();
        install_condition_script(&control).expect("install condition script");
        let workflow = control.join("wf-demo");
        fs::create_dir_all(workflow.join("decisions")).expect("decisions root");
        fs::create_dir_all(workflow.join("specs")).expect("specs root");
        for (id, body) in decisions {
            fs::write(workflow.join(format!("decisions/{id}.md")), body).expect("decision");
        }
        for (id, body) in specs {
            fs::write(workflow.join(format!("specs/{id}.md")), body).expect("spec");
        }
        for target in leased {
            write_lease(&control, target);
        }
        run_condition(root.path(), "planner").code
    }

    /// 후속 기획서가 없는 최신 수정 요청 하나로 기획자 대기가 열린다. 아이디어 디렉터리가 없어도
    /// 결정 루프가 돈다.
    #[test]
    fn a_revision_request_opens_planner_work_without_any_idea() {
        let decision = "---\nschema: workflow-labs/decision@1\nid: DECISION-001\nspec_id: SPEC-001\noutcome: revision_requested\ncreated_at: 2026-08-01T00:00:00Z\n---\n";

        assert_eq!(
            planner_exit_code(&[("DECISION-001", decision)], &[], &[]),
            0
        );
    }

    /// 후속 기획서가 결정 id를 참조하면 닫힌다. 선점한 lease도 같은 결과를 만든다.
    #[test]
    fn an_answered_or_claimed_revision_request_closes_planner_work() {
        let decision = "---\nschema: workflow-labs/decision@1\nid: DECISION-001\nspec_id: SPEC-001\noutcome: revision_requested\ncreated_at: 2026-08-01T00:00:00Z\n---\n";
        let follow_up = "---\nschema: workflow-labs/spec@1\nid: SPEC-002\nstatus: draft\nsource_decision_id: DECISION-001\n---\n";

        assert_eq!(
            planner_exit_code(
                &[("DECISION-001", decision)],
                &[("SPEC-002", follow_up)],
                &[],
            ),
            1
        );
        assert_eq!(
            planner_exit_code(&[("DECISION-001", decision)], &[], &["DECISION-001"]),
            1
        );
    }

    /// 같은 기획서에 더 늦은 결정이 있으면 재작업 대상이 아니다. 동률은 최신으로 본다.
    #[test]
    fn only_the_latest_decision_of_a_spec_opens_planner_work() {
        let request = "---\nschema: workflow-labs/decision@1\nid: DECISION-001\nspec_id: SPEC-001\noutcome: revision_requested\ncreated_at: 2026-08-01T00:00:00Z\n---\n";
        let later = "---\nschema: workflow-labs/decision@1\nid: DECISION-002\nspec_id: SPEC-001\noutcome: approved\ncreated_at: 2026-08-02T00:00:00Z\n---\n";
        let tied = "---\nschema: workflow-labs/decision@1\nid: DECISION-002\nspec_id: SPEC-001\noutcome: approved\ncreated_at: 2026-08-01T00:00:00Z\n---\n";
        let other_spec = "---\nschema: workflow-labs/decision@1\nid: DECISION-002\nspec_id: SPEC-002\noutcome: approved\ncreated_at: 2026-08-09T00:00:00Z\n---\n";

        assert_eq!(
            planner_exit_code(
                &[("DECISION-001", request), ("DECISION-002", later)],
                &[],
                &[],
            ),
            1
        );
        assert_eq!(
            planner_exit_code(
                &[("DECISION-001", request), ("DECISION-002", tied)],
                &[],
                &[],
            ),
            0,
            "동률은 최신으로 본다"
        );
        assert_eq!(
            planner_exit_code(
                &[("DECISION-001", request), ("DECISION-002", other_spec)],
                &[],
                &[],
            ),
            0,
            "다른 기획서의 늦은 결정은 이 결정을 밀어내지 않는다"
        );
    }

    /// 개발 작업 QA 반려는 기획자 잡을 깨우지 않는다. 스키마 줄과 `spec_id`가 그것을 거른다.
    #[test]
    fn a_task_qa_revision_request_does_not_open_planner_work() {
        let qa = "---\nschema: workflow-labs/qa-decision@1\nid: DECISION-001\ntask_id: TASK-001\noutcome: revision_requested\ncreated_at: 2026-08-01T00:00:00Z\n---\n";

        assert_eq!(planner_exit_code(&[("DECISION-001", qa)], &[], &[]), 1);
    }

    // ── SPEC-015 R3 시나리오 표 ────────────────────────────────────────────────────────
    //
    // R3이 열거한 목록을 데이터로 세운 것이다. 코드로 흩어 놓지 않는 이유는 "이 표가 R3의 목록을
    // 덮는가"를 사람이 한눈에 볼 수 있어야 하기 때문이다. 표는 현재 플랫폼에 설치된 구현을 돌리므로,
    // Windows 러너에서는 PowerShell 구현이 같은 행들을 통과해야 한다.

    /// 표의 한 행. `build`가 컨트롤 루트 아래에 픽스처를 세우고, 그 상태에서 `roles`의 각 역할이
    /// 내야 하는 종료 코드가 `expected`, 표준 출력 첫 줄에 내야 하는 사유 코드가 `reason`이다.
    ///
    /// 두 열은 서로를 대신하지 못한다. `migration.lock` 행과 대상 없음 행은 종료 코드가 둘 다 1이라
    /// `expected`만으로는 구별되지 않는데, 사용자가 할 일은 정반대다(기다린다 / 마이그레이션을
    /// 끝낸다). 그 구별이 `reason` 열에만 있다.
    struct Scenario {
        name: &'static str,
        roles: &'static [&'static str],
        expected: i32,
        reason: &'static str,
        build: fn(&Path),
    }

    /// 역할과 무관한 결론을 요구하는 행이 쓴다.
    const EVERY_ROLE: &[&str] = &["planner", "architect", "developer"];

    /// 픽스처 문서 하나. 워크플로우는 `wf-demo` 하나면 된다 — 표가 보는 것은 역할별 판정이다.
    fn write_document(control_root: &Path, kind: &str, id: &str, body: &str) {
        let directory = control_root.join("wf-demo").join(kind);
        fs::create_dir_all(&directory).expect("document root");
        fs::write(directory.join(format!("{id}.md")), body).expect("write document");
    }

    /// 표가 쓰는 작업 문서. 디렉터리를 만들고 [`write_task`]에 넘긴다.
    fn write_task_document(control_root: &Path, id: &str, status: &str, extra: Option<&str>) {
        let tasks = control_root.join("wf-demo").join("tasks");
        fs::create_dir_all(&tasks).expect("tasks root");
        write_task(&tasks, id, status, extra);
    }

    fn write_idea_document(control_root: &Path, id: &str) {
        write_document(
            control_root,
            "ideas",
            id,
            &format!("---\nschema: workflow-labs/idea@1\nid: {id}\nstatus: inbox\n---\n"),
        );
    }

    /// 표가 쓰는 승인 결정. `created_by: user`는 아키텍트 분기가 값 전체를 비교하므로 빠뜨릴 수
    /// 없는 줄이다(SPEC-028 R5).
    fn write_approved_decision(control_root: &Path, id: &str, spec_id: &str) {
        write_decision_document(control_root, id, spec_id, "user", "2026-08-01T00:00:00Z");
    }

    /// `created_by`와 `created_at`을 부르는 쪽이 정하는 결정 문서. 최신 판정과 `created_by` 필터를
    /// 보는 행이 쓴다.
    fn write_decision_document(
        control_root: &Path,
        id: &str,
        spec_id: &str,
        created_by: &str,
        created_at: &str,
    ) {
        write_document(
            control_root,
            "decisions",
            id,
            &format!("---\nschema: workflow-labs/decision@1\nid: {id}\nspec_id: {spec_id}\noutcome: approved\ncreated_by: {created_by}\ncreated_at: {created_at}\n---\n"),
        );
    }

    /// 최신 판정이 보는 더 늦은 수정 요청. 같은 기획서의 승인을 최신 자리에서 밀어낸다.
    fn write_later_revision_request(control_root: &Path, id: &str, spec_id: &str) {
        write_document(
            control_root,
            "decisions",
            id,
            &format!("---\nschema: workflow-labs/decision@1\nid: {id}\nspec_id: {spec_id}\noutcome: revision_requested\ncreated_by: user\ncreated_at: 2026-08-02T00:00:00Z\n---\n"),
        );
    }

    const SCENARIOS: &[Scenario] = &[
        Scenario {
            name: "기획자: 참조 없는 아이디어가 있다",
            roles: &["planner"],
            expected: 0,
            reason: "eligible",
            build: |control: &Path| write_idea_document(control, "IDEA-001"),
        },
        Scenario {
            name: "기획자: 모든 아이디어가 참조됐다",
            roles: &["planner"],
            expected: 1,
            reason: "no-target",
            build: |control: &Path| {
                write_idea_document(control, "IDEA-001");
                write_document(
                    control,
                    "specs",
                    "SPEC-001",
                    "---\nschema: workflow-labs/spec@1\nid: SPEC-001\nstatus: draft\nsource_idea_id: IDEA-001\n---\n",
                );
            },
        },
        Scenario {
            name: "기획자: 참조 없는 아이디어에 lease가 있다",
            roles: &["planner"],
            expected: 1,
            reason: "no-target",
            build: |control: &Path| {
                write_idea_document(control, "IDEA-001");
                write_lease(control, "IDEA-001");
            },
        },
        Scenario {
            name: "아키텍트: 후속 작업 없는 승인 결정이 있다",
            roles: &["architect"],
            expected: 0,
            reason: "eligible",
            build: |control: &Path| write_approved_decision(control, "DECISION-001", "SPEC-001"),
        },
        Scenario {
            name: "아키텍트: 모든 승인 결정에 후속 작업이 있다",
            roles: &["architect"],
            expected: 1,
            reason: "no-target",
            build: |control: &Path| {
                write_approved_decision(control, "DECISION-001", "SPEC-001");
                write_task_document(
                    control,
                    "TASK-001",
                    "qa_waiting",
                    Some("source_decision_id: DECISION-001"),
                );
            },
        },
        Scenario {
            name: "아키텍트: 그 결정의 기획서에 lease가 있다",
            roles: &["architect"],
            expected: 1,
            reason: "no-target",
            build: |control: &Path| {
                write_approved_decision(control, "DECISION-001", "SPEC-001");
                write_lease(control, "SPEC-001");
            },
        },
        // 아래 세 행이 SPEC-028 R4·R5의 아키텍트 판정이다. 기획자 분기의 최신 검사와 앱의
        // `created_by` 필터를 아키텍트 분기가 같은 어법으로 갖게 된 것을 본다.
        Scenario {
            // 계약 문언의 "The latest app-owned decision must be `approved`". 파생 작업이 없어도
            // 최신이 아닌 승인은 일감이 아니다. 이 행이 최신 검사가 실제로 도는지를 잡는다.
            name: "아키텍트: 승인 뒤에 더 늦은 결정이 붙었다",
            roles: &["architect"],
            expected: 1,
            reason: "no-target",
            build: |control: &Path| {
                write_approved_decision(control, "DECISION-001", "SPEC-001");
                write_later_revision_request(control, "DECISION-002", "SPEC-001");
            },
        },
        Scenario {
            // 위임 대리 결정. 앱의 두 읽기 경로가 세지 않는 값이므로 스크립트도 세지 않는다.
            // 값 전체를 비교하는지가 여기서 보인다 — 접두 일치면 `user-delegate`가 통과한다.
            name: "아키텍트: created_by가 user가 아닌 승인만 있다",
            roles: &["architect"],
            expected: 1,
            reason: "no-target",
            build: |control: &Path| {
                write_decision_document(
                    control,
                    "DECISION-001",
                    "SPEC-001",
                    "user-delegate",
                    "2026-08-01T00:00:00Z",
                );
            },
        },
        Scenario {
            // 재가 형태. 분해가 끝난 승인에 더 늦은 승인이 더해지면, 최신 검사는 오래된 승인을
            // 밀어내지만 새 승인 자신은 최신이고 참조하는 작업이 없어 일감으로 남는다. 작업 문서가
            // 이 자리에 "일감 없음"을 적었으나 그렇게 만들면 같은 모양인 이 저장소의 SPEC-022
            // (`DECISION-7A3E5B90` 분해 완료 + 더 늦은 `DECISION-4E8C1D67` 미분해)의 판정이
            // 뒤집힌다. 완료 조건 8이 그 결정의 판정 불변을 요구하므로 실제 값을 적는다.
            name: "아키텍트: 분해된 승인 뒤에 더 늦은 승인이 더해졌다",
            roles: &["architect"],
            expected: 0,
            reason: "eligible",
            build: |control: &Path| {
                write_approved_decision(control, "DECISION-001", "SPEC-001");
                write_task_document(
                    control,
                    "TASK-001",
                    "qa_waiting",
                    Some("source_decision_id: DECISION-001"),
                );
                write_decision_document(
                    control,
                    "DECISION-002",
                    "SPEC-001",
                    "user",
                    "2026-08-02T00:00:00Z",
                );
            },
        },
        Scenario {
            name: "개발자: todo 작업이 있다",
            roles: &["developer"],
            expected: 0,
            reason: "eligible",
            build: |control: &Path| write_task_document(control, "TASK-001", "todo", None),
        },
        Scenario {
            name: "개발자: todo 작업이 없다",
            roles: &["developer"],
            expected: 1,
            reason: "no-target",
            build: |control: &Path| write_task_document(control, "TASK-001", "qa_waiting", None),
        },
        Scenario {
            name: "개발자: todo 작업에 lease가 있다",
            roles: &["developer"],
            expected: 1,
            reason: "no-target",
            build: |control: &Path| {
                write_task_document(control, "TASK-001", "todo", None);
                write_lease(control, "TASK-001");
            },
        },
        // 선행 선언 두 행은 TASK-040이 도입한 판정을 본다. 규칙의 단일 정의는 TASK-037이다.
        Scenario {
            name: "개발자: 선행 선언이 충족됐다",
            roles: &["developer"],
            expected: 0,
            reason: "eligible",
            build: |control: &Path| {
                write_task_document(control, "TASK-001", "todo", Some("depends_on: [TASK-002]"));
                write_task_document(control, "TASK-002", "qa_waiting", None);
            },
        },
        Scenario {
            // 선행 자신이 후보가 되지 않도록 lease로 제외한다. 그래야 후행의 판정만 남는다.
            name: "개발자: 선행 선언이 충족되지 않았다",
            roles: &["developer"],
            expected: 1,
            reason: "no-target",
            build: |control: &Path| {
                write_task_document(control, "TASK-001", "todo", Some("depends_on: [TASK-002]"));
                write_task_document(control, "TASK-002", "todo", None);
                write_lease(control, "TASK-002");
            },
        },
        Scenario {
            // 처리할 대상이 있는 저장소에서 본다. 2가 인자 때문에 나온 값임을 분명히 한다.
            name: "공통: 잘못된 인자",
            roles: &["reviewer"],
            expected: 2,
            reason: "usage",
            build: |control: &Path| write_task_document(control, "TASK-001", "todo", None),
        },
        Scenario {
            name: "공통: migration.lock이 있으면 역할과 무관하다",
            roles: EVERY_ROLE,
            expected: 1,
            reason: "migration-lock",
            build: |control: &Path| {
                write_idea_document(control, "IDEA-001");
                write_approved_decision(control, "DECISION-001", "SPEC-001");
                write_task_document(control, "TASK-001", "todo", None);
                let runtime = control.join(".runtime");
                fs::create_dir_all(&runtime).expect("runtime root");
                fs::write(runtime.join("migration.lock"), "").expect("migration lock");
            },
        },
        Scenario {
            // 본문이 빈 문서는 어느 값도 읽히지 않아 어떤 역할도 깨우지 않는다. PowerShell 구현은
            // 이때 빈 배열을 돌려주는 경로를 타므로(TASK-042 인계 사항) 그 경로를 여기서 덮는다.
            name: "공통: 본문이 빈 문서는 아무 역할도 깨우지 않는다",
            roles: EVERY_ROLE,
            expected: 1,
            reason: "no-target",
            build: |control: &Path| {
                for kind in ["ideas", "specs", "decisions", "tasks"] {
                    write_document(control, kind, "EMPTY", "");
                }
            },
        },
    ];

    /// 표의 각 행에서 현재 플랫폼의 조건 스크립트가 기대 종료 코드와 기대 사유를 낸다(기획서 완료
    /// 조건 6·7·8).
    ///
    /// 두 본문의 사유가 갈라지는 것을 잡는 장치가 이 테스트다. 표는 현재 플랫폼에 설치된 구현을
    /// 돌리고 CI가 세 플랫폼에서 같은 표를 돌리므로(`.github/workflows/ci.yml`), Windows 러너에서
    /// PowerShell 구현이 같은 사유를 내지 못하면 그 러너가 실패한다. 문자열 포함 검사가 아니라
    /// 실행 결과 대조라, 코드를 본문에 적어 두고 엉뚱한 자리에서 내는 경우까지 걸린다.
    #[test]
    fn the_installed_script_matches_the_scenario_table() {
        for scenario in SCENARIOS {
            let (root, control) = project();
            install_condition_script(&control).expect("install condition script");
            (scenario.build)(&control);

            for role in scenario.roles {
                let run = run_condition(root.path(), role);

                assert_eq!(run.code, scenario.expected, "{} — {role}", scenario.name);
                assert_eq!(
                    run.reason(),
                    scenario.reason,
                    "{} — {role}: 사유",
                    scenario.name
                );
                // 데몬이 옮기는 것은 첫 줄 하나이고 200자까지다(SPEC-023 확인 사실 16).
                assert_eq!(
                    run.stdout.lines().count(),
                    1,
                    "{} — {role}: 사유는 한 줄이어야 한다: {:?}",
                    scenario.name,
                    run.stdout
                );
                assert!(
                    run.reason().len() <= 200,
                    "{} — {role}: 사유가 200자를 넘는다",
                    scenario.name
                );
            }
        }
    }
}
