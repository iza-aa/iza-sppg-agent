-- ==============================================================================
-- AUDIT TRAIL LOGS FOR GOOGLE SHEETS & SPPG ACTIONS
-- ==============================================================================

CREATE TABLE IF NOT EXISTS sppg_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  unit_name TEXT NOT NULL,
  editor TEXT NOT NULL,
  sheet_tab TEXT NOT NULL,
  ref_id TEXT,
  column_edited TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  source_action TEXT NOT NULL DEFAULT 'Spreadsheet Direct Edit',
  status TEXT NOT NULL DEFAULT 'TERCATAT',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sppg_audit_logs_unit ON sppg_audit_logs(unit_name);
CREATE INDEX IF NOT EXISTS idx_sppg_audit_logs_timestamp ON sppg_audit_logs(timestamp);
