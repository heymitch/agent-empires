-- ae_handoffs: Inter-territory task handoffs that spawn visual packets on the battlefield
CREATE TABLE IF NOT EXISTS ae_handoffs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  from_session_id text,
  to_session_id text,
  from_territory text NOT NULL,
  to_territory text NOT NULL,
  type text DEFAULT 'task',
  label text,
  priority text DEFAULT 'normal',
  payload jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE ae_handoffs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all" ON ae_handoffs FOR ALL USING (true);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE ae_handoffs;
