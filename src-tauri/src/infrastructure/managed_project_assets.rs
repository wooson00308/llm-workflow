use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use tempfile::{Builder, NamedTempFile, TempPath};
use thiserror::Error;

use crate::domain::project::{
    ManagedAssetRollbackFailure, ManagedAssetRollbackRecovery, ManagedAssetState,
    ManagedAssetStatus, ManagedAssetSyncResult, ManagedAssetSyncStatus,
};

struct RollbackOutcome {
    failures: Vec<ManagedAssetRollbackFailure>,
    recoveries: Vec<ManagedAssetRollbackRecovery>,
}
use crate::infrastructure::claim_helper::CLAIM_HELPER;
use crate::infrastructure::managed_script::{ManagedScriptError, ManagedScriptPlan};
use crate::infrastructure::project_instructions::{
    plan_project_instruction_assets, ProjectInstructionAssetFailure, ProjectInstructionAssetPlan,
    ProjectInstructionError, ARCHITECT_RULES_VERSION, DEVELOPER_RULES_VERSION,
    PLANNER_RULES_VERSION, WORKFLOW_RULES_VERSION,
};
use crate::infrastructure::project_write_lock::{ProjectWriteLock, ProjectWriteLockError};

#[derive(Debug, Error)]
pub enum ManagedProjectAssetsError {
    #[error("관리 자산을 읽지 못했습니다: {0}")]
    Read(String),
    #[error("관리 자산을 저장하지 못했습니다: {0}")]
    Write(String),
    #[error("관리 자산 동기화가 필요하지만 자동으로 처리할 수 없습니다: {0}")]
    Conflict(String),
    #[error(transparent)]
    Lock(#[from] ProjectWriteLockError),
}

struct AssetPlan {
    id: &'static str,
    label: &'static str,
    path: PathBuf,
    installed_version: Option<u32>,
    provided_version: Option<u32>,
    original: Option<Vec<u8>>,
    replacement: Option<String>,
}

impl From<ProjectInstructionAssetPlan> for AssetPlan {
    fn from(plan: ProjectInstructionAssetPlan) -> Self {
        Self {
            id: plan.id,
            label: plan.label,
            path: plan.path,
            installed_version: plan.installed_version,
            provided_version: plan.provided_version,
            original: plan.original,
            replacement: plan.replacement,
        }
    }
}

impl From<ManagedScriptPlan> for AssetPlan {
    fn from(plan: ManagedScriptPlan) -> Self {
        Self {
            id: plan.id,
            label: plan.label,
            path: plan.path,
            installed_version: plan.installed_version,
            provided_version: Some(plan.provided_version),
            original: plan.original,
            replacement: plan.replacement,
        }
    }
}

struct AssetConflict {
    id: &'static str,
    label: &'static str,
    installed_version: Option<u32>,
    provided_version: Option<u32>,
    reason: String,
}

enum Preflight {
    Ready(Vec<AssetPlan>),
    Conflict {
        plans: Vec<AssetPlan>,
        conflicts: Vec<AssetConflict>,
    },
}

/// 현재 운영체제의 자산만 포함해 관리 자산 전체를 동기화한다.
/// 잠금 경합과 검증 충돌은 명령 오류가 아닌 구조화된 결과로 반환한다.
pub fn synchronize_managed_project_assets(
    project_root: &Path,
    control_root: &Path,
) -> Result<ManagedAssetSyncResult, ManagedProjectAssetsError> {
    synchronize_with_hooks(project_root, control_root, || {}, |_, _| {}, |_, _, _| {})
}

#[cfg(test)]
fn synchronize_with_before_commit<F>(
    project_root: &Path,
    control_root: &Path,
    before_commit: F,
) -> Result<ManagedAssetSyncResult, ManagedProjectAssetsError>
where
    F: FnOnce(),
{
    synchronize_with_hooks(
        project_root,
        control_root,
        before_commit,
        |_, _| {},
        |_, _, _| {},
    )
}

fn synchronize_with_hooks<B, A, R>(
    project_root: &Path,
    control_root: &Path,
    before_commit: B,
    mut after_replacement: A,
    mut after_rollback_isolation: R,
) -> Result<ManagedAssetSyncResult, ManagedProjectAssetsError>
where
    B: FnOnce(),
    A: FnMut(usize, &Path),
    R: FnMut(&str, &Path, &Path),
{
    let _lock = match ProjectWriteLock::acquire(control_root) {
        Ok(lock) => lock,
        Err(ProjectWriteLockError::Busy) => return Ok(retry_required_result()),
        Err(error) => return Err(error.into()),
    };

    let plans = match preflight(project_root, control_root)? {
        Preflight::Ready(plans) => plans,
        Preflight::Conflict { plans, conflicts } => {
            return Ok(conflict_result(plans, conflicts));
        }
    };

    before_commit();
    if let Some((id, reason)) = first_snapshot_change(&plans)? {
        return Ok(snapshot_conflict_result(
            &plans,
            id,
            reason,
            RollbackOutcome {
                failures: Vec::new(),
                recoveries: Vec::new(),
            },
        ));
    }

    let mut updated_assets = Vec::new();
    let mut applied = Vec::new();
    for (index, plan) in plans.iter().enumerate() {
        // 전체 기준 대조 뒤에도 각 교체 직전의 파일을 다시 확인한다.
        match snapshot_matches(&plan.path, plan.original.as_deref()) {
            Ok(true) => {}
            Ok(false) => {
                let rollback = rollback_applied(&plans, &applied, &mut after_rollback_isolation);
                return Ok(snapshot_conflict_result(
                    &plans,
                    plan.id,
                    format!("{} 파일이 저장 직전에 변경됐습니다.", plan.label),
                    rollback,
                ));
            }
            Err(error) => {
                let rollback = rollback_applied(&plans, &applied, &mut after_rollback_isolation);
                return Err(append_rollback_context(error, &rollback));
            }
        }
        let Some(replacement) = &plan.replacement else {
            continue;
        };
        if let Err(error) = write_atomically(&plan.path, replacement) {
            let rollback = rollback_applied(&plans, &applied, &mut after_rollback_isolation);
            return Err(append_rollback_context(error, &rollback));
        }
        applied.push(index);
        updated_assets.push(plan.id.to_owned());
        after_replacement(applied.len(), &plan.path);
    }

    let status = if updated_assets.is_empty() {
        ManagedAssetSyncStatus::Current
    } else {
        ManagedAssetSyncStatus::Updated
    };
    Ok(ManagedAssetSyncResult {
        status,
        assets: plans
            .into_iter()
            .map(|plan| ManagedAssetState {
                id: plan.id.to_owned(),
                label: plan.label.to_owned(),
                status: if updated_assets.iter().any(|id| id == plan.id) {
                    ManagedAssetStatus::Updated
                } else {
                    ManagedAssetStatus::Current
                },
                installed_version: if updated_assets.iter().any(|id| id == plan.id) {
                    plan.provided_version
                } else {
                    plan.installed_version
                },
                provided_version: plan.provided_version,
                reason: None,
            })
            .collect(),
        updated_assets,
        reason: None,
        affected_asset: None,
        rollback_failures: Vec::new(),
        rollback_recoveries: Vec::new(),
    })
}

/// 후속 기준 변경을 발견하기 전에 교체한 파일을 역순으로 모두 복원한다.
/// 대상 엔트리를 같은 파일시스템의 복구 디렉터리로 먼저 격리하고, 대상이 비어 있을 때만 복원한다.
fn rollback_applied<R>(
    plans: &[AssetPlan],
    applied: &[usize],
    after_isolation: &mut R,
) -> RollbackOutcome
where
    R: FnMut(&str, &Path, &Path),
{
    let mut outcome = RollbackOutcome {
        failures: Vec::new(),
        recoveries: Vec::new(),
    };
    for index in applied.iter().rev() {
        let plan = &plans[*index];
        match rollback_one(plan, after_isolation) {
            Ok(recovery_path) => outcome
                .recoveries
                .push(rollback_recovery(plan, recovery_path)),
            Err(failure) => {
                if let Some(recovery_path) = failure.recovery_path.as_ref() {
                    outcome.recoveries.push(ManagedAssetRollbackRecovery {
                        asset_id: failure.asset_id.clone(),
                        label: failure.label.clone(),
                        recovery_path: recovery_path.clone(),
                    });
                }
                outcome.failures.push(failure);
            }
        }
    }
    outcome
}

fn rollback_one<R>(
    plan: &AssetPlan,
    after_isolation: &mut R,
) -> Result<PathBuf, ManagedAssetRollbackFailure>
where
    R: FnMut(&str, &Path, &Path),
{
    let replacement = plan
        .replacement
        .as_ref()
        .expect("only replaced plans are recorded");
    let parent = plan.path.parent().ok_or_else(|| {
        rollback_failure(plan, "복구 디렉터리를 정할 수 없습니다.".to_owned(), None)
    })?;
    let recovery_dir = Builder::new()
        .prefix(".workflow-labs-rollback-")
        .tempdir_in(parent)
        .map_err(|error| {
            rollback_failure(
                plan,
                format!("복구 디렉터리를 만들지 못했습니다: {error}"),
                None,
            )
        })?
        .keep();
    let isolated_path = recovery_dir.join("isolated");
    if let Err(error) = fs::rename(&plan.path, &isolated_path) {
        let _ = fs::remove_dir(&recovery_dir);
        return Err(rollback_failure(
            plan,
            format!("현재 파일을 원자적으로 격리하지 못했습니다: {error}"),
            None,
        ));
    }

    let isolated_is_replacement = fs::symlink_metadata(&isolated_path)
        .ok()
        .filter(|metadata| metadata.file_type().is_file())
        .and_then(|_| fs::read(&isolated_path).ok())
        .is_some_and(|contents| contents == replacement.as_bytes());
    after_isolation(plan.id, &plan.path, &isolated_path);

    if !isolated_is_replacement {
        return restore_isolated_external(plan, isolated_path, recovery_dir);
    }

    match &plan.original {
        Some(original) => restore_original_if_absent(plan, original, recovery_dir),
        None => finish_missing_original_rollback(plan, recovery_dir),
    }
}

fn restore_isolated_external(
    plan: &AssetPlan,
    isolated_path: PathBuf,
    recovery_dir: PathBuf,
) -> Result<PathBuf, ManagedAssetRollbackFailure> {
    if let Some(original) = &plan.original {
        preserve_original_copy(plan, original, &recovery_dir)?;
    }
    let isolated = TempPath::try_from_path(&isolated_path).map_err(|error| {
        rollback_failure(
            plan,
            format!("격리한 외부 파일을 복원 준비하지 못했습니다: {error}"),
            Some(recovery_dir.clone()),
        )
    })?;
    match isolated.persist_noclobber(&plan.path) {
        Ok(()) => {
            let recovery_path = if plan.original.is_some() {
                Some(recovery_dir.clone())
            } else {
                let _ = fs::remove_dir(&recovery_dir);
                None
            };
            Err(rollback_failure(
                plan,
                "앱이 저장한 뒤 파일이 외부에서 변경되어 원래 계획 상태로 복원하지 못했습니다. 외부 내용은 대상 경로에 보존했습니다."
                    .to_owned(),
                recovery_path,
            ))
        }
        Err(error) => {
            let io_error = error.error.to_string();
            preserve_temp_path(error.path);
            Err(rollback_failure(
                plan,
                format!(
                    "앱 저장 뒤의 외부 내용과 새로 생긴 대상 파일을 모두 보존했습니다: {io_error}"
                ),
                Some(recovery_dir),
            ))
        }
    }
}

fn preserve_original_copy(
    plan: &AssetPlan,
    original: &[u8],
    recovery_dir: &Path,
) -> Result<PathBuf, ManagedAssetRollbackFailure> {
    let mut original_file = NamedTempFile::new_in(recovery_dir).map_err(|error| {
        rollback_failure(
            plan,
            format!("검사 전 내용을 복구 위치에 만들지 못했습니다: {error}"),
            Some(recovery_dir.to_owned()),
        )
    })?;
    if let Err(error) = original_file
        .write_all(original)
        .and_then(|_| original_file.as_file().sync_all())
    {
        original_file.disable_cleanup(true);
        return Err(rollback_failure(
            plan,
            format!("검사 전 내용을 복구 위치에 저장하지 못했습니다: {error}"),
            Some(recovery_dir.to_owned()),
        ));
    }
    let original_path = recovery_dir.join("original");
    original_file
        .persist_noclobber(&original_path)
        .map(|_| original_path)
        .map_err(|mut error| {
            error.file.disable_cleanup(true);
            rollback_failure(
                plan,
                format!(
                    "검사 전 내용을 복구 위치에 확정하지 못했습니다: {}",
                    error.error
                ),
                Some(recovery_dir.to_owned()),
            )
        })
}

fn restore_original_if_absent(
    plan: &AssetPlan,
    original: &[u8],
    recovery_dir: PathBuf,
) -> Result<PathBuf, ManagedAssetRollbackFailure> {
    let mut original_file = NamedTempFile::new_in(&recovery_dir).map_err(|error| {
        rollback_failure(
            plan,
            format!("원본 복구 파일을 만들지 못했습니다: {error}"),
            Some(recovery_dir.clone()),
        )
    })?;
    if let Err(error) = original_file
        .write_all(original)
        .and_then(|_| original_file.as_file().sync_all())
    {
        original_file.disable_cleanup(true);
        return Err(rollback_failure(
            plan,
            format!("원본 복구 파일을 저장하지 못했습니다: {error}"),
            Some(recovery_dir.clone()),
        ));
    }
    match original_file.persist_noclobber(&plan.path) {
        Ok(_) => Ok(recovery_dir),
        Err(mut error) => {
            let io_error = error.error.to_string();
            error.file.disable_cleanup(true);
            Err(rollback_failure(
                plan,
                format!(
                    "대상 경로에 새 파일이 생겨 덮어쓰지 않았습니다. 검사 전 내용은 복구 위치에 보존했습니다: {io_error}"
                ),
                Some(recovery_dir),
            ))
        }
    }
}

fn finish_missing_original_rollback(
    plan: &AssetPlan,
    recovery_dir: PathBuf,
) -> Result<PathBuf, ManagedAssetRollbackFailure> {
    match fs::symlink_metadata(&plan.path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(recovery_dir),
        Ok(_) => Err(rollback_failure(
            plan,
            "원래 없던 대상 경로에 외부 파일이 생겨 삭제하지 않았습니다.".to_owned(),
            Some(recovery_dir),
        )),
        Err(error) => Err(rollback_failure(
            plan,
            format!("대상 경로의 부재를 확인하지 못했습니다: {error}"),
            Some(recovery_dir),
        )),
    }
}

fn preserve_temp_path(mut path: TempPath) {
    path.disable_cleanup(true);
}

fn rollback_failure(
    plan: &AssetPlan,
    reason: String,
    recovery_path: Option<PathBuf>,
) -> ManagedAssetRollbackFailure {
    ManagedAssetRollbackFailure {
        asset_id: plan.id.to_owned(),
        label: plan.label.to_owned(),
        reason,
        recovery_path: recovery_path.map(|path| path.display().to_string()),
    }
}

fn rollback_recovery(plan: &AssetPlan, recovery_path: PathBuf) -> ManagedAssetRollbackRecovery {
    ManagedAssetRollbackRecovery {
        asset_id: plan.id.to_owned(),
        label: plan.label.to_owned(),
        recovery_path: recovery_path.display().to_string(),
    }
}

fn append_rollback_context(
    error: ManagedProjectAssetsError,
    rollback: &RollbackOutcome,
) -> ManagedProjectAssetsError {
    let context = rollback_context_summary(&rollback.failures, &rollback.recoveries);
    if context.is_empty() {
        return error;
    }
    ManagedProjectAssetsError::Write(format!("{error}; {context}"))
}

fn rollback_failure_summary(failure: &ManagedAssetRollbackFailure) -> String {
    match &failure.recovery_path {
        Some(path) => format!("{}: {} 복구 위치: {path}", failure.label, failure.reason),
        None => format!("{}: {}", failure.label, failure.reason),
    }
}

fn rollback_recovery_summary(recovery: &ManagedAssetRollbackRecovery) -> String {
    format!("{}: {}", recovery.label, recovery.recovery_path)
}

fn rollback_context_summary(
    failures: &[ManagedAssetRollbackFailure],
    recoveries: &[ManagedAssetRollbackRecovery],
) -> String {
    let mut parts = Vec::new();
    if !failures.is_empty() {
        parts.push(format!(
            "복원 실패: {}",
            failures
                .iter()
                .map(rollback_failure_summary)
                .collect::<Vec<_>>()
                .join("; ")
        ));
    }
    if !recoveries.is_empty() {
        parts.push(format!(
            "복구 위치: {}",
            recoveries
                .iter()
                .map(rollback_recovery_summary)
                .collect::<Vec<_>>()
                .join("; ")
        ));
    }
    parts.join("; ")
}

/// 기존 생성·결정·QA 경로가 쓰는 조정 계층. 예상된 결과를 기존처럼 요청 실패로 바꾼다.
pub fn install_managed_project_assets(
    project_root: &Path,
    control_root: &Path,
) -> Result<(), ManagedProjectAssetsError> {
    let result = synchronize_managed_project_assets(project_root, control_root)?;
    finish_managed_project_asset_install(result)
}

fn finish_managed_project_asset_install(
    result: ManagedAssetSyncResult,
) -> Result<(), ManagedProjectAssetsError> {
    match result.status {
        ManagedAssetSyncStatus::Current | ManagedAssetSyncStatus::Updated => Ok(()),
        ManagedAssetSyncStatus::RetryRequired => {
            Err(ManagedProjectAssetsError::Lock(ProjectWriteLockError::Busy))
        }
        ManagedAssetSyncStatus::Conflict => {
            let mut reason = result.reason.unwrap_or_else(|| "관리 자산 충돌".to_owned());
            if !result.rollback_recoveries.is_empty() {
                reason.push_str("; 복구 위치: ");
                reason.push_str(
                    &result
                        .rollback_recoveries
                        .iter()
                        .map(rollback_recovery_summary)
                        .collect::<Vec<_>>()
                        .join("; "),
                );
            }
            Err(ManagedProjectAssetsError::Conflict(reason))
        }
    }
}

/// 새 프로젝트의 제어 디렉터리를 만들기 전에도 기존 사용자 파일 충돌을 찾을 수 있게 한다.
/// 실제 저장 경로는 이 검사에 의존하지 않고 잠금 안에서 다시 전체 계획을 만든다.
pub fn validate_managed_project_assets(
    project_root: &Path,
    control_root: &Path,
) -> Result<(), ManagedProjectAssetsError> {
    match preflight(project_root, control_root)? {
        Preflight::Ready(_) => Ok(()),
        Preflight::Conflict { plans, conflicts } => {
            let result = conflict_result(plans, conflicts);
            Err(ManagedProjectAssetsError::Conflict(
                result.reason.unwrap_or_else(|| "관리 자산 충돌".to_owned()),
            ))
        }
    }
}

fn preflight(
    project_root: &Path,
    control_root: &Path,
) -> Result<Preflight, ManagedProjectAssetsError> {
    let mut plans = Vec::with_capacity(7);
    let mut conflicts = Vec::new();
    let mut unexpected = Vec::new();

    for result in plan_project_instruction_assets(project_root, control_root) {
        match result {
            Ok(plan) => plans.push(plan.into()),
            Err(failure) => classify_instruction_failure(failure, &mut conflicts, &mut unexpected),
        }
    }

    match CLAIM_HELPER.plan_install(control_root) {
        Ok(plan) => plans.push(plan.into()),
        Err(error) => classify_script_failure(error, &mut conflicts, &mut unexpected),
    }

    if !unexpected.is_empty() {
        return Err(ManagedProjectAssetsError::Read(unexpected.join("; ")));
    }
    if conflicts.is_empty() {
        Ok(Preflight::Ready(plans))
    } else {
        Ok(Preflight::Conflict { plans, conflicts })
    }
}

fn classify_instruction_failure(
    failure: ProjectInstructionAssetFailure,
    conflicts: &mut Vec<AssetConflict>,
    unexpected: &mut Vec<String>,
) {
    match failure.error {
        ProjectInstructionError::Conflict(reason) => conflicts.push(AssetConflict {
            id: failure.id,
            label: failure.label,
            installed_version: failure.installed_version,
            provided_version: failure.provided_version,
            reason,
        }),
        ProjectInstructionError::InvalidEncoding(reason) => conflicts.push(AssetConflict {
            id: failure.id,
            label: failure.label,
            installed_version: failure.installed_version,
            provided_version: failure.provided_version,
            reason: format!("{reason}이 유효한 UTF-8 파일이 아닙니다."),
        }),
        error => unexpected.push(error.to_string()),
    }
}

fn classify_script_failure(
    error: ManagedScriptError,
    conflicts: &mut Vec<AssetConflict>,
    unexpected: &mut Vec<String>,
) {
    match error {
        ManagedScriptError::NotRegularFile { .. }
        | ManagedScriptError::Unmanaged(_)
        | ManagedScriptError::InvalidEncoding { .. } => {
            conflicts.push(AssetConflict {
                id: "claim_helper",
                label: "선점 헬퍼",
                installed_version: None,
                provided_version: Some(CLAIM_HELPER.version),
                reason: error.to_string(),
            });
        }
        ManagedScriptError::Downgrade { found, .. } => conflicts.push(AssetConflict {
            id: "claim_helper",
            label: "선점 헬퍼",
            installed_version: Some(found),
            provided_version: Some(CLAIM_HELPER.version),
            reason: error.to_string(),
        }),
        error => unexpected.push(error.to_string()),
    }
}

fn first_snapshot_change(
    plans: &[AssetPlan],
) -> Result<Option<(&'static str, String)>, ManagedProjectAssetsError> {
    for plan in plans {
        if !snapshot_matches(&plan.path, plan.original.as_deref())? {
            return Ok(Some((
                plan.id,
                format!("{} 파일이 사전 검사 뒤에 변경됐습니다.", plan.label),
            )));
        }
    }
    Ok(None)
}

fn snapshot_matches(
    path: &Path,
    expected: Option<&[u8]>,
) -> Result<bool, ManagedProjectAssetsError> {
    match expected {
        None => match fs::symlink_metadata(path) {
            Ok(_) => Ok(false),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(true),
            Err(error) => Err(ManagedProjectAssetsError::Read(error.to_string())),
        },
        Some(expected) => {
            let metadata = match fs::symlink_metadata(path) {
                Ok(metadata) => metadata,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
                Err(error) => return Err(ManagedProjectAssetsError::Read(error.to_string())),
            };
            if !metadata.file_type().is_file() {
                return Ok(false);
            }
            fs::read(path)
                .map(|contents| contents == expected)
                .map_err(|error| ManagedProjectAssetsError::Read(error.to_string()))
        }
    }
}

fn conflict_result(plans: Vec<AssetPlan>, conflicts: Vec<AssetConflict>) -> ManagedAssetSyncResult {
    let affected_asset = conflicts.first().map(|conflict| conflict.id.to_owned());
    let reason = conflicts
        .iter()
        .map(|conflict| format!("{}: {}", conflict.label, conflict.reason))
        .collect::<Vec<_>>()
        .join("; ");
    let mut assets = plans
        .into_iter()
        .map(|plan| state_from_plan(&plan, None))
        .collect::<Vec<_>>();
    assets.extend(conflicts.into_iter().map(|conflict| ManagedAssetState {
        id: conflict.id.to_owned(),
        label: conflict.label.to_owned(),
        status: ManagedAssetStatus::Conflict,
        installed_version: conflict.installed_version,
        provided_version: conflict.provided_version,
        reason: Some(conflict.reason),
    }));
    sort_assets(&mut assets);
    ManagedAssetSyncResult {
        status: ManagedAssetSyncStatus::Conflict,
        assets,
        updated_assets: Vec::new(),
        reason: Some(reason),
        affected_asset,
        rollback_failures: Vec::new(),
        rollback_recoveries: Vec::new(),
    }
}

fn snapshot_conflict_result(
    plans: &[AssetPlan],
    affected_id: &str,
    reason: String,
    rollback: RollbackOutcome,
) -> ManagedAssetSyncResult {
    let rollback_summary = rollback
        .failures
        .iter()
        .map(rollback_failure_summary)
        .collect::<Vec<_>>()
        .join("; ");
    let overall_reason = if rollback_summary.is_empty() {
        reason.clone()
    } else {
        format!("{reason}; 복원 실패: {rollback_summary}")
    };
    ManagedAssetSyncResult {
        status: ManagedAssetSyncStatus::Conflict,
        assets: plans
            .iter()
            .map(|plan| {
                let mut reasons = Vec::new();
                if plan.id == affected_id {
                    reasons.push(reason.clone());
                }
                reasons.extend(
                    rollback
                        .failures
                        .iter()
                        .filter(|failure| failure.asset_id == plan.id)
                        .map(|failure| format!("복원 실패: {}", rollback_failure_summary(failure))),
                );
                state_from_plan(plan, (!reasons.is_empty()).then(|| reasons.join("; ")))
            })
            .collect(),
        updated_assets: Vec::new(),
        reason: Some(overall_reason),
        affected_asset: Some(affected_id.to_owned()),
        rollback_failures: rollback.failures,
        rollback_recoveries: rollback.recoveries,
    }
}

fn state_from_plan(plan: &AssetPlan, conflict_reason: Option<String>) -> ManagedAssetState {
    ManagedAssetState {
        id: plan.id.to_owned(),
        label: plan.label.to_owned(),
        status: if conflict_reason.is_some() {
            ManagedAssetStatus::Conflict
        } else if plan.replacement.is_some() {
            ManagedAssetStatus::UpdateRequired
        } else {
            ManagedAssetStatus::Current
        },
        installed_version: plan.installed_version,
        provided_version: plan.provided_version,
        reason: conflict_reason,
    }
}

fn retry_required_result() -> ManagedAssetSyncResult {
    let reason =
        "다른 프로젝트 쓰기 작업이 진행 중입니다. 작업이 끝난 뒤 다시 시도하세요.".to_owned();
    let mut assets = vec![
        retry_asset(
            "workflow_rules",
            "공통 규칙",
            Some(WORKFLOW_RULES_VERSION),
            &reason,
        ),
        retry_asset(
            "planner_rules",
            "기획자 역할 계약",
            Some(PLANNER_RULES_VERSION),
            &reason,
        ),
        retry_asset(
            "architect_rules",
            "아키텍트 역할 계약",
            Some(ARCHITECT_RULES_VERSION),
            &reason,
        ),
        retry_asset(
            "developer_rules",
            "개발자 역할 계약",
            Some(DEVELOPER_RULES_VERSION),
            &reason,
        ),
        retry_asset("agents_entry", "AGENTS 진입 안내", None, &reason),
        retry_asset("claude_entry", "CLAUDE 진입 안내", None, &reason),
        retry_asset(
            "claim_helper",
            "선점 헬퍼",
            Some(CLAIM_HELPER.version),
            &reason,
        ),
    ];
    sort_assets(&mut assets);
    ManagedAssetSyncResult {
        status: ManagedAssetSyncStatus::RetryRequired,
        assets,
        updated_assets: Vec::new(),
        reason: Some(reason),
        affected_asset: None,
        rollback_failures: Vec::new(),
        rollback_recoveries: Vec::new(),
    }
}

fn retry_asset(
    id: &str,
    label: &str,
    provided_version: Option<u32>,
    reason: &str,
) -> ManagedAssetState {
    ManagedAssetState {
        id: id.to_owned(),
        label: label.to_owned(),
        status: ManagedAssetStatus::RetryRequired,
        installed_version: None,
        provided_version,
        reason: Some(reason.to_owned()),
    }
}

fn sort_assets(assets: &mut [ManagedAssetState]) {
    const ORDER: [&str; 7] = [
        "workflow_rules",
        "planner_rules",
        "architect_rules",
        "developer_rules",
        "agents_entry",
        "claude_entry",
        "claim_helper",
    ];
    assets.sort_by_key(|asset| {
        ORDER
            .iter()
            .position(|id| *id == asset.id)
            .unwrap_or(ORDER.len())
    });
}

fn write_atomically(path: &Path, value: &str) -> Result<(), ManagedProjectAssetsError> {
    write_bytes_atomically(path, value.as_bytes())
}

fn write_bytes_atomically(path: &Path, value: &[u8]) -> Result<(), ManagedProjectAssetsError> {
    let parent = path
        .parent()
        .ok_or_else(|| ManagedProjectAssetsError::Write(path.display().to_string()))?;
    fs::create_dir_all(parent)
        .map_err(|error| ManagedProjectAssetsError::Write(error.to_string()))?;
    let mut temporary = NamedTempFile::new_in(parent)
        .map_err(|error| ManagedProjectAssetsError::Write(error.to_string()))?;
    temporary
        .write_all(value)
        .and_then(|_| temporary.as_file().sync_all())
        .map_err(|error| ManagedProjectAssetsError::Write(error.to_string()))?;
    temporary
        .persist(path)
        .map_err(|error| ManagedProjectAssetsError::Write(error.to_string()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::fs;
    use std::fs::OpenOptions;
    use std::io::{Seek, SeekFrom, Write};

    use tempfile::tempdir;

    use super::{
        append_rollback_context, finish_managed_project_asset_install,
        synchronize_managed_project_assets, synchronize_with_before_commit, synchronize_with_hooks,
        ManagedProjectAssetsError, RollbackOutcome,
    };
    use crate::domain::project::{
        ManagedAssetRollbackFailure, ManagedAssetRollbackRecovery, ManagedAssetStatus,
        ManagedAssetSyncStatus,
    };
    use crate::infrastructure::claim_helper::claim_helper_path;
    use crate::infrastructure::project_write_lock::ProjectWriteLock;

    fn roots() -> (tempfile::TempDir, std::path::PathBuf) {
        let root = tempdir().expect("root");
        let control = root.path().join(".workflow");
        (root, control)
    }

    #[test]
    fn command_errors_keep_every_rollback_failure_and_recovery_path() {
        let rollback = RollbackOutcome {
            failures: vec![ManagedAssetRollbackFailure {
                asset_id: "planner_rules".to_owned(),
                label: "기획자 역할 계약".to_owned(),
                reason: "조건부 복원 실패".to_owned(),
                recovery_path: Some("planner-recovery".to_owned()),
            }],
            recoveries: vec![ManagedAssetRollbackRecovery {
                asset_id: "workflow_rules".to_owned(),
                label: "공통 규칙".to_owned(),
                recovery_path: "workflow-recovery".to_owned(),
            }],
        };

        let error = append_rollback_context(
            ManagedProjectAssetsError::Read("후속 자산 읽기 실패".to_owned()),
            &rollback,
        );
        let message = error.to_string();

        assert!(message.contains("후속 자산 읽기 실패"));
        assert!(message.contains("조건부 복원 실패"));
        assert!(message.contains("planner-recovery"));
        assert!(message.contains("workflow-recovery"));
    }

    #[test]
    fn installs_all_current_platform_assets_and_reports_exact_versions() {
        let (root, control) = roots();
        let result = synchronize_managed_project_assets(root.path(), &control).expect("sync");

        assert_eq!(result.status, ManagedAssetSyncStatus::Updated);
        assert_eq!(result.assets.len(), 7);
        let versions = result
            .assets
            .iter()
            .filter_map(|asset| {
                Some((
                    asset.id.as_str(),
                    asset.installed_version?,
                    asset.provided_version?,
                ))
            })
            .collect::<Vec<_>>();
        assert_eq!(
            versions,
            vec![
                ("workflow_rules", 19, 19),
                ("planner_rules", 11, 11),
                ("architect_rules", 12, 12),
                ("developer_rules", 14, 14),
                ("claim_helper", 1, 1),
            ]
        );
        assert!(root.path().join("AGENTS.md").is_file());
        assert!(root.path().join("CLAUDE.md").is_file());
        assert!(claim_helper_path(&control).is_file());
    }

    #[test]
    fn every_role_uses_its_own_version_for_updates_and_future_conflicts() {
        for (id, relative_path, current) in [
            ("planner_rules", "rules/roles/planner.md", 11),
            ("architect_rules", "rules/roles/architect.md", 12),
            ("developer_rules", "rules/roles/developer.md", 14),
        ] {
            let (root, control) = roots();
            synchronize_managed_project_assets(root.path(), &control).expect("initial sync");
            let path = control.join(relative_path);
            let lower = fs::read_to_string(&path).expect("role").replace(
                &format!("rules_version: {current}"),
                &format!("rules_version: {}", current - 1),
            );
            fs::write(&path, lower).expect("lower role");

            let updated = synchronize_managed_project_assets(root.path(), &control)
                .expect("update lower role");
            let state = updated
                .assets
                .iter()
                .find(|asset| asset.id == id)
                .expect("updated role state");
            assert_eq!(updated.status, ManagedAssetSyncStatus::Updated, "{id}");
            assert_eq!(state.installed_version, Some(current), "{id}");
            assert_eq!(state.provided_version, Some(current), "{id}");

            let future = fs::read_to_string(&path).expect("role").replace(
                &format!("rules_version: {current}"),
                &format!("rules_version: {}", current + 1),
            );
            fs::write(&path, &future).expect("future role");
            let conflict = synchronize_managed_project_assets(root.path(), &control)
                .expect("future role conflict");
            let state = conflict
                .assets
                .iter()
                .find(|asset| asset.id == id)
                .expect("future role state");
            assert_eq!(conflict.status, ManagedAssetSyncStatus::Conflict, "{id}");
            assert_eq!(state.installed_version, Some(current + 1), "{id}");
            assert_eq!(state.provided_version, Some(current), "{id}");
            assert_eq!(fs::read_to_string(path).expect("future unchanged"), future);
        }
    }

    #[test]
    fn a_lower_claim_helper_version_is_updated_through_the_shared_plan() {
        let (root, control) = roots();
        synchronize_managed_project_assets(root.path(), &control).expect("initial sync");
        let helper = claim_helper_path(&control);
        let old = fs::read_to_string(&helper)
            .expect("helper")
            .replace("# claim_helper_version: 1", "# claim_helper_version: 0");
        fs::write(&helper, old).expect("old helper");

        let result = synchronize_managed_project_assets(root.path(), &control).expect("sync");
        let state = result
            .assets
            .iter()
            .find(|asset| asset.id == "claim_helper")
            .expect("helper state");

        assert_eq!(result.status, ManagedAssetSyncStatus::Updated);
        assert_eq!(state.installed_version, Some(1));
        assert!(fs::read_to_string(helper)
            .expect("updated helper")
            .contains("# claim_helper_version: 1"));
    }

    #[test]
    fn every_asset_conflict_is_found_before_any_other_asset_is_written() {
        for (id, relative_path) in [
            ("workflow_rules", ".workflow/rules/workflow.md"),
            ("planner_rules", ".workflow/rules/roles/planner.md"),
            ("architect_rules", ".workflow/rules/roles/architect.md"),
            ("developer_rules", ".workflow/rules/roles/developer.md"),
            ("agents_entry", "AGENTS.md"),
            ("claude_entry", "CLAUDE.md"),
            (
                "claim_helper",
                if cfg!(windows) {
                    ".workflow/rules/wf-claim.ps1"
                } else {
                    ".workflow/rules/wf-claim.sh"
                },
            ),
        ] {
            let (root, control) = roots();
            synchronize_managed_project_assets(root.path(), &control).expect("initial sync");
            let sentinel = if id == "workflow_rules" {
                control.join("rules/roles/developer.md")
            } else {
                control.join("rules/workflow.md")
            };
            let sentinel_current = fs::read_to_string(&sentinel).expect("sentinel");
            let sentinel_old = if id == "workflow_rules" {
                sentinel_current.replace("rules_version: 14", "rules_version: 13")
            } else {
                sentinel_current.replace("rules_version: 19", "rules_version: 18")
            };
            fs::write(&sentinel, &sentinel_old).expect("old sentinel");
            let target = root.path().join(relative_path);
            let damaged = match id {
                "workflow_rules" | "planner_rules" | "architect_rules" | "developer_rules" => {
                    fs::read_to_string(&target)
                        .expect("rules target")
                        .replace("schema: workflow-labs/", "schema: damaged/")
                }
                "agents_entry" | "claude_entry" => fs::read_to_string(&target)
                    .expect("entry target")
                    .replace("<!-- workflow-labs:project-instructions:end -->", ""),
                "claim_helper" => "user managed script\n".to_owned(),
                _ => unreachable!("the asset table is closed"),
            };
            fs::write(&target, &damaged).expect("damaged target");

            let result = synchronize_managed_project_assets(root.path(), &control)
                .expect("structured conflict");

            assert_eq!(result.status, ManagedAssetSyncStatus::Conflict, "{id}");
            assert_eq!(
                fs::read_to_string(&sentinel).expect("sentinel unchanged"),
                sentinel_old,
                "{id}"
            );
            assert_eq!(
                fs::read_to_string(target).expect("target unchanged"),
                damaged,
                "{id}"
            );
            assert!(result
                .assets
                .iter()
                .any(|asset| asset.id == id && asset.status == ManagedAssetStatus::Conflict));
        }
    }

    #[test]
    fn an_identical_second_sync_is_current_and_does_not_rewrite_files() {
        let (root, control) = roots();
        synchronize_managed_project_assets(root.path(), &control).expect("first sync");
        let rules = control.join("rules/workflow.md");
        let before = fs::metadata(&rules)
            .expect("rules metadata")
            .modified()
            .expect("mtime");

        let result =
            synchronize_managed_project_assets(root.path(), &control).expect("second sync");
        let after = fs::metadata(&rules)
            .expect("rules metadata")
            .modified()
            .expect("mtime");

        assert_eq!(result.status, ManagedAssetSyncStatus::Current);
        assert!(result.updated_assets.is_empty());
        assert_eq!(before, after);
    }

    #[test]
    fn a_future_architect_contract_is_a_conflict_and_nothing_is_written() {
        let (root, control) = roots();
        synchronize_managed_project_assets(root.path(), &control).expect("initial sync");
        let rules = control.join("rules/workflow.md");
        let old_rules = fs::read_to_string(&rules)
            .expect("rules")
            .replace("rules_version: 19", "rules_version: 18");
        fs::write(&rules, &old_rules).expect("old rules");
        let architect = control.join("rules/roles/architect.md");
        let future = fs::read_to_string(&architect)
            .expect("architect")
            .replace("rules_version: 12", "rules_version: 13");
        fs::write(&architect, &future).expect("future architect");

        let result =
            synchronize_managed_project_assets(root.path(), &control).expect("conflict result");

        assert_eq!(result.status, ManagedAssetSyncStatus::Conflict);
        assert_eq!(
            fs::read_to_string(rules).expect("rules unchanged"),
            old_rules
        );
        let state = result
            .assets
            .iter()
            .find(|asset| asset.id == "architect_rules")
            .expect("architect state");
        assert_eq!(state.status, ManagedAssetStatus::Conflict);
        assert_eq!(state.installed_version, Some(13));
        assert_eq!(state.provided_version, Some(12));
    }

    #[test]
    fn a_claim_helper_conflict_prevents_earlier_rule_updates() {
        let (root, control) = roots();
        synchronize_managed_project_assets(root.path(), &control).expect("initial sync");
        let rules = control.join("rules/workflow.md");
        let old_rules = fs::read_to_string(&rules)
            .expect("rules")
            .replace("rules_version: 19", "rules_version: 18");
        fs::write(&rules, &old_rules).expect("old rules");
        fs::write(claim_helper_path(&control), "user script\n").expect("unmanaged helper");

        let result =
            synchronize_managed_project_assets(root.path(), &control).expect("conflict result");

        assert_eq!(result.status, ManagedAssetSyncStatus::Conflict);
        assert_eq!(
            fs::read_to_string(rules).expect("rules unchanged"),
            old_rules
        );
        assert!(result.assets.iter().any(
            |asset| asset.id == "claim_helper" && asset.status == ManagedAssetStatus::Conflict
        ));
    }

    #[test]
    fn an_external_change_after_preflight_prevents_every_planned_write() {
        let (root, control) = roots();
        synchronize_managed_project_assets(root.path(), &control).expect("initial sync");
        let rules = control.join("rules/workflow.md");
        let planner = control.join("rules/roles/planner.md");
        let old_rules = fs::read_to_string(&rules)
            .expect("rules")
            .replace("rules_version: 19", "rules_version: 18");
        let old_planner = fs::read_to_string(&planner)
            .expect("planner")
            .replace("rules_version: 11", "rules_version: 10");
        fs::write(&rules, &old_rules).expect("old rules");
        fs::write(&planner, &old_planner).expect("old planner");

        let result = synchronize_with_before_commit(root.path(), &control, || {
            fs::write(&planner, format!("{old_planner}\nexternal change\n"))
                .expect("external change");
        })
        .expect("conflict result");

        assert_eq!(result.status, ManagedAssetSyncStatus::Conflict);
        assert_eq!(
            fs::read_to_string(&rules).expect("rules unchanged"),
            old_rules
        );
        assert!(fs::read_to_string(planner)
            .expect("external value")
            .contains("external change"));
    }

    #[test]
    fn a_later_change_during_sequential_replacement_restores_earlier_assets() {
        let (root, control) = roots();
        synchronize_managed_project_assets(root.path(), &control).expect("initial sync");
        let rules = control.join("rules/workflow.md");
        let planner = control.join("rules/roles/planner.md");
        let old_rules = fs::read_to_string(&rules)
            .expect("rules")
            .replace("rules_version: 19", "rules_version: 18");
        let old_planner = fs::read_to_string(&planner)
            .expect("planner")
            .replace("rules_version: 11", "rules_version: 10");
        fs::write(&rules, &old_rules).expect("old rules");
        fs::write(&planner, &old_planner).expect("old planner");

        let result = synchronize_with_hooks(
            root.path(),
            &control,
            || {},
            |replaced, _| {
                if replaced == 1 {
                    fs::write(&planner, format!("{old_planner}\nexternal change\n"))
                        .expect("external change during commit");
                }
            },
            |_, _, _| {},
        )
        .expect("structured conflict");

        assert_eq!(result.status, ManagedAssetSyncStatus::Conflict);
        assert!(result.updated_assets.is_empty());
        assert_eq!(
            fs::read_to_string(&rules).expect("earlier rules restored"),
            old_rules
        );
        assert_eq!(
            fs::read_to_string(&planner).expect("external planner kept"),
            format!("{old_planner}\nexternal change\n")
        );
    }

    #[test]
    fn an_open_handle_write_after_isolation_is_kept_at_the_reported_recovery_path() {
        let (root, control) = roots();
        synchronize_managed_project_assets(root.path(), &control).expect("initial sync");
        let rules = control.join("rules/workflow.md");
        let planner = control.join("rules/roles/planner.md");
        let old_rules = fs::read_to_string(&rules)
            .expect("rules")
            .replace("rules_version: 19", "rules_version: 18");
        let old_planner = fs::read_to_string(&planner)
            .expect("planner")
            .replace("rules_version: 11", "rules_version: 10");
        fs::write(&rules, &old_rules).expect("old rules");
        fs::write(&planner, &old_planner).expect("old planner");
        let open_rules = RefCell::new(None);
        let external_after_isolation = b"external bytes through an open handle\n";

        let result = synchronize_with_hooks(
            root.path(),
            &control,
            || {},
            |replaced, _| {
                if replaced == 1 {
                    *open_rules.borrow_mut() = Some(
                        OpenOptions::new()
                            .write(true)
                            .open(&rules)
                            .expect("open replacement before isolation"),
                    );
                    fs::write(&planner, format!("{old_planner}\nexternal conflict\n"))
                        .expect("later conflict");
                }
            },
            |id, _, _| {
                if id == "workflow_rules" {
                    let mut borrowed = open_rules.borrow_mut();
                    let handle = borrowed.as_mut().expect("open replacement handle");
                    handle.set_len(0).expect("truncate isolated inode");
                    handle
                        .seek(SeekFrom::Start(0))
                        .and_then(|_| handle.write_all(external_after_isolation))
                        .and_then(|_| handle.sync_all())
                        .expect("write isolated inode");
                }
            },
        )
        .expect("structured conflict");

        assert_eq!(result.status, ManagedAssetSyncStatus::Conflict);
        assert_eq!(result.affected_asset.as_deref(), Some("planner_rules"));
        assert!(result.rollback_failures.is_empty());
        assert_eq!(
            fs::read_to_string(&rules).expect("rules restored"),
            old_rules
        );
        let recovery = result
            .rollback_recoveries
            .iter()
            .find(|recovery| recovery.asset_id == "workflow_rules")
            .expect("workflow recovery path");
        assert_eq!(
            fs::read(std::path::Path::new(&recovery.recovery_path).join("isolated"))
                .expect("isolated bytes preserved"),
            external_after_isolation
        );
        let recovery_path = recovery.recovery_path.clone();
        let legacy_error = finish_managed_project_asset_install(result)
            .expect_err("legacy install path must keep the conflict");
        assert!(legacy_error.to_string().contains(&recovery_path));
    }

    #[test]
    fn a_file_created_after_isolation_is_not_deleted_when_the_original_was_missing() {
        let (root, control) = roots();
        let rules = control.join("rules/workflow.md");
        let planner = control.join("rules/roles/planner.md");
        let external_rules = "external file created after isolation\n";
        fs::create_dir_all(planner.parent().expect("planner parent")).expect("roles directory");

        let result = synchronize_with_hooks(
            root.path(),
            &control,
            || {},
            |replaced, _| {
                if replaced == 1 {
                    fs::write(&planner, "external planner conflict\n").expect("later conflict");
                }
            },
            |id, target, _| {
                if id == "workflow_rules" {
                    fs::write(target, external_rules).expect("external target after isolation");
                }
            },
        )
        .expect("structured conflict");

        assert_eq!(result.status, ManagedAssetSyncStatus::Conflict);
        assert_eq!(result.affected_asset.as_deref(), Some("planner_rules"));
        assert_eq!(
            fs::read_to_string(&rules).expect("external target kept"),
            external_rules
        );
        assert_eq!(result.rollback_failures.len(), 1);
        assert_eq!(result.rollback_failures[0].asset_id, "workflow_rules");
        assert!(result.rollback_failures[0]
            .reason
            .contains("삭제하지 않았습니다"));
    }

    #[test]
    fn rollback_continues_after_multiple_failures_and_keeps_the_original_conflict() {
        let (root, control) = roots();
        synchronize_managed_project_assets(root.path(), &control).expect("initial sync");
        let rules = control.join("rules/workflow.md");
        let planner = control.join("rules/roles/planner.md");
        let architect = control.join("rules/roles/architect.md");
        let developer = control.join("rules/roles/developer.md");
        let old_rules = fs::read_to_string(&rules)
            .expect("rules")
            .replace("rules_version: 19", "rules_version: 18");
        let old_planner = fs::read_to_string(&planner)
            .expect("planner")
            .replace("rules_version: 11", "rules_version: 10");
        let old_architect = fs::read_to_string(&architect)
            .expect("architect")
            .replace("rules_version: 12", "rules_version: 11");
        let old_developer = fs::read_to_string(&developer)
            .expect("developer")
            .replace("rules_version: 14", "rules_version: 13");
        fs::write(&rules, &old_rules).expect("old rules");
        fs::write(&planner, &old_planner).expect("old planner");
        fs::write(&architect, &old_architect).expect("old architect");
        fs::write(&developer, &old_developer).expect("old developer");

        let result = synchronize_with_hooks(
            root.path(),
            &control,
            || {},
            |replaced, _| {
                if replaced == 3 {
                    fs::write(&developer, format!("{old_developer}\noriginal conflict\n"))
                        .expect("later conflict");
                }
            },
            |id, target, _| match id {
                "architect_rules" => {
                    fs::write(target, "external architect\n").expect("architect after isolation")
                }
                "planner_rules" => {
                    fs::write(target, "external planner\n").expect("planner after isolation")
                }
                _ => {}
            },
        )
        .expect("structured conflict with rollback failures");

        assert_eq!(result.status, ManagedAssetSyncStatus::Conflict);
        assert_eq!(result.affected_asset.as_deref(), Some("developer_rules"));
        assert!(result.reason.as_deref().is_some_and(|reason| reason
            .contains("개발자 역할 계약 파일이 저장 직전에 변경")
            && reason.contains("복원 실패")));
        assert_eq!(
            result
                .rollback_failures
                .iter()
                .map(|failure| failure.asset_id.as_str())
                .collect::<Vec<_>>(),
            vec!["architect_rules", "planner_rules"]
        );
        assert_eq!(
            fs::read_to_string(&rules).expect("rules restored"),
            old_rules
        );
        assert_eq!(
            fs::read_to_string(&architect).expect("external architect kept"),
            "external architect\n"
        );
        assert_eq!(
            fs::read_to_string(&planner).expect("external planner kept"),
            "external planner\n"
        );
        assert!(fs::read_to_string(&developer)
            .expect("original conflict kept")
            .contains("original conflict"));
        for (id, original) in [
            ("architect_rules", old_architect.as_bytes()),
            ("planner_rules", old_planner.as_bytes()),
        ] {
            let recovery = result
                .rollback_recoveries
                .iter()
                .find(|recovery| recovery.asset_id == id)
                .expect("failed asset recovery directory");
            assert!(fs::read_dir(&recovery.recovery_path)
                .expect("recovery directory")
                .filter_map(Result::ok)
                .any(|entry| fs::read(entry.path()).is_ok_and(|bytes| bytes == original)));
        }
    }

    #[test]
    fn non_utf8_bytes_are_a_structured_conflict_for_every_managed_asset() {
        for (id, relative_path) in [
            ("workflow_rules", ".workflow/rules/workflow.md"),
            ("planner_rules", ".workflow/rules/roles/planner.md"),
            ("architect_rules", ".workflow/rules/roles/architect.md"),
            ("developer_rules", ".workflow/rules/roles/developer.md"),
            ("agents_entry", "AGENTS.md"),
            ("claude_entry", "CLAUDE.md"),
            (
                "claim_helper",
                if cfg!(windows) {
                    ".workflow/rules/wf-claim.ps1"
                } else {
                    ".workflow/rules/wf-claim.sh"
                },
            ),
        ] {
            let (root, control) = roots();
            synchronize_managed_project_assets(root.path(), &control).expect("initial sync");
            let target = root.path().join(relative_path);
            let damaged = [0xff, 0xfe, 0xfd];
            fs::write(&target, damaged).expect("non UTF-8 target");

            let result = synchronize_managed_project_assets(root.path(), &control)
                .expect("non UTF-8 must be a result, not a command error");

            assert_eq!(result.status, ManagedAssetSyncStatus::Conflict, "{id}");
            assert_eq!(result.affected_asset.as_deref(), Some(id), "{id}");
            let state = result
                .assets
                .iter()
                .find(|asset| asset.id == id)
                .expect("damaged asset state");
            assert_eq!(state.status, ManagedAssetStatus::Conflict, "{id}");
            assert!(
                state
                    .reason
                    .as_deref()
                    .is_some_and(|reason| reason.contains("UTF-8")),
                "{id}"
            );
            assert_eq!(
                fs::read(target).expect("damaged bytes kept"),
                damaged,
                "{id}"
            );
        }
    }

    #[test]
    fn an_existing_project_write_lock_returns_retry_required() {
        let (root, control) = roots();
        let _lock = ProjectWriteLock::acquire(&control).expect("lock");

        let result =
            synchronize_managed_project_assets(root.path(), &control).expect("retry result");

        assert_eq!(result.status, ManagedAssetSyncStatus::RetryRequired);
        assert_eq!(result.assets.len(), 7);
        assert!(result
            .assets
            .iter()
            .all(|asset| asset.status == ManagedAssetStatus::RetryRequired));
    }

    #[test]
    fn the_other_platform_helper_is_not_read_or_modified() {
        let (root, control) = roots();
        fs::create_dir_all(control.join("rules")).expect("rules");
        #[cfg(not(windows))]
        let other = control.join("rules/wf-claim.ps1");
        #[cfg(windows)]
        let other = control.join("rules/wf-claim.sh");
        fs::write(&other, "foreign helper").expect("other helper");

        synchronize_managed_project_assets(root.path(), &control).expect("sync");

        assert_eq!(
            fs::read_to_string(other).expect("other helper"),
            "foreign helper"
        );
    }
}
