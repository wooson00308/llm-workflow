export type SchemaCompatibility =
  | "not_initialized"
  | "current"
  | "migration_required"
  | "future_schema";

export interface WorkflowCounts {
  ideas: number;
  specs: number;
  decisions: number;
  tasks: number;
  reports: number;
}

export interface WorkflowSummary {
  id: string;
  directory: string;
  name: string;
  status: "active" | "archived";
  createdAt: string;
  counts: WorkflowCounts;
  items: WorkflowItems;
}

export interface WorkflowItems {
  ideas: WorkflowItemSummary[];
  specs: WorkflowItemSummary[];
  tasks: WorkflowItemSummary[];
}

export interface TaskEvent {
  kind: string;
  at: string;
}

export interface WorkflowItemSummary {
  fileName: string;
  id: string;
  title: string;
  /**
   * 문서의 상태. 아이디어에서는 파일 값이 아니라 조회 시점 파생값이며 `inbox`·`drafting`·
   * `closed`·`adopted` 넷 중 하나다. `closed`는 참조 기획서가 모두 반려로 끝난 경우다. 앱은
   * 판정 결과를 아이디어 파일에 쓰지 않는다.
   */
  status: string;
  updatedAt: string | null;
  dueAt?: string | null;
  /** 개발 작업이 어떤 기획서에서 나왔는지. 아이디어·기획서에서는 늘 null이다. */
  sourceSpecId?: string | null;
  /** 개발 작업이 어떤 승인 결정에서 나왔는지. 아이디어·기획서에서는 늘 null이다. */
  sourceDecisionId?: string | null;
  /**
   * 중단 의심의 근거. 아이디어가 반영중인데 선점한 미만료 lease가 없을 때 걸려 있는 draft 기획서의
   * 문서 id다. 비어 있지 않다는 것과 중단 의심은 같은 뜻이다. 기획서·개발 작업 항목에서는 비어 있다.
   */
  stalledSpecIds?: string[];
  /**
   * 문서에 일어난 사실. 시각 오름차순이다. 개발 작업은 상태 전이, 기획서는 사용자 결정이 실리고
   * 아이디어는 늘 비어 있다. `kind`의 뜻은 문서 종류에 따라 다르다 — 기획서의
   * `revision_requested`는 "수정 요청"이고 개발 작업의 같은 값은 "반려"다.
   */
  events?: TaskEvent[];
  excerpt: string;
}

export interface SpecDocument {
  summary: WorkflowItemSummary;
  body: string;
}

/**
 * 선언된 선행 작업 하나의 판정 결과. `pending`은 시간이 지나면 풀리지만 `missing`·`cyclic`은
 * 영원히 충족되지 않는다.
 */
export type TaskDependencyState = "satisfied" | "pending" | "missing" | "cyclic";

export interface TaskDependency {
  id: string;
  state: TaskDependencyState;
}

/**
 * 이 작업의 착수를 막고 있는 활성 lease 하나와 그 근거. lease가 풀리면 사라지는 일시적인 사실이라
 * `missing`·`cyclic`처럼 사람이 선언을 고쳐야 하는 상태와 다르다.
 */
export interface TaskOverlapBlock {
  /** lease가 잡은 문서 id. */
  leaseTargetId: string;
  /** 두 선언이 함께 가리킨 경로. 선언 부재나 형식 오류로 막힌 경우 비어 있다. */
  sharedFiles: string[];
}

export interface TaskDocument {
  summary: WorkflowItemSummary;
  body: string;
  /** 선언된 선행 작업과 각각의 판정 결과. 선언 순서 그대로다. */
  dependencies?: TaskDependency[];
  /** 선언 줄이 계약 형식이 아니어서 목록으로 읽지 못했는가. 참이면 이 작업은 미충족이다. */
  dependencyFormatError?: boolean;
  /** 착수를 막고 있는 활성 lease와 그 근거. 비어 있으면 막히지 않은 것이다. */
  overlapBlocks?: TaskOverlapBlock[];
}

export interface IdeaDocument {
  summary: WorkflowItemSummary;
  body: string;
}

export type SpecDecisionOutcome =
  | "approved"
  | "revision_requested"
  | "rejected";

export type TaskQaOutcome = "confirmed" | "revision_requested";

export interface TaskQaBatchEntry {
  fileName: string;
  /** 문서를 읽지 못하면 null. 추정으로 채우지 않는다. */
  taskId: string | null;
  recorded: boolean;
  /** 실패 사유. 성공이면 null. */
  message: string | null;
}

export interface TaskQaBatchResult {
  summary: ProjectSummary;
  /** 요청 순서 그대로. 화면이 목록과 나란히 읽는다. */
  results: TaskQaBatchEntry[];
}

/**
 * 막힌 작업을 사용자 판단으로 다시 여는 요청. 화면이 읽은 값을 그대로 싣는다.
 *
 * `expectedUpdatedAt`은 사용자가 화면에서 확인한 문서 갱신 시각이고 백엔드가 문자 단위로 대조한다.
 * `requestId`는 같은 조작을 한 번만 기록하기 위한 값이라 재시도에서 같은 값을 다시 보낸다.
 */
export interface TaskResumeRequest {
  workflowDirectory: string;
  fileName: string;
  expectedUpdatedAt: string;
  resolution: string;
  requestId: string;
}

/** 재개 요청의 결말. 상태 전이와 감사 기록 중 하나만 남은 결과는 `resumed`가 아니다. */
export type TaskResumeStatus = "resumed" | "recovery_required";

/** 되돌리지 못하고 남은 파일과 사용자가 해야 할 행동. `recovery_required`에서만 온다. */
export interface TaskResumeRecovery {
  createdPaths: string[];
  reason: string;
  action: string;
}

export interface TaskResumeResult {
  status: TaskResumeStatus;
  summary: ProjectSummary;
  recovery: TaskResumeRecovery | null;
}

/**
 * 재개 호출 하나의 결말. 실패 사유를 재개 영역 안에서 읽어야 하므로 전역 오류 문구 하나로 접지
 * 않는다 — 사용자는 입력을 유지한 채 그 자리에서 다음 행동을 정한다.
 */
export type TaskResumeOutcome =
  | { ok: true; result: TaskResumeResult }
  | { ok: false; message: string };

export interface AgentLeaseSummary {
  leaseId: string;
  agent: string;
  /** 선점 세션이 적은 역할. 계약상 선택 필드라 없으면 null이다. 추정으로 채우지 않는다. */
  role: string | null;
  taskId: string | null;
  /** lease 파일의 `heartbeat_at` 원문(RFC3339). 최초 시작 시각이 아니다. */
  heartbeatAt: string;
  expiresAt: string;
}

/** 역할별 대기 물량. 조건 스크립트가 그 역할로 종료 코드 0을 돌려주는 상태가 true다. */
export interface PendingRoleWork {
  planner: boolean;
  architect: boolean;
  developer: boolean;
}

export interface ProjectSummary {
  rootPath: string;
  initialized: boolean;
  projectId: string | null;
  name: string;
  compatibility: SchemaCompatibility;
  activeLeases: AgentLeaseSummary[];
  workflows: WorkflowSummary[];
  /** 값이 없으면 "대기 물량을 모른다"이고, 모르는 상태에서는 경고하지 않는다. */
  pendingWork?: PendingRoleWork;
}

export type ManagedAssetSyncStatus =
  | "current"
  | "updated"
  | "retry_required"
  | "conflict";

export type ManagedAssetStatus =
  | "current"
  | "update_required"
  | "updated"
  | "retry_required"
  | "conflict";

export interface ManagedAssetState {
  id: string;
  label: string;
  status: ManagedAssetStatus;
  installedVersion: number | null;
  providedVersion: number | null;
  reason: string | null;
}

export interface ManagedAssetRollbackFailure {
  assetId: string;
  label: string;
  reason: string;
  recoveryPath: string | null;
}

export interface ManagedAssetRollbackRecovery {
  assetId: string;
  label: string;
  recoveryPath: string;
}

export interface ManagedAssetSyncResult {
  status: ManagedAssetSyncStatus;
  assets: ManagedAssetState[];
  updatedAssets: string[];
  reason: string | null;
  affectedAsset: string | null;
  rollbackFailures: ManagedAssetRollbackFailure[];
  rollbackRecoveries: ManagedAssetRollbackRecovery[];
}

