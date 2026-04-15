# 宓屽叆寮忎骇鍝佸崗鍚屽紑鍙戞寚浠ゆā鏉?v1

## 1. 鐩殑

杩欎唤鏂囨。鐢ㄤ簬鎶婂钩鍙颁晶 Codex 鍜屽祵鍏ュ紡渚?AI 鐨勮亴璐ｆ媶寮€锛岄伩鍏嶄袱杈瑰悇鏀逛竴鍗婂張瀵逛笉涓娿€?
鍘熷垯锛?
- 鍏堢‘璁や骇鍝佹ā鏉匡紝鍐嶅紑鍙?- 骞冲彴璐熻矗鐭瓧娈垫帴鍏ャ€侀暱璇箟钀藉簱銆侀厤缃笌鏀粯閫昏緫
- 宓屽叆寮忚礋璐ｇ‖浠堕┍鍔ㄣ€佺姸鎬佹満銆佺粍鍖呫€佷笅鍙戞墽琛?- 褰撳墠榛樿绛栫暐鏄€滀笂琛岀煭瀛楁銆佸钩鍙板唴閮ㄩ暱瀛楁銆佷笅琛屽厛鍏煎鐜版湁闀垮瓧娈碘€?- 鍗忚鍙樺寲蹇呴』鍏堟敼 MD锛屽啀鏀逛唬鐮?
## 2. 寮€鍙戝墠鍥哄畾杈撳叆

姣忔鏂颁骇鍝佺珛椤癸紝鍏堝噯澶囪繖鍑犱唤鏂囦欢锛?
- 浜у搧妯℃澘閫夊瀷鍗曪細
  [00-product-template-selection-template.md](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-product-template/00-product-template-selection-template.md)
- 纭欢鑳藉姏瀹氫箟锛?  [embedded-controller-hardware-capability-template-v1.md](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-controller-hardware-capability-template-v1.md)
- 绠¤剼鏄犲皠锛?  [embedded-controller-pin-map-template-v1.md](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-controller-pin-map-template-v1.md)
- AI 浠诲姟涔︼細
  [embedded-controller-task-book-template-v1.md](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-controller-task-book-template-v1.md)

鍚屾椂绾︽潫蹇呴』寮曠敤锛?
- 杞婚噺鍗忚锛?  [embedded-controller-compact-protocol-v1.md](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-controller-compact-protocol-v1.md)
- 杞婚噺瀛楀吀锛?  [embedded-controller-compact-dictionaries-v1.md](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-controller-compact-dictionaries-v1.md)
- 4G 鍙戝寘瑙勫垯锛?  [embedded-controller-4g-packet-rules-v1.md](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-controller-4g-packet-rules-v1.md)
- 鑳藉姏闆嗚鍒掞細
  [embedded-controller-capability-set-planning-v1.md](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-controller-capability-set-planning-v1.md)
- 鑳藉姏闆嗗瓧鍏革細
  [embedded-controller-capability-set-dictionary-v1.md](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-controller-capability-set-dictionary-v1.md)

## 3. 浣犵粰骞冲彴 Codex 鐨勬寚浠?
鐩存帴鐢ㄤ笅闈㈣繖娈碉紝鏇挎崲鏂规嫭鍙峰唴瀹瑰嵆鍙細

