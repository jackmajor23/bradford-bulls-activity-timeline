-- ============================================================
-- Bradford Bulls Activity Timeline — Supabase Migration
-- Run this once in the Supabase SQL Editor (Dashboard → SQL)
-- ============================================================

-- ─── 1. Stable intra-cluster ordering ────────────────────────
-- Adds a cluster_order column so the drag-and-drop reorder
-- position of activities inside a fixture cluster is preserved
-- across sessions and devices.
ALTER TABLE activities
    ADD COLUMN IF NOT EXISTS cluster_order INTEGER NOT NULL DEFAULT 0;

-- Back-fill existing rows so there are no NULLs.
-- Activities that are NOT linked to a fixture get order 0 (harmless).
-- Linked activities that share the same fixture_id get a stable
-- order based on their creation sequence (id sort as a proxy).
UPDATE activities
SET    cluster_order = sub.row_num - 1
FROM (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY fixture_id
               ORDER BY     id          -- UUID order ≈ insert order
           ) AS row_num
    FROM   activities
    WHERE  fixture_id IS NOT NULL
) sub
WHERE activities.id = sub.id;

-- ─── 2. Standalone pre-match linking ─────────────────────────
-- Adds a second optional fixture reference so an activity can
-- stay on the main timeline while still being visually linked to
-- a match card as pre-match work.
ALTER TABLE activities
    ADD COLUMN IF NOT EXISTS linked_fixture_id UUID NULL;

-- ─── 3. Indexes for fixture activity lookups ─────────────────
-- Speeds up the common queries "give me all activities for fixture X"
-- and "give me all standalone activities related to fixture X".
CREATE INDEX IF NOT EXISTS idx_activities_fixture_id
    ON activities (fixture_id)
    WHERE fixture_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_activities_linked_fixture_id
    ON activities (linked_fixture_id)
    WHERE linked_fixture_id IS NOT NULL;

-- ─── 4. Optional: tighten RLS policies ───────────────────────
-- Uncomment and adapt these if you want to lock down each table
-- to authenticated users only (recommended for production).

-- ALTER TABLE activities    ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE fixtures      ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE milestones    ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE notes         ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE saved_assignees ENABLE ROW LEVEL SECURITY;

-- CREATE POLICY "Authenticated read/write" ON activities
--     FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Repeat the CREATE POLICY block for each table above.
