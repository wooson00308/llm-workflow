#!/bin/sh
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
