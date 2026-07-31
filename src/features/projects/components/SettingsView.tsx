import { Icon } from "../../../shared/ui/Icon";
import { UpdateControl } from "../../updater/components/UpdateControl";
import type { AppUpdaterState } from "../../updater/domain/types";
import type { ProjectSummary, SchemaCompatibility } from "../domain/types";

interface Props {
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

export function SettingsView({ project, updater, onSwitchProject }: Props) {
  return (
    <section className="settings-view">
      <div className="view-heading">
        <div>
          <p className="eyebrow">SETTINGS</p>
          <h1>설정</h1>
          <p>앱 업데이트와 현재 프로젝트의 연결 상태를 관리합니다.</p>
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
      </div>
    </section>
  );
}