export type ManagedAssetSyncTrigger = "project_open" | "manual_refresh";

/** 명시적 관리 자산 동기화의 수명. 자동 조회는 이 값을 바꾸지 않는다. */
export interface ManagedAssetsState {
  syncing: boolean;
  result: ManagedAssetSyncResult | null;
  error: string | null;
  trigger: ManagedAssetSyncTrigger | null;
}

export type CustomRuleRole = "planner" | "architect" | "developer";

export type CustomRulesFileStatus =
  | "absent"
  | "valid"
  | "invalid"
  | "future_schema"
  | "unsafe_file";

export interface CustomRulesDocument {
  status: CustomRulesFileStatus;
  enabled: boolean;
  appliesTo: CustomRuleRole[];
  body: string;
  updatedAt: string | null;
  modifiedAt: string | null;
  raw: string | null;
  contentHash: string | null;
  error: string | null;
}

export interface CustomRulesDraft {
  enabled: boolean;
  appliesTo: CustomRuleRole[];
  body: string;
}

export type CustomRulesSourceKind =
  | "workflow_rules"
  | "role_contract"
  | "user_rules";

export interface CustomRulesSourcePreview {
  kind: CustomRulesSourceKind;
  label: string;
  order: number;
  content: string;
  applied: boolean;
  reason: string | null;
}

export interface CustomRulesRolePreview {
  role: CustomRuleRole;
  sources: CustomRulesSourcePreview[];
}

export interface CustomRulesPreview {
  draft: CustomRulesDraft;
  serialized: string;
  updatedAt: string;
  previewHash: string;
  priorityNotice: string;
  roles: CustomRulesRolePreview[];
}

export interface SaveCustomRulesRequest {
  expectedContentHash: string | null;
  draft: CustomRulesDraft;
  updatedAt: string;
  previewHash: string;
}

export type SaveCustomRulesStatus = "saved" | "conflict" | "retry_required";

export interface SaveCustomRulesResult {
  status: SaveCustomRulesStatus;
  document: CustomRulesDocument;
  reason: string | null;
}

/** 사용자 정의 규칙 파일과 명시적 미리보기·저장 요청의 작업 공간 수명. */
export interface CustomRulesState {
  document: CustomRulesDocument | null;
  reading: boolean;
  previewing: boolean;
  saving: boolean;
  preview: CustomRulesPreview | null;
  /** 미리보기를 준비할 때 읽었던 파일 식별값. 자동 조회가 새 값을 읽어도 저장 기준은 바뀌지 않는다. */
  previewBaselineContentHash: string | null;
  saveResult: SaveCustomRulesResult | null;
  readError: string | null;
  previewError: string | null;
  saveError: string | null;
}

export interface CustomRulesActions {
  preparePreview(draft: CustomRulesDraft): Promise<CustomRulesPreview | null>;
  save(): Promise<SaveCustomRulesResult | null>;
  reload(): Promise<boolean>;
  clearFeedback(): void;
}

/**
 * 연동 공통 설치 상태. 값은 미설치·설치됨 두 개뿐이다.
 *
 * 연동별 부가 상태(하트비트의 데몬 실행 여부 등)는 이 위에 얹는다. 세 번째 연동이 와도 이 타입은
 * 고치지 않는다.
 */
export type IntegrationInstallation = "not_installed" | "installed";

export interface HeartbeatJobRun {
  /** 타임존이 없는 로컬 시각 문자열이다. UTC로 해석하지 않는다. */
  at: string | null;
  result: string | null;
  durationSeconds: number | null;
  /**
   * 마지막 조건 검사의 표준 출력 첫 줄. 건너뜀 사유가 여기 실린다.
   *
   * 선택 필드다. 데몬은 출력이 비면 이 키를 지우고, 이 키를 아예 주지 않는 데몬도 아직 쓰인다.
   * 값 없음이 정상 상태이므로 화면은 없을 때를 기본으로 그린다(SPEC-023 R2).
   */
  conditionOutput?: string | null;
}

export interface HeartbeatRoleStatus {
  role: string;
  jobName: string;
  /** 이 역할 잡의 앱 기본값. 미설치 잡의 입력 초기값이자 재설정이 되돌릴 값이다. */
  defaults: JobDefaults;
  /** null은 "실행 기록 없음"이다. 오류가 아니다. */
  lastRun: HeartbeatJobRun | null;
  /** 이 잡의 실행 한도 사용량. 관리 블록을 읽지 못하면 unknown이다. */
  quota: JobQuota;
}

/**
 * 잡 하나의 실행 한도 사용량. "값을 모른다"·"한도가 없다"·"기록이 없다"가 서로 다른 값이다.
 *
 * used가 0인 것과 기록이 없는 것을 화면이 같은 것으로 읽으면 안 된다. 기록이 없는 것을 0으로 읽으면
 * 사용자는 한도가 비어 있다고 판단한다.
 *
 * 무제한도 한 낱말이 아니다. `unlimited`는 사용자가 고른 정상 상태이고, `ignoredLimit`은 파일의 값이
 * 데몬 기준에 미치지 못해 무제한이 된 상태라 손볼 곳이 있다는 신호다.
 */
export type JobQuota =
  | { kind: "unknown" }
  /** 사용자가 고른 제한 없음. 관리 블록의 그 잡에 max_per 줄이 없다. 보여줄 원문이 없다. */
  | { kind: "unlimited" }
  /** max_per 값이 있으나 하트비트가 한도로 인정하지 않는다. 형식 위반·0 이하 횟수·0 기간이 모두 여기다. */
  | { kind: "ignoredLimit"; value: string }
  | { kind: "noRuns"; limit: number; window: string }
  | {
      kind: "counted";
      used: number;
      limit: number;
      window: string;
      exhausted: boolean;
      /** RFC3339. 화면이 로컬 시각으로 바꾼다. 계산할 수 없으면 null이다. */
      recoversAt: string | null;
    };

/**
 * 잡 하나의 앱 기본값. 사용자가 편집할 수 있는 세 필드뿐이다.
 *
 * 백엔드의 잡 정의에서 그대로 내려온다. 화면이 같은 값을 상수로 다시 적으면 두 정의가 갈라지고,
 * 재설정이 보여주는 값과 파일에 쓰이는 값이 달라진다.
 */
export interface JobDefaults {
  interval: string;
  maxPer: string;
  model: string;
  timeout: string;
}

/** 앱 관리 블록 밖에 있는 같은 프로젝트의 잡. 감지만 하고 수정하지 않는다. */
export interface DuplicateIntegrationJob {
  name: string;
  /** 어느 연동의 중복인지. 백엔드가 연동별로 나눠 담는다. */
  integration: string;
  /** 역할 개념이 없는 연동이거나 판별할 수 없으면 null이다. */
  role: string | null;
}

export interface IntegrationReadFailure {
  path: string;
  message: string;
}

export interface ManagedRoleJob {
  role: string;
  interval: string | null;
  maxPer: string | null;
  model: string | null;
  timeout: string | null;
  /**
   * 앱이 다시 쓸 값과 다른 앱 소유 필드 이름. 저장하면 이 필드들이 앱 값으로 되돌아간다.
   *
   * 판정은 백엔드가 한다. 화면은 이름만 밝히고 값은 알지 않는다.
   */
  appOwnedDrift: string[];
}

/** 관리 블록에 기록된 dream 잡의 편집 가능 값. 나머지 필드는 앱이 소유한다. */
export interface ManagedDreamJob {
  interval: string | null;
  maxPer: string | null;
  model: string | null;
  timeout: string | null;
  /** 역할 잡과 같은 값이다. */
  appOwnedDrift: string[];
}

/**
 * 설치 마법사의 단계 이름. 목록은 언제나 넷이고 이 순서가 고정이다. 화면이 다시 정렬하지 않는다.
 */
export type HeartbeatSetupStep = "package" | "init" | "service" | "dream";

/**
 * 단계 하나의 표시 상태. `unknown`은 앱이 판정 근거를 갖지 못한 상태이며 `not_done`과 다른 문구로
 * 보여준다. "모른다"를 "아니다"로 번역하면 사용자는 이미 끝낸 일을 다시 한다.
 */
