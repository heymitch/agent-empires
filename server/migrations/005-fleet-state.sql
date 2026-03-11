-- Fleet state persistence (PRD 12 — distributed fleet architecture)
-- Stores a singleton snapshot of battlefield state so it survives server restarts.

CREATE TABLE IF NOT EXISTS ae_fleet_state (
  id text PRIMARY KEY DEFAULT 'singleton',
  sessions jsonb NOT NULL DEFAULT '[]',
  roads jsonb NOT NULL DEFAULT '[]',
  objectives jsonb NOT NULL DEFAULT '[]',
  threats jsonb NOT NULL DEFAULT '[]',
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE ae_fleet_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all" ON ae_fleet_state FOR ALL USING (true);
