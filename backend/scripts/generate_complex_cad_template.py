from __future__ import annotations

import json
import math
import shutil
import textwrap
from collections import defaultdict, deque
from pathlib import Path

import ezdxf
from ezdxf.units import M


REPO_ROOT = Path(__file__).resolve().parents[3]
OUTPUT_DIR = REPO_ROOT / "docs" / "cad-template"
PUBLIC_DIR = REPO_ROOT / "lovable-working" / "public" / "downloads" / "cad-template"

DXF_NAME = "houji-complex-validation-template.dxf"
SPEC_NAME = "houji-complex-validation-template-spec.md"
META_NAME = "houji-complex-validation-template.metadata.json"
MANIFEST_NAME = "houji-complex-validation-template.import.json"

LAYER_SPECS = [
    ("HJ_SOURCE_STATION", 1, "水源点位（机井 / 泵站）"),
    ("HJ_VALVE", 30, "阀门 / 电磁阀"),
    ("HJ_PIPE", 5, "管道"),
    ("HJ_OUTLET", 6, "出水口"),
    ("HJ_SENSOR", 140, "传感器"),
]

LAYER_MAPPING = {
    "source_station_layer": "HJ_SOURCE_STATION",
    "well_layer": "HJ_SOURCE_STATION",
    "pump_layer": "HJ_SOURCE_STATION",
    "valve_layer": "HJ_VALVE",
    "pipe_layer": "HJ_PIPE",
    "outlet_layer": "HJ_OUTLET",
    "sensor_layer": "HJ_SENSOR",
}

BLOCK_NAMES = {
    "source_station": "HJ_SOURCE_STATION_BLOCK",
    "valve": "HJ_VALVE_BLOCK",
    "outlet": "HJ_OUTLET_BLOCK",
    "sensor": "HJ_SENSOR_BLOCK",
}

ZONE_OUTLET_DISTRIBUTION = [3, 3, 3, 3, 3]

PUMP_PROFILES = [
    {"rated_power_kw": 37.5, "rated_head_m": 108, "rated_flow_m3h": 56, "well_depth_m": 98, "source_kind": "groundwater"},
    {"rated_power_kw": 18.5, "rated_head_m": 96, "rated_flow_m3h": 34, "well_depth_m": 84, "source_kind": "groundwater"},
    {"rated_power_kw": 22.0, "rated_head_m": 92, "rated_flow_m3h": 40, "well_depth_m": 88, "source_kind": "groundwater"},
    {"rated_power_kw": 15.0, "rated_head_m": 42, "rated_flow_m3h": 46, "well_depth_m": 0, "source_kind": "surface_water"},
    {"rated_power_kw": 15.0, "rated_head_m": 38, "rated_flow_m3h": 44, "well_depth_m": 0, "source_kind": "river"},
]

OUTLET_TARGET_FLOWS = [8, 9, 10, 8, 11, 9, 10, 12, 9, 8, 10, 9, 11, 12, 10]
OUTLET_MIN_PRESSURES = [18, 19, 20, 18, 21, 19, 20, 22, 19, 18, 21, 19, 22, 23, 21]
SENSOR_KIND_SEQUENCE = ["flow", "pressure", "flow", "pressure", "pressure", "pressure"]


def point(code: str, kind: str, x: float, y: float, **extra: object) -> dict:
    layer = {
        "source_station": "HJ_SOURCE_STATION",
        "valve": "HJ_VALVE",
        "outlet": "HJ_OUTLET",
        "sensor": "HJ_SENSOR",
    }[kind]
    return {"code": code, "kind": kind, "layer": layer, "point": (x, y), **extra}


def pipe(code: str, *points: tuple[float, float]) -> dict:
    return {"code": code, "points": list(points)}