export type HeartbeatSetupState = "done" | "not_done" | "unknown";

/** 설치 마법사가 보여주는 단계 하나. 접혀 있던 설치 판정을 단계로 펼친 값이다. */
export interface HeartbeatSetupStage {
  step: HeartbeatSetupStep;
  state: HeartbeatSetupState;
  /** 1~3은 참, dream은 거짓이다. 선택 단계가 미완료여도 마법사는 접힌다. */
  required: boolean;
  /**
   * 앱이 이 단계를 대신 실행할 수 있는가(SPEC-037 R2). 실행 버튼이 붙는 자리를 정하는 값은 이것
   * 하나다 — 화면이 단계 종류를 보고 스스로 갈리면 백엔드와 화면이 다른 답을 낼 자리가 생긴다.
   */
  runnable: boolean;
  /** 사용자가 자기 터미널에 그대로 붙여 넣을 명령 원문. 화면에서 조각을 조립하지 않는다. */
  command: string;
  /** 판정에 쓴 경로. 감지하지 않는 단계와 이 플랫폼에서 볼 경로가 없는 단계는 null이다. */
  evidence: string | null;
}

/**
 * 이 기기에 등록된 하트비트 서비스를 앱이 얼마나 확정했는지(SPEC-036 R4·R5). 확정된 경우에만
 * 조작 대상이 있고, 나머지 넷은 사용자가 할 다음 행동이 서로 달라 하나의 실패 값으로 접지 않는다.
 *
 * 필드 이름이 이 파일의 다른 타입과 달리 snake_case인 것은 백엔드가 그 모양으로 내보내기 때문이다.
 * 받는 값의 모양을 화면 쪽에서 고쳐 적으면 두 정의가 갈라진다.
 */
export type HeartbeatServiceTarget =
  | { kind: "resolved"; label: string; plist_path: string }
  | { kind: "not_registered" }
  /** 등록물이 둘 이상이라 앱이 고르지 않는다. 찾은 경로가 전부 실린다. */
  | { kind: "ambiguous"; plist_paths: string[] }
  | { kind: "unsupported_platform" }
  /** 디렉터리를 열지 못했거나, 등록물은 하나인데 그 이름을 읽지 못했다. 등록물 없음과 다른 값이다. */
  | { kind: "unreadable"; path: string };

/** 데몬을 내리면 함께 멈추는 잡 하나. */
export interface HeartbeatRecordedJob {
  /** 상태 파일 최상위 키의 원문. 앱이 이름을 해석하지 않는다. */
  name: string;
  /** 앱이 자기 slug로 만든 잡 이름들과의 완전 일치로만 정한다. */
  ofThisProject: boolean;
}

/** 하트비트 연동 payload. 공통 설치 상태 위에 데몬 실행 여부와 역할 잡을 얹는다. */
export interface HeartbeatIntegration {
  installation: IntegrationInstallation;
  /** pid 파일 존재로만 판정한다. 프로세스 생존은 확인하지 않는다. */
  daemonRunning: boolean;
  /**
   * 설치 단계 넷. installation을 대체하지 않고 그 옆에 실린다. dream 단계가 여기 들어가는 이유는
   * 이것이 하트비트 카드의 마법사이기 때문이며, dream 카드는 이 값을 읽지 않는다.
   */
  setupStages: HeartbeatSetupStage[];
  conditionScriptPath: string;
  roles: HeartbeatRoleStatus[];
  managedJobs: ManagedRoleJob[];
  /**
   * 이 기기에 등록된 서비스의 해석 결과. 끄기·켜기의 대상이 여기서 나온다.
   *
   * 선택인 것은 이 payload를 조립하는 검사 리터럴이 아직 이 필드를 모르기 때문이며, 백엔드는 늘
   * 채워 보낸다. 값이 없는 동안 화면은 조작 통로를 세우지 않는다 — 대상을 모르는 채로 버튼을
   * 내밀지 않는다.
   */
  serviceTarget?: HeartbeatServiceTarget;
  /**
   * 데몬을 내리면 함께 멈추는 잡. **"지금 돌고 있는 잡"이 아니라 "실행 기록이 있는 잡"이다.**
   * 데몬은 기기 하나에 하나이므로 다른 프로젝트의 잡도 들어간다.
   *
   * `serviceTarget`과 같은 이유로 선택이다.
   */
  recordedJobs?: HeartbeatRecordedJob[];
  duplicateJobs: DuplicateIntegrationJob[];
  readFailures: IntegrationReadFailure[];
}

/** dream 정제 상태. 전부 파일에서 직접 센 값이고, 없는 파일은 오류가 아니다. */
export interface DreamRefinement {
  totalTranscripts: number;
  /** 마킹돼 있으면서 실제로 존재하는 트랜스크립트 수. */
  markedTranscripts: number;
  /** 전체 − 마킹. 마킹 기준이라 dream이 한 번에 처리할 수와는 다르다. */
  unrefinedTranscripts: number;
  /** null은 "정제 기록 없음"이다. 오류가 아니다. */
  lastDream: string | null;
  memoryTopics: number;
}

/** dream 연동 payload. 공통 설치 상태 위에 선행 조건과 정제 상태를 얹는다. */
export interface DreamIntegration {
  /** dream 스킬 설치 여부. skillPath 존재로만 판정한다. */
  installation: IntegrationInstallation;
  /** 선행 조건. dream은 하트비트 데몬이 깨우는 스킬이다. */
  heartbeat: IntegrationInstallation;
  refinement: DreamRefinement;
  /** 설치 판정에 쓴 경로. 다른 이름으로 설치하면 이 경로에 없어 미설치로 보인다. */
  skillPath: string;
  /** 설치될 dream 잡의 condition 원문. 화면에서 다시 조립하지 않는다. */
  conditionCommand: string;
  /** dream 잡의 앱 기본값. 역할 잡은 역할마다 달라 roles 항목에 실리고, dream은 잡이 하나다. */
  defaults: JobDefaults;
  /** 관리 블록에 기록된 dream 잡. null은 "꺼짐"이다. */
  managedJob: ManagedDreamJob | null;
  /** null은 "실행 기록 없음"이다. 오류가 아니다. */
  lastRun: HeartbeatJobRun | null;
  /** dream 잡의 실행 한도 사용량. 역할 잡과 같은 규칙이다. */
  quota: JobQuota;
  duplicateJobs: DuplicateIntegrationJob[];
  readFailures: IntegrationReadFailure[];
}

/**
 * 하트비트를 갱신하는 명령 원문(SPEC-034 R3). 백엔드가 완성한 문자열이고 화면은 그리기만 한다 —
 * 설치 마법사의 `command`와 같은 규칙이다.
 *
 * 갈래가 둘인 이유는 앱이 이 기기의 설치 방법을 알지 못하기 때문이다. 사용자가 `identifyCommand`로
 * 자기 갈래를 확인하고 그중 하나를 고른다.
 */
export interface HeartbeatUpdateGuide {
  /** 설치 갈래를 판별하는 명령. 결과에 편집 가능 설치 표시가 있으면 소스 체크아웃이다. */
  identifyCommand: string;
  /** pip으로 설치한 경우의 갱신 명령. */
  packageCommand: string;
  /** 소스 체크아웃으로 설치한 경우의 갱신 명령. 체크아웃 경로는 앱이 알지 못해 붙지 않는다. */
  sourceCommand: string;
  /**
   * 사용자가 자기 서비스 등록물의 라벨을 확인하는 명령. null은 "앱이 이 플랫폼의 재시작 방법을
   * 알지 못한다"는 뜻이며 `serviceRestartCommand`와 함께 움직인다.
   */
  serviceLookupCommand: string | null;
  /** 재시작 명령. 라벨 자리는 사용자가 채운다 — 앱이 지어낸 값을 넣지 않는다. */
  serviceRestartCommand: string | null;
}

/**
 * 연동 섹션이 한 번에 읽는 값. 섹션 공통 값과 연동별 payload를 나눠 담는다.
 *
 * 연동이 늘어나도 게이트웨이 메서드·훅 상태·조회 주기는 그대로다. 새 연동은 payload 필드 하나를
 * 더한다.
 */
