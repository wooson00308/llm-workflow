import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: true,
    // 격리 작업 사본은 저장소 전체의 사본이라, 제외하지 않으면 사본 수만큼 같은 테스트가
    // 반복 실행된다(2026-08-15 실측: 462개가 3,237개로 불어남).
    exclude: [...configDefaults.exclude, "**/.workflow/**"],
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      // `.workflow`는 워크플로 문서와 에이전트 런타임 상태(격리 작업 사본 포함)의 자리다.
      // 사본에는 tsconfig까지 통째로 들어 있어, 감시에 두면 개발 세션이 예약될 때마다
      // Vite가 설정 변경으로 오인해 화면 전체를 리로드한다(2026-08-15 실측).
      ignored: ["**/src-tauri/**", "**/.workflow/**"],
    },
  },
}));