POINTS = [
    point("ST01", "source_station", 80, 360, profile_index=0),
    point("ST02", "source_station", 180, 360, profile_index=1),
    point("ST03", "source_station", 300, 360, profile_index=2),
    point("ST04", "source_station", 460, 360, profile_index=3),
    point("ST05", "source_station", 560, 360, profile_index=4),
    point("V01", "valve", 80, 340),
    point("V02", "valve", 180, 340),
    point("V03", "valve", 300, 340),
    point("V04", "valve", 460, 340),
    point("V05", "valve", 560, 340),
    point("V06", "valve", 200, 275),
    point("V07", "valve", 300, 275),
    point("V08", "valve", 420, 275),
    point("V09", "valve", 120, 215),
    point("V10", "valve", 200, 215),
    point("V11", "valve", 300, 215),
    point("V12", "valve", 420, 215),
    point("V13", "valve", 500, 215),
    point("S01", "sensor", 240, 310),
    point("S02", "sensor", 500, 310),
    point("S03", "sensor", 300, 240),
    point("S04", "sensor", 200, 170),
    point("S05", "sensor", 300, 170),
    point("S06", "sensor", 500, 175),
    point("O01", "outlet", 60, 118),
    point("O02", "outlet", 100, 104),
    point("O03", "outlet", 140, 118),
    point("O04", "outlet", 170, 112),
    point("O05", "outlet", 210, 98),
    point("O06", "outlet", 250, 112),
    point("O07", "outlet", 250, 108),
    point("O08", "outlet", 290, 94),
    point("O09", "outlet", 330, 108),
    point("O10", "outlet", 350, 112),
    point("O11", "outlet", 390, 98),
    point("O12", "outlet", 430, 112),
    point("O13", "outlet", 460, 118),
    point("O14", "outlet", 500, 104),
    point("O15", "outlet", 540, 118),
]

PIPES = [
    pipe("SS01", (80, 360), (80, 340), (80, 310)),
    pipe("SS02", (180, 360), (180, 340), (180, 310)),
    pipe("SS03", (300, 360), (300, 340), (300, 310)),
    pipe("SS04", (460, 360), (460, 340), (460, 310)),
    pipe("SS05", (560, 360), (560, 340), (560, 310)),
    pipe(
        "TRUNK_TOP",
        (80, 310),
        (140, 310),
        (180, 310),
        (240, 310),
        (300, 310),
        (380, 310),
        (460, 310),
        (500, 310),
        (560, 310),
    ),
    pipe("INTERTIE_01", (180, 310), (180, 275), (200, 275), (200, 240)),
    pipe("INTERTIE_02", (300, 310), (300, 275), (300, 240)),
    pipe("INTERTIE_03", (460, 310), (460, 275), (420, 275), (420, 240)),
    pipe("TRUNK_MIDDLE_LEFT", (300, 240), (200, 240), (120, 240)),
    pipe("TRUNK_MIDDLE_RIGHT", (300, 240), (420, 240), (500, 240)),
    pipe("ZONE_A_STEM", (120, 240), (120, 215), (120, 150)),
    pipe("ZONE_A_LATERAL_LEFT", (120, 150), (100, 150), (60, 150)),
    pipe("ZONE_A_LATERAL_RIGHT", (120, 150), (140, 150)),
    pipe("ZONE_A_DROP_01", (60, 150), (60, 118)),
    pipe("ZONE_A_DROP_02", (100, 150), (100, 104)),
    pipe("ZONE_A_DROP_03", (140, 150), (140, 118)),
    pipe("ZONE_B_STEM", (200, 240), (200, 215), (200, 170), (200, 145)),
    pipe("ZONE_B_LATERAL_LEFT", (200, 145), (170, 145)),
    pipe("ZONE_B_LATERAL_RIGHT", (200, 145), (210, 145), (250, 145)),
    pipe("ZONE_B_DROP_04", (170, 145), (170, 112)),
    pipe("ZONE_B_DROP_05", (210, 145), (210, 98)),
    pipe("ZONE_B_DROP_06", (250, 145), (250, 112)),
    pipe("ZONE_C_STEM", (300, 240), (300, 215), (300, 170), (300, 140)),
    pipe("ZONE_C_LATERAL_LEFT", (300, 140), (290, 140), (250, 140)),
    pipe("ZONE_C_LATERAL_RIGHT", (300, 140), (330, 140)),
    pipe("ZONE_C_DROP_07", (250, 140), (250, 108)),
    pipe("ZONE_C_DROP_08", (290, 140), (290, 94)),
    pipe("ZONE_C_DROP_09", (330, 140), (330, 108)),
    pipe("ZONE_D_STEM", (420, 240), (420, 215), (420, 145)),
    pipe("ZONE_D_LATERAL_LEFT", (420, 145), (390, 145), (350, 145)),
    pipe("ZONE_D_LATERAL_RIGHT", (420, 145), (430, 145)),
    pipe("ZONE_D_DROP_10", (350, 145), (350, 112)),
    pipe("ZONE_D_DROP_11", (390, 145), (390, 98)),
    pipe("ZONE_D_DROP_12", (430, 145), (430, 112)),
    pipe("ZONE_E_STEM", (500, 240), (500, 215), (500, 175), (500, 150)),
    pipe("ZONE_E_LATERAL_LEFT", (500, 150), (460, 150)),
    pipe("ZONE_E_LATERAL_RIGHT", (500, 150), (540, 150)),
    pipe("ZONE_E_DROP_13", (460, 150), (460, 118)),
    pipe("ZONE_E_DROP_14", (500, 150), (500, 104)),
    pipe("ZONE_E_DROP_15", (540, 150), (540, 118)),
]


