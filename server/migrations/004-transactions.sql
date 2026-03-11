-- Migration 004: Stripe transaction ledger
-- Stores webhook events from Stripe for revenue tracking (PRD 05)

CREATE TABLE IF NOT EXISTS ae_transactions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  stripe_event_id text UNIQUE,
  type text NOT NULL,  -- 'charge.succeeded', 'invoice.paid', 'customer.subscription.deleted', etc.
  amount_cents integer NOT NULL,
  currency text DEFAULT 'usd',
  customer_id text,
  description text,
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE ae_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all" ON ae_transactions FOR ALL USING (true);
