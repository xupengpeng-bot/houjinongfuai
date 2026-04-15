# Embedded Controller Interface Catalog v1

## 1. 鐩爣

鍦ㄤ笉鎺ㄧ炕鐜版湁 `tcp-json-v1` 涓荤嚎鐨勫墠鎻愪笅锛屾妸鍚庣画宓屽叆寮忔帴鍙ｆ敹鎴愪竴濂楀彲鎵╁睍銆佸皯閰嶇疆銆佸彲缁勫悎鐨勭洰褰曘€?
杩欑増閲嶇偣瑙ｅ喅 3 涓棶棰橈細

- 閫氱敤鐘舵€佸拰涓氬姟鑳藉姏娣峰湪涓€璧凤紝鍚庨潰瓒婂姞瓒婁贡
- 浼犳劅閲囬泦銆佹墽琛屾帶鍒剁浉瀵圭畝鍗曪紝浣嗙湡姝ｅ鏉傜殑鏄笟鍔℃祦绋嬮棴鐜?- 鍚屼竴鍧楁澘鍙兘鎵挎媴澶氱鑳藉姏缁勫悎锛屼笉鑳芥寜鈥滀竴涓満鏅竴濂楀崗璁€濆幓瀹氫箟

## 2. 鍙傝€冨熀绾?
### 2.1 鑰佸祵鍏ュ紡/鑰佸钩鍙伴噷鍊煎緱缁ф壙鐨勯儴鍒?
- 閫氱敤璁惧浜や簰涓庝笟鍔″懡浠ゆ槸鍒嗗紑鐨?- 璁惧灏辩华鍓嶄笉鑳芥帴鍙楀惎鍔ㄧ被鍔ㄤ綔
- 鍔ㄤ綔鎴愬姛蹇呴』浠ュ疄闄呮墽琛岀粨鏋滅‘璁わ紝涓嶈兘鍙洖鎺ュ崟鎴愬姛
- 鍋滄満銆佺粨绠椼€佹柇鐢垫仮澶嶈ˉ浼犳槸鐙珛涓氬姟娴佺▼锛屼笉搴旀贩杩涙櫘閫氫紶鎰熸暟鎹?
涓昏鍙傝€冿細

- `D:\Develop\hardware\3.0jijingoldplatform\firmware\APP\network_task.c`
- `D:\Develop\hardware\3.0jijingoldplatform\firmware\APP\ProcessingTasks.c`
- `D:\Develop\hardware\3.0jijingoldplatform\firmware\APP\ElecMeter.h`
- `D:\Develop\hardware\3.0jijingoldplatform\docs\experience\2026-03-11_鏈€缁堝彛寰勬暣鐞?md`
- `D:\Develop\hardware\3.0jijingoldplatform\docs\experience\2026-03-16_鏈轰簳鎺у埗缁堢纭欢闇€姹傝鏍艰鏄庝功_V1.0.md`

### 2.2 褰撳墠骞冲彴閲屽凡缁忓叿澶囩殑鑳藉姏

- 涓诲崗璁凡鍐荤粨涓?`tcp-json-v1`
- 璁惧鍞竴閫氫俊閿凡鍐荤粨涓?`imei`
- 骞冲彴宸叉湁 `device_type.capability_json / default_config_json / form_schema_json`
- 骞冲彴宸叉湁 `device.ext_json`锛屽彲鎵胯浇鎺у埗鍣ㄩ厤缃€佹ā鍧楃粍鍚堛€侀€氶亾缁戝畾鍜屾潵婧愰敋鐐?- 涓讳笟鍔℃ā鍨嬪凡閫愭鏀舵暃涓猴細
  - `鐐逛綅 -> 鎺у埗鍣?-> 缁堢鍗曞厓`

鍙傝€冿細

- `docs/protocol/device-protocol-v1.md`
- `docs/protocol/device-event-model-v1.md`
- `docs/protocol/embedded-controller/embedded-controller-platform-alignment-v1.md`

## 3. 鎬讳綋鍘熷垯

