#!/bin/sh
# managed_by: workflow-labs
# condition_script_version: 17
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

[ -f ".workflow/.runtime/migration.lock" ] && verdict migration-lock 1

# 만료 표기 판정 한 자리. 자리수가 고정된 UTC 표기는 사전순 비교가 곧 시각 비교다. POSIX sh에는
# 이식 가능한 날짜 파싱이 없다.
# 읽을 수 없는 표기를 선점으로 세지 않는다. 선점 헬퍼(wf-claim.sh)는 같은 상황을 반대로 다루는데,
# 헬퍼가 지는 위험은 살아 있는 남의 lease를 인수하는 것이고 이 판정이 지는 위험은 대상이 영원히
# 열리지 않는 것이다. 실제 선점은 배타적 생성이 막으므로 이 판정이 관대해도 중복 선점이 되지 않는다.
lease_unexpired() { # $1=만료 표기 $2=판정 시각
  case "$1" in
    ????-??-??T??:??:??Z) [ "$1" '>' "$2" ] ;;
    *) return 1 ;;
  esac
}

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

# 작업 정의 수정 요청을 "생성 시각<TAB>요청 id<TAB>작업 id"로 낸다. 스키마와
# created_by가 앱이 쓴 기록임을 확정하고, 판정할 수 없는 문서는 그 파일만 건너뛴다.
scan_task_revision_requests() { # $1=워크플로우 경로
  scan_dir="$1"decisions
  set --
  for f in "$scan_dir"/*.md; do
    [ -f "$f" ] && [ -r "$f" ] && set -- "$@" "$f"
  done
  [ "$#" -eq 0 ] && return 0
  awk '
    function emit() {
      if (schema && by == "user" && id != "" && task != "" && at != "") {
        print at "\t" id "\t" task
      }
    }
    FILENAME != prev {
      emit()
      prev = FILENAME
      id = ""; task = ""; by = ""; at = ""; schema = 0
      got_id = 0; got_task = 0; got_by = 0; got_at = 0
    }
    {
      if (!got_id && index($0, "id:") == 1) {
        got_id = 1; id = substr($0, 4); sub(/^ */, "", id)
      }
      if (!got_task && index($0, "task_id:") == 1) {
        got_task = 1; task = substr($0, 9); sub(/^ */, "", task)
      }
      if (!got_by && index($0, "created_by:") == 1) {
        got_by = 1; by = substr($0, 12); sub(/^ */, "", by)
      }
      if (!got_at && index($0, "created_at:") == 1) {
        got_at = 1; at = substr($0, 12); sub(/^ */, "", at)
      }
      if (index($0, "schema: workflow-labs/task-revision-request@1") == 1) schema = 1
    }
    END { emit() }
  ' "$@"
}

