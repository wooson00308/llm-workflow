# Workflow Labs

프로젝트 디렉터리의 Markdown 문서를 아이디어, 기획, 승인, 개발 작업, QA 흐름으로 보여주는 로컬 우선 데스크톱 클라이언트입니다.

Workflow Labs는 LLM을 실행하지 않습니다. 외부 LLM과 앱은 `.workflow/` 아래의 Markdown/YAML 파일 계약으로 협업합니다.

## 기술 스택

- Tauri 2 / Rust
- React 19 / TypeScript / Vite
- Vitest / Testing Library / Rust test

## 개발

필수 환경은 Node.js 22 이상, Rust stable, 각 OS의 Tauri 2 빌드 의존성입니다.

```bash
npm ci
npm run check
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri dev
```

## 구조

```text
src/
├── features/
│   ├── projects/
│   │   ├── application/
│   │   ├── components/
│   │   ├── domain/
│   │   └── infrastructure/
│   └── updater/
└── shared/

src-tauri/src/
├── domain/
├── application/
├── infrastructure/
└── commands/
```

프런트엔드 컴포넌트는 Tauri API를 직접 호출하지 않습니다. domain의 port를 application 계층이 사용하고 infrastructure adapter가 Tauri IPC를 구현합니다. Rust command는 얇게 유지하고 파일 규약과 안전 정책은 domain/application/infrastructure에 둡니다.

## 브랜치와 릴리스

- `main`: 릴리스 가능한 안정 브랜치
- `dev`: 기능 통합 브랜치
- 기능 브랜치 → `dev` PR → 안정화 후 `main` PR
- `main`의 버전 커밋에 `vX.Y.Z` 태그를 생성하면 Windows/Linux/macOS 드래프트 릴리스가 빌드됩니다.

자세한 내용은 [릴리스 가이드](docs/releasing.md)와 [제품·기술 기준](docs/planning/product-concept.md)을 참고하세요.

외부 LLM이 작성해야 하는 frontmatter와 사용자 결정 규칙은 [파일 계약](docs/file-contract.md)에 정의되어 있습니다.
