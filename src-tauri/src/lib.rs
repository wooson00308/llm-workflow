mod application;
mod commands;
mod domain;
mod infrastructure;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            commands::projects::inspect_project,
            commands::projects::synchronize_managed_project_assets,
            commands::projects::read_custom_rules,
            commands::projects::prepare_custom_rules_preview,
            commands::projects::save_custom_rules,
            commands::projects::create_workflow,
            commands::projects::create_idea,
            commands::projects::read_spec,
            commands::projects::read_task,
            commands::projects::read_idea,
            commands::projects::record_spec_decision,
            commands::projects::record_task_qa,
            commands::projects::confirm_task_qa_batch,
            commands::projects::resume_task,
            commands::projects::record_task_revision_request,
            commands::projects::migrate_project,
            commands::heartbeat::inspect_integrations,
            commands::heartbeat::install_heartbeat_jobs,
            commands::heartbeat::install_dream_job,
            commands::heartbeat::run_heartbeat_job,
            commands::heartbeat::run_heartbeat_setup_step,
            commands::heartbeat::control_heartbeat_service,
            commands::heartbeat::update_heartbeat,
            commands::heartbeat::check_heartbeat_versions,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
