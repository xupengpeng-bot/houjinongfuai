# 鎺у埗鍣ㄥ鐢ㄤ笌宓屽叆寮忔帴鍙ｈ鍒?v1

## 1. 缁撹鍏堣

閽堝 [鍚庣ǚ鏁板啘杩滅▼鏅烘収鐏屾簤鎺у埗鍣ㄥ師鐞嗗浘(1).pdf](D:/Develop/hardware/new/鍚庣ǚ鏁板啘杩滅▼鏅烘収鐏屾簤鎺у埗鍣ㄥ師鐞嗗浘(1).pdf) 杩欏潡鏉匡紝鎴戠殑缁撹鏄細

- 鍙锛屽彲浠ヤ綔涓?Phase 1 鐨勪富鎺ф澘锛岃鐩栫粷澶ч儴鍒嗘満浜曘€佹车绔欍€佸崟璺榾鎺с€佸熀纭€閲囬泦鍦烘櫙銆?- 浣嗕笉寤鸿鎶婂畠瀹氫箟鎴愨€滃敮涓€缁堝眬纭欢鈥濄€傛洿鍚堢悊鐨勫畾浣嶆槸锛?  - 鍏堜綔涓?`H2 閫氱敤姘存簮鎺у埗鍣╜ 鐨勪富鏉?  - 鍦ㄤ綆鎵归噺闃舵鍏煎 `H3 鍗曡矾闃€鎺х粓绔痐
  - 绛夊崟璺榾鎺ч噺涓婃潵鍚庯紝鍐嶆媶鍑烘洿杞汇€佹洿浣庡姛鑰椼€佹洿浣?BOM 鐨勪笓鐢ㄩ榾鎺ф澘
- 骞冲彴鍜屽浐浠朵笉瑕佹寜鈥滀笉鍚屼笟鍔″仛涓嶅悓鏉库€濆幓璁捐锛岃€岃鎸夛細
  - 鍚屼竴鍧楁澘
  - 澶氫釜鍥轰欢妗ｄ綅
  - 鍚屼竴濂楀寳鍚戝崗璁?  - 涓嶅悓鐨勯€氶亾閰嶇疆妯℃澘

涓€鍙ヨ瘽鍒ゆ柇锛?
- 杩欏潡鏉胯冻澶熷仛鈥滅幇闃舵涓绘澘鈥?- 涓嶉€傚悎纭墰鈥滄墍鏈夐暱鏈?SKU鈥?- 鐜板湪鏈€椤虹殑绛栫暐鏄€滅‖浠跺厛澶嶇敤锛屾帴鍙ｅ厛缁熶竴锛孲KU 鍚庡垎鍖栤€?
## 2. 杩欏潡鏉块€傚悎鎵挎帴鍝簺涓氬姟

缁撳悎鍥剧焊鍐呭锛岃繖鍧楁澘褰撳墠鍏峰锛?
- `STM32F103C8T6` 涓绘帶
- `4G` 閫氫俊
- `RS485`
- `LoRa`
- `2` 璺墽琛岄┍鍔?- `2` 璺户鐢靛櫒
- 澶槼鑳?+ 鐢垫睜 + 澶氳矾鐢垫簮鏍?
瀹冩瘮杈冮€傚悎鎵挎帴杩欎簺鍦烘櫙锛?
1. `鏈轰簳涓绘帶`
   - 鍚仠娉?   - 閲囬泦鍘嬪姏銆佹祦閲忋€佹恫浣嶃€佺數婧愮姸鎬?   - 瀵规帴鎺ヨЕ鍣ㄣ€佽蒋鍚姩鎴栧彉棰戝櫒

2. `鍗曟车娉电珯涓绘帶`
   - 1 鍙颁富娉垫帶鍒?   - 1 缁勫帇鍔?娴侀噺閲囬泦
   - 1 缁勮繙绋嬪憡璀?
