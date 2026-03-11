-- Paperclip integration tables (PRD 13 — supply chain & orchestration)
-- Tickets, budgets, goals, and audit log for the unit inspection panel.

-- Tickets (work items flowing through the supply chain)
CREATE TABLE IF NOT EXISTS ae_tickets (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  title text NOT NULL,
  description text,
  status text DEFAULT 'open',       -- open, in_progress, completed, rejected
  priority text DEFAULT 'normal',   -- low, normal, high, critical
  source_territory text,
  current_territory text,
  assigned_session_id text,
  created_by text,
  metadata jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

-- Budgets (resource allocation per territory)
CREATE TABLE IF NOT EXISTS ae_budgets (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  territory text NOT NULL,
  budget_type text DEFAULT 'compute',  -- compute, tokens, time
  allocated numeric NOT NULL DEFAULT 0,
  consumed numeric NOT NULL DEFAULT 0,
  period text DEFAULT 'daily',         -- daily, weekly, monthly
  period_start timestamptz DEFAULT now(),
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);

-- Goals (territory-level objectives with progress tracking)
CREATE TABLE IF NOT EXISTS ae_goals (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  territory text NOT NULL,
  name text NOT NULL,
  target_value numeric NOT NULL,
  current_value numeric DEFAULT 0,
  unit text DEFAULT 'count',  -- count, dollars, percent
  status text DEFAULT 'active',
  deadline timestamptz,
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);

-- Audit log (immutable event stream)
CREATE TABLE IF NOT EXISTS ae_audit_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  event_type text NOT NULL,
  actor text,           -- session ID or 'system'
  target_type text,     -- 'ticket', 'objective', 'session', etc.
  target_id text,
  details jsonb,
  created_at timestamptz DEFAULT now()
);

-- ── Row Level Security ─────────────────────────────────────────────────────

ALTER TABLE ae_tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_tickets" ON ae_tickets FOR ALL USING (true);

ALTER TABLE ae_budgets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_budgets" ON ae_budgets FOR ALL USING (true);

ALTER TABLE ae_goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_goals" ON ae_goals FOR ALL USING (true);

ALTER TABLE ae_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_audit_log" ON ae_audit_log FOR ALL USING (true);

-- ── Indexes ────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_tickets_status ON ae_tickets (status);
CREATE INDEX IF NOT EXISTS idx_tickets_current_territory ON ae_tickets (current_territory);
CREATE INDEX IF NOT EXISTS idx_tickets_assigned_session ON ae_tickets (assigned_session_id);
CREATE INDEX IF NOT EXISTS idx_tickets_created_at ON ae_tickets (created_at);

CREATE INDEX IF NOT EXISTS idx_budgets_territory ON ae_budgets (territory);
CREATE INDEX IF NOT EXISTS idx_budgets_period_start ON ae_budgets (period_start);

CREATE INDEX IF NOT EXISTS idx_goals_territory ON ae_goals (territory);
CREATE INDEX IF NOT EXISTS idx_goals_status ON ae_goals (status);

CREATE INDEX IF NOT EXISTS idx_audit_event_type ON ae_audit_log (event_type);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON ae_audit_log (actor);
CREATE INDEX IF NOT EXISTS idx_audit_target ON ae_audit_log (target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON ae_audit_log (created_at);
