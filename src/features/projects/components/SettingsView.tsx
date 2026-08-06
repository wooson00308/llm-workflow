import { Icon } from "../../../shared/ui/Icon";
import { UpdateControl } from "../../updater/components/UpdateControl";
import type { AppUpdaterState } from "../../updater/domain/types";
import type {
  CustomRulesActions,
  CustomRulesState,
  ManagedAssetState,
  ManagedAssetStatus,
  ManagedAssetSyncResult,
  ManagedAssetSyncStatus,
  ManagedAssetSyncTrigger,
  ManagedAssetsState,
  ProjectSummary,
  SchemaCompatibility,
} from "../domain/types";
import { CustomRulesCard } from "./CustomRulesCard";

interface Props {
  customRules: CustomRulesState;
  customRulesActions: CustomRulesActions;
  managedAssets: ManagedAssetsState;
  project: ProjectSummary;
  updater: AppUpdaterState;
  onSwitchProject(): void;
}

const compatibilityLabels: Record<SchemaCompatibility, string> = {
  current: "현재 문서 규격",
  future_schema: "더 새로운 문서 규격",
  migration_required: "마이그레이션 필요",
  not_initialized: "초기화되지 않음",
};

const syncStatusLabels: Record<ManagedAssetSyncStatus, string> = {
  current: "현재 상태",
  updated: "갱신됨",
  retry_required: "재시도 필요",
  conflict: "충돌",
};

// 재시도와 충돌은 사용자가 할 일이 다르다. 잠금은 기다렸다 다시 누르면 되고, 충돌은 파일을 직접
// 확인해야 한다. 두 문구를 합치면 어느 쪽인지 알 수 없다.
const syncStatusGuides: Record<ManagedAssetSyncStatus, string> = {
  current: "설치본이 앱이 제공하는 버전과 같아 파일을 쓰지 않았습니다.",
  updated: "앱이 제공하는 버전으로 규칙 파일을 갱신했습니다.",
  retry_required: "다른 쓰기 작업 때문에 이번에는 설치하지 않았습니다. 잠시 뒤 새로 고침을 누르면 다시 시도합니다.",
  conflict: "앱이 파일을 덮어쓰지 않았습니다. 아래 자산의 이유를 확인하고 파일을 정리한 뒤 새로 고침을 누르세요.",
};

const assetStatusLabels: Record<ManagedAssetStatus, string> = {
  current: "현재",
  update_required: "갱신 대기",
  updated: "갱신됨",
  retry_required: "재시도 필요",
  conflict: "충돌",
};

const triggerLabels: Record<ManagedAssetSyncTrigger, string> = {
  project_open: "프로젝트 열기",
  manual_refresh: "수동 새로 고침",
};

export function SettingsView({
  customRules,
  customRulesActions,
  managedAssets,
  project,
  updater,
  onSwitchProject,
}: Props) {
  return (
    <section className="settings-view">
      <div className="view-heading">
        <div>
          <p className="eyebrow">SETTINGS</p>
          <h1>설정</h1>
          <p>앱 업데이트와 현재 프로젝트의 연결·감시 상태를 관리합니다.</p>
        </div>
      </div>

      <div className="settings-grid">
        <section className="settings-card update-settings-card">
          <header>
            <span><Icon name="refresh" /></span>
            <div><strong>앱 업데이트</strong><small>서명된 최신 버전을 확인하고 설치합니다.</small></div>
          </header>
          <UpdateControl updater={updater} />
        </section>

        <section className="settings-card">
          <header>
            <span><Icon name="folder" /></span>
            <div><strong>현재 프로젝트</strong><small>앱이 읽고 있는 로컬 작업 공간입니다.</small></div>
          </header>
          <dl className="settings-details">
            <div><dt>이름</dt><dd>{project.name}</dd></div>
            <div><dt>위치</dt><dd title={project.rootPath}>{project.rootPath}</dd></div>
            <div><dt>워크플로우</dt><dd>{project.workflows.length}개</dd></div>
            <div><dt>문서 호환성</dt><dd><span className={`compatibility-status status-${project.compatibility}`}>{compatibilityLabels[project.compatibility]}</span></dd></div>
          </dl>
          <button className="secondary-button settings-switch-button" onClick={onSwitchProject} type="button">다른 프로젝트 열기</button>
        </section>

        <section className="settings-card">
          <header>
            <span><Icon name="workflow" /></span>
            <div><strong>파일 감시</strong><small>외부 LLM과 앱의 변경 사항을 자동으로 동기화합니다.</small></div>
          </header>
          <div className="settings-state-row">
            <span className="settings-state-dot" />
            <span><strong>자동 새로고침 사용 중</strong><small>2.5초 간격으로 Markdown 변경을 확인합니다.</small></span>
          </div>
          <div className="settings-state-row muted">
            <Icon name="archive" />
            <span><strong>{project.activeLeases.length}개의 활성 작업 lease</strong><small>활성 lease가 있으면 문서 마이그레이션을 보호합니다.</small></span>
          </div>
        </section>

        <ManagedRulesCard compatibility={project.compatibility} managedAssets={managedAssets} />
        <CustomRulesCard
          actions={customRulesActions}
          activeLeaseCount={project.activeLeases.length}
          state={customRules}
        />
      </div>
    </section>
  );
}