export interface IntegrationsSnapshot {
  /** 플랫폼 지원 여부는 섹션 공통 정책이다. 연동별 분기를 만들지 않는다. */
  supported: boolean;
  /** 두 연동이 같은 값을 쓴다. */
  slug: string;
  /**
   * 관리 블록을 담은 문서를 읽지 못한 사유. null이면 읽었다는 뜻이고, 파일이 없는 것도 읽은 것으로
   * 본다(잡이 없는 빈 블록). null이 아니면 앱이 블록의 값을 모르는 상태이므로 카드는 빈 잡 목록을
   * "잡 없음"으로 읽지 않고 저장도 막는다.
   *
   * 두 연동이 HEARTBEAT.md 한 파일을 공유하므로 섹션 공통 값이다.
   */
  managedBlockFailure: IntegrationReadFailure | null;
  /**
   * 앱이 이 프로젝트의 잡을 읽고 쓰는 파일의 절대 경로. 백엔드가 실제로 여는 값을 그대로 받는다.
   *
   * 화면은 이 값을 그리기만 하고 조립하지 않는다. 경로에 slug가 들어가므로 화면이 만들면 백엔드와
   * 갈라질 자리가 생긴다. `conditionScriptPath`·`conditionCommand`가 payload에 있는 것과 같은 규칙이다.
   */
  jobsFilePath: string;
  /**
   * 하트비트 갱신 절차의 명령 원문. 두 카드가 같은 값을 같은 문구로 보여야 하므로(R7) 연동별
   * payload가 아니라 섹션 공통 값이다. `managedBlockFailure`·`jobsFilePath`와 같은 이유다.
   *
   * 표시 조건은 여기 없다. 084 경고가 뜨는 조건은 화면이 이미 갖고 있고, 같은 결론을 내는 자리를
   * 둘로 만들지 않는다.
   */
  updateGuide: HeartbeatUpdateGuide;
  heartbeat: HeartbeatIntegration;
  dream: DreamIntegration;
}

/**
 * 저장 요청이 정하는 실행 한도. null은 "이번 편집에서 지정하지 않음"이다.
 *
 * 한도 값 하나로는 "지정 안 함"과 "제한 없음"을 함께 담을 수 없다. 제한 없음은 관리 블록에 한도
 * 줄을 쓰지 않는 상태이고, 지정 안 함은 파일에 적힌 값을 그대로 두는 상태라 결과가 다르다.
 */
export type MaxPerRequestValue = { kind: "unlimited" } | { kind: "limit"; value: string };

/**
 * 설치 커맨드에 넘기는 역할별 요청. 비활성 역할도 함께 보낸다.
 *
 * 편집 가능 값의 `null`은 "이번 편집에서 지정하지 않았다"는 뜻이고, 그 필드는 파일의 값이 이긴다.
 * 화면이 파일 값을 폼에 채우는 것은 유지하되, 그것이 유일한 보존 수단이 아니다.
 */
export interface RoleJobRequest {
  role: string;
  enabled: boolean;
  interval: string | null;
  maxPer: MaxPerRequestValue | null;
  model: string | null;
  timeout: string | null;
}

/** 설치 커맨드에 넘기는 dream 잡 요청. 역할 잡 값은 담지 않는다. */
export interface DreamJobRequest {
  enabled: boolean;
  interval: string | null;
  maxPer: MaxPerRequestValue | null;
  model: string | null;
  timeout: string | null;
}

/**
 * 쓰기 실패 사유와 그 쓰기를 요청한 연동.
 *
 * 연동 id를 함께 담아 카드마다 자기 실패만 보여준다. 한 연동의 실패 문구가 다른 연동 카드에
 * 나타나면 사용자가 해야 할 일을 잘못 읽는다.
 */
export interface IntegrationWriteError {
  integration: string;
  message: string;
}

/** 실행을 시작하지 못했거나 비정상 종료한 사유. 백엔드가 만든 값을 그대로 들고 있는다. */
export interface HeartbeatRunFailure {
  jobName: string;
  message: string;
  /** 사용자가 직접 칠 명령 원문. 화면은 이 문자열을 다시 조립하지 않는다. */
  command: string;
}

/**
 * `heartbeat update`가 낸 단계 줄 하나. 데몬이 실제로 낸 줄만 실린다 — 앱이 단계 셋을 미리 만들어
 * 두고 채우지 않는다(SPEC-037 R4).
 *
 * `status`·`detail`이 null인 것은 계약이 그 키를 뺄 수 있어서가 아니라, 없는 키를 앱이 지어내지
 * 않기 때문이다.
 */
export interface HeartbeatUpdateStep {
  step: string;
  status: string | null;
  detail: string | null;
}

/**
 * 업데이트 실행의 결과. 셋이 서로 다른 값이다 — "계약대로 답했다"와 "계약 밖으로 끝났다"와
 * "실행 자체를 못 했다"를 하나로 접으면 R4·R5·R7이 화면에서 사라진다.
 *
 * 백엔드(`heartbeat_update_service.rs`)가 만든 값을 그대로 들고 있는다. 화면은 이 값을 문장으로
 * 옮기기만 하고 판정을 다시 하지 않는다.
 */
export type HeartbeatUpdateResult =
  | {
      kind: "contract";
      /** 데몬이 낸 순서 그대로. 낸 적 없는 단계는 없다. */
      steps: HeartbeatUpdateStep[];
      /** `ok`·`partial`·`failed`. 화면이 셋을 둘로 접지 않는다. */
      result: string;
      /** 갱신이 끝난 뒤 디스크에 있는 버전. */
      version: string | null;
      /** 프로세스 종료 코드. null은 시그널로 끝난 것이다. */
      code: number | null;
      stdout: string;
      stderr: string;
    }
  /** 실행은 됐는데 답이 계약의 모양이 아니다. 성공으로 읽지 않는다. */
  | { kind: "offContract"; code: number | null; stdout: string; stderr: string }
  /** 실행 자체가 실패했다. 사용자가 손으로 끝낼 수 있게 명령 원문이 함께 온다. */
  | { kind: "notRun"; message: string; command: string; looked: string[] };

/**
 * 업데이트 실행의 진행·결과 상태와 실행 통로. 카드는 이 묶음 하나만 받는다.
 *
 * 실행 상태와 같은 이유로 주인이 훅이다 — 연동 뷰는 조건부 렌더라 다른 메뉴를 다녀오면
 * 언마운트되고, 카드가 들면 진행 표시가 그때 사라진다.
 */
export interface HeartbeatUpdateControls {
  running: boolean;
  /** 마지막 실행의 결과. 조회 주기가 지우지 않는다. */
  result: HeartbeatUpdateResult | null;
  update(): Promise<void>;
}

/**
 * 설치 단계 하나를 앱이 대신 실행한 결과(SPEC-037 R2). 셋이 서로 다른 값이다 — 실행까지 간 것과
 * 실행 수단을 찾지 못한 것과 애초에 실행 대상이 아닌 것은 사용자가 할 다음 행동이 서로 다르다.
 *
 * 백엔드(`heartbeat_setup_run_service.rs`)가 만든 값을 그대로 들고 있는다. 두 명령은 원인별 종료
 * 코드가 계약에 없어 갈림이 "종료 코드가 0인가" 하나뿐이고, 실패 사유는 앱이 아니라 stdout·stderr
 * 원문이 말한다.
 */
export type HeartbeatSetupRunResult =
  | {
      kind: "ran";
      /** 종료 코드가 0인가. 시그널로 끝난 것(`code`가 null)은 성공이 아니다. */
      succeeded: boolean;
      code: number | null;
      stdout: string;
      stderr: string;
    }
  /** 실행 자체가 실패했다. 사용자가 손으로 끝낼 수 있게 명령 원문이 함께 온다. */
  | { kind: "notRun"; message: string; command: string; looked: string[] }
  /** 앱이 대신 실행하지 않는 단계다. 화면이 실행 가능 표식만 보고 버튼을 세우므로 정상 경로에서는
   * 나오지 않는다 — 나오면 화면과 백엔드의 답이 갈라졌다는 뜻이다. */
  | { kind: "notRunnable"; message: string };

