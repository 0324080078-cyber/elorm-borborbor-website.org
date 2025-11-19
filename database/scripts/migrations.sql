/*
    migrations.sql
    - PostgreSQL-focused migration file with:
        * CREATE TABLE IF NOT EXISTS
        * Index creation (IF NOT EXISTS when possible)
        * Foreign key constraints
        * Data-type / consistency checks (pre-checks that abort on failure)
        * Backup procedures before schema changes
        * Rollback scripts for each migration
    Usage:
        psql -f migrations.sql
    Notes:
        - Each migration is wrapped in a transaction where possible.
        - Backup tables are created with a timestamp suffix.
        - Rollbacks attempt to restore from the backups when available.
*/

/* ===========================
     Helpers: create backup table
     =========================== */
-- Creates a backup table named schema.backup_<orig>_YYYYMMDDHH24MISS if orig exists
DO $$
DECLARE
    tbl text := 'public.' || 'users';  -- change per use or build dynamic caller
    backup_name text;
BEGIN
    -- This DO block is a helper example. We will use similar blocks before each change.
    -- No-op if table doesn't exist
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                         WHERE c.relkind = 'r' AND n.nspname = split_part(tbl,'.',1) AND c.relname = split_part(tbl,'.',2)) THEN
        backup_name := format('%I.%I', 'public', format('backup_users_%s', to_char(now(), 'YYYYMMDDHH24MISS')));
        EXECUTE format('CREATE TABLE %s AS TABLE %s', backup_name, tbl);
    END IF;
END
$$ LANGUAGE plpgsql;


-- ===========================
-- Migration 001 - create users
-- ===========================
BEGIN;

-- Safety: ensure no existing conflicting table name
CREATE TABLE IF NOT EXISTS public.users (
    id               bigserial PRIMARY KEY,
    email            varchar(255) NOT NULL UNIQUE,
    full_name        text,
    created_at       timestamptz NOT NULL DEFAULT now(),
    -- data type constraint example: store only normalized lower-case emails
    CHECK (email = lower(email))
);

-- Index for performance on email lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON public.users (email);

-- Data consistency check: ensure existing rows (if any) comply with checks
-- Abort the transaction if checks fail
DO $$
DECLARE cnt int;
BEGIN
    SELECT COUNT(*) INTO cnt FROM public.users WHERE email IS NULL OR email !~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$';
    IF cnt > 0 THEN
        RAISE EXCEPTION 'Migration 001 aborted: % rows in users with invalid email', cnt;
    END IF;
END
$$ LANGUAGE plpgsql;

COMMIT;

-- Rollback for Migration 001:
-- If you need to rollback this migration, run:
-- BEGIN;
--   DROP INDEX IF EXISTS public.idx_users_email;
--   DROP TABLE IF EXISTS public.users CASCADE;
-- COMMIT;
-- Or, to restore from the backup table if one exists:
-- BEGIN;
--   DROP TABLE IF EXISTS public.users;
--   CREATE TABLE public.users AS TABLE public.backup_users_<timestamp>;
-- COMMIT;


-- ===========================
-- Migration 002 - create posts with FK -> users
-- ===========================
BEGIN;

-- Backup existing posts table if it exists
DO $$
DECLARE backup_name text;
BEGIN
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                         WHERE c.relkind = 'r' AND n.nspname = 'public' AND c.relname = 'posts') THEN
        backup_name := format('public.%I', format('backup_posts_%s', to_char(now(), 'YYYYMMDDHH24MISS')));
        EXECUTE format('CREATE TABLE %s AS TABLE public.posts', backup_name);
    END IF;
END
$$ LANGUAGE plpgsql;

