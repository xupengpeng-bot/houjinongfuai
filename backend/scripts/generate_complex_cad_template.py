from __future__ import annotations

import json
import shutil
import textwrap
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
    ("HJ_WELL", 1, "机井"),
    ("HJ_PUMP", 3, "泵站"),
    ("HJ_VALVE", 30, "阀门/电磁阀"),
    ("HJ_PIPE", 5, "管道"),
    ("HJ_OUTLET", 6, "出水口"),
    ("HJ_SENSOR", 140, "传感器"),
]

LAYER_MAPPING = {
    "well_layer": "HJ_WELL",
    "pump_layer": "HJ_PUMP",
    "valve_layer": "HJ_VALVE",
    "pipe_layer": "HJ_PIPE",
    "outlet_layer": "HJ_OUTLET",
    "sensor_layer": "HJ_SENSOR",
}

BLOCK_NAMES = {
    "well": "HJ_WELL_BLOCK",
    "pump": "HJ_PUMP_BLOCK",
    "valve": "HJ_VALVE_BLOCK",
    "outlet": "HJ_OUTLET_BLOCK",
    "sensor": "HJ_SENSOR_BLOCK",
}


def point(code: str, kind: str, x: float, y: float) -> dict:
    layer = {
        "well": "HJ_WELL",
        "pump": "HJ_PUMP",
        "valve": "HJ_VALVE",
        "outlet": "HJ_OUTLET",
        "sensor": "HJ_SENSOR",
    }[kind]
    return {"code": code, "kind": kind, "layer": layer, "point": (x, y)}


def pipe(code: str, *points: tuple[float, float]) -> dict:
    return {"code": code, "points": list(points)}


POINTS = [
    point("W01", "well", 60, 390),
    point("W02", "well", 180, 390),
    point("W03", "well", 260, 390),
    point("W04", "well", 420, 390),
    point("W05", "well", 500, 390),
    point("P01", "pump", 100, 360),
    point("P02", "pump", 180, 360),
    point("P03", "pump", 260, 360),
    point("P04", "pump", 420, 360),
    point("P05", "pump", 500, 360),
    point("V01", "valve", 100, 340),
    point("V02", "valve", 180, 340),
    point("V03", "valve", 260, 340),
    point("V04", "valve", 420, 340),
    point("V05", "valve", 500, 340),
    point("V06", "valve", 140, 280),
    point("V07", "valve", 300, 280),
    point("V08", "valve", 460, 280),
    point("V09", "valve", 140, 210),
    point("V10", "valve", 300, 210),
    point("V11", "valve", 460, 210),
    point("V12", "valve", 220, 280),
    point("V13", "valve", 380, 280),
    point("V14", "valve", 260, 240),
    point("V15", "valve", 420, 240),
    point("S01", "sensor", 160, 320),
    point("S02", "sensor", 280, 320),
    point("S03", "sensor", 440, 320),
    point("S04", "sensor", 180, 240),
    point("S05", "sensor", 340, 240),
    point("S06", "sensor", 140, 220),
    point("S07", "sensor", 300, 200),
    point("S08", "sensor", 460, 140),
    point("O01", "outlet", 80, 160),
    point("O02", "outlet", 140, 150),
    point("O03", "outlet", 200, 160),
    point("O04", "outlet", 220, 145),
    point("O05", "outlet", 260, 135),
    point("O06", "outlet", 300, 145),
    point("O07", "outlet", 340, 135),
    point("O08", "outlet", 380, 145),
    point("O09", "outlet", 400, 140),
    point("O10", "outlet", 440, 130),
    point("O11", "outlet", 480, 140),
    point("O12", "outlet", 520, 130),
    point("O13", "outlet", 60, 85),
    point("O14", "outlet", 100, 75),
    point("O15", "outlet", 140, 85),
    point("O16", "outlet", 180, 75),
    point("O17", "outlet", 220, 85),
    point("O18", "outlet", 240, 75),
    point("O19", "outlet", 280, 65),
    point("O20", "outlet", 320, 75),
    point("O21", "outlet", 360, 65),
    point("O22", "outlet", 410, 65),
    point("O23", "outlet", 460, 55),
    point("O24", "outlet", 510, 65),
]

