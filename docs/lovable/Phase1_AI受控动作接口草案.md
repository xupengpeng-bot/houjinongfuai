# Phase 1 AI 受控动作接口草案

> 联调冻结版 v1.0 | 2026-03-21
> Phase 1 仅预留接口定义，不实现 AI 网关
> Phase 2 接入 App 内 AI 对话 1.0

---

## 准入原则

| 规则 | 说明 |
|------|------|
| 白名单制 | AI 仅可调用下列 5 个受控动作，其余一律拒绝 |
| 无设备控制 | AI 不可发送任何设备命令(开泵/关泵/开阀/关阀/重启) |
| 只读优先 | 查询类动作为只读；提交工单为唯一写入动作 |
| 后端鉴权 | 所有动作需经后端 AI Gateway 鉴权，前端不直传设备 |
| 审计追踪 | 每次 AI 动作写入 audit_log，source=ai_gateway |

---

## 受控动作列表

### 1. FAQ 查询
```
POST /api/v1/ai/actions/faq
Authorization: Bearer <user_token>

Request:
{
  "question": "如何扫码用水？"
}

Response:
{
  "action": "faq",
  "answer": "打开农户端首页，点击扫码...",
  "source": "faq_knowledge_base",
  "confidence": 0.95
}
```
| 权限 | 所有角色 |
| 读写 | 只读 |
| 数据范围 | FAQ 知识库 |

### 2. 查会话
```
POST /api/v1/ai/actions/query-session
Authorization: Bearer <user_token>

Request:
{
  "type": "active" | "history",
  "sessionId?": "RS001",
  "dateRange?": { "from": "2024-03-01", "to": "2024-03-20" }
}

Response:
{
  "action": "query_session",
  "sessions": [
    {
      "id": "RS001",
      "wellName": "东风1号井",
      "startTime": "2024-03-20 08:12",
      "flow": 42.5,
      "status": "running"
    }
  ]
}
```
| 权限 | farmer: 仅自己的会话; operator/admin: 按区域/全部 |
| 读写 | 只读 |
| 数据范围 | run_sessions 表，按 user_id 过滤 |

### 3. 查订单
```
POST /api/v1/ai/actions/query-order
Authorization: Bearer <user_token>

Request:
{
  "orderId?": "ORD20240320001",
  "dateRange?": { "from": "2024-03-01", "to": "2024-03-20" },
  "status?": "completed"
}

Response:
{
  "action": "query_order",
  "orders": [
    {
      "id": "ORD20240320001",
      "wellName": "东风1号井",
      "usage": 42.5,
      "unit": "m³",
      "amount": 19.13,
      "status": "completed"
    }
  ]
}
```
| 权限 | farmer: 仅自己的订单; operator/admin: 按区域/全部 |
| 读写 | 只读 |
| 数据范围 | orders 表，按 user_id 过滤 |

### 4. 提交工单
```
POST /api/v1/ai/actions/submit-work-order
Authorization: Bearer <user_token>

Request:
{
  "title": "东风1号井水表显示异常",
  "type": "故障上报",
  "description": "水表读数与实际用水量不符",
  "wellId?": "W001",
  "deviceId?": "D00001"
}

Response:
{
  "action": "submit_work_order",
  "workOrderId": "WO20240321001",
  "status": "created",
  "message": "工单已创建，编号 WO20240321001"
}
```
| 权限 | 所有角色 |
| 读写 | **写入**（唯一写入动作） |
| 数据范围 | work_orders 表 |
| 限制 | 每用户每小时最多 5 单 |

### 5. 转人工
```
POST /api/v1/ai/actions/transfer-human
Authorization: Bearer <user_token>

Request:
{
  "reason": "计费问题，AI 无法解答",
  "context?": "用户询问了3次计费规则但不满意答案"
}

Response:
{
  "action": "transfer_human",
  "ticketId": "HT20240321001",
  "queuePosition": 3,
  "estimatedWait": "约5分钟",
  "message": "已转接人工客服，您排在第3位"
}
```
| 权限 | 所有角色 |
| 读写 | 写入(创建客服工单) |
| 数据范围 | human_transfer_tickets 表 |

---

## 禁止动作列表（硬编码拒绝）

| 动作 | 拒绝原因 |
|------|----------|
| 开泵 pump_start | 设备控制必须经会话引擎 |
| 关泵 pump_stop | 同上 |
| 开阀 valve_open | 同上 |
| 关阀 valve_close | 同上 |
| 重启设备 reboot | 需管理员手动测试页操作 |
| 修改策略 | 规则变更需管理员在规则中心操作 |
| 修改计费 | 同上 |
| 删除数据 | 任何删除操作 |
| 用户管理 | 权限变更需管理员操作 |

---

## 网关架构（Phase 2 实现）

```
农户端/运维端
    ↓
AI Gateway (Edge Function)
    ├── 鉴权: 验证 JWT + 角色
    ├── 路由: action 白名单匹配
    ├── 执行: 调用对应内部 API
    ├── 审计: 写入 audit_log
    └── 返回: 结构化响应
```

前端在 Phase 1 只展示入口 UI，点击提示"Phase 2 上线"。
