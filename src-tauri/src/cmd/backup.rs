use crate::error::AppResult;

#[tauri::command]
pub fn export_config(app: tauri::AppHandle, output_path: String) -> AppResult<()> {
    crate::core::backup::export_config(&app, &output_path)
}

#[tauri::command]
pub fn import_config(app: tauri::AppHandle, file_path: String) -> AppResult<()> {
    crate::core::backup::import_config(&app, &file_path)
}
