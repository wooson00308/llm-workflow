import { useId } from "react";
import type { ComponentType, ReactNode } from "react";
import type {
  AgentLeaseSummary,
  DuplicateIntegrationJob,
  HeartbeatRunControls,
  HeartbeatServiceControls,
  HeartbeatSetupRunControls,
  HeartbeatUpdateControls,
  HeartbeatVersionControls,
  IntegrationActions,
  IntegrationReadFailure,
  IntegrationsSnapshot,
  PendingRoleWork,
} from "../../domain/types";

/** 연동 본문이 받는 값. 섹션은 이 객체를 그대로 넘기기만 하고 내용을 들여다보지 않는다. */
export interface IntegrationCardProps {
  /** 아직 읽지 않았거나 조회에 실패하면 null이다. */
  snapshot: IntegrationsSnapshot | null;
  error: string | null;
  writeError: string | null;
  actions: IntegrationActions;
  /** 펼침 상태의 주인은 뷰다. 카드는 받은 값을 골격에 그대로 넘긴다. */
  expanded: boolean;
  onToggleExpanded(): void;
  /** 프로젝트의 역할별 대기 물량. 카드가 자기 판정에 쓰고, 섹션은 내용을 들여다보지 않는다. */
  pendingWork?: PendingRoleWork;
  /**
   * 잡 실행의 진행·실패 상태와 실행 통로. 섹션은 내용을 들여다보지 않고 그대로 넘긴다.
   *
   * 선택이 아니라 필수다. 선택으로 두면 배선을 빠뜨려도 컴파일이 통과하고, 카드는 조용히 실행
   * 액션이 없는 화면이 된다.
   */
  heartbeatRuns: HeartbeatRunControls;
  /**
   * 프로젝트의 활성 lease. 재기동이 끊는 세션을 확인 화면에서 고지하는 데 쓴다(SPEC-037 R3).
   * 섹션은 내용을 들여다보지 않고 그대로 넘긴다.
   */
  activeLeases?: AgentLeaseSummary[];
  /**
   * 업데이트 실행의 진행·결과 상태와 실행 통로. 섹션은 내용을 들여다보지 않고 그대로 넘긴다.
   *
   * `heartbeatRuns`와 달리 선택이다. 이 둘은 하트비트 카드만 쓰는 값이고, 카드를 떼어 그리는
   * 검사가 props 리터럴을 직접 조립하기 때문이다. 배선이 빠지는 것을 막는 자리는 섹션 쪽 props로,
   * 거기서는 필수다 — 뷰가 카드를 그릴 때 이 값이 없으면 컴파일이 통과하지 않는다.
   */
  heartbeatUpdate?: HeartbeatUpdateControls;
  /**
   * 설치 단계 실행의 진행·결과 상태와 실행 통로. 섹션은 내용을 들여다보지 않고 그대로 넘긴다.
   * `heartbeatUpdate`와 같은 이유로 선택이다.
   */
  heartbeatSetupRuns?: HeartbeatSetupRunControls;
  /** 버전 판정의 진행·결과 상태와 조회 통로. `heartbeatUpdate`와 같은 이유로 선택이다. */
  heartbeatVersions?: HeartbeatVersionControls;
  /** 데몬 끄기·켜기의 진행·결과 상태와 실행 통로. `heartbeatUpdate`와 같은 이유로 선택이다. */
  heartbeatService?: HeartbeatServiceControls;
}

/** 내장 연동 목록의 항목. */
export interface IntegrationDefinition {
  id: string;
  Card: ComponentType<IntegrationCardProps>;
}

export interface IntegrationBadge {
  label: string;
  /** 배지 색을 정하는 CSS 클래스 접미사. */
  tone: string;
}

/** 중복 잡 경고의 연동별 문구. 목록을 그리는 일은 골격이 한다. */
export interface DuplicateJobWarning {
  title: string;
  description: string;
  describe(job: DuplicateIntegrationJob): string;
}