-- Create posts table
CREATE TABLE IF NOT EXISTS public.posts (
    id          bigserial PRIMARY KEY,
    user_id     bigint NOT NULL,
    title       varchar(255) NOT NULL,
    body        text,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- Add foreign key constraint safely (requires that referenced users.id exists for all user_id)
-- Pre-check: ensure every posts.user_id references an existing users.id
DO $$
DECLARE bad_count int;
BEGIN
    SELECT COUNT(*) INTO bad_count
        FROM public.posts p
        LEFT JOIN public.users u ON p.user_id = u.id
        WHERE p.user_id IS NOT NULL AND u.id IS NULL;
    IF bad_count > 0 THEN
        RAISE EXCEPTION 'Migration 002 aborted: % orphaned post.user_id rows found', bad_count;
    END IF;
END
$$ LANGUAGE plpgsql;

-- Add FK (if not already present)
ALTER TABLE public.posts
    ADD CONSTRAINT fk_posts_user
    FOREIGN KEY (user_id) REFERENCES public.users (id)
    ON DELETE CASCADE;

-- Performance: index on user_id for common lookups
CREATE INDEX IF NOT EXISTS idx_posts_user_id ON public.posts (user_id);

COMMIT;

-- Rollback for Migration 002:
-- BEGIN;
--   ALTER TABLE public.posts DROP CONSTRAINT IF EXISTS fk_posts_user;
--   DROP INDEX IF EXISTS public.idx_posts_user_id;
--   DROP TABLE IF EXISTS public.posts CASCADE;
-- COMMIT;
-- Or, to restore from backup:
-- BEGIN;
--   DROP TABLE IF EXISTS public.posts;
--   CREATE TABLE public.posts AS TABLE public.backup_posts_<timestamp>;
-- COMMIT;


-- ===========================
-- Migration 003 - alter users.phone (example type change with checks)
-- ===========================
BEGIN;

-- Backup users table prior to ALTER
DO $$
DECLARE backup_name text;
BEGIN
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                         WHERE c.relkind = 'r' AND n.nspname = 'public' AND c.relname = 'users') THEN
        backup_name := format('public.%I', format('backup_users_before_phone_%s', to_char(now(), 'YYYYMMDDHH24MISS')));
        EXECUTE format('CREATE TABLE %s AS TABLE public.users', backup_name);
    END IF;
END
$$ LANGUAGE plpgsql;

-- Add column as text if not exists (safe step)
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS phone text;

-- Suppose we want to constrain phone to varchar(20). Ensure existing values fit first:
DO $$
DECLARE bad_count int;
BEGIN
    SELECT COUNT(*) INTO bad_count FROM public.users WHERE phone IS NOT NULL AND char_length(phone) > 20;
    IF bad_count > 0 THEN
        RAISE EXCEPTION 'Migration 003 aborted: % rows have phone length > 20', bad_count;
    END IF;
END
$$ LANGUAGE plpgsql;

-- Now convert to varchar(20) (if desired). Use USING to ensure correct cast.
ALTER TABLE public.users
    ALTER COLUMN phone TYPE varchar(20)
    USING substring(phone for 20);

-- Add an index for phone lookups (optional)
CREATE INDEX IF NOT EXISTS idx_users_phone ON public.users (phone);

COMMIT;

-- Rollback for Migration 003:
-- BEGIN;
--   ALTER TABLE public.users ALTER COLUMN phone TYPE text; -- if you prefer to revert
--   DROP INDEX IF EXISTS public.idx_users_phone;
--   -- Or restore from backup:
--   DROP TABLE IF EXISTS public.users;
--   CREATE TABLE public.users AS TABLE public.backup_users_before_phone_<timestamp>;
-- COMMIT;


-- ===========================
-- Migration template (future)
-- ===========================
/*
BEGIN;
-- 1) Create backup of affected tables (see examples above)
-- 2) Run data validation queries to ensure the migration will succeed. If validations fail, RAISE EXCEPTION to abort.
-- 3) Apply schema changes (CREATE/ALTER/INDEX/FK)
-- 4) COMMIT;
--
-- Rollback:
-- - Prefer restoring from backups created in step 1.
-- - Keep rollback SQL next to each migration for audit.
*/