def stable_jitter(code: str) -> int:
    return sum(ord(ch) for ch in code)


def altitude_for(code: str, x: float, y: float) -> float:
    gradient_component = ((390 - y) / 300.0) * 24.0
    jitter_component = stable_jitter(code) % 7
    return round(max(8.0, min(42.0, 8.0 + gradient_component + jitter_component)), 1)


def outlet_profile(index: int) -> dict:
    target_flow = OUTLET_TARGET_FLOWS[index % len(OUTLET_TARGET_FLOWS)]
    min_pressure = OUTLET_MIN_PRESSURES[index % len(OUTLET_MIN_PRESSURES)]
    irrigation_area = round(target_flow * 3.6 + (index % 3) * 2.2, 1)
    return {
        "target_flow_m3h": target_flow,
        "min_pressure_m": min_pressure,
        "max_pressure_m": min_pressure + 32,
        "irrigation_area_mu": irrigation_area,
    }


def sensor_profile(index: int) -> dict:
    kind = SENSOR_KIND_SEQUENCE[index % len(SENSOR_KIND_SEQUENCE)]
    if kind == "flow":
        return {"sensor_kind": kind, "range_min": 0, "range_max": 100}
    return {"sensor_kind": kind, "range_min": 0, "range_max": 160}


def valve_profile(index: int) -> dict:
    kv_base = 180 + (index % 4) * 18
    if index < 5:
        kv_base += 40
    return {
        "valve_mode": "solenoid",
        "kv_value": kv_base,
        "default_open_ratio_pct": 100,
    }


def pipe_type_for(code: str) -> str:
    return "branch" if "LATERAL" in code or "DROP" in code else "main"


def pipe_diameter_for(code: str) -> int:
    if code == "TRUNK_TOP":
        return 280
    if code.startswith("TRUNK_MIDDLE"):
        return 220
    if code.startswith("INTERTIE"):
        return 200
    if code.startswith("SS"):
        return 200
    if "STEM" in code:
        return 160
    if "LATERAL" in code:
        return 125
    if "DROP" in code:
        return 90
    return 140


