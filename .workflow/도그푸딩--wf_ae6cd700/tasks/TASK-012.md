---
schema: workflow-labs/task@1
id: TASK-012
title: dream 잡 설치·토글·편집과 역할 잡 독립 토글 보장
status: verified
source_spec_id: SPEC-003
source_decision_id: DECISION-5276FDBF
updated_at: 2026-08-14T09:08:07.880257+00:00
history:
- at: 2026-08-14T09:08:07.880257+00:00
  kind: migrated_verified
work_group_id: GROUP-DECISION-5276FDBF
work_group_revision: 1
---

# dream 잡 설치·토글·편집과 역할 잡 독립 토글 보장

SPEC-003 R4의 관리 블록 공유와 독립 토글, R5의 잡 설치·편집을 구현한다. 전역 파일 `~/.claude/HEARTBEAT.md`를 쓰는 작업이다.

이 파일에는 사용자의 다른 프로젝트 잡이 들어 있다. 손상 시 피해 범위가 넓다. 실패 경로에서 원본이 바뀌지 않는 것이 이 작업의 가장 중요한 성질이다.

## 의존성

- TASK-008(블록 엔진·dream 잡 정의), TASK-010(연동 스냅샷·공통 골격), TASK-011(dream 카드) 선행 필수.
- 병행 작업 없음.

## 범위

- `src-tauri/src/application/heartbeat_service.rs` — 연동별 설치 요청을 받아 블록 전체를 만드는 병합 로직.
- `src-tauri/src/commands/heartbeat.rs`, `src-tauri/src/lib.rs` — dream 잡 설치 커맨드 추가.
- `src/features/projects/domain/types.ts`, `src/features/projects/infrastructure/tauriProjectGateway.ts`, `src/features/projects/application/useProjectWorkspace.ts` — 쓰기 경로 배선.
- TASK-011이 만든 dream 카드 본문 컴포넌트 — 설치·토글·편집·확인 UI.
- 관련 테스트 파일.
- 그 외 파일은 건드리지 않는다.

## 작업 내용

### 0. 먼저 읽을 제약

- 관리 마커 블록은 하나뿐이다. dream 잡을 위한 새 마커 블록을 만들지 않는다. 블록을 늘리면 "파일 끝 배치"와 "블록 뒤 사용자 `- key: value` 줄 흡수" 위험이 블록 수만큼 늘어나고, 이미 승인된 SPEC-002의 파일 계약이 달라진다.
- SPEC-002 R2·R6의 보장이 dream 잡이 들어간 뒤에도 그대로 성립해야 한다: 블록 밖 원문 바이트 보존, 전역 설정 `tick` 보존, 멱등, 마커 손상 시 원본 무변경 실패, 명시적 사용자 액션에서만 쓰기, 쓰기 전 대상 경로와 변경 요지 확인.
- dream 설치 경로는 조건 스크립트(`.workflow/rules/wf-eligible.sh`)를 쓰지 않는다. dream 잡의 조건은 `dream-prep check-unprocessed`이고 스크립트를 거치지 않는다. "dream만 설치" 상태에서 프로젝트 로컬에 불필요한 파일이 생기면 안 된다.
- 역할 잡 설치 경로는 지금처럼 조건 스크립트를 먼저 쓰고 잡을 나중에 쓴다. 순서를 바꾸지 않는다.

### 1. 블록 병합 (R4)

관리 블록은 두 연동이 공유하는데, 카드는 각각 자기 것만 안다. 그래서 설치 요청은 자기 연동 몫만 담고, 블록 전체는 서비스가 만든다.

- 설치 커맨드는 자기 연동의 desired state만 받는다. dream 설치 요청에 역할 잡 값이 들어가면 안 되고, 그 반대도 마찬가지다.
- 서비스는 아래 순서로 블록 전체 목록을 만든다.
  1. 현재 `HEARTBEAT.md`의 관리 블록을 읽는다.
  2. 요청한 연동의 잡은 요청 값으로 만든다.
  3. 다른 연동의 잡은 블록에서 읽은 편집 가능 값(`interval`, `max_per`, `model`)으로 다시 만든다. 값이 없으면 그 연동의 기본값을 쓴다. 앱 소유 필드(`prompt`, `timeout`, `condition`, `notify`, `slug`)는 항상 앱이 다시 만든다.
  4. 잡 순서는 연동 목록 순서로 고정한다: 역할 3종(planner → architect → developer) 다음에 dream. 어떤 순서로 설치했든 결과가 같아야 한다.
- 보존 대상 잡의 값이 검증을 통과하지 못하면(사용자가 블록 안을 손으로 잘못 고친 경우) 파일을 쓰지 않고 실패한다. 어느 잡의 어느 필드가 문제인지 메시지에 담는다. 조용히 기본값으로 되돌리지 않는다.
- 블록에 어떤 잡도 남지 않으면 블록 전체를 제거한다. 지금 동작과 같다.

### 2. dream 잡 설치 커맨드 (R5)