/** 도는 데몬의 버전. `state.json`의 `_daemon.version` 하나에서 온다. */
export type HeartbeatRunningVersion =
  | { kind: "known"; version: string }
  /** 상태 파일이 없거나, JSON이 깨졌거나, 항목이 없다. 셋 다 오류가 아니다. */
  | { kind: "unknown" };

/**
 * 디스크의 버전. `heartbeat --version`의 출력에서 온다. 모르는 경우를 하나로 뭉치지 않는다 —
 * 실행 파일을 찾지 못한 것과 띄우지 못한 것과 출력이 계약 밖인 것은 다음 행동이 서로 다르다.
 */
export type HeartbeatDiskVersion =
  | { kind: "known"; version: string }
  /** 후보를 전부 봤는데 실행 파일이 없다. 본 후보를 함께 싣는다 — 앱이 경로를 지어내지 않는다. */
  | { kind: "notFound"; looked: string[] }
  | { kind: "notStarted"; message: string }
  | { kind: "offContract"; code: number | null; stdout: string; stderr: string };

/** 판정 불가의 사유. 한쪽이라도 모르면 그 사유가 실린다. 둘 다 모르면 사유도 둘이다. */
export type HeartbeatVersionUndeterminedReason =
  | "executableNotFound"
  | "executableNotStarted"
  | "diskVersionOffContract"
  | "runningVersionUnknown";

/** 두 값을 모두 알 때만 나오는 판정과, 모를 때의 사유. */
export type HeartbeatVersionVerdict =
  | { kind: "match" }
  /** 디스크의 코드는 갱신됐는데 메모리의 프로세스는 옛 코드라는 뜻이다. */
  | { kind: "mismatch" }
  | { kind: "undetermined"; reasons: HeartbeatVersionUndeterminedReason[] };

/** 버전 판정 한 번의 결과. 아는 값만 싣고 사유를 함께 싣는다(SPEC-037 확인 필요 2번). */
export interface HeartbeatVersions {
  running: HeartbeatRunningVersion;
  disk: HeartbeatDiskVersion;
  verdict: HeartbeatVersionVerdict;
}

/**
 * 설치 단계 실행의 진행·결과 상태와 실행 통로. 카드는 이 묶음 하나만 받는다.
 *
 * 실행 상태·업데이트 상태와 같은 이유로 주인이 훅이다 — 연동 뷰는 조건부 렌더라 다른 메뉴를
 * 다녀오면 언마운트되고, 카드가 들면 진행 표시가 그때 사라진다.
 */
export interface HeartbeatSetupRunControls {
  /** 지금 앱이 띄워 둔 단계. 단계마다 따로 담겨 한 단계가 다른 단계를 막지 않는다. */
  running: HeartbeatSetupStep[];
  /** 단계별 마지막 결과. 조회 주기가 지우지 않는다. */
  results: Partial<Record<HeartbeatSetupStep, HeartbeatSetupRunResult>>;
  /**
   * 단계 하나를 지금 한 번 실행한다. 화면이 보내는 것은 단계 식별자이고, 명령 문자열이 명령줄에
   * 닿는 경로는 없다 — 실행 인자는 백엔드 상수에서만 나온다.
   *
   * `command`는 커맨드 자체가 답하지 못했을 때만 쓰는 폴백이다. payload가 이미 완성해 실은 명령
   * 원문을 그대로 넘겨, 화면과 훅이 같은 문자열을 따로 적는 자리를 만들지 않는다.
   */
  run(step: HeartbeatSetupStep, command: string): Promise<void>;
}

/**
 * 버전 판정의 진행·결과 상태와 조회 통로. 카드는 이 묶음 하나만 받는다.
 *
 * **자동 새로고침 주기에는 부르지 않는다.** 이 조회는 프로세스를 하나 띄우는 조작이라 연동 조회에
 * 얹지 않는다. 부르는 시점은 카드가 펼쳐지는 순간과 업데이트가 끝난 뒤 둘뿐이다.
 */
export interface HeartbeatVersionControls {
  checking: boolean;
  /** 마지막 판정. 조회 주기가 지우지 않는다. */
  versions: HeartbeatVersions | null;
  /** 커맨드 자체가 거절한 사유. 판정 결과와 다른 값이다. */
  error: string | null;
  check(): Promise<void>;
}

/** 앱이 데몬에 거는 두 조작. 화면이 보내는 것은 이 식별자 하나이고 명령 문자열이 아니다. */
export type HeartbeatServiceOperation = "stop" | "start";

/**
 * 데몬을 내리거나 올리는 조작 하나의 결과(SPEC-036 R5·R7). 여섯이 서로 다른 값이다 — 앞 넷은
 * 대상이 확정되지 않아 프로세스를 띄우지 않은 채 끝난 것이고, 뒤 둘은 띄우려 한 뒤의 결과다.
 *
 * 데몬이 지금 어떤 상태인지를 말하는 필드가 없다. 명령이 끝난 것과 데몬이 내려간 것은 다른 사실이고,
 * 실행 여부 판정은 조회 주기가 pid 파일로 따라온다.
 */
export type HeartbeatServiceControlResult =
  | { kind: "notRegistered" }
  | { kind: "ambiguous"; plistPaths: string[] }
  | { kind: "unsupportedPlatform" }
  | { kind: "unreadable"; path: string }
  /** `launchctl`을 띄우지 못했다. 사용자가 손으로 끝낼 수 있게 명령 원문이 함께 온다. */
  | { kind: "notRun"; message: string; command: string }
  | {
      kind: "ran";
      /** 종료 코드. null은 시그널로 끝난 것이다. 앱이 뜻으로 번역하지 않는다. */
      code: number | null;
      stdout: string;
      stderr: string;
      /** 실제로 조작한 대상. 앱이 무엇을 건드렸는지가 결과의 일부다. */
      label: string;
      plistPath: string;
    };

/** 마지막 조작 하나. 어느 조작의 결과인지가 함께 있어야 화면이 문장을 고를 수 있다. */
export interface HeartbeatServiceOutcome {
  operation: HeartbeatServiceOperation;
  result: HeartbeatServiceControlResult;
}

/**
 * 데몬 끄기·켜기의 진행·결과 상태와 실행 통로. 카드는 이 묶음 하나만 받는다.
 *
 * 다른 실행 상태와 같은 이유로 주인이 훅이다 — 연동 뷰는 조건부 렌더라 다른 메뉴를 다녀오면
 * 언마운트되고, 카드가 들면 진행 표시가 그때 사라진다.
 *
 * **조회 주기는 이 통로를 부르지 않는다.** 사용자가 꺼 둔 데몬을 앱이 대신 다시 켜지 않는다
 * (SPEC-036 R6).
 */
export interface HeartbeatServiceControls {
  /** 지금 앱이 띄워 둔 조작. 도는 것이 없으면 null이다. */
  running: HeartbeatServiceOperation | null;
  /** 마지막 조작의 결과. 조회 주기가 지우지 않는다. */
  outcome: HeartbeatServiceOutcome | null;
  /** 커맨드 자체가 거절한 사유. 결과 값과 다른 값이다. */
  error: string | null;
  control(operation: HeartbeatServiceOperation): Promise<void>;
}

/** 앱이 띄운 잡 실행의 진행·실패 상태와 실행 통로. 카드는 이 묶음 하나만 받는다. */
export interface HeartbeatRunControls {
  /** 지금 앱이 띄워 둔 잡 이름. 역할마다 따로 담기므로 한 역할이 다른 역할을 막지 않는다(R3). */
  running: string[];
  /** 마지막 실패 하나. 조회 주기가 지우지 않는다(R6). */
  failure: HeartbeatRunFailure | null;
  run(jobName: string): Promise<boolean>;
}

