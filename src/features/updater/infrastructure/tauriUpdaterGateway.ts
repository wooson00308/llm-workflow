import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import type { UpdaterGateway } from "../domain/types";

let pendingUpdate: Update | null = null;

export const tauriUpdaterGateway: UpdaterGateway = {
  async check() {
    pendingUpdate = await check();
    if (!pendingUpdate) return null;
    return {
      version: pendingUpdate.version,
      notes: pendingUpdate.body ?? null,
    };
  },

  async downloadAndInstall(onProgress) {
    if (!pendingUpdate) throw new Error("설치할 업데이트를 먼저 확인해 주세요.");
    let downloaded = 0;
    let total: number | null = null;
    await pendingUpdate.downloadAndInstall((event) => {
      if (event.event === "Started") {
        total = event.data.contentLength ?? null;
        onProgress(total ? 0 : null);
      } else if (event.event === "Progress") {
        downloaded += event.data.chunkLength;
        onProgress(total ? Math.min(100, (downloaded / total) * 100) : null);
      } else if (event.event === "Finished") {
        onProgress(100);
      }
    });
  },

  restart: relaunch,
};