- dream 잡의 활성 여부와 편집 값(`interval`, `max_per`, `model`)을 받는 커맨드를 추가한다. 비활성 요청은 블록에서 dream 잡을 빼는 것으로 표현한다. 하트비트에 비활성 상태 필드가 없기 때문이고, 역할 잡과 같은 방식이다.
- 값 검증은 엔진의 공통 검증을 쓴다. 검증 실패 시 아무 파일도 쓰지 않는다.
- 반환값은 갱신된 연동 스냅샷이다. 프론트가 다시 조회하지 않아도 되게 한다. 역할 잡 설치 커맨드와 같은 방식이다.
- Windows에서는 지금처럼 설치를 막는다. 섹션 공통 정책이다.

### 3. dream 잡 UI (R5)

- TASK-011이 만든 dream 카드의 "둘 다 설치됨" 상태에 잡 설치·토글·편집 UI를 넣는다.
- 편집 가능한 값은 `interval`, `max_per`, `model` 셋이다. 검증 규칙과 실패 시 동작은 역할 잡과 같다. 프론트에서 먼저 막고 백엔드를 방어선으로 둔다.
- 기본값을 화면에 그대로 보여준다: `2h`, `6/24h`, `opus`. 기본 주기의 근거를 문구로 남긴다: 관측된 dream 실행은 15분 규모이고, 정제할 트랜스크립트는 역할 세션이 끝난 뒤에야 생긴다. 역할 잡보다 촘촘하게 돌릴 이유가 없다.
- 쓰기 전 확인 절차를 둔다. 대상 경로(`~/.claude/HEARTBEAT.md`)가 전역 파일이라는 사실과, 앱 관리 블록만 다시 쓰고 블록 밖은 그대로 둔다는 사실, 기록될 잡 이름과 값을 보여준다.
- dream 설치는 프로젝트 로컬 파일을 쓰지 않는다는 사실을 확인 화면에 밝힌다. 역할 잡 확인 화면이 조건 스크립트 경로를 함께 보여주는 것과 대비된다.
- 잡의 마지막 실행 시각·결과·소요 시간을 표시하고, 기록이 없으면 "실행 기록 없음"으로 표시한다. 역할 잡과 같은 표시 규칙을 쓴다. `skipped`를 실패로 읽히게 만들지 않는다.

### 4. 독립 토글 (R4)

- 역할 잡 저장과 dream 잡 저장은 서로의 값을 지우지 않는다.
- 네 조합이 모두 유효해야 한다: 둘 다 없음 / 역할만 / dream만 / 둘 다.
- dream 토글을 껐다 켜면 같은 이름의 잡이 최초 설치와 같은 형태로 돌아온다.

### 5. 테스트

백엔드(`tempfile::tempdir`로 가짜 홈 사용, 실제 `~/.claude`를 건드리지 않는다).

- dream 잡만 설치하면 블록에 dream 잡 하나만 들어가고 마커 블록이 하나만 생긴다.
- 역할 잡이 설치된 상태에서 dream 잡을 설치하면 역할 잡 3종이 값까지 그대로 남고 dream 잡이 뒤에 붙는다.
- dream 잡이 설치된 상태에서 역할 잡 값을 바꿔 저장하면 dream 잡이 그대로 남는다.
- 설치 순서를 바꿔도(역할 → dream, dream → 역할) 최종 파일이 같다.
- 같은 입력으로 두 번 설치하면 파일이 바뀌지 않는다.
- dream 토글을 껐다 켜면 최초 설치 결과와 파일이 같다.
- dream 잡을 끄고 역할 잡도 모두 끄면 블록이 사라지고 블록 밖 원문이 그대로 남는다.
- 블록 안 역할 잡의 `interval`을 손으로 깨뜨린 상태에서 dream 설치를 시도하면 파일이 그대로 남고 어느 잡·필드인지 알려주는 오류가 난다.
- dream 설치 요청이 잘못된 값(`2시간` 등)이면 아무 파일도 쓰지 않는다.
- dream만 설치했을 때 프로젝트 로컬에 조건 스크립트가 생기지 않는다.
- 마커 손상·종료 마커 뒤 흡수 줄이 있는 파일에서 dream 설치가 원본 무변경으로 실패한다.

프론트.

- 확인 절차를 거치지 않으면 게이트웨이가 호출되지 않는다.
- 입력 검증에 걸리면 확인 화면이 열리지 않는다.
- 쓰기 실패 문구가 표시되고 2.5초 조회로 사라지지 않는다.
- dream 잡 토글·편집이 역할 잡 폼 상태에 영향을 주지 않는다.

## 완료 조건