export interface IntegrationsState {
  /** 아직 읽지 않았거나 조회에 실패하면 null이다. */
  snapshot: IntegrationsSnapshot | null;
  error: string | null;
  /** 설치 쓰기가 실패한 사유. 2.5초 주기 조회는 이 값을 지우지 않는다. */
  writeError: IntegrationWriteError | null;
  /**
   * 잡 실행의 진행·실패 상태. 조회 상태와 수명이 달라 훅이 따로 들고 있다가 여기에 합쳐 내보낸다.
   *
   * 연동 뷰는 조건부 렌더라 다른 메뉴를 다녀오면 언마운트되므로, 이 값의 주인은 화면이 아니라
   * 훅이다(R3).
   *
   * `useProjectWorkspace`는 언제나 이 값을 채워 내보낸다. 선택 필드인 것은 이 묶음을 조립하는
   * 테스트 리터럴이 아직 이 필드를 모르기 때문이며, 그 리터럴들이 필드를 갖추면 필수로 좁힌다.
   */
  heartbeatRuns?: HeartbeatRunControls;
  /** 업데이트 실행의 진행·결과 상태. 실행 상태와 같은 이유로 훅이 따로 들고 있다가 합쳐 내보낸다. */
  heartbeatUpdate?: HeartbeatUpdateControls;
  /** 설치 단계 실행의 진행·결과 상태. 업데이트 상태와 같은 이유로 훅이 따로 들고 있다. */
  heartbeatSetupRuns?: HeartbeatSetupRunControls;
  /** 버전 판정의 진행·결과 상태. 조회 주기가 부르지 않는 값이라 스냅샷과 수명이 다르다. */
  heartbeatVersions?: HeartbeatVersionControls;
  /** 데몬 끄기·켜기의 진행·결과 상태. 업데이트 상태와 같은 이유로 훅이 따로 들고 있다. */
  heartbeatService?: HeartbeatServiceControls;
}

/**
 * 연동 카드가 쓰는 쓰기 액션. 섹션은 이 객체를 각 카드에 그대로 넘기기만 한다.
 *
 * 연동마다 쓰기 커맨드가 다르므로 이 목록은 연동과 함께 늘어난다. 섹션과 카드 골격은 내용을
 * 들여다보지 않으므로 그때 고칠 필요가 없다.
 */
export interface IntegrationActions {
  installHeartbeatJobs(
    roles: RoleJobRequest[],
    baseline: ManagedRoleJob[],
  ): Promise<boolean>;
  installDreamJob(
    dream: DreamJobRequest,
    baseline: ManagedDreamJob | null,
  ): Promise<boolean>;
}

export interface RecentProject {
  name: string;
  path: string;
  lastOpenedAt: string;
}

export interface ProjectGateway {
  chooseDirectory(): Promise<string | null>;
  inspect(path: string): Promise<ProjectSummary>;
  synchronizeManagedAssets(path: string): Promise<ManagedAssetSyncResult>;
  readCustomRules(path: string): Promise<CustomRulesDocument>;
  prepareCustomRulesPreview(
    path: string,
    draft: CustomRulesDraft,
  ): Promise<CustomRulesPreview>;
  saveCustomRules(
    path: string,
    request: SaveCustomRulesRequest,
  ): Promise<SaveCustomRulesResult>;
  createWorkflow(path: string, name: string): Promise<ProjectSummary>;
  createIdea(
    path: string,
    workflowDirectory: string,
    content: string,
  ): Promise<ProjectSummary>;
  readSpec(
    path: string,
    workflowDirectory: string,
    fileName: string,
  ): Promise<SpecDocument>;
  readTask(
    path: string,
    workflowDirectory: string,
    fileName: string,
  ): Promise<TaskDocument>;
  readIdea(
    path: string,
    workflowDirectory: string,
    fileName: string,
  ): Promise<IdeaDocument>;
  decideSpec(
    path: string,
    workflowDirectory: string,
    fileName: string,
    outcome: SpecDecisionOutcome,
    comment: string,
  ): Promise<ProjectSummary>;
  recordTaskQa(
    path: string,
    workflowDirectory: string,
    fileName: string,
    outcome: TaskQaOutcome,
    comment: string,
  ): Promise<ProjectSummary>;
  /** 확인 전용이라 outcome 자리가 없다. 일괄 반려는 이 길로 열지 않는다. */
  confirmTaskQaBatch(
    path: string,
    workflowDirectory: string,
    fileNames: string[],
    comment: string,
  ): Promise<TaskQaBatchResult>;
  /**
   * 막힌 작업 하나를 사용자 판단으로 개발 준비 상태로 되돌린다. QA 결정과 다른 통로다 — 두 조작은
   * 남기는 기록도 뜻도 다르므로 `recordTaskQa`를 재사용하지 않는다.
   *
   * 사용자가 근거를 적고 확인한 자리에서만 부른다. 조회 주기가 이 메서드를 부르는 경로는 없다.
   */
  resumeTask(path: string, request: TaskResumeRequest): Promise<TaskResumeResult>;
  migrate(path: string): Promise<ProjectSummary>;
  /** 연동 조회는 이 메서드 하나다. 연동이 늘어나도 메서드를 늘리지 않는다. */
  inspectIntegrations(path: string): Promise<IntegrationsSnapshot>;
  /**
   * `baseline`은 화면이 폼을 시딩할 때 읽은 관리 블록의 값이다. 백엔드가 쓰기 직전의 파일과
   * 대조하고, 다르면 아무 파일도 쓰지 않는다. 화면이 읽은 뒤 바뀐 값을 확인 없이 덮어쓰지 않는다.
   */
  installHeartbeatJobs(
    path: string,
    roles: RoleJobRequest[],
    baseline: ManagedRoleJob[],
  ): Promise<IntegrationsSnapshot>;
  /** 역할 잡과 같은 규칙이다. 관리 블록에 dream 잡이 없던 상태는 `null`이다. */
  installDreamJob(
    path: string,
    dream: DreamJobRequest,
    baseline: ManagedDreamJob | null,
  ): Promise<IntegrationsSnapshot>;
  /**
   * 역할 잡 하나를 지금 한 번 실행한다. 어떤 파일도 쓰지 않으므로 스냅샷을 돌려주지 않는다.
   *
   * 실패는 `HeartbeatRunFailure` 모양으로 거절된다. 사용자가 의도해 누른 자리에서만 부른다.
   */
  runHeartbeatJob(path: string, jobName: string): Promise<void>;
  /**
   * 하트비트를 한 번 갱신한다. 프로젝트와 무관한 조작이라 `path`를 받지 않고, 어떤 파일도 쓰지
   * 않으므로 스냅샷을 돌려주지 않는다 — 파일을 쓰는 것은 데몬이다.
   *
   * 실행이 실패한 것도 결과 값이다(`kind: "notRun"`). 사용자가 의도해 누른 자리에서만 부른다.
   */
  updateHeartbeat(): Promise<HeartbeatUpdateResult>;
  /**
   * 설치 마법사의 단계 하나를 앱이 대신 실행한다. 프로젝트와 무관한 조작이라 `path`를 받지 않고,
   * 스냅샷도 돌려주지 않는다 — 단계 상태의 갱신은 연동 조회를 다시 부르는 것으로 얻는다. 설치
   * 판정의 원천을 둘로 만들지 않는다.
   *
   * 넘기는 것은 단계 식별자 하나다. 명령 문자열은 백엔드 상수에서만 나온다.
   */
  runHeartbeatSetupStep(step: HeartbeatSetupStep): Promise<HeartbeatSetupRunResult>;
  /**
   * 도는 데몬의 버전과 디스크의 버전을 읽어 어긋남을 판정한다. 어떤 파일도 쓰지 않는다.
   *
   * **조회 주기에서는 부르지 않는다.** 이 판정은 프로세스를 하나 띄운다.
   */
  checkHeartbeatVersions(): Promise<HeartbeatVersions>;
  /**
   * 이 기기에 등록된 하트비트 서비스를 내리거나 다시 올린다. 데몬은 기기 하나에 하나라 프로젝트와
   * 무관한 조작이므로 `path`를 받지 않고, 어떤 파일도 쓰지 않으므로 스냅샷도 돌려주지 않는다 —
   * 데몬 상태의 갱신은 연동 조회를 다시 부르는 것으로 얻는다.
   *
   * 넘기는 것은 조작 식별자 하나다. 명령 인자는 백엔드 상수와 백엔드가 읽어 낸 값에서만 나온다.
   *
   * **사용자가 누른 자리에서만 부른다.** 조회 주기가 이 메서드를 부르는 경로는 없다.
   */
  controlHeartbeatService(
    operation: HeartbeatServiceOperation,
  ): Promise<HeartbeatServiceControlResult>;
  /**
   * 에이전트 런타임의 기기 상태를 읽는다. 읽기 전용이라 자동 조회에서 불러도 되고, 이 호출로 런타임
   * 파일이나 서비스 등록물이 바뀌지 않는다.
   */
  inspectAgentRuntime(): Promise<AgentRuntimeInspection>;
  /** 설치 계획. 아무것도 쓰지 않는다. 사용자가 계획을 본 뒤에만 적용을 부른다. */
  planAgentRuntimeInstall(): Promise<AgentInstallPlan>;
  /**
   * 계획 하나를 적용한다. `confirmed`가 참일 때만 쓰고, 계획 식별자가 최신이 아니면 백엔드가
   * 거절한다. 사용자가 누른 자리에서만 부른다.
   */
  applyAgentRuntimeInstall(planId: string, confirmed: boolean): Promise<AgentInstallApplication>;
  planAgentRuntimeUpdate(): Promise<AgentUpdatePlan>;
  applyAgentRuntimeUpdate(planId: string, confirmed: boolean): Promise<AgentUpdateApplication>;
  /** 복구는 업데이트와 같은 계획·적용 짝을 쓴다. 결과 모양도 같다. */
  repairAgentRuntime(planId: string, confirmed: boolean): Promise<AgentUpdateApplication>;
  /** 프로젝트 하나의 역할 정책과 provider 진단을 읽는다. 읽기 전용이다. */
  readAgentRuntimePolicy(
    projectId: string,
    workingDirectory: string,
  ): Promise<AgentPolicySnapshot>;
  /**
   * 정책을 저장한다. 읽을 때 받은 `revision`을 그대로 실어 보내며, 그사이 다른 저장이 있었으면
   * 백엔드가 거절한다.
   */
  saveAgentRuntimePolicy(
    policy: AgentProjectPolicy,
    baselineRevision: string,
  ): Promise<AgentPolicySnapshot>;
  /** 기존 역할 잡에서 새 정책을 제안한다. 파일을 읽기만 한다. */
  previewAgentRuntimeMigration(
    path: string,
    projectId: string,
  ): Promise<AgentMigrationPreview>;
  /** 확인받은 미리보기를 적용한다. 미리보기 식별자와 revision이 모두 맞아야 쓴다. */
  applyAgentRuntimeMigration(
    path: string,
    projectId: string,
    previewId: string,
    baselineRevision: string,
  ): Promise<AgentPolicySnapshot>;
  planAgentRun(projectId: string, roles: AgentRoleSlotRequest[]): Promise<AgentRunPlan>;
  startAgentRun(
    projectId: string,
    planId: string,
    confirmed: boolean,
  ): Promise<AgentRunStartOutcome>;
  cancelAgentRun(
    projectId: string,
    runId: string,
    confirmed: boolean,
  ): Promise<AgentCancelOutcome>;
  retryAgentRun(projectId: string, runId: string): Promise<AgentRunSummary>;
  inspectAgentRuns(projectId: string): Promise<AgentQueueSnapshot>;
  pauseAgentProject(projectId: string): Promise<AgentQueueSnapshot>;
  resumeAgentProject(projectId: string): Promise<AgentQueueSnapshot>;
  readAgentRunLog(
    projectId: string,
    runId: string,
    cursor: number,
  ): Promise<AgentRunLogPage>;
}