def build_source_station_node(item: dict) -> dict:
    code = item["code"]
    x, y = item["point"]
    profile = PUMP_PROFILES[item["profile_index"]]
    source_kind = profile["source_kind"]
    altitude = altitude_for(code, x, y)

    node_params = {
        "source_kind": source_kind,
        "design_flow_m3h": profile["rated_flow_m3h"],
        "pump_head_m": profile["rated_head_m"],
        "rated_flow_m3h": profile["rated_flow_m3h"],
        "rated_head_m": profile["rated_head_m"],
        "rated_power_kw": profile["rated_power_kw"],
    }
    if source_kind == "groundwater":
        node_params.update(
            {
                "well_depth_m": profile["well_depth_m"],
                "static_water_level_m": round(profile["well_depth_m"] * 0.35, 1),
                "dynamic_water_level_m": round(profile["well_depth_m"] * 0.52, 1),
            }
        )

    return {
        "node_code": code,
        "node_name": code,
        "node_type": "source_station",
        "asset_id": None,
        "asset_ids": [],
        "device_ids": [],
        "node_params": node_params,
        "pump_units": [
            {
                "unit_code": f"{code}-P01",
                "unit_name": f"{code}-PUMP-01",
                "enabled": True,
                "rated_flow_m3h": profile["rated_flow_m3h"],
                "rated_head_m": profile["rated_head_m"],
                "rated_power_kw": profile["rated_power_kw"],
                "source_kind": source_kind,
                "device_role": "pump_unit",
                "asset_ids": [],
                "device_ids": [],
            }
        ],
        "cad_x": x,
        "cad_y": y,
        "latitude": None,
        "longitude": None,
        "altitude": altitude,
    }


def build_graph_draft() -> dict:
    nodes: list[dict] = []
    node_codes_by_coord: dict[tuple[float, float], str] = {}
    junction_counter = 1

    for item in POINTS:
        code = item["code"]
        x, y = item["point"]
        kind = item["kind"]
        altitude = altitude_for(code, x, y)

        if kind == "source_station":
            node = build_source_station_node(item)
        elif kind == "valve":
            node = {
                "node_code": code,
                "node_name": code,
                "node_type": "valve",
                "asset_id": None,
                "asset_ids": [],
                "device_ids": [],
                "node_params": valve_profile(int(code[-2:]) - 1),
                "pump_units": [],
                "cad_x": x,
                "cad_y": y,
                "latitude": None,
                "longitude": None,
                "altitude": altitude,
            }
        elif kind == "outlet":
            node = {
                "node_code": code,
                "node_name": code,
                "node_type": "outlet",
                "asset_id": None,
                "asset_ids": [],
                "device_ids": [],
                "node_params": outlet_profile(int(code[-2:]) - 1),
                "pump_units": [],
                "cad_x": x,
                "cad_y": y,
                "latitude": None,
                "longitude": None,
                "altitude": altitude,
            }
        else:
            node = {
                "node_code": code,
                "node_name": code,
                "node_type": "sensor",
                "asset_id": None,
                "asset_ids": [],
                "device_ids": [],
                "node_params": sensor_profile(int(code[-2:]) - 1),
                "pump_units": [],
                "cad_x": x,
                "cad_y": y,
                "latitude": None,
                "longitude": None,
                "altitude": altitude,
            }

        nodes.append(node)
        node_codes_by_coord[(float(x), float(y))] = code

    def resolve_node_code(coord: tuple[float, float]) -> tuple[str, float]:
        nonlocal junction_counter
        key = (float(coord[0]), float(coord[1]))
        if key in node_codes_by_coord:
            code = node_codes_by_coord[key]
            altitude = next(node["altitude"] for node in nodes if node["node_code"] == code)
            return code, altitude

        code = f"J{junction_counter:03d}"
        junction_counter += 1
        altitude = altitude_for(code, key[0], key[1])
        nodes.append(
            {
                "node_code": code,
                "node_name": None,
                "node_type": "junction",
                "asset_id": None,
                "asset_ids": [],
                "device_ids": [],
                "node_params": {},
                "pump_units": [],
                "cad_x": key[0],
                "cad_y": key[1],
                "latitude": None,
                "longitude": None,
                "altitude": altitude,
            }
        )
        node_codes_by_coord[key] = code
        return code, altitude

    pipes: list[dict] = []
    for item in PIPES:
        points = item["points"]
        for index in range(len(points) - 1):
            start = points[index]
            end = points[index + 1]
            from_code, from_altitude = resolve_node_code(start)
            to_code, to_altitude = resolve_node_code(end)
            pipes.append(
                {
                    "pipe_code": item["code"] if len(points) == 2 else f"{item['code']}_{index + 1:02d}",
                    "pipe_type": pipe_type_for(item["code"]),
                    "from_node_code": from_code,
                    "to_node_code": to_code,
                    "length_m": round(math.dist(start, end), 2),
                    "diameter_mm": pipe_diameter_for(item["code"]),
                    "geometry_points": [
                        {"x": float(start[0]), "y": float(start[1]), "z": from_altitude},
                        {"x": float(end[0]), "y": float(end[1]), "z": to_altitude},
                    ],
                }
            )

    return {
        "import_mode": "complex_validation_sidecar",
        "overwrite_existing": True,
        "nodes": nodes,
        "pipes": pipes,
    }


