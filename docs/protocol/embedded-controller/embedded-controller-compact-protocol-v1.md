# 宓屽叆寮忔帶鍒跺櫒杞婚噺鍗忚瑙勮寖 v1

## 1. 鐩爣

杩欎唤鏂囨。鐢ㄤ簬瀹氫箟涓€濂楁洿鑺備凯銆佹洿绋冲畾銆佹洿閫傚悎 MCU 缁勫寘鐨勮交閲忓崗璁鍒欍€?
鐩爣涓嶆槸鏇夸唬鐜版湁涓氬姟璇箟锛岃€屾槸鎶婂崗璁疄鐜版敹鏁涙垚锛?
- 瀛楁灏介噺鐭?- 蹇呭～瀛楁灏介噺灏?- 鎶ユ枃灞傜骇灏介噺娴?- 浠嶇劧淇濈暀缁撶畻銆佹帶鍒躲€佽拷韪墍闇€鏈€灏忚涔?
杩欏瑙勮寖鐗瑰埆閫傚悎锛?
- RAM 绱у紶
- 涓插彛璋冭瘯澶嶆潅
- 4G 鍙戝寘鎴愭湰鏁忔劅
- 闇€瑕?AI 鏍规嵁浠诲姟涔︾洿鎺ョ敓鎴愬疄鐜颁唬鐮?
## 2. 鎬讳綋鍘熷垯

### 2.1 鏈€灏忓繀濉師鍒?
姣忕鎶ユ枃鍙繚鐣欌€滈┍鍔ㄤ笟鍔￠棴鐜繀闇€鈥濈殑瀛楁銆?
濡傛灉涓€涓瓧娈典笉褰卞搷浠ヤ笅浠讳竴鐩爣锛屽氨涓嶅簲璇ヨ繘鍏ヤ富鍗忚锛?
- 璁惧璇嗗埆
- 鍛戒护鍥炴墽
- 浼氳瘽缁撶畻
- 杩愯鐘舵€?- 鏁呴殰瀹氫綅

### 2.2 鍏堜繚鐣?code锛屼笉淇濈暀鍐椾綑璇存槑

鍗忚閲屼紭鍏堜繚鐣欑煭 code锛屼笉淇濈暀涓枃鍚嶏紝涓嶄繚鐣欓噸澶嶈涔夊瓧娈点€?
渚嬪淇濈暀锛?
- 妯″潡 code
- 鎸囨爣 code
- 鍔ㄤ綔 code

涓嶄繚鐣欙細

- 鍚屼竴涓€肩殑涓枃瑙ｉ噴
- 涓?code 閲嶅鐨勯暱鏂囨

### 2.3 涓€灞傚瓧娈典紭鍏?
浼樺厛浣跨敤骞抽摵缁撴瀯锛屼笉瑕佸祵濂楄繃娣便€?
涓嶆帹鑽愶細

- `payload.common_status.signal.csq`

鎺ㄨ崘锛?
- `p.csq`

### 2.4 瀛楁鑳藉鐢ㄥ氨涓嶆媶鏂板瓧娈?
渚嬪璁￠噺绫诲敖閲忕粺涓€锛?
- `rt`
  杩愯鏃堕暱绱
- `ek`
  绱鐢甸噺 kWh
- `ew`
  绱鐢甸噺 Wh
- `fq`
  绱姘撮噺

## 3. 杞婚噺鍗忚 envelope

寤鸿缁熶竴浣跨敤锛?
```json
{
  "v": 1,
  "t": "HB",
  "i": "864869000000001",
  "m": "001024",
  "s": 1024,
  "c": "A1024",
  "r": "S001",
  "p": {}
}
```

## 4. 椤跺眰瀛楁鏈€灏忛泦

| 瀛楁 | 鍏ㄧО | 蹇呭～ | 璇存槑 |
| --- | --- | --- | --- |
| `v` | protocol_version | 鏄?| 褰撳墠鍥哄畾 `1` |
| `t` | message_type | 鏄?| 鎶ユ枃绫诲瀷 |
| `i` | imei | 鏄?| 璁惧涓昏韩浠?|
| `m` | msg_id | 鏄?| 娑堟伅鍞竴 ID |
| `s` | seq | 鏄?| 鏈湴閫掑搴忓彿 |
| `c` | correlation_id | 鍚?| 鍥炴墽鍏宠仈鍛戒护 ID |
| `r` | session_ref | 鍚?| 杩愯浼氳瘽 ID |
| `p` | payload | 鏄?| 涓氬姟杞借嵎 |

