-- Link demo wells to the demo project_block from 004_block_metering_network_skeleton.sql (additive).

UPDATE well
SET block_id = '00000000-0000-0000-0000-000000000a01',
    updated_at = now()
WHERE id IN (
  '00000000-0000-0000-0000-000000000501',
  '00000000-0000-0000-0000-000000000507'
)
  AND block_id IS NULL;
