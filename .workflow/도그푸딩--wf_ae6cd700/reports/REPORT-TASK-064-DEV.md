# TASK-064 개발자 핸드오프

> 기록 경위: 하네스가 서브에이전트(dev-064)의 보고서 파일 작성을 차단해, 발신된 전문을 TL이 대리 기록한다. 내용은 발신 전문 그대로다. (수신 2026-08-04T09:15Z, TL 세션)

- 대상 작업: TASK-064 (관리 블록 안 다른 프로젝트의 잡을 원문 그대로 보존한다)
- 근거 문서: SPEC-022 R1·R2·R5 / 완료 조건 1~5·8~13, DECISION-7A3E5B90 (확인 필요 2번 = 원문 보존 승인)
- 상태: `qa_waiting` (lease-9687-20260804085712, acquire→renew→release 전부 exit 0)
- 착수 전 TASK-063 산출물(OTHER_SLUG 픽스처 + #[ignore] 테스트 4개) 실측 확인

## 핵심 결정

1. 보존 지점은 install_managed_jobs 한 곳 — 모든 쓰기 경로(역할 설치·해제, dream 설치·해제, 재설정)를 한 번에 덮음.
2. 시그니처: `install_managed_jobs(path, jobs, owned: &[String])`. jobs(이번에 남길 잡)와 owned(소유 잡 이름 전체, 꺼지는 잡 포함)를 분리 — owned에 있으나 jobs에 없으면 "끈 잡"(지움), 둘 다 없으면 "남의 잡"(남김). owned를 설치 목록으로 좁히면 끈 잡이 남의 잡으로 오인돼 되살아남. 호출부는 신규 owned_job_names(slug)(역할 3종+dream=4).
3. 남의 잡은 파싱 없이 문자열 이동 (승인 결론): 신규 foreign_job_texts가 블록 안 비소유 잡의 원문 줄을 그대로 절취. 구간은 end_line이 아니라 다음 잡 헤더 직전까지 — 필드로 안 읽히는 줄(주석·산문)도 보존 (작업 문서 권고보다 한 단계 안전한 쪽, 3줄 차이). 신규 managed_block_interior는 마커 비정상 시 None(마커 판정 무약화).
4. 순서: 이 프로젝트 잡(역할 3종→dream) 다음에 남의 잡(원래 상대 순서 유지). 멱등.
5. 블록 제거 조건: `jobs.is_empty() && preserved.is_empty()`일 때만 마커째 제거 — 남의 잡이 있으면 블록 존속 (TASK-063 핸드오프 조건 그대로).

## 변경한 파일 (넷, 전부 범위)

- heartbeat_jobs.rs — 제품: 시그니처·본문, render_block(jobs, preserved), foreign_job_texts·managed_block_interior 신설. 테스트: install 헬퍼 + 호출부 6곳.
- heartbeat_service.rs — 제품: owned_job_names 신설, 호출부 2곳. 테스트: #[ignore] 4개 제거 + 주석 현행화.
- heartbeat_roles.rs — 테스트 헬퍼만 (소유 이름을 역할 3종 전체로 계산 — jobs_without 시험 보호).
- heartbeat_dream.rs — 테스트 헬퍼 + 호출부 6곳.

프런트 무변경, mod.rs 무변경(TASK-070 범위 미접촉), 보호 상태 무변경, git 커밋 없음.

## 검증 (수치)

- cargo test: 370 passed / 0 failed / 0 ignored (직전 366+4 ignored)
- TASK-063 재현 테스트 4종 이름 지정: 4 passed
- cargo fmt --check exit 0 / clippy: 내 변경 파일 진단 0 (범위 밖 1건 잔존 — 리스크 1)
- npm run check: 16 files / 374 passed + 빌드 성공
- 무수정 통과 기존 테스트 6종 확인 (빈 파일 단언·멱등성·마커 손상 계열 — R5 근거)
- 임시 프로브 실측 후 완전 제거(백업과 바이트 동일 diff 확인): 두 번 저장 멱등, 순서 규칙, 남의 잡 3종 값(모르는 필드·다른 순서·검증 불가 값) 원문 잔존, 블록 밖 원문 보존
- slug·잡 이름 규칙 무변경 (완료 조건 11, diff 확인)

## 리스크와 후속

1. 범위 밖 clippy 1건 (핸드오프): heartbeat_process.rs:216 cloned_ref_to_slice_refs — TASK-070(병행 중) 신설 untracked 파일. 그 작업이 닫히기 전 처리돼야 -D warnings 게이트 그린.
2. 순서 규칙 상호작용: 타 프로젝트 앱도 같은 로직을 가지면 저장 주체 교대마다 블록 안 두 그룹 앞뒤가 뒤집힘 — 값 보존·멱등은 유지, 구조 해소는 jobs.d 전환(IDEA-CAB890F1).
3. 블록 안 첫 헤더 앞 줄은 비보존 (현행 동작 동일, 정상 파일엔 없는 형태).
4. R3(문구)은 TASK-065 범위.
5. SPEC-022 완료 조건 6 근거: 저장이 지우는 잡 = owned_job_names 범위 = 화면 removedJobs 출처(managedJobs)와 일치 — 화면 확인은 TASK-065에서.

## QA 제안

1. 역할 잡 설치·해제 시 블록 안 타 프로젝트 잡이 값째 남는지.
2. 전부 끈 저장에서 블록 존속(남의 잡 有)/소멸(無) 확인.
3. 이 기기는 jobs.d 사용 중이라 재현하려면 다른 slug 잡을 넣은 HEARTBEAT.md를 만들어 저장해야 함.

## 부록 — TASK-063 핸드오프 조건 사후 대조 (착지 후 중계 수신, 2026-08-04T09:17Z)

TL의 조건 중계가 착지 후 도착해 사후 대조를 수행한 결과 5개 조건 전부 이미 반영 확인, 추가 변경 없음.

1. 블록 제거 조건: render_block 진입부가 정확히 `jobs.is_empty() && preserved.is_empty()` — 두 픽스처(빈 파일 단언·남의 잡 존속) 모두 통과 실측.
2. mod install_tests: 처음부터 그쪽에서 작업 (테스트 출력 경로로 확인).
3. R2 함정: 원문 문자열 보존으로 원천 차단 — validate_preserved 대상은 여전히 자기 slug뿐, `- interval: 20분` 둔 채 양쪽 저장 성공 실측. 구간을 헤더 직전까지로 잡아 한 단계 더 안전.
4. 순서 단언 좁히기: 하지 않음(의도적 — 작업 범위 밖 판단). 순서 규칙은 프로브 실측으로 고정, 단언 강화는 후속 선택지로 남김.
5. 픽스처 헬퍼: 그대로 사용, 한 글자도 수정 없음.

게이트 기준점 정정: TL이 제시한 356/0/0은 병행 세션들의 untracked 테스트(+14) 때문에 현 트리와 불일치. 올바른 판정 기준은 절대 수치가 아니라 "ignored 0 + 재현 4종 통과 + 보호 테스트 무수정 통과"이며 충족됨 (실측: cargo 370/0/0, npm 374, 보호 3종+재현 4종 조합 실행 7 passed).

리스크 재확인: heartbeat_process.rs:216 clippy(cloned_ref_to_slice_refs)가 -D warnings를 빨갛게 유지 — TASK-070 계열 소유, 그쪽 착지 전 처리 필요.
