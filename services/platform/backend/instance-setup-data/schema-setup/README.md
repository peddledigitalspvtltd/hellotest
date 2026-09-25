# Database schema setup

`schema.sql` creates the initial database schema. This directory is excluded from the instance dataset manifest and rejected by its installer.

PostgreSQL runs this file only for an empty data volume. The API then applies idempotent runtime schema updates and initializes the administrator foundation. The legacy SQL demo seed has been removed; roles, permissions and bootstrap administrators are owned by runtime initialization, not demo content. Existing databases and records are retained.

Sample content has one source: the versioned JSON files in the parent directory. Use Administration → Instance setup, or set `HELLOTEST_INSTANCE_SETUP_MODULES=all` (or comma-separated manifest module keys) before API startup. Only the Platform/all process queues startup setup after initialization. Installation runs in the existing background worker with visible progress and manual retry; readiness does not wait for the full dataset.

Leave the variable unset for an empty customer instance. A matching dataset receipt covering the selected modules prevents repeat installation on restart. Failed receipts are preserved until an administrator retries; changing the dataset manifest permits a new install. Optional setup errors are logged without preventing API startup. No sample users, fixed passwords or automatic destructive resets are installed.
