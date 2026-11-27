#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod advice;
mod allocation;
mod catalog;
mod cleanup;
mod commands;
mod copies;
mod model;
mod report;
mod scan;

fn main() {
    tauri::Builder::default()
        .manage(commands::Session::default())
        .invoke_handler(tauri::generate_handler![
            commands::initial_folder,
            commands::choose_folder,
            commands::analyze,
            commands::folder_page,
            commands::map_page,
            commands::check_candidates,
            commands::estimate_reclaim,
            commands::cancel_estimate,
            commands::recycle_items,
            commands::open_recycle_bin,
            commands::locations,
            commands::volumes,
            commands::old_folders,
            commands::find_files,
            commands::find_reviews,
            commands::selection_range,
            commands::find_copies,
            commands::cancel_copies,
            commands::directory_sample,
            commands::explain_directory,
            commands::cancel_scan,
            commands::open_folder,
            commands::export_report,
        ])
        .run(tauri::generate_context!())
        .expect("无法启动塔姆");
}
