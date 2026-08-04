import { useState } from "react";
import type {
  HeartbeatRunControls,
  IntegrationActions,
  IntegrationsSnapshot,
  IntegrationWriteError,
  PendingRoleWork,
} from "../../domain/types";
import { browserIntegrationCollapseStore } from "../../infrastructure/browserIntegrationCollapseStore";
import { integrations } from "./registry";

interface Props {
  /** 아직 읽지 않았거나 조회에 실패하면 null이다. */
  snapshot: IntegrationsSnapshot | null;
  error: string | null;
  /** 어느 연동의 쓰기가 실패했는지 함께 담긴다. 카드에는 자기 실패만 내려간다. */
  writeError: IntegrationWriteError | null;
  actions: IntegrationActions;
  /** 프로젝트의 역할별 대기 물량. 뷰는 값의 내용을 보지 않고 카드에 그대로 넘긴다. */
  pendingWork?: PendingRoleWork;
  /** 잡 실행의 진행·실패 상태와 실행 통로. 뷰는 값의 내용을 보지 않고 카드에 그대로 넘긴다. */
  heartbeatRuns: HeartbeatRunControls;
}

/**
 * 연동 전용 뷰.
 *
 * 내장 연동 목록을 순회해 카드를 그리는 일만 한다. 특정 연동의 타입도 문구도 알지 못한다.
 */
export function IntegrationsView({
  snapshot,
  error,
  writeError,
  actions,
  pendingWork,
  heartbeatRuns,
}: Props) {
  /**
   * 연동 id를 키로 하는 펼침 여부. 값이 없는 연동은 접힘이므로 첫 화면은 전부 접혀 있다.
   * 기억은 연동 단위여서 한 카드를 펼쳐도 다른 카드는 그대로다.
   *
   * 초기값은 브라우저 저장소에서 읽는다. 뷰 전환은 이 컴포넌트의 언마운트·재마운트라서 다른 화면을
   * 다녀오는 것과 앱을 다시 여는 것이 같은 경로다. 게으른 초기화라 렌더마다 읽지 않는다.
   */
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    browserIntegrationCollapseStore.load(),
  );

  // 저장은 뷰의 관심사다. 토글이 바꾼 값만 쓰므로 첫 마운트에서 읽은 값을 되쓰는 낭비가 없다.
  function toggle(id: string) {
    const next = { ...expanded, [id]: !(expanded[id] ?? false) };
    setExpanded(next);
    browserIntegrationCollapseStore.save(next);
  }

  return (
    <section aria-label="연동" className="integrations-view">
      <div className="view-heading">
        <div>
          <p className="eyebrow">INTEGRATIONS</p>
          <h1>연동</h1>
          <p>앱에 내장된 연동만 표시합니다. 외부 연동을 추가로 등록하지 않습니다.</p>
        </div>
      </div>

      {/* 플랫폼 지원 여부는 뷰 공통 정책이라 카드마다 반복하지 않는다.
          지금은 어떤 플랫폼에서도 그려지지 않는다 — 연동을 막던 이유가 사라져 payload의
          `supported`가 항상 참이다. 분기를 남기는 것은 그 필드가 섹션 공통 계약이고, 다시 미지원으로
          표시할 플랫폼이 생기면 이 자리가 그대로 쓰이기 때문이다. */}
      {snapshot && !snapshot.supported && (
        <div className="integration-warning">
          <strong>이 플랫폼에서는 연동을 지원하지 않습니다</strong>
          <p>앱이 이 플랫폼에서는 연동 잡을 설치하지 않습니다. 설치와 저장 액션은 비활성 상태입니다.</p>
        </div>
      )}

      <div className="integration-list">
        {integrations.map(({ id, Card }) => (
          <Card
            actions={actions}
            error={error}
            expanded={expanded[id] ?? false}
            heartbeatRuns={heartbeatRuns}
            key={id}
            onToggleExpanded={() => toggle(id)}
            pendingWork={pendingWork}
            snapshot={snapshot}
            writeError={writeError?.integration === id ? writeError.message : null}
          />
        ))}
      </div>
    </section>
  );
}
