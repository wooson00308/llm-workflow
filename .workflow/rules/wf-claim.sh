#!/bin/sh
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
