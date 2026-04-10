-- ============================================================
-- REALTOBA BROKER — Schema Update v2
-- Run this in Supabase SQL Editor AFTER the original schema.sql
-- ============================================================

-- ─────────────────────────────────────────────
-- 1. ALTER USERS TABLE
-- ─────────────────────────────────────────────
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_admin        BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_suspended    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS suspended_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suspension_reason TEXT;

-- The one admin account — update this after running the schema
-- Replace the firebase_uid and email with your actual admin account
-- INSERT INTO public.users (firebase_uid, name, email, role, is_admin)
-- VALUES ('YOUR_ADMIN_FIREBASE_UID', 'Realtoba Admin', 'admin@realtoba.ng', 'seeker', TRUE)
-- ON CONFLICT (firebase_uid) DO UPDATE SET is_admin = TRUE;

-- ─────────────────────────────────────────────
-- 2. ALTER PROPERTIES TABLE — Add verification workflow
-- ─────────────────────────────────────────────
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('pending', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS admin_note       TEXT,
  ADD COLUMN IF NOT EXISTS verified_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verified_by      UUID REFERENCES public.users(id);

-- Index for admin property review queue
CREATE INDEX IF NOT EXISTS idx_properties_verification
  ON public.properties(verification_status, created_at DESC);

-- ─────────────────────────────────────────────
-- 3. ALTER TRANSACTIONS TABLE — Escrow payment flow
-- ─────────────────────────────────────────────
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS agent_id        UUID REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS status          TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','paid_to_platform','failed','refunded')),
  ADD COLUMN IF NOT EXISTS deal_status     TEXT
    CHECK (deal_status IN (
      'awaiting_confirmation',
      'deal_confirmed',
      'agent_paid',
      'refunded'
    )),
  ADD COLUMN IF NOT EXISTS platform_fee    NUMERIC(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS agent_amount    NUMERIC(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deal_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS agent_paid_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payout_reference TEXT;

-- Indexes for admin transaction queries
CREATE INDEX IF NOT EXISTS idx_transactions_deal_status
  ON public.transactions(deal_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_agent_id
  ON public.transactions(agent_id);
CREATE INDEX IF NOT EXISTS idx_transactions_status
  ON public.transactions(status, created_at DESC);

-- ─────────────────────────────────────────────
-- 4. AGENT BANK ACCOUNTS
-- Stores verified bank details for agent payouts
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agent_bank_accounts (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id                UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  bank_name               TEXT NOT NULL,
  bank_code               TEXT NOT NULL,
  account_number          TEXT NOT NULL,
  account_name            TEXT NOT NULL,       -- verified account name from Paystack
  paystack_recipient_code TEXT NOT NULL,        -- used to initiate transfers
  is_verified             BOOLEAN NOT NULL DEFAULT FALSE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (agent_id)                            -- one bank account per agent
);

CREATE INDEX IF NOT EXISTS idx_agent_bank_accounts_agent_id
  ON public.agent_bank_accounts(agent_id);

-- ─────────────────────────────────────────────
-- 5. PAYOUTS TABLE
-- Records every payout attempt to agents
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payouts (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transaction_id          UUID NOT NULL REFERENCES public.transactions(id) ON DELETE RESTRICT,
  agent_id                UUID NOT NULL REFERENCES public.users(id),
  amount                  NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  status                  TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','success','failed')),
  reference               TEXT UNIQUE NOT NULL,
  paystack_transfer_code  TEXT,
  failed_reason           TEXT,
  paid_at                 TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (transaction_id)                      -- one payout per transaction
);

CREATE INDEX IF NOT EXISTS idx_payouts_agent_id      ON public.payouts(agent_id);
CREATE INDEX IF NOT EXISTS idx_payouts_status        ON public.payouts(status);
CREATE INDEX IF NOT EXISTS idx_payouts_transaction   ON public.payouts(transaction_id);

-- ─────────────────────────────────────────────
-- 6. CONVERSATIONS TABLE
-- Each row represents a thread between two parties
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.conversations (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type                  TEXT NOT NULL
    CHECK (type IN (
      'user_admin',    -- client talking to admin
      'agent_admin',   -- agent talking to admin
      'agent_client'   -- client talking to agent about a specific property
    )),
  participant_user_id   UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  other_user_id         UUID REFERENCES public.users(id) ON DELETE SET NULL,
  property_id           UUID REFERENCES public.properties(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One conversation per user per type per property
  UNIQUE (participant_user_id, type, COALESCE(property_id, '00000000-0000-0000-0000-000000000000'::UUID))
);

CREATE INDEX IF NOT EXISTS idx_conversations_participant
  ON public.conversations(participant_user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_updated
  ON public.conversations(updated_at DESC);

-- ─────────────────────────────────────────────
-- 7. MESSAGES TABLE
-- Individual messages within conversations
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.messages (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id       UUID REFERENCES public.users(id) ON DELETE SET NULL,
  sender_type     TEXT NOT NULL CHECK (sender_type IN ('user','agent','admin')),
  content         TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 2000),
  is_read         BOOLEAN NOT NULL DEFAULT FALSE,
  is_system       BOOLEAN NOT NULL DEFAULT FALSE,  -- true for auto-generated messages
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Critical indexes for message performance
CREATE INDEX IF NOT EXISTS idx_messages_conversation
  ON public.messages(conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_messages_sender
  ON public.messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_unread
  ON public.messages(conversation_id, is_read) WHERE is_read = FALSE;

-- ─────────────────────────────────────────────
-- 8. ADMIN NOTIFICATIONS
-- Alerts shown in the admin dashboard
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.admin_notifications (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type           TEXT NOT NULL CHECK (type IN (
    'payment_received',
    'new_listing',
    'new_user',
    'deal_confirmed',
    'payout_failed'
  )),
  title          TEXT NOT NULL,
  body           TEXT NOT NULL,
  transaction_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
  property_id    UUID REFERENCES public.properties(id) ON DELETE SET NULL,
  is_read        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_notifications_unread
  ON public.admin_notifications(is_read, created_at DESC);

-- ─────────────────────────────────────────────
-- 9. ADMIN AUDIT LOG
-- Every admin action is permanently recorded
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_id    UUID NOT NULL REFERENCES public.users(id),
  action      TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  target_type TEXT NOT NULL,
  metadata    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_admin   ON public.admin_audit_log(admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_target  ON public.admin_audit_log(target_id, target_type);

-- ─────────────────────────────────────────────
-- 10. TRIGGERS — updated_at automation
-- ─────────────────────────────────────────────
CREATE TRIGGER trg_conversations_updated_at
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER trg_bank_accounts_updated_at
  BEFORE UPDATE ON public.agent_bank_accounts
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ─────────────────────────────────────────────
-- 11. TRIGGER — auto notify admin on new property listing
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_admin_new_listing()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.admin_notifications (type, title, body, property_id)
  VALUES (
    'new_listing',
    'New Property Listing Pending Review',
    'A new property "' || NEW.title || '" has been submitted and requires approval.',
    NEW.id
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_new_listing_notification
  AFTER INSERT ON public.properties
  FOR EACH ROW EXECUTE FUNCTION public.notify_admin_new_listing();

-- ─────────────────────────────────────────────
-- 12. ROW LEVEL SECURITY — New tables
-- ─────────────────────────────────────────────
ALTER TABLE public.agent_bank_accounts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payouts              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_notifications  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_log      ENABLE ROW LEVEL SECURITY;

-- Open policies (backend enforces security via service role key)
CREATE POLICY "backend_full_access_bank_accounts"  ON public.agent_bank_accounts  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "backend_full_access_payouts"        ON public.payouts              FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "backend_full_access_conversations"  ON public.conversations        FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "backend_full_access_messages"       ON public.messages             FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "backend_full_access_notifications"  ON public.admin_notifications  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "backend_full_access_audit"          ON public.admin_audit_log      FOR ALL USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────
-- 13. REALTIME — Enable for live chat
-- Run these in Supabase SQL Editor:
-- ─────────────────────────────────────────────
-- Enable realtime for messages table (needed for live chat)
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.admin_notifications;