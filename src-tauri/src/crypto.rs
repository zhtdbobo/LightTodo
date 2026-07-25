use crate::credential_store;
use crate::database::Database;
use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine as _};
use ring::{
    aead, pbkdf2,
    rand::{SecureRandom, SystemRandom},
};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::num::NonZeroU32;

pub const PASSWORD_NOTE_MARKER: &str = "password";
pub const PASSWORD_DECRYPTION_ERROR_TITLE: &str = "⚠ 无法解密此密码待办";
const ENCRYPTED_PREFIX: &str = "ltenc:v1:";
const VAULT_CREDENTIAL_TARGET: &str = "LightTodo/VaultKey";
const VAULT_KEY_BYTES: usize = 32;
const NONCE_BYTES: usize = 12;
const GCM_TAG_BYTES: usize = 16;
const PBKDF2_ITERATIONS: u32 = 210_000;
const ENVELOPE_AAD: &[u8] = b"LightTodo/vault-envelope/v1";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VaultEnvelope {
    pub version: u32,
    pub key_id: String,
    pub salt: String,
    pub nonce: String,
    pub wrapped_key: String,
}

fn random_bytes<const N: usize>() -> Result<[u8; N], String> {
    let mut bytes = [0u8; N];
    SystemRandom::new()
        .fill(&mut bytes)
        .map_err(|_| "Secure random generation failed".to_string())?;
    Ok(bytes)
}

fn key_id(key: &[u8; VAULT_KEY_BYTES]) -> String {
    format!("{:x}", Sha256::digest(key))
}

fn aead_key(bytes: &[u8; VAULT_KEY_BYTES]) -> Result<aead::LessSafeKey, String> {
    let key = aead::UnboundKey::new(&aead::AES_256_GCM, bytes)
        .map_err(|_| "Invalid AES key".to_string())?;
    Ok(aead::LessSafeKey::new(key))
}

fn encrypt_bytes(
    key: &[u8; VAULT_KEY_BYTES],
    plaintext: &[u8],
    aad: &[u8],
) -> Result<([u8; NONCE_BYTES], Vec<u8>), String> {
    let nonce_bytes = random_bytes::<NONCE_BYTES>()?;
    let nonce = aead::Nonce::assume_unique_for_key(nonce_bytes);
    let mut ciphertext = plaintext.to_vec();
    aead_key(key)?
        .seal_in_place_append_tag(nonce, aead::Aad::from(aad), &mut ciphertext)
        .map_err(|_| "AES-GCM encryption failed".to_string())?;
    Ok((nonce_bytes, ciphertext))
}

fn decrypt_bytes(
    key: &[u8; VAULT_KEY_BYTES],
    nonce_bytes: &[u8],
    ciphertext: &[u8],
    aad: &[u8],
) -> Result<Vec<u8>, String> {
    let nonce_bytes: [u8; NONCE_BYTES] = nonce_bytes
        .try_into()
        .map_err(|_| "Invalid AES-GCM nonce".to_string())?;
    let nonce = aead::Nonce::assume_unique_for_key(nonce_bytes);
    let mut plaintext = ciphertext.to_vec();
    let value = aead_key(key)?
        .open_in_place(nonce, aead::Aad::from(aad), &mut plaintext)
        .map_err(|_| "Encrypted data authentication failed".to_string())?;
    Ok(value.to_vec())
}

pub fn load_or_create_vault_key() -> Result<[u8; VAULT_KEY_BYTES], String> {
    if let Some(key) = load_existing_vault_key()? {
        return Ok(key);
    }
    let key = random_bytes::<VAULT_KEY_BYTES>()?;
    store_vault_key(&key)?;
    Ok(key)
}

/// Read the existing vault key without creating one.
///
/// A read path must never manufacture a replacement key: doing so would make
/// every previously encrypted password note permanently undecryptable.  The
/// creating variant above is reserved for first-time password-note creation
/// and legacy plaintext migration.
pub fn load_vault_key() -> Result<[u8; VAULT_KEY_BYTES], String> {
    load_existing_vault_key()?.ok_or_else(|| "Stored vault key is unavailable".to_string())
}

fn load_existing_vault_key() -> Result<Option<[u8; VAULT_KEY_BYTES]>, String> {
    let Some(value) = credential_store::read(VAULT_CREDENTIAL_TARGET)? else {
        return Ok(None);
    };
    let key = value
        .as_slice()
        .try_into()
        .map_err(|_| "Stored vault key has an invalid length".to_string())?;
    Ok(Some(key))
}

fn store_vault_key(key: &[u8; VAULT_KEY_BYTES]) -> Result<(), String> {
    credential_store::write(VAULT_CREDENTIAL_TARGET, "LightTodo", key)
}

