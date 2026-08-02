#!/bin/sh
# managed_by: workflow-labs
# condition_script_version: 1
# LLM Workflow 하트비트 조건 검사. 역할별 처리 가능한 대상이 있으면 0, 없으면 1을 반환한다.
# 사용법: sh scripts/wf-eligible.sh planner|architect|developer  (프로젝트 루트에서 실행)
set -u

role="${1:-}"
leases=".workflow/.runtime/leases"

[ -f ".workflow/.runtime/migration.lock" ] && exit 1

case "$role" in
planner)
  for wf in .workflow/*/; do
    [ -d "${wf}ideas" ] || continue
    for f in "${wf}"ideas/*.md; do
      [ -f "$f" ] || continue
      id=$(sed -n 's/^id: *//p' "$f" | head -1)
      [ -n "$id" ] || continue
      grep -qs "source_idea_id: *$id" "${wf}"specs/*.md 2>/dev/null && continue
      [ -f "$leases/$id.yml" ] && continue
      exit 0
    done
  done
  ;;
architect)
  for wf in .workflow/*/; do
    [ -d "${wf}decisions" ] || continue
    for d in "${wf}"decisions/*.md; do
      [ -f "$d" ] || continue
      grep -qs "^outcome: approved" "$d" || continue
      did=$(sed -n 's/^id: *//p' "$d" | head -1)
      [ -n "$did" ] || continue
      grep -qs "source_decision_id: *$did" "${wf}"tasks/*.md 2>/dev/null && continue
      spec=$(sed -n 's/^spec_id: *//p' "$d" | head -1)
      if [ -n "$spec" ] && [ -f "$leases/$spec.yml" ]; then continue; fi
      exit 0
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
      [ -f "$leases/$tid.yml" ] && continue
      exit 0
    done
  done
  ;;
*)
  echo "usage: wf-eligible.sh planner|architect|developer" >&2
  exit 2
  ;;
esac
exit 1