3. `鍗曡矾闃€鎺
   - 鍗曚釜鐢电闃€
   - 鍗曚釜闂搁榾鎵ц鍣?   - 鍗曟敮璺帶鍒剁偣

4. `閲囬泦鐩戞祴`
   - 鍘嬪姏
   - 娴侀噺
   - 娑蹭綅
   - 鍩虹鐜閲?
5. `灏忓瀷涓€浣撶偣浣峘
   - 鏈轰簳 + 鍘嬪姏/娴侀噺
   - 灏忔车绔?+ 闃€闂?   - 鎺у埗鐐?+ 浼犳劅鍣?
## 3. 杩欏潡鏉夸笉閫傚悎纭墰鍝簺鍦烘櫙

濡傛灉缁х画寮鸿涓€鏉垮埌搴曪紝鍚庨潰浼氭瘮杈冨悆鍔涚殑鍦烘櫙鏈夛細

1. `澶ц妯″崟璺榾鎺
   - 褰撳墠鏉垮姛鑳藉亸閲?   - BOM 鍋忛珮
   - 鍔熻€楀亸楂?   - 瀵圭函闃€鎺х粓绔潵璇存氮璐规槑鏄?
2. `瓒呬綆鍔熻€楃數姹犺妭鐐筦
   - 4G + LoRa + 鍙岄┍鍔?+ 澶氱數婧愮殑缁勫悎锛屼笉閫傚悎鏋佽嚧浣庡姛鑰?
3. `涓€绔欏鎺у埗鍣ㄨ仛鍚坄
   - 涓€涓车绔欐寕寰堝闃€鎺с€侀噰闆嗐€佹墿灞?IO 鏃讹紝鏇撮€傚悎绔欑骇缃戝叧 + 瀛愭帶鍒跺櫒妯″紡

4. `澶氳矾闃€缇ゆ帶鍒禶
   - 褰撳墠鍥剧焊鏄弻鎵ц鑳藉姏锛屼笉閫傚悎澶ц妯″璺榾缇ょ粓绔?
## 4. 鎺ㄨ崘瀹氫綅

### 4.1 褰撳墠闃舵鐨勭‖浠跺畾浣?
寤鸿鎶婅繖鍧楁澘瀹氫箟涓猴細

- 涓诲畾浣嶏細`H2 閫氱敤姘存簮鎺у埗鍣╜
- 鍏煎瀹氫綅锛歚H3 鍗曡矾闃€鎺х粓绔紙杩囨浮闃舵锛塦

涓嶈鎶婂畠鐩存帴瀹氫箟鎴愶細

- 鏈轰簳涓撶敤鏉?- 娉电珯涓撶敤鏉?- 闃€鎺т笓鐢ㄦ澘
- 閲囬泦涓撶敤鏉?
杩欎簺閮藉簲璇ユ槸骞冲彴涓婄殑 `controller_role` 鎴栧浐浠?`profile`锛屼笉鏄‖浠跺瀷鍙枫€?
### 4.2 寤鸿鍐荤粨鐨勫浐浠舵。浣?
鍚屼竴鍧楁澘锛屽缓璁厛鍐荤粨 `4` 涓浐浠舵。浣嶏細

1. `FW_WELL_CTRL`
   - 鏈轰簳涓绘帶

2. `FW_PUMP_CTRL`
   - 娉电珯涓绘帶

3. `FW_VALVE_SINGLE`
   - 鍗曡矾闃€鎺?
4. `FW_MONITOR_ONLY`
   - 绾噰闆?
骞冲彴鐪嬪埌鐨勬槸锛?
- `controller_role`
- `firmware_profile`
- `channel_map`

鑰屼笉鏄厛闂€滆繖鏄摢鍧楁澘鈥濄€?
## 5. 骞冲彴瀵硅薄妯″瀷鎬庝箞鏄犲皠鍒扮‖浠?
褰撳墠骞冲彴涓荤嚎宸茬粡纭畾涓猴細

- `鐐逛綅 -> 鎺у埗鍣?-> 缁堢鍗曞厓`

杩欏潡鏉挎帴鍏ュ悗锛屽缓璁槧灏勪负锛?
### 5.1 涓氬姟妯″瀷

- `鐐逛綅`
  - 鏈轰簳
  - 娉电珯
  - 鎺у埗鐐?  - 鐩戞祴鐐?
- `鎺у埗鍣╜
  - 灏辨槸杩欏潡鏉挎湰韬?
