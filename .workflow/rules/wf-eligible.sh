#!/bin/sh
# managed_by: workflow-labs
# condition_script_version: 10
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

# 프론트매터의 겹침 선언 한 줄을 읽어 표준 출력에 공백으로 구분한 경로 목록을 낸다.
# 반환값 1은 "키가 없거나 계약 형식이 아니다"이고, 그 작업은 판정 불가다. deps_of와 다른 점은
# 둘이다 — 키가 없는 것도 1이고(선언 없는 작업은 무엇과도 겹치는 것으로 본다), 경로에 쓰이는
# `.`과 `/`가 허용 문자에 더 있다. 공백이 든 경로는 sh의 단어 분리가 나눠 버리므로 형식 오류다.
scope_of() { # $1=작업 파일
  count=$(grep -c '^scope_files:' "$1" 2>/dev/null || true)
  case "$count" in '' | *[!0-9]*) count=0 ;; esac
  [ "$count" -eq 1 ] || return 1
  value=$(sed -n 's/^scope_files:[[:space:]]*//p' "$1" | head -1 | sed 's/[[:space:]]*$//')
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
    case "$token" in *[!A-Za-z0-9_./-]*) return 1 ;; esac
    out="$out $token"
  done
  printf '%s\n' "${out# }"
}

# 다른 문서를 잡은 미만료 lease가 이 작업의 착수를 막는가. 자기 자신을 잡은 lease는 보지 않는다 —
# 그것은 겹침이 아니라 자기 선점이고 lease_blocks가 이미 뺐다.
# 선언이 없거나 형식 오류인 쪽이 하나라도 있으면 막는다. 겹침은 대칭 관계이고, 판정 불가는 안전한
# 쪽으로 기운다. lease가 잡은 것이 작업 문서가 아니면 비교할 상대가 없으므로 막지 않는다.
# 비교는 문자열 완전 일치다. 경로 정규화도 글롭도 하지 않는다.
# 자기 선언은 막을 lease를 처음 만났을 때 읽는다. 잡힌 lease가 없으면 이 함수는 파일을 열지 않는다.
overlap_blocks() { # $1=워크플로우 경로 $2=작업 id $3=작업 파일
  mine_read=0
  for l in "$leases"/*.yml; do
    [ -f "$l" ] || continue
    lid=${l##*/}
    lid=${lid%.yml}
    [ "$lid" = "$2" ] && continue
    lease_blocks "$lid" || continue
    if [ "$mine_read" -eq 0 ]; then
      if mine=$(scope_of "$3"); then mine_ok=1; else mine_ok=0; fi
      mine_read=1
    fi
    [ "$mine_ok" -eq 0 ] && return 0
    uf=$(task_file "$1" "$lid")
    [ -n "$uf" ] || continue
    theirs=$(scope_of "$uf") || return 0
    for a in $mine; do
      for b in $theirs; do
        [ "$a" = "$b" ] && return 0
      done
    done
  done
  return 1
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

# 아래 셋이 판정 재료를 모으는 훑기다. 한 분기가 한 워크플로우에서 각 디렉터리를 한 번만 읽는다.
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
    index($0, key) > 0 {
      line = $0
      gsub(key " +", key, line)
      print line
    }
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
    index($0, "source_idea_id:") > 0 || index($0, "source_decision_id:") > 0 {
      line = $0
      gsub(/source_idea_id: +/, "source_idea_id:", line)
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
        case "$nondraft_refs" in *"source_idea_id:$id"*) continue ;; esac
        lease_blocks "$id" && continue
        verdict eligible 0
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
      case "$nondraft_refs" in *"source_decision_id:$did"*) continue ;; esac
      lease_blocks "$did" && continue
      verdict eligible 0
    done <<REVISIONS
$revisions
REVISIONS
  done
  ;;
architect)
  for wf in .workflow/*/; do
    [ -d "${wf}decisions" ] || continue
    # 아키텍트 후보는 스키마 줄도 spec_id도 요구하지 않는다. strict가 0인 것이 그 차이다.
    # created_by 필터와 최신 검사는 기획자 분기와 같은 훑기가 한다.
    task_refs=$(scan_refs "${wf}tasks" "source_decision_id:")
    approvals=$(scan_decisions "$wf" approved 0)
    while IFS= read -r did; do
      IFS= read -r spec || spec=""
      [ -n "$did" ] || continue
      case "$task_refs" in *"source_decision_id:$did"*) continue ;; esac
      if [ -n "$spec" ] && lease_blocks "$spec"; then continue; fi
      verdict eligible 0
    done <<APPROVALS
$approvals
APPROVALS
  done
  ;;
developer)
  for wf in .workflow/*/; do
    [ -d "${wf}tasks" ] || continue
    for f in "${wf}"tasks/*.md; do
      [ -f "$f" ] || continue
      # 후보는 todo와 in_progress 둘이다. 죽은 세션이 남긴 in_progress 작업은 그 작업을 덮는
      # 미만료 lease가 없으므로 아래 lease_blocks가 통과시키고, 살아 있는 세션의 작업은 그 lease가
      # 막는다(SPEC-035 R1). 나머지 조건은 todo와 완전히 같고 blocked은 후보가 아니다.
      # 두 상태를 한 번의 호출로 본다. grep을 한 번 더 부르면 작업 수만큼 프로세스가 늘어 판정
      # 비용의 상한에 그대로 부딪힌다(SPEC-033 R8).
      grep -qsE "^status: (todo|in_progress)" "$f" || continue
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
      [ "$ok" -eq 1 ] || continue
      overlap_blocks "$wf" "$tid" "$f" && continue
      verdict eligible 0
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