榛樿涓嶈繘涓诲崗璁殑瀛楁锛?
- 闀挎椂闂存埑瀛楃涓?- 鍐椾綑鍗忚鍚?- 閲嶅璁惧鍚?- 涓枃瀛楁
- 涓嶅弬涓庨棴鐜殑灞曠ず瀛楁

## 5. 鎶ユ枃绫诲瀷鐭爜

| 鐭爜 | 鍘熻涔?|
| --- | --- |
| `RG` | REGISTER |
| `HB` | HEARTBEAT |
| `SS` | STATE_SNAPSHOT |
| `ER` | EVENT_REPORT |
| `QR` | QUERY |
| `QS` | QUERY_RESULT |
| `EX` | EXECUTE_ACTION |
| `SC` | SYNC_CONFIG |
| `AK` | COMMAND_ACK |
| `NK` | COMMAND_NACK |

## 6. 杞婚噺瀛楁瀛楀吀

### 6.1 鐘舵€佸瓧娈?
| 鐭瓧娈?| 鍘熻涔?|
| --- | --- |
| `rd` | ready |
| `wf` | workflow_state |
| `on` | online |
| `tc` | tcp_connected |
| `cv` | config_version |
| `csq` | signal_csq |
| `bv` | battery_voltage_v |
| `bs` | battery_soc |
| `sv` | solar_voltage_v |
| `pm` | power_mode |

### 6.2 璁￠噺瀛楁

| 鐭瓧娈?| 鍘熻涔?|
| --- | --- |
| `rt` | cumulative_runtime_sec |
| `ew` | cumulative_energy_wh |
| `ek` | cumulative_energy_kwh |
| `fq` | cumulative_flow |
| `pw` | power_kw |
| `vv` | voltage_v |
| `ia` | current_a |
| `fm` | flow_m3h |
| `pr` | pressure_mpa |

### 6.3 閫氶亾瀛楁

| 鐭瓧娈?| 鍘熻涔?|
| --- | --- |
| `mc` | module_code |
| `cc` | channel_code |
| `mr` | metric_code |
| `v` | value |
| `u` | unit |
| `q` | quality |

### 6.4 鍛戒护瀛楁

| 鐭瓧娈?| 鍘熻涔?|
| --- | --- |
| `sc` | scope |
| `ac` | action_code |
| `qc` | query_code |
| `tr` | target_ref |
| `pm` | params |
| `rc` | reject_code |

## 7. 鏈€灏?payload 缁撴瀯

### 7.1 `RG`

```json
{
  "v": 1,
  "t": "RG",
  "i": "864869000000001",
  "m": "000001",
  "s": 1,
  "p": {
    "hs": "H2",
    "hr": "A1",
    "ff": "FW_H2_UNIFIED",
    "fv": "2.0.0",
    "cv": 3,
    "fm": ["pvc", "prs", "flw"]
  }
}
```

### 7.2 `HB`

```json
{
  "v": 1,
  "t": "HB",
  "i": "864869000000001",
  "m": "000120",
  "s": 120,
  "p": {
    "rd": 1,
    "wf": "RI",
    "cv": 3,
    "csq": 18,
    "bs": 82
  }
}
```

### 7.3 `SS`

```json
{
  "v": 1,
  "t": "SS",
  "i": "864869000000001",
  "m": "000128",
  "s": 128,
  "r": "S001",
  "p": {
    "wf": "RN",
    "rt": 180,
    "ek": 0.52,
    "fq": 4.8,
    "ch": [
      { "mc": "prs", "cc": "ai1", "mr": "pr", "v": 0.45, "u": "MPa", "q": 1 },
      { "mc": "flw", "cc": "pl1", "mr": "fm", "v": 12.4, "u": "m3/h", "q": 1 }
    ]
  }
}
```

### 7.4 `EX`

```json
{
  "v": 1,
  "t": "EX",
  "i": "864869000000001",
  "m": "X2048",
  "s": 2048,
  "c": "CMD2048",
  "r": "S001",
  "p": {
    "sc": "wf",
    "ac": "st",
    "tr": "ctl",
    "pm": {}
  }
}
```

## 8. 妯″潡涓庢寚鏍囩煭鐮佸缓璁?
### 8.1 妯″潡鐭爜

| 鐭爜 | 鍘?code |
| --- | --- |
| `pvc` | pump_vfd_control |
| `pdc` | pump_direct_control |
| `svl` | single_valve_control |
| `ebr` | electric_meter_modbus |
| `prs` | pressure_acquisition |
| `flw` | flow_acquisition |
| `sma` | soil_moisture_acquisition |
| `sta` | soil_temperature_acquisition |
| `pwm` | power_monitoring |
| `pay` | payment_qr_control |
| `cdr` | card_auth_reader |
| `vfb` | valve_feedback_monitor |

