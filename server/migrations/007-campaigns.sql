-- Campaign management table
CREATE TABLE IF NOT EXISTS ae_campaigns (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  description text,
  status text DEFAULT 'active',  -- active, completed, archived
  territory text,
  total_hp integer DEFAULT 0,
  defeated_hp integer DEFAULT 0,
  objective_count integer DEFAULT 0,
  defeated_count integer DEFAULT 0,
  metadata jsonb,
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

ALTER TABLE ae_campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all" ON ae_campaigns FOR ALL USING (true);