/**
 * 에이전트 런타임 계약의 값들. 필드 이름과 값 어휘는 백엔드가 런타임 응답에서 그대로 옮긴 것이고,
 * 화면은 그 값을 해석해 문장으로 옮기기만 한다. 앱이 새 상태를 만들지 않는다.
 */
export interface AgentServiceState {
  platform: string;
  result: string;
  /** 참·거짓·null 세 값이다. null은 확인하지 못했다는 뜻이며 실행 중으로 올리지 않는다. */
  registered: boolean | null;
  running: boolean | null;
  label: string | null;
  executable: string | null;
  recoverable: boolean | null;
  checkedAt: string;
  evidence: string[];
}

export interface AgentRuntimeStatus {
  result: string;
  checkedAt: string;
  runtimeVersion: string | null;
  /** 디스크의 버전. */
  installedVersion: string | null;
  /** 지금 도는 서비스에서 읽은 버전. 셋은 서로 다른 사실이다. */
  runningVersion: string | null;
  apiMajor: number;
  target: string;
  installResult: string;
  recoverable: boolean | null;
  service: AgentServiceState;
}

/** 호환 판정. 사유마다 사용자가 할 다음 행동이 다르므로 값이 나뉜다. */
export type AgentCompatibility =
  | { kind: "compatible" }
  | { kind: "unsupportedApiMajor"; found: number; supported: number }
  | { kind: "versionOutOfRange"; found: string; minimum: string; maximum: string }
  | { kind: "restartRequired"; installed: string; running: string }
  | { kind: "undetermined"; reason: string };

export interface AgentRuntimeInspection {
  bundledVersion: string | null;
  status: AgentRuntimeStatus | null;
  compatibility: AgentCompatibility;
  /** 설정 저장과 실행 진입을 열어도 되는지. 모름과 재시작 필요는 둘 다 거짓이다. */
  executionAllowed: boolean;
  /** 런타임을 부르지 못한 사유. 화면은 이 값을 그대로 보여준다. */
  unavailable: string | null;
  installRoot: string;
}

/** 설치 계획이 서비스에 수행할 처분. 확인 불가를 등록 불필요로 접지 않는다. */
export type AgentInstallServiceAction =
  | "register"
  | "already_managed"
  | "migration_required"
  | "unknown";

export interface AgentInstallPlan {
  planId: string;
  bundledVersion: string;
  target: string;
  versionDirectory: string;
  launcher: string;
  alreadyInstalled: boolean;
  installedVersion: string | null;
  serviceTransitionRequired: boolean;
  /** 계획을 만들 때 런타임이 읽은 서비스 사실. null은 조회 자체가 불가능했다는 뜻이다. */
  service: AgentServiceState | null;
  /** 적용이 실제로 수행할 서비스 처분. 계획 확인 화면이 이 값을 숨기지 않는다. */
  serviceAction: AgentInstallServiceAction;
}

export interface AgentStageResult {
  /** 런타임 계약이 정한 단계 이름. 계약 밖 이름은 `unrecognized`로 온다. */
  stage: string;
  status: string;
  detail: string | null;
}

export interface AgentInstallApplication {
  planId: string;
  result: string;
  installedVersion: string | null;
  versionDirectory: string | null;
  stages: AgentStageResult[];
  detail: string | null;
}

export interface AgentUpdatePlan {
  planId: string;
  result: string;
  targetVersion: string | null;
  target: string;
  manifestVerified: boolean;
  launcherSwitchRequired: boolean;
  serviceTransitionRequired: boolean;
  recoverableOnFailure: boolean;
  installedVersion: string | null;
  runningVersion: string | null;
  /** 지금 도는 실행 수와 영향받는 프로젝트. 런타임이 센 값이고 앱이 따로 세지 않는다. */
  activeRuns: number;
  projects: string[];
  service: AgentServiceState;
}

export interface AgentUpdateApplication {
  planId: string;
  result: string;
  stages: AgentStageResult[];
  runnableVersion: string | null;
  recoveryActions: string[];
  detail: string | null;
}

/** 역할 하나의 정책. 이름은 화면이 쓰는 이름이고 저장할 때 백엔드가 런타임 계약 이름으로 옮긴다. */
export interface AgentRolePolicy {
  /**
   * 런타임 설정 계약에 대응 필드가 없어 거짓으로는 저장되지 않는다. 백엔드가 저장 전에 거절하므로
   * 화면은 끄기를 성공으로 보여주지 않는다.
   */
  enabled: boolean;
  provider: string;
  /** 빈 값이면 각 CLI의 기본 모델을 쓴다. 앱이 임의 모델명을 넣지 않는다. */
  model: string | null;
  runMode: string;
  maxParallel: number;
  intervalSeconds: number;
  /** 실행 한도. 없으면 한도를 두지 않는다. */
  maxPer: number | null;
}

export interface AgentProjectPolicy {
  projectId: string;
  workingDirectory: string;
  projectMaxParallel: number;
  deviceMaxParallel: number;
  /** 역할 이름으로 찾는다. 세 역할이 모두 있어야 저장된다. */
  roles: Record<string, AgentRolePolicy>;
}

