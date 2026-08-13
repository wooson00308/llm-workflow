#!/bin/sh
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
