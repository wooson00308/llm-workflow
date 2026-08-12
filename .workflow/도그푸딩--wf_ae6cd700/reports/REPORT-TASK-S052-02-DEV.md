# TASK-S052-02 개발 보고서

## 결정권자 요약

정확한 제목과 순서를 만족하는 요약만 결정 보드용 값으로 분리했다.
누락, 중복, 빈 값, 다른 목록 형식은 값을 추측하지 않고 기존 평문 표시로 돌려보낸다.
원문 Markdown은 변환하거나 저장하지 않았고 네트워크나 브라우저 의존성도 추가하지 않았다.
자동 검사와 타입 검사가 모두 통과했으며 사용자는 작업 문서의 확인 동선으로 QA할 수 있다.

## 변경 파일과 모듈

- `src/features/projects/domain/documentSections.ts`: 구조화된 요약 값 모델과 순수 판정 함수를 추가했다.
  정확한 여섯 제목과 선택 위험 항목, 영향 범위의 두 표식을 순서대로 검증하고 완전한 값만 반환한다.
- `src/features/projects/domain/documentSections.test.ts`: 위험 유무, Markdown 원문 보존, 모든 필수 제목과 값,
  영향 범위 표식, 제목 순서·깊이·중복·알 수 없는 제목의 폴백 검사를 추가했다.

## 검증 절차와 결과

- `npx vitest run src/features/projects/domain/documentSections.test.ts` 통과: 45 passed, 0 failed.
- `npm run typecheck` 통과.
- `git diff --check -- src/features/projects/domain/documentSections.ts src/features/projects/domain/documentSections.test.ts` 통과.

## 남은 위험

- 이 작업은 문법만 판정한다. 이후 화면 작업이 이 값을 표시하는 접근성·반응형 동선은 다음 작업의 범위다.
- 자유로운 Markdown 값 안의 코드 펜스는 원문으로 보존한다. 코드 펜스 밖의 Markdown 제목은 계약 위반으로
  폴백하므로 보드에 임의의 하위 구조가 섞이지 않는다.

## 후속 작업

- 작업 문서의 완료 조건은 반환값을 여덟 값이라고 부르지만 열거한 필수 필드는 일곱 개다. SPEC-052의
  계약 예시를 확인해 선택 위험 값을 포함할 때만 여덟 값이 되도록 구현했다. 이후 작업 문서 작성 시 이
  표현을 명확히 하는 것이 좋다.
- 후속 화면 작업은 이 판정 결과가 `null`일 때 기존 Markdown 표시를 유지하면 된다.