def find_unreachable_outlets(graph_draft: dict) -> list[str]:
    directed: dict[str, set[str]] = defaultdict(set)
    source_nodes: set[str] = set()
    outlet_nodes: set[str] = set()

    for node in graph_draft["nodes"]:
        node_type = str(node.get("node_type") or "").strip().lower()
        node_code = str(node.get("node_code") or "").strip()
        if not node_code:
            continue
        if node_type == "source_station":
            source_nodes.add(node_code)
        elif node_type == "outlet":
            outlet_nodes.add(node_code)

    for pipe_item in graph_draft["pipes"]:
        start = str(pipe_item.get("from_node_code") or "").strip()
        end = str(pipe_item.get("to_node_code") or "").strip()
        if start and end:
            directed[start].add(end)

    unreachable: list[str] = []
    for outlet_code in sorted(outlet_nodes):
        queue = deque(source_nodes)
        visited = set(source_nodes)
        reachable = False
        while queue:
            current = queue.popleft()
            if current == outlet_code:
                reachable = True
                break
            for adjacent in directed.get(current, set()):
                if adjacent in visited:
                    continue
                visited.add(adjacent)
                queue.append(adjacent)
        if not reachable:
            unreachable.append(outlet_code)

    return unreachable


def validate_graph_draft(graph_draft: dict) -> None:
    unreachable_outlets = find_unreachable_outlets(graph_draft)
    if unreachable_outlets:
        raise ValueError(
            "complex validation template has outlets unreachable from source stations in directed graph: "
            + ", ".join(unreachable_outlets)
        )


def add_layers(doc: ezdxf.EzDxfDocument) -> None:
    for name, color_index, _label in LAYER_SPECS:
        if name not in doc.layers:
            doc.layers.add(name=name, color=color_index)


def ensure_symbol_blocks(doc: ezdxf.EzDxfDocument) -> None:
    if BLOCK_NAMES["source_station"] not in doc.blocks:
        block = doc.blocks.new(name=BLOCK_NAMES["source_station"])
        block.add_circle((0, 0), radius=4.8)
        block.add_line((-2.2, 0), (2.2, 0))
        block.add_line((0, -2.2), (0, 2.2))

    if BLOCK_NAMES["valve"] not in doc.blocks:
        block = doc.blocks.new(name=BLOCK_NAMES["valve"])
        block.add_lwpolyline([(-4, 0), (0, 4), (4, 0), (0, -4), (-4, 0)])

    if BLOCK_NAMES["outlet"] not in doc.blocks:
        block = doc.blocks.new(name=BLOCK_NAMES["outlet"])
        block.add_circle((0, 0), radius=4.0)
        block.add_line((0, 4), (0, 8))
        block.add_line((-3, 8), (3, 8))

    if BLOCK_NAMES["sensor"] not in doc.blocks:
        block = doc.blocks.new(name=BLOCK_NAMES["sensor"])
        block.add_lwpolyline([(-3.5, -3), (3.5, -3), (0, 3.5), (-3.5, -3)])


def add_symbols(doc: ezdxf.EzDxfDocument) -> None:
    ensure_symbol_blocks(doc)
    msp = doc.modelspace()

    for item in POINTS:
        x, y = item["point"]
        msp.add_blockref(BLOCK_NAMES[item["kind"]], (x, y), dxfattribs={"layer": item["layer"]})

    for item in PIPES:
        msp.add_lwpolyline(item["points"], dxfattribs={"layer": "HJ_PIPE"})


def create_doc() -> ezdxf.EzDxfDocument:
    doc = ezdxf.new("R2000")
    doc.units = M
    doc.header["$MEASUREMENT"] = 1
    doc.header["$LUNITS"] = 2
    doc.header["$INSUNITS"] = 6
    add_layers(doc)
    add_symbols(doc)
    return doc