```md
璇峰熀浜庝互涓嬭鑼冨畬鎴愬钩鍙颁晶鏀归€狅紝涓嶈鏀瑰祵鍏ュ紡浠ｇ爜锛?
浜у搧鍚嶇О锛歔浜у搧鍚峕
鑳藉姏闆嗘ā鏉匡細[CS-01 / CS-02 / CS-03 / CS-04 / CS-05]
缁撶畻鍩哄噯锛歔ENERGY / TIME / FLOW]
鏀粯閿氱偣锛歔PUMP / VALVE / NONE]

蹇呴』閬靛畧鐨勬枃妗ｏ細
- docs/protocol/embedded-controller/embedded-controller-compact-protocol-v1.md
- docs/protocol/embedded-controller/embedded-controller-compact-dictionaries-v1.md
- docs/protocol/embedded-controller/embedded-controller-4g-packet-rules-v1.md
- docs/protocol/embedded-controller/embedded-controller-capability-set-planning-v1.md
- docs/protocol/embedded-controller/embedded-controller-capability-set-dictionary-v1.md
- docs/protocol/embedded-controller/embedded-controller-task-book-template-v1.md

鏈骞冲彴渚х洰鏍囷細
1. 鍗忚鍏ュ彛鍏煎鐭瓧娈?envelope 鍜?payload
2. 骞冲彴鍐呴儴浠嶇劧缁熶竴涓洪暱瀛楁鍜屾爣鍑?code
3. 鏀寔蹇冭烦銆佹敞鍐屻€佺姸鎬佸揩鐓с€佷簨浠朵笂鎶ャ€佸懡浠?ACK/NACK 鐨勭煭鐮佹帴鍏?4. 鏀寔鐭ā鍧楃爜銆佺煭鎸囨爣鐮併€佺煭 workflow 鐘舵€佺爜鏄犲皠
5. 鏃犵敤瀛楁涓嶈鍏ュ簱锛屼笉瑕佹柊澧炲啑浣欑紦瀛?6. 鍙湪缃戝叧/閫傞厤灞傚仛鍗忚鏄犲皠锛屼笟鍔″眰灏介噺涓嶆敼
7. 琛ュ崟鍏冩祴璇曟垨闆嗘垚娴嬭瘯锛岃鐩栫煭瀛楁鍏煎

骞冲彴渚т氦浠樿姹傦細
- 鍛婅瘔鎴戜慨鏀逛簡鍝簺鏂囦欢
- 鍛婅瘔鎴戝吋瀹逛簡鍝簺鐭瓧娈?- 鍛婅瘔鎴戣繕缂哄摢浜涘祵鍏ュ紡閰嶅悎椤?- 濡傛灉鍙戠幇瑙勮寖涓嶅锛岃鏄庣‘鎸囧嚭瑕佺淮鎶ゅ摢浠?MD
```

## 4. 浣犵粰宓屽叆寮?AI 鐨勬寚浠?
鐩存帴鐢ㄤ笅闈㈣繖娈碉紝鏇挎崲鏂规嫭鍙峰唴瀹瑰嵆鍙細

