import type { AppUpdaterState } from "../domain/types";
import { Icon } from "../../../shared/ui/Icon";

interface Props {
  updater: AppUpdaterState;
}

export function UpdateControl({ updater }: Props) {
  if (updater.phase === "available") {
    return (
      <button className="update-control available" onClick={() => void updater.install()}>
        <Icon name="spark" />
        <span><strong>v{updater.version} 사용 가능</strong><small>다운로드 및 설치</small></span>
      </button>
    );
  }

  if (updater.phase === "downloading") {
    return (
      <div className="update-progress">
        <span>업데이트 다운로드 중</span>
        <div><i style={{ width: `${updater.progress ?? 12}%` }} /></div>
      </div>
    );
  }

  if (updater.phase === "ready") {
    return (
      <button className="update-control available" onClick={() => void updater.restart()}>
        <Icon name="refresh" />
        <span><strong>업데이트 준비 완료</strong><small>앱 다시 시작</small></span>
      </button>
    );
  }

  const labels: Record<string, string> = {
    checking: "업데이트 확인 중…",
    current: "최신 버전입니다",
    error: "업데이트 확인 실패",
  };

  return (
    <button
      className="update-control"
      disabled={updater.phase === "checking"}
      onClick={() => void updater.check()}
      title={updater.error ?? undefined}
    >
      <Icon name="refresh" />
      <span>{labels[updater.phase] ?? "업데이트 확인"}</span>
    </button>
  );
}