### 8.2 workflow 鐘舵€佺煭鐮?
| 鐭爜 | 鍘熺姸鎬?|
| --- | --- |
| `BR` | BOOTING |
| `NR` | ONLINE_NOT_READY |
| `RI` | READY_IDLE |
| `ST` | STARTING |
| `RN` | RUNNING |
| `PS` | PAUSED |
| `SP` | STOPPING |
| `ED` | STOPPED |
| `ER` | ERROR_STOP |

### 8.3 鍔ㄤ綔鐭爜

| 鐭爜 | 鍘熷姩浣?|
| --- | --- |
| `st` | start_session |
| `sp` | stop_session |
| `ps` | pause_session |
| `rs` | resume_session |
| `ov` | open_valve |
| `cv` | close_valve |
| `sv` | start_vfd |
| `tv` | stop_vfd |
| `sf` | set_frequency |

## 9. 鍝簺瀛楁蹇呴』淇濈暀锛屽摢浜涘彲浠ュ垹

### 9.1 蹇呴』淇濈暀

- `i`
- `m`
- `s`
- `t`
- `p`
- `c`
  浠呭鍛戒护鍥炴墽绫诲繀闇€
- `r`
  浠呭浼氳瘽绫诲繀闇€
- `rt / ek / ew / fq`
  鍙瀵瑰簲缁撶畻鍩哄噯鍚敤锛屽氨蹇呴』淇濈暀

### 9.2 鍙互鍒犳帀

- `protocol`
- 闀?`type` 鍚?- 闀垮瓧娈垫敞閲?- 璁惧鍚嶇О
- 椤圭洰鍚嶇О
- 涓枃灞曠ず瀛楁
- 涓庢ā鍧?code 閲嶅鐨勫啑浣欐弿杩?- 涓嶅弬涓庢帶鍒躲€佽閲忋€佺粨绠椼€佹晠闅滈棴鐜殑灞曠ず鍨嬪瓧娈?
## 10. 绮剧畝浣嗕笉鍏佽涓㈢殑涓氬姟璇箟

鍐嶈交閲忎篃涓嶈兘涓㈡帀锛?
- 璁惧韬唤
- 娑堟伅鍘婚噸鑳藉姏
- 鍛戒护鍏宠仈鑳藉姏
- 浼氳瘽鍏宠仈鑳藉姏
- 缁撶畻绱閲?- 鏁呴殰鎷掔粷鐮?
## 11. 鎺ㄨ崘瀹炵幇绛栫暐

- 鍥轰欢鍐呴儴浣跨敤鐭粨鏋勪綋鍜岀煭 JSON key
- 骞冲彴缃戝叧灞傝礋璐ｇ煭瀛楁涓庨暱瀛楁涔嬮棿鐨勬槧灏?- 涓氬姟灞備粛鐒朵娇鐢ㄧ幇鏈夋爣鍑嗛暱 code 瀛樺偍

杩欐牱鍙互鍚屾椂婊¤冻锛?
- MCU 缁勫寘鐪佸瓧鑺?- 骞冲彴璇箟娓呮
- 鍗忚鍙紨杩?
## 12. 涓?AI 瀹炵幇閰嶅悎鐨勮姹?
濡傛灉瑕佽 AI 鐩存帴鐢熸垚鍥轰欢浠ｇ爜锛屼换鍔′功閲屽繀椤诲悓鏃舵彁渚涳細

- 璁惧閫夊瀷妯℃澘
- 纭欢鑳藉姏瀹氫箟
- 绠¤剼鍔熻兘鏄犲皠
- 杞婚噺鍗忚瀛楀吀
- 4G 鍙戝寘瑙勫垯

鍚﹀垯 AI 寰堝鏄擄細

- 鐢熸垚閿欒瀛楁
- 璇敤绠¤剼
- 杈撳嚭鍐椾綑鍗忚

鐩稿叧妯℃澘瑙侊細

- [embedded-controller-task-book-template-v1.md](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-controller-task-book-template-v1.md)
- [embedded-controller-hardware-capability-template-v1.md](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-controller-hardware-capability-template-v1.md)
- [embedded-controller-pin-map-template-v1.md](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-controller-pin-map-template-v1.md)
- [embedded-controller-4g-packet-rules-v1.md](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-controller-4g-packet-rules-v1.md)

