import { useState } from "react";
import type {
  IntegrationActions,
  IntegrationsSnapshot,
  IntegrationWriteError,
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
}

/**
 * 연동 전용 뷰.
 *
 * 내장 연동 목록을 순회해 카드를 그리는 일만 한다. 특정 연동의 타입도 문구도 알지 못한다.
 */
export function IntegrationsView({ snapshot, error, writeError, actions }: Props) {
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

      {/* 플랫폼 지원 여부는 뷰 공통 정책이라 카드마다 반복하지 않는다. */}
      {snapshot && !snapshot.supported && (
        <div className="integration-warning">
          <strong>이 플랫폼에서는 연동을 지원하지 않습니다</strong>
          <p>조건 검사가 POSIX sh 스크립트라 Windows에서는 잡이 조용히 건너뛰어집니다.</p>
        </div>
      )}

      <div className="integration-list">
        {integrations.map(({ id, Card }) => (
          <Card
            actions={actions}
            error={error}
            expanded={expanded[id] ?? false}
            key={id}
            onToggleExpanded={() => toggle(id)}
            snapshot={snapshot}
            writeError={writeError?.integration === id ? writeError.message : null}
          />
        ))}
      </div>
    </section>
  );
}
