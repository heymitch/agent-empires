-- Agent Empires Phase 1: Threat tracking + company documents tables
-- Applied: 2026-03-10

CREATE TABLE IF NOT EXISTS agent_empires_threats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('low', 'elevated', 'critical')),
  territory TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  source_table TEXT NOT NULL,
  source_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'resolved', 'expired')),
  created_at TIMESTAMPTZ DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_threats_status ON agent_empires_threats(status);
CREATE INDEX IF NOT EXISTS idx_threats_territory ON agent_empires_threats(territory);
CREATE UNIQUE INDEX IF NOT EXISTS idx_threats_source ON agent_empires_threats(source_table, source_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS company_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  content TEXT,
  document_type TEXT DEFAULT 'general',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