- `缁堢鍗曞厓`
  - 娉?  - 闃€
  - 鍘嬪姏
  - 娴侀噺
  - 娑蹭綅
  - 杩滅▼杈撳叆
  - 杩滅▼杈撳嚭

### 5.2 鍗楀悜纭欢妯″瀷

- `controller`
  - 鏉跨骇韬唤
  - 涓€涓?IMEI
  - 涓€涓浐浠?profile

- `channel`
  - 鎵ц閫氶亾
  - 閲囬泦閫氶亾
  - 鎵╁睍鎬荤嚎閫氶亾

- `subdevice`
  - 鍙€?  - 鐢ㄤ簬琛ㄧず涓嬫寕 RS485 浠〃銆佸鎺ヤ紶鎰熷櫒銆佸鎺ユ墽琛屽櫒

### 5.3 鎺ㄨ崘鍏崇郴

- 涓€涓偣浣?`1:1` 涓€涓富鎺у埗鍣?- 涓€涓帶鍒跺櫒 `1:N` 涓€氶亾
- 涓€涓€氶亾 `0..1` 缁戝畾涓€涓粓绔崟鍏?- 涓€涓粓绔崟鍏?`0..1` 鍏宠仈涓€涓祫浜?
鍏抽敭鐐癸細

- 骞冲彴杩愯渚濊禆 `鎺у埗鍣?+ 閫氶亾 + 缁堢鍗曞厓`
- 涓嶄緷璧栬祫浜у厛寤哄ソ

## 6. 宓屽叆寮忔帴鍙ｈ鍒?
## 6.1 鍗忚涓荤嚎

涓嶅彟璧峰崗璁紝缁х画娌跨敤锛?
- [device-protocol-v1.md](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/device-protocol-v1.md)
- 鍗忚锛歚tcp-json-v1`
- 浼犺緭锛歚TCP 闀胯繛鎺
- 缂栫爜锛歚4 瀛楄妭澶х闀垮害澶?+ UTF-8 JSON`

杩欐瑕佸仛鐨勪笉鏄崲鍗忚锛岃€屾槸琛ラ綈锛?
- 鎺у埗鍣ㄨ韩浠藉瓧娈?- 閫氶亾琛ㄨ揪
- 鍛戒护缁嗗垎
- 骞冲彴浜や簰瑙勫垯

## 6.2 鎺у埗鍣ㄦ敞鍐屽瓧娈?
璁惧棣栨娉ㄥ唽鏃讹紝寤鸿鏈€灏戝甫杩欎簺瀛楁锛?
```json
{
  "protocol_version": "tcp-json-v1",
  "msg_type": "REGISTER",
  "imei": "860000000000001",
  "msg_id": "MSG-000001",
  "seq_no": 1,
  "device_ts": "2026-04-07T10:00:00Z",
  "payload": {
    "hardware_sku": "H2",
    "hardware_rev": "A1",
    "firmware_version": "1.0.0",
    "firmware_profile": "FW_WELL_CTRL",
    "controller_role": "water_source_controller",
    "deployment_mode": "standalone",
    "iccid": "898600xxxxxxxxxxxx",
    "board_serial_no": "B202604070001",
    "power_mode": "solar_battery",
    "capabilities": [
      "pump_control",
      "relay_output",
      "analog_input",
      "rs485",
      "4g"
    ]
  }
}
```

寤鸿鎶婁笅闈㈣繖浜涘瓧娈靛浐瀹氫笅鏉ワ細

- `hardware_sku`
- `hardware_rev`
- `firmware_version`
- `firmware_profile`
- `controller_role`
- `deployment_mode`
- `capabilities`

杩欐牱骞冲彴鑳芥槑纭尯鍒嗭細

- 杩欐槸浠€涔堢‖浠?- 鐑х殑鏄粈涔堝浐浠?- 鍦ㄦ壙鎷呬粈涔堜笟鍔¤鑹?- 鍏峰鍝簺鑳藉姏

## 6.3 閫氶亾妯″瀷

