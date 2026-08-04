# REPORT-SPEC-016-PLAN

기획자 세션 결과. IDEA-48EDAF2B를 SPEC-016으로 합성했다.

## 대상 선정

미처리 아이디어는 셋이었다(IDEA-48EDAF2B, IDEA-08303478, IDEA-C95EABD2). `revision_requested` 결정 둘(DECISION-FEB99DAB → SPEC-010, DECISION-2F71D20D → SPEC-014)은 후속 기획서 SPEC-013·SPEC-015가 이전 기획서·결정 ID를 참조하며 이미 처리돼 있어 재작업 대상이 아니었다.

셋 중 `created_at`이 가장 이른 IDEA-48EDAF2B(2026-08-03T01:33:27Z)를 골랐다. 계약에 우선순위 규칙이 없어 선입선출로 판단했다. 이 규칙 부재 자체는 IDEA-C95EABD2가 다루려는 문제다.

## 조사에서 확인한 것

- 현재 미설치 안내는 명령 두 줄과 저장소 링크가 전부다(`src/features/projects/components/integrations/HeartbeatCard.tsx:246-252`).
- 도구의 실제 설치 경로는 `heartbeat init` → `heartbeat install-service` → (선택) `heartbeat install dream`이다. 현재 안내에 `install-service`가 없다.
- `heartbeat install-service --print-only`(등록 없는 출력 전용)로 macOS 등록 아티팩트를 확인했다: `~/Library/LaunchAgents/com.claude-heartbeat.plist`, Label `com.claude-heartbeat`.
- 그 plist가 `EnvironmentVariables`에 PATH를 명시적으로 박아 넣는다. 스케줄러 환경에서 `heartbeat`를 찾지 못한다는 사실을 도구가 이미 알고 대응한 흔적이고, 앱이 PATH 스캔으로 패키지 설치를 판정하면 안 되는 근거로 썼다.
- 설치 판정이 `HEARTBEAT.md` · `heartbeat/` · `heartbeat.pid` 존재의 OR로 접혀 있다(`src-tauri/src/infrastructure/heartbeat_status.rs`의 `installation_of`). 단계 정보는 이미 읽히고 있으나 버려진다.
- 통합 스냅샷이 2.5초마다 자동 재조회된다(`src/features/projects/application/useProjectWorkspace.ts:329`). 아이디어가 제안한 "다시 확인" 버튼과 겹친다.
- 클립보드 플러그인이 의존성에 없다.

## 원안에서 벗어난 지점

두 곳이다. 둘 다 확인 필요로 올렸다.

- **"다시 확인" 버튼을 빼는 기본안**(확인 필요 3번). 자동 재조회가 이미 돌아서, 버튼은 "눌러야 갱신된다"는 없는 인과를 심는다. 대신 자동 확인 중임을 밝히는 요구(R7)로 바꿨다.
- **표시 조건을 미설치에서 필수 단계 미완료로 넓히는 것**(확인 필요 4번). 아이디어 문구는 미설치 상태를 말했지만, 서비스 등록 단계를 체크리스트에 넣으라는 요구를 만족시키려면 `installed` 상태에서도 마법사가 보여야 한다. 지금 사람이 실제로 막히는 자리가 "설치됨 · 데몬 미실행"이라 이 확장 없이는 문제가 남는다.

원칙(앱의 외부 명령 비실행), 단계 구성(4단계), 감지의 읽기 전용 성질은 아이디어 그대로 유지했다.

## 아키텍트에게 넘기는 것

- 확인 필요 6번의 순서 의존. R10이 요구하는 플랫폼별 명령·경로의 기준은 SPEC-015가 세운다. SPEC-015 파생 작업 뒤에 이 기획서의 작업을 거는 것이 자연스러워 보이나, 실행 순서는 SPEC-013의 의존 선언으로 아키텍트가 건다.
- SPEC-009 파생 TASK-028~031이 같은 카드의 **설치됨** 분기(쿼터)를 작업 중이다. 이 기획서는 미설치·미완료 분기라 충돌면은 좁지만, `HeartbeatIntegration` 타입을 함께 넓히므로 같은 파일을 만진다.
- 확인 필요 2번이 (B)로 결정되면 Linux·Windows 아티팩트 경로 조사가 선행 작업으로 하나 늘어난다.
- 복사 수단(확인 필요 5번)이 새 Tauri 플러그인으로 가면 의존성이 하나 는다.

## 역할 밖 관찰

수정하지 않고 남긴다.

- `heartbeat.pid` 존재를 `daemonRunning`으로 쓰는 한계가 서비스 등록 여부와도 얽힌다. 등록됐지만 멈춘 서비스와 등록되지 않은 상태가 pid 파일만으로는 구분되지 않는다. 이 기획서는 등록 아티팩트를 따로 보는 것으로 우회했고, pid 판정 자체는 손대지 않았다.
- `heartbeat skills`가 `heartbeat-register` 스킬을 별도로 보고한다. 설치 경로와 어떤 관계인지는 이번 조사 범위 밖이라 확인하지 않았다.
