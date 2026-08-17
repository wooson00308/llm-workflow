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
