-- =============================================================================
-- RF-C0 FIX — generate_return_number() off-by-one in SUBSTRING math
-- =============================================================================
--
-- BUG: The original function used `SUBSTRING(return_number FROM LENGTH(prefix) + 5 FOR 6)`
-- which, for a value like 'RET-2026-000001', starts the substring at position 9 — i.e. the
-- dash separator between year and number. Result: extracted text is '-00000', PostgreSQL
-- casts it to integer as 0 (negative zero), so MAX() always returns 0 and new_num always
-- becomes 1. Every call returns RET-YYYY-000001. The first insert each year succeeds; every
-- subsequent insert fails with:
--   ERROR: duplicate key value violates unique constraint "returns_return_number_key"
--
-- FIX: replace the brittle position math with a regex that pulls the trailing digit run.
-- Robust to future format tweaks (e.g. if anyone changes the prefix length).
--
-- HOW TO RUN: paste the entire CREATE OR REPLACE block into Supabase SQL Editor and run.
-- It's idempotent (replaces the function in-place). After running, retry creating a return
-- from the UI — it should succeed with RET-YYYY-000002, then 000003, etc.
-- =============================================================================

CREATE OR REPLACE FUNCTION generate_return_number()
RETURNS TEXT AS $$
DECLARE
  prefix TEXT := 'RET-';
  year_part TEXT := TO_CHAR(NOW(), 'YYYY');
  last_num INTEGER;
  new_num INTEGER;
  return_num TEXT;
BEGIN
  -- Pull the trailing run of digits via regex. For 'RET-2026-000001' this yields '000001'.
  -- Filter by `LIKE prefix || year_part || '-%'` so we only look at the current year.
  SELECT COALESCE(MAX(CAST(SUBSTRING(return_number FROM '\d+$') AS INTEGER)), 0)
  INTO last_num
  FROM returns
  WHERE return_number LIKE prefix || year_part || '-%';

  new_num := last_num + 1;
  return_num := prefix || year_part || '-' || LPAD(new_num::TEXT, 6, '0');
  RETURN return_num;
END;
$$ LANGUAGE plpgsql;


-- =============================================================================
-- VERIFICATION (run after the CREATE OR REPLACE above)
-- =============================================================================

-- 1. Confirm the function returns a sensible next number.
--    Expected: 'RET-2026-NNNNNN' where NNNNNN is one more than the current MAX.
SELECT generate_return_number() AS next_return_number;

-- 2. List your existing return_numbers to spot the previously-blocked duplicate state.
SELECT return_number, created_at
FROM returns
ORDER BY created_at DESC
LIMIT 10;