fn note_aad(id: &str) -> Vec<u8> {
    format!("LightTodo/password-note/v1/{id}").into_bytes()
}

pub fn is_encrypted_title(title: &str) -> bool {
    title.starts_with(ENCRYPTED_PREFIX)
}

pub fn encrypt_note_title_with_key(
    id: &str,
    plaintext: &str,
    key: &[u8; VAULT_KEY_BYTES],
) -> Result<String, String> {
    let (nonce, ciphertext) = encrypt_bytes(key, plaintext.as_bytes(), &note_aad(id))?;
    let mut payload = Vec::with_capacity(NONCE_BYTES + ciphertext.len());
    payload.extend_from_slice(&nonce);
    payload.extend_from_slice(&ciphertext);
    Ok(format!(
        "{ENCRYPTED_PREFIX}{}",
        STANDARD_NO_PAD.encode(payload)
    ))
}

pub fn decrypt_note_title_with_key(
    id: &str,
    value: &str,
    key: &[u8; VAULT_KEY_BYTES],
) -> Result<String, String> {
    if !is_encrypted_title(value) {
        return Ok(value.to_string());
    }
    let payload = STANDARD_NO_PAD
        .decode(value.trim_start_matches(ENCRYPTED_PREFIX))
        .map_err(|_| "Encrypted password note is not valid base64".to_string())?;
    if payload.len() <= NONCE_BYTES {
        return Err("Encrypted password note is truncated".to_string());
    }
    let plaintext = decrypt_bytes(
        key,
        &payload[..NONCE_BYTES],
        &payload[NONCE_BYTES..],
        &note_aad(id),
    )?;
    String::from_utf8(plaintext).map_err(|_| "Password note is not valid UTF-8".to_string())
}

pub fn encrypt_note_title(id: &str, content: &str, plaintext: &str) -> Result<String, String> {
    if content != PASSWORD_NOTE_MARKER {
        return Ok(plaintext.to_string());
    }
    let key = load_or_create_vault_key()?;
    encrypt_note_title_with_key(id, plaintext, &key)
}

pub fn decrypt_note_title(id: &str, content: &str, value: &str) -> Result<String, String> {
    if content != PASSWORD_NOTE_MARKER {
        return Ok(value.to_string());
    }
    let key = load_vault_key()?;
    decrypt_note_title_with_key(id, value, &key)
}

pub fn normalize_remote_title(
    id: &str,
    content: &str,
    value: &str,
) -> Result<(String, bool), String> {
    if content != PASSWORD_NOTE_MARKER {
        return Ok((value.to_string(), false));
    }
    if is_encrypted_title(value) {
        let key = load_vault_key()?;
        decrypt_note_title_with_key(id, value, &key)?;
        Ok((value.to_string(), false))
    } else {
        let key = load_or_create_vault_key()?;
        Ok((encrypt_note_title_with_key(id, value, &key)?, true))
    }
}

fn derive_wrapping_key(password: &str, salt: &[u8]) -> Result<[u8; VAULT_KEY_BYTES], String> {
    if password.is_empty() {
        return Err("WebDAV password is required to unlock the synced vault".to_string());
    }
    let iterations = NonZeroU32::new(PBKDF2_ITERATIONS)
        .ok_or_else(|| "Invalid PBKDF2 iteration count".to_string())?;
    let mut key = [0u8; VAULT_KEY_BYTES];
    pbkdf2::derive(
        pbkdf2::PBKDF2_HMAC_SHA256,
        iterations,
        salt,
        password.as_bytes(),
        &mut key,
    );
    Ok(key)
}

fn wrap_key(key: &[u8; VAULT_KEY_BYTES], password: &str) -> Result<VaultEnvelope, String> {
    let salt = random_bytes::<16>()?;
    let wrapping_key = derive_wrapping_key(password, &salt)?;
    let (nonce, wrapped_key) = encrypt_bytes(&wrapping_key, key, ENVELOPE_AAD)?;
    Ok(VaultEnvelope {
        version: 1,
        key_id: key_id(key),
        salt: STANDARD_NO_PAD.encode(salt),
        nonce: STANDARD_NO_PAD.encode(nonce),
        wrapped_key: STANDARD_NO_PAD.encode(wrapped_key),
    })
}

