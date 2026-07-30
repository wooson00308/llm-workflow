export interface UpdateInfo {
  version: string;
  notes: string | null;
}

export interface UpdaterGateway {
  check(): Promise<UpdateInfo | null>;
  downloadAndInstall(onProgress: (progress: number | null) => void): Promise<void>;
  restart(): Promise<void>;
}

export type UpdatePhase =
  | "idle"
  | "checking"
  | "current"
  | "available"
  | "downloading"
  | "ready"
  | "error";

export interface AppUpdaterState {
  phase: UpdatePhase;
  version: string | null;
  progress: number | null;
  error: string | null;
  check(): Promise<void>;
  install(): Promise<void>;
  restart(): Promise<void>;
}
