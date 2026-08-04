import { writeText } from "@tauri-apps/plugin-clipboard-manager";

/**
 * 문자열을 클립보드에 쓴다. 성공이면 참, 실패면 거짓이다.
 *
 * 웹 표준 `navigator.clipboard`를 쓰지 않는다. 그 API는 보안 컨텍스트를 요구하는데, Tauri가 앱을
 * 띄우는 커스텀 스킴이 모든 플랫폼에서 보안 컨텍스트로 잡힌다는 보장이 없다 — 복사가 특정 플랫폼
 * 에서만 조용히 안 되는 결과를 피한다.
 *
 * 예외를 밖으로 던지지 않는다. 클립보드가 없는 환경(테스트, 권한 거부)에서 화면이 깨지면 안 되고,
 * 복사는 편의라 실패해도 명령 원문은 화면에 그대로 남는다(SPEC-016 R6). 실패를 값으로 돌려주는
 * 것은 `jobValueMemoryStore`와 같은 결이다.
 *
 * 플러그인을 import 하는 자리는 여기 하나다. 화면은 이 모듈만 부른다.
 */
export async function copy(text: string): Promise<boolean> {
  try {
    await writeText(text);
    return true;
  } catch {
    return false;
  }
}
