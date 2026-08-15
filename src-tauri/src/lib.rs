mod application;
mod commands;
mod domain;
mod infrastructure;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(commands::projects::ProjectWatchers::default())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            commands::projects::inspect_project,
            commands::projects::watch_project,
            commands::projects::unwatch_project,
            commands::projects::synchronize_managed_project_assets,
            commands::projects::read_custom_rules,
            commands::projects::prepare_custom_rules_preview,
            commands::projects::save_custom_rules,
            commands::projects::create_workflow,
            commands::projects::create_idea,
            commands::projects::read_spec,
            commands::projects::read_task,
            commands::projects::read_idea,
            commands::projects::list_run_reports,
            commands::projects::read_report,
            commands::projects::record_spec_decision,
            commands::projects::submit_work_group_qa,
            commands::projects::resume_task,
            commands::projects::record_task_revision_request,
            commands::projects::migrate_project,
            commands::heartbeat::inspect_integrations,
            commands::heartbeat::install_heartbeat_jobs,
            commands::heartbeat::run_heartbeat_job,
            commands::heartbeat::run_heartbeat_setup_step,
            commands::heartbeat::control_heartbeat_service,
            commands::heartbeat::update_heartbeat,
            commands::heartbeat::check_heartbeat_versions,
            commands::agent_runtime::inspect_agent_runtime,
            commands::agent_runtime::plan_agent_runtime_install,
            commands::agent_runtime::apply_agent_runtime_install,
            commands::agent_runtime::plan_agent_runtime_update,
            commands::agent_runtime::apply_agent_runtime_update,
            commands::agent_runtime::check_agent_runtime_release,
            commands::agent_runtime::plan_agent_runtime_download,
            commands::agent_runtime::apply_agent_runtime_download,
            commands::agent_runtime::repair_agent_runtime,
            commands::agent_runtime::read_agent_runtime_policy,
            commands::agent_runtime::save_agent_runtime_policy,
            commands::agent_runtime::grant_agent_runtime_consent,
            commands::agent_runtime::revoke_agent_runtime_consent,
            commands::agent_runtime::preview_agent_runtime_migration,
            commands::agent_runtime::apply_agent_runtime_migration,
            commands::agent_runtime::plan_agent_run,
            commands::agent_runtime::start_agent_run,
            commands::agent_runtime::cancel_agent_run,
            commands::agent_runtime::retry_agent_run,
            commands::agent_runtime::inspect_agent_runs,
            commands::agent_runtime::pause_agent_project,
            commands::agent_runtime::resume_agent_project,
            commands::agent_runtime::read_agent_run_log,
            commands::agent_runtime::export_agent_run_diagnostics,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    /// 커맨드는 등록 목록에 있어야만 화면이 부를 수 있다. 목록은 매크로 인자여서 실행 중에 셀 수
    /// 없으므로 등록 원문에서 그 구간을 잘라 확인한다.
    #[test]
    fn the_consent_commands_are_registered_where_the_screen_can_call_them() {
        let source = include_str!("lib.rs");
        let registered = source
            .split_once("generate_handler![")
            .and_then(|(_, rest)| rest.split_once("])"))
            .map(|(list, _)| list)
            .expect("등록 목록");

        assert!(registered.contains("commands::agent_runtime::grant_agent_runtime_consent"));
        assert!(registered.contains("commands::agent_runtime::revoke_agent_runtime_consent"));
        assert!(registered.contains("commands::agent_runtime::check_agent_runtime_release"));
        assert!(registered.contains("commands::agent_runtime::plan_agent_runtime_download"));
        assert!(registered.contains("commands::agent_runtime::apply_agent_runtime_download"));
        assert!(registered.contains("commands::projects::submit_work_group_qa"));
        assert!(!registered.contains("commands::projects::record_task_qa"));
        assert!(!registered.contains("commands::projects::confirm_task_qa_batch"));
        assert!(!registered.contains("commands::projects::submit_task_qa"));
    }
}