寤鸿鎵€鏈夋墽琛屽拰閲囬泦閮界粺涓€鎴愨€滈€氶亾鈥濄€?
鎺ㄨ崘瀛楁锛?
```json
{
  "channel_code": "CH_MOTOR_1",
  "channel_type": "actuator",
  "channel_role": "pump",
  "io_kind": "motor_driver",
  "enabled": true,
  "state": "OFF",
  "feedback_state": "IDLE",
  "bind_target_code": "e0-pump-1"
}
```

寤鸿鍐荤粨鐨勯€氶亾绫诲瀷锛?
- `motor_driver`
- `relay_output`
- `digital_input`
- `analog_input`
- `pulse_input`
- `rs485_slave`
- `sensor_input`

寤鸿鍐荤粨鐨勯€氶亾瑙掕壊锛?
- `pump`
- `valve`
- `pressure_sensor`
- `flow_sensor`
- `level_sensor`
- `power_sensor`
- `status_feedback`
- `reserved`

### 6.4 杩欏潡鏉垮缓璁粯璁ゆ毚闇茬殑閫昏緫閫氶亾

鍗充娇纭欢鍙ｄ笉瀹屽叏涓€鑷达紝涔熷缓璁湪鍥轰欢閲岀粺涓€鎶借薄鎴愶細

1. `CH_MOTOR_1`
2. `CH_MOTOR_2`
3. `CH_RELAY_1`
4. `CH_RELAY_2`
5. `CH_RS485_1`
6. `CH_AI_1`
7. `CH_AI_2`
8. `CH_DI_1`
9. `CH_DI_2`
10. `CH_PWR_1`

骞冲彴涓嶅叧蹇冭姱鐗囪剼浣嶏紝鍙叧蹇冮€昏緫閫氶亾銆?
## 6.5 涓婅娑堟伅寤鸿

缁х画娌跨敤鐜版湁涓绘秷鎭被鍨嬶細

- `REGISTER`
- `HEARTBEAT`
- `STATE_SNAPSHOT`
- `RUNTIME_TICK`
- `RUNTIME_STOPPED`
- `ALARM_REPORT`
- `COMMAND_ACK`
- `COMMAND_NACK`

浣嗗缓璁湪 `payload` 閲岀粺涓€琛?`channels`锛?
```json
{
  "msg_type": "STATE_SNAPSHOT",
  "payload": {
    "controller_state": {
      "online": true,
      "run_state": "IDLE",
      "power_state": "ON"
    },
    "channels": [
      {
        "channel_code": "CH_MOTOR_1",
        "channel_role": "pump",
        "state": "OFF",
        "feedback_state": "STOPPED"
      },
      {
        "channel_code": "CH_AI_1",
        "channel_role": "pressure_sensor",
        "value": 0.32,
        "unit": "MPa"
      }
    ]
  }
}
```

杩欐牱鍋氱殑濂藉鏄細

- 鍗忚涓荤嚎涓嶅彉
- 骞冲彴鑳界湅鍒板叿浣撴帶鍒堕€氶亾鍜岄噰闆嗛€氶亾
- 鏈轰簳銆佹车绔欍€侀榾鎺с€侀噰闆嗗彲浠ュ叡鐢ㄥ悓涓€濂楁姤鏂囬鏋?
## 6.6 涓嬭鍛戒护寤鸿

涓嶅缓璁幇鍦ㄦ柊澧炲緢澶氭柊鐨?`msg_type`銆? 
缁х画娌跨敤鐜版湁涓嬭涓荤被鍨嬶細

- `START_COMMAND`
- `STOP_COMMAND`
- `QUERY_STATE`

缁嗗垎鍔ㄤ綔鏀惧埌 `payload.command_code`銆?
### 6.6.1 寤鸿鍐荤粨鐨?`command_code`

- `START_PUMP`
- `STOP_PUMP`
- `OPEN_VALVE`
- `CLOSE_VALVE`
- `SET_RELAY_STATE`
- `QUERY_CHANNEL_STATE`
- `SYNC_CONFIG`
- `APPLY_PROFILE`
- `REBOOT_DEVICE`
- `SYNC_CLOCK`

