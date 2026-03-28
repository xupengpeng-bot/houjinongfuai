# Settlement Rules v1

## 目标
定义 Phase 1 统一结算规则，支持：
- `CARD_HOLD`
- `QR_PREPAID`
- `TIME`
- `ENERGY`
- `FLOW`

## 核心原则
- 结算以设备上报为主，不按固定 60 秒定时推演
- 60 秒只是名义上报周期，不代表固定结算周期
- 所有结算必须可审计、可回放、可幂等

## 计费依据优先级
1. 设备累计量差分
2. 设备事件时间差
3. 服务器接收时间兜底

### TIME
- 优先：`cumulative_runtime_sec` 差分
- 其次：`device_ts` 差分
- 最后：`server_rx_ts` 差分

### ENERGY
- 优先：`cumulative_energy_wh / cumulative_energy_kwh` 差分
- 否则退化为异常或保守策略

### FLOW
- 优先：`cumulative_flow` 差分
- 否则退化为异常或保守策略

## 结算切片
每个有效运行事件都应产生一个或零个 `settlement slice`。

最小字段：
- `order_id`
- `session_id`
- `imei`
- `seq_no`
- `settle_basis`
- `basis_type`
- `period_start_ts`
- `period_end_ts`
- `delta_usage`
- `delta_amount`
- `pricing_snapshot_json`
- `source_msg_id`
- `idempotency_key`
- `created_at`

## 资金模式
### CARD_HOLD
- 建单后锁定当前可用余额
- 锁定余额是本单可用上限
- 启动失败释放全部锁定
- 运行中按 slice 递增扣减
- 预计下一段会超出可用锁定金额时，提前停机

### QR_PREPAID
- 支付成功前绝不启动
- 支付成功写入预付资金
- 预付金额是本单可用上限
- 启动失败全额退款
- 累计金额接近或达到预付上限时，自动停机
- 结束时退回未使用部分

## 离线超时
- `offline_timeout_sec = 600`
- 连续 10 分钟没有有效 heartbeat / tick / state_snapshot，则自动结束
- 只结算到最后可信上报点
- 不补扣到平台发现离线的当前时间
- 结束原因：`OFFLINE_TIMEOUT_AUTO_END`

## gap 上限
- `max_creditable_gap_sec = 180`
- 仅在只能依赖时间差兜底时使用
- 超过上限不无限补扣，转异常待审或保守处理

## 幂等冲突源
- 重复包
- 乱序重放
- stop 与 timeout 收口撞车
- 定时补偿重试

## Phase 1 限制
- 每个价格包只定义一个主计费维度
- 不做复杂混合多维计费包
