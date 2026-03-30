-- 023_farmer_card_wallet.sql
-- 农户预付卡 / 钱包 / 刷卡入口（与 irrigation_order.order_channel、funding_mode 配合）

CREATE TABLE IF NOT EXISTS farmer_wallet (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  user_id uuid NOT NULL REFERENCES sys_user(id),
  balance numeric(12, 2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS farmer_wallet_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  user_id uuid NOT NULL REFERENCES sys_user(id),
  entry_type varchar(32) NOT NULL,
  amount numeric(12, 2) NOT NULL,
  balance_after numeric(12, 2) NOT NULL,
  reference_type varchar(32) NULL,
  reference_id uuid NULL,
  idempotency_key varchar(160) NOT NULL,
  remark text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS ix_farmer_wallet_ledger_user
  ON farmer_wallet_ledger (tenant_id, user_id, created_at DESC);

-- 若历史上存在不完整/占位的 farmer_card（无 user_id），CREATE TABLE IF NOT EXISTS 会跳过建表，后续索引会失败
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'farmer_card'
  )
  AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'farmer_card' AND column_name = 'user_id'
  ) THEN
    DROP TABLE farmer_card CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS farmer_card (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  user_id uuid NOT NULL REFERENCES sys_user(id),
  card_token varchar(64) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'active',
  label varchar(128) NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, card_token)
);

CREATE INDEX IF NOT EXISTS ix_farmer_card_user ON farmer_card (tenant_id, user_id);

-- 种子农户 101 初始余额，便于刷卡 UAT（与 reference-only 重置兼容）
INSERT INTO farmer_wallet (tenant_id, user_id, balance)
VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000101', 100.00)
ON CONFLICT (tenant_id, user_id) DO NOTHING;

INSERT INTO farmer_card (tenant_id, user_id, card_token, status, label)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000101',
  'FCARD-S01-DEMO',
  'active',
  'UAT 演示卡'
)
ON CONFLICT (tenant_id, card_token) DO NOTHING;