# lease 디렉터리를 한 번 훑어 미만료 lease의 대상 id를 $active_leases에 모으고 그 수를
# $active_count에 담는다. 개발자 분기가 후보마다 이 디렉터리를 다시 훑던 자리다.
# 판정 시각은 훑기 앞에서 한 번 정하고 그 값을 쓴다. 만료 판정이 판정 시점 기준인 것은 그대로이고,
# 판정 순간이 하나로 모이는 것은 앱 이식본(role_eligibility.rs)이 이미 그렇게 하는 방식이다.
# 읽는 규칙과 만료 판정은 lease_blocks와 같은 것을 쓴다. 읽지 못한 파일은 표기를 얻지 못해
# 미만료로 세어지지 않는다.
scan_leases() {
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
# 레코드의 첫 줄은 M과 네 자리, 공백, 그리고 이 문서가 담은 id 값 중 선행 이름이 될 수 있는 것들이다.
# 네 자리는 차례로
#   후보 여부  — ^status: (todo|in_progress)가 있거나, definition_error가 아닌 blocked인가
#   충족 여부  — ^status: qa_waiting 또는 ^status: completed가 파일 아무 줄에나 있는가
#   선행 줄 수 — 0·1·2 (2는 두 줄 이상)
#   겹침 줄 수 — 0·1·2
# 다. 뒤따르는 줄은 있다고 적힌 것만 온다: 후보이면 첫 id 줄의 값, 선행 줄 수가 1이면 그 값,
# 겹침 줄 수가 1이면 그 값이다. 값은 모두 한 줄에서 읽은 것이라 개행을 담을 수 없으므로 한 줄에 담긴다.
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
    function emit(  i, line, cand) {
      if (!started) return
      cand = ordinary || (blocked && !definition_error)
      line = "M" cand sat depn scopen " "
      for (i = 1; i <= n_ids; i++) line = line id_list[i] " "
      print line
      if (cand) print first_id
      if (depn == 1) print dep_value
      if (scopen == 1) print scope_value
    }
    FILENAME != prev {
      emit()
      prev = FILENAME
      started = 1
      files = files + 1
      ordinary = 0; blocked = 0; definition_error = 0
      sat = 0; depn = 0; scopen = 0
      got_id = 0; first_id = ""; dep_value = ""; scope_value = ""; n_ids = 0
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
      if ($0 ~ /^status: qa_waiting/ || $0 ~ /^status: completed/) sat = 1
      if (index($0, "depends_on:") == 1) {
        if (depn == 0) { depn = 1; dep_value = trim(substr($0, 12)) } else depn = 2
      }
      if (index($0, "scope_files:") == 1) {
        if (scopen == 0) { scopen = 1; scope_value = trim(substr($0, 13)) } else scopen = 2
      }
    }
    END { emit() }
  ' "$@"
}

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
  # 작업 정의 수정 요청은 워크플로우 경계를 넘어 모두 먼저 모으고 생성 시각으로 정렬한다.
  # 승인 분해 후보는 처리할 수 있는 요청이 없을 때만 아래 두 번째 훑기에서 본다.
  revision_rows=""
  for wf in .workflow/*/; do
    rows=$(scan_task_revision_requests "$wf")
    while IFS='	' read -r created rid tid; do
      [ -n "$created" ] && [ -n "$rid" ] && [ -n "$tid" ] || continue
      revision_rows="$revision_rows$created	$rid	$tid	$wf$nl"
    done <<REVISION_ROWS
$rows
REVISION_ROWS
  done
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
  # 이전 앱이 남긴 사용자 수정 요청은 먼저 처리한다. 그런 요청이 없으면 task 문서가 이미 기록한
  # definition_error를 사용자 조작 없이 바로 아키텍트 작업으로 연다. 이 훑기는 승인 분해 판정이
  # 필요로 하는 source_decision_id 줄도 함께 모아 아래 두 판단이 tasks/를 한 번만 읽게 한다.
  architect_task_refs=""
  direct_rows=""
  for wf in .workflow/*/; do
    task_scan=$(scan_refs "${wf}tasks" "source_decision_id:")
    task_refs=""
    while IFS= read -r task_row; do
      case "$task_row" in
        "__WF_DIRECT__	"*) direct_rows="$direct_rows$wf	${task_row#*	}$nl" ;;
        *) task_refs="$task_refs$task_row$nl" ;;
      esac
    done <<TASK_SCAN
$task_scan
TASK_SCAN
    architect_task_refs="$architect_task_refs${nl}W$wf$nl$task_refs${nl}E$wf$nl"
  done
  while IFS='	' read -r wf tid; do
    [ -n "$wf" ] && [ -n "$tid" ] || continue
    case "$revision_task_ids" in *"$nl$tid$nl"*) continue ;; esac
    lease_blocks "$tid" && { note_candidate leased "$tid"; continue; }
    note_target "$tid" blocked_task
  done <<DIRECT_ROWS
