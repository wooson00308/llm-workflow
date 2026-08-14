---
schema: workflow-labs/task@1
id: TASK-002
title: 하트비트 가이드 참조 무결성 확보 (스크립트 추적, README 링크)
status: verified
source_spec_id: SPEC-001
source_decision_id: DECISION-367DD9BF
updated_at: 2026-08-14T09:08:07.880257+00:00
history:
- at: 2026-08-14T09:08:07.880257+00:00
  kind: migrated_verified
work_group_id: GROUP-DECISION-367DD9BF
work_group_revision: 1
---

# 하트비트 가이드 참조 무결성 확보

SPEC-001의 R5를 구현한다. 가이드가 참조하는 스크립트를 저장소에 포함시키고, 가이드를 README에서 찾을 수 있게 한다.

## 의존성

- TASK-001 선행 필수. `docs/heartbeat.md`가 없는 상태에서 README 링크를 추가하면 깨진 링크가 된다.
- TASK-001과 파일이 겹치지 않으므로 순서만 지키면 된다.

## 범위

- `scripts/wf-eligible.sh`를 git 추적 대상에 포함한다.
- `README.md`의 문서 링크 문단에 하트비트 가이드 링크 1줄을 추가한다.

## 작업 내용

### 1. 스크립트 추적 (R5)

- `scripts/wf-eligible.sh`는 현재 저장소에 추적되지 않은 상태다. `git status --short`에서 `?? scripts/wf-eligible.sh`로 나온다.
- `.gitignore`가 이 경로를 무시하지는 않는다. 단순히 한 번도 추가된 적이 없다. `.gitignore` 수정은 필요 없고 하지 않는다.
- 이번 작업에서 이 파일을 추적 대상에 포함한다.
- 스크립트 내용과 파일 모드는 바꾸지 않는다.

### 2. README 링크 (R5)

- `README.md` 끝의 문서 링크 문단에 하트비트 가이드 링크 1줄을 추가한다. 현재 그 문단은 릴리스 가이드·제품 기준 링크 문장과 파일 계약 링크 문장으로 되어 있다.
- 기존 문장들의 서술 형태(`... 는 [링크](경로)에 정의되어 있습니다.` 계열, 존댓말 종결)를 따른다. README는 본문이 존댓말이고 `docs/` 문서는 평서형이라 서로 다르다. README 쪽 문체를 따른다.
- 링크 대상은 `docs/heartbeat.md`다.
- 그 외 `README.md` 내용은 한 글자도 건드리지 않는다.

## 완료 조건

1. `git ls-files scripts/wf-eligible.sh`가 경로를 출력한다.
2. `scripts/wf-eligible.sh`의 내용과 파일 모드가 이번 작업 전과 동일하다.
3. `README.md`에서 하트비트 가이드로 가는 링크를 따라갈 수 있고, 링크 대상 파일이 실제로 존재한다.
4. `README.md` 변경이 링크 1줄 추가에 한정된다.
5. 앱 코드(`src/`, `src-tauri/`)와 `.workflow/rules/` 변경이 없다.

## 검증 절차

프로젝트 루트에서 실행한다.

```sh
git ls-files scripts/wf-eligible.sh
```

- 경로가 출력되어야 한다. 아무것도 안 나오면 추적되지 않은 것이다.

```sh
git diff -- README.md
git diff --cached -- README.md
```

- 두 출력을 합쳐 `README.md` 변경이 `+` 1줄뿐인지 확인한다. 삭제 줄이나 다른 수정 줄이 있으면 되돌린다.

```sh
git diff --stat HEAD
git status --short
```

- 변경 목록이 `docs/heartbeat.md`(TASK-001 산출물), `README.md`, `scripts/wf-eligible.sh` 셋으로 한정되는지 확인한다.
- `src/`, `src-tauri/`, `.workflow/rules/` 경로가 목록에 없어야 한다.

```sh
test -f docs/heartbeat.md && echo OK
```

- README 링크 대상이 실제로 존재하는지 확인한다.

## 범위 밖

- `.gitignore` 수정.
- `scripts/wf-eligible.sh`의 내용·권한 변경.
- README의 다른 문단 정리나 문서 링크 문단 재구성.
- `.workflow/` 디렉터리 자체의 추적 여부 결정. 이 작업의 대상은 `scripts/wf-eligible.sh` 하나다. 아래 참고 사실을 볼 것.

## 참고 사실

- `.workflow/` 전체와 `AGENTS.md`, `CLAUDE.md`도 현재 추적되지 않은 상태다. SPEC-001은 `scripts/wf-eligible.sh`만 요구하므로 나머지는 손대지 않는다. 함께 커밋되지 않도록 스테이징 경로를 명시적으로 지정한다.
- `.gitignore`에 `.workflow/.runtime/` 항목이 없다. 파일 계약상 `.runtime/`은 Git 제외 대상인데 무시 규칙이 빠져 있어, `.workflow/`를 추적하게 되는 순간 lease 파일이 함께 올라갈 수 있다. 이번 작업 범위 밖이며 별도 판단이 필요하다.
