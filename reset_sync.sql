UPDATE webdav_config SET last_sync = 0 WHERE id = 1;
SELECT 'Reset complete. last_sync is now:', last_sync FROM webdav_config WHERE id = 1;