def build_counts(graph_draft: dict) -> dict:
    return {
        "source_stations": sum(1 for item in POINTS if item["kind"] == "source_station"),
        "pump_units": sum(1 for node in graph_draft["nodes"] for unit in node["pump_units"] if unit.get("enabled", True)),
        "valves": sum(1 for item in POINTS if item["kind"] == "valve"),
        "outlets": sum(1 for item in POINTS if item["kind"] == "outlet"),
        "sensors": sum(1 for item in POINTS if item["kind"] == "sensor"),
        "pipes": len(PIPES),
    }


def write_spec(output_dir: Path, graph_draft: dict) -> None:
    rows = "\n".join(f"| `{name}` | {label} |" for name, _color, label in LAYER_SPECS)
    counts = build_counts(graph_draft)
    content = f"""
    # 厚基农服复杂管网 DXF 验证模板说明

    ## 1. 文件内容
    - 模板图纸：`{DXF_NAME}`
    - Sidecar 清单：`{MANIFEST_NAME}`
    - 元数据：`{META_NAME}`

    ## 2. 拓扑特点
    - 5 个水源点位先汇入上部主干管。
    - 通过 3 条联络竖管把上部主干接入中部配水干管。
    - 中部配水干管下挂 5 个灌水分区，每个分区 3 个出水口，共 15 个出水口。
    - 走线遵循“上部主干 -> 中部配水干管 -> 分区竖向支干 -> 田间支管 -> 出水口支线”，避免无意义折返。
    - 供水节点统一使用 `source_station`，机井 / 泵站通过 `source_kind` 区分。
    - 物理泵不再作为独立顶层节点，而是挂在 `pump_units[]` 下。

    ## 3. 当前模板规模
    - {counts["source_stations"]} 个水源点位
    - {counts["pump_units"]} 个 `pump_units`
    - {counts["valves"]} 个阀门
    - {counts["outlets"]} 个出水口
    - {counts["sensors"]} 个传感器
    - {counts["pipes"]} 条绘图管线

    ## 4. 图层标准
    | 图层名 | 中文说明 |
    | --- | --- |
    {rows}

    ## 5. 制图规范
    1. 一张 DXF 只对应一个地块，不要把多个地块画在同一张导入图里。
    2. 一个图层只放一种对象，不允许混放。
    3. `HJ_PIPE` 只允许放管道中心线，只允许 `LINE` 或 `LWPOLYLINE`。
    4. `HJ_SOURCE_STATION / HJ_VALVE / HJ_OUTLET / HJ_SENSOR` 建议使用标准块 `INSERT`，不要炸块。
    5. DXF 中不要放图框、标题、图例、尺寸线、装饰符号。
    6. DXF 不直接表达控制器、终端台账和资产归口，它只负责导入点位与网络关系。
    7. 点位经纬度需要在工作台中通过“基准点投射”或手工回填补齐，发布前必须确认完整。

    ## 5.1 管线方向提醒
    - 涉及三通或分叉时，每个供水方向单独画成一条管线。
    - 不要用一条 `LWPOLYLINE` 从左端穿过三通再到右端，否则导入后会在一侧形成反向管段。
    - 系统会把管线首点到末点视为上游到下游方向，所以支线和田间支管要按供水方向绘制。

    ## 6. 系统映射口径
    - `HJ_SOURCE_STATION -> source_station`
    - `HJ_VALVE -> valve`
    - `HJ_PIPE -> pipe_main / pipe_branch`
    - `HJ_OUTLET -> outlet`
    - `HJ_SENSOR -> sensor`

    补充说明：
    - `source_kind=groundwater` 的点位显示为“机井”
    - `source_kind=surface_water / river` 的点位显示为“泵站”
    - `pump_units` 作为终端单元配置保存在 sidecar 中

    ## 7. 验证重点
    1. 验证导入后只生成 `source_station` 水源点位，而不是旧的“机井节点 + 泵站节点”双层模型。
    2. 验证主干、联络、分区支干和田间支线的拓扑是否被完整识别。
    3. 验证出水口上游校验是否要求“可追到水源站，且站下存在可用泵能力”。
    4. 验证批量初始化后是否按“点位 -> 控制器 -> 终端单元 -> 资产归口”生成默认台账。
    """
    (output_dir / SPEC_NAME).write_text(textwrap.dedent(content).strip() + "\n", encoding="utf-8")