### 6.6.2 寤鸿鐨勪笅琛屽懡浠ょ粨鏋?
```json
{
  "protocol_version": "tcp-json-v1",
  "msg_type": "START_COMMAND",
  "imei": "860000000000001",
  "msg_id": "CMD-000001",
  "seq_no": 1002,
  "device_ts": "2026-04-07T10:05:00Z",
  "payload": {
    "command_id": "C202604070001",
    "command_code": "OPEN_VALVE",
    "target_channel_code": "CH_RELAY_1",
    "target_state": "ON",
    "expire_at": "2026-04-07T10:05:30Z",
    "reason": "manual_debug"
  }
}
```

## 6.7 ACK / NACK 瑙勫垯

杩欎竴鏉″繀椤绘槑纭細

- `ACK` 鍙〃绀衡€滃懡浠ゅ凡鎺ユ敹骞舵帴鍙楁墽琛屸€?- 涓嶈〃绀轰笟鍔″凡缁忓畬鎴?
渚嬪锛?
- 骞冲彴涓嬪彂 `OPEN_VALVE`
- 璁惧杩斿洖 `COMMAND_ACK`
- 鍙兘璇存槑璁惧宸叉帴鍗?- 鏄惁鐪熸鍒颁綅锛岃鐪嬶細
  - 鍚庣画 `STATE_SNAPSHOT`
  - 鍚庣画 `RUNTIME_TICK`
  - 鎴栨渶缁堢殑 `RUNTIME_STOPPED`

寤鸿瑙勫垯锛?
- `COMMAND_ACK` 蹇呴』甯︼細
  - `command_id`
  - `command_code`
  - `accept_state`
  - `target_channel_code`
- `COMMAND_NACK` 蹇呴』甯︼細
  - `command_id`
  - `command_code`
  - `reject_code`
  - `reject_reason`

寤鸿鍐荤粨鐨?`reject_code`锛?
- `DEVICE_BUSY`
- `UNSUPPORTED_COMMAND`
- `INVALID_CHANNEL`
- `SAFETY_INTERLOCK`
- `LOW_BATTERY`
- `POWER_NOT_READY`
- `SENSOR_REQUIRED`
- `PARAM_INVALID`
- `EXPIRED_COMMAND`

## 6.8 鍛婅涓庢晠闅滆鍒?
涓嶈璁╁浐浠惰嚜鐢辨嫾瀛楃涓诧紝寤鸿鍥哄寲绂绘暎鐮併€?
鑷冲皯鍏堝喕缁撹繖浜涳細

- `PUMP_START_FAILED`
- `VALVE_OPEN_TIMEOUT`
- `VALVE_CLOSE_TIMEOUT`
- `PRESSURE_LOW`
- `PRESSURE_HIGH`
- `FLOW_LOW`
- `FLOW_ABNORMAL`
- `LEVEL_LOW`
- `POWER_LOW`
- `BATTERY_LOW`
- `SOLAR_CHARGE_ABNORMAL`
- `RS485_DEVICE_OFFLINE`
- `MCU_WATCHDOG_RESET`
- `COMMUNICATION_RECONNECT`

## 7. 骞冲彴浜や簰瑙勫垯

## 7.1 娉ㄥ唽涓庡叆缃?
寤鸿娴佺▼锛?
1. 璁惧棣栨涓婄數杩炴帴骞冲彴
2. 鍙戦€?`REGISTER`
3. 骞冲彴鏍规嵁 `imei` 鎵炬帶鍒跺櫒璁板綍
4. 鑻ュ瓨鍦細
   - 缁戝畾杩炴帴
   - 鏍￠獙鍥轰欢 profile 鍜岃鑹?5. 鑻ヤ笉瀛樺湪锛?   - 杩涘叆寰呰棰嗘垨寰呭鏍哥姸鎬?
骞冲彴渚т笉瑕佹寜鈥滄澘瀛愬瀷鍙封€濆仛涓氬姟璇嗗埆锛岃€岃鎸夛細

- `imei`
- `controller_role`
- `firmware_profile`

## 7.2 蹇冭烦瑙勫垯

