import { useEffect, useMemo, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Icon } from "../../../shared/ui/Icon";
import type {
  CustomRuleRole,
  CustomRulesActions,
  CustomRulesDocument,
  CustomRulesDraft,
  CustomRulesState,
} from "../domain/types";

interface Props {
  activeLeaseCount: number;
  actions: CustomRulesActions;
  state: CustomRulesState;
}

const roleOptions: { role: CustomRuleRole; label: string }[] = [
  { role: "planner", label: "기획자" },
  { role: "architect", label: "아키텍트" },
  { role: "developer", label: "개발자" },
];

const emptyDraft: CustomRulesDraft = {
  enabled: false,
  appliesTo: [],
  body: "",
};

function orderedRoles(roles: CustomRuleRole[]) {
  return roleOptions.map(({ role }) => role).filter((role) => roles.includes(role));
}

function draftFrom(document: CustomRulesDocument | null): CustomRulesDraft {
  if (!document || document.status !== "valid") return emptyDraft;
  return {
    enabled: document.enabled,
    appliesTo: orderedRoles(document.appliesTo),
    body: document.body,
  };
}

function sameDraft(left: CustomRulesDraft, right: CustomRulesDraft) {
  return (
    left.enabled === right.enabled &&
    left.body === right.body &&
    orderedRoles(left.appliesTo).join(",") === orderedRoles(right.appliesTo).join(",")
  );
}

function documentKey(document: CustomRulesDocument | null) {
  return document ? `${document.status}:${document.contentHash ?? ""}` : "unread";
}

function statusLabel(document: CustomRulesDocument | null) {
  if (!document) return "읽지 않음";
  if (document.status === "absent") return "사용 안 함";
  if (document.status === "valid") return document.enabled ? "사용 중" : "꺼짐";
  if (document.status === "invalid") return "형식 오류";
  if (document.status === "future_schema") return "더 새로운 형식";
  return "안전하지 않은 파일";
}

