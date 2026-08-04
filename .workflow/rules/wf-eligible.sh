#!/bin/sh
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