fn unwrap_key(envelope: &VaultEnvelope, password: &str) -> Result<[u8; VAULT_KEY_BYTES], String> {
    if envelope.version != 1 {
        return Err(format!(
            "Unsupported vault envelope version: {}",
            envelope.version
        ));
    }
    let salt = STANDARD_NO_PAD
        .decode(&envelope.salt)
        .map_err(|_| "Vault salt is invalid".to_string())?;
    if salt.len() != 16 {
        return Err("Vault salt has an invalid length".to_string());
    }
    let nonce = STANDARD_NO_PAD
        .decode(&envelope.nonce)
        .map_err(|_| "Vault nonce is invalid".to_string())?;
    if nonce.len() != NONCE_BYTES {
        return Err("Vault nonce has an invalid length".to_string());
    }
    let wrapped_key = STANDARD_NO_PAD
        .decode(&envelope.wrapped_key)
        .map_err(|_| "Wrapped vault key is invalid".to_string())?;
    if wrapped_key.len() != VAULT_KEY_BYTES + GCM_TAG_BYTES {
        return Err("Wrapped vault key has an invalid length".to_string());
    }
    let wrapping_key = derive_wrapping_key(password, &salt)?;
    let key = decrypt_bytes(&wrapping_key, &nonce, &wrapped_key, ENVELOPE_AAD)?;
    let key: [u8; VAULT_KEY_BYTES] = key
        .as_slice()
        .try_into()
        .map_err(|_| "Unwrapped vault key has an invalid length".to_string())?;
    if key_id(&key) != envelope.key_id {
        return Err("Unwrapped vault key ID does not match".to_string());
    }
    Ok(key)
}

fn reencrypt_password_notes(
    db: &Database,
    old_key: &[u8; VAULT_KEY_BYTES],
    new_key: &[u8; VAULT_KEY_BYTES],
) -> Result<(), String> {
    if old_key == new_key {
        return Ok(());
    }
    let connection = db.get_connection();
    let mut connection = connection.lock();
    let tx = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let notes = {
        let mut statement = tx
            .prepare("SELECT id, title, updated_at FROM notes WHERE content = ?1")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([PASSWORD_NOTE_MARKER], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            })
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        rows
    };
    let now = chrono::Utc::now().timestamp_millis();
    for (id, title, updated_at) in notes {
        let plaintext = match decrypt_note_title_with_key(&id, &title, old_key) {
            Ok(plaintext) => plaintext,
            Err(old_error) => {
                // A process may have crashed after committing the database
                // transaction but before persisting the new credential.  If
                // this row is already encrypted with the target key, leave it
                // untouched so the next retry can finish the key rotation.
                if decrypt_note_title_with_key(&id, &title, new_key).is_ok() {
                    continue;
                }
                return Err(old_error);
            }
        };
        let encrypted = encrypt_note_title_with_key(&id, &plaintext, new_key)?;
        tx.execute(
            "UPDATE notes SET title = ?1, updated_at = MAX(
                 CASE WHEN updated_at < 9223372036854775807 THEN updated_at + 1 ELSE updated_at END,
                 ?2) WHERE id = ?3",
            params![encrypted, now.max(updated_at.saturating_add(1)), id],
        )
        .map_err(|error| error.to_string())?;
    }
    tx.commit().map_err(|error| error.to_string())?;
    Ok(())
}

/// Reconcile the local vault key with the key envelope stored in the remote
/// manifest. The remote key wins, and local password notes are re-encrypted
/// transactionally before any sync snapshot is built.
pub fn reconcile_vault(
    db: &Database,
    remote: Option<&VaultEnvelope>,
    webdav_password: &str,
) -> Result<(VaultEnvelope, bool), String> {
    let local_key = load_existing_vault_key()?;
    let Some(remote) = remote else {
        let key = match local_key {
            Some(key) => key,
            None => random_bytes::<VAULT_KEY_BYTES>()?,
        };
        let envelope = wrap_key(&key, webdav_password)?;
        if local_key.is_none() {
            store_vault_key(&key)?;
        }
        return Ok((envelope, true));
    };

    match unwrap_key(remote, webdav_password) {
        Ok(remote_key) => {
            match local_key {
                Some(local_key) if remote_key != local_key => {
                    reencrypt_password_notes(db, &local_key, &remote_key)?;
                    if let Err(error) = store_vault_key(&remote_key) {
                        // Keep the database and credential store on the old key
                        // when persistence fails.  If rollback itself fails, the
                        // mixed-key recovery path above can repair it on retry.
                        if let Err(rollback_error) =
                            reencrypt_password_notes(db, &remote_key, &local_key)
                        {
                            return Err(format!(
                                "Failed to persist the new vault key and database rollback also failed: {error}; {rollback_error}"
                            ));
                        }
                        return Err(format!("Failed to persist the new vault key: {error}"));
                    }
                }
                Some(_) => {}
                None => {
                    // A missing local credential is recoverable on a new
                    // device.  If encrypted rows already exist, verify that
                    // the remote key can open every row before persisting it;
                    // otherwise never overwrite the missing-key state with a
                    // key that would make recovery harder.
                    verify_password_notes(db, &remote_key)?;
                    store_vault_key(&remote_key)?;
                }
            }
            Ok((remote.clone(), false))
        }
        Err(_error) if local_key.is_some_and(|key| remote.key_id == key_id(&key)) => {
            // The WebDAV password changed, but the local vault key is still
            // the same one referenced by the manifest. Re-wrap it safely.
            let key = local_key.ok_or_else(|| "Stored vault key is unavailable".to_string())?;
            Ok((wrap_key(&key, webdav_password)?, true))
        }
        Err(error) => Err(format!("Unable to unlock synced password notes: {error}")),
    }
}

