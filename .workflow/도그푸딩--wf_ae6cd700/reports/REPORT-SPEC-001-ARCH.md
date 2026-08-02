# SPEC-001 아키텍트 핸드오프

- 대상 기획서: SPEC-001 (하트비트 연동 가이드 문서 추가)
- 승인 결정: DECISION-367DD9BF (`outcome: approved`, `created_by: user`)
- 세션 역할: 프로젝트 아키텍트
- 작성 시각: 2026-08-01T15:32:13Z

## 결과

승인된 SPEC-001을 `todo` 작업 2건으로 분해했다. 구현은 하지 않았다.

| 작업 | 제목 | 의존성 | 대상 파일 |
| --- | --- | --- | --- |
| TASK-001 | 하트비트 가이드 문서 docs/heartbeat.md 작성 | 없음 | `docs/heartbeat.md` (신규) |
| TASK-002 | 하트비트 가이드 참조 무결성 확보 | TASK-001 | `README.md`, `scripts/wf-eligible.sh` |

## 분해 근거

R1~R4는 모두 `docs/heartbeat.md` 한 파일의 내용이라 나누면 같은 파일을 두 세션이 만지게 된다. 하나로 묶었다. R5는 파일이 겹치지 않고 성격도 다르므로(문서 작성이 아니라 저장소 상태 정리) 분리했다. TASK-002의 README 링크가 TASK-001 산출물을 가리키므로 순서 의존을 뒀다.

기획서 `확인 필요` 항목(파일명 `HEARTBEAT.md` vs `docs/heartbeat.md`)은 승인으로 해소된 것으로 해석했다. 기획서 본문이 "승인 시 아래 제안대로 진행한다"고 명시했고 결정이 `approved`이므로 `docs/heartbeat.md`를 확정 경로로 작업에 반영했다.

## 스크립트 원문 확인 결과

`scripts/wf-eligible.sh`를 읽고 실행해 확인한 사실이다. TASK-001의 R3 기술 근거로 쓴다.

- 종료 코드 `2`는 인자 없음과 잘못된 역할 이름 양쪽에서 나온다. 실측: `bogus -> 2`, 인자 없음 `-> 2`.
- `migration.lock` 검사는 역할 인자 해석보다 먼저 있다. 마이그레이션 중에는 잘못된 역할 이름도 `2`가 아니라 `1`이 된다.
- `architect` 판정의 lease 검사는 결정 id가 아니라 결정의 `spec_id`로 `leases/<기획서-id>.yml`을 본다. 아키텍트가 선점하는 대상이 기획서이므로 일관된 동작이다.
- 판정 범위는 `.workflow/*/` 전체다. 워크플로우 단위가 아니라 프로젝트 단위로 대상을 찾는다.

### 역할 계약 서술과 스크립트 판정이 어긋나는 지점

기획서 R3이 "현재 동작을 정확히 기술한다"를 요구하고, 기대효과가 "문서가 이후 스크립트 변경의 계약 기준점"이라고 했으므로 아래를 TASK-001의 필수 기술 항목으로 넣었다. 스크립트 로직 변경은 기획서 제외 범위라 손대지 않았다.

1. lease 검사가 파일 존재만 본다. `expires_at`을 읽지 않아 만료된 lease가 남아 있으면 그 대상은 계속 제외된다.
2. `planner` 판정이 미처리 아이디어만 훑는다. R2가 기획자 대상으로 명시한 `revision_requested` 결정 재작업은 스크립트가 감지하지 못한다.
3. `architect` 판정이 결정 파일 단위로 `approved`를 찾는다. R2가 명시한 "최신 결정이 `approved`인 기획서"와 달리, 같은 기획서에 더 나중 결정이 있는지는 확인하지 않는다.

## 검증

이 세션에서 실행한 읽기 전용 확인이다.

```sh
sh scripts/wf-eligible.sh planner    # -> 0
sh scripts/wf-eligible.sh architect  # -> 1
sh scripts/wf-eligible.sh developer  # -> 1
sh scripts/wf-eligible.sh bogus      # -> 2
sh scripts/wf-eligible.sh            # -> 2
git ls-files scripts/wf-eligible.sh  # -> 출력 없음 (미추적)
git check-ignore -v scripts/wf-eligible.sh  # -> 무시 규칙 없음
```

`architect -> 1`은 이 세션이 SPEC-001 lease를 잡고 있어서 나온 값이다. 사전 필터와 선점의 관계가 실제로 그렇게 동작한다는 것을 보여주는 사례라 TASK-001 검증 절차에 같은 취지로 적어 뒀다.

## 핸드오프 노트 (이 세션 범위 밖)

- `.gitignore`에 `.workflow/.runtime/` 항목이 없다. 파일 계약은 `.runtime/`을 Git 제외로 규정하는데 무시 규칙이 빠져 있다. 지금은 `.workflow/` 전체가 미추적이라 드러나지 않지만, `.workflow/`를 추적하는 순간 lease 파일이 커밋 대상에 들어온다. 사용자 판단이 필요하다.
- IDEA-472E923E(선택적 연동/플러그인 개념과 claude-heartbeat 연동)가 미처리 상태다. 기획자 역할 대상이며 이 세션에서 처리하지 않았다. 스크립트를 `.workflow/rules/`로 옮겨 앱 관리 자산화하자는 내용이 포함되어 있어, SPEC-001 산출 문서의 스크립트 경로 기술과 나중에 충돌할 수 있다.
- 위 "어긋나는 지점" 2·3번은 스크립트 개선 후보다. 기획서가 로직 변경을 제외했으므로 이번에는 문서화만 한다. 개선하려면 새 아이디어로 올려야 한다.
- lease 만료 교체 구간의 원자성 문제는 2026-08-01 로그에 이미 후속 과제로 남아 있다. 기획서도 제외 범위로 명시했다.

## 상태

TASK-001, TASK-002 모두 `status: todo`로 남긴다. SPEC-001 lease는 이 보고서 작성 후 해제한다. 구현으로 넘어가지 않는다.