寤鸿锛?
- 绌洪棽鎬?`60s` 涓€娆?`HEARTBEAT`
- 杩愯鎬?`15s` 涓€娆?`RUNTIME_TICK`
- 杩愯鎬佷笅 `HEARTBEAT` 鍙互闄嶉
- `600s` 鏈敹鍒板績璺虫垨杩愯鎬佷笂鎶ワ紝鍒ょ绾?
## 7.3 鐘舵€佸揩鐓ц鍒?
浠ヤ笅鍦烘櫙蹇呴』涓婃姤 `STATE_SNAPSHOT`锛?
- 娉ㄥ唽瀹屾垚鍚?- 骞冲彴 `QUERY_STATE` 鍚?- 閰嶇疆鍚屾鍚?- 鍛戒护鎵ц鍓嶅悗
- 閲嶈繛鍚?
杩欎唤蹇収閲屽繀椤诲甫锛?
- 鎺у埗鍣ㄦ暣浣撶姸鎬?- 閫氶亾鐘舵€?- 鍏抽敭浼犳劅鍣ㄥ€?- 褰撳墠鍥轰欢妗ｄ綅
- 鍏抽敭鍛婅鐮?
## 7.4 鍛戒护鎵ц瑙勫垯

骞冲彴涓嬪彂鍛戒护鍚庯紝寤鸿璁惧渚ц涓哄浐瀹氫负锛?
1. 鍏堝仛鏈湴瀹夊叏鏍￠獙
2. 鍙墽琛屽垯绔嬪嵆 `ACK`
3. 涓嶅彲鎵ц鍒欑珛鍗?`NACK`
4. 鎵ц瀹屾垚鍚庨€氳繃鐘舵€佷笂鎶ュ弽鏄犵粨鏋?
涓嶈璁╄澶囩瓑鎵ц瀹屽啀鍥?ACK銆? 
鍚﹀垯骞冲彴渚у緢闅惧尯鍒嗭細

- 缃戠粶鎱?- 鍛戒护娌℃敹鍒?- 杩樻槸鍛戒护姝ｅ湪鎵ц

## 7.5 骞傜瓑涓庝贡搴?
缁х画娌跨敤鐜版湁鍩虹嚎锛?
- 骞傜瓑閿紭鍏?`imei + msg_id`
- 娆￠€?`imei + seq_no + msg_type`

寤鸿璁惧渚ц鍒欙細

- 鍚屼竴杩炴帴鍐?`seq_no` 鍗曡皟閫掑
- 閲嶅惎鍚庡厑璁镐粠杈冨皬鍊奸噸鏂板紑濮?- `msg_id` 鍏ㄥ眬鍞竴锛岃嚦灏戝湪鏈€杩?`7` 澶╁唴涓嶈兘閲嶅

## 7.6 閰嶇疆鍚屾瑙勫垯

骞冲彴涓嶈姣忔閮戒笅鍙戝ぇ閰嶇疆銆? 
寤鸿鍋氭垚鐗堟湰鍖栧悓姝ワ細

- 骞冲彴淇濆瓨 `config_version`
- 璁惧鏈湴涔熶繚瀛?`config_version`
- 娉ㄥ唽鍜岀姸鎬佸揩鐓ф椂甯﹀綋鍓嶇増鏈?- 涓嶄竴鑷存椂骞冲彴涓嬪彂 `SYNC_CONFIG`

`SYNC_CONFIG` 寤鸿鍐呭锛?
- `firmware_profile`
- 閫氶亾鍚敤鐘舵€?- 閫氶亾瑙掕壊鏄犲皠
- 閲囨牱鍛ㄦ湡
- 蹇冭烦鍛ㄦ湡
- 鍛婅闃堝€?- 鎺у埗瓒呮椂

## 7.7 鏃堕棿鍚屾瑙勫垯

寤鸿鎵€鏈夎澶囩粺涓€锛?
- 璁惧鍐呴儴浣跨敤 `UTC`
- 骞冲彴灞曠ず鏃跺啀杞湰鍦版椂鍖?- 婕傜Щ瓒呰繃 `300s` 鑷姩瑙﹀彂 `SYNC_CLOCK`

## 8. 杩欏潡鏉挎€庝箞鐢ㄦ渶椤?
## 8.1 Phase 1 鎺ㄨ崘鍋氭硶