export interface AgentDeviceProjectCapacity {
  projectId: string;
  projectName: string;
  projectMaxParallel: number;
  activeRuns: number;
}

/** 기기 사양에서 계산한 권장값과 사용자가 정한 전역값. 권장값은 실행을 막는 상한이 아니다. */
export interface AgentDeviceCapacity {
  /** 런타임이 기기 사양과 전체 프로젝트 사용량을 직접 관측했는지. */
  observed: boolean;
  configuredMaxParallel: number | null;
  effectiveMaxParallel: number;
  recommendedMaxParallel: number;
  logicalCpuCount: number | null;
  totalMemoryBytes: number | null;
  reservedMemoryBytes: number | null;
  estimatedMemoryPerAgentBytes: number | null;
  activeRuns: number;
  projects: AgentDeviceProjectCapacity[];
}

/**
 * provider 하나의 준비 상태. 런타임이 답한 값을 그대로 싣는다 — 계약이 정한 여섯 값 밖이 오면
 * 화면은 그 문자열을 숨기지 않고 그대로 보여준다.
 */
export interface AgentProviderDiagnosis {
  provider: string;
  status: string;
  version: string | null;
}

export interface AgentPolicySnapshot {
  policy: AgentProjectPolicy;
  /** 저장된 설정이 없으면 기본값 제안이고 이 값이 거짓이다. */
  stored: boolean;
  /** 저장 요청에 그대로 실어 보낼 값. 읽은 뒤 누가 바꿨는지를 이 값으로 판정한다. */
  revision: string;
  providers: AgentProviderDiagnosis[];
  executionAllowed: boolean;
  compatibility: AgentCompatibility;
  deviceCapacity: AgentDeviceCapacity;
}

/** 옮기지 못한 값 하나. 조용히 버리지 않고 그대로 남긴다. */
export interface AgentUnresolvedValue {
  role: string;
  field: string;
  value: string;
  reason: string;
}

export interface AgentMigrationPreview {
  previewId: string;
  proposed: AgentProjectPolicy;
  unresolved: AgentUnresolvedValue[];
  /** 기존 잡이 없어 손대지 않은 역할. */
  untouchedRoles: string[];
}

export interface AgentRoleSlotRequest {
  role: string;
  slots: number;
  /** 비어 있으면 자동 배정이고, 값이 있으면 런타임이 같은 안전 규칙으로 수동 대상을 검사한다. */
  targets: string[];
}

export interface AgentRoleRunPlan {
  role: string;
  provider: string;
  executionMode: string;
  requested: number;
  granted: number;
  excluded: string[];
  manualTargets: string[];
  diagnostic: unknown;
}

export interface AgentRunPlan {
  planId: string;
  projectId: string;
  revision: string;
  expiresAt: string;
  deviceRemaining: number;
  projectRemaining: number;
  billingRouteRisk: boolean;
  limits: unknown;
  roles: AgentRoleRunPlan[];
}

export type AgentRunStatus =
  | "reserved"
  | "queued"
  | "running"
  | "paused"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "recovery_required"
  | "unrecognized";

export interface AgentRunSummary {
  runId: string;
  projectId: string;
  role: string;
  provider: string;
  state: AgentRunStatus;
  targetId: string | null;
  startedAt: string | null;
  failureStage: string | null;
  reason: string | null;
  remaining: string[];
  previousRunId: string | null;
}

export interface AgentRunStartOutcome {
  started: AgentRunSummary[];
  failures: unknown[];
}

export interface AgentCancelPreview {
  runId: string;
  targetId: string | null;
  leaseId: string | null;
  pid: number | null;
  processLiveness: string;
  childProcesses: number;
  cleanup: string[];
}

export type AgentCancelOutcome =
  | { kind: "preview"; preview: AgentCancelPreview }
  | { kind: "applied"; run: AgentRunSummary }
  | { kind: "partial"; run: AgentRunSummary; remaining: string[] };

export interface AgentRunLogPage {
  runId: string;
  events: unknown[];
  nextCursor: number;
}

export interface AgentQueueSnapshot {
  projectId: string;
  paused: boolean;
  runs: AgentRunSummary[];
  errors: unknown[];
  providers: unknown[];
  unavailable: string | null;
}

/** 앱이 대신 실행하는 런타임 조작 셋. 셋 다 계획을 먼저 보여주고 확인받은 뒤에만 적용한다. */
export type AgentRuntimeOperation = "install" | "update" | "repair";

/** 확인 대기 중인 계획 하나. 종류에 따라 적용이 부르는 명령과 보여줄 값이 다르다. */
export type AgentRuntimePlan =
  | { kind: "install"; plan: AgentInstallPlan }
  | { kind: "update"; plan: AgentUpdatePlan }
  | { kind: "repair"; plan: AgentUpdatePlan };

/** 마지막 적용의 결과. 조회 주기가 지우지 않는다. */
export type AgentRuntimeApplication =
  | { kind: "install"; result: AgentInstallApplication }
  | { kind: "update"; result: AgentUpdateApplication }
  | { kind: "repair"; result: AgentUpdateApplication };

/**
 * 에이전트 화면의 수명. 주인이 훅인 이유는 연동 상태와 같다 — 화면은 조건부 렌더라 다른 메뉴를
 * 다녀오면 언마운트되고, 화면이 들고 있으면 진행 표시가 그때 사라진다.
 */
export interface AgentRuntimeState {
  inspection: AgentRuntimeInspection | null;
  policy: AgentPolicySnapshot | null;
  reading: boolean;
  /** 조회 실패 사유. 쓰기 실패와 다른 자리에 둔다. */
  readError: string | null;
  /** 지금 계획을 만드는 중인 조작. 없으면 null이다. */
  planning: AgentRuntimeOperation | null;
  /** 확인 대기 중인 계획. 이 값이 없으면 적용 버튼이 열리지 않는다. */
  plan: AgentRuntimePlan | null;
  planError: string | null;
  applying: boolean;
  application: AgentRuntimeApplication | null;
  applyError: string | null;
  migration: AgentMigrationPreview | null;
  migrationBusy: boolean;
  migrationError: string | null;
  saving: boolean;
  saveError: string | null;
  runPlan: AgentRunPlan | null;
  runRequests: AgentRoleSlotRequest[];
  runPlanning: boolean;
  runStarting: boolean;
  runError: string | null;
  queue: AgentQueueSnapshot | null;
  queueReading: boolean;
  queueError: string | null;
  pausing: boolean;
  cancelPreview: AgentCancelPreview | null;
  cancelResult: AgentCancelOutcome | null;
  retryPreview: AgentRunSummary | null;
  controllingRunId: string | null;
  controlError: string | null;
  logs: Record<string, AgentRunLogPage>;
  readingLogRunId: string | null;
  logError: string | null;
}

export interface AgentRuntimeActions {
  /** 기기 상태와 이 프로젝트의 정책을 다시 읽는다. 읽기 명령만 부른다. */
  refresh(): Promise<void>;
  /** 계획을 만든다. 아무것도 쓰지 않는다. */
  plan(operation: AgentRuntimeOperation): Promise<void>;
  cancelPlan(): void;
  /** 확인 대기 중인 계획을 적용한다. 계획이 없으면 아무것도 하지 않는다. */
  apply(): Promise<boolean>;
  previewMigration(): Promise<void>;
  applyMigration(): Promise<boolean>;
  dismissMigration(): void;
  save(policy: AgentProjectPolicy): Promise<boolean>;
  planRun(requests: AgentRoleSlotRequest[]): Promise<void>;
  cancelRunPlan(): void;
  startRun(): Promise<boolean>;
  refreshRuns(): Promise<void>;
  setProjectPaused(paused: boolean): Promise<boolean>;
  previewCancel(runId: string): Promise<void>;
  dismissCancel(): void;
  confirmCancel(): Promise<boolean>;
  previewRetry(runId: string): void;
  dismissRetry(): void;
  confirmRetry(): Promise<boolean>;
  readRunLog(runId: string): Promise<void>;
}

export interface RecentProjectStore {
  load(): RecentProject[];
  remember(project: ProjectSummary): RecentProject[];
}