$direct_rows
DIRECT_ROWS
  for wf in .workflow/*/; do
    [ -d "${wf}decisions" ] || continue
    # 아키텍트 후보는 스키마 줄도 spec_id도 요구하지 않는다. strict가 0인 것이 그 차이다.
    # created_by 필터와 최신 검사는 기획자 분기와 같은 훑기가 한다.
    task_ref_section=${architect_task_refs#*"$nl"W$wf"$nl"}
    task_refs=${task_ref_section%%"$nl"E$wf"$nl"*}
    approvals=$(scan_decisions "$wf" approved 0)
    while IFS= read -r did; do
      IFS= read -r spec || spec=""
      [ -n "$did" ] || continue
      case "$task_refs" in *"source_decision_id:$did"*) note_candidate decomposed "$did"; continue ;; esac
      if [ -n "$spec" ] && lease_blocks "$spec"; then note_candidate spec-leased "$did"; continue; fi
      note_target "$did" spec_approval
    done <<APPROVALS
$approvals
APPROVALS
  done
  ;;
developer)
  scan_leases
  for wf in .workflow/*/; do
    [ -d "${wf}tasks" ] || continue
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
      cand=${flags%???}
      sat=${flags#?}
      sat=${sat%??}
      depn=${flags#??}
      depn=${depn%?}
      scopen=${flags#???}
      tid=""
      dep_value=""
      scope_value=""
      # 후보는 todo, in_progress, 그리고 definition_error가 아닌 blocked다. 죽은 세션이 남긴
      # in_progress 작업은 그 작업을 덮는 미만료 lease가 없으므로 아래 lease_active가 통과시키고,
      # 살아 있는 세션의 작업은 그 lease가 막는다(SPEC-035 R1). blocked 복구에도 lease·선행·겹침
      # 조건은 완전히 같다. definition_error는 위 아키텍트 분기의 대상이라 후보로 내지 않는다.
      [ "$cand" = 1 ] && IFS= read -r tid
      [ "$depn" = 1 ] && IFS= read -r dep_value
      [ "$scopen" = 1 ] && IFS= read -r scope_value
      if deps_of "$depn" "$dep_value"; then deps=$parsed; deps_ok=1; else deps=""; deps_ok=0; fi
      if scope_of "$scopen" "$scope_value"; then scope=$parsed; scope_ok=1; else scope=""; scope_ok=0; fi
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
      rows="$rows$deps_ok$scope_ok|$deps|$scope|$tid$nl"
    done <<SCAN
$scanned
SCAN
    while IFS= read -r row; do
      case "$row" in ??"|"*) ;; *) continue ;; esac
      flags=${row%%"|"*}
      rest=${row#*"|"}
      deps=${rest%%"|"*}
      rest=${rest#*"|"}
      scope=${rest%%"|"*}
      tid=${rest#*"|"}
      deps_ok=${flags%?}
      scope_ok=${flags#?}
      lease_active "$tid" && { note_candidate leased "$tid"; continue; }
      # 선행 관련 제외는 사유가 하나다. 선언을 읽지 못한 것과 선행이 아직 끝나지 않은 것과 고리가
      # 있는 것은 세션이 할 일이 같다 — 그 선언을 보고 앞의 작업을 먼저 끝내는 것이다.
      [ "$deps_ok" -eq 1 ] || { note_candidate dependencies-unsatisfied "$tid"; continue; }
      ok=1
      # 선행 셋이 모두 참이어야 자격이고 셋 중 어느 것도 다른 것을 바꾸지 않으므로, 보는 차례는
      # 답을 바꾸지 않는다. 값싼 둘을 먼저 보고 순환 탐색은 그 둘을 통과한 선언에만 돈다.
      for dep in $deps; do
        case "$known_ids" in *" $dep "*) ;; *) ok=0; break ;; esac
        case "$sat_ids" in *" $dep "*) ;; *) ok=0; break ;; esac
      done
      [ "$ok" -eq 1 ] || { note_candidate dependencies-unsatisfied "$tid"; continue; }
      for dep in $deps; do
        reaches "$dep" "$tid" && { ok=0; break; }
      done
      [ "$ok" -eq 1 ] || { note_candidate dependencies-unsatisfied "$tid"; continue; }
      overlap_blocks "$scope_ok" "$scope" && { note_candidate overlap "$tid"; continue; }
      note_target "$tid"
    done <<ROWS
$rows
ROWS
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
