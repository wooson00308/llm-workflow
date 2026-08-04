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
            commands::projects::create_workflow,
            commands::projects::create_idea,
            commands::projects::read_spec,
            commands::projects::read_task,
            commands::projects::read_idea,
            commands::projects::record_spec_decision,
            commands::projects::record_task_qa,
            commands::projects::migrate_project,
            commands::heartbeat::inspect_integrations,
            commands::heartbeat::install_heartbeat_jobs,
            commands::heartbeat::install_dream_job,
            commands::heartbeat::run_heartbeat_job,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
