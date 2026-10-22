//! SpaceMouse reader for the desktop build. The macOS and Linux web views have no WebHID, so the device is read
//! here with hidapi and each raw input report (report id first) goes to the page as a "spacemouse-report" event.
//! The page parses the reports (src/spacemouse.ts), the same as it does for WebHID in a browser.

use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

use hidapi::{DeviceInfo, HidApi};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

const VENDOR_3DCONNEXION: u16 = 0x256f;
const VENDOR_LOGITECH: u16 = 0x046d;
/// Logitech product ids of 3Dconnexion devices (SpaceMouse Plus to SpaceMouse Pro).
const LOGITECH_3DX: &[u16] = &[
    0xc603, 0xc605, 0xc606, 0xc621, 0xc623, 0xc625, 0xc626, 0xc627, 0xc628, 0xc629, 0xc62b,
];

static STARTED: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Serialize)]
struct Status {
    connected: bool,
    name: String,
    error: Option<String>,
}

fn is_spacemouse(d: &DeviceInfo) -> bool {
    d.vendor_id() == VENDOR_3DCONNEXION
        || (d.vendor_id() == VENDOR_LOGITECH && LOGITECH_3DX.contains(&d.product_id()))
}

/// The multi-axis controller collection (usage page 1, usage 8) when the platform reports usages,
/// otherwise the first matching interface.
fn pick(api: &HidApi) -> Option<DeviceInfo> {
    let all: Vec<&DeviceInfo> = api.device_list().filter(|d| is_spacemouse(d)).collect();
    all.iter()
        .find(|d| d.usage_page() == 1 && d.usage() == 8)
        .or_else(|| all.first())
        .map(|d| (*d).clone())
}

fn status(app: &AppHandle, connected: bool, name: &str, error: Option<String>) {
    let _ = app.emit("spacemouse-status", Status { connected, name: name.to_string(), error });
}

fn run(app: AppHandle) {
    let mut api = match HidApi::new() {
        Ok(a) => a,
        Err(e) => {
            status(&app, false, "", Some(format!("HID access failed: {e}")));
            return;
        }
    };
    // Share the device with 3Dconnexion's own driver instead of taking it over.
    #[cfg(target_os = "macos")]
    api.set_open_exclusive(false);
    let mut last_error: Option<String> = None;
    loop {
        let _ = api.refresh_devices();
        if let Some(info) = pick(&api) {
            let name = info.product_string().unwrap_or("SpaceMouse").to_string();
            match info.open_device(&api) {
                Ok(dev) => {
                    last_error = None;
                    status(&app, true, &name, None);
                    let mut buf = [0u8; 64];
                    loop {
                        match dev.read_timeout(&mut buf, 500) {
                            Ok(0) => continue,
                            Ok(n) => {
                                let _ = app.emit("spacemouse-report", buf[..n].to_vec());
                            }
                            Err(_) => break, // unplugged
                        }
                    }
                    status(&app, false, "", None);
                }
                Err(e) => {
                    let msg = if cfg!(target_os = "linux") {
                        format!("{name} found but could not be opened ({e}). Install the udev rule that comes with Claudus, or run: sudo cp 70-claudus-spacemouse.rules /etc/udev/rules.d/ and replug the device.")
                    } else {
                        format!("{name} found but could not be opened: {e}")
                    };
                    if last_error.as_deref() != Some(msg.as_str()) {
                        status(&app, false, "", Some(msg.clone()));
                        last_error = Some(msg);
                    }
                }
            }
        }
        thread::sleep(Duration::from_secs(2));
    }
}

/// Start the reader thread once; later calls just resend nothing (the page keeps the last status).
#[tauri::command]
pub fn spacemouse_start(app: AppHandle) {
    if STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    thread::spawn(move || run(app));
}
