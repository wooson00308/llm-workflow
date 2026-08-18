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
const CONDITION_SCRIPT_VERSION: u32 = 24;

/// 설치할 조건 스크립트의 `sh` 구현. `#!/bin/sh` 다음 두 줄이 앱 관리 표기다.
///
/// 이 본문이 `sh` 판정의 단일 원본이다. TASK-075가 저장소 사본을 지운 뒤로 맞춰야 할 두 번째
/// 파일이 없다. 판정 규칙을 고치면 PowerShell 본문과 `role_eligibility.rs`의 이식본까지 셋을
/// 함께 고쳐야 한다.
const CONDITION_SCRIPT_SH: &str = r#"#!/bin/sh
# managed_by: workflow-labs
# condition_script_version: 24
# LLM Workflow 하트비트 조건 검사. 역할별 처리 가능한 대상이 있으면 0, 없으면 1을 반환한다.
# 판정 사유는 표준 출력 첫 줄에 ASCII 코드 한 줄로 나간다.
# 사용법: sh .workflow/rules/wf-eligible.sh planner|architect|developer [--json]  (프로젝트 루트에서 실행)
set -u

role="${1:-}"
machine_output=0
[ "${2:-}" = "--json" ] && machine_output=1
machine_target=""
machine_target_kind=""
machine_candidates=""
leases=".workflow/.runtime/leases"
isolation=".workflow/.runtime/isolation"
# lease 훑기는 한 번의 판정에서 한 번만 돈다. 단독 점유 훑기와 개발자 분기가 모두 부르는데, 두 번
# 돌면 판정 순간이 둘로 갈려 같은 실행 안에서 만료 판정이 어긋난다.
leases_scanned=0
active_leases=""
active_count=0
# 단독 점유 상태(SPEC-065 R2·R3). 대표 작업이 비어 있으면 판정은 이 절이 생기기 전과 완전히 같다.
solo_representative=""
solo_other_leases=0
solo_candidates=""
# 개발자 후보 훑기의 모드. verdict는 개발자 분기의 판정이고, solo는 선점과 무관한 조건만 보아
# 단독 후보를 모으는 훑기다.
pass_mode=verdict
# 공유 기준 조회는 통합 대기 기록을 가진 후보를 처음 만났을 때 한 번만 돈다. 그때까지 이 넷은
# "아직 조회하지 않았다"를 뜻한다.
shared_scanned=0
shared_ok=0
shared_dirty=0
shared_head=""
# 훑기가 모은 목록을 담을 때 쓰는 구분자. 값은 전부 한 줄에서 읽어 온 것이라 개행을 담을 수 없으므로
# 개행이 목록의 경계가 된다.
nl='
'

# 판정 사유를 표준 출력 첫 줄에 내고 종료한다. 하트비트가 그 줄을 state.json의
# last_condition_output으로 옮기고, 앱이 코드를 사용자 문장으로 옮긴다.
# 사유는 ASCII 코드 한 줄이다. 문장을 본문에 두면 PowerShell 본문이 같은 문장을 낼 수 없다.
# 표준 출력에 쓰는 것은 이 함수뿐이다. deps_of의 목록 출력은 언제나 명령 치환이 받아 가므로
# 이 줄과 섞이지 않는다 — 그래서 사유가 표준 출력의 첫 줄이자 유일한 줄이 된다.
# 사유는 판정을 바꾸지 않는다. 종료 코드는 이 함수를 쓰기 전과 같다.
json_quote() {
  # 기계 출력은 문서에서 읽은 값을 담으므로 한 줄 JSON의 인용을 여기서 보장한다. 문서의 한 줄 값에는
  # 개행이 없고, 탭·따옴표·역슬래시만 이스케이프하면 이 계약의 문자열 자리가 유효하다.
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

machine_result() { # $1=사유 코드
  machine_reason=$1
  if [ -n "$machine_target" ]; then machine_reason=eligible; fi
  printf '{"schemaVersion":1,"role":"%s","targetId":' "$(json_quote "$role")"
  if [ -n "$machine_target" ]; then
    printf '"%s"' "$(json_quote "$machine_target")"
  else
    printf 'null'
  fi
  printf ',"targetKind":'
  if [ -n "$machine_target_kind" ]; then
    printf '"%s"' "$(json_quote "$machine_target_kind")"
  else
    printf 'null'
  fi
  printf ',"candidates":['
  machine_first=1
  while IFS='	' read -r machine_code machine_id; do
    [ -n "$machine_code" ] || continue
    [ "$machine_first" -eq 1 ] || printf ','
    machine_first=0
    printf '{"id":"%s","reason":"%s"}' \
      "$(json_quote "$machine_id")" "$(json_quote "$machine_code")"
  done <<MACHINE_CANDIDATES
$machine_candidates
MACHINE_CANDIDATES
  printf '],"verdict":"%s"}\n' "$(json_quote "$machine_reason")"
}

verdict() { # $1=사유 코드 $2=종료 코드
  if [ "$machine_output" -eq 1 ]; then
    if [ -n "$machine_target" ]; then
      machine_result eligible
      exit 0
    fi
    machine_result "$1"
    exit "$2"
  fi
  printf '%s\n' "$1"
  exit "$2"
}

# 대상과 후보별 제외 사유는 표준 오류로 낸다(SPEC-049 R1). 표준 출력은 데몬이 사유 한 줄로 옮기는
# 자리라 그 계약을 그대로 두고(SPEC-023 R4), 넓어진 답은 사람과 세션이 읽는 자리로 보낸다.
# 코드를 앞에 두는 것은 뒤가 id이기 때문이다 — 값에 공백이 들어와도 줄의 뜻이 갈라지지 않는다.
# 이 두 함수는 판정을 바꾸지 않는다. 종료 코드도 후보를 고르는 차례도 그대로다.
note_candidate() { # $1=제외 사유 코드 $2=후보 id
  if [ "$machine_output" -eq 1 ]; then
    machine_candidates="${machine_candidates}$1	$2$nl"
    return
  fi
  printf 'candidate: %s %s\n' "$1" "$2" >&2
}

# 대상으로 고른 후보. 후보 줄과 대상 줄을 함께 내어, 목록만 읽어도 대상이 어디서 나왔는지 보인다.
note_target() { # $1=대상 id $2=대상 종류(없으면 빈 값)
  # 단독 점유 상태의 마지막 검사(SPEC-065 R2·R3). 세 역할의 후보가 모두 이 함수를 지나므로 검사가
  # 여기 한 자리에 있고, 지금 있는 제외 사유들보다 **뒤**에 있으므로 이 절이 없을 때 사유가 붙던
  # 후보는 그 사유를 그대로 받는다. 대표 작업이 비어 있으면 아무 일도 하지 않는다.
  if [ -n "$solo_representative" ]; then
    if [ "$1" != "$solo_representative" ]; then
      note_candidate solo-run-active "$1"
      return 0
    fi
    if [ "$solo_other_leases" -gt 0 ]; then
      note_candidate solo-run-wait "$1"
      return 0
    fi
  fi
  if [ "$machine_output" -eq 1 ]; then
    note_candidate eligible "$1"
    [ -n "$machine_target" ] || machine_target=$1
    [ -n "$machine_target_kind" ] || machine_target_kind=${2:-}
    return
  fi
  printf 'candidate: eligible %s\n' "$1" >&2
  printf 'target: %s\n' "$1" >&2
  verdict eligible 0
}

# 만료 표기 판정 한 자리. 자리수가 고정된 UTC 표기는 사전순 비교가 곧 시각 비교다. POSIX sh에는
# 이식 가능한 날짜 파싱이 없다. lease의 만료와 한도 보류의 재개 시각이 같은 표기를 쓰므로 두 판정이
# 이 함수 하나를 쓴다 — 날짜 파싱을 자리마다 새로 만들면 표기 계약이 그만큼 갈라진다.
# 읽을 수 없는 표기를 선점으로 세지 않는다. 선점 헬퍼(wf-claim.sh)는 같은 상황을 반대로 다루는데,
# 헬퍼가 지는 위험은 살아 있는 남의 lease를 인수하는 것이고 이 판정이 지는 위험은 대상이 영원히
# 열리지 않는 것이다. 실제 선점은 배타적 생성이 막으므로 이 판정이 관대해도 중복 선점이 되지 않는다.
lease_unexpired() { # $1=만료 표기 $2=판정 시각
  case "$1" in
    ????-??-??T??:??:??Z) [ "$1" '>' "$2" ] ;;
    *) return 1 ;;
  esac
}