寤鸿鐩存帴杩欐牱钀斤細

1. 纭欢鍏堝彧淇濈暀杩欎竴涓富鏉?2. 鍥轰欢鍏堝仛 `FW_WELL_CTRL` 鍜?`FW_VALVE_SINGLE`
3. 骞冲彴鍏堟帴锛?   - 鎺у埗鍣ㄦ敞鍐?   - 閫氶亾鐘舵€佷笂鎶?   - 寮€娉?鍋滄车
   - 寮€闃€/鍏抽榾
   - 鍘嬪姏/娴侀噺閲囬泦
4. `LoRa` 鍜岃闊冲姛鑳藉厛涓嶅仛涓绘祦绋嬩緷璧?
## 8.2 涓轰粈涔堣繖鏍锋渶椤?
- 鑳芥渶蹇妸纭欢鍜屽钩鍙板厛鎵撻€?- 涓嶄細琚€滄槸涓嶆槸瑕佸仛寰堝鏉库€濆崱浣?- 鐜板満鏈轰簳鍜屽崟璺榾鎺ц兘鍏辩敤缁濆ぇ閮ㄥ垎鍗忚楠ㄦ灦
- 鍚庨潰瑕佹媶涓撶敤闃€鎺ф澘鏃讹紝骞冲彴鍩烘湰涓嶇敤閲嶅啓

## 9. 鎴戝杩欏潡鏉跨殑鍏蜂綋寤鸿

濡傛灉浣犱滑鍑嗗鐪熸嬁杩欏潡鏉挎墰 Phase 1锛屾垜寤鸿纭欢鍜屽浐浠朵笂鑷冲皯琛?4 浠朵簨锛?
1. 澧炲姞鎴栫‘璁?`纭欢鐪嬮棬鐙梎
   - 杩滅▼鎺у埗鍣ㄥ繀椤昏兘鎶楁鏈?
2. 鍔犲己 `鐢垫簮鍏ュ彛鍜岄暱绾垮彛闃叉姢`
   - 澶槼鑳借緭鍏?   - 鐢垫睜杈撳叆
   - 鐢垫満/缁х數鍣ㄨ緭鍑?   - RS485

3. 鎶?`LoRa` 鍜岃闊虫ā鍧楀仛鎴愬彲閫?BOM
   - 涓嶈璁╂墍鏈夊嚭璐ч兘寮虹粦

4. 鍥轰欢蹇呴』鍋?`IO 鎶借薄灞俙
   - 骞冲彴姘歌繙鐪嬮€昏緫閫氶亾
   - 鍥轰欢鍐呴儴鍐嶆槧灏勫埌鍏蜂綋寮曡剼

## 10. 鏈€缁堝缓璁?
鎴戠殑寤鸿鏄細

- 鍙互锛屽氨鐢ㄨ繖鍧楁澘鍏堝疄鐜扮粷澶ч儴鍒嗗姛鑳?- 浣嗚鎶婂畠瀹氫箟鎴愨€滀富鎺у簳鏉库€濓紝涓嶈瀹氫箟鎴愨€滄渶缁堝敮涓€浜у搧鈥?- 骞冲彴鍜屽祵鍏ュ紡鎺ュ彛蹇呴』浠庣涓€澶╁氨鎸夛細
  - `鍚屾澘澶氬浐浠禶
  - `鎺у埗鍣?+ 閫氶亾`
  - `缁熶竴鍖楀悜鍗忚`
  - `鐗堟湰鍖栭厤缃甡
  杩欏鎬濊矾鏉ュ仛

濡傛灉鎸夎繖鏉＄嚎鎺ㄨ繘锛屼笅涓€姝ユ渶鍊煎緱鍐荤粨鐨勬槸锛?
1. `controller_role`
2. `firmware_profile`
3. `channel_code / channel_role / io_kind`
4. `command_code`
5. `alarm_code / reject_code`

杩欎簺瀛楀吀涓€鏃﹀喕缁擄紝鍚庨潰宓屽叆寮忋€佸钩鍙般€佸伐浣滃彴銆佽澶囩鐞嗗氨閮借兘椤鸿捣鏉ャ€?