PIPES = [
    pipe("PW01", (60, 390), (100, 360)),
    pipe("PW02", (180, 390), (180, 360)),
    pipe("PW03", (260, 390), (260, 360)),
    pipe("PW04", (420, 390), (420, 360)),
    pipe("PW05", (500, 390), (500, 360)),
    pipe("PD01", (100, 360), (100, 340), (100, 320)),
    pipe("PD02", (180, 360), (180, 340), (180, 320)),
    pipe("PD03", (260, 360), (260, 340), (260, 320)),
    pipe("PD04", (420, 360), (420, 340), (420, 320)),
    pipe("PD05", (500, 360), (500, 340), (500, 320)),
    pipe(
        "TRUNK_TOP",
        (100, 320),
        (140, 320),
        (180, 320),
        (220, 320),
        (260, 320),
        (300, 320),
        (340, 320),
        (380, 320),
        (420, 320),
        (460, 320),
        (500, 320),
    ),
    pipe("TRUNK_BOTTOM", (140, 240), (220, 240), (300, 240), (380, 240), (460, 240)),
    pipe("INTERTIE_01", (220, 320), (220, 280), (220, 240)),
    pipe("INTERTIE_02", (380, 320), (380, 280), (380, 240)),
    pipe("ZONE_A_STEM", (140, 320), (140, 280), (140, 220), (140, 190)),
    pipe("ZONE_A_LATERAL", (80, 190), (140, 190), (200, 190)),
    pipe("ZONE_A_DROP_01", (80, 190), (80, 160)),
    pipe("ZONE_A_DROP_02", (140, 190), (140, 150)),
    pipe("ZONE_A_DROP_03", (200, 190), (200, 160)),
    pipe("ZONE_B_STEM", (300, 320), (300, 280), (300, 200), (300, 180)),
    pipe("ZONE_B_LATERAL", (220, 180), (260, 180), (300, 180), (340, 180), (380, 180)),
    pipe("ZONE_B_DROP_04", (220, 180), (220, 145)),
    pipe("ZONE_B_DROP_05", (260, 180), (260, 135)),
    pipe("ZONE_B_DROP_06", (300, 180), (300, 145)),
    pipe("ZONE_B_DROP_07", (340, 180), (340, 135)),
    pipe("ZONE_B_DROP_08", (380, 180), (380, 145)),
    pipe("ZONE_C_STEM", (460, 320), (460, 280), (460, 175)),
    pipe("ZONE_C_LATERAL", (400, 175), (440, 175), (480, 175), (520, 175)),
    pipe("ZONE_C_DROP_09", (400, 175), (400, 140)),
    pipe("ZONE_C_DROP_10", (440, 175), (440, 130)),
    pipe("ZONE_C_DROP_11", (480, 175), (480, 140)),
    pipe("ZONE_C_DROP_12", (520, 175), (520, 130)),
    pipe("ZONE_D_STEM", (140, 240), (140, 210), (140, 120)),
    pipe("ZONE_D_LATERAL", (60, 120), (100, 120), (140, 120), (180, 120), (220, 120)),
    pipe("ZONE_D_DROP_13", (60, 120), (60, 85)),
    pipe("ZONE_D_DROP_14", (100, 120), (100, 75)),
    pipe("ZONE_D_DROP_15", (140, 120), (140, 85)),
    pipe("ZONE_D_DROP_16", (180, 120), (180, 75)),
    pipe("ZONE_D_DROP_17", (220, 120), (220, 85)),
    pipe("ZONE_E_STEM", (300, 240), (300, 210), (300, 110)),
    pipe("ZONE_E_LATERAL", (240, 110), (280, 110), (320, 110), (360, 110)),
    pipe("ZONE_E_DROP_18", (240, 110), (240, 75)),
    pipe("ZONE_E_DROP_19", (280, 110), (280, 65)),
    pipe("ZONE_E_DROP_20", (320, 110), (320, 75)),
    pipe("ZONE_E_DROP_21", (360, 110), (360, 65)),
    pipe("ZONE_F_STEM", (460, 240), (460, 210), (460, 140), (460, 100)),
    pipe("ZONE_F_LATERAL", (410, 100), (460, 100), (510, 100)),
    pipe("ZONE_F_DROP_22", (410, 100), (410, 65)),
    pipe("ZONE_F_DROP_23", (460, 100), (460, 55)),
    pipe("ZONE_F_DROP_24", (510, 100), (510, 65)),
]

