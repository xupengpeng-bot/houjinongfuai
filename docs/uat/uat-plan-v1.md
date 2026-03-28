# UAT Plan v1

## 三层验证机制
1. 协议模拟器验证
2. 后端 integration/e2e
3. 本地有头浏览器 UAT

## 当前执行批次
第1批只交付：
- 文档
- migration
- 测试骨架
- 协议模拟器骨架

## 主链兼容要求
在进入第2批前，现有页面必须继续兼容：
- `/u/scan`
- `/u/session`
- `/u/history`
- `/ops/orders`
- `/ops/sessions`

## 模拟器场景清单
- `steady_60s`
- `jitter_45_75`
- `duplicate_packet`
- `out_of_order_packet`
- `delayed_delivery`
- `power_loss_no_stop`
- `disconnect_reconnect`
- `clock_drift_plus_120s`
- `alarm_during_runtime`
- `multi_device_parallel`
- `card_order_happy_path`
- `qr_order_happy_path`
- `qr_paid_but_start_failed_refund`
- `card_hold_then_start_failed_release`
- `prepaid_exhaust_auto_stop`
- `offline_timeout_auto_end`

## 第2批 UAT 关注点
- 刷卡成功启动、运行、结束
- 扫码支付成功启动、运行、结束
- 启动失败释放/退款
- TIME / ENERGY / FLOW 正常累加
- 重复包不重复扣费
- 乱序包不破坏状态机
- 10 分钟不上报自动结束
- 同 IMEI 新连接覆盖旧连接

## 第3批交付
- Playwright 本地有头浏览器执行资产
- 截图 / trace / 报告
- 执行结果清单