export function CustomRulesCard({ activeLeaseCount, actions, state }: Props) {
  const [draft, setDraft] = useState<CustomRulesDraft>(() => draftFrom(state.document));
  const [baselineDraft, setBaselineDraft] = useState<CustomRulesDraft>(() =>
    draftFrom(state.document),
  );
  const [baselineKey, setBaselineKey] = useState(() => documentKey(state.document));
  const [overwriteApproved, setOverwriteApproved] = useState(false);
  const [emptyConfirmation, setEmptyConfirmation] = useState(false);
  const [reloadConfirmation, setReloadConfirmation] = useState(false);
  const [adoptAfterReload, setAdoptAfterReload] = useState(false);
  const [activeRole, setActiveRole] = useState<CustomRuleRole>("planner");

  const dirty = !sameDraft(draft, baselineDraft);
  const currentKey = documentKey(state.document);
  const externalChange =
    currentKey !== baselineKey || state.saveResult?.status === "conflict";
  const previewMatches = Boolean(
    state.preview && sameDraft(state.preview.draft, draft),
  );

  useEffect(() => {
    if (!state.document || state.reading) return;
    const savedDocumentArrived =
      state.saveResult?.status === "saved" && currentKey !== baselineKey;
    const safeAutomaticRefresh =
      currentKey !== baselineKey && !dirty && state.preview === null;

    if (
      adoptAfterReload ||
      savedDocumentArrived ||
      safeAutomaticRefresh
    ) {
      const next = draftFrom(state.document);
      setAdoptAfterReload(false);
      setDraft(next);
      setBaselineDraft(next);
      setBaselineKey(currentKey);
      setOverwriteApproved(false);
      setEmptyConfirmation(false);
      setReloadConfirmation(false);
    }
  }, [adoptAfterReload, baselineKey, currentKey, dirty, state.document, state.preview, state.reading, state.saveResult]);

  useEffect(() => {
    const roles = state.preview?.roles.map(({ role }) => role) ?? [];
    if (roles.length > 0 && !roles.includes(activeRole)) setActiveRole(roles[0]);
  }, [activeRole, state.preview]);

  function changeDraft(next: CustomRulesDraft) {
    setDraft({ ...next, appliesTo: orderedRoles(next.appliesTo) });
    setEmptyConfirmation(false);
    setReloadConfirmation(false);
    actions.clearFeedback();
  }

  function toggleRole(role: CustomRuleRole) {
    changeDraft({
      ...draft,
      appliesTo: draft.appliesTo.includes(role)
        ? draft.appliesTo.filter((item) => item !== role)
        : [...draft.appliesTo, role],
    });
  }

  async function preparePreview(confirmedEmpty = false) {
    if (draft.enabled && draft.appliesTo.length === 0) return;
    if (draft.body.trim() === "" && !confirmedEmpty) {
      setEmptyConfirmation(true);
      return;
    }
    setEmptyConfirmation(false);
    await actions.preparePreview(draft);
  }

  async function reload() {
    setReloadConfirmation(false);
    const read = await actions.reload();
    if (read) setAdoptAfterReload(true);
  }

  function requestReload() {
    if (dirty) {
      setReloadConfirmation(true);
      return;
    }
    void reload();
  }

  function discardChanges() {
    setDraft(baselineDraft);
    setEmptyConfirmation(false);
    setReloadConfirmation(false);
    actions.clearFeedback();
  }

  const document = state.document;
  const needsOverwriteApproval =
    document?.status === "invalid" || document?.status === "future_schema";
  const unsafe = document?.status === "unsafe_file";
  const canEdit =
    document?.status === "valid" ||
    document?.status === "absent" ||
    (needsOverwriteApproval && overwriteApproved);
  const selectedPreview = useMemo(
    () => state.preview?.roles.find(({ role }) => role === activeRole) ?? null,
    [activeRole, state.preview],
  );
  const roleRequired = draft.enabled && draft.appliesTo.length === 0;
  const saveBlocked =
    !previewMatches || externalChange || state.saving || state.previewing;

  return (
    <section aria-label="사용자 정의 규칙" className="settings-card custom-rules-card">
      <header>
        <span><Icon name="stamp" /></span>
        <div>
          <strong>사용자 정의 규칙</strong>
          <small>프로젝트별 규칙 한 개를 다음 에이전트 세션에 적용합니다.</small>
        </div>
        <b className={`custom-rules-status status-${document?.status ?? "unread"}`}>
          {state.reading ? "읽는 중" : statusLabel(document)}
        </b>
      </header>

      <div className="custom-rules-guidance">
        <p><strong>우선순위</strong> 사용자 규칙은 앱 기본 규칙과 역할 계약을 완화할 수 없습니다.</p>
        <p><strong>비밀 값 금지</strong> API 키, 비밀번호, 토큰과 다른 비밀 값을 입력하지 마세요.</p>
        <p><strong>적용 시점</strong> 앱을 다시 시작할 필요는 없지만, 저장 뒤 새로 시작하는 세션부터 적용됩니다.</p>
        {activeLeaseCount > 0 && (
          <p><strong>실행 중인 작업 {activeLeaseCount}개</strong> 이미 시작한 세션은 이전 규칙을 사용하고 있을 수 있습니다.</p>
        )}
      </div>

      {!document && !state.reading && (
        <div className="custom-rules-message muted">
          사용자 규칙을 아직 읽지 못했습니다. 프로젝트를 새로 고침해 주세요.
        </div>
      )}

      {state.readError && (
        <div className="custom-rules-message error" role="alert">
          <strong>사용자 규칙을 읽지 못했습니다</strong>
          <span>{state.readError}</span>
        </div>
      )}

      {needsOverwriteApproval && !overwriteApproved && (
        <div className="custom-rules-recovery">
          <strong>{statusLabel(document)} 파일은 자동으로 고치지 않습니다.</strong>
          {document?.error && <p>{document.error}</p>}
          <label>현재 파일 원문</label>
          <pre>{document?.raw ?? "원문을 읽을 수 없습니다."}</pre>
          <div className="custom-rules-actions">
            <button className="secondary-button" onClick={requestReload} type="button">다시 불러오기</button>
            <button
              className="danger-button"
              onClick={() => {
                setOverwriteApproved(true);
                setDraft(emptyDraft);
                setBaselineDraft(emptyDraft);
                actions.clearFeedback();
              }}
              type="button"
            >새 형식으로 덮어쓰기</button>
          </div>
        </div>
      )}

      {unsafe && (
        <div className="custom-rules-recovery">
          <strong>앱에서 이 파일을 덮어쓸 수 없습니다.</strong>
          <p>{document?.error ?? "심볼릭 링크이거나 일반 파일이 아닙니다."}</p>
          <p>파일 시스템에서 항목을 정리한 뒤 다시 불러오세요.</p>
          <button className="secondary-button" onClick={requestReload} type="button">다시 불러오기</button>
        </div>
      )}

      {canEdit && (
        <>
          <dl className="custom-rules-meta">
            <div><dt>마지막 수정</dt><dd>{document?.modifiedAt ?? "저장 기록 없음"}</dd></div>
            <div><dt>현재 적용</dt><dd>{document?.status === "valid" && document.enabled ? "선택한 역할에 사용" : "사용하지 않음"}</dd></div>
          </dl>

          {externalChange && (
            <div className="custom-rules-message warning" role="alert">
              <strong>앱 밖에서 파일이 바뀌었습니다</strong>
              <span>입력한 내용은 유지했습니다. 다시 불러와 최신 파일을 확인하기 전에는 저장할 수 없습니다.</span>
              <button className="secondary-button" onClick={requestReload} type="button">다시 불러오기</button>
            </div>
          )}

          <div className="custom-rules-editor">
            <label className="custom-rules-toggle">
              <input
                checked={draft.enabled}
                onChange={(event) => changeDraft({ ...draft, enabled: event.target.checked })}
                type="checkbox"
              />
              <span><strong>사용자 규칙 사용</strong><small>꺼도 역할과 본문은 지우지 않습니다.</small></span>
            </label>

            <fieldset>
              <legend>적용 역할</legend>
              <div className="custom-rules-role-options">
                {roleOptions.map(({ role, label }) => (
                  <label key={role}>
                    <input
                      checked={draft.appliesTo.includes(role)}
                      onChange={() => toggleRole(role)}
                      type="checkbox"
                    />
                    {label}
                  </label>
                ))}
              </div>
              {roleRequired && <small className="field-error">규칙을 사용하려면 역할을 하나 이상 선택하세요.</small>}
            </fieldset>

            <label className="custom-rules-body-field">
              <span>Markdown 본문</span>
              <textarea
                aria-label="사용자 규칙 Markdown 본문"
                onChange={(event) => changeDraft({ ...draft, body: event.target.value })}
                placeholder="예: 개발 보고서에는 검증 수치와 실행 환경을 함께 적는다."
                value={draft.body}
              />
            </label>

            <div className="custom-rules-edit-status">
              <span>{dirty ? "저장하지 않은 변경이 있습니다." : "불러온 저장 상태와 같습니다."}</span>
              <button disabled={!dirty} onClick={discardChanges} type="button">변경 취소</button>
            </div>

            {reloadConfirmation && (
              <div className="custom-rules-confirmation" role="alert">
                <strong>저장하지 않은 변경을 버리고 다시 불러올까요?</strong>
                <div>
                  <button onClick={() => setReloadConfirmation(false)} type="button">계속 편집</button>
                  <button className="danger-button" onClick={() => void reload()} type="button">변경 버리고 다시 불러오기</button>
                </div>
              </div>
            )}

            {emptyConfirmation && (
              <div className="custom-rules-confirmation" role="alert">
                <strong>본문을 완전히 비운 상태로 저장할까요?</strong>
                <span>사용 여부와 역할만 남고 사용자 규칙 본문은 없어집니다.</span>
                <div>
                  <button onClick={() => setEmptyConfirmation(false)} type="button">취소</button>
                  <button className="danger-button" onClick={() => void preparePreview(true)} type="button">빈 본문 미리보기 준비</button>
                </div>
              </div>
            )}

            {state.previewError && (
              <div className="custom-rules-message error" role="alert"><strong>미리보기를 준비하지 못했습니다</strong><span>{state.previewError}</span></div>
            )}
            {state.saveError && (
              <div className="custom-rules-message error" role="alert"><strong>사용자 규칙을 저장하지 못했습니다</strong><span>{state.saveError}</span></div>
            )}
            {state.saveResult?.status === "conflict" && (
              <div className="custom-rules-message warning" role="alert"><strong>다른 변경과 충돌해 저장하지 않았습니다</strong><span>{state.saveResult.reason ?? "최신 파일을 다시 불러온 뒤 검토하세요."}</span></div>
            )}
            {state.saveResult?.status === "retry_required" && (
              <div className="custom-rules-message warning" role="status"><strong>지금은 저장할 수 없습니다</strong><span>{state.saveResult.reason ?? "다른 쓰기 작업이 끝난 뒤 다시 시도하세요."}</span></div>
            )}
            {state.saveResult?.status === "saved" && (
              <div className="custom-rules-message success" role="status"><strong>사용자 규칙을 저장했습니다</strong><span>앱 재시작 없이 반영됐으며 다음 에이전트 세션부터 적용됩니다.</span></div>
            )}

            <div className="custom-rules-actions">
              <button className="secondary-button" disabled={state.reading || state.saving} onClick={requestReload} type="button">
                {state.reading ? "불러오는 중" : "다시 불러오기"}
              </button>
              <button
                className="secondary-button"
                disabled={roleRequired || state.previewing || state.saving || externalChange}
                onClick={() => void preparePreview()}
                type="button"
              >{state.previewing ? "준비 중" : "미리보기 준비"}</button>
              <button
                className="primary-button"
                disabled={saveBlocked}
                onClick={() => void actions.save()}
                type="button"
              >{state.saving ? "저장 중" : "저장"}</button>
            </div>
          </div>
        </>
      )}

      {state.preview && previewMatches && (
        <section aria-label="사용자 규칙 미리보기" className="custom-rules-preview">
          <header>
            <div><strong>저장 전 미리보기</strong><small>{state.preview.priorityNotice}</small></div>
          </header>
          <div className="custom-rules-preview-grid">
            <section>
              <h3>저장 파일 원문</h3>
              <pre data-testid="custom-rules-serialized">{state.preview.serialized}</pre>
            </section>
            <section>
              <h3>사용자 본문 Markdown 미리보기</h3>
              <div className="custom-rules-markdown-preview">
                <Markdown
                  components={{
                    a: ({ children }) => <span className="blocked-link">{children}</span>,
                    img: ({ alt }) => <span className="blocked-image">{alt ?? "이미지"}</span>,
                  }}
                  remarkPlugins={[[remarkGfm, { singleTilde: false }]]}
                  skipHtml
                >{draft.body}</Markdown>
              </div>
            </section>
          </div>

          <div className="custom-rules-role-tabs" role="tablist" aria-label="역할별 최종 규칙">
            {state.preview.roles.map(({ role }) => (
              <button
                aria-selected={activeRole === role}
                key={role}
                onClick={() => setActiveRole(role)}
                role="tab"
                type="button"
              >{roleOptions.find((item) => item.role === role)?.label ?? role}</button>
            ))}
          </div>
          {selectedPreview && (
            <ol className="custom-rules-sources">
              {selectedPreview.sources.map((source) => (
                <li className={source.applied ? "applied" : "not-applied"} key={`${source.order}-${source.kind}`}>
                  <header>
                    <span>{source.order}</span>
                    <strong>{source.label}</strong>
                    <small>{source.applied ? "적용" : "적용 안 함"}</small>
                  </header>
                  {source.reason && <p>{source.reason}</p>}
                  <pre>{source.content}</pre>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </section>
  );
}