### 3.1 涓嶆槸涓ゅ鍗忚锛岃€屾槸涓€濂楀崗璁笁灞傝涔?
缁熶竴淇濈暀涓€濂椾紶杈撳崗璁拰缁熶竴鎶ユ枃淇″皝锛屽崗璁唴閮ㄥ垎 3 灞傦細

1. 閫氱敤鎺ュ彛灞?2. 妯″潡鎺ュ彛灞?3. 涓氬姟娴佺▼灞?
### 3.2 鍚勫眰鑱岃矗

#### 閫氱敤鎺ュ彛灞?
鍥炵瓟鈥滆繖鍧楁澘瀛愯嚜宸辨€庝箞鏍封€濓細

- 鏄惁鍦ㄧ嚎
- 4G 淇″彿濡備綍
- 閿傜數姹犵數閲忓浣?- 渚涚數妯″紡濡備綍
- 鍥轰欢鐗堟湰鏄灏?- 閰嶇疆鐗堟湰鏄惁鐢熸晥
- 鏉跨骇鏁呴殰鏄粈涔?- 閲嶅惎鍘熷洜鏄粈涔?
#### 妯″潡鎺ュ彛灞?
鍥炵瓟鈥滆繖鍧楁澘褰撳墠鎸備簡鍝簺鑳藉姏妯″潡銆佹瘡涓ā鍧楀綋鍓嶇姸鎬佹€庢牱鈥濓細

- 鍙橀鍣ㄦ帶鍒?- 鍗曡矾闃€鎺?- 鍘嬪姏閲囬泦
- 娴侀噺閲囬泦
- 鐢佃〃閲囬泦
- 鍦熷￥澧掓儏閲囬泦
- 鍦熷￥娓╁害閲囬泦
- 娑蹭綅閲囬泦
- 杩滅▼ IO

#### 涓氬姟娴佺▼灞?
鍥炵瓟鈥滆澶囨槸鍚︽弧瓒充笟鍔¤繍琛岃姹傦紝浠ュ強瀹屾暣涓氬姟闂幆璧板埌浜嗗摢涓€姝モ€濓細

- 鏄惁 ready
- 鏄惁鍏佽鍚姩
- 鍚姩鏄惁鎴愬姛
- 鏆傚仠/鎭㈠鏄惁鎴愬姛
- 鍋滄満鏄惁鎴愬姛
- 鏄惁闇€瑕佺粨绠?- 鎺夌數鎭㈠鏄惁闇€瑕佽ˉ浼?- 褰撳墠浼氳瘽鏄惁寮傚父

## 4. 鎺ㄨ崘鎺ュ彛鐩綍

## 4.1 椤跺眰娑堟伅绫诲瀷

椤跺眰 `msg_type` 涓嶅疁澶锛屽缓璁浐瀹氫负浠ヤ笅 9 绫伙細

- `REGISTER`
- `HEARTBEAT`
- `STATE_SNAPSHOT`
- `EVENT_REPORT`
- `COMMAND_ACK`
- `COMMAND_NACK`
- `SYNC_CONFIG`
- `QUERY`
- `EXECUTE_ACTION`

杩欐牱浠ュ悗鏂板鐢佃〃銆侀攤鐢垫睜銆?G銆佸帇鍔涙祦閲忋€佸湡澹ゅ鎯咃紝涓嶉渶瑕佹柊澧為《灞傚崗璁紝鍙渶瑕佽ˉ涓氬姟鐮佽〃銆?
## 4.2 QUERY 鐨勭粺涓€缁撴瀯

`QUERY` 缁熶竴甯?2 涓叧閿瓧娈碉細

- `scope`
  - `common`
  - `module`
  - `workflow`
- `query_code`

渚嬪锛?
- `scope=common, query_code=query_common_status`
- `scope=module, query_code=query_module_status`
- `scope=module, query_code=query_channel_values`
- `scope=workflow, query_code=query_workflow_state`

## 4.3 EXECUTE_ACTION 鐨勭粺涓€缁撴瀯

