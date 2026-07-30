import { useState } from "react";
import type {
  AppUpdaterState,
  UpdatePhase,
  UpdaterGateway,
} from "../domain/types";

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function useAppUpdater(gateway: UpdaterGateway): AppUpdaterState {
  const [phase, setPhase] = useState<UpdatePhase>("idle");
  const [version, setVersion] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function checkForUpdate() {
    setPhase("checking");
    setError(null);
    try {
      const update = await gateway.check();
      if (!update) {
        setPhase("current");
        setVersion(null);
        return;
      }
      setVersion(update.version);
      setPhase("available");
    } catch (reason) {
      setError(messageFrom(reason));
      setPhase("error");
    }
  }

  async function install() {
    setPhase("downloading");
    setError(null);
    try {
      await gateway.downloadAndInstall(setProgress);
      setPhase("ready");
    } catch (reason) {
      setError(messageFrom(reason));
      setPhase("error");
    }
  }

  async function restart() {
    try {
      await gateway.restart();
    } catch (reason) {
      setError(messageFrom(reason));
      setPhase("error");
    }
  }

  return {
    phase,
    version,
    progress,
    error,
    check: checkForUpdate,
    install,
    restart,
  };
}