PUMP_PROFILES = [
    {"rated_power_kw": 37.5, "rated_head_m": 110, "rated_flow_m3h": 58, "well_depth_m": 96},
    {"rated_power_kw": 13.5, "rated_head_m": 90, "rated_flow_m3h": 30, "well_depth_m": 82},
    {"rated_power_kw": 37.5, "rated_head_m": 90, "rated_flow_m3h": 54, "well_depth_m": 88},
    {"rated_power_kw": 13.5, "rated_head_m": 110, "rated_flow_m3h": 28, "well_depth_m": 101},
    {"rated_power_kw": 37.5, "rated_head_m": 110, "rated_flow_m3h": 62, "well_depth_m": 108},
]

OUTLET_TARGET_FLOWS = [8, 10, 12, 9, 7, 11, 10, 9, 12, 8, 11, 10, 6, 7, 8, 6, 9, 7, 8, 9, 8, 10, 9, 11]
OUTLET_MIN_PRESSURES = [18, 20, 22, 19, 18, 23, 21, 20, 24, 18, 22, 21, 17, 18, 19, 17, 20, 18, 19, 20, 19, 21, 20, 22]
SENSOR_KIND_SEQUENCE = ["pressure", "flow", "pressure", "flow", "pressure", "level", "pressure", "flow"]


def stable_jitter(code: str) -> int:
    return sum(ord(ch) for ch in code)


def altitude_for(code: str, x: float, y: float) -> float:
    gradient_component = ((390 - y) / 335.0) * 26.0
    jitter_component = (stable_jitter(code) % 8)
    return round(max(8.0, min(48.0, 8.0 + gradient_component + jitter_component)), 1)


def outlet_profile(index: int) -> dict:
    target_flow = OUTLET_TARGET_FLOWS[index % len(OUTLET_TARGET_FLOWS)]
    min_pressure = OUTLET_MIN_PRESSURES[index % len(OUTLET_MIN_PRESSURES)]
    irrigation_area = round(target_flow * 3.8 + (index % 4) * 2.5, 1)
    return {
        "target_flow_m3h": target_flow,
        "min_pressure_m": min_pressure,
        "max_pressure_m": min_pressure + 35,
        "irrigation_area_mu": irrigation_area,
    }


def sensor_profile(index: int) -> dict:
    kind = SENSOR_KIND_SEQUENCE[index % len(SENSOR_KIND_SEQUENCE)]
    if kind == "flow":
        return {"sensor_kind": kind, "range_min": 0, "range_max": 80}
    if kind == "level":
        return {"sensor_kind": kind, "range_min": 0, "range_max": 25}
    return {"sensor_kind": kind, "range_min": 0, "range_max": 160}


def valve_profile(index: int) -> dict:
    kv_base = 170 + (index % 5) * 20
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
    if code.startswith("TRUNK_TOP"):
        return 280
    if code.startswith("TRUNK_BOTTOM"):
        return 240
    if code.startswith("INTERTIE"):
        return 220
    if code.startswith("PW"):
        return 220
    if code.startswith("PD"):
        return 200
    if "STEM" in code:
        return 180
    if "LATERAL" in code:
        return 140
    if "DROP" in code:
        return 110
    return 160