function ManagedRulesCard({
  compatibility,
  managedAssets,
}: {
  compatibility: SchemaCompatibility;
  managedAssets: ManagedAssetsState;
}) {
  const { syncing, result, error, trigger } = managedAssets;
  return (
    <section aria-label="관리 규칙" className="settings-card managed-rules-card">
      <header>
        <span><Icon name="stamp" /></span>
        <div><strong>관리 규칙</strong><small>앱이 설치하는 공통 규칙과 역할 계약의 상태입니다.</small></div>
      </header>

      {syncing ? (
        <div className="settings-state-row">
          <Icon name="refresh" />
          <span><strong>동기화 중</strong><small>관리 규칙의 설치 상태를 확인하고 있습니다.</small></span>
        </div>
      ) : error ? (
        <div className="settings-state-row managed-rules-state sync-error">
          <Icon name="help" />
          <span>
            <strong>동기화 명령이 실패했습니다</strong>
            <small>{error}</small>
            <small>프로젝트 문서는 그대로 열려 있습니다. 새로 고침을 누르면 다시 시도합니다.</small>
          </span>
        </div>
      ) : result ? (
        <div className={`settings-state-row managed-rules-state sync-${result.status}`}>
          <Icon name="stamp" />
          <span>
            <strong>{syncStatusLabels[result.status]}</strong>
            <small>{syncStatusGuides[result.status]}</small>
          </span>
        </div>
      ) : (
        <div className="settings-state-row muted">
          <Icon name="archive" />
          <span>
            <strong>아직 동기화하지 않았습니다</strong>
            <small>
              {compatibility === "current"
                ? "프로젝트를 다시 열거나 새로 고침을 누르면 설치 상태를 확인합니다."
                : "현재 문서 규격이 아닌 프로젝트에서는 관리 규칙을 설치하지 않습니다."}
            </small>
          </span>
        </div>
      )}

      {result && (
        <dl className="settings-details">
          <div><dt>마지막 동기화</dt><dd>{trigger ? triggerLabels[trigger] : "계기를 알 수 없음"}</dd></div>
          {result.status === "updated" && (
            <div>
              <dt>갱신한 자산</dt>
              <dd title={updatedAssetLabels(result)}>{updatedAssetLabels(result)}</dd>
            </div>
          )}
          {result.affectedAsset && (
            <div>
              <dt>확인할 자산</dt>
              <dd>{assetLabel(result, result.affectedAsset)}</dd>
            </div>
          )}
        </dl>
      )}

      {result && (
        <ul className="managed-rules-assets">
          {result.assets.map((asset) => (
            <li key={asset.id}>
              <div>
                <strong>{asset.label}</strong>
                <span className={`managed-asset-status status-${asset.status}`}>{assetStatusLabels[asset.status]}</span>
              </div>
              <span className="managed-asset-versions">{versionLine(asset)}</span>
              {asset.reason && <small>{asset.reason}</small>}
            </li>
          ))}
        </ul>
      )}

      {result && (result.rollbackFailures.length > 0 || result.rollbackRecoveries.length > 0) && (
        <ul className="managed-rules-recoveries">
          {result.rollbackFailures.map((failure) => (
            <li key={`failure-${failure.assetId}`}>
              <strong>{failure.label} 되돌리기 실패</strong>
              <small>{failure.reason}</small>
              {failure.recoveryPath && <small>복구 위치: {failure.recoveryPath}</small>}
            </li>
          ))}
          {result.rollbackRecoveries.map((recovery) => (
            <li key={`recovery-${recovery.assetId}`}>
              <strong>{recovery.label} 원본 보관</strong>
              <small>복구 위치: {recovery.recoveryPath}</small>
            </li>
          ))}
        </ul>
      )}

      <p className="managed-rules-note">
        규칙 변경은 다음에 시작하는 에이전트 세션부터 적용됩니다. 이미 실행 중인 세션이 새 규칙을 읽었는지는
        앱이 알 수 없습니다.
      </p>
    </section>
  );
}

/**
 * 진입 안내는 버전을 쓰지 않는 자산이라 숫자를 만들어 붙이지 않는다. 버전을 쓰는 자산에서 설치 값이
 * 없으면 그것대로 읽지 못했다고 적는다.
 */
function versionLine(asset: ManagedAssetState) {
  if (asset.providedVersion === null) return "버전을 쓰지 않는 자산";
  const installed = asset.installedVersion === null ? "확인 못 함" : `${asset.installedVersion}`;
  return `설치 ${installed} · 제공 ${asset.providedVersion}`;
}

function assetLabel(result: ManagedAssetSyncResult, id: string) {
  return result.assets.find((asset) => asset.id === id)?.label ?? id;
}

function updatedAssetLabels(result: ManagedAssetSyncResult) {
  return result.updatedAssets.map((id) => assetLabel(result, id)).join(", ");
}