1. dream 잡 설치 후 `~/.claude/HEARTBEAT.md`의 기존 관리 마커 블록 안에 dream 잡이 R5 기본값으로 추가되고, 새 마커 블록이 생기지 않으며, 블록 밖 내용이 바이트 단위로 같다. (기획서 완료 조건 4)
2. 같은 설치를 두 번 실행해도 파일이 변하지 않는다. (기획서 완료 조건 5)
3. 역할 잡과 dream 잡을 독립적으로 켜고 끌 수 있고, 네 조합이 모두 유효하다. (기획서 완료 조건 6)
4. dream 잡 토글을 끄면 잡이 관리 블록에서 사라지고, 다시 켜면 같은 이름으로 복구되어 최초 설치 결과와 파일이 같다. (기획서 완료 조건 7)
5. 설치되는 dream 잡의 `condition` 명령을 그대로 셸에서 실행하면 미처리 트랜스크립트가 있을 때 `0`, 없을 때 `1`로 종료한다. (기획서 완료 조건 8)
6. dream 잡을 설치하지 않은 상태의 관리 블록 내용이 이 변경 전 역할 잡 설치 결과와 같다. (기획서 완료 조건 12)
7. 설치 액션 없이 앱을 켜고 프로젝트를 열어 새로고침을 여러 번 거쳐도 전역 파일이 바뀌지 않는다. (기획서 완료 조건 14)
8. SPEC-002의 완료 조건 1~12에 대응하는 기존 자동화 테스트가 삭제·비활성화 없이 모두 통과한다. (기획서 완료 조건 13)
9. `npm run check`와 `cargo test --manifest-path src-tauri/Cargo.toml`이 통과한다. (기획서 완료 조건 15)

## 검증 절차

먼저 원본을 보관한다. 이 작업은 실제 전역 파일을 바꾼다.

```sh
cp ~/.claude/HEARTBEAT.md /tmp/HEARTBEAT.before.md
md5 ~/.claude/HEARTBEAT.md
```

```sh
npm run check
cargo test --manifest-path src-tauri/Cargo.toml
```

네 조합을 화면에서 만들고 각 단계마다 확인한다.

```sh
diff /tmp/HEARTBEAT.before.md ~/.claude/HEARTBEAT.md
heartbeat jobs
```

- `diff` 결과가 관리 블록 안으로만 한정되어야 한다.
- `heartbeat jobs`가 `wf-dream-Users-catze-project-workflow-labs`를 인식해야 한다.

멱등과 토글 왕복.

```sh
md5 ~/.claude/HEARTBEAT.md   # 저장 직후
md5 ~/.claude/HEARTBEAT.md   # 같은 값으로 다시 저장한 뒤
```

- 두 값이 같아야 한다. dream 토글을 껐다 켠 뒤에도 최초 설치 직후의 해시와 같아야 한다.

조건 명령 실증(기획서 완료 조건 8).

```sh
dream-prep check-unprocessed --slug=-Users-catze-project-workflow-labs; echo "exit=$?"
```

- 미처리가 있을 때 `0`, 없을 때 `1`이어야 한다. `dream-prep`이 PATH에 없으면 설치본 경로를 직접 지정해 실행하고, PATH 문제였다는 사실을 보고서에 남긴다.

dream만 설치한 상태에서 프로젝트 로컬 확인.

```sh
git status --short
ls .workflow/rules/
```

- dream만 설치한 조합에서 조건 스크립트가 새로 생기지 않아야 한다. 이미 있는 파일이면 수정 시각이 바뀌지 않아야 한다.

확인이 끝나면 필요 시 원복한다.

```sh
cp /tmp/HEARTBEAT.before.md ~/.claude/HEARTBEAT.md
```

## 범위 밖

- 관리 블록 밖 사용자 잡의 자동 정리. 경고만 한다.
- 앱이 dream을 실행하거나 `heartbeat install dream`을 대행하는 기능.
- `timeout`, `notify`, `prompt`, `condition` 편집 UI. 앱 소유 필드다.
- 조건 스크립트 이중화 정리. 기획서 제외 범위다.
- 연동별 Windows 정책 분기. 현행 유지다.

## 참고 사실

- 하트비트 파서는 `slug`와 `prompt`가 모두 있는 잡만 남긴다. 병합 과정에서 두 필드가 빠지면 잡이 조용히 사라진다.
- 종료 마커 뒤에 오는 `- key: value` 줄은 관리 블록 마지막 잡의 필드로 흡수된다. dream 잡이 블록 마지막이 되므로 이 검사가 계속 필요하다.
- 도그푸딩 환경의 `~/.claude/HEARTBEAT.md`는 현재 `# HEARTBEAT` 제목 다음에 관리 블록만 있고 사용자 잡이 없다. 블록 밖 보존을 실제로 확인하려면 사용자 잡을 임시로 하나 넣고 검증한 뒤 되돌린다.
- `~/.claude/heartbeat/state.json`에는 사용자가 손으로 만든 `dream-catze`, `dream-unity` 기록이 남아 있다. 잡 이름이 `wf-dream<slug>`라서 이 기록과 겹치지 않는다.
- 잡 이름을 바꾸면 `state.json`의 실행 이력과 쿼터가 끊긴다. 상태 키가 잡 이름이기 때문이다. 구현 중에 이름 규칙을 임의로 바꾸지 않는다.