def build_graph_draft() -> dict:
    points_by_coord = {(float(x), float(y)): item for item in POINTS for x, y in [item["point"]]}
    nodes: list[dict] = []
    node_codes_by_coord: dict[tuple[float, float], str] = {}
    junction_counter = 1

    for item in POINTS:
        code = item["code"]
        x, y = item["point"]
        kind = item["kind"]
        altitude = altitude_for(code, x, y)
        node_params: dict = {}
        pump_units: list[dict] = []

        if kind in {"well", "pump"}:
            profile = PUMP_PROFILES[int(code[-2:]) - 1]
            if kind == "well":
                node_params = {
                    "well_depth_m": profile["well_depth_m"],
                    "design_flow_m3h": round(profile["rated_flow_m3h"] * 0.95, 1),
                    "pump_head_m": profile["rated_head_m"],
                    "rated_power_kw": profile["rated_power_kw"],
                }
            else:
                node_params = {
                    "rated_flow_m3h": profile["rated_flow_m3h"],
                    "rated_head_m": profile["rated_head_m"],
                    "rated_power_kw": profile["rated_power_kw"],
                }
            pump_units = [
                {
                    "unit_code": f"{code}-U01",
                    "unit_name": f"{code}-PUMP-01",
                    "enabled": True,
                    "rated_flow_m3h": profile["rated_flow_m3h"],
                    "rated_head_m": profile["rated_head_m"],
                    "rated_power_kw": profile["rated_power_kw"],
                    "asset_ids": [],
                    "device_ids": [],
                }
            ]
        elif kind == "valve":
            node_params = valve_profile(int(code[-2:]) - 1)
        elif kind == "outlet":
            node_params = outlet_profile(int(code[-2:]) - 1)
        elif kind == "sensor":
            node_params = sensor_profile(int(code[-2:]) - 1)

        nodes.append(
            {
                "node_code": code,
                "node_name": code,
                "node_type": kind,
                "asset_id": None,
                "asset_ids": [],
                "device_ids": [],
                "node_params": node_params,
                "pump_units": pump_units,
                "cad_x": x,
                "cad_y": y,
                "latitude": None,
                "longitude": None,
                "altitude": altitude,
            }
        )
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
            dx = end[0] - start[0]
            dy = end[1] - start[1]
            length = round((dx * dx + dy * dy) ** 0.5, 2)
            pipes.append(
                {
                    "pipe_code": item["code"] if len(points) == 2 else f"{item['code']}_{index + 1:02d}",
                    "pipe_type": pipe_type_for(item["code"]),
                    "from_node_code": from_code,
                    "to_node_code": to_code,
                    "length_m": length,
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


def add_layers(doc: ezdxf.EzDxfDocument) -> None:
    for name, color_index, _label in LAYER_SPECS:
        if name not in doc.layers:
            doc.layers.add(name=name, color=color_index)


def ensure_symbol_blocks(doc: ezdxf.EzDxfDocument) -> None:
    if BLOCK_NAMES["well"] not in doc.blocks:
        block = doc.blocks.new(name=BLOCK_NAMES["well"])
        block.add_circle((0, 0), radius=4.5)
        block.add_line((-2.2, 0), (2.2, 0))
        block.add_line((0, -2.2), (0, 2.2))

    if BLOCK_NAMES["pump"] not in doc.blocks:
        block = doc.blocks.new(name=BLOCK_NAMES["pump"])
        block.add_circle((0, 0), radius=5.0)
        block.add_lwpolyline([(-1.8, -2.4), (2.5, 0), (-1.8, 2.4), (-1.8, -2.4)])

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


def write_spec(output_dir: Path) -> None:
    rows = "\n".join(f"| `{name}` | {label} |" for name, _color, label in LAYER_SPECS)
    content = f"""
# 厚基农服复杂管网 DXF 验证样图说明

## 1. 文件说明
- 样图文件：`{DXF_NAME}`
- 说明文档：`{SPEC_NAME}`
- sidecar / 映射示例：`{MANIFEST_NAME}`

## 2. 当前样图包含内容
- 5 个机井
- 5 个泵站
- 15 个阀门 / 电磁阀
- 24 个出水口
- 8 个传感器
- 49 段管道中心线

## 3. 拓扑特征
- 上层主干管为一条连续供水总管，5 台泵分别从不同入口注入。
- 下层为一条环形次级母管，通过 2 条联络管与上层主干相连。
- 一共布置 6 个灌溉分区，出水口分布并不均匀，分别为 `3 / 5 / 4 / 5 / 4 / 3`。
- 下层分区可以通过联络管获得多泵供水，不是简单的一泵一支路或一泵四口。
- 适合验证：多泵择优供水、分区联动、阀门高亮、环状管网寻路、复杂出水口组合求解。

## 4. 图层标准
| 图层名 | 中文说明 |
| --- | --- |
{rows}

## 5. 验证建议
1. 先单独开启上层分区出水口，确认系统能只联动必要泵阀。
2. 再同时开启上层与下层多个分区，确认联络管和下层母管参与求解。
3. 验证某一台泵可满足需求时，其他备选泵不应误亮支路。
4. 验证关闭某个分区后，其他仍在运行的分区链路不受影响。
5. 验证传感器是否能跟随活跃母管、分支和末端区同步点亮。

## 6. 参数说明
- `import.json` 内已内嵌 `graph_draft`，可作为 sidecar 一并上传。
- 泵功率混合使用 `13.5kW / 37.5kW` 两档。
- 泵扬程混合使用 `90m / 110m` 两档。
- 节点高程为确定性随机值，整体高差控制在 40 米以内。
- 出水口目标流量、最小压力、灌溉面积，阀门 `Kv`、默认开度，传感器类型与量程均已预填。
- 当前系统的资产/设备主数据接口还不直接存额定功率/扬程/流量，这些参数会优先通过节点参数和子泵参数参与求解。
"""
    (output_dir / SPEC_NAME).write_text(textwrap.dedent(content).strip() + "\n", encoding="utf-8")


def write_manifest(output_dir: Path) -> None:
    graph_draft = build_graph_draft()
    manifest = {
        "type": "dxf_import_manifest",
        "template_name": "houji_complex_validation_template",
        "layer_mapping": LAYER_MAPPING,
        "layers": [name for name, _color, _label in LAYER_SPECS],
        "counts": {
            "wells": sum(1 for item in POINTS if item["kind"] == "well"),
            "pumps": sum(1 for item in POINTS if item["kind"] == "pump"),
            "valves": sum(1 for item in POINTS if item["kind"] == "valve"),
            "outlets": sum(1 for item in POINTS if item["kind"] == "outlet"),
            "sensors": sum(1 for item in POINTS if item["kind"] == "sensor"),
            "pipes": len(PIPES),
        },
        "point_symbol_mode": "insert_block",
        "required_insert_layers": ["HJ_VALVE", "HJ_SENSOR", "HJ_OUTLET", "HJ_PUMP", "HJ_WELL"],
        "outlet_zone_distribution": [3, 5, 4, 5, 4, 3],
        "parameter_profiles": {
            "pump_power_kw_options": [13.5, 37.5],
            "pump_head_m_options": [90, 110],
            "elevation_range_m": [8.0, 48.0],
        },
        "graph_draft": graph_draft,
    }
    (output_dir / MANIFEST_NAME).write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")


def write_metadata(output_dir: Path) -> None:
    graph_draft = build_graph_draft()
    metadata = {
        "template_name": "houji_complex_validation_template",
        "format": "DXF",
        "version": "R2000",
        "units": "meter",
        "counts": {
            "wells": sum(1 for item in POINTS if item["kind"] == "well"),
            "pumps": sum(1 for item in POINTS if item["kind"] == "pump"),
            "valves": sum(1 for item in POINTS if item["kind"] == "valve"),
            "outlets": sum(1 for item in POINTS if item["kind"] == "outlet"),
            "sensors": sum(1 for item in POINTS if item["kind"] == "sensor"),
            "pipes": len(PIPES),
        },
        "topology_features": {
            "upper_trunk": True,
            "lower_ring": True,
            "interties": 2,
            "zones": 6,
            "outlet_zone_distribution": [3, 5, 4, 5, 4, 3],
        },
        "parameter_profiles": {
            "pump_power_kw_options": [13.5, 37.5],
            "pump_head_m_options": [90, 110],
            "elevation_range_m": [8.0, 48.0],
            "sidecar_graph_nodes": len(graph_draft["nodes"]),
            "sidecar_graph_pipes": len(graph_draft["pipes"]),
        },
        "layer_mapping": LAYER_MAPPING,
        "symbol_mode": {
            "well": "insert_block",
            "pump": "insert_block",
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
    doc = create_doc()
    doc.saveas(OUTPUT_DIR / DXF_NAME)
    write_spec(OUTPUT_DIR)
    write_manifest(OUTPUT_DIR)
    write_metadata(OUTPUT_DIR)
    copy_to_public(OUTPUT_DIR)
    print(f"[cad-template] generated complex validation DXF in {OUTPUT_DIR}")
    print(f"[cad-template] copied public downloads to {PUBLIC_DIR}")


if __name__ == "__main__":
    main()
