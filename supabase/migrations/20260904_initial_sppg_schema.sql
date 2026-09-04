-- ==============================================================================
-- IZA SPPG MBG ASSISTANT DATABASE SCHEMA (SUPABASE POSTGRESQL)
-- ==============================================================================

-- 1. Whitelist Pengguna Telegram & Otorisasi
CREATE TABLE IF NOT EXISTS sppg_users (
  id BIGINT PRIMARY KEY, -- Telegram User ID (numerik)
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('super_admin', 'admin', 'member')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending', 'blocked')),
  sppg_assigned_id TEXT DEFAULT 'sppg_patila',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. State Machine Draf Konfirmasi Transaksi (TTL 10 Menit)
CREATE TABLE IF NOT EXISTS pending_agent_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sppg_id TEXT NOT NULL,
  telegram_user_id BIGINT NOT NULL,
  telegram_chat_id BIGINT NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('SPPG_ORDER', 'SUPPLIER_EXPENSE')),
  payload JSONB NOT NULL,
  media_url TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'SAVED', 'CANCELLED', 'EXPIRED')),
  message_id BIGINT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pending_actions_user_status ON pending_agent_actions(telegram_user_id, status);
CREATE INDEX IF NOT EXISTS idx_pending_actions_expires ON pending_agent_actions(expires_at);

-- 3. Header Nota Pesanan SPPG (Plafon / Pendapatan)
CREATE TABLE IF NOT EXISTS sppg_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sppg_id TEXT NOT NULL,
  order_no TEXT NOT NULL,
  order_date DATE NOT NULL,
  arrival_date DATE NOT NULL,
  total_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
  signed_by TEXT,
  created_by BIGINT REFERENCES sppg_users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Rincian Item Bahan Makanan SPPG (20+ Items)
CREATE TABLE IF NOT EXISTS sppg_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES sppg_orders(id) ON DELETE CASCADE,
  item_name TEXT NOT NULL,
  qty NUMERIC(10, 2) NOT NULL,
  unit TEXT NOT NULL,
  price NUMERIC(15, 2) NOT NULL,
  total_price NUMERIC(15, 2) NOT NULL,
  supplier_target TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Transaksi Belanja Supplier (Pengeluaran Riil)
CREATE TABLE IF NOT EXISTS sppg_supplier_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sppg_id TEXT NOT NULL,
  sppg_ref_no TEXT,
  supplier_name TEXT NOT NULL,
  transaction_date DATE NOT NULL,
  items_summary TEXT NOT NULL,
  total_amount NUMERIC(15, 2) NOT NULL,
  drive_url TEXT,
  created_by BIGINT REFERENCES sppg_users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Tabel Heartbeat (Supabase Inactivity Keep-Warm)
CREATE TABLE IF NOT EXISTS sppg_heartbeat (
  id INT PRIMARY KEY DEFAULT 1,
  last_ping TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO sppg_heartbeat (id, last_ping) VALUES (1, NOW()) ON CONFLICT (id) DO UPDATE SET last_ping = NOW();