def write_manifest(output_dir: Path, graph_draft: dict) -> None:
    counts = build_counts(graph_draft)
    manifest = {
        "type": "dxf_import_manifest",
        "template_name": "houji_complex_validation_template",
        "layer_mapping": LAYER_MAPPING,
        "layers": [name for name, _color, _label in LAYER_SPECS],
        "counts": counts,
        "point_symbol_mode": "insert_block",
        "required_insert_layers": ["HJ_SOURCE_STATION", "HJ_VALVE", "HJ_OUTLET", "HJ_SENSOR"],
        "outlet_zone_distribution": ZONE_OUTLET_DISTRIBUTION,
        "topology_signature": {
            "upper_trunk": True,
            "middle_manifold": True,
            "interties": 3,
            "zones": len(ZONE_OUTLET_DISTRIBUTION),
            "routing_style": "top_trunk_to_middle_manifold_to_zone_laterals",
        },
        "parameter_profiles": {
            "pump_power_kw_options": sorted({profile["rated_power_kw"] for profile in PUMP_PROFILES}),
            "pump_head_m_options": sorted({profile["rated_head_m"] for profile in PUMP_PROFILES}),
            "source_kind_options": sorted({profile["source_kind"] for profile in PUMP_PROFILES}),
            "elevation_range_m": [8.0, 42.0],
            "source_model": "source_station_nodes_with_pump_units",
        },
        "graph_draft": graph_draft,
    }
    (output_dir / MANIFEST_NAME).write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")


def write_metadata(output_dir: Path, graph_draft: dict) -> None:
    counts = build_counts(graph_draft)
    metadata = {
        "template_name": "houji_complex_validation_template",
        "format": "DXF",
        "version": "R2000",
        "units": "meter",
        "counts": counts,
        "topology_features": {
            "upper_trunk": True,
            "middle_manifold": True,
            "interties": 3,
            "zones": len(ZONE_OUTLET_DISTRIBUTION),
            "outlet_zone_distribution": ZONE_OUTLET_DISTRIBUTION,
        },
        "parameter_profiles": {
            "pump_power_kw_options": sorted({profile["rated_power_kw"] for profile in PUMP_PROFILES}),
            "pump_head_m_options": sorted({profile["rated_head_m"] for profile in PUMP_PROFILES}),
            "source_kind_options": sorted({profile["source_kind"] for profile in PUMP_PROFILES}),
            "elevation_range_m": [8.0, 42.0],
            "sidecar_graph_nodes": len(graph_draft["nodes"]),
            "sidecar_graph_pipes": len(graph_draft["pipes"]),
            "source_model": "source_station_nodes_with_pump_units",
        },
        "layer_mapping": LAYER_MAPPING,
        "symbol_mode": {
            "source_station": "insert_block",
            "valve": "insert_block",
            "outlet": "insert_block",
            "sensor": "insert_block",
        },
    }
    (output_dir / META_NAME).write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")


def copy_to_public(output_dir: Path) -> None:
    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    for name in [DXF_NAME, SPEC_NAME, MANIFEST_NAME, META_NAME]:
        shutil.copy2(output_dir / name, PUBLIC_DIR / name)


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    graph_draft = build_graph_draft()
    validate_graph_draft(graph_draft)

    doc = create_doc()
    doc.saveas(OUTPUT_DIR / DXF_NAME)
    write_spec(OUTPUT_DIR, graph_draft)
    write_manifest(OUTPUT_DIR, graph_draft)
    write_metadata(OUTPUT_DIR, graph_draft)
    copy_to_public(OUTPUT_DIR)

    print(f"[cad-template] generated complex validation DXF in {OUTPUT_DIR}")
    print(f"[cad-template] copied public downloads to {PUBLIC_DIR}")


if __name__ == "__main__":
    main()