`EXECUTE_ACTION` 缁熶竴甯?3 涓叧閿瓧娈碉細

- `scope`
  - `module`
  - `workflow`
- `action_code`
- `target_ref`

渚嬪锛?
- `scope=module, action_code=open_valve, target_ref=valve_1`
- `scope=module, action_code=start_vfd, target_ref=vfd_1`
- `scope=workflow, action_code=start_session, target_ref=controller`
- `scope=workflow, action_code=pause_session, target_ref=controller`

## 5. 閫氱敤鎺ュ彛灞?
## 5.1 閫氱敤鏌ヨ椤?
寤鸿鍥哄畾浠ヤ笅 `query_code`锛?
- `query_common_status`
- `query_identity`
- `query_capability`
- `query_connectivity`
- `query_power_status`
- `query_alarm_status`

## 5.2 閫氱敤鐘舵€佸瓧娈?
寤鸿鎵€鏈夋帶鍒跺櫒閮界粺涓€涓婃姤 `common_status`锛?
```json
{
  "common_status": {
    "online": true,
    "ready": true,
    "imei": "860000000000001",
    "iccid": "8986...",
    "hardware_sku": "H2_UNIFIED",
    "firmware_family": "FW_H2_UNIFIED",
    "firmware_version": "1.3.0",
    "config_version": 12,
    "signal_csq": 24,
    "signal_rsrp": -88,
    "battery_soc": 76,
    "battery_voltage": 12.4,
    "solar_voltage": 18.2,
    "power_mode": "battery",
    "reboot_reason": "power_restore",
    "fault_codes": []
  }
}
```

## 5.3 鍝簺瀛楁蹇呴』褰掑埌閫氱敤灞?
浠ヤ笅瀛楁涓嶅簲鍐嶆媶鎴愪笟鍔℃帴鍙ｏ細

- `imei`
- `iccid`
- `hardware_sku`
- `firmware_family`
- `firmware_version`
- `config_version`
- `signal_csq / rsrp / rsrq`
- `battery_soc / battery_voltage`
- `solar_voltage`
- `power_mode`
- `reboot_reason`
- `fault_codes`