# 이 역할이 쓰는 실행 도구가 사용 한도로 대기 중이면 0(SPEC-071 R-05·R-09). 기록은 기기 단위라
# 프로젝트 밖 사용자 홈 아래에 있고, 역할과 실행 도구를 잇는 대응표는 프로젝트 안에 있다.
# 확인 실패는 보류가 아니다(R-23). 홈을 얻지 못했거나, 대응표가 없거나, 이 역할 줄이 없거나, 실행
# 도구 이름이 정해진 문자 밖이거나, 기록이 없거나, 재개 시각이 표기 계약을 벗어나면 1을 돌려주어
# 지금과 똑같이 판정하게 한다. 읽지 못한 것을 보류로 바꾸면 입출력 오류 한 번이 배정을 통째로 멈춘다.
# 이 함수는 파일을 읽기만 한다. 기록도 대응표도 만들거나 고치거나 지우지 않는다(R-21·R-22).
provider_limit_waiting() { # $1=역할
  hold_home=${HOME:-}
  [ -n "$hold_home" ] || return 1
  hold_map=".workflow/.runtime/role-providers.yml"
  [ -f "$hold_map" ] || return 1
  # 역할 이름은 인자로 들어온 값이라 sed 패턴에 넣지 않는다. 따옴표로 감싼 case 패턴은 글롭 문자를
  # 글자 그대로 보므로, 어떤 인자가 와도 다른 역할 줄을 집어 오지 않는다.
  hold_provider=""
  while IFS= read -r hold_line; do
    case "$hold_line" in
      "$1:"*) hold_provider=${hold_line#"$1":}; break ;;
    esac
  done < "$hold_map"
  while :; do
    case "$hold_provider" in ' '*) hold_provider=${hold_provider# } ;; *) break ;; esac
  done
  # 이름이 곧 파일 이름이다. 정해진 문자 밖의 값으로는 경로를 만들지 않는다.
  case "$hold_provider" in
    ''|*[!A-Za-z0-9_-]*) return 1 ;;
  esac
  hold_record="$hold_home/.workflow-labs/provider-holds/$hold_provider.yml"
  [ -f "$hold_record" ] || return 1
  hold_stamp=$(sed -n 's/^resume_at: *//p' "$hold_record" | head -1 | tr -d '"'\''')
  lease_unexpired "$hold_stamp" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}

[ -f ".workflow/.runtime/migration.lock" ] && verdict migration-lock 1
# 후보를 하나도 보기 전에 끝낸다. 대상이 있어도 그 실행 도구로는 세션을 시작할 수 없으므로, 대상을
# 내주면 배정 주기가 즉시 실패할 세션을 계속 만든다. 기계 출력에서도 대상이 비어 나가 예약 헬퍼가
# 예약하지 않는다.
provider_limit_waiting "$role" && verdict provider-limit-wait 1

# 유효한(미만료) lease가 있으면 0. 파일이 없거나 시각을 읽을 수 없으면 1.
# 기획자·아키텍트 분기가 쓴다. 개발자 분기는 후보마다 이 함수를 부르는 대신 scan_leases가 모아 둔
# 목록을 보고, 만료 판정은 위 함수 하나가 두 자리 모두에서 한다.
# 판정은 lease 파일을 읽기만 한다. 지우거나 고치거나 새로 만들지 않는다.
lease_blocks() { # $1=대상 id
  lease="$leases/$1.yml"
  [ -f "$lease" ] || return 1
  exp=$(sed -n 's/^expires_at: *//p' "$lease" | head -1 | tr -d '"'\''')
  lease_unexpired "$exp" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}

# 토큰 앞뒤의 공백류를 걷어낸 값을 $trimmed에 담는다. 원래 본문이 토큰마다 sed를 하나씩 띄우던
# 자리다 — 걷어내는 문자 집합은 그 sed의 [[:space:]]와 같고, 사라지는 것은 프로세스뿐이다.
trim_token() { # $1=토큰
  trimmed=$1
  while :; do
    case "$trimmed" in [[:space:]]*) trimmed=${trimmed#?} ;; *) break ;; esac
  done
  while :; do
    case "$trimmed" in *[[:space:]]) trimmed=${trimmed%?} ;; *) break ;; esac
  done
}

# 프론트매터의 한 줄 선언을 읽어 id 목록을 $parsed에 담는다.
# 반환값 1은 "키는 있는데 계약 형식이 아니다"이고, 그 작업은 미충족이다.
# 선언 줄 수와 첫 줄의 값은 scan_tasks가 읽어 온 것을 받는다. 그 훑기가 세고 뽑는 규칙이 원래
# 본문의 grep -c와 sed 그대로이므로, 이 함수가 보는 재료는 파일에서 직접 읽던 때와 같다.
deps_of() { # $1=선언 줄 수 $2=첫 선언 줄의 값
  parsed=""
  [ "$1" -eq 0 ] && return 0
  [ "$1" -gt 1 ] && return 1
  value=$2
  [ -n "$value" ] || return 1
  case "$value" in '['*']') ;; *) return 1 ;; esac
  inner=${value#?}
  inner=${inner%?}
  case "$inner" in *[![:space:],]*) ;; *) return 0 ;; esac
  out=""
  rest="$inner,"
  while [ -n "$rest" ]; do
    trim_token "${rest%%,*}"
    rest=${rest#*,}
    [ -n "$trimmed" ] || return 1
    case "$trimmed" in *[!A-Za-z0-9_-]*) return 1 ;; esac
    out="$out $trimmed"
  done
  parsed=${out# }
}

# 프론트매터의 겹침 선언 한 줄을 읽어 경로 목록을 $parsed에 담는다.
# 반환값 1은 "키가 없거나 계약 형식이 아니다"이고, 그 작업은 판정 불가다. deps_of와 다른 점은
# 둘이다 — 키가 없는 것도 1이고(선언 없는 작업은 무엇과도 겹치는 것으로 본다), 경로에 쓰이는
# `.`과 `/`가 허용 문자에 더 있다. 공백이 든 경로는 sh의 단어 분리가 나눠 버리므로 형식 오류다.
scope_of() { # $1=선언 줄 수 $2=첫 선언 줄의 값
  parsed=""
  [ "$1" -eq 1 ] || return 1
  value=$2
  [ -n "$value" ] || return 1
  case "$value" in '['*']') ;; *) return 1 ;; esac
  inner=${value#?}
  inner=${inner%?}
  case "$inner" in *[![:space:],]*) ;; *) return 0 ;; esac
  out=""
  rest="$inner,"
  while [ -n "$rest" ]; do
    trim_token "${rest%%,*}"
    rest=${rest#*,}
    [ -n "$trimmed" ] || return 1
    case "$trimmed" in *[!A-Za-z0-9_./-]*) return 1 ;; esac
    out="$out $trimmed"
  done
  parsed=${out# }
}

# 프론트매터의 단독 수행 선언 한 줄을 읽는다. 0이면 단독 선언으로 읽히는 것이고 1이면 선언하지
# 않은 것이다. `true`가 선언이고 키가 없는 것과 `false`가 선언하지 않은 것이며, 그 밖의 값은 모두
# 읽을 수 없는 선언이라 단독으로 다룬다 — 선언 줄이 둘 이상인 것, 빈 값, 따옴표로 감싼 것, 여러
# 줄로 펼친 것이 여기 들어간다. 판정 불가를 안전한 쪽으로 기울이는 것은 scope_of와 같은 원칙이다.
solo_run_of() { # $1=선언 줄 수 $2=첫 선언 줄의 값
  [ "$1" -eq 0 ] && return 1
  [ "$1" -eq 1 ] || return 0
  case "$2" in
    true) return 0 ;;
    false) return 1 ;;
    *) return 0 ;;
  esac
}

# 다른 문서를 잡은 미만료 lease가 이 작업의 착수를 막는가. 원래 본문은 후보마다 lease 디렉터리를
# 다시 훑고 상대의 선언을 다시 읽었다. 그 값을 scan_leases와 개발자 분기의 훑기가 미리 모으므로
# 여기 남는 것은 비교뿐이고, 판정은 그대로다.
# 자기 자신을 잡은 lease는 여기 오지 않는다. 그런 작업은 후보 단계에서 이미 빠졌으므로, 후보가
# 여기까지 왔다면 자기를 잡은 미만료 lease가 없다 — 원래 본문의 자기 건너뛰기와 같은 자리다.
# 선언이 없거나 형식 오류인 쪽이 하나라도 있으면 막는다. 겹침은 대칭 관계이고, 판정 불가는 안전한
# 쪽으로 기운다. lease가 잡은 것이 작업 문서가 아니면 비교할 상대가 없으므로 막지 않는다.
# 비교는 문자열 완전 일치다. 경로 정규화도 글롭도 하지 않는다.
# 잡힌 lease가 하나도 없으면 자기 선언을 보지 않는다. 그 게으름이 판정에 든다 — 선언이 형식
# 오류여도 활성 lease가 없으면 막히지 않는다.
overlap_blocks() { # $1=자기 선언의 유효 여부 $2=자기 선언의 경로 목록
  [ "$active_count" -gt 0 ] || return 1
  [ "$1" -eq 1 ] || return 0
  [ "$lease_scope_bad" -eq 0 ] || return 0
  for a in $2; do
    case "$lease_paths" in *" $a "*) return 0 ;; esac
  done
  return 1
}

# 공유 기준의 현재 커밋과 작업 공간 상태를 한 번만 조회해 담는다. 통합 대기 기록을 가진 후보를
# 처음 만났을 때만 불리므로, 그런 기록이 없는 프로젝트에서는 git이 한 번도 실행되지 않는다.
# 조회에 실패하면 shared_ok가 0으로 남는다. 더러운지 깨끗한지 모르는 것과 깨끗한 것은 다른
# 사실이므로 합치지 않는다.
scan_shared_base() {
  [ "$shared_scanned" -eq 0 ] || return 0
  shared_scanned=1
  shared_head=$(git rev-parse HEAD 2>/dev/null) || return 0
  [ -n "$shared_head" ] || return 0
  shared_status=$(git status --porcelain --untracked-files=no 2>/dev/null) || return 0
  shared_ok=1
  [ -n "$shared_status" ] && shared_dirty=1
  return 0
}

# 격리 검사를 마치고도 공유 작업 공간에 반영하지 못해 통합을 기다리는 작업인가. 기다리는 이유가
# 그대로인 동안만 막는다 — 추적 파일의 미커밋 변경이나 stage된 변경이 남아 있고, 기록의 기준
# 커밋이 지금 공유 기준과 같을 때다. 작업 공간이 깨끗해졌거나 기준이 전진했으면 다시 후보다.
# 미추적 파일은 보지 않는다. 사용자가 새로 만들어 둔 파일은 통합이 건드릴 대상이 아니다.
# 기록이 없거나, 읽지 못하거나, 단계가 통합 대기가 아니거나, 기준 커밋이 없으면 막지 않는다.
# 반대로 git 조회가 실패하면 막은 채로 둔다. 기다림이 끝났다는 근거를 얻지 못한 상태이고, 근거 없이
# 후보로 되돌리면 이 판정이 막으려던 반복 기동이 그대로 남는다.
integration_waiting_blocks() { # $1=대상 id
  record="$isolation/$1.yml"
  [ -f "$record" ] || return 1
  step=$(sed -n 's/^step: *//p' "$record" | head -1 | tr -d '"'\''')
  [ "$step" = integration_waiting ] || return 1
  base=$(sed -n 's/^base_commit: *//p' "$record" | head -1 | tr -d '"'\''')
  [ -n "$base" ] || return 1
  scan_shared_base
  [ "$shared_ok" -eq 1 ] || return 0
  [ "$shared_dirty" -eq 1 ] || return 1
  [ "$base" = "$shared_head" ]
}

# $1에서 선언을 따라가 $2에 닿는가. 방문 집합이 종료를 보장한다.
# 간선은 훑기가 만든 $edge_map에서 읽는다. 표에 없는 id는 나가는 간선이 없고, 그것이 원래 본문의
# 세 경우를 그대로 덮는다 — 그 id의 문서가 없는 경우, 선언이 없는 경우, 선언이 형식 오류인 경우다.
reaches() { # $1=출발 id $2=목표 id
  visited=" "
  frontier="$1"
  while [ -n "$frontier" ]; do
    next=""
    for node in $frontier; do
      case "$visited" in *" $node "*) continue ;; esac
      visited="$visited$node "
      [ "$node" = "$2" ] && return 0
      case "$edge_map" in *"$nl$node "*) ;; *) continue ;; esac
      entry=${edge_map#*"$nl$node "}
      next="$next ${entry%%"$nl"*}"
    done
    frontier="$next"
  done
  return 1
}

# 아래 다섯이 판정 재료를 모으는 훑기다. 한 분기가 한 워크플로우에서 각 디렉터리를 한 번만 읽는다.
# 후보마다 같은 디렉터리를 다시 읽으면 판정 비용이 컬렉션 크기의 곱이 되고, 문서가 늘수록 데몬의
# 한도를 넘긴다(SPEC-033). 모은 값은 셸 변수에 담고 후보별 조회는 case와 파라미터 확장으로만 한다 —
# 조회마다 프로세스를 띄우면 곱이 프로세스에서 문자열 비교로 옮겨 갈 뿐이다.
# 판정 규칙은 바뀌지 않는다. 같은 답을 더 싸게 낼 뿐이다.
# 읽을 수 없는 파일은 목록에서 뺀다. 원래 본문의 grep -s와 sed도 그런 파일에서 값을 얻지 못해
# 그 문서를 건너뛰었다.

# 아이디어 디렉터리를 한 번 훑어 아이디어마다 id를 한 줄씩 낸다. id 줄이 없거나 값이 빈 문서는
# 원래 본문이 건너뛰던 그대로 아무 줄도 내지 않는다.
scan_ideas() { # $1=워크플로우 경로
  scan_dir="$1"ideas
  set --
  for f in "$scan_dir"/*.md; do
    [ -f "$f" ] && [ -r "$f" ] && set -- "$@" "$f"
  done
  [ "$#" -eq 0 ] && return 0
  awk '
    FILENAME != prev { prev = FILENAME; got = 0 }
    !got && index($0, "id:") == 1 {
      got = 1
      v = substr($0, 4)
      sub(/^ */, "", v)
      if (v != "") print v
    }
  ' "$@"
}

# 문서 디렉터리를 한 번 훑어 그 키가 든 줄을 모으고 "키: *"를 "키:"로 정규화해서 낸다.
# 후보 조회는 case "$모은값" in *"키:<id>"*) 다. 원래 정규식 "키: *<id>"가 "콜론 + 공백 0개 이상 +
# id"이므로 정규화 후의 부분 문자열 검사와 같은 답을 낸다. 앵커가 없어 줄 아무 곳이나 보는 성질도,
# DECISION-1이 DECISION-12를 적은 줄에 걸리는 부분 일치 성질도 그대로다. 줄바꿈을 건너뛰는 일치는
# 생기지 않는다 — 정규화는 같은 줄 안의 공백만 지우고, 찾는 문자열에 줄바꿈이 없다.
scan_refs() { # $1=문서 디렉터리 경로 $2=콜론까지 포함한 키
  scan_dir="$1"
  scan_key="$2"
  set --
  for f in "$scan_dir"/*.md; do
    [ -f "$f" ] && [ -r "$f" ] && set -- "$@" "$f"
  done
  [ "$#" -eq 0 ] && return 0
  awk -v key="$scan_key" '
    function emit_direct() {
      if (status == "blocked" && kind == "definition_error" && id != "") {
        print "__WF_DIRECT__\t" id
      }
    }
    FILENAME != prev {
      emit_direct()
      prev = FILENAME
      id = ""; status = ""; kind = ""
      got_id = 0; got_status = 0; got_kind = 0
    }
    {
      if (!got_id && index($0, "id:") == 1) {
        got_id = 1; id = substr($0, 4); sub(/^ */, "", id)
      }
      if (!got_status && index($0, "status:") == 1) {
        got_status = 1; status = substr($0, 8); sub(/^ */, "", status)
      }
      if (!got_kind && index($0, "blocked_kind:") == 1) {
        got_kind = 1; kind = substr($0, 14); sub(/^ */, "", kind)
      }
    }
    index($0, key) > 0 {
      line = $0
      gsub(key " +", key, line)
      print line
    }
    END { emit_direct() }
  ' "$@"
}

# 기획서 디렉터리를 한 번 훑어 draft가 아닌 기획서가 낸 참조 줄만 모은다. 기획자 분기의 두 조회가
# 이 목록 하나를 본다 — 참조가 없는 원천도, 참조가 모두 draft인 원천도 목록에 없으므로 조회 한 줄이
# 옛 조건("참조가 없다")과 새 조건("참조가 모두 draft다")을 함께 만족한다(SPEC-035 R2). 목록을 두 벌
# 모으거나 후보마다 기획서를 다시 훑으면 SPEC-033이 걷어낸 곱이 되살아난다.
#
# draft 판별은 status:로 시작하는 첫 줄의 값이 정확히 draft인 것이다. 값을 읽는 어법은 scan_ideas·
# scan_decisions와 같고, 값 전체를 비교하므로 status: 줄이 없는 문서나 계약 밖 값을 쓴 문서는
# draft가 아니다 — 그 문서의 참조 줄은 모이고 원천은 후보가 되지 않는다. 판정 불가가 안전한 쪽으로
# 기우는 것이고, role_eligibility.rs의 이식본이 프론트매터의 status 원문을 같은 값과 비교한다.
# 화면용 정규화나 아이디어 파생 상태를 쓰면 계약 밖 상태에서 정확히 반대로 답한다(SPEC-035 R7).
#
# 정규화와 부분 일치 성질은 scan_refs 그대로다. 두 키를 한 목록에 담아도 조회가 자기 키까지 포함한
# 문자열을 찾으므로 섞이지 않는다. status: 줄이 참조 줄보다 뒤에 올 수 있어 파일마다 참조 줄을 모아
# 두었다가 그 파일이 끝날 때 한꺼번에 낸다.
scan_nondraft_refs() { # $1=워크플로우 경로
  scan_dir="$1"specs
  set --
  for f in "$scan_dir"/*.md; do
    [ -f "$f" ] && [ -r "$f" ] && set -- "$@" "$f"
  done
  [ "$#" -eq 0 ] && return 0
  awk '
    function flush() {
      if (status_value != "draft") {
        for (i = 1; i <= held; i++) print buffer[i]
      }
      held = 0
      got_status = 0
      status_value = ""
    }
    FILENAME != prev { flush(); prev = FILENAME }
    !got_status && index($0, "status:") == 1 {
      got_status = 1
      status_value = substr($0, 8)
      sub(/^ */, "", status_value)
    }
    index($0, "source_idea_id:") > 0 || index($0, "source_idea:") > 0 || index($0, "source_decision_id:") > 0 {
      line = $0
      gsub(/source_idea_id: +/, "source_idea_id:", line)
      gsub(/source_idea: +/, "source_idea:", line)
      gsub(/source_decision_id: +/, "source_decision_id:", line)
      held = held + 1
      buffer[held] = line
    }
    END { flush() }
  ' "$@"
}

# 결정 디렉터리를 한 번 훑어 후보를 낸다. 후보 하나가 두 줄이다 — 첫 줄이 결정 id, 둘째 줄이
# spec_id다. 한 줄에 둘을 담으면 값 안에 구분자가 들어갔을 때 갈라지는데, 한 줄에서 읽어 온 값에
# 줄바꿈은 들어갈 수 없다. 기획자 분기는 둘째 줄을 쓰지 않지만 두 분기가 같은 헬퍼를 쓴다.
#
# 값을 뽑는 어법은 원래 본문 그대로다. id·spec_id·created_by·created_at은 그 키로 시작하는 첫 줄을
# 쓰고(sed -n 's/^키: *//p' | head -1), 스키마 줄과 outcome 줄은 프론트매터가 아니라 파일 아무 곳이나
# 본다(grep -qs "^...").
#
# 최신 결정 판정은 spec_id별 created_at 최댓값 표로 한다. 표에 드는 것은 원래 비교 루프와 같은
# 조건 — 스키마 줄이 있고 created_by가 정확히 user인 결정 — 이고, spec_id가 빈 값인 결정도 빈 키로
# 함께 묶인다. 후보는 자기 spec_id의 최댓값이 자기 created_at보다 클 때만 밀려난다.
# 자기 자신을 표에서 빼지 않아도 답이 같다: 자기가 표에 들었다면 최댓값은 자기 값 이상이고, 비교가
# > 이므로 자기 값 하나만으로는 참이 되지 않는다. 동률이 최신으로 남는 규칙이 그대로다.
# 비교는 지금과 같은 문자열 비교다. 빈 문자열을 이어 붙여 수처럼 보이는 값도 문자열로 비교한다 —
# 날짜 파싱을 새로 들이면 그것이 판정 규칙 변경이다.
scan_decisions() { # $1=워크플로우 경로 $2=찾는 outcome 값 $3=1이면 스키마와 spec_id도 후보 조건이다
  scan_dir="$1"decisions
  scan_want="outcome: $2"
  scan_strict="$3"
  set --
  for f in "$scan_dir"/*.md; do
    [ -f "$f" ] && [ -r "$f" ] && set -- "$@" "$f"
  done
  [ "$#" -eq 0 ] && return 0
  awk -v want="$scan_want" -v strict="$scan_strict" '
    FILENAME != prev {
      prev = FILENAME
      n = n + 1
      doc_id[n] = ""; doc_spec[n] = ""; doc_by[n] = ""; doc_at[n] = ""
      got_id[n] = 0; got_spec[n] = 0; got_by[n] = 0; got_at[n] = 0
      has_schema[n] = 0; has_want[n] = 0
    }
    {
      if (!got_id[n] && index($0, "id:") == 1) {
        got_id[n] = 1; v = substr($0, 4); sub(/^ */, "", v); doc_id[n] = v
      }
      if (!got_spec[n] && index($0, "spec_id:") == 1) {
        got_spec[n] = 1; v = substr($0, 9); sub(/^ */, "", v); doc_spec[n] = v
      }
      if (!got_by[n] && index($0, "created_by:") == 1) {
        got_by[n] = 1; v = substr($0, 12); sub(/^ */, "", v); doc_by[n] = v
      }
      if (!got_at[n] && index($0, "created_at:") == 1) {
        got_at[n] = 1; v = substr($0, 12); sub(/^ */, "", v); doc_at[n] = v
      }
      if (index($0, "schema: workflow-labs/decision@1") == 1) has_schema[n] = 1
      if (index($0, want) == 1) has_want[n] = 1
    }
    END {
      for (i = 1; i <= n; i++) {
        if (!has_schema[i] || doc_by[i] != "user") continue
        s = doc_spec[i]
        if (!(s in latest) || (doc_at[i] "") > (latest[s] "")) latest[s] = doc_at[i]
      }
      for (i = 1; i <= n; i++) {
        if (!has_want[i] || doc_by[i] != "user" || doc_id[i] == "") continue
        if (strict == "1" && (!has_schema[i] || doc_spec[i] == "")) continue
        s = doc_spec[i]
        if ((s in latest) && (latest[s] "") > (doc_at[i] "")) continue
        print doc_id[i]
        print doc_spec[i]
      }
    }
  ' "$@"
}

# 작업 그룹 하나를 "id<TAB>status<TAB>revision<TAB>source decision<TAB>source spec<TAB>
# source QA decision"으로 낸다. 선택 필드를 마지막에 두는 것은 POSIX read가 인접한 공백 IFS
# 구분자를 접기 때문이다. 아키텍트 분기는 중단된 preparing 그룹과 승인 분해 여부를 함께 판단하고,
# 개발자 분기는 task 원천과 그룹 원천이 같은지 확인한다.
scan_work_groups() { # $1=워크플로우 경로
  scan_dir="$1"groups
  set --
  for f in "$scan_dir"/*.md; do
    [ -f "$f" ] && [ -r "$f" ] && set -- "$@" "$f"
  done
  [ "$#" -eq 0 ] && return 0
  awk '
    function emit() {
      if (schema && id != "" && status != "" && revision ~ /^[0-9]+$/ &&
          (revision + 0) <= 4294967295 && source != "" && source_spec != "") {
        print id "\t" status "\t" sprintf("%.0f", revision + 0) "\t" source "\t" \
          source_spec "\t" source_qa
      }
    }
    FILENAME != prev {
      emit()
      prev = FILENAME
      id = ""; status = ""; revision = ""; source = ""; source_qa = ""; source_spec = ""
      schema = 0
      got_id = 0; got_status = 0; got_revision = 0; got_source = 0; got_source_qa = 0
      got_source_spec = 0
    }
    {
      if (!got_id && index($0, "id:") == 1) {
        got_id = 1; id = substr($0, 4); sub(/^ */, "", id)
      }
      if (!got_status && index($0, "status:") == 1) {
        got_status = 1; status = substr($0, 8); sub(/^ */, "", status)
      }
      if (!got_revision && index($0, "revision:") == 1) {
        got_revision = 1; revision = substr($0, 10); sub(/^ */, "", revision)
      }
      if (!got_source && index($0, "source_decision_id:") == 1) {
        got_source = 1; source = substr($0, 20); sub(/^ */, "", source)
      }
      if (!got_source_qa && index($0, "source_qa_decision_id:") == 1) {
        got_source_qa = 1; source_qa = substr($0, 23); sub(/^ */, "", source_qa)
      }
      if (!got_source_spec && index($0, "source_spec_id:") == 1) {
        got_source_spec = 1; source_spec = substr($0, 16); sub(/^ */, "", source_spec)
      }
      if (index($0, "schema: workflow-labs/work-group@1") == 1) schema = 1
    }
    END { emit() }
  ' "$@"
}

# 기능 문서의 표시 상태가 "구성 확인 필요"인지 앱과 같은 규칙으로 판정한다. 앱 쪽 정본은
# fs_project_repository.rs의 표시 상태 사슬이고, 그 사슬이 이 상태로 답하려면 그룹 확인 결정과
# 그 기능에 속한 작업과 확인 절차 본문을 함께 보아야 한다. 그래서 이 훑기가 groups, tasks,
# decisions 세 디렉터리를 한 번에 읽는다. 파일 종류는 경로 앞자리로 가른다 — 빈 파일은 awk가
# 레코드를 하나도 내지 않아 파일 번호로 세면 자리가 밀린다.
# 출력은 "id<TAB>출처 승인<TAB>출처 확인 결정"이고 구성 확인 필요인 기능만 낸다. 아키텍트가
# 문서로는 고칠 수 없다고 남긴 기능(configuration_unresolved_revision이 현재 구성 버전과 같은
# 기능)은 사람 판단 필요로 갈라지므로 여기서 내지 않는다.
scan_configuration_errors() { # $1=워크플로우 경로
  conf_wf=$1
  set --
  scan_any=0
  for f in "$conf_wf"groups/*.md; do
    [ -f "$f" ] && [ -r "$f" ] && { set -- "$@" "$f"; scan_any=1; }
  done
  [ "$scan_any" -eq 0 ] && return 0
  for f in "$conf_wf"tasks/*.md; do
    [ -f "$f" ] && [ -r "$f" ] && set -- "$@" "$f"
  done
  for f in "$conf_wf"decisions/*.md; do
    [ -f "$f" ] && [ -r "$f" ] && set -- "$@" "$f"
  done
  LC_ALL=C awk -v gdir="${conf_wf}groups/" -v tdir="${conf_wf}tasks/" \
    -v ddir="${conf_wf}decisions/" '
    function ord_init(  i) { for (i = 1; i < 256; i++) byte_code[sprintf("%c", i)] = i }
    # UTF-8 바이트열을 코드포인트 배열로 푼다. 한글 낱말 대조가 음절 단위로 이루어져야 하므로
    # 바이트가 아니라 코드포인트가 필요하다. LC_ALL=C로 돌리는 것은 substr가 바이트를 세게 하려는
    # 것이며, 로캘에 따라 awk가 글자를 세면 이 계산이 어긋난다.
    function codes(s, out,   i, len, b, c, need, cp, n) {
      len = length(s); i = 1; n = 0
      while (i <= len) {
        b = byte_code[substr(s, i, 1)]
        if (b >= 240) { cp = b - 240; need = 3 }
        else if (b >= 224) { cp = b - 224; need = 2 }
        else if (b >= 192) { cp = b - 192; need = 1 }
        else { cp = b; need = 0 }
        i++
        while (need > 0 && i <= len) {
          c = byte_code[substr(s, i, 1)]
          if (c < 128 || c >= 192) break
          cp = cp * 64 + (c - 128); i++; need--
        }
        n++; out[n] = cp
      }
      return n
    }
    # 어미가 달라진 형태를 같은 낱말로 읽는 대조. 앱 이식본은 음절을 초성·중성·종성으로 풀어
    # 비교하는데, 그 비교의 결과는 "마지막 음절에 종성이 없으면 종성만 다른 음절도 같은 낱말이고
    # 그 앞 음절은 정확히 같아야 한다"와 같다. 그래서 "보이"가 "보인다"에 걸리고 "창"은 "차이"에
    # 걸리지 않는다.
    function ending_match(tok, cp, n,   tcp, tn, i, j, ok, last, tail) {
      tn = codes(tok, tcp)
      if (tn == 0 || tn > n) return 0
      for (j = 1; j + tn - 1 <= n; j++) {
        ok = 1
        for (i = 1; i < tn; i++) if (cp[j + i - 1] != tcp[i]) { ok = 0; break }
        if (!ok) continue
        last = tcp[tn]; tail = cp[j + tn - 1]
        if (last >= 44032 && last <= 55203 && (last - 44032) % 28 == 0) {
          if (tail < 44032 || tail > 55203) continue
          if (int((tail - 44032) / 28) != int((last - 44032) / 28)) continue
        } else if (tail != last) continue
        return 1
      }
      return 0
    }
    function mentions(lowered, cp, n, tok) {
      return index(lowered, tok) > 0 || ending_match(tok, cp, n)
    }
    function mentions_any(lowered, cp, n, list,   part, k, i) {
      k = split(list, part, "\n")
      for (i = 1; i <= k; i++) if (mentions(lowered, cp, n, part[i])) return 1
      return 0
    }
    function strip_tick(s) { sub(/^`+/, "", s); sub(/`+$/, "", s); return s }
    function cli_exe(s) {
      return s == "curl" || s == "docker" || s == "docker-compose" || s == "mvn" ||
        s == "maven" || s == "xcodebuild" || s == "kubectl" || s == "helm" || s == "bash" ||
        s == "sh" || s == "zsh" || s == "pwsh" || s == "powershell" || s == "npm" ||
        s == "npx" || s == "pnpm" || s == "yarn" || s == "cargo" || s == "pytest" ||
        s == "gradle" || s == "gradlew" || s == "dotnet" || s == "phpunit" ||
        s == "composer" || s == "bundle" || s == "rspec" || s == "cmake" || s == "ctest"
    }
    function git_arg(s) {
      return s == "add" || s == "bisect" || s == "branch" || s == "checkout" || s == "clone" ||
        s == "commit" || s == "diff" || s == "fetch" || s == "grep" || s == "log" ||
        s == "merge" || s == "pull" || s == "push" || s == "rebase" || s == "reset" ||
        s == "restore" || s == "show" || s == "status" || s == "switch" || s == "tag"
    }
    function cli_line(line,   c, p, prompt, num, cmd, tmp, exe, arg, w, cnt) {
      c = line
      sub(/^[ \t\r]+/, "", c); sub(/[ \t\r]+$/, "", c)
      if (c == "") return 0
      if (index(c, "$ ") == 1 || index(c, "% ") == 1 || index(c, ">>> ") == 1 ||
          index(c, "ps> ") == 1) return 1
      if (index(c, "ps ") == 1 && index(c, "> ") > 0) return 1
      p = index(c, "$ ")
      if (p > 1) {
        prompt = substr(c, 1, p - 1)
        if (index(prompt, "@") > 0 || substr(prompt, length(prompt), 1) == ":" ||
            index(prompt, "/") > 0) return 1
      }
      if (length(c) > 3 && substr(c, 1, 1) ~ /^[A-Za-z]$/ && substr(c, 2, 1) == ":" &&
          (substr(c, 3, 1) == "\\" || substr(c, 3, 1) == "/") && index(c, "> ") > 0) return 1
      if (index(c, "- ") == 1 || index(c, "* ") == 1 || index(c, "+ ") == 1) {
        c = substr(c, 3); sub(/^[ \t\r]+/, "", c)
      } else {
        p = index(c, ". ")
        if (p > 1) {
          num = substr(c, 1, p - 1)
          if (num ~ /^[0-9]+$/) { c = substr(c, p + 2); sub(/^[ \t\r]+/, "", c) }
        }
      }
      if (index(c, HASH1) == 1) {
        cmd = substr(c, 3)
        tmp = cmd; sub(/^[ \t\r]+/, "", tmp); sub(/[ \t\r].*$/, "", tmp)
        exe = strip_tick(tmp)
        if (cli_exe(exe) || index(cmd, "go test") == 1 || index(cmd, "go build") == 1 ||
            index(cmd, "swift test") == 1 || index(cmd, "./") == 1) return 1
      }
      sub(/^`+/, "", c)
      if (index(c, "./") == 1 || index(c, "../") == 1 || index(c, ".\\") == 1 ||
          index(c, "/bin/") == 1 || index(c, "/usr/bin/") == 1) return 1
      tmp = c; sub(/^[ \t\r]+/, "", tmp)
      cnt = split(tmp, w, /[ \t\r]+/)
      exe = cnt >= 1 ? strip_tick(w[1]) : ""
      arg = cnt >= 2 ? strip_tick(w[2]) : ""
      if (cli_exe(exe)) return 1
      if (exe == "swift" && index(c, "swift test") == 1) return 1
      if (exe == "go" && (index(c, "go test") == 1 || index(c, "go build") == 1)) return 1
      if (exe == "git" && git_arg(arg)) return 1
      if (exe == "node" && (index(arg, "-") == 1 || index(arg, "/") > 0 ||
          arg ~ /\.(js|mjs|cjs|ts)$/)) return 1
      if (exe == "deno" && (arg == "run" || arg == "test" || arg == "task" || arg == "check" ||
          arg == "lint" || arg == "fmt" || arg == "compile")) return 1
      if (exe == "php" && (index(arg, "-") == 1 || index(arg, "/") > 0 || arg ~ /\.php$/)) return 1
      if (exe == "ruby" && (index(arg, "-") == 1 || index(arg, "/") > 0 || arg ~ /\.rb$/)) return 1
      if (exe == "make" && arg != "" && arg != "a" && arg != "an" && arg != "it" &&
          arg != "sure" && arg != "the" && arg != "this" && arg != "that") return 1
      return 0
    }
    function internal(text,   lowered, part, k, i, rows, m) {
      lowered = tolower(text)
      k = split(CMD, part, "\n")
      for (i = 1; i <= k; i++) if (index(lowered, part[i]) > 0) return 1
      m = split(lowered, rows, "\n")
      for (i = 1; i <= m; i++) if (cli_line(rows[i])) return 1
      return 0
    }
    function user_safe(title, body,   lowered, cp, n) {
      if (body == "" || index(body, "```") > 0) return 0
      if (internal(title) || internal(body)) return 0
      lowered = tolower(body)
      n = codes(lowered, cp)
      return mentions_any(lowered, cp, n, SURFACE) && mentions_any(lowered, cp, n, ACTION) &&
        mentions_any(lowered, cp, n, RESULT)
    }
    function leap(y) { return (y % 4 == 0) && ((y % 100 != 0) || (y % 400 == 0)) }
    function month_days(y, m) {
      if (m == 2) return leap(y) ? 29 : 28
      return (m == 4 || m == 6 || m == 9 || m == 11) ? 30 : 31
    }
    function leaps_before(y) {
      if (y <= 0) return 0
      return int((y - 1) / 4) - int((y - 1) / 100) + int((y - 1) / 400) + 1
    }
    # scan_architect_decisions와 같은 RFC3339 판독이다. 두 자리가 다른 표기를 받아들이면 같은
    # 문서에서 다른 답이 나온다.
    function rfc3339(s,   y, mo, d, h, mi, se, p, c, start, frac, zone, sign, oh, om,
                          offset, days, m, nanos) {
      if (length(s) < 20) return 0
      if (substr(s, 5, 1) != "-" || substr(s, 8, 1) != "-" ||
          substr(s, 14, 1) != ":" || substr(s, 17, 1) != ":") return 0
      c = substr(s, 11, 1)
      if (c != "T" && c != "t" && c != " ") return 0
      if (substr(s, 1, 4) !~ /^[0-9][0-9][0-9][0-9]$/ ||
          substr(s, 6, 2) !~ /^[0-9][0-9]$/ || substr(s, 9, 2) !~ /^[0-9][0-9]$/ ||
          substr(s, 12, 2) !~ /^[0-9][0-9]$/ || substr(s, 15, 2) !~ /^[0-9][0-9]$/ ||
          substr(s, 18, 2) !~ /^[0-9][0-9]$/) return 0
      y = substr(s, 1, 4) + 0; mo = substr(s, 6, 2) + 0; d = substr(s, 9, 2) + 0
      h = substr(s, 12, 2) + 0; mi = substr(s, 15, 2) + 0; se = substr(s, 18, 2) + 0
      if (mo < 1 || mo > 12 || d < 1 || d > month_days(y, mo) || h > 23 || mi > 59 ||
          se > 60) return 0
      p = 20; frac = ""
      if (substr(s, p, 1) == ".") {
        p++; start = p
        while (p <= length(s) && substr(s, p, 1) ~ /^[0-9]$/) p++
        if (p == start) return 0
        frac = substr(s, start, p - start)
      }
      zone = substr(s, p)
      if (zone == "Z" || zone == "z") {
        offset = 0
      } else {
        if (length(zone) != 6 || substr(zone, 4, 1) != ":") return 0
        sign = substr(zone, 1, 1)
        if (sign != "+" && sign != "-") return 0
        if (substr(zone, 2, 2) !~ /^[0-9][0-9]$/ ||
            substr(zone, 5, 2) !~ /^[0-9][0-9]$/) return 0
        oh = substr(zone, 2, 2) + 0; om = substr(zone, 5, 2) + 0
        if (oh > 23 || om > 59) return 0
        offset = oh * 3600 + om * 60
        if (sign == "-") offset = -offset
      }
      days = y * 365 + leaps_before(y)
      for (m = 1; m < mo; m++) days += month_days(y, m)
      days += d - 1
      nanos = 0
      if (frac != "") nanos = substr(frac "000000000", 1, 9) + 0
      if (se == 60) { se = 59; nanos += 1000000000 }
      rfc_sec = days * 86400 + h * 3600 + mi * 60 + se - offset
      rfc_nano = nanos
      return 1
    }
    function push_scenario(  body) {
      if (!cur_open) return
      body = cur_body
      sub(/^[ \t\r\n]+/, "", body); sub(/[ \t\r\n]+$/, "", body)
      g_scen[gn] = g_scen[gn] + 1
      scen_title[gn, g_scen[gn]] = cur_title
      scen_body[gn, g_scen[gn]] = body
      cur_open = 0
    }
    function head_value(line, key) { return substr(line, length(key) + 1) }
    BEGIN {
      ord_init()
      HASH1 = sprintf("%c ", 35)
      HASH3 = sprintf("%c%c%c ", 35, 35, 35)
      SURFACE = "화면\n페이지\n창\n대화상자\n다이얼로그\n목록\n메뉴\n버튼\n폼\n카드\n패널\n탭"
      SURFACE = SURFACE "\n앱\n브라우저\n모달\n알림\n토스트\n배너\n대시보드\n설정\n입력란"
      SURFACE = SURFACE "\nscreen\npage\nwindow\ndialog\nlist\nmenu\nbutton\nform\ncard\npanel"
      SURFACE = SURFACE "\ntab\napp\nbrowser\nmodal\nnotice\ntoast\nbanner\ndashboard"
      SURFACE = SURFACE "\nsettings\nfield"
      ACTION = "누르\n눌\n클릭\n선택\n입력\n열\n이동\n저장\n전환\n확인\n스크롤\n드래그"
      ACTION = ACTION "\n켜\n끄\n바꾸\n지정\n돌아"
      ACTION = ACTION "\ntap\nclick\nselect\nenter\ntype\nopen\nnavigate\nsave\nswitch\ncheck"
      ACTION = ACTION "\nscroll\ndrag"
      RESULT = "보여\n보이\n표시\n나타\n사라\n완료\n변경\n유지\n결과\n안내\n메시지\n활성"
      RESULT = RESULT "\n비활성\n추가\n삭제\n선택되어\n그대로\n적혀\n열리\n나오\n바뀌\n같아지\n남아"
      RESULT = RESULT "\nvisible\nappears\nshows\ndisplay\nhidden\ndisappears\ncomplete\nupdated"
      RESULT = RESULT "\nsaved\nresult\nmessage\nenabled\ndisabled\nadded\nremoved"
      CMD = "npx \nnpm \npnpm \nyarn \ncargo \npytest\ngo test\ngo build\npython -m "
      CMD = CMD "\ngradle test\ngradle build\ngradlew test\ngradlew build\ndotnet test"
      CMD = CMD "\ndotnet build\ncurl http://\ncurl https://\ncurl -\ndocker run "
      CMD = CMD "\ndocker build \ndocker exec \ndocker compose up\ndocker compose run"
      CMD = CMD "\ndocker compose exec\nmvn test\nmvn verify\nmvn package\nmaven test"
      CMD = CMD "\n./scripts/\n.\\scripts\\\nswift test\nxcodebuild \nbash \nzsh \npwsh "
      CMD = CMD "\npowershell \nmake test\nbun test\ntypecheck\ntype-check\ntsc \nrun lint"
      CMD = CMD "\nrun build\nlint command\nbuild command\nlint/build\nterminal\n터미널"
      CMD = CMD "\n명령어\ncommand line\n테스트를 실행\n테스트 실행\n테스트를 돌\n테스트 돌"
      CMD = CMD "\n타입 검사\n타입검사\nlint 검사\nlint를 실행\nlint 실행\n린트\n빌드를 실행"
      CMD = CMD "\n빌드 실행\n빌드를 돌"
    }
    FILENAME != prev {
      push_scenario()
      prev = FILENAME
      base = FILENAME; sub(/^.*\//, "", base)
      kind = 0
      cur_open = 0; cur_title = ""; cur_body = ""
      if (index(FILENAME, gdir) == 1) {
        kind = 1; gn++
        g_stem[gn] = base; sub(/\.md$/, "", g_stem[gn])
        g_schema[gn] = 0; g_id[gn] = ""; g_status[gn] = ""; g_mode[gn] = ""; g_rev[gn] = ""
        g_spec[gn] = ""; g_dec[gn] = ""; g_qa[gn] = ""; g_upd[gn] = ""; g_unres[gn] = ""
        g_scen[gn] = 0; g_struct[gn] = 1
        got_id = 0; got_status = 0; got_mode = 0; got_rev = 0; got_spec = 0; got_dec = 0
        got_qa = 0; got_upd = 0; got_unres = 0
      } else if (index(FILENAME, tdir) == 1) {
        kind = 2; tn++
        t_stem[tn] = base; sub(/\.md$/, "", t_stem[tn])
        t_id[tn] = ""; t_group[tn] = ""; t_rev[tn] = ""; t_spec[tn] = ""; t_dec[tn] = ""
        t_status[tn] = ""
        got_id = 0; got_group = 0; got_rev = 0; got_spec = 0; got_dec = 0; got_status = 0
      } else if (index(FILENAME, ddir) == 1) {
        kind = 3; dn++
        d_file[dn] = base
        d_gschema[dn] = 0; d_tschema[dn] = 0; d_id[dn] = ""; d_group[dn] = ""; d_rev[dn] = ""
        d_out[dn] = ""; d_by[dn] = ""; d_at[dn] = ""; d_req[dn] = ""; d_task[dn] = ""
        got_id = 0; got_group = 0; got_rev = 0; got_out = 0; got_by = 0; got_at = 0
        got_req = 0; got_task = 0
      }
    }
    {
      if (kind == 1) {
        if (index($0, HASH3) == 1) {
          rest = substr($0, 5)
          sep = index(rest, " · ")
          handled = 0
          if (sep > 0) {
            sid = substr(rest, 1, sep - 1)
            if (index(sid, "QA-") == 1) {
              handled = 1
              stitle = substr(rest, sep + length(" · "))
              sub(/^[ \t\r]+/, "", stitle); sub(/[ \t\r]+$/, "", stitle)
              if (sid == sprintf("QA-%02d", g_scen[gn] + cur_open + 1) && stitle != "") {
                push_scenario()
                cur_open = 1; cur_title = stitle; cur_body = ""
              } else {
                g_struct[gn] = 0
                if (cur_open) cur_body = cur_body $0 "\n"
              }
            }
          }
          if (!handled) {
            if (index($0, HASH3 "QA-") == 1) g_struct[gn] = 0
            if (cur_open) cur_body = cur_body $0 "\n"
          }
        } else {
          if (cur_open) cur_body = cur_body $0 "\n"
          if (!got_id && index($0, "id:") == 1) {
            got_id = 1; g_id[gn] = head_value($0, "id:"); sub(/^ */, "", g_id[gn])
          }
          if (!got_status && index($0, "status:") == 1) {
            got_status = 1; g_status[gn] = head_value($0, "status:")
            sub(/^ */, "", g_status[gn])
          }
          if (!got_mode && index($0, "qa_mode:") == 1) {
            got_mode = 1; g_mode[gn] = head_value($0, "qa_mode:"); sub(/^ */, "", g_mode[gn])
          }
          if (!got_rev && index($0, "revision:") == 1) {
            got_rev = 1; g_rev[gn] = head_value($0, "revision:"); sub(/^ */, "", g_rev[gn])
          }
          if (!got_spec && index($0, "source_spec_id:") == 1) {
            got_spec = 1; g_spec[gn] = head_value($0, "source_spec_id:")
            sub(/^ */, "", g_spec[gn])
          }
          if (!got_dec && index($0, "source_decision_id:") == 1) {
            got_dec = 1; g_dec[gn] = head_value($0, "source_decision_id:")
            sub(/^ */, "", g_dec[gn])
          }
          if (!got_qa && index($0, "source_qa_decision_id:") == 1) {
            got_qa = 1; g_qa[gn] = head_value($0, "source_qa_decision_id:")
            sub(/^ */, "", g_qa[gn])
          }
          if (!got_upd && index($0, "updated_at:") == 1) {
            got_upd = 1; g_upd[gn] = head_value($0, "updated_at:"); sub(/^ */, "", g_upd[gn])
          }
          if (!got_unres && index($0, "configuration_unresolved_revision:") == 1) {
            got_unres = 1; g_unres[gn] = head_value($0, "configuration_unresolved_revision:")
            sub(/^ */, "", g_unres[gn])
          }
          if (index($0, "schema: workflow-labs/work-group@1") == 1) g_schema[gn] = 1
        }
      } else if (kind == 2) {
        if (!got_id && index($0, "id:") == 1) {
          got_id = 1; t_id[tn] = head_value($0, "id:"); sub(/^ */, "", t_id[tn])
        }
        if (!got_group && index($0, "work_group_id:") == 1) {
          got_group = 1; t_group[tn] = head_value($0, "work_group_id:")
          sub(/^ */, "", t_group[tn])
        }
        if (!got_rev && index($0, "work_group_revision:") == 1) {
          got_rev = 1; t_rev[tn] = head_value($0, "work_group_revision:")
          sub(/^ */, "", t_rev[tn])
        }
        if (!got_spec && index($0, "source_spec_id:") == 1) {
          got_spec = 1; t_spec[tn] = head_value($0, "source_spec_id:"); sub(/^ */, "", t_spec[tn])
        }
        if (!got_dec && index($0, "source_decision_id:") == 1) {
          got_dec = 1; t_dec[tn] = head_value($0, "source_decision_id:"); sub(/^ */, "", t_dec[tn])
        }
        if (!got_status && index($0, "status:") == 1) {
          got_status = 1; t_status[tn] = head_value($0, "status:"); sub(/^ */, "", t_status[tn])
        }
      } else if (kind == 3) {
        if (!got_id && index($0, "id:") == 1) {
          got_id = 1; d_id[dn] = head_value($0, "id:"); sub(/^ */, "", d_id[dn])
        }
        if (!got_group && index($0, "group_id:") == 1) {
          got_group = 1; d_group[dn] = head_value($0, "group_id:"); sub(/^ */, "", d_group[dn])
        }
        if (!got_rev && index($0, "group_revision:") == 1) {
          got_rev = 1; d_rev[dn] = head_value($0, "group_revision:"); sub(/^ */, "", d_rev[dn])
        }
        if (!got_out && index($0, "outcome:") == 1) {
          got_out = 1; d_out[dn] = head_value($0, "outcome:"); sub(/^ */, "", d_out[dn])
        }
        if (!got_by && index($0, "created_by:") == 1) {
          got_by = 1; d_by[dn] = head_value($0, "created_by:"); sub(/^ */, "", d_by[dn])
        }
        if (!got_at && index($0, "created_at:") == 1) {
          got_at = 1; d_at[dn] = head_value($0, "created_at:"); sub(/^ */, "", d_at[dn])
        }
        if (!got_req && index($0, "request_id:") == 1) {
          got_req = 1; d_req[dn] = head_value($0, "request_id:"); sub(/^ */, "", d_req[dn])
        }
        if (!got_task && index($0, "task_id:") == 1) {
          got_task = 1; d_task[dn] = head_value($0, "task_id:"); sub(/^ */, "", d_task[dn])
        }
        if (index($0, "schema: workflow-labs/group-qa-decision@1") == 1) d_gschema[dn] = 1
        if (index($0, "schema: workflow-labs/qa-decision@1") == 1) d_tschema[dn] = 1
      }
    }
    END {
      push_scenario()
      for (i = 1; i <= dn; i++) {
        if (d_by[i] != "user") continue
        if (d_gschema[i]) {
          if (d_id[i] == "" || d_group[i] == "" || d_rev[i] !~ /^[0-9]+$/ ||
              (d_rev[i] + 0) > 4294967295 || (d_rev[i] + 0) == 0 || d_req[i] == "") continue
          if (d_out[i] != "confirmed" && d_out[i] != "revision_requested") continue
          if (!rfc3339(d_at[i])) continue
          key = d_group[i] SUBSEP sprintf("%.0f", d_rev[i] + 0)
          if (!(key in gsel) || rfc_sec > gsec[key] ||
              (rfc_sec == gsec[key] && rfc_nano > gnano[key]) ||
              (rfc_sec == gsec[key] && rfc_nano == gnano[key] &&
               d_file[i] > d_file[gsel[key]])) {
            gsec[key] = rfc_sec; gnano[key] = rfc_nano; gsel[key] = i
          }
        } else if (d_tschema[i]) {
          if (d_task[i] == "") continue
          if (d_out[i] != "confirmed" && d_out[i] != "revision_requested") continue
          if (!rfc3339(d_at[i])) continue
          tkey = d_task[i]
          if (!(tkey in tsel) || rfc_sec > tsec[tkey] ||
              (rfc_sec == tsec[tkey] && rfc_nano > tnano[tkey]) ||
              (rfc_sec == tsec[tkey] && rfc_nano == tnano[tkey] &&
               d_file[i] > d_file[tsel[tkey]])) {
            tsec[tkey] = rfc_sec; tnano[tkey] = rfc_nano; tsel[tkey] = i
          }
        }
      }
      for (gi = 1; gi <= gn; gi++) {
        if (!g_schema[gi]) continue
        gid = g_id[gi] != "" ? g_id[gi] : g_stem[gi]
        rev_ok = (g_rev[gi] ~ /^[0-9]+$/ && (g_rev[gi] + 0) <= 4294967295)
        grev = rev_ok ? (g_rev[gi] + 0) : 0
        status_ok = (g_status[gi] == "preparing" || g_status[gi] == "active")
        status = status_ok ? g_status[gi] : "active"
        mode_ok = (g_mode[gi] == "user" || g_mode[gi] == "automatic")
        mode = mode_ok ? g_mode[gi] : "user"
        structural = (status_ok && mode_ok && g_id[gi] != "" && grev > 0 && g_spec[gi] != "" &&
          g_dec[gi] != "" && g_upd[gi] != "" && rfc3339(g_upd[gi]) && g_struct[gi])
        assigned = 0; link_bad = 0; not_verified = 0; blocked = 0; developing = 0
        legacy_all = 1
        for (ti = 1; ti <= tn; ti++) {
          if (t_group[ti] == "" || t_group[ti] != gid) continue
          assigned++
          trev_ok = (t_rev[ti] ~ /^[0-9]+$/ && (t_rev[ti] + 0) <= 4294967295)
          if (!(trev_ok && (t_rev[ti] + 0) > 0 && (t_rev[ti] + 0) <= grev &&
                t_spec[ti] != "" && t_spec[ti] == g_spec[gi] &&
                t_dec[ti] != "" && t_dec[ti] == g_dec[gi])) link_bad = 1
          st = t_status[ti] != "" ? t_status[ti] : "todo"
          if (st != "verified") not_verified = 1
          if (st == "blocked") blocked = 1
          if (st == "todo" || st == "in_progress") developing = 1
          tid = t_id[ti] != "" ? t_id[ti] : t_stem[ti]
          if (!((tid in tsel) && d_out[tsel[tid]] == "confirmed")) legacy_all = 0
        }
        key = gid SUBSEP sprintf("%.0f", grev)
        latest = (key in gsel) ? d_out[gsel[key]] : ""
        if (latest == "confirmed") continue
        if (assigned > 0 && !link_bad && legacy_all) continue
        if (latest == "revision_requested") continue
        if (status == "preparing") continue
        if (blocked) continue
        if (developing) continue
        issues = 0
        if (!structural) issues = 1
        if (assigned == 0) issues = 1
        if (link_bad) issues = 1
        if (mode == "user") {
          if (g_scen[gi] == 0) issues = 1
          else {
            for (si = 1; si <= g_scen[gi]; si++) {
              if (!user_safe(scen_title[gi, si], scen_body[gi, si])) { issues = 1; break }
            }
          }
        }
        if (mode == "automatic" && g_scen[gi] > 0) issues = 1
        if (not_verified) issues = 1
        if (!issues) continue
        if (g_unres[gi] ~ /^[0-9]+$/ && (g_unres[gi] + 0) <= 4294967295 &&
            (g_unres[gi] + 0) == grev) continue
        print gid "\t" g_dec[gi] "\t" g_qa[gi]
      }
    }
  ' "$@"
}

# 아키텍트가 보는 결정 디렉터리를 한 번만 훑는다. 출력 태그는 그룹 QA 반려(G), 과거 task 정의
# 수정(T), 새 승인(A)이다. 세 후보군은 아래 역할 분기에서 계약 우선순위대로 따로 소비한다.
# 그룹 revision별 최신 app-owned QA 결정과 기획서별 최신 결정도 이 한 훑기 안에서 고른다.
scan_architect_decisions() { # $1=워크플로우 경로
  scan_dir="$1"decisions
  set --
  for f in "$scan_dir"/*.md; do
    [ -f "$f" ] && [ -r "$f" ] && set -- "$@" "$f"
  done
  [ "$#" -eq 0 ] && return 0
  LC_ALL=C awk '
    function leap(y) { return (y % 4 == 0) && ((y % 100 != 0) || (y % 400 == 0)) }
    function month_days(y, m) {
      if (m == 2) return leap(y) ? 29 : 28
      return (m == 4 || m == 6 || m == 9 || m == 11) ? 30 : 31
    }
    function leaps_before(y) {
      if (y <= 0) return 0
      return int((y - 1) / 4) - int((y - 1) / 100) + int((y - 1) / 400) + 1
    }
    # Chrono DateTime::parse_from_rfc3339와 같은 ASCII RFC3339 형태를 읽고, 비교할 UTC 초와
    # nanosecond를 전역 rfc_sec/rfc_nano에 둔다. 날짜 변환을 awk 산술로 끝내 macOS/BSD date와
    # GNU date의 서로 다른 옵션에 기대지 않는다.
    function rfc3339(s,   y, mo, d, h, mi, se, p, c, start, frac, zone, sign, oh, om,
                           offset, days, m, nanos) {
      if (length(s) < 20) return 0
      if (substr(s, 5, 1) != "-" || substr(s, 8, 1) != "-" ||
          substr(s, 14, 1) != ":" || substr(s, 17, 1) != ":") return 0
      c = substr(s, 11, 1)
      if (c != "T" && c != "t" && c != " ") return 0
      if (substr(s, 1, 4) !~ /^[0-9][0-9][0-9][0-9]$/ ||
          substr(s, 6, 2) !~ /^[0-9][0-9]$/ || substr(s, 9, 2) !~ /^[0-9][0-9]$/ ||
          substr(s, 12, 2) !~ /^[0-9][0-9]$/ || substr(s, 15, 2) !~ /^[0-9][0-9]$/ ||
          substr(s, 18, 2) !~ /^[0-9][0-9]$/) return 0
      y = substr(s, 1, 4) + 0; mo = substr(s, 6, 2) + 0; d = substr(s, 9, 2) + 0
      h = substr(s, 12, 2) + 0; mi = substr(s, 15, 2) + 0; se = substr(s, 18, 2) + 0
      if (mo < 1 || mo > 12 || d < 1 || d > month_days(y, mo) || h > 23 || mi > 59 ||
          se > 60) return 0
      p = 20; frac = ""
      if (substr(s, p, 1) == ".") {
        p++; start = p
        while (p <= length(s) && substr(s, p, 1) ~ /^[0-9]$/) p++
        if (p == start) return 0
        frac = substr(s, start, p - start)
      }
      zone = substr(s, p)
      if (zone == "Z" || zone == "z") {
        offset = 0
      } else {
        if (length(zone) != 6 || substr(zone, 4, 1) != ":") return 0
        sign = substr(zone, 1, 1)
        if (sign != "+" && sign != "-") return 0
        if (substr(zone, 2, 2) !~ /^[0-9][0-9]$/ ||
            substr(zone, 5, 2) !~ /^[0-9][0-9]$/) return 0
        oh = substr(zone, 2, 2) + 0; om = substr(zone, 5, 2) + 0
        if (oh > 23 || om > 59) return 0
        offset = oh * 3600 + om * 60
        if (sign == "-") offset = -offset
      }
      days = y * 365 + leaps_before(y)
      for (m = 1; m < mo; m++) days += month_days(y, m)
      days += d - 1
      nanos = 0
      if (frac != "") nanos = substr(frac "000000000", 1, 9) + 0
      if (se == 60) { se = 59; nanos += 1000000000 }
      rfc_sec = days * 86400 + h * 3600 + mi * 60 + se - offset
      rfc_nano = nanos
      return 1
    }
    FILENAME != prev {
      prev = FILENAME
      n = n + 1
      id[n] = ""; spec[n] = ""; task[n] = ""; group[n] = ""; revision[n] = ""
      outcome[n] = ""; by[n] = ""; at[n] = ""; request[n] = ""
      file[n] = FILENAME; sub(/^.*\//, "", file[n])
      decision_schema[n] = 0; task_schema[n] = 0; group_schema[n] = 0; approved[n] = 0
      got_id[n] = 0; got_spec[n] = 0; got_task[n] = 0; got_group[n] = 0
      got_revision[n] = 0; got_outcome[n] = 0; got_by[n] = 0; got_at[n] = 0
      got_request[n] = 0
    }
    {
      if (!got_id[n] && index($0, "id:") == 1) {
        got_id[n] = 1; id[n] = substr($0, 4); sub(/^ */, "", id[n])
      }
      if (!got_spec[n] && index($0, "spec_id:") == 1) {
        got_spec[n] = 1; spec[n] = substr($0, 9); sub(/^ */, "", spec[n])
      }
      if (!got_task[n] && index($0, "task_id:") == 1) {
        got_task[n] = 1; task[n] = substr($0, 9); sub(/^ */, "", task[n])
      }
      if (!got_group[n] && index($0, "group_id:") == 1) {
        got_group[n] = 1; group[n] = substr($0, 10); sub(/^ */, "", group[n])
      }
      if (!got_revision[n] && index($0, "group_revision:") == 1) {
        got_revision[n] = 1; revision[n] = substr($0, 16); sub(/^ */, "", revision[n])
      }
      if (!got_outcome[n] && index($0, "outcome:") == 1) {
        got_outcome[n] = 1; outcome[n] = substr($0, 9); sub(/^ */, "", outcome[n])
      }
      if (!got_by[n] && index($0, "created_by:") == 1) {
        got_by[n] = 1; by[n] = substr($0, 12); sub(/^ */, "", by[n])
      }
      if (!got_at[n] && index($0, "created_at:") == 1) {
        got_at[n] = 1; at[n] = substr($0, 12); sub(/^ */, "", at[n])
      }
      if (!got_request[n] && index($0, "request_id:") == 1) {
        got_request[n] = 1; request[n] = substr($0, 12); sub(/^ */, "", request[n])
      }
      if (index($0, "schema: workflow-labs/decision@1") == 1) decision_schema[n] = 1
      if (index($0, "schema: workflow-labs/task-revision-request@1") == 1) task_schema[n] = 1
      if (index($0, "schema: workflow-labs/group-qa-decision@1") == 1) group_schema[n] = 1
      if (index($0, "outcome: approved") == 1) approved[n] = 1
    }
    END {
      for (i = 1; i <= n; i++) {
        if (decision_schema[i] && by[i] == "user") {
          s = spec[i]
          if (!(s in latest_spec) || (at[i] "") > (latest_spec[s] "")) latest_spec[s] = at[i]
        }
        if (!group_schema[i] || by[i] != "user" || id[i] == "" || group[i] == "" ||
            revision[i] !~ /^[0-9]+$/ || (revision[i] + 0) > 4294967295 || request[i] == "" ||
            !rfc3339(at[i])) continue
        if (outcome[i] != "confirmed" && outcome[i] != "revision_requested") continue
        instant_sec[i] = rfc_sec; instant_nano[i] = rfc_nano
        normalized_revision[i] = sprintf("%.0f", revision[i] + 0)
        key = group[i] SUBSEP normalized_revision[i]
        if (!(key in selected_group) || instant_sec[i] > latest_group_sec[key] ||
            (instant_sec[i] == latest_group_sec[key] && instant_nano[i] > latest_group_nano[key]) ||
            (instant_sec[i] == latest_group_sec[key] && instant_nano[i] == latest_group_nano[key] &&
             file[i] > file[selected_group[key]])) {
          latest_group_sec[key] = instant_sec[i]
          latest_group_nano[key] = instant_nano[i]
          selected_group[key] = i
        }
      }
      for (i = 1; i <= n; i++) {
        key = group[i] SUBSEP normalized_revision[i]
        if (selected_group[key] == i && outcome[i] == "revision_requested") {
          print "G\t" at[i] "\t" id[i] "\t" group[i] "\t" normalized_revision[i]
        }
        if (task_schema[i] && by[i] == "user" && id[i] != "" && task[i] != "" && at[i] != "") {
          print "T\t" at[i] "\t" id[i] "\t" task[i]
        }
        if (approved[i] && by[i] == "user" && id[i] != "") {
          s = spec[i]
          if ((s in latest_spec) && (latest_spec[s] "") > (at[i] "")) continue
          print "A\t" id[i] "\t" spec[i]
        }
      }
    }
  ' "$@"
}

# lease 디렉터리를 한 번 훑어 미만료 lease의 대상 id를 $active_leases에 모으고 그 수를
# $active_count에 담는다. 개발자 분기가 후보마다 이 디렉터리를 다시 훑던 자리다.
# 판정 시각은 훑기 앞에서 한 번 정하고 그 값을 쓴다. 만료 판정이 판정 시점 기준인 것은 그대로이고,
# 판정 순간이 하나로 모이는 것은 앱 이식본(role_eligibility.rs)이 이미 그렇게 하는 방식이다.
# 읽는 규칙과 만료 판정은 lease_blocks와 같은 것을 쓴다. 읽지 못한 파일은 표기를 얻지 못해
# 미만료로 세어지지 않는다.
scan_leases() {
  [ "$leases_scanned" -eq 0 ] || return 0
  leases_scanned=1
  now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  active_leases="$nl"
  active_count=0
  for l in "$leases"/*.yml; do
    [ -f "$l" ] || continue
    lid=${l##*/}
    lid=${lid%.yml}
    exp=$(sed -n 's/^expires_at: *//p' "$l" | head -1 | tr -d '"'\''')
    lease_unexpired "$exp" "$now" || continue
    active_leases="$active_leases$lid$nl"
    active_count=$((active_count + 1))
  done
}

# 훑기가 모은 목록에서 이 문서가 미만료 lease에 잡혔는지 본다. 파일 존재 검사를 먼저 하는 것은
# 목록 조회가 문자열 검사이기 때문이다 — 두 검사가 함께여야 원래의 파일 이름 대조와 같은 답이 된다.
lease_active() { # $1=대상 id
  [ -f "$leases/$1.yml" ] || return 1
  case "$active_leases" in *"$nl$1$nl"*) return 0 ;; esac
  return 1
}

# 작업 디렉터리를 한 번 훑어 문서 하나마다 레코드 하나를 낸다. 원래 본문은 후보 하나마다 상태·id·
# 선행·겹침을 따로 읽고 선행마다 디렉터리를 다시 훑었다. 그래서 비용이 작업 하나당 상수 개의
# 프로세스였고, 문서가 늘수록 데몬의 한도에 닿았다(SPEC-041). 읽는 규칙은 원래 본문의 grep·sed
# 그대로이므로 판정은 바뀌지 않는다.
#
# 레코드의 첫 줄은 M과 다섯 자리, 공백, 그리고 이 문서가 담은 id 값 중 선행 이름이 될 수 있는
# 것들이다. 다섯 자리는 차례로
#   후보 여부  — ^status: (todo|in_progress)가 있거나, definition_error가 아닌 blocked인가
#   충족 여부  — ^status: verified가 파일 아무 줄에나 있는가
#   선행 줄 수 — 0·1·2 (2는 두 줄 이상)
#   겹침 줄 수 — 0·1·2
#   단독 줄 수 — 0·1·2
# 다. 뒤따르는 줄은 있다고 적힌 것만 온다: 후보이면 첫 id·work_group_id·work_group_revision·
# source_decision_id·source_spec_id 값, 선행 줄 수가 1이면 그 값, 겹침 줄 수가 1이면 그 값,
# 단독 줄 수가 1이면 그 값이다.
# 네 metadata 값은 `0`(없음) 또는 `1`+값으로 실어 POSIX read가 빈 tab 필드를 접어도 자리가 바뀌지
# 않게 한다. 값은 모두 한 줄에서 읽은 것이라 개행을 담을 수 없으므로 한 줄에 담긴다.
#
# 두 가지 id 읽기가 여기 함께 있다. 후보의 id는 첫 id 줄 하나이고(sed ... | head -1), 선행 이름
# 해석은 파일 아무 줄이나 보며 값이 정확히 같은 것을 찾는다(grep -ls "^id: *<id>$" | head -1).
# 뒤엣것만 계약 문자 집합으로 거르는 것은 선행 이름이 그 집합이라 그 밖의 값이 조회될 수 없기
# 때문이고, 글롭 순서로 첫 문서가 이기는 것은 그 목록을 받는 쪽이 지킨다.
scan_tasks() { # $1=워크플로우 경로
  scan_dir="$1"tasks
  set --
  for f in "$scan_dir"/*.md; do
    [ -f "$f" ] && [ -r "$f" ] && set -- "$@" "$f"
  done
  [ "$#" -eq 0 ] && return 0
  awk '
    function trim(s) {
      sub(/^[[:space:]]*/, "", s)
      sub(/[[:space:]]*$/, "", s)
      return s
    }
    function token(s) { return s == "" ? "0" : "1" s }
    function emit(  i, line, cand) {
      if (!started) return
      cand = ordinary || (blocked && !definition_error)
      line = "M" cand sat depn scopen solon " "
      for (i = 1; i <= n_ids; i++) line = line id_list[i] " "
      print line
      if (cand) print first_id "\t" token(work_group) "\t" token(work_group_revision) \
        "\t" token(source_decision) "\t" token(source_spec)
      if (depn == 1) print dep_value
      if (scopen == 1) print scope_value
      if (solon == 1) print solo_value
    }
    FILENAME != prev {
      emit()
      prev = FILENAME
      started = 1
      files = files + 1
      ordinary = 0; blocked = 0; definition_error = 0
      sat = 0; depn = 0; scopen = 0; solon = 0
      got_id = 0; first_id = ""; work_group = ""; work_group_revision = ""
      source_decision = ""; source_spec = ""; got_work_group = 0; got_work_group_revision = 0
      got_source_decision = 0; got_source_spec = 0
      dep_value = ""; scope_value = ""; solo_value = ""; n_ids = 0
    }
    {
      if (index($0, "id:") == 1) {
        v = substr($0, 4)
        sub(/^ */, "", v)
        if (!got_id) { got_id = 1; first_id = v }
        if (v ~ /^[A-Za-z0-9_-]+$/ && !((files, v) in seen)) {
          seen[files, v] = 1
          n_ids = n_ids + 1
          id_list[n_ids] = v
        }
      }
      if ($0 ~ /^status: (todo|in_progress)/) ordinary = 1
      if ($0 ~ /^status: blocked/) blocked = 1
      if ($0 ~ /^blocked_kind: definition_error/) definition_error = 1
      if ($0 ~ /^status: verified/) sat = 1
      if (!got_work_group && index($0, "work_group_id:") == 1) {
        got_work_group = 1; work_group = substr($0, length("work_group_id:") + 1)
        sub(/^ */, "", work_group)
      }
      if (!got_work_group_revision && index($0, "work_group_revision:") == 1) {
        got_work_group_revision = 1
        work_group_revision = substr($0, length("work_group_revision:") + 1)
        sub(/^ */, "", work_group_revision)
      }
      if (!got_source_decision && index($0, "source_decision_id:") == 1) {
        got_source_decision = 1
        source_decision = substr($0, length("source_decision_id:") + 1)
        sub(/^ */, "", source_decision)
      }
      if (!got_source_spec && index($0, "source_spec_id:") == 1) {
        got_source_spec = 1
        source_spec = substr($0, length("source_spec_id:") + 1)
        sub(/^ */, "", source_spec)
      }
      if (index($0, "depends_on:") == 1) {
        if (depn == 0) { depn = 1; dep_value = trim(substr($0, 12)) } else depn = 2
      }
      if (index($0, "scope_files:") == 1) {
        if (scopen == 0) { scopen = 1; scope_value = trim(substr($0, 13)) } else scopen = 2
      }
      if (index($0, "solo_run:") == 1) {
        if (solon == 0) { solon = 1; solo_value = trim(substr($0, 10)) } else solon = 2
      }
    }
    END { emit() }
  ' "$@"
}

# 워크플로우 하나의 개발자 후보를 훑는다. $pass_mode가 verdict이면 개발자 분기의 판정을 그대로
# 내고, solo이면 선점과 무관한 제외 조건만 보아 단독 후보를 $solo_candidates에 모은다.
#
# 두 모드가 한 본문을 쓰는 것은 SPEC-065 C2가 단독 후보의 조건을 "지금 개발자 판정이 보는 제외
# 조건 중 선점과 무관한 것 **전부**"로 정하기 때문이다. 본문이 갈라지면 그 "전부"가 두 벌이 되고,
# 두 벌은 반드시 어긋난다. 모드가 가르는 것은 셋뿐이다 — solo는 자기 lease와 파일 겹침을 보지
# 않고(그 둘은 lease에 딸린 사실이라 시간이 지나면 반드시 풀린다), 단독 선언이 있는 작업만 보며,
# 제외 사유를 내지 않는다(그 훑기는 어느 역할의 답도 아니다).
developer_pass() { # $1=워크플로우 경로
  wf=$1
    active_group_rows="$nl"
    groups=$(scan_work_groups "$wf")
    while IFS='	' read -r gid status revision source source_spec source_qa; do
      [ "$status" = active ] || continue
      case "$revision" in ''|*[!0-9]*) continue ;; esac
      [ "$revision" -gt 0 ] || continue
      active_group_rows="$active_group_rows$gid	$revision	$source	$source_spec$nl"
    done <<DEVELOPER_GROUP_ROWS
$groups
DEVELOPER_GROUP_ROWS
    # Each row is the latest approved decision id and its specification. An id alone is not enough:
    # a task cannot relabel approval A as belonging to a different specification.
    approved_task_sources="$nl"
    decision_rows=$(scan_architect_decisions "$wf")
    while IFS='	' read -r kind first second third fourth; do
      [ "$kind" = A ] || continue
      [ -n "$first" ] || continue
      approved_task_sources="$approved_task_sources$first	$second$nl"
    done <<DEVELOPER_DECISION_ROWS
$decision_rows
DEVELOPER_DECISION_ROWS
    scanned=$(scan_tasks "$wf")
    known_ids=" "
    sat_ids=" "
    edge_map="$nl"
    lease_paths=" "
    lease_scope_bad=0
    rows=""
    # 훑기 결과를 한 번 읽어 선행 해석용 표와 후보 목록을 만든다. 후보 하나가 자기보다 뒤에 오는
    # 문서를 선행으로 가리킬 수 있으므로 표가 먼저 완성돼야 하고, 그래서 읽기가 두 번이다.
    # 후보를 보는 차례는 두 번째 읽기가 지키는 글롭 순서 그대로다.
    while IFS= read -r meta; do
      case "$meta" in M*) ;; *) continue ;; esac
      meta=${meta#M}
      flags=${meta%%" "*}
      ids=${meta#* }
      cand=${flags%????}
      sat=${flags#?}
      sat=${sat%???}
      depn=${flags#??}
      depn=${depn%??}
      scopen=${flags#???}
      scopen=${scopen%?}
      solon=${flags#????}
      tid=""
      task_group=""
      task_group_revision=""
      task_source_decision=""
      task_source_spec=""
      dep_value=""
      scope_value=""
      solo_value=""
      # 후보는 todo, in_progress, 그리고 definition_error가 아닌 blocked다. 죽은 세션이 남긴
      # in_progress 작업은 그 작업을 덮는 미만료 lease가 없으므로 아래 lease_active가 통과시키고,
      # 살아 있는 세션의 작업은 그 lease가 막는다(SPEC-035 R1). blocked 복구에도 lease·선행·겹침
      # 조건은 완전히 같다. definition_error는 위 아키텍트 분기의 대상이라 후보로 내지 않는다.
      if [ "$cand" = 1 ]; then
        IFS='	' read -r tid task_group_token task_group_revision_token task_source_decision_token task_source_spec_token
        case "$task_group_token" in 1*) task_group=${task_group_token#1} ;; esac
        case "$task_group_revision_token" in 1*) task_group_revision=${task_group_revision_token#1} ;; esac
        case "$task_source_decision_token" in 1*) task_source_decision=${task_source_decision_token#1} ;; esac
        case "$task_source_spec_token" in 1*) task_source_spec=${task_source_spec_token#1} ;; esac
      fi
      [ "$depn" = 1 ] && IFS= read -r dep_value
      [ "$scopen" = 1 ] && IFS= read -r scope_value
      [ "$solon" = 1 ] && IFS= read -r solo_value
      if deps_of "$depn" "$dep_value"; then deps=$parsed; deps_ok=1; else deps=""; deps_ok=0; fi
      if scope_of "$scopen" "$scope_value"; then scope=$parsed; scope_ok=1; else scope=""; scope_ok=0; fi
      if solo_run_of "$solon" "$solo_value"; then solo_ok=1; else solo_ok=0; fi
      for v in $ids; do
        # 같은 id를 담은 문서가 여럿이면 글롭 순서로 첫 문서가 이긴다. 원래 본문의
        # grep -ls ... | head -1이 고르던 문서가 그것이다.
        case "$known_ids" in *" $v "*) continue ;; esac
        known_ids="$known_ids$v "
        [ "$sat" = 1 ] && sat_ids="$sat_ids$v "
        [ -n "$deps" ] && edge_map="$edge_map$v $deps$nl"
        # 활성 lease가 잡은 문서를 처음 만나면 그 겹침 선언을 여기서 읽어 둔다. 원래 본문이
        # 후보마다 다시 읽던 값이고, 막는 쪽의 선언이 형식 오류이면 그 사실만 남는다.
        case "$active_leases" in
          *"$nl$v$nl"*)
            if [ "$scope_ok" -eq 1 ]; then
              for a in $scope; do
                case "$lease_paths" in *" $a "*) ;; *) lease_paths="$lease_paths$a " ;; esac
              done
            else
              lease_scope_bad=1
            fi
            ;;
        esac
      done
      [ "$cand" = 1 ] || continue
      [ -n "$tid" ] || continue
      rows="$rows$deps_ok$scope_ok$solo_ok|$deps|$scope|$tid|$task_group|$task_group_revision|$task_source_decision|$task_source_spec$nl"
    done <<SCAN
$scanned
SCAN
    while IFS= read -r row; do
      case "$row" in ???"|"*) ;; *) continue ;; esac
      flags=${row%%"|"*}
      rest=${row#*"|"}
      deps=${rest%%"|"*}
      rest=${rest#*"|"}
      scope=${rest%%"|"*}
      rest=${rest#*"|"}
      tid=${rest%%"|"*}
      rest=${rest#*"|"}
      task_group=${rest%%"|"*}
      task_group_revision=${rest#*"|"}
      task_source_decision=${task_group_revision#*"|"}
      task_group_revision=${task_group_revision%%"|"*}
      task_source_spec=${task_source_decision#*"|"}
      task_source_decision=${task_source_decision%%"|"*}
      deps_ok=${flags%??}
      scope_ok=${flags#?}
      scope_ok=${scope_ok%?}
      solo_ok=${flags#??}
      group_available=0
      group_source_decision=""
      group_source_spec=""
      case "$task_group_revision" in ''|*[!0-9]*) ;; *)
        if [ "$task_group_revision" -gt 0 ]; then
          while IFS='	' read -r gid group_revision group_source group_spec; do
            [ "$gid" = "$task_group" ] || continue
            if [ "$task_group_revision" -le "$group_revision" ]; then
              origin_available=0
              if [ -n "$task_source_decision" ] && [ -n "$task_source_spec" ] && \
                 [ "$task_source_decision" = "$group_source" ] && \
                 [ "$task_source_spec" = "$group_spec" ]; then
                origin_available=1
              else
                legacy_decision_ok=0
                legacy_spec_ok=0
                if [ -z "$task_source_decision" ]; then
                  case "$group_source" in LEGACY-*) legacy_decision_ok=1 ;; esac
                else
                  case "$task_source_decision:$group_source" in
                    LEGACY-*:"$task_source_decision") legacy_decision_ok=1 ;;
                  esac
                fi
                if [ -z "$task_source_spec" ] || [ "$task_source_spec" = "$group_spec" ]; then
                  legacy_spec_ok=1
                fi
                case "$task_group:$group_source" in GROUP-*-LEGACY:LEGACY-*) ;; *) legacy_decision_ok=0 ;; esac
                [ "$legacy_decision_ok" -eq 1 ] && [ "$legacy_spec_ok" -eq 1 ] && origin_available=1
              fi
              if [ "$origin_available" -eq 1 ]; then
                group_available=1
                group_source_decision=$group_source
                group_source_spec=$group_spec
              fi
            fi
            break
          done <<ACTIVE_GROUP_ROWS
$active_group_rows
ACTIVE_GROUP_ROWS
        fi
        ;;
      esac
      if [ "$pass_mode" = verdict ]; then
        lease_active "$tid" && { note_candidate leased "$tid"; continue; }
      else
        [ "$solo_ok" -eq 1 ] || continue
      fi
      # 선행 관련 제외는 사유가 하나다. 선언을 읽지 못한 것과 선행이 아직 끝나지 않은 것과 고리가
      # 있는 것은 세션이 할 일이 같다 — 그 선언을 보고 앞의 작업을 먼저 끝내는 것이다.
      [ "$deps_ok" -eq 1 ] || { pass_reject dependencies-unsatisfied "$tid"; continue; }
      ok=1
      # 선행 셋이 모두 참이어야 자격이고 셋 중 어느 것도 다른 것을 바꾸지 않으므로, 보는 차례는
      # 답을 바꾸지 않는다. 값싼 둘을 먼저 보고 순환 탐색은 그 둘을 통과한 선언에만 돈다.
      for dep in $deps; do
        case "$known_ids" in *" $dep "*) ;; *) ok=0; break ;; esac
        case "$sat_ids" in *" $dep "*) ;; *) ok=0; break ;; esac
      done
      [ "$ok" -eq 1 ] || { pass_reject dependencies-unsatisfied "$tid"; continue; }
      for dep in $deps; do
        reaches "$dep" "$tid" && { ok=0; break; }
      done
      [ "$ok" -eq 1 ] || { pass_reject dependencies-unsatisfied "$tid"; continue; }
      if [ "$pass_mode" = verdict ]; then
        overlap_blocks "$scope_ok" "$scope" && { note_candidate overlap "$tid"; continue; }
      fi
      # 통합 대기는 lease·선행·겹침 뒤, 원천 결정과 그룹 판정 앞에서 본다. 앞의 셋은 통합 대기와
      # 무관하게 성립하는 조건이고, 통합을 기다리는 작업은 이미 승인된 원천에서 나와 착수까지 간
      # 작업이라 뒤의 두 판정까지 갈 이유가 없다.
      integration_waiting_blocks "$tid" && { pass_reject integration-waiting "$tid"; continue; }
      source_approved=0
      if [ -n "$task_source_decision" ] && [ -n "$task_source_spec" ]; then
        case "$approved_task_sources" in
          *"$nl$task_source_decision	$task_source_spec$nl"*) source_approved=1 ;;
        esac
      fi
      if [ "$source_approved" -eq 0 ] && [ "$group_available" -eq 1 ]; then
        case "$task_group:$group_source_decision" in
          GROUP-*-LEGACY:LEGACY-*) source_approved=1 ;;
        esac
      fi
      [ "$source_approved" -eq 1 ] || { pass_reject source-decision-not-approved "$tid"; continue; }
      [ "$group_available" -eq 1 ] || { pass_reject work-group-unavailable "$tid"; continue; }
      if [ "$pass_mode" = solo ]; then
        solo_candidates="$solo_candidates$tid$nl"
        continue
      fi
      note_target "$tid"
    done <<ROWS
$rows
ROWS
}

# 후보를 제외한다. 단독 후보를 모으는 훑기에서는 사유를 내지 않는다 — 그 훑기의 결과는 어느 역할의
# 답도 아니고, 사유 목록은 판정한 후보를 판정한 차례대로 담는 자리이기 때문이다.
pass_reject() { # $1=제외 사유 코드 $2=후보 id
  [ "$pass_mode" = solo ] || note_candidate "$1" "$2"
  return 0
}

# 프로젝트 전체의 단독 점유 상태를 정한다(SPEC-065 R3). 단독 후보 집합과 대표 작업은 워크플로우
# 하나가 아니라 프로젝트 하나의 값이므로, 역할 분기에 들어가기 전에 한 번만 정한다.
#
# 선언이 하나도 없는 프로젝트는 grep 한 번에서 끝난다. 그때 이 함수는 아무 값도 세우지 않으므로
# 세 역할의 판정이 이 절이 생기기 전과 한 글자도 다르지 않다(SPEC-065 C6).
collect_solo_state() {
  grep -qs '^solo_run:' .workflow/*/tasks/*.md || return 0
  scan_leases
  solo_candidates="$nl"
  pass_mode=solo
  for wf in .workflow/*/; do
    [ -d "${wf}tasks" ] || continue
    developer_pass "$wf"
  done
  pass_mode=verdict
  # 대표 작업은 판정 차례가 가장 앞선 원소다. 훑기가 워크플로우 글롭 순서로 돌고 그 안에서 파일
  # 이름 순서로 돌므로, 모인 차례의 첫 원소가 그것이다.
  solo_representative=${solo_candidates#"$nl"}
  solo_representative=${solo_representative%%"$nl"*}
  [ -n "$solo_representative" ] || return 0
  # 대표 작업 자신을 잡은 lease는 세지 않는다. 대표가 마지막 자리에 도달했다면 그 lease는 이미 앞의
  # 검사가 걸렀으므로, 남은 수가 곧 "기기가 아직 조용하지 않다"이다.
  solo_other_leases=$active_count
  case "$active_leases" in
    *"$nl$solo_representative$nl"*) solo_other_leases=$((solo_other_leases - 1)) ;;
  esac
  return 0
}

collect_solo_state

case "$role" in
planner)
  for wf in .workflow/*/; do
    # 두 조회가 이 목록 하나를 본다. 워크플로우마다 specs/를 한 번만 훑는다.
    nondraft_refs=$(scan_nondraft_refs "$wf")
    # (가) 미처리 아이디어. 비-draft 기획서가 참조하지 않고 선점되지 않은 것.
    if [ -d "${wf}ideas" ]; then
      ideas=$(scan_ideas "$wf")
      while IFS= read -r id; do
        [ -n "$id" ] || continue
        # 옛 계약의 기획서는 원천을 source_idea:로 적었다. 그 문서가 참조로 보이지 않으면 이미
        # 기획된 아이디어가 다시 열려 기획자가 중복 배정된다(2026-08-12 mech-arena 실측). 두 키를
        # 모두 참조로 인정한다. source_idea:는 source_idea_id: 줄과 부분 일치하지 않는다.
        case "$nondraft_refs" in *"source_idea_id:$id"* | *"source_idea:$id"*) note_candidate spec-exists "$id"; continue ;; esac
        lease_blocks "$id" && { note_candidate leased "$id"; continue; }
        note_target "$id"
      done <<IDEAS
$ideas
IDEAS
    fi
    # (나) 후속 기획서가 없는 수정 요청 결정. 아이디어가 없어도 이 루프는 돈다.
    [ -d "${wf}decisions" ] || continue
    # 스키마와 spec_id가 QA 결정을 걸러낸다. QA 결정도 revision_requested를 쓰지만 task_id를 갖고
    # spec_id가 없다. 그 둘이 scan_decisions의 strict 인자다. created_by 필터도 그 안에 있다 —
    # 앱은 created_by가 user인 결정만 세고, 값 전체를 비교해야 위임 대리 결정의 user-delegate가
    # 걸러진다. 최신 검사도 같은 훑기에서 끝난다.
    revisions=$(scan_decisions "$wf" revision_requested 1)
    while IFS= read -r did; do
      IFS= read -r spec || spec=""
      [ -n "$did" ] || continue
      # 판정 키는 결정 id다. 기획서 id로 보면 한 기획서가 여러 번 반려됐을 때 구분되지 않는다.
      case "$nondraft_refs" in *"source_decision_id:$did"*) note_candidate follow-up-exists "$did"; continue ;; esac
      lease_blocks "$did" && { note_candidate leased "$did"; continue; }
      note_target "$did"
    done <<REVISIONS
$revisions
REVISIONS
  done
  ;;
architect)
  # 그룹 표는 QA 반려 처리 여부, 중단된 preparing 복구, 승인 분해 여부가 함께 쓴다.
  architect_group_rows=""
  group_revision_rows=""
  revision_rows=""
  approval_rows=""
  configuration_rows=""
  for wf in .workflow/*/; do
    conf_rows=$(scan_configuration_errors "$wf")
    while IFS='	' read -r cgid csource cqa; do
      [ -n "$cgid" ] || continue
      configuration_rows="$configuration_rows$cgid	$csource	$cqa$nl"
    done <<CONFIGURATION_SCAN_ROWS
$conf_rows
CONFIGURATION_SCAN_ROWS
    groups=$(scan_work_groups "$wf")
    while IFS='	' read -r gid status revision source source_spec source_qa; do
      [ -n "$gid" ] && [ -n "$status" ] && [ -n "$revision" ] && [ -n "$source" ] || continue
      architect_group_rows="$architect_group_rows$wf	$gid	$status	$revision	$source	$source_spec	$source_qa$nl"
    done <<GROUP_ROWS
$groups
GROUP_ROWS
    decision_rows=$(scan_architect_decisions "$wf")
    while IFS='	' read -r kind first second third fourth; do
      case "$kind" in
        G)
          [ -n "$first" ] && [ -n "$second" ] && [ -n "$third" ] && [ -n "$fourth" ] || continue
          group_revision_rows="$group_revision_rows$first	$second	$wf	$third	$fourth$nl"
          ;;
        T)
          [ -n "$first" ] && [ -n "$second" ] && [ -n "$third" ] || continue
          revision_rows="$revision_rows$first	$second	$third	$wf$nl"
          ;;
        A)
          [ -n "$first" ] || continue
          approval_rows="$approval_rows$wf	$first	$second$nl"
          ;;
      esac
    done <<ARCHITECT_DECISION_ROWS
$decision_rows
ARCHITECT_DECISION_ROWS
  done

  # 사용자 승인 단위인 그룹 QA 반려가 내부 작업 정의 수정보다 먼저다. 현재 revision과 일치하고
  # 현재 revision의 최신 반려 결정만 후보가 된다. source_qa_decision_id는 이전 revision 반려의
  # 계보이고, 같은 revision에 잘못 남은 값이 현재 반려를 숨기지는 않는다.
  ordered_group_revision_rows=$(printf '%s' "$group_revision_rows" | LC_ALL=C sort)
  while IFS='	' read -r created rid wf gid revision; do
    [ -n "$created" ] && [ -n "$rid" ] && [ -n "$gid" ] && [ -n "$revision" ] && [ -n "$wf" ] || continue
    group_found=0
    while IFS='	' read -r gwf current_gid status current_revision source source_spec source_qa; do
      [ "$gwf" = "$wf" ] && [ "$current_gid" = "$gid" ] && [ "$current_revision" = "$revision" ] || continue
      group_found=1
      break
    done <<ARCHITECT_GROUP_ROWS
$architect_group_rows
ARCHITECT_GROUP_ROWS
    [ "$group_found" -eq 1 ] || continue
    if lease_blocks "$rid" || lease_blocks "$gid"; then note_candidate leased "$rid"; continue; fi
    note_target "$rid" group_qa_revision
  done <<ORDERED_GROUP_REVISION_ROWS
$ordered_group_revision_rows
ORDERED_GROUP_REVISION_ROWS

  # 구성 확인 필요로 판정된 기능은 사용자 확인 반려 다음, 작업 정의 수정 요청 앞이다. 문서가
  # 성립하지 않는 기능은 그 기능에서 나온 작업 정의를 고치는 일보다 앞선다. 선점은 중단된
  # preparing 복구와 같은 세 id를 본다.
  while IFS='	' read -r cgid csource cqa; do
    [ -n "$cgid" ] || continue
    if lease_blocks "$cgid" || { [ -n "$csource" ] && lease_blocks "$csource"; } ||
       { [ -n "$cqa" ] && lease_blocks "$cqa"; }; then
      note_candidate leased "$cgid"
      continue
    fi
    note_target "$cgid" configuration_error
  done <<CONFIGURATION_ROWS
$configuration_rows
CONFIGURATION_ROWS

  # 작업 정의 수정 요청은 워크플로우 경계를 넘어 모으고 생성 시각으로 정렬한다.
  ordered_revision_rows=$(printf '%s' "$revision_rows" | LC_ALL=C sort)
  revision_task_ids="$nl"
  while IFS='	' read -r created rid tid wf; do
    [ -n "$created" ] && [ -n "$rid" ] && [ -n "$tid" ] && [ -n "$wf" ] || continue
    task_file=""
    for f in "${wf}tasks"/*.md; do
      [ -f "$f" ] && [ -r "$f" ] || continue
      if grep -qs "^id: *$tid$" "$f"; then task_file=$f; break; fi
    done
    [ -n "$task_file" ] || continue
    grep -Eqs '^status: (todo|blocked)$' "$task_file" || continue
    grep -qs "^revision_request_id: *$rid$" "$task_file" && continue
    case "$revision_task_ids" in *"$nl$tid$nl"*) ;; *) revision_task_ids="$revision_task_ids$tid$nl" ;; esac
    if lease_blocks "$rid" || lease_blocks "$tid"; then note_candidate leased "$rid"; continue; fi
    note_target "$rid" task_revision_request
  done <<ORDERED_REVISION_ROWS
$ordered_revision_rows
ORDERED_REVISION_ROWS
  # 이전 앱이 남긴 사용자 수정 요청 다음에는 task 문서가 이미 기록한 definition_error를 사용자
  # 조작 없이 바로 아키텍트 작업으로 연다.
  direct_rows=""
  for wf in .workflow/*/; do
    task_scan=$(scan_refs "${wf}tasks" "source_decision_id:")
    while IFS= read -r task_row; do
      case "$task_row" in
        "__WF_DIRECT__	"*) direct_rows="$direct_rows$wf	${task_row#*	}$nl" ;;
      esac
    done <<TASK_SCAN
$task_scan
TASK_SCAN
  done
  while IFS='	' read -r wf tid; do
    [ -n "$wf" ] && [ -n "$tid" ] || continue
    case "$revision_task_ids" in *"$nl$tid$nl"*) continue ;; esac
    lease_blocks "$tid" && { note_candidate leased "$tid"; continue; }
    note_target "$tid" blocked_task
  done <<DIRECT_ROWS
$direct_rows
DIRECT_ROWS

  # 그룹 작성 중 lease가 끊긴 경우 새 승인을 열기 전에 기존 문서를 이어 쓴다. 최초 분해 세션은
  # 승인 결정 id, 재작업 세션은 QA 결정 id로 선점할 수 있으므로 세 id를 모두 활성 여부로 본다.
  while IFS='	' read -r wf gid status revision source source_spec source_qa; do
    [ "$status" = preparing ] || continue
    if lease_blocks "$gid" || lease_blocks "$source" || { [ -n "$source_qa" ] && lease_blocks "$source_qa"; };
    then
      note_candidate leased "$gid"
      continue
    fi
    note_target "$gid" work_group
  done <<PREPARING_GROUP_ROWS
$architect_group_rows
PREPARING_GROUP_ROWS

  # 아키텍트 후보는 스키마 줄도 spec_id도 요구하지 않는다. created_by 필터와 최신 검사는 위의
  # 결정 단일 훑기에서 끝났다.
  while IFS='	' read -r wf did spec; do
      [ -n "$wf" ] && [ -n "$did" ] || continue
      decomposed=0
      while IFS='	' read -r gwf gid status revision source source_spec source_qa; do
        [ "$gwf" = "$wf" ] && [ "$source" = "$did" ] || continue
        decomposed=1
        break
      done <<ARCHITECT_GROUP_ROWS
$architect_group_rows
ARCHITECT_GROUP_ROWS
      [ "$decomposed" -eq 0 ] || { note_candidate decomposed "$did"; continue; }
      # 분해 중인 세션의 lease는 결정 id로 잡힌다. 이 검사가 없으면 세션이 도는 동안에도 같은
      # 결정이 대상으로 계속 나가, 화면이 중복 배정처럼 보이고 자동 배정이 헛 시도를 만든다.
      if lease_blocks "$did"; then note_candidate leased "$did"; continue; fi
      if [ -n "$spec" ] && lease_blocks "$spec"; then note_candidate spec-leased "$did"; continue; fi
      note_target "$did" spec_approval
  done <<APPROVAL_ROWS
$approval_rows
APPROVAL_ROWS
  ;;
developer)
  scan_leases
  for wf in .workflow/*/; do
    [ -d "${wf}tasks" ] || continue
    developer_pass "$wf"
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
/// 본문은 BOM으로 시작한다. Windows PowerShell 5.1은 BOM 없는 `.ps1`을 시스템 코드페이지로 읽어,
/// 비ASCII 문자가 들어가면 본문이 깨지고 문자열 리터럴 안이었다면 판정까지 바뀐다(2026-08-15 실측:
/// 예약 헬퍼의 한국어 문자열이 따옴표 문자로 오독되어 스크립트 전체가 구문 오류). BOM을 본문에 두는
/// 이유는 설치 판정이 본문과 파일을 그대로 비교하기 때문이며, 세 `.ps1` 관리 자산이 같은 규약을 쓴다.
const CONDITION_SCRIPT_PS1: &str = concat!(
    "\u{feff}",
    r#"# LLM Workflow heartbeat condition check.
# managed_by: workflow-labs
# condition_script_version: 24
# Exits 0 when the role has work, 1 when it does not, 2 for an unknown role.
# The verdict reason goes to the first stdout line as a single ASCII code.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File .workflow/rules/wf-eligible.ps1 <role> [--json]
# Run from the project root. This is the Windows twin of wf-eligible.sh and must reach the same
# verdict for every input. The body opens with a UTF-8 BOM so PowerShell 5.1 reads UTF-8.
param([string]$Role = '', [string]$Output = '')

$ErrorActionPreference = 'Stop'

$leases = '.workflow/.runtime/leases'
$isolation = '.workflow/.runtime/isolation'
$lineCache = @{}
# The shared base is read once, and only after a candidate turns out to carry an integration
# waiting record. Until then these four mean "not looked at yet".
$script:sharedScanned = $false
$script:sharedOk = $false
$script:sharedDirty = $false
$script:sharedHead = ''
# Windows PowerShell treats a token beginning with `--` as an unbound named
# argument instead of the second positional string on some runner versions.
# Keep the shared CLI spelling and accept it from either binding path.
$script:machineOutput = ($Output -ceq '--json') -or ($args -ccontains '--json')
$script:machineTarget = $null
$script:machineTargetKind = $null
$script:machineCandidates = @()
# The solo run state of the whole project (SPEC-065 R2, R3). While the representative is $null this
# verdict is exactly what it was before the solo clause existed.
$script:soloRepresentative = $null
$script:soloOtherLeases = $false

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
# The fixed-width UTC stamp judgement, in one place. This is the twin of the shell
# "lease_unexpired": a lease expiry and a provider hold resume time carry the same stamp form, so
# both callers share this one comparison instead of parsing dates in two places. A stamp outside the
# form is not a time at all and never holds anything.
function Test-StampAhead([string]$Stamp) {
  $Stamp = $Stamp.Replace([string][char]34, '').Replace([string][char]39, '')
  if ($Stamp -cnotmatch '^.{4}-.{2}-.{2}T.{2}:.{2}:.{2}Z$') { return $false }
  $now = [System.DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ',
    [System.Globalization.CultureInfo]::InvariantCulture)
  return ([string]::CompareOrdinal($Stamp, $now) -gt 0)
}

function Test-Leased([string]$Id) {
  $path = Join-Path $leases ($Id + '.yml')
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return $false }
  return (Test-StampAhead (Get-Value (Get-Lines $path) 'expires_at'))
}

# True while the provider this role uses is waiting out a usage limit (SPEC-071 R-05, R-09). The
# hold record is per machine, so it sits under the user home outside the project, and the map that
# ties a role to a provider sits inside the project.
# A failed read is not a hold (R-23). No home, no map, no line for this role, a provider name outside
# the fixed character set, no record, or a resume time outside the stamp form all answer false, and
# the verdict is then exactly what it is today. Turning an unread file into a hold would let one I/O
# error stop every assignment.
# This function only reads. It never creates, edits, or removes the record or the map (R-21, R-22).
function Test-ProviderLimitWaiting([string]$RoleName) {
  $profileHome = $env:USERPROFILE
  if ([string]::IsNullOrEmpty($profileHome)) { return $false }
  $map = '.workflow/.runtime/role-providers.yml'
  if (-not (Test-Path -LiteralPath $map -PathType Leaf)) { return $false }
  $provider = Get-Value (Get-Lines $map) $RoleName
  # The name becomes a file name, so a value outside the set builds no path.
  if ($provider -cnotmatch '^[A-Za-z0-9_-]+$') { return $false }
  $record = Join-Path (Join-Path (Join-Path $profileHome '.workflow-labs') 'provider-holds') `
    ($provider + '.yml')
  if (-not (Test-Path -LiteralPath $record -PathType Leaf)) { return $false }
  return (Test-StampAhead (Get-Value (Get-Lines $record) 'resume_at'))
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

# Reads the one-line scope declaration. Ok=$false means the key is absent or not in contract form,
# and that task cannot be compared. Two things differ from Get-Declaration: an absent key is not ok
# here, and the token set carries the "." and "/" a path needs. A path with a space is malformed
# because the shell twin's word splitting would break it apart.
function Get-Scope([string[]]$Lines) {
  $found = @()
  foreach ($line in $Lines) {
    if ($line.StartsWith('scope_files:', [System.StringComparison]::Ordinal)) { $found += $line }
  }
  if ($found.Count -ne 1) { return @{ Ok = $false; Files = @() } }
  $value = ($found[0].Substring('scope_files:'.Length)).Trim()
  if ($value.Length -lt 2) { return @{ Ok = $false; Files = @() } }
  if (-not $value.StartsWith('[', [System.StringComparison]::Ordinal)) { return @{ Ok = $false; Files = @() } }
  if (-not $value.EndsWith(']', [System.StringComparison]::Ordinal)) { return @{ Ok = $false; Files = @() } }
  $inner = $value.Substring(1, $value.Length - 2)
  $tokens = @($inner -split ',' | ForEach-Object { $_.Trim() })
  $named = @($tokens | Where-Object { $_.Length -gt 0 })
  if ($named.Count -eq 0) { return @{ Ok = $true; Files = @() } }
  foreach ($token in $tokens) {
    if ($token -cnotmatch '^[A-Za-z0-9_./-]+$') { return @{ Ok = $false; Files = @() } }
  }
  return @{ Ok = $true; Files = $tokens }
}

# Reads the one-line solo run declaration. True means the document reads as a solo declaration.
# "true" is the declaration, and an absent key and "false" are not declaring one. Every other value
# is an unreadable declaration and is treated as solo: two declaration lines, an empty value, a
# quoted value, and a value spread over several lines all land there. Leaning an unreadable verdict
# to the safe side is the principle Get-Scope already uses.
function Get-SoloRun([string[]]$Lines) {
  $found = @()
  foreach ($line in $Lines) {
    if ($line.StartsWith('solo_run:', [System.StringComparison]::Ordinal)) { $found += $line }
  }
  if ($found.Count -eq 0) { return $false }
  if ($found.Count -gt 1) { return $true }
  $value = ($found[0].Substring('solo_run:'.Length)).Trim()
  if ($value -ceq 'true') { return $true }
  if ($value -ceq 'false') { return $false }
  return $true
}

# Does an unexpired lease on another document block this task from being started? A lease on the
# task itself is not read here: that is a self claim, and Test-Leased already removed it.
# A missing or malformed declaration on either side blocks, because overlap is symmetric and an
# unreadable verdict leans to the safe side. A lease whose target is not a task document has
# nothing to compare against, so it does not block. Paths compare as whole strings, case sensitive.
# The task's own declaration is read on the first blocking lease: with no lease claimed, this
# function opens no file.
function Test-Overlapped([string]$Root, [string]$Id, [string[]]$Lines) {
  if (-not (Test-Path -LiteralPath $leases -PathType Container)) { return $false }
  $mine = $null
  foreach ($file in @(Get-ChildItem -LiteralPath $leases -Filter '*.yml' -File -ErrorAction SilentlyContinue |
    Sort-Object -Property Name -CaseSensitive)) {
    $target = $file.BaseName
    if ($target -ceq $Id) { continue }
    if (-not (Test-Leased $target)) { continue }
    if ($null -eq $mine) { $mine = Get-Scope $Lines }
    if (-not $mine.Ok) { return $true }
    $other = Find-TaskFile $Root $target
    if ($other.Length -eq 0) { continue }
    $theirs = Get-Scope (Get-Lines $other)
    if (-not $theirs.Ok) { return $true }
    foreach ($a in $mine.Files) {
      foreach ($b in $theirs.Files) {
        if ($a -ceq $b) { return $true }
      }
    }
  }
  return $false
}

# Runs one git command and returns its stdout, or $null when it could not be run or exited
# non-zero. An empty string means the command succeeded and printed nothing, which is a different
# fact from a failed lookup, so the two never collapse into one value. The preference is lowered
# for the call because a native command writing to stderr must not become a terminating error.
function Invoke-GitRead([string[]]$Arguments) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = & git @Arguments 2>$null
    if ($LASTEXITCODE -ne 0) { return $null }
    return [string]::Join("`n", @($output))
  } catch {
    return $null
  } finally {
    $ErrorActionPreference = $previous
  }
}

# Reads the shared base commit and working tree state once. Called only after a candidate turns
# out to carry an integration waiting record, so a project without one never invokes git.
function Update-SharedBase() {
  if ($script:sharedScanned) { return }
  $script:sharedScanned = $true
  $head = Invoke-GitRead @('rev-parse', 'HEAD')
  if ($null -eq $head) { return }
  $head = $head.Trim()
  if ($head.Length -eq 0) { return }
  # Untracked files are not counted. A file the user newly created is not what integration touches.
  $status = Invoke-GitRead @('status', '--porcelain', '--untracked-files=no')
  if ($null -eq $status) { return }
  $script:sharedHead = $head
  $script:sharedDirty = ($status.Trim().Length -gt 0)
  $script:sharedOk = $true
}

# Is this task waiting for integration after its isolated checks passed? It blocks only while the
# reason to wait still holds: tracked uncommitted or staged changes remain and the record's base
# commit is still the shared base. A cleaned workspace or an advanced base makes it a candidate
# again. A missing, unreadable, differently staged, or base-less record does not block. A failed
# git lookup keeps it blocked, because nothing proved the wait is over, and reopening it without
# that proof leaves exactly the repeated startup this verdict exists to stop.
function Test-IntegrationWaiting([string]$Id) {
  $path = Join-Path $isolation ($Id + '.yml')
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return $false }
  $lines = Get-Lines $path
  $step = (Get-Value $lines 'step').Replace([string][char]34, '').Replace([string][char]39, '')
  if ($step -cne 'integration_waiting') { return $false }
  $base = (Get-Value $lines 'base_commit').Replace([string][char]34, '').Replace([string][char]39, '')
  if ($base.Length -eq 0) { return $false }
  Update-SharedBase
  if (-not $script:sharedOk) { return $true }
  if (-not $script:sharedDirty) { return $false }
  return ($base -ceq $script:sharedHead)
}

# Mirrors "grep -ls '^id: *<id>$' <workflow>/tasks/*.md | head -1".
function Find-TaskFile([string]$Root, [string]$Id) {
  $pattern = '^id: *' + [regex]::Escape($Id) + '$'
  foreach ($path in (Get-Documents $Root 'tasks')) {
    if (Test-Match (Get-Lines $path) $pattern) { return $path }
  }
  return ''
}

# Only verified counts as satisfied. Any other state, including one outside the contract, is
# unsatisfied.
function Test-DependencySatisfied([string]$Path) {
  $lines = Get-Lines $Path
  return (Test-Match $lines '^status: verified')
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

# Are this task's dependency declarations satisfied? An unreadable declaration, an unfinished
# predecessor and a cycle are all unsatisfied, because they leave the session the same thing to do.
# The developer branch and the solo scan call this one function so the rule cannot become two.
function Test-DependenciesSatisfied([string]$Root, [string]$Id, [string[]]$Lines) {
  $declaration = Get-Declaration $Lines
  if (-not $declaration.Ok) { return $false }
  foreach ($dep in $declaration.Ids) {
    $file = Find-TaskFile $Root $dep
    if ($file.Length -eq 0) { return $false }
    if (Test-Reaches $Root $dep $Id) { return $false }
    if (-not (Test-DependencySatisfied $file)) { return $false }
  }
  return $true
}

# Reads one task's source decision and work group verdict together, because the migration exception
# feeds both. The developer branch and the solo scan share it for the same reason as above: the solo
# candidate set is defined as every exclusion other than the claim ones, and a second copy of that
# set would drift from the first.
function Get-TaskOrigin([string[]]$Lines, $Groups, $ApprovedSources) {
  $taskGroup = Get-Value $Lines 'work_group_id'
  $taskSourceDecision = Get-Value $Lines 'source_decision_id'
  $taskSourceSpec = Get-Value $Lines 'source_spec_id'
  $taskRevision = 0
  $revisionText = Get-Value $Lines 'work_group_revision'
  $revisionValid = [int]::TryParse($revisionText, [ref]$taskRevision) -and $taskRevision -gt 0
  $groupAvailable = $false
  $matchedGroup = $null
  if ($revisionValid -and $taskGroup.Length -gt 0) {
    foreach ($group in $Groups) {
      if ($group.Id -cne $taskGroup -or $group.Status -cne 'active') { continue }
      $matchedGroup = $group
      $groupRevision = 0
      $revisionAvailable = [int]::TryParse($group.Revision, [ref]$groupRevision) -and
        $groupRevision -ge $taskRevision
      $nativeOrigin = $taskSourceDecision.Length -gt 0 -and
        $taskSourceSpec.Length -gt 0 -and
        $taskSourceDecision -ceq $group.SourceDecision -and
        $taskSourceSpec -ceq $group.SourceSpec
      $legacyDecision = $taskSourceDecision.Length -eq 0 -or
        ($taskSourceDecision -clike 'LEGACY-*' -and
          $taskSourceDecision -ceq $group.SourceDecision)
      $legacySpec = $taskSourceSpec.Length -eq 0 -or $taskSourceSpec -ceq $group.SourceSpec
      $legacyOrigin = $taskGroup -clike 'GROUP-*-LEGACY' -and
        $group.SourceDecision -clike 'LEGACY-*' -and $legacyDecision -and $legacySpec
      if ($revisionAvailable -and ($nativeOrigin -or $legacyOrigin)) {
        $groupAvailable = $true
      }
      break
    }
  }
  $sourceApproved = $false
  if ($taskSourceDecision.Length -gt 0) {
    foreach ($approval in $ApprovedSources) {
      if ($approval.Id -ceq $taskSourceDecision -and
          $approval.Spec -ceq $taskSourceSpec) { $sourceApproved = $true; break }
    }
  }
  $legacyTaskSource = $taskSourceDecision.Length -eq 0 -or
    ($taskSourceDecision -clike 'LEGACY-*' -and $null -ne $matchedGroup -and
      $taskSourceDecision -ceq $matchedGroup.SourceDecision)
  if (-not $sourceApproved -and $groupAvailable -and
      $taskGroup -clike 'GROUP-*-LEGACY' -and $null -ne $matchedGroup -and
      $matchedGroup.SourceDecision -clike 'LEGACY-*' -and $legacyTaskSource) {
    # v1 migration cannot forge a user approval. Only its deterministic legacy group carries
    # the synthetic source; every native v2 task still needs a real latest approval above.
    $sourceApproved = $true
  }
  return @{ SourceApproved = $sourceApproved; GroupAvailable = $groupAvailable }
}

# The next two functions gather the verdict material. One branch reads each directory of one
# workflow exactly once. Reading the same directory again per candidate makes the cost a product of
# the collection sizes, and the daemon runs out of time as the documents grow (SPEC-033). The
# verdict rules do not change: the same answer comes out for less. The line cache above is not
# enough on its own, because the old shape still compared every line again for every candidate.

# Collects every line carrying the key from one document kind, with "<key> *" normalized to
# "<key>", and joins them. The candidate lookup is then a plain ordinal substring test, which is
# what the shell twin does with case. The original regex "<key> *<id>" is "colon, zero or more
# spaces, id", so the normalized substring test answers the same. The unanchored match that reads
# anywhere in a line stays, and so does the partial match where DECISION-1 hits a line naming
# DECISION-12. No match can span a newline: normalization only removes spaces inside one line and
# the needle carries no newline.
function Get-References([string]$Root, [string]$Kind, [string]$Key) {
  $collected = @()
  $pattern = [regex]::Escape($Key) + ' +'
  foreach ($path in (Get-Documents $Root $Kind)) {
    foreach ($line in (Get-Lines $path)) {
      if ($line.IndexOf($Key, [System.StringComparison]::Ordinal) -ge 0) {
        $collected += ($line -creplace $pattern, $Key)
      }
    }
  }
  return ($collected -join "`n")
}

# Collects the reference lines of every spec that is not a draft, and joins them. The planner branch
# looks both source kinds up in this one list: a source no spec names is absent, and so is a source
# whose specs are all drafts, which is what SPEC-035 R2 asks for. Gathering two lists, or rereading
# the specs per candidate, brings back the product SPEC-033 removed.
#
# A draft is a document whose first status line carries exactly the value draft. Values are read the
# way Get-Value reads every other one, and the whole value is compared, so a document with no status
# line or a value outside the contract is not a draft: its reference lines are collected and the
# source stays closed. An unreadable verdict leans to the safe side, and role_eligibility.rs compares
# the front matter status the same way. Using the screen normalization or the derived idea state
# there would answer the exact opposite for a state outside the contract (SPEC-035 R7).
#
# Normalization and the partial match are Get-References'. Two keys share one list because each
# lookup carries its own key in the needle. A status line may sit after the reference lines, so each
# file's lines are held and flushed once the file ends.
function Get-NonDraftReferences([string]$Root) {
  $collected = @()
  $keys = @('source_idea_id:', 'source_idea:', 'source_decision_id:')
  foreach ($path in (Get-Documents $Root 'specs')) {
    $lines = Get-Lines $path
    if ((Get-Value $lines 'status') -ceq 'draft') { continue }
    foreach ($line in $lines) {
      $value = $line
      $hit = $false
      foreach ($key in $keys) {
        if ($line.IndexOf($key, [System.StringComparison]::Ordinal) -ge 0) {
          $value = $value -creplace ([regex]::Escape($key) + ' +'), $key
          $hit = $true
        }
      }
      if ($hit) { $collected += $value }
    }
  }
  return ($collected -join "`n")
}

# Reads the decisions of one workflow once and returns the candidate rows for a branch. Want is the
# outcome line the branch looks for, and Strict adds the schema line and a non-empty spec_id to the
# candidate test, which is how the planner branch screens out task QA decisions. Every value is
# read the way the shell twin reads it: id, spec_id, created_by and created_at come from the first
# line starting with that key, and the schema and outcome lines may sit anywhere in the file.
#
# The latest-decision verdict becomes a max table keyed by spec_id. The table holds what the old
# comparison loop held - decisions carrying the schema line whose created_by is exactly user - and
# an empty spec_id groups under the empty key like any other. A candidate is superseded only when
# the max for its spec_id is greater than its own created_at. Leaving the candidate in the table
# gives the same answer: if it is in the table the max is at least its own value, and the
# comparison is greater-than, so its own value alone never makes it true. A tie stays latest, as
# before. Comparison is ordinal, the way the shell twin compares strings; no date parsing is
# introduced, because that would be a change to the verdict rules. The table is ordinal too: the
# default hashtable comparer is case insensitive and would merge two spec ids differing in case.
function Get-DecisionCandidates([string]$Root, [string]$Want, [bool]$Strict) {
  $rows = @()
  foreach ($path in (Get-Documents $Root 'decisions')) {
    $lines = Get-Lines $path
    $rows += @{
      Id = Get-Value $lines 'id'
      Spec = Get-Value $lines 'spec_id'
      CreatedBy = Get-Value $lines 'created_by'
      CreatedAt = Get-Value $lines 'created_at'
      Schema = (Test-Match $lines '^schema: workflow-labs/decision@1')
      Want = (Test-Match $lines ('^' + $Want))
    }
  }
  $latest = [System.Collections.Hashtable]::new([System.StringComparer]::Ordinal)
  foreach ($row in $rows) {
    if (-not $row.Schema) { continue }
    if ($row.CreatedBy -cne 'user') { continue }
    $spec = $row.Spec
    if ((-not $latest.ContainsKey($spec)) -or
      ([string]::CompareOrdinal($row.CreatedAt, $latest[$spec]) -gt 0)) {
      $latest[$spec] = $row.CreatedAt
    }
  }
  $candidates = @()
  foreach ($row in $rows) {
    if (-not $row.Want) { continue }
    if ($row.CreatedBy -cne 'user') { continue }
    if ($row.Id.Length -eq 0) { continue }
    if ($Strict -and ((-not $row.Schema) -or ($row.Spec.Length -eq 0))) { continue }
    $spec = $row.Spec
    if ($latest.ContainsKey($spec) -and
      ([string]::CompareOrdinal($latest[$spec], $row.CreatedAt) -gt 0)) { continue }
    $candidates += $row
  }
  return $candidates
}

# Reads app-owned task-definition revision requests. The task state and handled link are checked by
# the architect branch after requests from every workflow have been ordered by CreatedAt and Id.
function Get-TaskRevisionRequests([string]$Root) {
  $requests = @()
  foreach ($path in (Get-Documents $Root 'decisions')) {
    $lines = Get-Lines $path
    if (-not (Test-Match $lines '^schema: workflow-labs/task-revision-request@1')) { continue }
    if ((Get-Value $lines 'created_by') -cne 'user') { continue }
    $id = Get-Value $lines 'id'
    $task = Get-Value $lines 'task_id'
    $createdAt = Get-Value $lines 'created_at'
    if ($id.Length -eq 0 -or $task.Length -eq 0 -or $createdAt.Length -eq 0) { continue }
    $requests += [pscustomobject]@{
      Id = $id
      Task = $task
      CreatedAt = $createdAt
      Root = $Root
    }
  }
  return @($requests)
}

# Reads valid work-group documents once. The architect branch shares these rows between QA rework,
# interrupted preparation recovery, and approval decomposition.
function Get-WorkGroups([string]$Root) {
  $groups = @()
  foreach ($path in (Get-Documents $Root 'groups')) {
    $lines = Get-Lines $path
    if (-not (Test-Match $lines '^schema: workflow-labs/work-group@1')) { continue }
    $id = Get-Value $lines 'id'
    $status = Get-Value $lines 'status'
    $revision = Get-Value $lines 'revision'
    $source = Get-Value $lines 'source_decision_id'
    $sourceSpec = Get-Value $lines 'source_spec_id'
    [uint32]$parsedRevision = 0
    $revisionValid = $revision -cmatch '^[0-9]+$' -and
      [uint32]::TryParse($revision, [ref]$parsedRevision)
    if ($id.Length -eq 0 -or $status.Length -eq 0 -or (-not $revisionValid) -or
        $source.Length -eq 0 -or $sourceSpec.Length -eq 0) { continue }
    $groups += [pscustomobject]@{
      Id = $id
      Status = $status
      Revision = $parsedRevision.ToString([System.Globalization.CultureInfo]::InvariantCulture)
      SourceDecision = $source
      SourceSpec = $sourceSpec
      SourceQaDecision = Get-Value $lines 'source_qa_decision_id'
      Root = $Root
    }
  }
  return @($groups)
}

# Parses the same RFC3339 shape as Chrono without calling a platform date executable. BSD date,
# GNU date, and Windows PowerShell accept different flags and timestamp subsets, so using either
# one here would make architect eligibility platform-dependent. Seconds are relative to year zero;
# only ordering matters. Nanos is separate so arbitrary fractional digits and leap seconds retain
# the same ordering as Chrono.
function Test-Rfc3339LeapYear([long]$Year) {
  return (($Year % 4) -eq 0) -and ((($Year % 100) -ne 0) -or (($Year % 400) -eq 0))
}

function Get-Rfc3339MonthDays([long]$Year, [int]$Month) {
  if ($Month -eq 2) { if (Test-Rfc3339LeapYear $Year) { return 29 } else { return 28 } }
  if ($Month -eq 4 -or $Month -eq 6 -or $Month -eq 9 -or $Month -eq 11) { return 30 }
  return 31
}

function Get-Rfc3339Instant([string]$Value) {
  $pattern = '^(?<year>[0-9]{4})-(?<month>[0-9]{2})-(?<day>[0-9]{2})' +
    '(?<separator>[Tt ])(?<hour>[0-9]{2}):(?<minute>[0-9]{2}):(?<second>[0-9]{2})' +
    '(?:\.(?<fraction>[0-9]+))?(?<zone>[Zz]|[+-][0-9]{2}:[0-9]{2})$'
  $match = [regex]::Match($Value, $pattern,
    [System.Text.RegularExpressions.RegexOptions]::CultureInvariant)
  if (-not $match.Success) { return $null }

  [long]$year = $match.Groups['year'].Value
  [int]$month = $match.Groups['month'].Value
  [int]$day = $match.Groups['day'].Value
  [int]$hour = $match.Groups['hour'].Value
  [int]$minute = $match.Groups['minute'].Value
  [int]$second = $match.Groups['second'].Value
  if ($month -lt 1 -or $month -gt 12 -or $day -lt 1 -or
      $day -gt (Get-Rfc3339MonthDays $year $month) -or $hour -gt 23 -or
      $minute -gt 59 -or $second -gt 60) { return $null }

  [long]$leapsBefore = 0
  if ($year -gt 0) {
    $prior = $year - 1
    $leapsBefore = [long]([Math]::Floor($prior / 4) - [Math]::Floor($prior / 100) +
      [Math]::Floor($prior / 400) + 1)
  }
  [long]$days = $year * 365 + $leapsBefore
  for ($m = 1; $m -lt $month; $m++) { $days += Get-Rfc3339MonthDays $year $m }
  $days += $day - 1

  [long]$nanos = 0
  $fraction = $match.Groups['fraction'].Value
  if ($fraction.Length -gt 0) {
    $nanos = [long](($fraction + '000000000').Substring(0, 9))
  }
  if ($second -eq 60) { $second = 59; $nanos += 1000000000 }

  [long]$offset = 0
  $zone = $match.Groups['zone'].Value
  if ($zone -cne 'Z' -and $zone -cne 'z') {
    [int]$offsetHour = $zone.Substring(1, 2)
    [int]$offsetMinute = $zone.Substring(4, 2)
    if ($offsetHour -gt 23 -or $offsetMinute -gt 59) { return $null }
    $offset = $offsetHour * 3600 + $offsetMinute * 60
    if ($zone.Substring(0, 1) -ceq '-') { $offset = -$offset }
  }
  [long]$seconds = $days * 86400 + $hour * 3600 + $minute * 60 + $second - $offset
  return [pscustomobject]@{ Seconds = $seconds; Nanos = $nanos }
}

function Compare-Utf8Ordinal([string]$Left, [string]$Right) {
  $leftBytes = [System.Text.Encoding]::UTF8.GetBytes($Left)
  $rightBytes = [System.Text.Encoding]::UTF8.GetBytes($Right)
  $length = [Math]::Min($leftBytes.Length, $rightBytes.Length)
  for ($index = 0; $index -lt $length; $index++) {
    if ($leftBytes[$index] -lt $rightBytes[$index]) { return -1 }
    if ($leftBytes[$index] -gt $rightBytes[$index]) { return 1 }
  }
  if ($leftBytes.Length -lt $rightBytes.Length) { return -1 }
  if ($leftBytes.Length -gt $rightBytes.Length) { return 1 }
  return 0
}

# Selects the latest app-owned QA decision of every group revision, then returns the revisions whose
# latest outcome asks for rework. The architect branch checks that the group is still on that
# revision. A source QA link belongs to an earlier revision and never hides the current rejection.
# Validity, instant comparison, and same-instant file-name tie breaking mirror the Rust reader.
function Get-GroupQaRevisionRequests([string]$Root) {
  $rows = @()
  foreach ($path in (Get-Documents $Root 'decisions')) {
    $lines = Get-Lines $path
    if (-not (Test-Match $lines '^schema: workflow-labs/group-qa-decision@1')) { continue }
    if ((Get-Value $lines 'created_by') -cne 'user') { continue }
    $id = Get-Value $lines 'id'
    $group = Get-Value $lines 'group_id'
    $revision = Get-Value $lines 'group_revision'
    $outcome = Get-Value $lines 'outcome'
    $request = Get-Value $lines 'request_id'
    $createdAt = Get-Value $lines 'created_at'
    [uint32]$parsedRevision = 0
    $revisionValid = $revision -cmatch '^[0-9]+$' -and
      [uint32]::TryParse($revision, [ref]$parsedRevision)
    $instant = Get-Rfc3339Instant $createdAt
    if ($id.Length -eq 0 -or $group.Length -eq 0 -or (-not $revisionValid) -or
        $request.Length -eq 0 -or $null -eq $instant) { continue }
    if ($outcome -cne 'confirmed' -and $outcome -cne 'revision_requested') { continue }
    $rows += [pscustomobject]@{
      Id = $id
      Group = $group
      Revision = $parsedRevision.ToString([System.Globalization.CultureInfo]::InvariantCulture)
      Outcome = $outcome
      CreatedAt = $createdAt
      InstantSeconds = $instant.Seconds
      InstantNanos = $instant.Nanos
      FileName = [System.IO.Path]::GetFileName($path)
      Root = $Root
    }
  }
  $latest = [System.Collections.Hashtable]::new([System.StringComparer]::Ordinal)
  foreach ($row in $rows) {
    $key = $row.Group + [char]31 + $row.Revision
    $newer = (-not $latest.ContainsKey($key))
    if (-not $newer) {
      $previous = $latest[$key]
      $newer = $row.InstantSeconds -gt $previous.InstantSeconds -or
        ($row.InstantSeconds -eq $previous.InstantSeconds -and
          $row.InstantNanos -gt $previous.InstantNanos) -or
        ($row.InstantSeconds -eq $previous.InstantSeconds -and
          $row.InstantNanos -eq $previous.InstantNanos -and
          (Compare-Utf8Ordinal $row.FileName $previous.FileName) -gt 0)
    }
    if ($newer) {
      $latest[$key] = $row
    }
  }
  $requests = @()
  foreach ($row in $rows) {
    $key = $row.Group + [char]31 + $row.Revision
    if ($latest[$key].FileName -cne $row.FileName) { continue }
    if ($row.Outcome -ceq 'revision_requested') { $requests += $row }
  }
  return @($requests)
}

# --- Configuration-error groups (SPEC-073) ---------------------------------------------------
# The app calls a work group a configuration error when its display-status chain lands there, and
# that chain reads the group document, the tasks that belong to it, and the group QA decisions
# together. These functions are the twin of the shell body's scan_configuration_errors and of the
# app's own chain in fs_project_repository.rs. All three have to answer the same thing: a group the
# screen shows as needing a configuration check is what the architect is handed next.

# The word lists the app uses to decide whether a QA walkthrough reads as user behaviour. Changing
# one of them here alone makes the two implementations disagree about the same document.
$script:qaSurfaceTokens = @(
  '화면', '페이지', '창', '대화상자', '다이얼로그', '목록', '메뉴', '버튼', '폼', '카드', '패널',
  '탭', '앱', '브라우저', '모달', '알림', '토스트', '배너', '대시보드', '설정', '입력란',
  'screen', 'page', 'window', 'dialog', 'list', 'menu', 'button', 'form', 'card', 'panel', 'tab',
  'app', 'browser', 'modal', 'notice', 'toast', 'banner', 'dashboard', 'settings', 'field')
$script:qaActionTokens = @(
  '누르', '눌', '클릭', '선택', '입력', '열', '이동', '저장', '전환', '확인', '스크롤', '드래그',
  '켜', '끄', '바꾸', '지정', '돌아',
  'tap', 'click', 'select', 'enter', 'type', 'open', 'navigate', 'save', 'switch', 'check',
  'scroll', 'drag')
$script:qaResultTokens = @(
  '보여', '보이', '표시', '나타', '사라', '완료', '변경', '유지', '결과', '안내', '메시지', '활성',
  '비활성', '추가', '삭제', '선택되어', '그대로', '적혀', '열리', '나오', '바뀌', '같아지', '남아',
  'visible', 'appears', 'shows', 'display', 'hidden', 'disappears', 'complete', 'updated', 'saved',
  'result', 'message', 'enabled', 'disabled', 'added', 'removed')
$script:qaCommandTokens = @(
  'npx ', 'npm ', 'pnpm ', 'yarn ', 'cargo ', 'pytest', 'go test', 'go build', 'python -m ',
  'gradle test', 'gradle build', 'gradlew test', 'gradlew build', 'dotnet test', 'dotnet build',
  'curl http://', 'curl https://', 'curl -', 'docker run ', 'docker build ', 'docker exec ',
  'docker compose up', 'docker compose run', 'docker compose exec', 'mvn test', 'mvn verify',
  'mvn package', 'maven test', './scripts/', '.\scripts\', 'swift test', 'xcodebuild ', 'bash ',
  'zsh ', 'pwsh ', 'powershell ', 'make test', 'bun test', 'typecheck', 'type-check', 'tsc ',
  'run lint', 'run build', 'lint command', 'build command', 'lint/build', 'terminal', '터미널',
  '명령어', 'command line', '테스트를 실행', '테스트 실행', '테스트를 돌', '테스트 돌',
  '타입 검사', '타입검사', 'lint 검사', 'lint를 실행', 'lint 실행', '린트', '빌드를 실행',
  '빌드 실행', '빌드를 돌')
$script:qaCliExecutables = @(
  'curl', 'docker', 'docker-compose', 'mvn', 'maven', 'xcodebuild', 'kubectl', 'helm', 'bash',
  'sh', 'zsh', 'pwsh', 'powershell', 'npm', 'npx', 'pnpm', 'yarn', 'cargo', 'pytest', 'gradle',
  'gradlew', 'dotnet', 'phpunit', 'composer', 'bundle', 'rspec', 'cmake', 'ctest')
$script:qaGitArguments = @(
  'add', 'bisect', 'branch', 'checkout', 'clone', 'commit', 'diff', 'fetch', 'grep', 'log',
  'merge', 'pull', 'push', 'rebase', 'reset', 'restore', 'show', 'status', 'switch', 'tag')
$script:qaFence = [string][char]96 + [string][char]96 + [string][char]96

# Lowercases ASCII letters and nothing else, which is what the app's to_ascii_lowercase does and
# what the shell twin's tolower does under LC_ALL=C. Lowercasing the whole of Unicode here would
# make the three implementations disagree on non-ASCII scripts.
function Get-AsciiLower([string]$Text) {
  $chars = $Text.ToCharArray()
  for ($i = 0; $i -lt $chars.Length; $i++) {
    if ($chars[$i] -ge [char]'A' -and $chars[$i] -le [char]'Z') {
      $chars[$i] = [char]([int]$chars[$i] + 32)
    }
  }
  return (-join $chars)
}

# Reads a word whose ending changed as the same word. The app decomposes each syllable into its
# initial, medial, and final and compares those parts; the result of that comparison is exactly
# this: every syllable but the last must be identical, and the last one matches syllables that
# differ only in their final when the token's own last syllable carries none. That is why '보이'
# matches '보인다' while '창' does not match '차이'.
function Test-HangulEndingMatch([string]$Text, [string]$Token) {
  $tn = $Token.Length
  if ($tn -eq 0 -or $Text.Length -lt $tn) { return $false }
  $last = [int]$Token[$tn - 1]
  $lastOpen = ($last -ge 44032 -and $last -le 55203 -and (($last - 44032) % 28) -eq 0)
  for ($j = 0; ($j + $tn) -le $Text.Length; $j++) {
    $ok = $true
    for ($i = 0; $i -lt ($tn - 1); $i++) {
      if ([int]$Text[$j + $i] -ne [int]$Token[$i]) { $ok = $false; break }
    }
    if (-not $ok) { continue }
    $tail = [int]$Text[$j + $tn - 1]
    if ($lastOpen) {
      if ($tail -lt 44032 -or $tail -gt 55203) { continue }
      if ([Math]::Floor(($tail - 44032) / 28) -ne [Math]::Floor(($last - 44032) / 28)) { continue }
    } elseif ($tail -ne $last) { continue }
    return $true
  }
  return $false
}

function Test-MentionsAny([string]$Lowered, [string[]]$Tokens) {
  foreach ($token in $Tokens) {
    if ($Lowered.IndexOf($token, [System.StringComparison]::Ordinal) -ge 0) { return $true }
    if (Test-HangulEndingMatch $Lowered $token) { return $true }
  }
  return $false
}

function Test-QaCliExecutable([string]$Value) {
  return ($script:qaCliExecutables -ccontains $Value)
}

# The twin of the app's line_looks_like_cli_command. A walkthrough line that reads as a terminal
# command is not a user action, whatever else the line says.
function Test-QaCliLine([string]$Line) {
  $ordinal = [System.StringComparison]::Ordinal
  $c = $Line.Trim()
  if ($c.Length -eq 0) { return $false }
  if ($c.StartsWith('$ ', $ordinal) -or $c.StartsWith('% ', $ordinal) -or
      $c.StartsWith('>>> ', $ordinal) -or $c.StartsWith('ps> ', $ordinal)) { return $true }
  if ($c.StartsWith('ps ', $ordinal) -and $c.IndexOf('> ', $ordinal) -ge 0) { return $true }
  $p = $c.IndexOf('$ ', $ordinal)
  if ($p -gt 0) {
    $prompt = $c.Substring(0, $p)
    if ($prompt.IndexOf('@', $ordinal) -ge 0 -or $prompt.EndsWith(':', $ordinal) -or
        $prompt.IndexOf('/', $ordinal) -ge 0) { return $true }
  }
  if ($c.Length -gt 3 -and ([string]$c[0]) -cmatch '^[A-Za-z]$' -and $c[1] -eq ':' -and
      ($c[2] -eq '\' -or $c[2] -eq '/') -and $c.IndexOf('> ', $ordinal) -ge 0) { return $true }
  if ($c.StartsWith('- ', $ordinal) -or $c.StartsWith('* ', $ordinal) -or
      $c.StartsWith('+ ', $ordinal)) {
    $c = $c.Substring(2).TrimStart()
  } else {
    $p = $c.IndexOf('. ', $ordinal)
    if ($p -gt 0) {
      $number = $c.Substring(0, $p)
      if ($number -cmatch '^[0-9]+$') { $c = $c.Substring($p + 2).TrimStart() }
    }
  }
  if ($c.StartsWith('# ', $ordinal)) {
    $command = $c.Substring(2)
    $head = @($command.TrimStart() -split '\s+')
    $executable = ''
    if ($head.Count -ge 1) { $executable = $head[0].Trim([char]96) }
    if ((Test-QaCliExecutable $executable) -or $command.StartsWith('go test', $ordinal) -or
        $command.StartsWith('go build', $ordinal) -or $command.StartsWith('swift test', $ordinal) -or
        $command.StartsWith('./', $ordinal)) { return $true }
  }
  $c = $c.TrimStart([char]96)
  if ($c.StartsWith('./', $ordinal) -or $c.StartsWith('../', $ordinal) -or
      $c.StartsWith('.\', $ordinal) -or $c.StartsWith('/bin/', $ordinal) -or
      $c.StartsWith('/usr/bin/', $ordinal)) { return $true }
  $words = @($c.TrimStart() -split '\s+' | Where-Object { $_.Length -gt 0 })
  $executable = ''
  $argument = ''
  if ($words.Count -ge 1) { $executable = $words[0].Trim([char]96) }
  if ($words.Count -ge 2) { $argument = $words[1].Trim([char]96) }
  if (Test-QaCliExecutable $executable) { return $true }
  if ($executable -ceq 'swift' -and $c.StartsWith('swift test', $ordinal)) { return $true }
  if ($executable -ceq 'go' -and ($c.StartsWith('go test', $ordinal) -or
      $c.StartsWith('go build', $ordinal))) { return $true }
  if ($executable -ceq 'git' -and ($script:qaGitArguments -ccontains $argument)) { return $true }
  if ($executable -ceq 'node' -and ($argument.StartsWith('-', $ordinal) -or
      $argument.IndexOf('/', $ordinal) -ge 0 -or $argument -cmatch '\.(js|mjs|cjs|ts)$')) { return $true }
  if ($executable -ceq 'deno' -and (@('run', 'test', 'task', 'check', 'lint', 'fmt', 'compile') -ccontains $argument)) {
    return $true
  }
  if ($executable -ceq 'php' -and ($argument.StartsWith('-', $ordinal) -or
      $argument.IndexOf('/', $ordinal) -ge 0 -or $argument -cmatch '\.php$')) { return $true }
  if ($executable -ceq 'ruby' -and ($argument.StartsWith('-', $ordinal) -or
      $argument.IndexOf('/', $ordinal) -ge 0 -or $argument -cmatch '\.rb$')) { return $true }
  if ($executable -ceq 'make' -and $argument.Length -gt 0 -and
      -not (@('a', 'an', 'it', 'sure', 'the', 'this', 'that') -ccontains $argument)) { return $true }
  return $false
}

function Test-InternalQaInstruction([string]$Text) {
  $lowered = Get-AsciiLower $Text
  foreach ($token in $script:qaCommandTokens) {
    if ($lowered.IndexOf($token, [System.StringComparison]::Ordinal) -ge 0) { return $true }
  }
  foreach ($line in $lowered.Split([char]10)) {
    if (Test-QaCliLine $line) { return $true }
  }
  return $false
}

function Test-ScenarioUserSafe([string]$Title, [string]$Body) {
  if ($Body.Length -eq 0) { return $false }
  if ($Body.IndexOf($script:qaFence, [System.StringComparison]::Ordinal) -ge 0) { return $false }
  if (Test-InternalQaInstruction $Title) { return $false }
  if (Test-InternalQaInstruction $Body) { return $false }
  $lowered = Get-AsciiLower $Body
  return (Test-MentionsAny $lowered $script:qaSurfaceTokens) -and
    (Test-MentionsAny $lowered $script:qaActionTokens) -and
    (Test-MentionsAny $lowered $script:qaResultTokens)
}

# Reads the walkthrough sections out of a group document. Section identifiers must run QA-01,
# QA-02, ... in order and carry a title; anything else leaves the structure invalid, which is one
# of the conditions that make the document a configuration error.
function Get-QaScenarios([string[]]$Lines) {
  $ordinal = [System.StringComparison]::Ordinal
  $scenarios = @()
  $structureValid = $true
  $open = $false
  $title = ''
  $body = @()
  foreach ($line in $Lines) {
    if (-not $line.StartsWith('### ', $ordinal)) {
      if ($open) { $body += $line }
      continue
    }
    $handled = $false
    $rest = $line.Substring(4)
    $separator = $rest.IndexOf(' · ', $ordinal)
    if ($separator -ge 0) {
      $sectionId = $rest.Substring(0, $separator)
      if ($sectionId.StartsWith('QA-', $ordinal)) {
        $handled = $true
        $sectionTitle = $rest.Substring($separator + 3).Trim()
        $expected = 'QA-' + ($scenarios.Count + [int]$open + 1).ToString('00',
          [System.Globalization.CultureInfo]::InvariantCulture)
        if ($sectionId -ceq $expected -and $sectionTitle.Length -gt 0) {
          if ($open) {
            $scenarios += [pscustomobject]@{
              Title = $title
              Body = (($body -join ([string][char]10)).Trim())
            }
          }
          $open = $true
          $title = $sectionTitle
          $body = @()
        } else {
          $structureValid = $false
          if ($open) { $body += $line }
        }
      }
    }
    if (-not $handled) {
      if ($line.StartsWith('### QA-', $ordinal)) { $structureValid = $false }
      if ($open) { $body += $line }
    }
  }
  if ($open) {
    $scenarios += [pscustomobject]@{ Title = $title; Body = (($body -join ([string][char]10)).Trim()) }
  }
  return @{ Scenarios = @($scenarios); StructureValid = $structureValid }
}

# The latest app-owned group QA decision per group and revision, whatever its outcome. The rework
# scan next door keeps only the revision_requested ones; the display-status chain needs a confirmed
# one too, because a confirmed group is complete and never a configuration error.
function Get-LatestGroupQaOutcomes([string]$Root) {
  $outcomes = [System.Collections.Hashtable]::new([System.StringComparer]::Ordinal)
  $best = [System.Collections.Hashtable]::new([System.StringComparer]::Ordinal)
  foreach ($path in (Get-Documents $Root 'decisions')) {
    $lines = Get-Lines $path
    if (-not (Test-Match $lines '^schema: workflow-labs/group-qa-decision@1')) { continue }
    if ((Get-Value $lines 'created_by') -cne 'user') { continue }
    $id = Get-Value $lines 'id'
    $group = Get-Value $lines 'group_id'
    $revisionText = Get-Value $lines 'group_revision'
    $outcome = Get-Value $lines 'outcome'
    $request = Get-Value $lines 'request_id'
    [uint32]$revision = 0
    $revisionOk = $revisionText -cmatch '^[0-9]+$' -and
      [uint32]::TryParse($revisionText, [ref]$revision)
    $instant = Get-Rfc3339Instant (Get-Value $lines 'created_at')
    if ($id.Length -eq 0 -or $group.Length -eq 0 -or (-not $revisionOk) -or $revision -eq 0 -or
        $request.Length -eq 0 -or $null -eq $instant) { continue }
    if ($outcome -cne 'confirmed' -and $outcome -cne 'revision_requested') { continue }
    $key = $group + [char]31 + $revision.ToString([System.Globalization.CultureInfo]::InvariantCulture)
    $file = [System.IO.Path]::GetFileName($path)
    $newer = (-not $best.ContainsKey($key))
    if (-not $newer) {
      $previous = $best[$key]
      $newer = $instant.Seconds -gt $previous.Seconds -or
        ($instant.Seconds -eq $previous.Seconds -and $instant.Nanos -gt $previous.Nanos) -or
        ($instant.Seconds -eq $previous.Seconds -and $instant.Nanos -eq $previous.Nanos -and
          (Compare-Utf8Ordinal $file $previous.File) -gt 0)
    }
    if ($newer) {
      $best[$key] = [pscustomobject]@{ Seconds = $instant.Seconds; Nanos = $instant.Nanos; File = $file }
      $outcomes[$key] = $outcome
    }
  }
  return $outcomes
}

# The latest legacy per-task QA decision per task. A group whose tasks all carry a confirmed one is
# complete under the old contract and is never a configuration error.
function Get-LatestLegacyTaskQaOutcomes([string]$Root) {
  $outcomes = [System.Collections.Hashtable]::new([System.StringComparer]::Ordinal)
  $best = [System.Collections.Hashtable]::new([System.StringComparer]::Ordinal)
  foreach ($path in (Get-Documents $Root 'decisions')) {
    $lines = Get-Lines $path
    if (-not (Test-Match $lines '^schema: workflow-labs/qa-decision@1')) { continue }
    if ((Get-Value $lines 'created_by') -cne 'user') { continue }
    $task = Get-Value $lines 'task_id'
    $outcome = Get-Value $lines 'outcome'
    $instant = Get-Rfc3339Instant (Get-Value $lines 'created_at')
    if ($task.Length -eq 0 -or $null -eq $instant) { continue }
    if ($outcome -cne 'confirmed' -and $outcome -cne 'revision_requested') { continue }
    $file = [System.IO.Path]::GetFileName($path)
    $newer = (-not $best.ContainsKey($task))
    if (-not $newer) {
      $previous = $best[$task]
      $newer = $instant.Seconds -gt $previous.Seconds -or
        ($instant.Seconds -eq $previous.Seconds -and $instant.Nanos -gt $previous.Nanos) -or
        ($instant.Seconds -eq $previous.Seconds -and $instant.Nanos -eq $previous.Nanos -and
          (Compare-Utf8Ordinal $file $previous.File) -gt 0)
    }
    if ($newer) {
      $best[$task] = [pscustomobject]@{ Seconds = $instant.Seconds; Nanos = $instant.Nanos; File = $file }
      $outcomes[$task] = $outcome
    }
  }
  return $outcomes
}

# Groups whose display status is a configuration error, in glob order. A group the architect has
# already marked as beyond a document fix carries configuration_unresolved_revision for the current
# revision; that one is the user's turn, not this branch's target.
function Get-ConfigurationErrorGroups([string]$Root) {
  $invariant = [System.Globalization.CultureInfo]::InvariantCulture
  $latestGroupQa = Get-LatestGroupQaOutcomes $Root
  $legacyTaskQa = Get-LatestLegacyTaskQaOutcomes $Root
  $tasks = @()
  foreach ($path in (Get-Documents $Root 'tasks')) {
    $lines = Get-Lines $path
    $taskId = Get-Value $lines 'id'
    if ($taskId.Length -eq 0) { $taskId = [System.IO.Path]::GetFileNameWithoutExtension($path) }
    $taskStatus = Get-Value $lines 'status'
    if ($taskStatus.Length -eq 0) { $taskStatus = 'todo' }
    $tasks += [pscustomobject]@{
      Id = $taskId
      Group = Get-Value $lines 'work_group_id'
      Revision = Get-Value $lines 'work_group_revision'
      Spec = Get-Value $lines 'source_spec_id'
      Decision = Get-Value $lines 'source_decision_id'
      Status = $taskStatus
    }
  }
  $rows = @()
  foreach ($path in (Get-Documents $Root 'groups')) {
    $lines = Get-Lines $path
    if (-not (Test-Match $lines '^schema: workflow-labs/work-group@1')) { continue }
    $explicitId = Get-Value $lines 'id'
    $id = $explicitId
    if ($id.Length -eq 0) { $id = [System.IO.Path]::GetFileNameWithoutExtension($path) }
    $status = Get-Value $lines 'status'
    $mode = Get-Value $lines 'qa_mode'
    $spec = Get-Value $lines 'source_spec_id'
    $decision = Get-Value $lines 'source_decision_id'
    $sourceQa = Get-Value $lines 'source_qa_decision_id'
    $updated = Get-Value $lines 'updated_at'
    $revisionText = Get-Value $lines 'revision'
    [uint32]$revision = 0
    if (-not ($revisionText -cmatch '^[0-9]+$' -and
        [uint32]::TryParse($revisionText, [ref]$revision))) { $revision = 0 }
    $statusOk = ($status -ceq 'preparing' -or $status -ceq 'active')
    if (-not $statusOk) { $status = 'active' }
    $modeOk = ($mode -ceq 'user' -or $mode -ceq 'automatic')
    if (-not $modeOk) { $mode = 'user' }
    $parsed = Get-QaScenarios $lines
    $structural = $statusOk -and $modeOk -and $explicitId.Length -gt 0 -and $revision -gt 0 -and
      $spec.Length -gt 0 -and $decision.Length -gt 0 -and $updated.Length -gt 0 -and
      $null -ne (Get-Rfc3339Instant $updated) -and $parsed.StructureValid

    $assigned = 0
    $linkBad = $false
    $notVerified = $false
    $blocked = $false
    $developing = $false
    $legacyAll = $true
    foreach ($task in $tasks) {
      if ($task.Group.Length -eq 0 -or $task.Group -cne $id) { continue }
      $assigned++
      [uint32]$taskRevision = 0
      $taskRevisionOk = $task.Revision -cmatch '^[0-9]+$' -and
        [uint32]::TryParse($task.Revision, [ref]$taskRevision)
      if (-not ($taskRevisionOk -and $taskRevision -gt 0 -and $taskRevision -le $revision -and
          $task.Spec.Length -gt 0 -and $task.Spec -ceq $spec -and
          $task.Decision.Length -gt 0 -and $task.Decision -ceq $decision)) { $linkBad = $true }
      if ($task.Status -cne 'verified') { $notVerified = $true }
      if ($task.Status -ceq 'blocked') { $blocked = $true }
      if ($task.Status -ceq 'todo' -or $task.Status -ceq 'in_progress') { $developing = $true }
      if (-not ($legacyTaskQa.ContainsKey($task.Id) -and
          $legacyTaskQa[$task.Id] -ceq 'confirmed')) { $legacyAll = $false }
    }

    $key = $id + [char]31 + $revision.ToString($invariant)
    $latest = ''
    if ($latestGroupQa.ContainsKey($key)) { $latest = $latestGroupQa[$key] }
    if ($latest -ceq 'confirmed') { continue }
    if ($assigned -gt 0 -and (-not $linkBad) -and $legacyAll) { continue }
    if ($latest -ceq 'revision_requested') { continue }
    if ($status -ceq 'preparing') { continue }
    if ($blocked) { continue }
    if ($developing) { continue }

    $issues = $false
    if (-not $structural) { $issues = $true }
    if ($assigned -eq 0) { $issues = $true }
    if ($linkBad) { $issues = $true }
    if ($mode -ceq 'user') {
      if ($parsed.Scenarios.Count -eq 0) {
        $issues = $true
      } else {
        foreach ($scenario in $parsed.Scenarios) {
          if (-not (Test-ScenarioUserSafe $scenario.Title $scenario.Body)) { $issues = $true; break }
        }
      }
    }
    if ($mode -ceq 'automatic' -and $parsed.Scenarios.Count -gt 0) { $issues = $true }
    if ($notVerified) { $issues = $true }
    if (-not $issues) { continue }

    $unresolvedText = Get-Value $lines 'configuration_unresolved_revision'
    [uint32]$unresolved = 0
    if ($unresolvedText -cmatch '^[0-9]+$' -and
        [uint32]::TryParse($unresolvedText, [ref]$unresolved) -and $unresolved -eq $revision) {
      continue
    }
    $rows += [pscustomobject]@{ Id = $id; Decision = $decision; SourceQa = $sourceQa }
  }
  return @($rows)
}

# Writes the verdict reason as the first stdout line and exits. The heartbeat daemon copies that
# line into state.json as last_condition_output, and the app turns the code into a sentence.
# ASCII codes only: a sentence here could not match the one the sh body would have to print.
# This function is the only writer to stdout, so the reason is the first and only line.
# The reason does not change the verdict. Exit codes are what they were before it existed.
function Write-Verdict([string]$Code, [int]$ExitCode) {
  if ($script:machineOutput) {
    if ($null -ne $script:machineTarget) { $Code = 'eligible'; $ExitCode = 0 }
    [ordered]@{
      schemaVersion = 1
      role = $Role
      targetId = $script:machineTarget
      targetKind = $script:machineTargetKind
      candidates = @($script:machineCandidates)
      verdict = $Code
    } | ConvertTo-Json -Compress -Depth 4
    exit $ExitCode
  }
  [Console]::Out.WriteLine($Code)
  exit $ExitCode
}

# The target and the per-candidate exclusion reasons go to stderr (SPEC-049 R1). stdout stays the
# daemon's one reason line (SPEC-023 R4), so the widened answer goes to the channel a person and a
# session read. The code comes before the id because the id is the rest of the line: a value with a
# space in it cannot split the line's meaning. Neither function changes the verdict, the exit code,
# or the order candidates are judged in.
function Write-Candidate([string]$Code, [string]$Id) {
  if ($script:machineOutput) {
    $script:machineCandidates += [ordered]@{ id = $Id; reason = $Code }
    return
  }
  [Console]::Error.WriteLine('candidate: ' + $Code + ' ' + $Id)
}

# The candidate picked as the target. Both lines are written so the list alone shows where the
# target came from.
function Write-Target([string]$Id, [string]$Kind = '') {
  # The last check of the solo run state (SPEC-065 R2, R3). Every role's candidates pass through
  # this function, so the check lives in one place, and it sits *after* the exclusions that already
  # existed, so a candidate that used to carry one of those reasons still carries it. With no
  # representative this does nothing at all.
  if ($null -ne $script:soloRepresentative) {
    if ($Id -cne $script:soloRepresentative) { Write-Candidate 'solo-run-active' $Id; return }
    if ($script:soloOtherLeases) { Write-Candidate 'solo-run-wait' $Id; return }
  }
  if ($script:machineOutput) {
    Write-Candidate 'eligible' $Id
    if ($null -eq $script:machineTarget) { $script:machineTarget = $Id }
    if ($null -eq $script:machineTargetKind -and $Kind.Length -gt 0) {
      $script:machineTargetKind = $Kind
    }
    return
  }
  [Console]::Error.WriteLine('candidate: eligible ' + $Id)
  [Console]::Error.WriteLine('target: ' + $Id)
  Write-Verdict 'eligible' 0
}

# Is any unexpired lease held on something other than $Except? The representative's own lease is
# not counted: had it reached the last position, the lease check before it would already have
# removed it, so what is left is exactly "the machine is not quiet yet".
function Test-OtherLeaseExists([string]$Except) {
  if (-not (Test-Path -LiteralPath $leases -PathType Container)) { return $false }
  foreach ($file in @(Get-ChildItem -LiteralPath $leases -Filter '*.yml' -File -ErrorAction SilentlyContinue)) {
    if ($file.BaseName -ceq $Except) { continue }
    if (Test-Leased $file.BaseName) { return $true }
  }
  return $false
}

# The representative of the solo candidate set (SPEC-065 R3), or $null when the set is empty. The
# set and its representative are values of the whole project, not of one workflow, so they are
# settled once before any role branch runs.
#
# Membership is every developer exclusion other than the claim ones. A lease on the task itself and
# a file overlap are deliberately not conditions: both are facts attached to a lease and both
# release on their own, while a solo task that can never start would lock the project forever if it
# joined the set - its predecessor would be held by the very gate that waits for it.
#
# A project declaring nothing stops at the first pass below, and then no value is set and all three
# verdicts read exactly as they did before this clause existed.
function Get-SoloRepresentative() {
  $roots = @(Get-WorkflowRoots)
  $declared = $false
  foreach ($root in $roots) {
    foreach ($path in (Get-Documents $root 'tasks')) {
      if (Get-SoloRun (Get-Lines $path)) { $declared = $true; break }
    }
    if ($declared) { break }
  }
  if (-not $declared) { return $null }
  foreach ($root in $roots) {
    $groups = @(Get-WorkGroups $root)
    $approvedSources = @(Get-DecisionCandidates $root 'outcome: approved' $false)
    foreach ($path in (Get-Documents $root 'tasks')) {
      $lines = Get-Lines $path
      if (-not (Get-SoloRun $lines)) { continue }
      $ordinary = Test-Match $lines '^status: (todo|in_progress)'
      $blocked = Test-Match $lines '^status: blocked'
      $definitionError = (Get-Value $lines 'blocked_kind') -ceq 'definition_error'
      if (-not $ordinary -and (-not $blocked -or $definitionError)) { continue }
      $tid = Get-Value $lines 'id'
      if ($tid.Length -eq 0) { continue }
      if (-not (Test-DependenciesSatisfied $root $tid $lines)) { continue }
      if (Test-IntegrationWaiting $tid) { continue }
      $origin = Get-TaskOrigin $lines $groups $approvedSources
      if (-not $origin.SourceApproved -or -not $origin.GroupAvailable) { continue }
      return $tid
    }
  }
  return $null
}

if (Test-Path -LiteralPath '.workflow/.runtime/migration.lock' -PathType Leaf) {
  Write-Verdict 'migration-lock' 1
}

# Stands before a single candidate is read. A target would only start a session that fails at once
# for the same reason, so the answer carries no target and the reservation helper reserves nothing.
if (Test-ProviderLimitWaiting $Role) {
  Write-Verdict 'provider-limit-wait' 1
}

$script:soloRepresentative = Get-SoloRepresentative
if ($null -ne $script:soloRepresentative) {
  $script:soloOtherLeases = Test-OtherLeaseExists $script:soloRepresentative
}

switch -CaseSensitive ($Role) {
  'planner' {
    foreach ($root in (Get-WorkflowRoots)) {
      # Both lookups read this one list, gathered before the candidate loops, once for the whole
      # workflow.
      $nonDraftRefs = Get-NonDraftReferences $root
      # (a) An unprocessed idea: named by no spec that is not a draft, and not claimed.
      foreach ($path in (Get-Documents $root 'ideas')) {
        $id = Get-Value (Get-Lines $path) 'id'
        if ($id.Length -eq 0) { continue }
        # Legacy specs name their source with source_idea:. Both keys count as a reference, and
        # source_idea: never partially matches a source_idea_id: line.
        if (($nonDraftRefs.IndexOf('source_idea_id:' + $id,
          [System.StringComparison]::Ordinal) -ge 0) -or
          ($nonDraftRefs.IndexOf('source_idea:' + $id,
          [System.StringComparison]::Ordinal) -ge 0)) { Write-Candidate 'spec-exists' $id; continue }
        if (Test-Leased $id) { Write-Candidate 'leased' $id; continue }
        Write-Target $id
      }
      # (b) A revision request with no follow-up spec. This runs even with no ideas directory.
      # The schema line and a non-empty spec_id screen out QA decisions, which also use
      # revision_requested but carry task_id and no spec_id; that is the Strict argument. The
      # created_by filter and the latest-decision verdict happen in the same scan, because the app
      # counts only decisions whose created_by is exactly user and the whole value has to be
      # compared for the delegate value user-delegate to be screened out.
      foreach ($row in @(Get-DecisionCandidates $root 'outcome: revision_requested' $true)) {
        # The decision id is the key, not the spec id: one spec can be sent back more than once.
        if ($nonDraftRefs.IndexOf('source_decision_id:' + $row.Id,
          [System.StringComparison]::Ordinal) -ge 0) {
          Write-Candidate 'follow-up-exists' $row.Id
          continue
        }
        if (Test-Leased $row.Id) { Write-Candidate 'leased' $row.Id; continue }
        Write-Target $row.Id
      }
    }
  }
  'architect' {
    $groups = @()
    $groupRevisions = @()
    $configurationErrors = @()
    foreach ($root in (Get-WorkflowRoots)) {
      $groups += @(Get-WorkGroups $root)
      $groupRevisions += @(Get-GroupQaRevisionRequests $root)
      $configurationErrors += @(Get-ConfigurationErrorGroups $root)
    }
    # User-facing group QA rework has priority over internal task-definition correction.
    foreach ($row in @($groupRevisions | Sort-Object -Property CreatedAt, Id -CaseSensitive)) {
      $group = @($groups | Where-Object {
        $_.Root -ceq $row.Root -and $_.Id -ceq $row.Group -and $_.Revision -ceq $row.Revision
      } | Select-Object -First 1)
      if ($group.Count -eq 0) { continue }
      if ((Test-Leased $row.Id) -or (Test-Leased $row.Group)) {
        Write-Candidate 'leased' $row.Id
        continue
      }
      Write-Target $row.Id 'group_qa_revision'
    }

    # A configuration error comes after user QA rework and before task-definition correction
    # (SPEC-073 R-11). A group whose document does not hold together gives no ground for correcting
    # the task definitions derived from it. The lease check reads the same three ids the preparing
    # recovery below reads.
    foreach ($row in $configurationErrors) {
      $leased = (Test-Leased $row.Id)
      if (-not $leased -and $row.Decision.Length -gt 0) { $leased = Test-Leased $row.Decision }
      if (-not $leased -and $row.SourceQa.Length -gt 0) { $leased = Test-Leased $row.SourceQa }
      if ($leased) { Write-Candidate 'leased' $row.Id; continue }
      Write-Target $row.Id 'configuration_error'
    }

    $requests = @()
    $revisionTasks = @()
    foreach ($root in (Get-WorkflowRoots)) {
      $requests += @(Get-TaskRevisionRequests $root)
    }
    foreach ($row in @($requests | Sort-Object -Property CreatedAt, Id -CaseSensitive)) {
      $taskPath = Find-TaskFile $row.Root $row.Task
      if ($taskPath.Length -eq 0) { continue }
      $taskLines = Get-Lines $taskPath
      $status = Get-Value $taskLines 'status'
      if ($status -cne 'todo' -and $status -cne 'blocked') { continue }
      if ((Get-Value $taskLines 'revision_request_id') -ceq $row.Id) { continue }
      if ($revisionTasks -cnotcontains $row.Task) { $revisionTasks += $row.Task }
      if ((Test-Leased $row.Id) -or (Test-Leased $row.Task)) {
        Write-Candidate 'leased' $row.Id
        continue
      }
      Write-Target $row.Id 'task_revision_request'
    }
    # Historical user revision requests keep their priority. Without one, the blocked task already
    # carries enough ground for an architect to correct a definition_error directly.
    foreach ($root in (Get-WorkflowRoots)) {
      foreach ($path in (Get-Documents $root 'tasks')) {
        $lines = Get-Lines $path
        if ((Get-Value $lines 'status') -cne 'blocked') { continue }
        if ((Get-Value $lines 'blocked_kind') -cne 'definition_error') { continue }
        $tid = Get-Value $lines 'id'
        if ($tid.Length -eq 0) { continue }
        if ($revisionTasks -ccontains $tid) { continue }
        if (Test-Leased $tid) { Write-Candidate 'leased' $tid; continue }
        Write-Target $tid 'blocked_task'
      }
    }

    # Resume a preparing group whose original approval/rework lease is no longer alive before
    # opening a brand-new approval. A recovery claims the stable group id.
    foreach ($group in $groups) {
      if ($group.Status -cne 'preparing') { continue }
      $leased = (Test-Leased $group.Id) -or (Test-Leased $group.SourceDecision)
      if (-not $leased -and $group.SourceQaDecision.Length -gt 0) {
        $leased = Test-Leased $group.SourceQaDecision
      }
      if ($leased) { Write-Candidate 'leased' $group.Id; continue }
      Write-Target $group.Id 'work_group'
    }

    foreach ($root in (Get-WorkflowRoots)) {
      # An architect candidate needs neither the schema line nor a spec_id, which is why Strict is
      # false here. The created_by filter and the latest-decision verdict are the planner branch's.
      foreach ($row in @(Get-DecisionCandidates $root 'outcome: approved' $false)) {
        $decomposed = @($groups | Where-Object {
          $_.Root -ceq $root -and $_.SourceDecision -ceq $row.Id
        }).Count -gt 0
        if ($decomposed) { Write-Candidate 'decomposed' $row.Id; continue }
        # A decomposing session's lease is keyed by the decision id. Without this check the same
        # decision keeps being named while its session runs, which reads as a duplicate assignment.
        if (Test-Leased $row.Id) { Write-Candidate 'leased' $row.Id; continue }
        if ($row.Spec.Length -gt 0 -and (Test-Leased $row.Spec)) {
          Write-Candidate 'spec-leased' $row.Id
          continue
        }
        Write-Target $row.Id 'spec_approval'
      }
    }
  }
  'developer' {
    foreach ($root in (Get-WorkflowRoots)) {
      $groups = @(Get-WorkGroups $root)
      $approvedSources = @(Get-DecisionCandidates $root 'outcome: approved' $false)
      foreach ($path in (Get-Documents $root 'tasks')) {
        $lines = Get-Lines $path
        # todo, in_progress, and blocked tasks other than definition_error are candidates. A task a
        # dead session left behind carries no unexpired lease, so Test-Leased below lets it through,
        # while a live session's task is held by its lease (SPEC-035 R1). Blocked recovery keeps the
        # same lease, dependency, and overlap checks. The architect branch owns definition_error.
        $ordinary = Test-Match $lines '^status: (todo|in_progress)'
        $blocked = Test-Match $lines '^status: blocked'
        $definitionError = (Get-Value $lines 'blocked_kind') -ceq 'definition_error'
        if (-not $ordinary -and (-not $blocked -or $definitionError)) { continue }
        $tid = Get-Value $lines 'id'
        if ($tid.Length -eq 0) { continue }
        $origin = Get-TaskOrigin $lines $groups $approvedSources
        if (Test-Leased $tid) { Write-Candidate 'leased' $tid; continue }
        # Every dependency exclusion shares one reason. An unreadable declaration, an unfinished
        # predecessor and a cycle all leave the session the same thing to do: read the declaration
        # and finish what comes first.
        if (-not (Test-DependenciesSatisfied $root $tid $lines)) {
          Write-Candidate 'dependencies-unsatisfied' $tid
          continue
        }
        if (Test-Overlapped $root $tid $lines) { Write-Candidate 'overlap' $tid; continue }
        # Integration waiting is read after lease, dependency, and overlap and before the source
        # decision and work group. The first three hold independently of it, and a task waiting to
        # be integrated already came from an approved source, so the last two add nothing.
        if (Test-IntegrationWaiting $tid) { Write-Candidate 'integration-waiting' $tid; continue }
        if (-not $origin.SourceApproved) {
          Write-Candidate 'source-decision-not-approved' $tid
          continue
        }
        if (-not $origin.GroupAvailable) {
          Write-Candidate 'work-group-unavailable' $tid
          continue
        }
        Write-Target $tid
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
"#
);

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
        /// 넓어진 답이 나오는 자리(SPEC-049 R1). 대상과 후보별 제외 사유가 여기 실린다.
        pub(crate) stderr: String,
    }

    impl ConditionRun {
        /// 데몬이 실어 나르는 값. 표준 출력 첫 줄이고, 아무것도 나오지 않았으면 빈 문자열이다.
        pub(crate) fn reason(&self) -> &str {
            self.stdout.lines().next().unwrap_or_default()
        }

        /// 표준 오류에 실린 대상 문서의 id. 대상이 없으면 `None`이다.
        pub(crate) fn target(&self) -> Option<String> {
            self.stderr
                .lines()
                .find_map(|line| line.strip_prefix("target: "))
                .map(str::to_owned)
        }

        /// 판정한 후보를 판정한 차례대로 `"<사유 코드> <id>"` 꼴로 읽는다. 앱 판정의 후보 목록과
        /// 같은 모양으로 만들어 두 값을 그대로 대조한다.
        pub(crate) fn candidates(&self) -> Vec<String> {
            self.stderr
                .lines()
                .filter_map(|line| line.strip_prefix("candidate: "))
                .map(str::to_owned)
                .collect()
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
        run_condition_with_arguments(project_root, &[role])
    }

    /// 기존 판정의 표준 출력·종료 코드와 분리된, 런타임용 버전화 JSON 모드를 실행한다.
    pub(crate) fn run_machine_condition(project_root: &Path, role: &str) -> ConditionRun {
        run_condition_with_arguments(project_root, &[role, "--json"])
    }

    /// 러너가 스크립트에 물려 주는 사용자 홈. 한도 대기 관문이 보류 기록을 홈 아래에서 찾으므로,
    /// 실행하는 사람의 진짜 홈을 그대로 두면 그 기기에 남은 기록 하나가 표 전체의 답을 바꾼다.
    /// 프로젝트 루트 아래에 두는 것은 픽스처를 세우는 쪽이 이 경로를 계산할 수 있어야 하기 때문이다.
    pub(crate) const TEST_HOME: &str = ".test-home";

    fn run_condition_with_arguments(project_root: &Path, arguments: &[&str]) -> ConditionRun {
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
            .args(arguments)
            .current_dir(project_root)
            .env("HOME", project_root.join(TEST_HOME))
            .env("USERPROFILE", project_root.join(TEST_HOME))
            .output()
            .expect("run condition script");
        ConditionRun {
            code: output.status.code().expect("exit code"),
            stdout: String::from_utf8(output.stdout).expect("condition stdout is utf-8"),
            stderr: String::from_utf8(output.stderr).expect("condition stderr is utf-8"),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::{Path, PathBuf};

    use tempfile::{tempdir, TempDir};

    use super::test_support::{run_condition, run_machine_condition, ConditionRun, TEST_HOME};

    #[test]
    fn the_powershell_body_carries_a_byte_order_mark_and_the_shell_body_does_not() {
        assert!(super::CONDITION_SCRIPT_PS1.starts_with('\u{feff}'));
        assert!(super::CONDITION_SCRIPT_SH.starts_with("#!/bin/sh"));
    }
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
        assert!(script.contains("# condition_script_version: 24"));
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
            "# condition_script_version: 24",
            "# condition_script_version: 23",
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

    /// PowerShell 본문의 비ASCII는 판정이 쓰는 낱말뿐이다. 확인 절차가 사용자 행동을 말하는지
    /// 보는 판정이 한글 낱말 목록을 그대로 담아야 하므로(SPEC-073) ASCII만 쓰던 제약은 더 지킬 수
    /// 없다. 대신 좁힌 것을 남긴다 — 한글 음절과 절 제목의 가운뎃점 말고는 들어오지 않는다.
    /// 인코딩 자체는 BOM이 고정하고, 그 BOM은 바로 위 테스트가 붙든다.
    #[test]
    fn the_powershell_implementation_uses_only_the_verdict_vocabulary_beyond_ascii() {
        let unexpected = CONDITION_SCRIPT_PS1
            .trim_start_matches('\u{feff}')
            .chars()
            .filter(|character| !character.is_ascii())
            .find(|character| !matches!(character, '\u{ac00}'..='\u{d7a3}' | '\u{b7}'));
        assert_eq!(
            unexpected, None,
            "PowerShell 본문에 판정 낱말이 아닌 비ASCII 글자가 있다"
        );
    }

    /// 스크립트가 낼 수 있는 사유 코드 전부. 앱이 이 코드를 사용자 문장으로 옮긴다(SPEC-023
    /// 확인 필요 3번). 목록을 늘리면 두 본문과 시나리오 표를 함께 고쳐야 하고, 아래 두 테스트가
    /// 그 셋 중 하나라도 빠지면 실패한다.
    ///
    /// ASCII만 쓴다. PowerShell 본문이 같은 코드를 내야 하는데 그 본문은 ASCII 제약이 있다.
    const REASON_CODES: &[&str] = &[
        "eligible",
        "no-target",
        "migration-lock",
        "usage",
        "provider-limit-wait",
    ];

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

    /// 사유 코드는 ASCII다. 위의 비ASCII 어휘 검사가 본문 전체를 보지만, 어휘를
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
                "{}의 조건 스크립트 버전 999이 앱이 아는 버전 24보다 높아 덮어쓰지 않았습니다. 앱을 최신 버전으로 올린 뒤 다시 시도하세요.",
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
        write_task(&tasks, "TASK-001", "todo", None);

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
        write_task(&tasks, "TASK-001", "todo", None);

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
            "---\nschema: workflow-labs/task@1\nid: TASK-001\nstatus: verified\n---\n",
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
        let workflow_root = tasks_root.parent().expect("workflow root");
        let approval = workflow_root.join("decisions/DECISION-DEFAULT.md");
        fs::create_dir_all(approval.parent().expect("decisions root")).expect("decisions root");
        if !approval.is_file() {
            fs::write(
                &approval,
                "---\nschema: workflow-labs/decision@1\nid: DECISION-DEFAULT\nspec_id: SPEC-DEFAULT\noutcome: approved\ncreated_by: user\ncreated_at: 2026-08-01T00:00:00Z\n---\n",
            )
            .expect("default approval");
        }
        let group = workflow_root.join("groups/GROUP-DEFAULT.md");
        fs::create_dir_all(group.parent().expect("groups root")).expect("groups root");
        if !group.is_file() {
            fs::write(
                &group,
                "---\nschema: workflow-labs/work-group@1\nid: GROUP-DEFAULT\ntitle: 기본 그룹\nstatus: active\nrevision: 1\nqa_mode: automatic\nsource_spec_id: SPEC-DEFAULT\nsource_decision_id: DECISION-DEFAULT\ncreated_at: 2026-08-01T00:00:00Z\nupdated_at: 2026-08-01T00:00:00Z\n---\n",
            )
            .expect("default work group");
        }
        let line = declaration
            .map(|value| format!("{value}\n"))
            .unwrap_or_default();
        fs::write(
            tasks_root.join(format!("{id}.md")),
            format!("---\nschema: workflow-labs/task@1\nid: {id}\nstatus: {status}\nsource_spec_id: SPEC-DEFAULT\nsource_decision_id: DECISION-DEFAULT\nwork_group_id: GROUP-DEFAULT\nwork_group_revision: 1\n{line}---\n"),
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

    /// 죽은 세션이 남긴 lease. 만료된 lease는 아무것도 잡지 않으므로 판정에서 파일이 없는 것과 같다
    /// (SPEC-035 R1). 시각 표기는 [`write_lease`]와 같아야 한다 — 다른 표기는 읽히지 않아 만료 여부와
    /// 무관하게 선점에서 빠지고, 그러면 이 헬퍼가 무엇을 보이는지 알 수 없게 된다.
    fn write_expired_lease(control_root: &Path, target_id: &str) {
        let leases = control_root.join(".runtime/leases");
        fs::create_dir_all(&leases).expect("leases root");
        let expires_at = (chrono::Utc::now() - chrono::Duration::minutes(30))
            .format("%Y-%m-%dT%H:%M:%SZ")
            .to_string();
        fs::write(
            leases.join(format!("{target_id}.yml")),
            format!("schema_version: 1\nlease_id: lease-{target_id}\nagent: agent\ntask_id: {target_id}\nheartbeat_at: {expires_at}\nexpires_at: {expires_at}\n"),
        )
        .expect("write expired lease");
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

    fn run_git(project_root: &Path, arguments: &[&str]) -> i32 {
        std::process::Command::new("git")
            .args(arguments)
            .current_dir(project_root)
            .output()
            .expect("run git")
            .status
            .code()
            .expect("git exit code")
    }

    /// 픽스처 저장소의 현재 커밋.
    fn head_commit(project_root: &Path) -> String {
        let output = std::process::Command::new("git")
            .args(["rev-parse", "HEAD"])
            .current_dir(project_root)
            .output()
            .expect("run git");
        assert!(
            output.status.success(),
            "픽스처 저장소의 현재 커밋을 읽지 못했다"
        );
        String::from_utf8(output.stdout)
            .expect("git stdout is utf-8")
            .trim()
            .to_owned()
    }

    /// 격리 준비 기록 하나. 예약 헬퍼가 쓰는 것과 같은 키를 담는다.
    fn write_isolation_record(control_root: &Path, target_id: &str, step: &str, base_commit: &str) {
        let isolation = control_root.join(".runtime/isolation");
        fs::create_dir_all(&isolation).expect("isolation root");
        fs::write(
            isolation.join(format!("{target_id}.yml")),
            format!("# managed_by: workflow-labs\nschema_version: 1\ntarget_id: {target_id}\nlease_id: lease-{target_id}\nbase_commit: {base_commit}\nbranch: wf-iso/{target_id}\nworkspace_path: /tmp/{target_id}\ncontrol_root: /tmp/control\nprepared_at: 2026-08-15T00:00:00Z\nstep: {step}\n"),
        )
        .expect("write isolation record");
    }

    /// 준비 기록에 적을 기준 커밋.
    enum RecordBase {
        /// 지금 공유 기준과 같은 값. 준비한 뒤로 기준이 그대로인 상태다.
        Current,
        /// 공유 기준과 다른 값. 준비한 뒤로 기준이 전진한 상태다.
        Other,
    }

    /// 통합 대기 판정을 보는 픽스처. 작업에 더해 격리 준비 기록과 Git 상태까지 갖춘다. 저장소는
    /// `reservation_helper.rs` 시험의 `git_project`와 같은 방식으로 만든다 — `.workflow/.runtime/`를
    /// 무시하는 `.gitignore`와 추적 파일 하나를 두고 첫 커밋까지 만든다.
    ///
    /// 워크플로우 문서는 커밋하지 않으므로 미추적으로 남는다. 판정이 미추적 파일을 세지 않으므로
    /// `dirty`가 거짓인 픽스처의 작업 공간은 깨끗하고, 참이면 추적 파일 하나가 미커밋으로 바뀐다.
    fn developer_run_with_isolation(
        tasks: &[(&str, &str, Option<&str>)],
        records: &[(&str, &str, RecordBase)],
        dirty: bool,
    ) -> ConditionRun {
        let (root, control) = project();
        install_condition_script(&control).expect("install condition script");
        let tasks_root = control.join("wf-demo/tasks");
        fs::create_dir_all(&tasks_root).expect("tasks root");
        for (id, status, declaration) in tasks {
            write_task(&tasks_root, id, status, *declaration);
        }
        fs::write(root.path().join(".gitignore"), ".workflow/.runtime/\n").expect("gitignore");
        fs::write(root.path().join("README.md"), "base\n").expect("tracked file");
        assert_eq!(run_git(root.path(), &["init", "-b", "main"]), 0);
        assert_eq!(
            run_git(root.path(), &["config", "core.autocrlf", "false"]),
            0
        );
        assert_eq!(run_git(root.path(), &["add", ".gitignore", "README.md"]), 0);
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
            ),
            0
        );
        let head = head_commit(root.path());
        for (target_id, step, base) in records {
            let base_commit = match base {
                RecordBase::Current => head.clone(),
                RecordBase::Other => "0".repeat(40),
            };
            write_isolation_record(&control, target_id, step, &base_commit);
        }
        if dirty {
            fs::write(root.path().join("README.md"), "base\n사용자 편집\n")
                .expect("dirty tracked file");
        }
        run_condition(root.path(), "developer")
    }

    /// 격리 검사를 마치고도 사용자의 미커밋 변경 때문에 반영하지 못한 작업은, 그 상황이 그대로인
    /// 동안 후보에서 빠진다. 이것이 없으면 같은 작업이 같은 이유로 되풀이해 시작된다.
    #[test]
    fn a_task_waiting_for_integration_is_not_a_developer_candidate() {
        let run = developer_run_with_isolation(
            &[("TASK-001", "in_progress", None)],
            &[("TASK-001", "integration_waiting", RecordBase::Current)],
            true,
        );

        assert_eq!(run.code, 1, "통합을 기다리는 작업만 있으면 대상이 없다");
        assert_eq!(run.candidates(), vec!["integration-waiting TASK-001"]);
    }

    /// 기다리는 이유가 사라지면 그대로 다시 후보다. 사용자가 자기 변경을 정리한 경우와 공유 기준이
    /// 전진한 경우 둘 다이며, 뒤엣것은 작업 공간이 여전히 더러워도 성립한다.
    #[test]
    fn a_waiting_task_returns_to_the_candidates_when_the_reason_to_wait_is_gone() {
        assert_eq!(
            developer_run_with_isolation(
                &[("TASK-001", "in_progress", None)],
                &[("TASK-001", "integration_waiting", RecordBase::Current)],
                false,
            )
            .code,
            0,
            "작업 공간이 깨끗해지면 다시 후보다"
        );
        assert_eq!(
            developer_run_with_isolation(
                &[("TASK-001", "in_progress", None)],
                &[("TASK-001", "integration_waiting", RecordBase::Other)],
                true,
            )
            .code,
            0,
            "기준 커밋이 전진하면 작업 공간이 더러워도 다시 후보다"
        );
    }

    /// 통합 대기가 아닌 기록과 기록이 없는 작업은 이 판정이 없던 때와 같게 판정한다.
    #[test]
    fn a_record_that_is_not_integration_waiting_changes_no_verdict() {
        assert_eq!(
            developer_run_with_isolation(
                &[("TASK-001", "in_progress", None)],
                &[("TASK-001", "ready", RecordBase::Current)],
                true,
            )
            .code,
            0,
            "준비 완료 기록은 후보에서 빼지 않는다"
        );
        assert_eq!(
            developer_run_with_isolation(&[("TASK-001", "in_progress", None)], &[], true).code,
            0,
            "기록이 없는 작업은 후보에서 빼지 않는다"
        );
    }

    /// 통합 대기 제외는 그 작업 하나에만 미친다. 겹치지 않는 다른 작업은 그동안 정상적으로 진행된다.
    #[test]
    fn another_task_stays_a_candidate_while_one_waits_for_integration() {
        let run = developer_run_with_isolation(
            &[
                ("TASK-001", "in_progress", Some("scope_files: [src/a.rs]")),
                ("TASK-002", "todo", Some("scope_files: [src/b.rs]")),
            ],
            &[("TASK-001", "integration_waiting", RecordBase::Current)],
            true,
        );

        assert_eq!(run.code, 0);
        assert_eq!(run.target().as_deref(), Some("TASK-002"));
        assert_eq!(
            run.candidates(),
            vec!["integration-waiting TASK-001", "eligible TASK-002"]
        );
    }

    /// 기록은 통합 대기인데 기준을 읽을 수 없으면 제외한 채로 둔다. 기다림이 끝났다는 근거를 얻지
    /// 못한 상태이고, 근거 없이 후보로 되돌리면 막으려던 반복 기동이 그대로 남는다.
    #[test]
    fn a_waiting_task_stays_excluded_when_the_shared_base_cannot_be_read() {
        let (root, control) = project();
        install_condition_script(&control).expect("install condition script");
        let tasks_root = control.join("wf-demo/tasks");
        fs::create_dir_all(&tasks_root).expect("tasks root");
        write_task(&tasks_root, "TASK-001", "in_progress", None);
        write_isolation_record(&control, "TASK-001", "integration_waiting", &"0".repeat(40));

        let run = run_condition(root.path(), "developer");

        assert_eq!(run.code, 1, "Git 작업 트리가 아니면 통합 대기를 유지한다");
        assert_eq!(run.candidates(), vec!["integration-waiting TASK-001"]);
    }

    #[test]
    fn a_task_without_a_declaration_stays_eligible() {
        assert_eq!(developer_exit_code(&[("TASK-001", "todo", None)], &[]), 0);
    }

    #[test]
    fn a_non_definition_block_keeps_lease_and_dependency_guards() {
        assert_eq!(
            developer_exit_code(
                &[(
                    "TASK-001",
                    "blocked",
                    Some("blocked_kind: implementation_failure"),
                )],
                &["TASK-001"],
            ),
            1,
            "활성 lease가 복구 작업을 막는다"
        );
        assert_eq!(
            developer_exit_code(
                &[(
                    "TASK-001",
                    "blocked",
                    Some("blocked_kind: implementation_failure\ndepends_on: [TASK-404]",),
                )],
                &[],
            ),
            1,
            "미충족 선행이 복구 작업을 막는다"
        );
    }

    /// 선행을 후보에서 빼는 lease가 겹침 판정(SPEC-032)에도 걸리므로, 두 작업이 서로 다른 파일을
    /// 선언한다. 선언이 없으면 잡힌 lease 하나만으로 막히고 선행 충족 여부가 가려진다.
    #[test]
    fn a_verified_dependency_satisfies_the_declaration() {
        assert_eq!(
            developer_exit_code(
                &[
                    (
                        "TASK-001",
                        "todo",
                        Some("depends_on: [TASK-002]\nscope_files: [src/one.rs]")
                    ),
                    ("TASK-002", "verified", Some("scope_files: [src/two.rs]")),
                ],
                &["TASK-002"],
            ),
            0
        );
    }

    /// 선행 자신이 후보가 되지 않도록 lease로 제외한 뒤, 후행만 남았을 때의 판정을 본다.
    #[test]
    fn an_unfinished_dependency_blocks_the_task() {
        for status in [
            "todo",
            "in_progress",
            "blocked",
            "qa_waiting",
            "completed",
            "archived",
        ] {
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
                    ("TASK-002", "verified", None),
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
                    ("TASK-002", "verified", Some("depends_on: [TASK-001]")),
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
                        ("TASK-002", "verified", None),
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
                    ("TASK-002", "verified", None),
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
                    ("TASK-002", "verified", Some("depends_on: [oops!]")),
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
        write_task(&second, "TASK-002", "verified", None);

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
            "---\nschema: workflow-labs/task@1\nid: TASK-001\nstatus: todo\nsource_spec_id: SPEC-001\nsource_decision_id: DECISION-001\nwork_group_id: GROUP-001\nwork_group_revision: 1\ndepends_on: [TASK-999]\n---\n",
        )
        .expect("task with a declaration");
        write_work_group(&control, "GROUP-001", "active", 1, "DECISION-001", None);

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
        let decision = "---\nschema: workflow-labs/decision@1\nid: DECISION-001\nspec_id: SPEC-001\noutcome: revision_requested\ncreated_by: user\ncreated_at: 2026-08-01T00:00:00Z\n---\n";

        assert_eq!(
            planner_exit_code(&[("DECISION-001", decision)], &[], &[]),
            0
        );
    }

    /// 비-`draft` 후속 기획서가 결정 id를 참조하면 닫힌다. 선점한 lease도 같은 결과를 만든다.
    /// 후속이 `draft`면 멈춘 재작업이라 닫히지 않고, 그 답은 시나리오 표의
    /// "기획자: draft 재작업 기획서만 남은 수정 요청이 다시 열린다"가 고정한다(SPEC-035 R2).
    #[test]
    fn an_answered_or_claimed_revision_request_closes_planner_work() {
        let decision = "---\nschema: workflow-labs/decision@1\nid: DECISION-001\nspec_id: SPEC-001\noutcome: revision_requested\ncreated_by: user\ncreated_at: 2026-08-01T00:00:00Z\n---\n";
        let follow_up = "---\nschema: workflow-labs/spec@1\nid: SPEC-002\nstatus: user_review\nsource_decision_id: DECISION-001\n---\n";

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
        let request = "---\nschema: workflow-labs/decision@1\nid: DECISION-001\nspec_id: SPEC-001\noutcome: revision_requested\ncreated_by: user\ncreated_at: 2026-08-01T00:00:00Z\n---\n";
        let later = "---\nschema: workflow-labs/decision@1\nid: DECISION-002\nspec_id: SPEC-001\noutcome: approved\ncreated_by: user\ncreated_at: 2026-08-02T00:00:00Z\n---\n";
        let tied = "---\nschema: workflow-labs/decision@1\nid: DECISION-002\nspec_id: SPEC-001\noutcome: approved\ncreated_by: user\ncreated_at: 2026-08-01T00:00:00Z\n---\n";
        let other_spec = "---\nschema: workflow-labs/decision@1\nid: DECISION-002\nspec_id: SPEC-002\noutcome: approved\ncreated_by: user\ncreated_at: 2026-08-09T00:00:00Z\n---\n";

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

    /// 프로젝트 안 역할·실행 도구 대응표. `build`가 받는 것은 컨트롤 루트이고 앱이 쓰는 자리도
    /// 컨트롤 루트 아래이므로, 두 자리가 같은 경로를 가리킨다.
    fn write_role_provider_map(control_root: &Path, lines: &str) {
        let runtime = control_root.join(".runtime");
        fs::create_dir_all(&runtime).expect("runtime root");
        fs::write(
            runtime.join("role-providers.yml"),
            format!("schema_version: 1\n{lines}"),
        )
        .expect("write role provider map");
    }

    /// 기기 단위 보류 기록. 프로젝트 밖 사용자 홈 아래에 있으므로 러너가 물려 주는
    /// [`TEST_HOME`] 아래에 쓴다. 본문은 앱이 쓰는 여섯 줄과 같다.
    fn write_provider_hold(control_root: &Path, provider: &str, resume_at: &str) {
        let holds = control_root
            .parent()
            .expect("project root")
            .join(TEST_HOME)
            .join(".workflow-labs")
            .join("provider-holds");
        fs::create_dir_all(&holds).expect("holds root");
        fs::write(
            holds.join(format!("{provider}.yml")),
            format!("schema_version: 1\nprovider: {provider}\nresume_at: {resume_at}\nresume_at_known: true\nrecorded_at: 2026-08-01T00:00:00Z\nrun_id: run-1\n"),
        )
        .expect("write provider hold");
    }

    /// 지금을 기준으로 한 계약 표기의 시각. 보류 판정이 실행 시점의 지금과 비교하므로 표에 시각을
    /// 박아 둘 수 없다.
    fn hold_stamp(minutes: i64) -> String {
        (chrono::Utc::now() + chrono::Duration::minutes(minutes))
            .format("%Y-%m-%dT%H:%M:%SZ")
            .to_string()
    }

    fn write_idea_document(control_root: &Path, id: &str) {
        write_document(
            control_root,
            "ideas",
            id,
            &format!("---\nschema: workflow-labs/idea@1\nid: {id}\nstatus: inbox\n---\n"),
        );
    }

    fn write_work_group(
        control_root: &Path,
        id: &str,
        status: &str,
        revision: u32,
        source_decision_id: &str,
        source_qa_decision_id: Option<&str>,
    ) {
        let source_qa = source_qa_decision_id
            .map(|value| format!("source_qa_decision_id: {value}\n"))
            .unwrap_or_default();
        write_document(
            control_root,
            "groups",
            id,
            &format!(
                "---\nschema: workflow-labs/work-group@1\nid: {id}\ntitle: 그룹 {id}\nstatus: {status}\nrevision: {revision}\nqa_mode: user\nsource_spec_id: SPEC-001\nsource_decision_id: {source_decision_id}\n{source_qa}created_at: 2026-08-01T00:00:00Z\nupdated_at: 2026-08-01T00:00:00Z\n---\n\n# 그룹 {id}\n\n### QA-01 · 화면 확인\n\n화면에서 결과를 확인한다.\n"
            ),
        );
    }

    /// 기능 하나를 그 자체로 성립하게 만드는 검증 완료 작업. 기능에 속한 작업이 하나도 없으면
    /// 표시 상태가 구성 확인 필요가 되어 아키텍트 대상이 되므로, 다른 것을 보는 시나리오는 이
    /// 작업을 함께 놓아 그 상태를 피한다.
    fn write_group_member_task(
        control_root: &Path,
        id: &str,
        group_id: &str,
        source_decision_id: &str,
    ) {
        write_document(
            control_root,
            "tasks",
            id,
            &format!(
                "---\nschema: workflow-labs/task@1\nid: {id}\ntitle: 작업\nstatus: verified\nsource_spec_id: SPEC-001\nsource_decision_id: {source_decision_id}\nwork_group_id: {group_id}\nwork_group_revision: 1\nupdated_at: 2026-08-01T00:00:00Z\n---\n\n작업 본문\n"
            ),
        );
    }

    fn write_group_qa_revision_request(
        control_root: &Path,
        id: &str,
        group_id: &str,
        revision: u32,
        created_at: &str,
    ) {
        write_group_qa_decision(
            control_root,
            id,
            id,
            group_id,
            revision,
            "revision_requested",
            Some(&format!("REQUEST-{id}")),
            created_at,
        );
    }

    #[allow(clippy::too_many_arguments)]
    fn write_group_qa_decision(
        control_root: &Path,
        file_name: &str,
        id: &str,
        group_id: &str,
        revision: u32,
        outcome: &str,
        request_id: Option<&str>,
        created_at: &str,
    ) {
        let request = request_id
            .map(|value| format!("request_id: {value}\n"))
            .unwrap_or_default();
        write_document(
            control_root,
            "decisions",
            file_name,
            &format!(
                "---\nschema: workflow-labs/group-qa-decision@1\nid: {id}\ngroup_id: {group_id}\ngroup_revision: {revision}\noutcome: {outcome}\n{request}created_by: user\ncreated_at: {created_at}\n---\n"
            ),
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

    /// `created_by`와 `created_at`을 부르는 쪽이 정하는 수정 요청 결정. 기획자 분기의 `created_by`
    /// 필터를 보는 행이 쓴다. [`write_later_revision_request`]는 두 값을 본문에 박아 두어 그 행을
    /// 세우지 못하므로, 시그니처를 바꾸는 대신 이 헬퍼를 따로 둔다.
    fn write_revision_request_document(
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
            &format!("---\nschema: workflow-labs/decision@1\nid: {id}\nspec_id: {spec_id}\noutcome: revision_requested\ncreated_by: {created_by}\ncreated_at: {created_at}\n---\n"),
        );
    }

    /// 두 번째 워크플로우에 놓는 수정 요청 결정. 최신 판정 표가 워크플로우 안에서만 만들어지는
    /// 것을 보는 행이 쓴다. 스크립트는 `.workflow/*/`를 전부 도므로 디렉터리만 있으면 된다.
    fn write_other_workflow_decision(control_root: &Path, id: &str, spec_id: &str, at: &str) {
        let directory = control_root.join("wf-other").join("decisions");
        fs::create_dir_all(&directory).expect("other workflow root");
        fs::write(
            directory.join(format!("{id}.md")),
            format!("---\nschema: workflow-labs/decision@1\nid: {id}\nspec_id: {spec_id}\noutcome: revision_requested\ncreated_by: user\ncreated_at: {at}\n---\n"),
        )
        .expect("write decision");
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
            // 참조하는 기획서가 `draft`이면 그 아이디어는 다시 열린다(SPEC-035 R2). 이 행이 보는
            // 것은 닫히는 쪽이므로 참조하는 기획서를 비-`draft`로 둔다. 열리는 쪽은 아래 회수
            // 행들이 본다.
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
                    "---\nschema: workflow-labs/spec@1\nid: SPEC-001\nstatus: user_review\nsource_idea_id: IDEA-001\n---\n",
                );
            },
        },
        Scenario {
            // 옛 계약의 기획서는 원천을 `source_idea:`로 적었다. 그 참조도 아이디어를 닫아야
            // 이미 기획된 아이디어가 중복 배정되지 않는다(v17 하위호환).
            name: "기획자: 옛 필드로 참조된 아이디어도 닫힌다",
            roles: &["planner"],
            expected: 1,
            reason: "no-target",
            build: |control: &Path| {
                write_idea_document(control, "IDEA-001");
                write_document(
                    control,
                    "specs",
                    "SPEC-001",
                    "---\nschema: workflow-labs/spec@1\nid: SPEC-001\nstatus: user_review\nsource_idea: IDEA-001\n---\n",
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
        // 아래 두 행이 SPEC-030 R1의 기획자 판정이다. 아키텍트 분기가 이미 갖고 있던 `created_by`
        // 필터를 기획자 분기의 두 자리 — 후보 선택과 비교 루프 — 에도 넣은 것을 본다. 한 방향씩
        // 나뉘어 있어야 한 자리만 고친 구현이 걸린다.
        Scenario {
            // 가림 방향. 대리 승인이 뒤에 붙었다고 사용자의 수정 요청이 최신 자리에서 밀려나면,
            // 앱은 그 수정 요청을 계속 재작업 대상으로 세는데 하트비트만 기획자를 깨우지 않는다.
            // 비교 루프가 `created_by`를 보는지가 여기서 보인다.
            name: "기획자: 수정 요청 뒤에 대리 승인이 붙었다",
            roles: &["planner"],
            expected: 0,
            reason: "eligible",
            build: |control: &Path| {
                write_revision_request_document(
                    control,
                    "DECISION-001",
                    "SPEC-001",
                    "user",
                    "2026-08-01T00:00:00Z",
                );
                write_decision_document(
                    control,
                    "DECISION-002",
                    "SPEC-001",
                    "user-delegate",
                    "2026-08-02T00:00:00Z",
                );
            },
        },
        Scenario {
            // 헛기동 방향. 앱의 두 읽기 경로가 세지 않는 결정이므로 후보로도 골라선 안 된다.
            // 값 전체를 비교하는지가 여기서 보인다 — 접두 일치면 `user-delegate`가 통과해 계약상
            // 유효한 대상이 없는데도 기획자 세션이 깨어난다.
            name: "기획자: created_by가 user가 아닌 수정 요청만 있다",
            roles: &["planner"],
            expected: 1,
            reason: "no-target",
            build: |control: &Path| {
                write_revision_request_document(
                    control,
                    "DECISION-001",
                    "SPEC-001",
                    "user-delegate",
                    "2026-08-01T00:00:00Z",
                );
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
            name: "아키텍트: 모든 승인 결정에 작업 그룹이 있다",
            roles: &["architect"],
            expected: 1,
            reason: "no-target",
            build: |control: &Path| {
                write_approved_decision(control, "DECISION-001", "SPEC-001");
                write_work_group(control, "GROUP-001", "active", 1, "DECISION-001", None);
                write_group_member_task(control, "TASK-001", "GROUP-001", "DECISION-001");
            },
        },
        Scenario {
            name: "아키텍트: 그룹 QA 반려가 재분류 대상으로 열린다",
            roles: &["architect"],
            expected: 0,
            reason: "eligible",
            build: |control: &Path| {
                write_work_group(control, "GROUP-001", "active", 1, "DECISION-001", None);
                write_group_qa_revision_request(
                    control,
                    "GROUP-QA-001",
                    "GROUP-001",
                    1,
                    "2026-08-02T00:00:00Z",
                );
            },
        },
        Scenario {
            name: "아키텍트: 같은 revision의 source QA 표기가 현재 반려를 숨기지 않는다",
            roles: &["architect"],
            expected: 0,
            reason: "eligible",
            build: |control: &Path| {
                write_work_group(
                    control,
                    "GROUP-001",
                    "active",
                    1,
                    "DECISION-001",
                    Some("GROUP-QA-001"),
                );
                write_group_qa_revision_request(
                    control,
                    "GROUP-QA-001",
                    "GROUP-001",
                    1,
                    "2026-08-02T00:00:00Z",
                );
            },
        },
        Scenario {
            name: "아키텍트: 이미 답한 그룹 QA 반려는 다시 열리지 않는다",
            roles: &["architect"],
            expected: 1,
            reason: "no-target",
            build: |control: &Path| {
                write_work_group(
                    control,
                    "GROUP-001",
                    "active",
                    2,
                    "DECISION-001",
                    Some("GROUP-QA-001"),
                );
                write_group_qa_revision_request(
                    control,
                    "GROUP-QA-001",
                    "GROUP-001",
                    1,
                    "2026-08-02T00:00:00Z",
                );
                write_group_member_task(control, "TASK-001", "GROUP-001", "DECISION-001");
            },
        },
        Scenario {
            name: "아키텍트: lease가 끊긴 preparing 그룹을 복구한다",
            roles: &["architect"],
            expected: 0,
            reason: "eligible",
            build: |control: &Path| {
                write_work_group(control, "GROUP-001", "preparing", 1, "DECISION-001", None);
            },
        },
        Scenario {
            name: "아키텍트: preparing 그룹의 원 승인 lease가 살아 있다",
            roles: &["architect"],
            expected: 1,
            reason: "no-target",
            build: |control: &Path| {
                write_work_group(control, "GROUP-001", "preparing", 1, "DECISION-001", None);
                write_lease(control, "DECISION-001");
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
        Scenario {
            // 분해 중인 세션의 lease는 결정 id로 잡힌다. 이 검사가 없으면 세션이 도는 동안
            // 같은 결정이 다시 대상으로 나가 중복 배정으로 보인다(v18).
            name: "아키텍트: 그 결정 자체에 lease가 있다",
            roles: &["architect"],
            expected: 1,
            reason: "no-target",
            build: |control: &Path| {
                write_approved_decision(control, "DECISION-001", "SPEC-001");
                write_lease(control, "DECISION-001");
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
                write_work_group(control, "GROUP-001", "active", 1, "DECISION-001", None);
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
            build: |control: &Path| write_task_document(control, "TASK-001", "verified", None),
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
                write_task_document(control, "TASK-002", "verified", None);
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
        // 겹침 선언 네 행은 TASK-101이 도입한 판정을 본다. 규칙의 단일 정의는 같은 작업이 쓴
        // `fs_project_repository`의 `overlap_block`이고, 대조는 `role_eligibility`가 한다.
        Scenario {
            name: "개발자: 겹치는 작업이 잡혀 있다",
            roles: &["developer"],
            expected: 1,
            reason: "no-target",
            build: |control: &Path| {
                write_task_document(
                    control,
                    "TASK-001",
                    "todo",
                    Some("scope_files: [src/shared.rs]"),
                );
                write_task_document(
                    control,
                    "TASK-002",
                    "in_progress",
                    Some("scope_files: [src/shared.rs]"),
                );
                write_lease(control, "TASK-002");
            },
        },
        Scenario {
            // 위 행과 다른 것은 선언 한 줄뿐이다.
            name: "개발자: 잡힌 작업과 겹치지 않는다",
            roles: &["developer"],
            expected: 0,
            reason: "eligible",
            build: |control: &Path| {
                write_task_document(
                    control,
                    "TASK-001",
                    "todo",
                    Some("scope_files: [src/one.rs]"),
                );
                write_task_document(
                    control,
                    "TASK-002",
                    "in_progress",
                    Some("scope_files: [src/two.rs]"),
                );
                write_lease(control, "TASK-002");
            },
        },
        Scenario {
            // 선언이 없는 작업은 무엇과 겹치는지 알 수 없다. 잡힌 lease 하나로 막힌다.
            name: "개발자: 선언 없는 작업 옆에 잡힌 lease가 있다",
            roles: &["developer"],
            expected: 1,
            reason: "no-target",
            build: |control: &Path| {
                write_task_document(control, "TASK-001", "todo", None);
                write_task_document(
                    control,
                    "TASK-002",
                    "in_progress",
                    Some("scope_files: [src/two.rs]"),
                );
                write_lease(control, "TASK-002");
            },
        },
        Scenario {
            // lease가 잡은 것이 작업 문서가 아니면 비교할 상대가 없다.
            name: "개발자: 작업이 아닌 문서를 잡은 lease는 선언을 막지 않는다",
            roles: &["developer"],
            expected: 0,
            reason: "eligible",
            build: |control: &Path| {
                write_task_document(
                    control,
                    "TASK-001",
                    "todo",
                    Some("scope_files: [src/one.rs]"),
                );
                write_lease(control, "SPEC-001");
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
        // ── SPEC-071 한도 대기 관문 ─────────────────────────────────────────────────
        //
        // 관문은 대응표(프로젝트 안)와 보류 기록(기기 단위 홈) 둘을 함께 읽어야 서므로, 두 본문이
        // 같은 값을 같은 자리에서 읽는지는 실행 결과 대조로만 확인된다. 아래 여섯 행이 관문이 서는
        // 경우 하나와, 서지 않아야 하는 경우 다섯을 덮는다.
        Scenario {
            // 처리할 대상이 있는 저장소에서 본다. 관문이 후보 판정보다 앞에 선다는 사실이 이 행에서만
            // 드러난다 — 대상이 없는 픽스처였다면 1이 관문 때문인지 대상이 없어서인지 갈리지 않는다.
            name: "개발자: 한도 대기 중인 실행 도구는 대상이 있어도 배정하지 않는다",
            roles: &["developer"],
            expected: 1,
            reason: "provider-limit-wait",
            build: |control: &Path| {
                write_task_document(control, "TASK-001", "todo", None);
                write_role_provider_map(control, "developer: claude\n");
                write_provider_hold(control, "claude", &hold_stamp(30));
            },
        },
        Scenario {
            // 보류는 실행 도구 단위다(R-07). 같은 대응표에서 다른 도구를 가리키는 역할은 평소대로다.
            name: "기획자: 다른 실행 도구를 쓰는 역할은 한도 대기에 걸리지 않는다",
            roles: &["planner"],
            expected: 0,
            reason: "eligible",
            build: |control: &Path| {
                write_idea_document(control, "IDEA-001");
                write_role_provider_map(control, "developer: claude\nplanner: codex\n");
                write_provider_hold(control, "claude", &hold_stamp(30));
            },
        },
        Scenario {
            // 재개 시각이 지나면 사용자가 아무 조작을 하지 않아도 배정이 돌아온다(R-10).
            name: "개발자: 지난 재개 시각은 관문을 세우지 않는다",
            roles: &["developer"],
            expected: 0,
            reason: "eligible",
            build: |control: &Path| {
                write_task_document(control, "TASK-001", "todo", None);
                write_role_provider_map(control, "developer: claude\n");
                write_provider_hold(control, "claude", &hold_stamp(-30));
            },
        },
        Scenario {
            // 대응표가 없으면 역할이 어느 도구를 쓰는지 알 수 없다. 모르는 것은 보류가 아니다(R-23).
            name: "개발자: 대응표가 없으면 지금과 같이 판정한다",
            roles: &["developer"],
            expected: 0,
            reason: "eligible",
            build: |control: &Path| {
                write_task_document(control, "TASK-001", "todo", None);
                write_provider_hold(control, "claude", &hold_stamp(30));
            },
        },
        Scenario {
            // 오프셋 표기는 이 계약의 읽는 쪽이 받지 않는다. 읽히지 않은 값은 시각이 아니므로 관문을
            // 세우지 않는다(R-23).
            name: "개발자: 기록의 시각 표기가 계약 밖이면 지금과 같이 판정한다",
            roles: &["developer"],
            expected: 0,
            reason: "eligible",
            build: |control: &Path| {
                write_task_document(control, "TASK-001", "todo", None);
                write_role_provider_map(control, "developer: claude\n");
                write_provider_hold(control, "claude", "2099-01-01T00:00:00+09:00");
            },
        },
        Scenario {
            // 이름이 곧 파일 이름이다. 정해진 문자 밖의 값으로는 기록을 찾지 않고, 그 상태를 보류로도
            // 바꾸지 않는다. 대응표에 줄이 아예 없는 경우와 같은 답이어야 한다.
            name: "개발자: 실행 도구 이름이 쓸 수 없는 값이면 지금과 같이 판정한다",
            roles: &["developer"],
            expected: 0,
            reason: "eligible",
            build: |control: &Path| {
                write_task_document(control, "TASK-001", "todo", None);
                write_role_provider_map(control, "developer: cla ude\n");
                write_provider_hold(control, "claude", &hold_stamp(30));
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
        // 아래 여덟 행이 TASK-104의 반복 훑기 제거를 본다. 판정 규칙은 바뀌지 않았으므로 이 행들의
        // 기대값은 전부 착수 시점 본문의 답이다. 무엇이 옳은지가 아니라 무엇이 같은지를 본다.
        // 승인 뒤에 더 늦은 수정 요청이 붙는 경우는 이미 표에 있는
        // "아키텍트: 승인 뒤에 더 늦은 결정이 붙었다"가 덮는다.
        Scenario {
            // 동률은 최신으로 남는다. 최댓값 표가 자기 자신을 포함해도 답이 같다는 것을 고정하는
            // 행이다 — 자기 값 하나로 밀려난다면 두 결정이 서로를 밀어내 자격이 닫힌다.
            name: "아키텍트: 같은 기획서에 동시각 승인이 둘 있다",
            roles: &["architect"],
            expected: 0,
            reason: "eligible",
            build: |control: &Path| {
                write_decision_document(
                    control,
                    "DECISION-001",
                    "SPEC-001",
                    "user",
                    "2026-08-01T00:00:00Z",
                );
                write_decision_document(
                    control,
                    "DECISION-002",
                    "SPEC-001",
                    "user",
                    "2026-08-01T00:00:00Z",
                );
            },
        },
        Scenario {
            // 위임 대리 결정은 최신 자리를 차지하지 못한다. 최댓값 표도 `created_by`로 걸러진다는
            // 뜻이고, 위임 대리 결정이 승인을 밀어내지 않는다는 SPEC-030의 답이 그대로다.
            name: "아키텍트: 승인 뒤에 더 늦은 대리 결정이 붙었다",
            roles: &["architect"],
            expected: 0,
            reason: "eligible",
            build: |control: &Path| {
                write_approved_decision(control, "DECISION-001", "SPEC-001");
                write_decision_document(
                    control,
                    "DECISION-002",
                    "SPEC-001",
                    "user-delegate",
                    "2026-08-02T00:00:00Z",
                );
            },
        },
        Scenario {
            // 표가 `spec_id`로 갈리는 것을 고정한다. 하나의 표에 모든 결정을 담고 최댓값을 하나만
            // 두면 이 행이 닫힌다.
            name: "아키텍트: 다른 기획서의 더 늦은 결정은 밀어내지 않는다",
            roles: &["architect"],
            expected: 0,
            reason: "eligible",
            build: |control: &Path| {
                write_approved_decision(control, "DECISION-001", "SPEC-001");
                write_later_revision_request(control, "DECISION-002", "SPEC-002");
            },
        },
        Scenario {
            // `spec_id`가 없는 승인은 후보가 되고, `spec_id`가 비었으므로 lease를 보지 않는다.
            name: "아키텍트: spec_id가 없는 승인 결정이 있다",
            roles: &["architect"],
            expected: 0,
            reason: "eligible",
            build: |control: &Path| {
                write_document(
                    control,
                    "decisions",
                    "DECISION-001",
                    "---\nschema: workflow-labs/decision@1\nid: DECISION-001\noutcome: approved\ncreated_by: user\ncreated_at: 2026-08-01T00:00:00Z\n---\n",
                );
            },
        },
        Scenario {
            // `id` 줄이 없는 문서는 건너뛴다(`role_eligibility`의 알려진 차이 2번). `spec_id:` 줄은
            // `id:`로 시작하지 않으므로 id 자리에 들어가지 않는다.
            name: "아키텍트: id가 없는 승인 결정만 있다",
            roles: &["architect"],
            expected: 1,
            reason: "no-target",
            build: |control: &Path| {
                write_document(
                    control,
                    "decisions",
                    "DECISION-001",
                    "---\nschema: workflow-labs/decision@1\nspec_id: SPEC-001\noutcome: approved\ncreated_by: user\ncreated_at: 2026-08-01T00:00:00Z\n---\n",
                );
            },
        },
        Scenario {
            // 참조 판정의 부분 일치가 어느 방향인지를 명시하는 두 행 중 하나. `IDEA-1`을 참조한
            // 기획서는 `IDEA-12`를 처리 완료로 만들지 않는다 — `source_idea_id: *IDEA-12`가
            // `source_idea_id: IDEA-1` 줄에 걸리지 않기 때문이다.
            // 두 행의 기획서는 비-`draft`다. `draft`면 그 참조 줄이 목록에 아예 들어오지 않아
            // (SPEC-035 R2) 부분 일치가 무엇을 하는지 보이지 않는다.
            name: "기획자: IDEA-1을 참조한 기획서가 IDEA-12를 닫지 않는다",
            roles: &["planner"],
            expected: 0,
            reason: "eligible",
            build: |control: &Path| {
                write_idea_document(control, "IDEA-1");
                write_idea_document(control, "IDEA-12");
                write_document(
                    control,
                    "specs",
                    "SPEC-001",
                    "---\nschema: workflow-labs/spec@1\nid: SPEC-001\nstatus: user_review\nsource_idea_id: IDEA-1\n---\n",
                );
            },
        },
        Scenario {
            // 반대 방향. `IDEA-12`만 참조돼도 `source_idea_id: *IDEA-1`이 그 줄에 걸려 `IDEA-1`까지
            // 닫힌다. 착수 시점 본문의 답이 그것이므로 그대로 적는다. 무엇이 옳은지를 여기서
            // 정하지 않는다 — 이 행이 지키는 것은 앵커 없는 부분 일치가 보존됐다는 사실이다.
            name: "기획자: IDEA-12를 참조한 기획서가 IDEA-1까지 닫는다",
            roles: &["planner"],
            expected: 1,
            reason: "no-target",
            build: |control: &Path| {
                write_idea_document(control, "IDEA-1");
                write_idea_document(control, "IDEA-12");
                write_document(
                    control,
                    "specs",
                    "SPEC-001",
                    "---\nschema: workflow-labs/spec@1\nid: SPEC-001\nstatus: user_review\nsource_idea_id: IDEA-12\n---\n",
                );
            },
        },
        Scenario {
            // 최댓값 표가 워크플로우 안에서만 만들어지는 것을 고정한다. 다른 워크플로우의 더 늦은
            // 결정이 이쪽 후보를 밀어내면 워크플로우 하나를 넘는 짝짓기가 생긴 것이다.
            name: "아키텍트: 다른 워크플로우의 더 늦은 결정은 밀어내지 않는다",
            roles: &["architect"],
            expected: 0,
            reason: "eligible",
            build: |control: &Path| {
                write_approved_decision(control, "DECISION-001", "SPEC-001");
                write_other_workflow_decision(
                    control,
                    "DECISION-002",
                    "SPEC-001",
                    "2026-08-02T00:00:00Z",
                );
            },
        },
        // 아래 열두 행이 SPEC-035 R1·R2의 회수 판정이다(기획서 완료 조건 15). 두 본문이 같은 답을
        // 내야 하는 자리이고, 표는 현재 플랫폼의 구현을 돌리므로 Windows 러너가 PowerShell 본문의
        // 같은 행들을 통과시킨다. 앱 이식본까지 셋을 대조하는 것은 `role_eligibility`의 몫이다.
        Scenario {
            // 죽은 개발 세션의 시그니처. lease는 풀렸는데 상태가 `in_progress`라 아무도 집지 않던
            // 자리가 여기서 열린다.
            name: "개발자: 멈춘 in_progress 작업에 lease가 없다",
            roles: &["developer"],
            expected: 0,
            reason: "eligible",
            build: |control: &Path| write_task_document(control, "TASK-001", "in_progress", None),
        },
        Scenario {
            // 만료된 lease는 파일이 없는 것과 같은 답을 낸다. 만료 뒤에 유예를 두지 않는다는 것이
            // 승인된 확인 필요 2번이다.
            name: "개발자: 멈춘 in_progress 작업을 만료된 lease가 덮는다",
            roles: &["developer"],
            expected: 0,
            reason: "eligible",
            build: |control: &Path| {
                write_task_document(control, "TASK-001", "in_progress", None);
                write_expired_lease(control, "TASK-001");
            },
        },
        Scenario {
            // 살아 있는 세션의 작업. 회수가 정상적으로 일하고 있는 세션의 작업을 빼앗지 않는다.
            name: "개발자: in_progress 작업을 미만료 lease가 덮는다",
            roles: &["developer"],
            expected: 1,
            reason: "no-target",
            build: |control: &Path| {
                write_task_document(control, "TASK-001", "in_progress", None);
                write_lease(control, "TASK-001");
            },
        },
        Scenario {
            // 나머지 자격 조건은 `todo`와 완전히 같다. 상태 집합만 넓어진다.
            name: "개발자: 멈춘 in_progress 작업의 선행 선언이 미충족이다",
            roles: &["developer"],
            expected: 1,
            reason: "no-target",
            build: |control: &Path| {
                write_task_document(
                    control,
                    "TASK-001",
                    "in_progress",
                    Some("depends_on: [TASK-404]"),
                );
            },
        },
        Scenario {
            // 과거 문서처럼 분류가 없는 blocked 작업도 에이전트 복구 레인에 남는다. 정의 오류라는
            // 명시가 없으므로 개발자가 현재 실패를 다시 진단한다.
            name: "개발자: 미분류 blocked 작업은 lease가 없으면 대상이다",
            roles: &["developer"],
            expected: 0,
            reason: "eligible",
            build: |control: &Path| write_task_document(control, "TASK-001", "blocked", None),
        },
        Scenario {
            name: "개발자: 미분류 blocked 작업은 만료된 lease 뒤에 다시 열린다",
            roles: &["developer"],
            expected: 0,
            reason: "eligible",
            build: |control: &Path| {
                write_task_document(control, "TASK-001", "blocked", None);
                write_expired_lease(control, "TASK-001");
            },
        },
        Scenario {
            name: "아키텍트: definition_error blocked 작업을 사용자 요청 없이 고친다",
            roles: &["architect"],
            expected: 0,
            reason: "eligible",
            build: |control: &Path| {
                write_task_document(
                    control,
                    "TASK-001",
                    "blocked",
                    Some("blocked_kind: definition_error"),
                );
            },
        },
        Scenario {
            name: "개발자: definition_error blocked 작업은 아키텍트 대상이다",
            roles: &["developer"],
            expected: 1,
            reason: "no-target",
            build: |control: &Path| {
                write_task_document(
                    control,
                    "TASK-001",
                    "blocked",
                    Some("blocked_kind: definition_error"),
                );
            },
        },
        Scenario {
            // 죽은 기획 세션의 시그니처. 본문 한 줄 없는 `draft` 스켈레톤 하나가 아이디어를 판정에서
            // 영원히 지우던 자리가 여기서 열린다.
            name: "기획자: draft 기획서만 참조한 아이디어가 다시 열린다",
            roles: &["planner"],
            expected: 0,
            reason: "eligible",
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
            // 인수 세션이 그 아이디어를 선점하면 표시가 꺼진다. 선점 대상은 지금과 같은 아이디어 id다.
            name: "기획자: draft 기획서만 참조한 아이디어를 미만료 lease가 덮는다",
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
                write_lease(control, "IDEA-001");
            },
        },
        Scenario {
            // "**모두** `draft`"이지 "하나라도 `draft`"가 아니다. 승인까지 간 기획서와 죽은 재작업
            // draft를 함께 가진 아이디어에서 멈춘 것은 아이디어가 아니라 재작업이다.
            name: "기획자: 참조 기획서 하나가 user_review면 아이디어가 닫힌다",
            roles: &["planner"],
            expected: 1,
            reason: "no-target",
            build: |control: &Path| {
                write_idea_document(control, "IDEA-001");
                write_document(
                    control,
                    "specs",
                    "SPEC-001",
                    "---\nschema: workflow-labs/spec@1\nid: SPEC-001\nstatus: user_review\nsource_idea_id: IDEA-001\n---\n",
                );
                write_document(
                    control,
                    "specs",
                    "SPEC-002",
                    "---\nschema: workflow-labs/spec@1\nid: SPEC-002\nstatus: draft\nsource_idea_id: IDEA-001\n---\n",
                );
            },
        },
        Scenario {
            // 수정 요청 쪽의 같은 판정. 원천이 결정 id인 것 말고는 아이디어 쪽과 같다.
            name: "기획자: draft 재작업 기획서만 남은 수정 요청이 다시 열린다",
            roles: &["planner"],
            expected: 0,
            reason: "eligible",
            build: |control: &Path| {
                write_revision_request_document(
                    control,
                    "DECISION-001",
                    "SPEC-001",
                    "user",
                    "2026-08-01T00:00:00Z",
                );
                write_document(
                    control,
                    "specs",
                    "SPEC-002",
                    "---\nschema: workflow-labs/spec@1\nid: SPEC-002\nstatus: draft\nsource_decision_id: DECISION-001\n---\n",
                );
            },
        },
        Scenario {
            name: "기획자: 재작업 기획서가 user_review면 수정 요청이 닫힌다",
            roles: &["planner"],
            expected: 1,
            reason: "no-target",
            build: |control: &Path| {
                write_revision_request_document(
                    control,
                    "DECISION-001",
                    "SPEC-001",
                    "user",
                    "2026-08-01T00:00:00Z",
                );
                write_document(
                    control,
                    "specs",
                    "SPEC-002",
                    "---\nschema: workflow-labs/spec@1\nid: SPEC-002\nstatus: user_review\nsource_decision_id: DECISION-001\n---\n",
                );
            },
        },
        Scenario {
            // 판정 불가가 안전한 쪽으로 기운다. `status:` 줄이 없는 기획서는 `draft`가 아니므로 그
            // 참조 줄이 목록에 들고 원천은 후보가 되지 않는다. 두 본문과 앱 이식본이 이 어법 하나를
            // 공유해야 R7이 지켜진다 — 화면용 정규화는 이 문서를 `draft`로 접어 반대로 답한다.
            name: "기획자: status 줄이 없는 기획서는 draft가 아니다",
            roles: &["planner"],
            expected: 1,
            reason: "no-target",
            build: |control: &Path| {
                write_idea_document(control, "IDEA-001");
                write_document(
                    control,
                    "specs",
                    "SPEC-001",
                    "---\nschema: workflow-labs/spec@1\nid: SPEC-001\nsource_idea_id: IDEA-001\n---\n",
                );
            },
        },
        Scenario {
            // 상태 검사는 값 전체가 아니라 앞자리 일치다. 계약 밖으로 길어진 값도 후보다.
            // 단일 훑기가 값 전체 비교로 바뀌면 이 행에서 답이 뒤집힌다(SPEC-041 R3).
            name: "개발자: 상태 값이 계약 밖으로 길어져도 후보다",
            roles: &["developer"],
            expected: 0,
            reason: "eligible",
            build: |control: &Path| {
                write_task_document(control, "TASK-001", "todoish", None);
            },
        },
        Scenario {
            // 상태 줄은 프론트매터에 한정되지 않는다. 본문에 적힌 예시 줄도 잡힌다.
            name: "개발자: 본문에 적힌 상태 줄도 후보로 만든다",
            roles: &["developer"],
            expected: 0,
            reason: "eligible",
            build: |control: &Path| {
                write_approved_decision(control, "DECISION-DEFAULT", "SPEC-DEFAULT");
                write_work_group(
                    control,
                    "GROUP-DEFAULT",
                    "active",
                    1,
                    "DECISION-DEFAULT",
                    None,
                );
                let group_path = control.join("wf-demo/groups/GROUP-DEFAULT.md");
                let group = fs::read_to_string(&group_path).expect("default group");
                fs::write(
                    group_path,
                    group.replace("source_spec_id: SPEC-001", "source_spec_id: SPEC-DEFAULT"),
                )
                .expect("default group source spec");
                write_document(
                    control,
                    "tasks",
                    "TASK-001",
                    "---\nschema: workflow-labs/task@1\nid: TASK-001\nstatus: archived\nsource_spec_id: SPEC-DEFAULT\nsource_decision_id: DECISION-DEFAULT\nwork_group_id: GROUP-DEFAULT\nwork_group_revision: 1\n---\n\n예시:\n\nstatus: todo\n",
                );
            },
        },
        Scenario {
            // 선행 선언이 두 줄이면 값을 읽지 않고 미충족이다.
            name: "개발자: 선행 선언이 두 줄이면 미충족이다",
            roles: &["developer"],
            expected: 1,
            reason: "no-target",
            build: |control: &Path| {
                write_task_document(
                    control,
                    "TASK-001",
                    "todo",
                    Some("depends_on: [TASK-002]\ndepends_on: [TASK-002]"),
                );
                write_task_document(control, "TASK-002", "verified", None);
            },
        },
        Scenario {
            // 겹침 선언이 정확히 한 줄이 아니면 판정 불가이고, 판정 불가는 막는 쪽이다.
            // 잡힌 lease가 있어야 자기 선언을 보므로 작업이 아닌 문서를 잡은 lease를 하나 둔다.
            name: "개발자: 겹침 선언이 두 줄이면 막힌다",
            roles: &["developer"],
            expected: 1,
            reason: "no-target",
            build: |control: &Path| {
                write_task_document(
                    control,
                    "TASK-001",
                    "todo",
                    Some("scope_files: [src/one.rs]\nscope_files: [src/one.rs]"),
                );
                write_lease(control, "SPEC-001");
            },
        },
        Scenario {
            // 선행 해석은 후보 id 읽기와 다른 규칙이다. 후보 id는 첫 id 줄 하나이고, 선행은 파일
            // 아무 줄에나 있는 id 줄을 본다. 두 규칙이 갈리는 문서가 이 행이다.
            name: "개발자: 첫 id 줄 뒤의 id 줄도 선행을 푼다",
            roles: &["developer"],
            expected: 0,
            reason: "eligible",
            build: |control: &Path| {
                write_task_document(
                    control,
                    "TASK-001",
                    "todo",
                    Some("depends_on: [TASK-ALIAS]"),
                );
                write_document(
                    control,
                    "tasks",
                    "TASK-002",
                    "---\nschema: workflow-labs/task@1\nid: TASK-002\nstatus: verified\n---\n\nid: TASK-ALIAS\n",
                );
            },
        },
        Scenario {
            // 겹침 비교는 문자열 완전 일치다. 한쪽이 다른 쪽의 앞부분이어도 겹침이 아니다.
            name: "개발자: 경로가 서로의 앞부분이어도 겹치지 않는다",
            roles: &["developer"],
            expected: 0,
            reason: "eligible",
            build: |control: &Path| {
                write_task_document(
                    control,
                    "TASK-001",
                    "todo",
                    Some("scope_files: [src/one.rs]"),
                );
                write_task_document(
                    control,
                    "TASK-002",
                    "in_progress",
                    Some("scope_files: [src/one.rs.bak]"),
                );
                write_lease(control, "TASK-002");
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

                assert_eq!(
                    run.code, scenario.expected,
                    "{} — {role}: {}",
                    scenario.name, run.stderr
                );
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

    // ── SPEC-049 R1 넓어진 답의 표 ──────────────────────────────────────────────────────
    //
    // 위 표가 종료 코드와 사유를 고정하고, 이 표가 그 옆에 붙은 대상과 후보 목록을 고정한다. 표를
    // 따로 두는 것은 넓어진 답이 후보가 여럿인 픽스처에서만 뜻을 갖기 때문이다 — 위 표의 행은
    // 대부분 후보가 하나뿐이라 "셋 중 어느 것이 대상인가"를 물을 수 없다.
    //
    // 이 표도 현재 플랫폼에 설치된 구현을 돌린다. CI가 세 플랫폼에서 같은 표를 돌리므로, PowerShell
    // 본문이 셸 본문과 다른 대상이나 다른 사유를 내면 Windows 러너가 실패한다(완료 조건 5).

    /// 표의 한 행. `build`가 픽스처를 세우고, 그 상태에서 `role` 분기가 표준 오류에 내야 하는 값이
    /// `target`과 `candidates`다. `candidates`의 각 줄은 `"<사유 코드> <문서 id>"`이고 판정한
    /// 차례대로다.
    struct WidenedScenario {
        name: &'static str,
        role: &'static str,
        expected: i32,
        reason: &'static str,
        target: Option<&'static str>,
        candidates: &'static [&'static str],
        build: fn(&Path),
    }

    const WIDENED_SCENARIOS: &[WidenedScenario] = &[
        WidenedScenario {
            // 단독 작업은 다른 대상을 잡은 lease가 살아 있는 동안 기다린다. 겹침 선언을 함께 적는
            // 것은 단독 검사가 후보의 마지막 자리에 있기 때문이다 — 선언이 없으면 활성 lease
            // 하나가 겹침으로 먼저 막아 이 사유까지 오지 못한다.
            name: "개발자: 단독 작업이 마지막 lease가 끝나기를 기다린다",
            role: "developer",
            expected: 1,
            reason: "no-target",
            target: None,
            candidates: &["solo-run-wait TASK-001"],
            build: |control: &Path| {
                write_task_document(
                    control,
                    "TASK-001",
                    "todo",
                    Some("scope_files: [src/a.rs]\nsolo_run: true"),
                );
                write_lease(control, "DECISION-OTHER");
            },
        },
        WidenedScenario {
            // 기다리는 동안 이 프로젝트에서는 어떤 역할도 새 세션을 시작하지 않는다. 기획자 후보인
            // 아이디어도 같은 사유로 빠진다.
            name: "기획자: 단독 작업이 도는 동안 아이디어가 열리지 않는다",
            role: "planner",
            expected: 1,
            reason: "no-target",
            target: None,
            candidates: &["solo-run-active IDEA-001"],
            build: |control: &Path| {
                write_idea_document(control, "IDEA-001");
                write_task_document(
                    control,
                    "TASK-001",
                    "todo",
                    Some("scope_files: [src/a.rs]\nsolo_run: true"),
                );
                write_lease(control, "TASK-001");
            },
        },
        WidenedScenario {
            // 미만료 lease가 하나도 없으면 대표 작업이 그대로 대상이 된다. 단독 작업이 여럿일 때
            // 뒤엣것이 어떤 사유로 빠지는지는 이 표에 세우지 않는다 — 두 검사가 이 행을 각각
            // 표준 오류와 --json으로 읽는데, 대상 뒤의 후보는 앞엣것에만 없어 한 값으로 둘을
            // 만족시킬 수 없다. 그 상황은 role_eligibility.rs의 대조가 고정한다.
            name: "개발자: 조용해지면 단독 작업이 그대로 대상이 된다",
            role: "developer",
            expected: 0,
            reason: "eligible",
            target: Some("TASK-001"),
            candidates: &["eligible TASK-001"],
            build: |control: &Path| {
                write_task_document(
                    control,
                    "TASK-001",
                    "todo",
                    Some("scope_files: [src/a.rs]\nsolo_run: true"),
                );
            },
        },
        WidenedScenario {
            name: "기획자: 후보 셋 중 셋째가 대상이다",
            role: "planner",
            expected: 0,
            reason: "eligible",
            target: Some("IDEA-003"),
            candidates: &[
                "spec-exists IDEA-001",
                "leased IDEA-002",
                "eligible IDEA-003",
            ],
            build: |control: &Path| {
                write_idea_document(control, "IDEA-001");
                write_idea_document(control, "IDEA-002");
                write_idea_document(control, "IDEA-003");
                write_document(
                    control,
                    "specs",
                    "SPEC-001",
                    "---\nschema: workflow-labs/spec@1\nid: SPEC-001\nstatus: user_review\nsource_idea_id: IDEA-001\n---\n",
                );
                write_lease(control, "IDEA-002");
            },
        },
        WidenedScenario {
            // 대상이 없을 때 목록은 그 분기가 본 후보 전부다. 아이디어를 다 보고 나서 수정 요청
            // 결정으로 넘어가는 차례도 여기서 보인다.
            name: "기획자: 후보가 모두 제외되면 대상이 없고 사유만 남는다",
            role: "planner",
            expected: 1,
            reason: "no-target",
            target: None,
            candidates: &[
                "spec-exists IDEA-001",
                "leased IDEA-002",
                "leased DECISION-R01",
            ],
            build: |control: &Path| {
                write_idea_document(control, "IDEA-001");
                write_idea_document(control, "IDEA-002");
                write_document(
                    control,
                    "specs",
                    "SPEC-001",
                    "---\nschema: workflow-labs/spec@1\nid: SPEC-001\nstatus: user_review\nsource_idea_id: IDEA-001\n---\n",
                );
                write_revision_request_document(
                    control,
                    "DECISION-R01",
                    "SPEC-009",
                    "user",
                    "2026-08-01T00:00:00Z",
                );
                write_lease(control, "IDEA-002");
                write_lease(control, "DECISION-R01");
            },
        },
        WidenedScenario {
            name: "기획자: 후속 기획서가 답한 수정 요청은 그 사유로 제외된다",
            role: "planner",
            expected: 1,
            reason: "no-target",
            target: None,
            candidates: &["follow-up-exists DECISION-R01"],
            build: |control: &Path| {
                write_revision_request_document(
                    control,
                    "DECISION-R01",
                    "SPEC-001",
                    "user",
                    "2026-08-01T00:00:00Z",
                );
                write_document(
                    control,
                    "specs",
                    "SPEC-002",
                    "---\nschema: workflow-labs/spec@1\nid: SPEC-002\nstatus: user_review\nsource_decision_id: DECISION-R01\n---\n",
                );
            },
        },
        WidenedScenario {
            name: "아키텍트: 후보 셋 중 셋째가 대상이다",
            role: "architect",
            expected: 0,
            reason: "eligible",
            target: Some("DECISION-A03"),
            candidates: &[
                "decomposed DECISION-A01",
                "spec-leased DECISION-A02",
                "eligible DECISION-A03",
            ],
            build: |control: &Path| {
                write_approved_decision(control, "DECISION-A01", "SPEC-001");
                write_approved_decision(control, "DECISION-A02", "SPEC-002");
                write_approved_decision(control, "DECISION-A03", "SPEC-003");
                write_work_group(control, "GROUP-001", "active", 1, "DECISION-A01", None);
                write_group_member_task(control, "TASK-A01", "GROUP-001", "DECISION-A01");
                write_lease(control, "SPEC-002");
            },
        },
        WidenedScenario {
            // Rust reader와 두 설치 스크립트는 RFC3339 표기의 문자열 순서가 아니라 실제 instant를
            // 비교하고, 같은 instant면 파일 이름이 큰 결정을 고른다. request_id가 없거나 시각이
            // 잘못된 문서는 더 늦어 보여도 후보가 아니다.
            name: "아키텍트: 그룹 QA 최신 결정은 RFC3339 instant와 파일 이름으로 고른다",
            role: "architect",
            expected: 0,
            reason: "eligible",
            target: Some("GROUP-QA-G2-Z"),
            candidates: &["eligible GROUP-QA-G2-Z"],
            build: |control: &Path| {
                for group in ["GROUP-001", "GROUP-002", "GROUP-003"] {
                    write_work_group(control, group, "active", 1, "DECISION-001", None);
                }
                // Same instant, different offsets: the lexically larger timestamp belongs to A,
                // but the file-name tie makes Z the latest confirmed decision.
                write_group_qa_decision(
                    control,
                    "GROUP-QA-G1-A",
                    "GROUP-QA-G1-A",
                    "GROUP-001",
                    1,
                    "revision_requested",
                    Some("REQUEST-G1-A"),
                    "2026-08-01T09:00:00+09:00",
                );
                write_group_qa_decision(
                    control,
                    "GROUP-QA-G1-Z",
                    "GROUP-QA-G1-Z",
                    "GROUP-001",
                    1,
                    "confirmed",
                    Some("REQUEST-G1-Z"),
                    "2026-08-01T00:00:00Z",
                );
                // The same tie in the other outcome direction leaves exactly one rework target.
                write_group_qa_decision(
                    control,
                    "GROUP-QA-G2-A",
                    "GROUP-QA-G2-A",
                    "GROUP-002",
                    1,
                    "confirmed",
                    Some("REQUEST-G2-A"),
                    "2026-08-01T09:00:00+09:00",
                );
                write_group_qa_decision(
                    control,
                    "GROUP-QA-G2-Z",
                    "GROUP-QA-G2-Z",
                    "GROUP-002",
                    1,
                    "revision_requested",
                    Some("REQUEST-G2-Z"),
                    "2026-08-01T00:00:00Z",
                );
                // This timestamp sorts later as text but is an earlier actual instant.
                write_group_qa_decision(
                    control,
                    "GROUP-QA-G3-A",
                    "GROUP-QA-G3-A",
                    "GROUP-003",
                    1,
                    "revision_requested",
                    Some("REQUEST-G3-A"),
                    "2026-08-01T01:00:00+02:00",
                );
                write_group_qa_decision(
                    control,
                    "GROUP-QA-G3-Z",
                    "GROUP-QA-G3-Z",
                    "GROUP-003",
                    1,
                    "confirmed",
                    Some("REQUEST-G3-Z"),
                    "2026-08-01T00:30:00Z",
                );
                write_group_qa_decision(
                    control,
                    "GROUP-QA-G2-ZZ-MISSING-REQUEST",
                    "GROUP-QA-G2-ZZ-MISSING-REQUEST",
                    "GROUP-002",
                    1,
                    "revision_requested",
                    None,
                    "2026-08-03T00:00:00Z",
                );
                write_group_qa_decision(
                    control,
                    "GROUP-QA-G2-ZZZ-BAD-TIME",
                    "GROUP-QA-G2-ZZZ-BAD-TIME",
                    "GROUP-002",
                    1,
                    "revision_requested",
                    Some("REQUEST-BAD-TIME"),
                    "not-an-rfc3339-instant",
                );
            },
        },
        WidenedScenario {
            name: "개발자: 후보 넷 중 넷째가 대상이다",
            role: "developer",
            expected: 0,
            reason: "eligible",
            target: Some("TASK-004"),
            candidates: &[
                "leased TASK-001",
                "dependencies-unsatisfied TASK-002",
                "overlap TASK-003",
                "eligible TASK-004",
            ],
            build: build_developer_candidates,
        },
        WidenedScenario {
            // 같은 픽스처에서 대상이 될 작업 하나만 뺀 것이다. 남은 셋의 사유가 그대로인 것이
            // 목록이 대상 유무에 흔들리지 않는다는 뜻이다.
            name: "개발자: 후보가 모두 제외되면 대상이 없고 사유만 남는다",
            role: "developer",
            expected: 1,
            reason: "no-target",
            target: None,
            candidates: &[
                "leased TASK-001",
                "dependencies-unsatisfied TASK-002",
                "overlap TASK-003",
            ],
            build: |control: &Path| {
                write_blocked_developer_candidates(control);
            },
        },
        WidenedScenario {
            // 그룹이 active여도 task 원천 승인 뒤에 같은 기획서의 수정 요청이 붙으면 자동 실행하지
            // 않는다. 둘째 task는 그룹까지 없어서 source 승인이 그룹 사유보다 먼저임도 고정한다.
            name: "개발자: 최신 승인이 아닌 원천 결정의 작업은 제외된다",
            role: "developer",
            expected: 1,
            reason: "no-target",
            target: None,
            candidates: &[
                "source-decision-not-approved TASK-001",
                "source-decision-not-approved TASK-002",
            ],
            build: |control: &Path| {
                write_approved_decision(control, "DECISION-OLD", "SPEC-001");
                write_revision_request_document(
                    control,
                    "DECISION-NEW",
                    "SPEC-001",
                    "user",
                    "2026-08-02T00:00:00Z",
                );
                write_work_group(control, "GROUP-ACTIVE", "active", 1, "DECISION-OLD", None);
                for (id, group) in [("TASK-001", "GROUP-ACTIVE"), ("TASK-002", "GROUP-MISSING")] {
                    write_document(
                        control,
                        "tasks",
                        id,
                        &format!(
                            "---\nschema: workflow-labs/task@1\nid: {id}\nstatus: todo\nsource_decision_id: DECISION-OLD\nwork_group_id: {group}\nwork_group_revision: 1\n---\n"
                        ),
                    );
                }
            },
        },
        WidenedScenario {
            // v1의 source_spec/task fallback은 사용자 승인을 위조할 수 없다. migration이 만든 두
            // 결정적 표식이 함께 있을 때만 source_decision_id 없는 작업을 이어서 실행한다.
            name: "개발자: migration legacy 그룹은 synthetic source로 이어진다",
            role: "developer",
            expected: 0,
            reason: "eligible",
            target: Some("TASK-001"),
            candidates: &["eligible TASK-001"],
            build: |control: &Path| {
                write_work_group(
                    control,
                    "GROUP-SPEC-001-LEGACY",
                    "active",
                    1,
                    "LEGACY-SPEC-001",
                    None,
                );
                write_document(
                    control,
                    "tasks",
                    "TASK-001",
                    "---\nschema: workflow-labs/task@1\nid: TASK-001\nstatus: todo\nwork_group_id: GROUP-SPEC-001-LEGACY\nwork_group_revision: 1\n---\n",
                );
            },
        },
        WidenedScenario {
            // Task와 group의 승인이 각각 최신이어도 서로 다른 기획서/결정 원천이면 구성 오류다.
            // source 승인 자체는 유효하므로 active-group 경계의 사유가 남는다.
            name: "개발자: 다른 승인에서 온 task와 group은 연결할 수 없다",
            role: "developer",
            expected: 1,
            reason: "no-target",
            target: None,
            candidates: &["work-group-unavailable TASK-001"],
            build: |control: &Path| {
                write_approved_decision(control, "DECISION-A", "SPEC-001");
                write_approved_decision(control, "DECISION-B", "SPEC-002");
                write_work_group(control, "GROUP-B", "active", 1, "DECISION-B", None);
                let group_path = control.join("wf-demo/groups/GROUP-B.md");
                let group = fs::read_to_string(&group_path).expect("group B");
                fs::write(
                    group_path,
                    group.replace("source_spec_id: SPEC-001", "source_spec_id: SPEC-002"),
                )
                .expect("group B source spec");
                write_document(
                    control,
                    "tasks",
                    "TASK-001",
                    "---\nschema: workflow-labs/task@1\nid: TASK-001\nstatus: todo\nsource_spec_id: SPEC-001\nsource_decision_id: DECISION-A\nwork_group_id: GROUP-B\nwork_group_revision: 1\n---\n",
                );
            },
        },
        WidenedScenario {
            // 결정 id만 최신 승인 목록에 있어서는 부족하다. task와 group이 함께 잘못된 spec_id로
            // 승인 원천을 재표기해도, 그 결정이 실제로 승인한 spec과의 쌍이 맞지 않아 실행하지 않는다.
            name: "개발자: 원천 결정과 기획서가 같은 최신 승인 쌍이어야 한다",
            role: "developer",
            expected: 1,
            reason: "no-target",
            target: None,
            candidates: &["source-decision-not-approved TASK-001"],
            build: |control: &Path| {
                write_approved_decision(control, "DECISION-A", "SPEC-001");
                write_work_group(control, "GROUP-A", "active", 1, "DECISION-A", None);
                let group_path = control.join("wf-demo/groups/GROUP-A.md");
                let group = fs::read_to_string(&group_path).expect("group A");
                fs::write(
                    group_path,
                    group.replace("source_spec_id: SPEC-001", "source_spec_id: SPEC-WRONG"),
                )
                .expect("wrong group source spec");
                write_document(
                    control,
                    "tasks",
                    "TASK-001",
                    "---\nschema: workflow-labs/task@1\nid: TASK-001\nstatus: todo\nsource_spec_id: SPEC-WRONG\nsource_decision_id: DECISION-A\nwork_group_id: GROUP-A\nwork_group_revision: 1\n---\n",
                );
            },
        },
        WidenedScenario {
            // migration이 synthetic source를 task에도 채운 형태. 그룹 값과 정확히 같아야 하며
            // `LEGACY-*`라는 접두사만 같은 값은 native v2의 승인 게이트를 우회하지 못한다.
            name: "개발자: migration synthetic source는 legacy 그룹과 정확히 일치해야 한다",
            role: "developer",
            expected: 0,
            reason: "eligible",
            target: Some("TASK-003"),
            candidates: &[
                "source-decision-not-approved TASK-001",
                "source-decision-not-approved TASK-002",
                "eligible TASK-003",
            ],
            build: |control: &Path| {
                write_work_group(
                    control,
                    "GROUP-SPEC-001-LEGACY",
                    "active",
                    1,
                    "LEGACY-SPEC-001",
                    None,
                );
                for (id, source, revision) in [
                    ("TASK-001", "LEGACY-OTHER", 1),
                    ("TASK-002", "LEGACY-SPEC-001", 2),
                    ("TASK-003", "LEGACY-SPEC-001", 1),
                ] {
                    write_document(
                        control,
                        "tasks",
                        id,
                        &format!(
                            "---\nschema: workflow-labs/task@1\nid: {id}\nstatus: todo\nsource_decision_id: {source}\nwork_group_id: GROUP-SPEC-001-LEGACY\nwork_group_revision: {revision}\n---\n"
                        ),
                    );
                }
            },
        },
        WidenedScenario {
            // v2 작업은 active 그룹의 현재 revision 범위 안에 있어야 한다. 그룹이 없거나 preparing
            // 중이거나 task revision이 그룹보다 앞선 세 모양을 SH/PowerShell이 같은 사유로 닫는다.
            name: "개발자: 사용할 수 없는 작업 그룹의 작업은 같은 사유로 제외된다",
            role: "developer",
            expected: 1,
            reason: "no-target",
            target: None,
            candidates: &[
                "work-group-unavailable TASK-001",
                "work-group-unavailable TASK-002",
                "work-group-unavailable TASK-003",
            ],
            build: |control: &Path| {
                write_approved_decision(control, "DECISION-DEFAULT", "SPEC-DEFAULT");
                write_work_group(
                    control,
                    "GROUP-PREPARING",
                    "preparing",
                    1,
                    "DECISION-001",
                    None,
                );
                write_work_group(control, "GROUP-ACTIVE", "active", 1, "DECISION-002", None);
                for (id, group, revision) in [
                    ("TASK-001", "GROUP-MISSING", 1),
                    ("TASK-002", "GROUP-PREPARING", 1),
                    ("TASK-003", "GROUP-ACTIVE", 2),
                ] {
                    write_document(
                        control,
                        "tasks",
                        id,
                        &format!(
                            "---\nschema: workflow-labs/task@1\nid: {id}\nstatus: todo\nsource_spec_id: SPEC-DEFAULT\nsource_decision_id: DECISION-DEFAULT\nwork_group_id: {group}\nwork_group_revision: {revision}\n---\n"
                        ),
                    );
                }
            },
        },
        WidenedScenario {
            // 락은 분기에 들어가기 전에 끝나므로 후보 줄이 하나도 없다. 넓어진 답이 판정보다 앞서
            // 나가지 않는다는 것을 이 행이 고정한다.
            name: "마이그레이션 락은 후보를 하나도 내지 않는다",
            role: "developer",
            expected: 1,
            reason: "migration-lock",
            target: None,
            candidates: &[],
            build: |control: &Path| {
                write_task_document(control, "TASK-001", "todo", None);
                fs::create_dir_all(control.join(".runtime")).expect("runtime root");
                fs::write(control.join(".runtime/migration.lock"), "").expect("migration lock");
            },
        },
    ];

    /// 세 가지 제외 사유가 모두 걸린 작업 셋. 잡힌 lease 하나가 첫째를 선점으로, 셋째를 겹침으로
    /// 막는다.
    fn write_blocked_developer_candidates(control: &Path) {
        write_task_document(
            control,
            "TASK-001",
            "todo",
            Some("scope_files: [src/shared.rs]"),
        );
        write_task_document(control, "TASK-002", "todo", Some("depends_on: [TASK-404]"));
        write_task_document(
            control,
            "TASK-003",
            "todo",
            Some("scope_files: [src/shared.rs]"),
        );
        write_lease(control, "TASK-001");
    }

    /// 위 셋에 대상이 될 작업 하나를 더한다. 겹치지 않는 선언을 가져야 잡힌 lease를 지난다.
    fn build_developer_candidates(control: &Path) {
        write_blocked_developer_candidates(control);
        write_task_document(
            control,
            "TASK-004",
            "todo",
            Some("scope_files: [src/four.rs]"),
        );
    }

    /// 표의 각 행에서 조건 스크립트가 대상과 후보별 제외 사유를 답한다(SPEC-049 완료 조건 1·2·5).
    ///
    /// 같은 자리에서 표준 출력이 여전히 사유 한 줄인지도 본다. 넓어진 답은 표준 오류로만 나가므로
    /// 데몬이 옮기는 값과 앱이 옮기는 문장은 이 변경 전과 같다(완료 조건 3).
    #[test]
    fn the_installed_script_names_the_target_and_why_the_rest_were_excluded() {
        for scenario in WIDENED_SCENARIOS {
            let (root, control) = project();
            install_condition_script(&control).expect("install condition script");
            (scenario.build)(&control);

            let run = run_condition(root.path(), scenario.role);
            let candidates = run.candidates();
            let candidates: Vec<&str> = candidates.iter().map(String::as_str).collect();

            assert_eq!(run.code, scenario.expected, "{}: 종료 코드", scenario.name);
            assert_eq!(run.reason(), scenario.reason, "{}: 사유", scenario.name);
            assert_eq!(
                run.stdout.lines().count(),
                1,
                "{}: 표준 출력은 사유 한 줄이어야 한다: {:?}",
                scenario.name,
                run.stdout
            );
            assert_eq!(
                run.target().as_deref(),
                scenario.target,
                "{}: 대상",
                scenario.name
            );
            assert_eq!(
                candidates, scenario.candidates,
                "{}: 후보 목록",
                scenario.name
            );
        }
    }

    /// 기계 출력은 표준 호출의 이유 한 줄을 바꾸지 않으면서도 역할별 대상과 후보 전부를 한 JSON
    /// 문서로 낸다. 기존 넓어진 표는 세 역할과 대상 없음까지 이미 덮고 있어, 같은 표를 여기서
    /// 다시 읽으면 두 출력 경로의 판단이 갈라지는 경우를 잡는다.
    #[test]
    fn machine_output_is_versioned_json_for_every_role_verdict() {
        for scenario in WIDENED_SCENARIOS {
            let (root, control) = project();
            install_condition_script(&control).expect("install condition script");
            (scenario.build)(&control);

            let run = run_machine_condition(root.path(), scenario.role);
            let value: serde_json::Value =
                serde_json::from_str(run.stdout.trim()).expect("machine JSON");
            let candidates = value["candidates"]
                .as_array()
                .expect("candidate array")
                .iter()
                .map(|candidate| {
                    format!(
                        "{} {}",
                        candidate["reason"].as_str().expect("reason"),
                        candidate["id"].as_str().expect("id")
                    )
                })
                .collect::<Vec<_>>();

            assert_eq!(run.code, scenario.expected, "{}: 종료 코드", scenario.name);
            assert!(
                run.stderr.is_empty(),
                "{}: JSON 모드는 stderr를 비워야 한다",
                scenario.name
            );
            assert_eq!(value["schemaVersion"], 1, "{}: 계약 버전", scenario.name);
            assert_eq!(value["role"], scenario.role, "{}: 역할", scenario.name);
            assert_eq!(
                value["targetId"].as_str(),
                scenario.target,
                "{}: 대상",
                scenario.name
            );
            let expected_kind = match (scenario.role, scenario.target) {
                ("architect", Some(target)) if target.starts_with("GROUP-QA-") => {
                    Some("group_qa_revision")
                }
                ("architect", Some(target)) if target.starts_with("GROUP-") => Some("work_group"),
                ("architect", Some(target)) if target.starts_with("TASK-") => Some("blocked_task"),
                ("architect", Some(_)) => Some("spec_approval"),
                _ => None,
            };
            assert_eq!(
                value["targetKind"].as_str(),
                expected_kind,
                "{}: 대상 종류",
                scenario.name
            );
            assert_eq!(candidates, scenario.candidates, "{}: 후보", scenario.name);
            assert_eq!(value["verdict"], scenario.reason, "{}: 판정", scenario.name);
        }
    }

    #[test]
    fn machine_output_keeps_candidates_after_the_first_target() {
        let (root, control) = project();
        install_condition_script(&control).expect("install condition script");
        write_task_document(
            &control,
            "TASK-001",
            "todo",
            Some("scope_files: [src/one.rs]"),
        );
        write_task_document(
            &control,
            "TASK-002",
            "todo",
            Some("scope_files: [src/two.rs]"),
        );

        let run = run_machine_condition(root.path(), "developer");
        let value: serde_json::Value =
            serde_json::from_str(run.stdout.trim()).expect("machine JSON");
        let candidates = value["candidates"].as_array().expect("candidate array");

        assert_eq!(run.code, 0);
        assert_eq!(value["targetId"], "TASK-001");
        assert_eq!(candidates.len(), 2);
        assert_eq!(candidates[0]["id"], "TASK-001");
        assert_eq!(candidates[1]["id"], "TASK-002");
        assert_eq!(candidates[0]["reason"], "eligible");
        assert_eq!(candidates[1]["reason"], "eligible");
    }

    #[test]
    fn architect_machine_output_prioritizes_group_rework_then_corrections_and_recovery() {
        let (root, control) = project();
        install_condition_script(&control).expect("install condition script");
        write_work_group(&control, "GROUP-001", "active", 1, "DECISION-A01", None);
        write_group_qa_revision_request(
            &control,
            "GROUP-QA-001",
            "GROUP-001",
            1,
            "2026-08-01T00:00:00Z",
        );
        write_task_document(
            &control,
            "TASK-001",
            "blocked",
            Some("blocked_kind: definition_error"),
        );
        write_work_group(&control, "GROUP-002", "preparing", 1, "DECISION-A02", None);
        write_approved_decision(&control, "DECISION-A03", "SPEC-003");

        let run = run_machine_condition(root.path(), "architect");
        let value: serde_json::Value =
            serde_json::from_str(run.stdout.trim()).expect("machine JSON");
        let candidates = value["candidates"]
            .as_array()
            .expect("candidate array")
            .iter()
            .map(|candidate| candidate["id"].as_str().expect("candidate id"))
            .collect::<Vec<_>>();

        assert_eq!(run.code, 0);
        assert_eq!(value["targetId"], "GROUP-QA-001");
        assert_eq!(value["targetKind"], "group_qa_revision");
        assert_eq!(
            candidates,
            [
                "GROUP-QA-001",
                "TASK-001",
                "GROUP-002",
                "DECISION-A03",
                "DECISION-DEFAULT",
            ]
        );
    }

    #[test]
    fn both_script_bodies_declare_the_same_machine_output_contract() {
        for body in [CONDITION_SCRIPT_SH, CONDITION_SCRIPT_PS1] {
            assert!(body.contains("--json"));
            assert!(body.contains("schemaVersion"));
            assert!(body.contains("targetId"));
            assert!(body.contains("targetKind"));
            assert!(body.contains("candidates"));
            assert!(body.contains("eligible"));
        }
    }

    /// 넓어진 답이 쓰는 사유 코드도 ASCII 한 줄이다. 두 본문이 같은 어휘를 갖는지도 함께 본다 —
    /// 한쪽에만 있는 코드는 그 플랫폼에서만 나오는 답이 된다.
    #[test]
    fn both_implementations_carry_the_same_exclusion_vocabulary() {
        const EXCLUSION_CODES: &[&str] = &[
            "spec-exists",
            "follow-up-exists",
            "leased",
            "decomposed",
            "spec-leased",
            "source-decision-not-approved",
            "work-group-unavailable",
            "dependencies-unsatisfied",
            "overlap",
            "solo-run-wait",
            "solo-run-active",
        ];

        for code in EXCLUSION_CODES {
            assert!(code.is_ascii(), "{code}가 ASCII가 아니다");
            assert!(
                !code.contains([' ', '\n', '\r']),
                "{code}가 한 줄 계약을 깬다"
            );
            for body in [CONDITION_SCRIPT_SH, CONDITION_SCRIPT_PS1] {
                assert!(body.contains(code), "{code} 제외 사유가 본문에 없다");
            }
        }
        for body in [CONDITION_SCRIPT_SH, CONDITION_SCRIPT_PS1] {
            assert!(body.contains("candidate: "), "후보 줄 접두사가 없다");
            assert!(body.contains("target: "), "대상 줄 접두사가 없다");
        }
    }

    /// 판정 비용의 회귀를 잡는 장치(SPEC-033 R8).
    ///
    /// 벽시계가 아니라 **조건 스크립트가 띄우는 외부 프로세스의 수**를 센다. 시간을 단언하면 러너마다
    /// 다른 값이 나와, 빡빡하게 잡으면 이유 없이 빨개지고 느슨하게 잡으면 회귀를 놓친다. 실제로 비싼
    /// 것은 후보 하나마다 새로 뜨는 프로세스이고(확인 사실 5: 판정 한 번에 6천 개), 그 수는 기기와
    /// 무관하게 문서 수만으로 정해진다.
    ///
    /// **유닉스 전용이다.** PowerShell 본문은 `$lineCache`가 있어 파일마다 프로세스를 띄우지 않으므로
    /// 같은 계량이 성립하지 않는다. 그쪽 회귀는 [`SCENARIOS`] 표가 Windows 러너에서 도는 것으로만
    /// 덮이고, 이 장치의 사정권 밖이다.
    #[cfg(unix)]
    mod judgement_cost {
        use std::collections::BTreeMap;
        use std::os::unix::fs::PermissionsExt;
        use std::process::Command;

        use super::*;

        /// `CONDITION_SCRIPT_SH` 본문이 부르는 외부 명령 전부다. 본문을 읽어 정했고, `printf`·`echo`·
        /// `test`는 셸 내장이라 프로세스를 띄우지 않으므로 들어 있지 않다.
        ///
        /// `PATH`를 shim 디렉터리 하나로만 두는 것이 이 장치의 두 번째 일이다. 이 목록에 없는 외부
        /// 명령이 본문에 새로 들어오면 그 명령을 찾지 못해 판정이 달라지고, 아래 판정 대조가 그것을
        /// 잡는다. 세지 않는 명령이 몰래 늘지 않는다.
        const EXTERNAL_COMMANDS: &[&str] = &["awk", "date", "grep", "head", "sed", "tr"];

        /// `PATH`에 shim만 있으므로 셸을 이름으로 찾지 못한다. 그래서 이 장치만 자체 러너를 갖고,
        /// [`run_condition`]은 그대로 둔다 — 대조 테스트 두 곳이 그 함수를 쓰고 있어 부르는 방식이
        /// 갈리면 대조의 뜻이 사라진다.
        const SHELL: &str = "/bin/sh";

        /// 3배 픽스처가 1배의 몇 배까지 허용되는가. 문서량에 비례하면 3배 언저리, 컬렉션 크기의 곱이면
        /// 9배 언저리이므로 그 사이에서 갈린다. 정수로 비교하려고 3.5를 7/2로 쓴다.
        const GROWTH_NUMERATOR: usize = 7;
        const GROWTH_DENOMINATOR: usize = 2;

        /// 세 예산 전부가 아래에 있어야 하는 상한. 목표 3초(데몬 한도 10초의 30%, SPEC-033 확인 필요
        /// 3번)를 프로세스 수로 환산한 값의 절반이다. 환산은 shim 없이 3회 중앙값으로 잰 것이고
        /// (2026-08-05, Apple M2 / macOS 26.5.2 arm64: 1배 919개 1.478초 · 3배 2,743개 5.299초, 곧
        /// 초당 518~623개) 3초는 대략 1,550~1,870개에 해당한다. 아키텍트가 고정한 "그 절반 이하"가
        /// 약 777개다.
        ///
        /// 예산이 이 값을 넘어야 할 것 같으면 그것은 예산의 문제가 아니라 그 분기가 상한을 넘은
        /// 것이므로, 값을 고치지 말고 아키텍트 후속으로 넘긴다.
        const BUDGET_CEILING: usize = 777;

        // ── 프로세스 예산: 3배 픽스처가 넘어서는 안 되는 절대 프로세스 수, **역할마다 따로**
        // (SPEC-041 R5). 선형이어도 후보 하나당 상수가 커지면 한도에 닿기 때문에 비율만으로는
        // 부족하고, 값이 하나면 가장 비싼 분기 하나만 보게 되어 나머지 둘의 회귀가 그대로 지나간다.
        //
        // 세 값 모두 단독 수행 판정(SPEC-065)이 붙은 뒤 같은 검사로 다시 잰 실측 + 1이다. 세 분기
        // 모두 문서 수와 무관한 상수라 1배와 3배가 같다. 예산은 각 역할의 3배 값 위에 세운다.
        //
        // 여유를 1로 두는 근거는 이 검사가 잡아야 하는 회귀의 최소 단위다. 상수 분기에서 그 단위는
        // "본문에 외부 명령 호출이 하나 새로 생긴다"이고 그것이 곧 +1이므로, 여유 1이면 **두 개째에서
        // 걸린다**. 실측의 몇 퍼센트라는 어법은 여기서 뜻이 없다 — 3의 10%는 0이다.
        //
        // 후보 수는 build_fixture가 정한다. 3배에서 기획자 후보는 아이디어 96건과 수정 요청
        // 결정 6건, 아키텍트 후보는 승인 결정 93건, 개발자 후보는 작업 289건이다.

        /// 실측 4개(3배 `awk` 3회 · `grep` 1회) + 1. 워크플로우 하나마다 `scan_nondraft_refs`·
        /// `scan_ideas`·`scan_decisions`가 각각 한 번씩 훑고, 여기에 단독 수행 선언이 프로젝트에
        /// 하나라도 있는지 보는 `grep` 하나가 더 붙는다(SPEC-065). 모두 후보 수와 무관하다.
        ///
        /// 그 `grep`이 세 역할에 공통으로 +1을 얹은 값이 이번 실측이다. 선언이 하나도 없으면 훑기가
        /// 그 한 번에서 끝나므로 판정 비용이 여기서 멈춘다. 선언이 있는 프로젝트는 세 역할 모두
        /// 개발자 후보 훑기 한 벌을 더 치르며, 그 비용은 이 픽스처가 재지 않는다.
        ///
        /// 무엇이 늘면 걸리는가: 본문에 외부 명령 호출이 둘 늘면 6개가 되어 걸린다. 후보당 상수가 하나
        /// 늘면 3배에서 102개가 늘어 106개가 되고 예산을 101개 넘는다. 워크플로우당 훑기가 하나 늘어도
        /// 이 픽스처(워크플로우 1개)에서 +1이라 두 번째 것에서 걸린다.
        const PLANNER_PROCESS_BUDGET: usize = 5;

        /// 실측 4개(3배 `awk` 3회 · `grep` 1회) + 1. 워크플로우 하나마다 `scan_refs`·
        /// `scan_work_groups`·`scan_architect_decisions` 각 한 번이고, 단독 선언 유무를 보는 `grep`
        /// 하나가 더 붙는다. 그룹 QA·과거 task 정의 수정·승인 세 결정 후보군은 마지막 훑기 하나로
        /// 합쳐, 후보군 수만큼 decisions/를 다시 읽지 않는다.
        ///
        /// 무엇이 늘면 걸리는가: 본문에 외부 명령 호출이 둘 늘면 6개가 되어 걸린다. 후보당 상수가 하나
        /// 늘면 3배에서 93개가 늘어 97개가 되고 예산을 92개 넘는다.
        const ARCHITECT_PROCESS_BUDGET: usize = 5;

        /// 실측 8개(3배 `awk` 3 · `date` 1 · `grep` 1 · `head` 1 · `sed` 1 · `tr` 1) + 1.
        /// `scan_tasks`·active 그룹 표·최신 승인 표의 `awk` 셋, `scan_leases`의 `date` 하나, 단독 선언
        /// 유무를 보는 `grep` 하나, 그리고 lease 파일 하나당 `sed`·`head`·`tr` 셋이다(이 픽스처의
        /// lease는 1건).
        ///
        /// 무엇이 늘면 걸리는가: 본문에 외부 명령 호출이 둘 늘면 10개가 되어 걸린다. 후보당 상수가 하나
        /// 늘면 3배에서 289개가 늘어 297개가 되고 예산을 288개 넘는다 — TASK-125 이전의 어법이 정확히
        /// 그 모양이었고 그때 3배가 2,743개였다. lease 파일당 명령이 하나 늘면 이 픽스처에서 +1이므로
        /// 두 번째 것에서 걸린다.
        const DEVELOPER_PROCESS_BUDGET: usize = 9;

        const _: () = assert!(
            PLANNER_PROCESS_BUDGET < BUDGET_CEILING
                && ARCHITECT_PROCESS_BUDGET < BUDGET_CEILING
                && DEVELOPER_PROCESS_BUDGET < BUDGET_CEILING,
            "프로세스 예산은 상한 아래여야 한다"
        );

        /// 역할 이름으로 그 역할의 프로세스 예산을 고른다. 단언과 실패 메시지가 같은 값을 보도록
        /// 한 자리에서만 고른다.
        ///
        /// ### 예산을 다시 세워야 할 때
        ///
        /// 어느 분기를 정당하게 고쳐 비용이 늘면 이 검사가 걸린다. 그것이 이 장치가 사는 이유다.
        ///
        /// - **통과시키려고 올리지 않는다.** 값을 올리는 것이 아니라 **규칙에서 다시 세운다** — 그
        ///   역할의 3배 실측을 새로 재고, 여유 1을 같은 규칙으로 다시 얹고, 그 값이
        ///   [`BUDGET_CEILING`] 아래인지 확인한다.
        /// - **왜 그 역할의 비용이 늘었는지**를 그 값의 근거 자리(바로 위 주석)에 적는다. 값만 바뀌고
        ///   이유가 없는 변경을 남기지 않는다.
        /// - 로컬과 CI의 값이 갈리면 그것도 올릴 이유가 아니다. 갈린 사실과 어느 값 위에 세웠는지를
        ///   보고서에 적는다.
        /// - 새 값이 [`BUDGET_CEILING`]을 넘으면 값을 고치지 말고 아키텍트 후속으로 넘긴다.
        ///
        /// ### 이 예산들이 보지 못하는 것
        ///
        /// 1. **벽시계 3초는 자동 검사가 아니다.** 착지 보고의 실측으로 닫는다(SPEC-041 확인 필요 1번).
        ///    프로세스 수는 기기와 무관하게 결정적이지만 벽시계는 같은 기기에서도 앱과 데몬이 도는지에
        ///    따라 흔들리고, 느린 러너에서 간헐적으로 실패하면 사람이 가장 먼저 하는 일이 상한을
        ///    올리는 것이다.
        /// 2. **셸 내장 문자열 비교의 성장은 어느 예산에도 잡히지 않는다.** 단일 훑기 어법은 비용을
        ///    프로세스에서 셸 내장 비교로 옮기므로, TASK-125가 착지하면서 개발자 분기까지 이 사각지대로
        ///    들어왔다. 사각지대는 닫힌 것이 아니라 넓어졌다. 근거 있는 걱정이다 — 아키텍트 분기는
        ///    착지 후에도 문서 3배에 6.6배로 자라고 "이 기울기면 문서량 5~6배 언저리에서 3초에 닿는다"가
        ///    이미 한계로 기록돼 있다.
        /// 3. **윈도우 본문의 판정 비용은 아무도 재지 않는다.** 이 모듈이 유닉스 전용인 이유는 위
        ///    모듈 주석에 있고, 그 결과 그 본문이 느려지는 회귀는 Windows에서 데몬을 돌리는 사람이
        ///    타임아웃으로 발견한다.
        fn process_budget(role: &str) -> usize {
            match role {
                "planner" => PLANNER_PROCESS_BUDGET,
                "architect" => ARCHITECT_PROCESS_BUDGET,
                "developer" => DEVELOPER_PROCESS_BUDGET,
                other => panic!("{other} 역할의 프로세스 예산이 없다"),
            }
        }

        /// 한 번 실행의 계량. 판정을 함께 들고 있어야 "shim이 판정을 바꾸지 않았다"를 같은 자리에서
        /// 대조할 수 있다 — 계량이 판정을 흔들면 재는 값이 다른 실행의 값이 된다.
        struct CountedRun {
            code: i32,
            reason: String,
            total: usize,
            by_command: BTreeMap<String, usize>,
        }

        fn write_fixture_document(directory: &Path, id: &str, body: &str) {
            fs::write(directory.join(format!("{id}.md")), body).expect("write fixture document");
        }

        /// 1배는 이 저장소의 실제 규모다(확인 사실 7: 결정 122 · 작업 96 · 기획서 33 · 아이디어 32).
        /// 3배는 넷을 각각 세 배로 만든다. **두 픽스처는 이 함수에 배수만 다르게 준 것이어야 한다** —
        /// 모양이 갈리면 비율 단언이 뜻을 잃는다.
        ///
        /// 최악 경로다. 조기 종료가 걸리면 재는 것이 사라지므로(확인 사실 9), 모든 아이디어와 모든 수정
        /// 요청을 참조하는 기획서 한 장과 모든 승인을 참조하는 작업 한 장을 넣어 세 역할이 모두 대상을
        /// 찾지 못하게 한다. 문서는 판정이 보는 키만 갖는다.
        fn build_fixture(multiplier: usize) -> TempDir {
            let (root, control) = project();
            install_condition_script(&control).expect("install condition script");
            let workflow = control.join("wf-demo");
            let ideas = workflow.join("ideas");
            let specs = workflow.join("specs");
            let tasks = workflow.join("tasks");
            let groups = workflow.join("groups");
            let decisions = workflow.join("decisions");
            for directory in [&ideas, &specs, &tasks, &groups, &decisions] {
                fs::create_dir_all(directory).expect("collection root");
            }

            let idea_count = 32 * multiplier;
            let spec_count = 33 * multiplier;
            let task_count = 96 * multiplier;
            let qa_count = 89 * multiplier;
            let approval_count = 31 * multiplier;
            let revision_count = 2 * multiplier;

            for n in 1..=idea_count {
                write_fixture_document(
                    &ideas,
                    &format!("IDEA-{n:04}"),
                    &format!(
                        "---\nschema: workflow-labs/idea@1\nid: IDEA-{n:04}\nstatus: inbox\n---\n"
                    ),
                );
            }
            for n in 1..=spec_count {
                write_fixture_document(
                    &specs,
                    &format!("SPEC-{n:04}"),
                    &format!("---\nschema: workflow-labs/spec@1\nid: SPEC-{n:04}\nstatus: user_review\n---\n"),
                );
            }

            write_fixture_document(
                &groups,
                "GROUP-DEFAULT",
                "---\nschema: workflow-labs/work-group@1\nid: GROUP-DEFAULT\ntitle: 기본 그룹\nstatus: active\nrevision: 1\nqa_mode: automatic\nsource_spec_id: SPEC-DEFAULT\nsource_decision_id: DECISION-DEFAULT\ncreated_at: 2026-08-01T00:00:00Z\nupdated_at: 2026-08-01T00:00:00Z\n---\n",
            );
            write_fixture_document(
                &decisions,
                "DECISION-DEFAULT",
                "---\nschema: workflow-labs/decision@1\nid: DECISION-DEFAULT\nspec_id: SPEC-DEFAULT\noutcome: approved\ncreated_by: user\ncreated_at: 2026-08-01T00:00:00Z\n---\n",
            );

            // 선언이 있는 작업과 없는 작업을 섞는다. 개발자 분기의 비용이 선언 유무로 갈린다. 선언이
            // 있는 쪽은 없는 선행을 가리켜 미충족이 되고, 없는 쪽은 아래 lease 하나가 겹침으로 막는다.
            // 어느 쪽도 후보에서 일찍 빠지지 않으므로 분기가 목록을 끝까지 훑는다.
            for n in 1..=task_count {
                let declaration = if n % 2 == 0 {
                    format!("depends_on: [TASK-MISSING-{n:04}]\n")
                } else {
                    String::new()
                };
                write_fixture_document(
                    &tasks,
                    &format!("TASK-{n:04}"),
                    &format!("---\nschema: workflow-labs/task@1\nid: TASK-{n:04}\nstatus: todo\nsource_spec_id: SPEC-DEFAULT\nsource_decision_id: DECISION-DEFAULT\nwork_group_id: GROUP-DEFAULT\nwork_group_revision: 1\n{declaration}---\n"),
                );
            }

            // 결정은 실제 비율에 가깝게 섞는다(확인 사실 5: 122건 중 QA 89건). 기획서 결정은 하나씩
            // 다른 `spec_id`를 가져 최신 판정에서 서로를 밀어내지 않는다 — 밀려난 후보는 세지 않는
            // 자리가 되어 최악 경로가 아니게 된다.
            for n in 1..=qa_count {
                write_fixture_document(
                    &decisions,
                    &format!("QA-{n:04}"),
                    &format!("---\nschema: workflow-labs/qa-decision@1\nid: QA-{n:04}\ntask_id: TASK-{n:04}\noutcome: confirmed\ncreated_by: user\ncreated_at: 2026-08-01T00:00:00Z\n---\n"),
                );
            }
            for n in 1..=approval_count {
                write_fixture_document(
                    &decisions,
                    &format!("DECISION-A{n:04}"),
                    &format!("---\nschema: workflow-labs/decision@1\nid: DECISION-A{n:04}\nspec_id: SPEC-A{n:04}\noutcome: approved\ncreated_by: user\ncreated_at: 2026-08-01T00:00:00Z\n---\n"),
                );
                // 이 그룹들은 속한 작업이 없어 구성 확인 필요 조건에 걸린다. 아키텍트가 문서로는
                // 고칠 수 없다고 남긴 표시를 함께 두어 사람 판단 필요로 갈라지게 한다. 그래야 판정이
                // 대상을 찾지 못한 채 전부를 훑는 최악 경로가 그대로 유지되고, 문서 수도 늘지 않는다.
                write_fixture_document(
                    &groups,
                    &format!("GROUP-A{n:04}"),
                    &format!("---\nschema: workflow-labs/work-group@1\nid: GROUP-A{n:04}\ntitle: 그룹\nstatus: active\nrevision: 1\nqa_mode: automatic\nsource_spec_id: SPEC-A{n:04}\nsource_decision_id: DECISION-A{n:04}\nconfiguration_unresolved_revision: 1\ncreated_at: 2026-08-01T00:00:00Z\nupdated_at: 2026-08-01T00:00:00Z\n---\n"),
                );
            }
            for n in 1..=revision_count {
                write_fixture_document(
                    &decisions,
                    &format!("DECISION-R{n:04}"),
                    &format!("---\nschema: workflow-labs/decision@1\nid: DECISION-R{n:04}\nspec_id: SPEC-R{n:04}\noutcome: revision_requested\ncreated_by: user\ncreated_at: 2026-08-01T00:00:00Z\n---\n"),
                );
            }

            let mut catch_all_spec = String::from(
                "---\nschema: workflow-labs/spec@1\nid: SPEC-CATCHALL\nstatus: user_review\n---\n",
            );
            for n in 1..=idea_count {
                catch_all_spec.push_str(&format!("source_idea_id: IDEA-{n:04}\n"));
            }
            for n in 1..=revision_count {
                catch_all_spec.push_str(&format!("source_decision_id: DECISION-R{n:04}\n"));
            }
            write_fixture_document(&specs, "SPEC-CATCHALL", &catch_all_spec);

            let mut catch_all_task = String::from(
                "---\nschema: workflow-labs/task@1\nid: TASK-CATCHALL\nstatus: todo\nsource_spec_id: SPEC-DEFAULT\nsource_decision_id: DECISION-DEFAULT\nwork_group_id: GROUP-DEFAULT\nwork_group_revision: 1\n---\n",
            );
            for n in 1..=approval_count {
                catch_all_task.push_str(&format!("source_decision_id: DECISION-A{n:04}\n"));
            }
            write_fixture_document(&tasks, "TASK-CATCHALL", &catch_all_task);

            // 선언 없는 작업을 겹침으로 막는 미만료 lease 하나. 이 저장소의 지금 모습이기도 하다 —
            // 어떤 작업도 `scope_files`를 선언하지 않으므로 lease 하나가 전부를 막는다.
            write_lease(&control, "TASK-0001");
            root
        }

        /// 검사가 도는 시점의 `PATH`에서 실제 명령을 찾는다. shim이 자기 자신을 부르지 않도록 절대
        /// 경로를 박아야 하고, 그 경로는 `PATH`를 shim 디렉터리로 바꾸기 전에 정해 둔다.
        fn resolve_command(name: &str) -> PathBuf {
            let path = std::env::var_os("PATH").expect("PATH");
            std::env::split_paths(&path)
                .map(|directory| directory.join(name))
                .find(|candidate| {
                    fs::metadata(candidate)
                        .map(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0)
                        .unwrap_or(false)
                })
                .unwrap_or_else(|| panic!("{name}을 PATH에서 찾지 못했다"))
        }

        /// shim 디렉터리 하나를 만든다. 각 shim은 호출 한 번을 카운터 파일에 한 줄로 적고, 실제 명령을
        /// 절대 경로로 실행해 인자·표준 입출력·종료 코드를 그대로 넘긴다(`exec`이 자기 자리를 내준다).
        /// 명령 이름도 함께 적는다 — 실패했을 때 어느 명령이 늘었는지가 메시지에 실린다.
        fn write_shims(bin: &Path) {
            fs::create_dir_all(bin).expect("shim root");
            for name in EXTERNAL_COMMANDS {
                let shim = bin.join(name);
                fs::write(
                    &shim,
                    format!(
                        "#!/bin/sh\necho {name} >> \"$WF_CONDITION_PROC_LOG\"\nexec {} \"$@\"\n",
                        resolve_command(name).display()
                    ),
                )
                .expect("write shim");
                fs::set_permissions(&shim, fs::Permissions::from_mode(0o755)).expect("shim mode");
            }
        }

        /// `PATH`를 shim 디렉터리 하나로 두고 조건 스크립트를 한 번 돌린다. 셸은 절대 경로로 부른다.
        fn run_counted(project_root: &Path, role: &str, bin: &Path, counter: &Path) -> CountedRun {
            fs::write(counter, "").expect("reset counter");
            let output = Command::new(SHELL)
                .arg(CONDITION_SCRIPT.relative_path())
                .arg(role)
                .current_dir(project_root)
                .env("PATH", bin)
                .env("WF_CONDITION_PROC_LOG", counter)
                .output()
                .expect("run condition script under shims");
            let log = fs::read_to_string(counter).expect("read counter");
            let mut by_command: BTreeMap<String, usize> = BTreeMap::new();
            for line in log.lines() {
                *by_command.entry(line.to_string()).or_default() += 1;
            }
            let stdout = String::from_utf8(output.stdout).expect("condition stdout is utf-8");
            CountedRun {
                code: output.status.code().expect("exit code"),
                reason: stdout.lines().next().unwrap_or_default().to_string(),
                total: log.lines().count(),
                by_command,
            }
        }

        /// 실패했을 때 사람이 **무엇을 되돌려야 하는지** 읽을 수 있어야 한다. 확인 사실 2의 네 번이
        /// 로그 속에서만 살아 있던 것을 이 문장이 대신한다.
        fn cost_report(role: &str, one: &CountedRun, three: &CountedRun) -> String {
            let budget = process_budget(role);
            let ratio = three.total as f64 / one.total.max(1) as f64;
            let mut ranked: Vec<_> = three.by_command.iter().collect();
            ranked.sort_by_key(|(_, count)| std::cmp::Reverse(**count));
            let top: Vec<String> = ranked
                .iter()
                .take(3)
                .map(|(name, count)| format!("{name} {count}회"))
                .collect();
            format!(
                "{role} 분기의 판정 비용이 예산을 넘었다. 1배 {}개 · 3배 {}개(문서 3배에 {ratio:.1}배), \
                 {role} 예산 {budget}개.\n판정 비용이 컬렉션 크기의 곱으로 자라면 문서가 늘수록 데몬의 \
                 10초 한도를 넘고, 끊긴 판정은 안전을 위해 '일감 없음'으로 처리되어 세션이 아예 뜨지 \
                 않는다(SPEC-033 확인 사실 1·2).\n문서량에 비례하면 3배 언저리, 곱이면 9배 언저리다. \
                 비율이 넘었다면 후보 하나마다 같은 디렉터리를 다시 훑는 자리가 새로 생긴 것이므로 그 \
                 자리를 되돌린다. 비율은 지켰는데 예산만 넘었다면 후보 하나당 프로세스가 늘어난 \
                 것이다.\n예산은 그 역할의 3배 실측 + 1이고, 통과시키려고 올리는 자리가 아니다 — 다시 \
                 세우는 절차는 process_budget의 주석에 있다.\n3배에서 많이 뜬 명령: {}",
                one.total,
                three.total,
                top.join(", ")
            )
        }

        /// 세 역할 각각에서 선형 단언과 절대 단언이 통과한다. 같은 자리에서 shim이 판정을 바꾸지
        /// 않는다는 것도 대조한다.
        #[test]
        fn the_judgement_cost_grows_no_faster_than_the_collections() {
            let tools = tempdir().expect("tools root");
            let bin = tools.path().join("bin");
            let counter = tools.path().join("spawned.log");
            write_shims(&bin);

            let small = build_fixture(1);
            let large = build_fixture(3);

            for role in EVERY_ROLE {
                let one = run_counted(small.path(), role, &bin, &counter);
                let three = run_counted(large.path(), role, &bin, &counter);

                for (fixture, counted, size) in [(&small, &one, "1배"), (&large, &three, "3배")] {
                    // shim이 판정을 바꾸지 않는다. `PATH`에 shim만 두었으므로, 세지 않는 외부 명령이
                    // 본문에 새로 들어오면 그 명령을 찾지 못해 이 대조가 먼저 깨진다.
                    let plain = run_condition(fixture.path(), role);
                    assert_eq!(
                        counted.code, plain.code,
                        "{size} {role}: shim이 종료 코드를 바꿨다"
                    );
                    assert_eq!(
                        counted.reason,
                        plain.reason(),
                        "{size} {role}: shim이 사유를 바꿨다"
                    );
                    // 조기 종료가 걸리면 재는 것이 사라진다(확인 사실 9).
                    assert_eq!(
                        counted.reason, "no-target",
                        "{size} {role}: 픽스처가 최악 경로가 아니다"
                    );
                }

                assert!(
                    three.total * GROWTH_DENOMINATOR <= one.total * GROWTH_NUMERATOR,
                    "{}",
                    cost_report(role, &one, &three)
                );
                assert!(
                    three.total <= process_budget(role),
                    "{}",
                    cost_report(role, &one, &three)
                );
            }
        }
    }
}