```md
璇峰熀浜庝互涓嬭鑼冨畬鎴愬祵鍏ュ紡瀹炵幇锛屼笉瑕佹敼骞冲彴浠ｇ爜锛?
浜у搧鍚嶇О锛歔浜у搧鍚峕
鑳藉姏闆嗘ā鏉匡細[CS-01 / CS-02 / CS-03 / CS-04 / CS-05]
纭欢鑳藉姏瀹氫箟鏂囦欢锛歔璺緞]
绠¤剼鏄犲皠鏂囦欢锛歔璺緞]
浠诲姟涔︽枃浠讹細[璺緞]
鍘熺悊鍥炬枃浠讹細[璺緞]

蹇呴』閬靛畧鐨勬枃妗ｏ細
- docs/protocol/embedded-controller/embedded-controller-compact-protocol-v1.md
- docs/protocol/embedded-controller/embedded-controller-compact-dictionaries-v1.md
- docs/protocol/embedded-controller/embedded-controller-4g-packet-rules-v1.md
- docs/protocol/embedded-controller/embedded-controller-minimal-implementation-rules-v1.md
- docs/protocol/embedded-controller/embedded-controller-task-book-template-v1.md

鏈宓屽叆寮忕洰鏍囷細
1. 鏍规嵁鍘熺悊鍥惧拰纭欢鑳藉姏瀹氫箟瀹炵幇鐪熷疄纭欢椹卞姩
2. 鎴戝畾涔夌鑴氬姛鑳斤紝浣犱笉鑳借嚜琛屽亣璁剧鑴氱敤閫?3. 蹇冭烦銆佹敞鍐屻€佺姸鎬佸揩鐓с€佷簨浠朵笂鎶ョ粺涓€浣跨敤杞婚噺鐭瓧娈靛崗璁?4. 鍙疄鐜颁换鍔′功瑕佹眰鐨勮兘鍔涳紝涓嶅厑璁镐繚鐣欐棤鐢ㄥ瓧娈靛拰鏃犵敤妯″潡
5. 璁￠噺瀛楁鎸変骇鍝佹ā鏉夸繚鐣欐渶灏忛泦鍚?6. 4G 鍙戦€併€侀噸杩炪€佽ˉ鍙戙€佸箓绛夐伒瀹堝彂鍖呰鍒?7. 鍛戒护鎵ц銆丄CK/NACK銆佺姸鎬佹満蹇呴』鍜岃兘鍔涢泦涓€鑷?
宓屽叆寮忎氦浠樿姹傦細
- 鍒楀嚭瀹炵幇浜嗗摢浜涢┍鍔ㄥ拰妯″潡
- 鍒楀嚭涓婅鎶ユ枃绀轰緥
- 鍒楀嚭涓嬭鍛戒护鏀寔鑼冨洿
- 鍒楀嚭鏈疄鐜伴」鍜屽彈纭欢闄愬埗椤?- 濡傛灉鍙戠幇瑙勮寖涓嶅锛岃鏄庣‘鎸囧嚭瑕佺淮鎶ゅ摢浠?MD
```

## 5. 鍙屾柟瀵归綈鍙ｅ緞

涓よ竟閮藉繀椤荤粺涓€杩欏嚑涓€硷細

- `message_type` 鎴栫煭鐮?`t`
- `feature_modules` 鎴栫煭鐮?`fm`
- `workflow_state` 鎴栫煭鐮?`wf`
- `settlement_basis`
- `payment_anchor`
- `control_anchor`

濡傛灉杩欏嚑涓彛寰勪换鎰忎竴涓彂鐢熷彉鍖栵紝蹇呴』鍏堢淮鎶?MD锛屽啀鏀逛唬鐮併€?
## 6. 绗竴鐗堝缓璁妭濂?
寤鸿浣犲疄闄呮帹杩涙椂杩欐牱璇达細

1. 鍏堥€変骇鍝佹ā鏉?2. 鍐嶅～纭欢鑳藉姏瀹氫箟
3. 鍐嶅～绠¤剼鏄犲皠
4. 鍐嶇敓鎴?AI 浠诲姟涔?5. 鎴戣 Codex 鏀瑰钩鍙版帴鍏?6. 浣犺鍙︿竴涓?AI 鏀瑰祵鍏ュ紡
7. 鏈€鍚庢寜鑱旇皟妯℃澘鏍稿

鑱旇皟鐢細

- [07-joint-debug-acceptance-template.md](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-product-template/07-joint-debug-acceptance-template.md)

## 7. 浠€涔堟椂鍊欏繀椤绘彁閱掔淮鎶?MD

鍑虹幇涓嬮潰浠讳竴鎯呭喌锛屽氨瑕佺淮鎶ゆ枃妗ｏ細

- 鏂板鐭瓧娈?- 鏂板妯″潡鐭爜
- 鏂板璁￠噺鍙ｅ緞
- 鏂板鏀粯閿氱偣
- 鏂板鑳藉姏闆嗘ā鏉?- 鏌愪釜浜у搧涓嶅啀閫傞厤鐜版湁 `CS-01` 鍒?`CS-05`
- 4G 鍙戝寘瑙勫垯璋冩暣
- 蹇冭烦瀛楁闆嗗悎璋冩暣