interface Props {
  name: string;
  description: string;
  /** null이면 아직 상태를 읽지 못한 것이다. 골격이 대기 배지를 대신 보여준다. */
  badge: IntegrationBadge | null;
  /** 섹션 조회가 실패한 사유. 있으면 본문 대신 이 문구만 보여준다. */
  error: string | null;
  duplicateJobs: DuplicateIntegrationJob[];
  duplicateWarning: DuplicateJobWarning;
  readFailures: IntegrationReadFailure[];
  /**
   * 저장 실패 사유. 골격은 접힘 요약의 판정에만 쓰고 문구는 그리지 않는다. 실패 문구를 그리는 자리는
   * 지금처럼 연동 본문이다.
   */
  writeError: string | null;
  /**
   * 연동 본문만 아는 경고가 있는지. 골격은 그 경고가 무엇인지 알지 못하고 접힘 요약 판정에만 쓴다.
   * 세 번째 연동이 같은 통로를 그대로 쓴다.
   */
  bodyWarning: boolean;
  expanded: boolean;
  onToggleExpanded(): void;
  /** 연동별 본문. 이 연동만 아는 내용은 전부 여기에 있다. */
  children: ReactNode;
}

const unknownBadge: IntegrationBadge = { label: "상태를 읽을 수 없음", tone: "unknown" };
const pendingBadge: IntegrationBadge = { label: "확인 중", tone: "unknown" };

/**
 * 연동 카드의 공통 골격.
 *
 * 이름·설명·설치 상태 배지·접힘 요약·펼침 토글·미설치 안내 자리·중복 잡 경고·읽기 실패 목록·
 * 연동별 본문 자리를 책임진다. 어느 연동인지는 알지 못하므로 새 연동이 와도 이 파일은 고치지 않는다.
 *
 * 접기는 언마운트가 아니다. 본문을 조건부 렌더에서 빼면 연동 본문의 편집 중인 폼 값이 사라진다.
 * DOM에 남긴 채 `hidden`으로 감춘다.
 */
export function IntegrationCard({
  name,
  description,
  badge,
  error,
  duplicateJobs,
  duplicateWarning,
  readFailures,
  writeError,
  bodyWarning,
  expanded,
  onToggleExpanded,
  children,
}: Props) {
  const shown = error ? unknownBadge : (badge ?? pendingBadge);
  const bodyId = useId();
  /** 골격이 아는 경고 신호. 상세는 본문에 있고 요약은 있다는 사실까지만 알린다. */
  const hasWarning =
    Boolean(error) ||
    Boolean(writeError) ||
    duplicateJobs.length > 0 ||
    readFailures.length > 0 ||
    bodyWarning;

  return (
    <article aria-label={name} className="integration-item">
      <div className="integration-item-head">
        <div><strong>{name}</strong><small>{description}</small></div>
        <div className="integration-item-marks">
          {hasWarning && <span className="integration-alert">확인할 경고가 있습니다</span>}
          <span className={`integration-status status-${shown.tone}`}>{shown.label}</span>
          <button
            aria-controls={bodyId}
            aria-expanded={expanded}
            className="integration-toggle"
            onClick={onToggleExpanded}
            type="button"
          >
            {expanded ? "접기" : "펼치기"}
          </button>
        </div>
      </div>

      <div className="integration-item-body" hidden={!expanded} id={bodyId}>
        {error && <p className="integration-note">연동 상태를 읽지 못했습니다: {error}</p>}
        {!error && !badge && <p className="integration-note">상태를 확인하고 있습니다.</p>}

        {!error && badge && (
          <>
            {children}

            {duplicateJobs.length > 0 && (
              <IntegrationWarning title={duplicateWarning.title}>
                <p>{duplicateWarning.description}</p>
                <ul>
                  {duplicateJobs.map((job) => (
                    <li key={job.name}>{duplicateWarning.describe(job)}</li>
                  ))}
                </ul>
              </IntegrationWarning>
            )}

            {readFailures.length > 0 && (
              <IntegrationWarning title="일부 파일을 읽지 못했습니다">
                <ul>
                  {readFailures.map((failure) => (
                    <li key={failure.path}>{failure.path} — {failure.message}</li>
                  ))}
                </ul>
              </IntegrationWarning>
            )}
          </>
        )}
      </div>
    </article>
  );
}

/** 카드 안의 경고 상자. 문구는 연동이 정한다. */
export function IntegrationWarning({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="integration-warning">
      <strong>{title}</strong>
      {children}
    </div>
  );
}
