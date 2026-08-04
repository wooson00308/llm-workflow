---
schema: workflow-labs/idea@1
id: IDEA-CAB890F1
status: inbox
created_at: 2026-08-04T07:23:55.560894+00:00
---

하트비트 데몬 0.8의 jobs.d 계약으로 앱 쓰기 경로 전환. 데몬이 ~/.claude/heartbeat/jobs.d/<slug>.md (프로젝트당 파일 하나)를 지원하게 됐어. 앱이 HEARTBEAT.md 마커 블록 대신 자기 slug 파일 하나를 통째로 쓰면 크로스 프로젝트 증발이 구조적으로 불가능해지고, 마커·부분 병합·baseline 대조 로직이 크게 단순해져. 계약 문서는 claude-heartbeat 저장소 docs/config-contract.md. 주의: 앱이 전환하기 전에 migrate를 돌리면 앱 재설치가 마커 블록을 다시 채워 중복 정의가 생기니, 전환과 migrate를 짝으로 진행해야 해.
