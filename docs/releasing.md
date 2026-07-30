# 릴리스 가이드

## 브랜치 흐름

1. 기능 브랜치는 `dev`에서 분기하고 `dev`로 PR을 보낸다.
2. 릴리스 후보가 안정화되면 `dev`를 `main`으로 PR한다.
3. `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`의 버전을 함께 변경한다.
4. `main` 병합 후 같은 버전의 태그를 만든다.

```bash
git tag v0.1.0
git push origin v0.1.0
```

## GitHub 설정

업데이트 서명 키는 로컬에서 생성하고 개인 키를 저장소에 커밋하지 않는다.

```bash
npm run tauri signer generate -- -w /안전한/외부/경로/workflow-labs.key
```

GitHub Actions secret:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- `TAURI_UPDATER_PUBLIC_KEY`

제품 배포 전에는 다음 OS 서명 값도 설정한다.

- macOS Developer ID 인증서와 notarization 자격 증명
- Windows code-signing 인증서 또는 서명 서비스 자격 증명

Tauri updater 서명은 업데이트 산출물의 무결성을 확인하지만 macOS/Windows의 개발자 신뢰 서명을 대체하지 않는다.

## 배포 방식

`v*` 태그는 GitHub Actions에서 Linux, Windows, macOS universal 빌드와 `latest.json`을 생성한다. 릴리스는 드래프트로 만들어지며 설치 확인 후 사람이 게시한다. 앱 내부 updater는 게시된 최신 릴리스만 확인한다.

앱 업데이트는 프로젝트 Markdown을 자동으로 마이그레이션하지 않는다. 문서 마이그레이션은 프로젝트를 열 때 별도의 백업·lease 확인 절차로 실행한다.
