use crate::config;
use crate::error::AppResult;
use crate::utils::crypto;

#[tauri::command]
pub fn get_system_fonts() -> Vec<String> {
    use font_kit::source::SystemSource;
    if let Ok(mut families) = SystemSource::new().all_families() {
        families.sort();
        families.dedup();
        return families;
    }
    Vec::new()
}

#[tauri::command]
pub fn get_app_settings(app: tauri::AppHandle) -> AppResult<config::AppSettings> {
    let mut settings = config::load_app_settings(&app)?;
    if settings.security.master_password.is_some() {
        settings.security.master_password = Some("__SET__".to_string());
    }
    Ok(settings)
}

#[tauri::command]
pub fn save_app_settings(
    app: tauri::AppHandle,
    mut settings: config::AppSettings,
) -> AppResult<()> {
    let existing = config::load_app_settings(&app)?;

    match settings.security.master_password.as_deref() {
        Some("__SET__") => {
            settings.security.master_password = existing.security.master_password;
        }
        Some("") | None => {
            if existing.security.master_password.is_some() {
                let old_plain = crypto::decrypt_settings_secret(
                    existing.security.master_password.as_deref().unwrap(),
                )?;
                crypto::rewrap_master_key(Some(&old_plain), None)?;
                crypto::set_master_password(None);
            }
            settings.security.master_password = None;
        }
        Some(plain) => {
            let old_plain = existing
                .security
                .master_password
                .as_deref()
                .and_then(|ct| crypto::decrypt_settings_secret(ct).ok());

            crypto::rewrap_master_key(old_plain.as_deref(), Some(plain))?;
            crypto::set_master_password(Some(plain.to_string()));

            settings.security.master_password = Some(crypto::encrypt_settings_secret(plain)?);
        }
    }
    config::save_app_settings(&app, &settings)
}

#[tauri::command]
pub fn verify_master_password(app: tauri::AppHandle, password: String) -> AppResult<bool> {
    let settings = config::load_app_settings(&app)?;
    match settings.security.master_password {
        Some(ref ct) => {
            let stored = crypto::decrypt_settings_secret(ct)?;
            Ok(stored == password)
        }
        None => Ok(true),
    }
}
