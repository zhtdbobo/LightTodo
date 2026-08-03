#[cfg(windows)]
mod platform {
    use std::ptr::null_mut;
    use windows::core::{HRESULT, PWSTR};
    use windows::Win32::Security::Credentials::{
        CredDeleteW, CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE,
        CRED_TYPE_GENERIC,
    };

    const ERROR_NOT_FOUND: u32 = 1168;
    // Credential Manager blobs are only used for a WebDAV password or a
    // 32-byte vault key.  Bound reads so a corrupted/local hostile entry
    // cannot make the app allocate an arbitrary amount of memory.
    const MAX_CREDENTIAL_BYTES: usize = 1_048_576;

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    struct CredentialGuard(*mut CREDENTIALW);

    impl Drop for CredentialGuard {
        fn drop(&mut self) {
            if !self.0.is_null() {
                // SAFETY: CredReadW allocated this pointer and transfers
                // ownership to the caller, which must release it with CredFree.
                unsafe { CredFree(self.0.cast()) };
            }
        }
    }

    pub fn read(target: &str) -> Result<Option<Vec<u8>>, String> {
        let target = wide(target);
        let mut raw: *mut CREDENTIALW = null_mut();
        // SAFETY: target is NUL-terminated and raw points to writable storage
        // for the API-owned credential pointer.
        if let Err(error) = unsafe {
            CredReadW(
                windows::core::PCWSTR(target.as_ptr()),
                CRED_TYPE_GENERIC,
                None,
                &mut raw,
            )
        } {
            if error.code() == HRESULT::from_win32(ERROR_NOT_FOUND) {
                return Ok(None);
            }
            return Err(format!("Failed to read Windows credential: {error}"));
        }
        let guard = CredentialGuard(raw);
        if guard.0.is_null() {
            return Ok(None);
        }
        // SAFETY: the credential remains alive through guard and the blob has
        // exactly CredentialBlobSize bytes according to the Windows API.
        let value = unsafe {
            let credential = &*guard.0;
            if credential.CredentialBlobSize as usize > MAX_CREDENTIAL_BYTES {
                return Err("Stored credential is too large".to_string());
            }
            if credential.CredentialBlob.is_null() || credential.CredentialBlobSize == 0 {
                Vec::new()
            } else {
                std::slice::from_raw_parts(
                    credential.CredentialBlob,
                    credential.CredentialBlobSize as usize,
                )
                .to_vec()
            }
        };
        Ok(Some(value))
    }

    pub fn write(target: &str, username: &str, secret: &[u8]) -> Result<(), String> {
        if secret.len() > u32::MAX as usize {
            return Err("Credential is too large".to_string());
        }
        let mut target = wide(target);
        let mut username = wide(username);
        let mut blob = secret.to_vec();
        let credential = CREDENTIALW {
            Type: CRED_TYPE_GENERIC,
            TargetName: PWSTR(target.as_mut_ptr()),
            CredentialBlobSize: blob.len() as u32,
            CredentialBlob: blob.as_mut_ptr(),
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            UserName: PWSTR(username.as_mut_ptr()),
            ..Default::default()
        };
        // SAFETY: all pointers refer to live buffers for the duration of the
        // call; CredWriteW copies the supplied data.
        let result = unsafe { CredWriteW(&credential, 0) }
            .map_err(|error| format!("Failed to write Windows credential: {error}"));
        blob.fill(0);
        result
    }

    pub fn delete(target: &str) -> Result<(), String> {
        let target = wide(target);
        // SAFETY: target is a valid NUL-terminated UTF-16 string.
        match unsafe {
            CredDeleteW(
                windows::core::PCWSTR(target.as_ptr()),
                CRED_TYPE_GENERIC,
                None,
            )
        } {
            Ok(()) => Ok(()),
            Err(error) if error.code() == HRESULT::from_win32(ERROR_NOT_FOUND) => Ok(()),
            Err(error) => Err(format!("Failed to delete Windows credential: {error}")),
        }
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use security_framework::passwords::{
        delete_generic_password, get_generic_password, set_generic_password,
    };

    const KEYCHAIN_SERVICE: &str = "com.lighttodo.desktop";
    const ERR_SEC_ITEM_NOT_FOUND: i32 = -25300;

    pub fn read(target: &str) -> Result<Option<Vec<u8>>, String> {
        match get_generic_password(KEYCHAIN_SERVICE, target) {
            Ok(value) => Ok(Some(value)),
            Err(error) if error.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(None),
            Err(error) => Err(format!("Failed to read macOS Keychain item: {error}")),
        }
    }

    pub fn write(target: &str, _username: &str, secret: &[u8]) -> Result<(), String> {
        set_generic_password(KEYCHAIN_SERVICE, target, secret)
            .map_err(|error| format!("Failed to write macOS Keychain item: {error}"))
    }

    pub fn delete(target: &str) -> Result<(), String> {
        match delete_generic_password(KEYCHAIN_SERVICE, target) {
            Ok(()) => Ok(()),
            Err(error) if error.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(()),
            Err(error) => Err(format!("Failed to delete macOS Keychain item: {error}")),
        }
    }
}

#[cfg(target_os = "android")]
mod platform {
    pub fn read(target: &str) -> Result<Option<Vec<u8>>, String> {
        crate::mobile_secure_storage::read(target)
    }

    pub fn write(target: &str, _username: &str, secret: &[u8]) -> Result<(), String> {
        crate::mobile_secure_storage::write(target, secret)
    }

    pub fn delete(target: &str) -> Result<(), String> {
        crate::mobile_secure_storage::delete(target)
    }
}

#[cfg(not(any(windows, target_os = "macos", target_os = "android")))]
mod platform {
    pub fn read(_target: &str) -> Result<Option<Vec<u8>>, String> {
        Err("Secure credential storage is not available on this platform".to_string())
    }

    pub fn write(_target: &str, _username: &str, _secret: &[u8]) -> Result<(), String> {
        Err("Secure credential storage is not available on this platform".to_string())
    }

    pub fn delete(_target: &str) -> Result<(), String> {
        Err("Secure credential storage is not available on this platform".to_string())
    }
}

pub use platform::{delete, read, write};