璇存槑锛?
- `鐢佃〃鐘舵€乣 涓嶅睘浜庨€氱敤灞傦紝瀹冨睘浜庝笟鍔℃ā鍧楀眰
- `鍘嬪姏/娴侀噺/鍦熷￥澧掓儏` 涔熶笉灞炰簬閫氱敤灞傦紝瀹冧滑灞炰簬涓氬姟妯″潡灞?
## 6. 妯″潡鎺ュ彛灞?
## 6.1 妯″潡鐩綍

寤鸿妯″潡鐮佸浐瀹氫负锛?
- `pump_vfd_control`
- `single_valve_control`
- `pressure_acquisition`
- `flow_acquisition`
- `electric_meter_modbus`
- `soil_moisture_acquisition`
- `soil_temperature_acquisition`
- `liquid_level_acquisition`
- `remote_io_extension`

## 6.2 妯″潡瀹炰緥

鍚屼竴妯″潡鍏佽澶氬疄渚嬶紝浣跨敤 `module_instance_code` 鍖哄垎锛屼緥濡傦細

- `pressure_1`
- `flow_1`
- `meter_1`
- `valve_1`
- `soil_1`

## 6.3 妯″潡鐘舵€佺粨鏋?
寤鸿缁熶竴涓猴細

```json
{
  "module_states": [
    {
      "module_code": "pressure_acquisition",
      "module_instance_code": "pressure_1",
      "enabled": true,
      "health": "normal",
      "status": "sampling",
      "fault_codes": []
    }
  ]
}
```

## 6.4 閫氶亾鍊肩粨鏋?
寤鸿缁熶竴涓猴細

```json
{
  "channel_values": [
    {
      "channel_code": "pressure_1",
      "metric_code": "pressure_mpa",
      "value": 0.31,
      "unit": "MPa",
      "quality": "good",
      "collected_at": "2026-04-07T04:00:00Z"
    }
  ]
}
```

## 6.5 鍝簺鑳藉姏褰掓ā鍧楀眰

### 鐢佃〃

鐢佃〃寤鸿浣滀负 `electric_meter_modbus` 妯″潡澶勭悊锛屼笉瑕佽繘閫氱敤灞傘€?
鍘熷洜锛?
- 骞堕潪鎵€鏈夋澘閮藉甫鐢佃〃
- 鐢佃〃寰€寰€渚濊禆 RS485 澶栬
- 鐢佃〃鐘舵€佹槸涓氬姟閲囬泦鑳藉姏锛屼笉鏄富鏉垮叕鍏卞睘鎬?
鍏稿瀷鏌ヨ椤癸細

- `energy_kwh`
- `power_kw`
- `voltage_v`
- `current_a`
- `meter_online`
- `meter_fault_code`

### 鍘嬪姏/娴侀噺

缁熶竴璧伴噰闆嗘ā鍧楋紝涓嶈涓烘瘡绉嶄紶鎰熷櫒鍗曠嫭鍋氫竴濂楀崗璁€?
### 鍗曡矾闃€鎺?鍙橀鍣?
缁熶竴璧版ā鍧楀姩浣滐紝涓嶅崟鐙彂鏄庡満鏅崗璁€?
## 7. 涓氬姟娴佺▼灞?
浼犳劅鍣ㄥ拰绠€鍗曟墽琛屽櫒鏈韩涓嶅鏉傦紝鐪熸澶嶆潅鐨勬槸涓氬姟娴佺▼闂幆銆?
杩欎竴灞傚缓璁嫭绔嬪嚭鏉ワ紝涓嶄笌妯″潡鏁版嵁娣峰啓銆?
## 7.1 蹇呴』淇濈暀鐨勬祦绋嬭兘鍔?
鍩轰簬鑰佺郴缁熷拰鐜版湁骞冲彴锛岃繖浜涙祦绋嬭兘鍔涘繀椤昏姝ｅ紡瀹氫箟锛?
- `ready` 鍒ゅ畾
- 鍚姩鍓嶆牎楠?- 鍚姩鍔ㄤ綔纭
- 鏆傚仠/鎭㈠鍔ㄤ綔纭
- 鍋滄満鍔ㄤ綔纭
- 杩愯涓懆鏈熶笂鎶?- 鍋滄満鍚庣粨鏉?缁撶畻
- 鎺夌數鎭㈠鍚庣殑琛ヤ紶
- 绂荤嚎瓒呮椂鍚庣殑瀹夊叏鍥炴敹

## 7.2 宸ヤ綔娴佺姸鎬佸缓璁?
寤鸿鍐荤粨锛?
- `BOOTING`
- `ONLINE_NOT_READY`
- `READY_IDLE`
- `STARTING`
- `RUNNING`
- `PAUSING`
- `PAUSED`
- `RESUMING`
- `STOPPING`
- `STOPPED`
- `ERROR_STOP`

## 7.3 涓轰粈涔?workflow 瑕佺嫭绔?
鍥犱负涓嬮潰杩欎簺閫昏緫閮戒笉鏄櫘閫氶噰闆嗙偣鑳借〃杈炬竻妤氱殑锛?
- ready 鍓嶄笉鑳借鍚姩鎺掗槦绛夊緟鍚庣画琛ユ墽琛?- 鍔ㄤ綔鏈‘璁や笉鑳芥敼鐘舵€?- 鏆傚仠/鎭㈠瑕佸仛闃叉姈
- 鍋滄満鍚庡彲鑳借繕瑕佽ˉ缁撶畻
- 鎺夌嚎鎭㈠鍚庤鍒ゆ柇鏃т細璇濇槸鍚﹁繕鑳界户缁?
杩欎簺瑙勫垯鍦ㄨ€佷唬鐮侀噷宸茬粡瀛樺湪锛屼笉搴旇涓€?
## 7.4 workflow 鏌ヨ

寤鸿鍥哄畾锛?
- `query_workflow_state`
- `query_active_session`
- `query_last_stop_context`

## 7.5 workflow 鍔ㄤ綔

寤鸿鍥哄畾锛?
- `start_session`
- `stop_session`
- `pause_session`
- `resume_session`
- `confirm_stop_settlement`
- `force_safe_stop`

## 7.6 workflow 浜嬩欢

寤鸿閫氳繃 `EVENT_REPORT` 涓婃姤浠ヤ笅涓氬姟浜嬩欢锛?
- `workflow_ready_changed`
- `workflow_starting`
- `workflow_started`
- `workflow_paused`
- `workflow_resumed`
- `workflow_stopped`
- `workflow_settlement_ready`
- `workflow_recovery_required`

## 8. 鑰佸崗璁埌鏂扮洰褰曠殑鏄犲皠寤鸿

| 鑰佸懡浠?| 鑰佽涔?| 鏂版帴鍙ｅ缓璁?|
| --- | --- | --- |
| `AXT` | 蹇冭烦 | `HEARTBEAT` + `common_status.signal_*` |
| `ADV` | 鍙?IMEI | `REGISTER` / `QUERY scope=common query_identity` |
| `AID` | 鍙?ICCID/杞‖浠剁増鏈?| `REGISTER` / `QUERY scope=common query_identity` |
| `ASY` | 鍙栬澶囩被鍨?| `REGISTER` / `QUERY scope=common query_capability` |
| `AUS/AUB/AUP/AUM/AUT` | 鍗囩骇鍒嗗寘/鍐欏寘/鏍￠獙/缁撴潫 | `SYNC_CONFIG` 鎵╁睍涓?`ota_*` 瀛愭祦绋?|
| `JAA` | 鏌ヨ杩愯鐘舵€?| `QUERY scope=workflow query_workflow_state` |
| `JAB` | 鍚姩 | `EXECUTE_ACTION scope=workflow action_code=start_session` |
| `JAD` | 鍋滄 | `EXECUTE_ACTION scope=workflow action_code=stop_session` |
| `JAF/JAH` | 鏆傚仠/鎭㈠ | `EXECUTE_ACTION scope=workflow action_code=pause_session/resume_session` |
| `JXX` | 鏌ヨ鐢甸噺/鍔熺巼 | `QUERY scope=module query_module_status` 鎴?`query_channel_values` |
| `JPE` | 閬ユ帶瑙﹀彂 | `EXECUTE_ACTION scope=workflow` 鎴?`scope=module` |
| `JAL` | 缁撶畻缁撴灉 | `EVENT_REPORT workflow_settlement_ready` |
| `_RPJACA...` | 杩愯涓數閲忎笂鎶?| `EVENT_REPORT workflow_runtime_tick` + `channel_values` |

## 9. 骞冲彴濡備綍灏戦厤缃€佸ソ浣跨敤

## 9.1 鎺ㄨ崘閰嶇疆娴佺▼

1. 鍦ㄧ偣浣嶄笅瀹夎鎺у埗鍣?2. 鍙綍鍏?`IMEI`
3. 璁惧 `REGISTER` 鑷姤锛?   - `hardware_sku`
   - `firmware_family`
   - `resource_inventory`
   - `supported_modules`
4. 骞冲彴鏍规嵁鐐逛綅绫诲瀷鑷姩鎺ㄨ崘妯″潡缁勫悎
5. 鐢ㄦ埛鍙ˉ蹇呰鍙傛暟
6. 骞冲彴鐢熸垚 `config_version`
7. 涓嬪彂 `SYNC_CONFIG`
8. 璁惧鍥?`STATE_SNAPSHOT`

## 9.2 鐢ㄦ埛鍙簲閰嶇疆浠€涔?
鐢ㄦ埛鍙ˉ杩欎簺宸紓椤癸細

- RS485 浠庣珯鍦板潃
- AI 閲忕▼
- 浼犳劅鍣ㄧ郴鏁?- 闃€闂ㄥ姩浣滆秴鏃?- 鍘嬪姏闃堝€?- 娴侀噺闃堝€?- 鏄惁鍙備笌 workflow

## 9.3 鐢ㄦ埛涓嶅簲閰嶇疆浠€涔?
涓嶅簲璁╃敤鎴锋墜濉繖浜涘簳灞傚唴瀹癸細

- 涓绘姤鏂囩粨鏋?- 閫氶亾缂栫爜涓婚敭瑙勫垯
- 妯″潡 JSON 鍏ㄩ噺瀹氫箟
- 寮曡剼绾ц祫婧愭槧灏?- 閫氫俊涓氬姟鐮?
## 10. 闈㈠悜缁勫悎鍦烘櫙鐨勭粺涓€绛栫暐

鍚屼竴鍧楁澘濡傛灉鍚屾椂鎵挎媴锛?
- 鍙橀鍣ㄦ帶鍒?- 鍘嬪姏閲囬泦
- 娴侀噺閲囬泦
- 鍗曢榾鎺у埗
- 鐢佃〃閲囬泦
- 鍦熷￥澧掓儏閲囬泦

涔熶笉搴旇鏂板鍗忚鍒嗘敮锛屽彧闇€瑕侊細

- `feature_modules[]` 缁勫悎
- `module_instances[]` 瀹炰緥鍖?- `channel_bindings[]` 缁戝畾
- `workflow_profile` 鎸囧畾鏄惁鍙備笌涓氬姟闂幆

## 11. 鎺ㄨ崘鍐荤粨鍙ｅ緞

### 11.1 浼犺緭灞傚彧淇濈暀涓€濂?
- `tcp-json-v1`

### 11.2 椤跺眰娑堟伅鍥哄畾 9 绫?
- `REGISTER`
- `HEARTBEAT`
- `STATE_SNAPSHOT`
- `EVENT_REPORT`
- `COMMAND_ACK`
- `COMMAND_NACK`
- `SYNC_CONFIG`
- `QUERY`
- `EXECUTE_ACTION`

### 11.3 璇箟鍥哄畾 3 灞?
- `common`
- `module`
- `workflow`

### 11.4 杩欐牱鍋氱殑鏀剁泭

- 鐢垫睜銆?G銆佸浐浠躲€侀厤缃増鏈ぉ鐒跺綊閫氱敤灞?- 鍘嬪姏銆佹祦閲忋€佺數琛ㄣ€佸湡澹ゅ鎯呭ぉ鐒跺綊妯″潡灞?- ready銆佸惎鍋溿€佹殏鍋溿€佹仮澶嶃€佸仠鏈恒€佺粨绠椼€佹柇鐢佃ˉ浼犲ぉ鐒跺綊 workflow 灞?- 骞冲彴鍙互鎸夌偣浣嶈嚜鍔ㄦ帹鑽愭ā鏉匡紝鐢ㄦ埛鍙敼灏戦噺鍙傛暟
- 鍚庨潰鍔犳柊涓氬姟鏃讹紝澶у鍙槸鎵╁睍瀛楀吀锛屼笉闇€瑕佹敼鍗忚楠ㄦ灦

## 12. 涓嬩竴姝ュ缓璁?
涓嬩竴姝ョ洿鎺ヨ惤涓や欢浜嬶細

1. 鎶婃湰鐩綍鏀舵垚鍚庣 DTO / Schema / 鏍￠獙鍣?2. 缁?`common / module / workflow` 涓夊眰鍚勮ˉ涓€缁勬寮忔姤鏂囨牱渚?
寤鸿椤哄簭锛?
1. `QUERY / EXECUTE_ACTION` 鐨?code 琛ㄥ喕缁?2. `workflow_profile` 鍐荤粨
3. 鍚庣閰嶇疆 DTO 涓庢牎楠屽櫒钀藉湴
4. 鍓嶇鎺у埗鍣ㄥ畨瑁呴〉鍋氣€滆澶囨敞鍐屽悗鑷姩鎺ㄨ崘妯″潡鈥?