fn verify_password_notes(db: &Database, key: &[u8; VAULT_KEY_BYTES]) -> Result<(), String> {
    let connection = db.get_connection();
    let connection = connection.lock();
    let mut statement = connection
        .prepare("SELECT id, title FROM notes WHERE content = ?1")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([PASSWORD_NOTE_MARKER], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| error.to_string())?;
    for row in rows {
        let (id, title) = row.map_err(|error| error.to_string())?;
        if is_encrypted_title(&title) {
            decrypt_note_title_with_key(&id, &title, key)?;
        }
    }
    Ok(())
}

pub fn migrate_legacy_password_notes(db: &Database) -> Result<usize, String> {
    let connection = db.get_connection();
    let mut connection = connection.lock();
    let tx = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let notes = {
        let mut statement = tx
            .prepare("SELECT id, title, updated_at FROM notes WHERE content = ?1")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([PASSWORD_NOTE_MARKER], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            })
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        rows
    };
    if notes.is_empty() {
        return Ok(0);
    }
    // Do not touch the credential store when every row is already encrypted.
    // This keeps startup usable if the OS credential service is temporarily
    // unavailable; individual rows will be reported as undecryptable when
    // they are read instead of preventing all notes from loading.
    let plaintext_notes = notes
        .into_iter()
        .filter(|(_, title, _)| !is_encrypted_title(title))
        .collect::<Vec<_>>();
    if plaintext_notes.is_empty() {
        return Ok(0);
    }
    let key = load_or_create_vault_key()?;
    let now = chrono::Utc::now().timestamp_millis();
    let mut migrated = 0;
    for (id, title, updated_at) in plaintext_notes {
        let encrypted = encrypt_note_title_with_key(&id, &title, &key)?;
        tx.execute(
            "UPDATE notes SET title = ?1, updated_at = MAX(
                 CASE WHEN updated_at < 9223372036854775807 THEN updated_at + 1 ELSE updated_at END,
                 ?2) WHERE id = ?3",
            params![encrypted, now.max(updated_at.saturating_add(1)), id],
        )
        .map_err(|error| error.to_string())?;
        migrated += 1;
    }
    tx.commit().map_err(|error| error.to_string())?;
    Ok(migrated)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn password_note_round_trip_detects_tampering() {
        let key = [7u8; VAULT_KEY_BYTES];
        let encrypted = encrypt_note_title_with_key("note-1", "secret", &key).unwrap();
        assert_eq!(
            decrypt_note_title_with_key("note-1", &encrypted, &key).unwrap(),
            "secret"
        );
        assert!(decrypt_note_title_with_key("note-2", &encrypted, &key).is_err());
    }

    #[test]
    fn vault_envelope_round_trip() {
        let key = [9u8; VAULT_KEY_BYTES];
        let envelope = wrap_key(&key, "webdav password").unwrap();
        assert_eq!(unwrap_key(&envelope, "webdav password").unwrap(), key);
        assert!(unwrap_key(&envelope, "wrong password").is_err());
    }

    #[test]
    fn vault_envelope_rejects_malformed_lengths() {
        let key = [9u8; VAULT_KEY_BYTES];
        let envelope = wrap_key(&key, "webdav password").unwrap();

        let mut bad_salt = envelope.clone();
        bad_salt.salt = STANDARD_NO_PAD.encode([0u8; 15]);
        assert!(unwrap_key(&bad_salt, "webdav password").is_err());

        let mut bad_nonce = envelope.clone();
        bad_nonce.nonce = STANDARD_NO_PAD.encode([0u8; NONCE_BYTES - 1]);
        assert!(unwrap_key(&bad_nonce, "webdav password").is_err());

        let mut bad_wrapped_key = envelope;
        bad_wrapped_key.wrapped_key = STANDARD_NO_PAD.encode([0u8; VAULT_KEY_BYTES]);
        assert!(unwrap_key(&bad_wrapped_key, "webdav password").is_err());
    }
}
