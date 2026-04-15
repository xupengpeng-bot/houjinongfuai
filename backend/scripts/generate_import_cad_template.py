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

DXF_NAME = "houji-import-template.dxf"
SPEC_NAME = "houji-import-template-spec.md"
META_NAME = "houji-import-template.metadata.json"
MANIFEST_NAME = "houji-import-template.import.json"

LAYER_SPECS = [
    ("HJ_SOURCE_STATION", 1, "水源点位（机井/泵站）"),
    ("HJ_VALVE", 30, "阀门/电磁阀"),
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


def point(code: str, kind: str, x: float, y: float, **extra: object) -> dict:
    layer = {
        "source_station": "HJ_SOURCE_STATION",
        "valve": "HJ_VALVE",
        "outlet": "HJ_OUTLET",
        "sensor": "HJ_SENSOR",
    }[kind]
    return {"code": code, "kind": kind, "layer": layer, "point": (x, y), **extra}


POINTS = [
    point("ST01", "source_station", 80, 220, source_kind="groundwater", rated_flow_m3h=28, rated_head_m=88, rated_power_kw=13.5),
    point("ST02", "source_station", 170, 220, source_kind="groundwater", rated_flow_m3h=32, rated_head_m=92, rated_power_kw=18.5),
    point("ST03", "source_station", 260, 220, source_kind="groundwater", rated_flow_m3h=36, rated_head_m=98, rated_power_kw=22),
    point("ST04", "source_station", 390, 220, source_kind="surface_water", rated_flow_m3h=44, rated_head_m=36, rated_power_kw=11),
    point("ST05", "source_station", 480, 220, source_kind="river", rated_flow_m3h=46, rated_head_m=34, rated_power_kw=11),
    point("ST06", "source_station", 570, 220, source_kind="canal", rated_flow_m3h=48, rated_head_m=32, rated_power_kw=11),
    point("V01", "valve", 150, 170),
    point("V02", "valve", 320, 170),
    point("V03", "valve", 450, 170),
    point("V04", "valve", 530, 170),
    point("S01", "sensor", 230, 190, sensor_kind="flow"),
    point("S02", "sensor", 470, 190, sensor_kind="pressure"),
    point("O01", "outlet", 250, 90),
    point("O02", "outlet", 500, 90),
]

PIPES = [
    {"code": "P01", "from": "ST01", "to": "V01"},
    {"code": "P02", "from": "ST02", "to": "V01"},
    {"code": "P03", "from": "V01", "to": "S01"},
    {"code": "P04", "from": "S01", "to": "V02"},
    {"code": "P05", "from": "ST03", "to": "V02"},
    {"code": "P06", "from": "V02", "to": "O01"},
    {"code": "P07", "from": "ST04", "to": "S02"},
    {"code": "P08", "from": "ST05", "to": "V03"},
    {"code": "P09", "from": "S02", "to": "V03"},
    {"code": "P10", "from": "V03", "to": "V04"},
    {"code": "P11", "from": "ST06", "to": "V04"},
    {"code": "P12", "from": "V04", "to": "O02"},
]


def altitude_for(code: str) -> float:
    return round(10 + (sum(ord(ch) for ch in code) % 12) * 1.3, 1)


def point_lookup() -> dict[str, tuple[float, float]]:
    return {item["code"]: item["point"] for item in POINTS}


def build_source_station_node(item: dict) -> dict:
    code = item["code"]
    x, y = item["point"]
    source_kind = str(item["source_kind"])
    node_params = {
        "source_kind": source_kind,
        "design_flow_m3h": item["rated_flow_m3h"],
        "pump_head_m": item["rated_head_m"],
        "rated_flow_m3h": item["rated_flow_m3h"],
        "rated_head_m": item["rated_head_m"],
        "rated_power_kw": item["rated_power_kw"],
    }
    if source_kind == "groundwater":
        node_params.update(
            {
                "well_depth_m": 80 + (sum(ord(ch) for ch in code) % 20),
                "static_water_level_m": 26,
                "dynamic_water_level_m": 38,
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
                "unit_name": f"{code}-1号泵",
                "enabled": True,
                "rated_flow_m3h": item["rated_flow_m3h"],
                "rated_head_m": item["rated_head_m"],
                "rated_power_kw": item["rated_power_kw"],
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
        "altitude": altitude_for(code),
    }


def build_graph_draft() -> dict:
    nodes: list[dict] = []
    for item in POINTS:
        code = item["code"]
        x, y = item["point"]
        kind = item["kind"]
        altitude = altitude_for(code)

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
                "node_params": {
                    "valve_mode": "solenoid",
                    "default_open_ratio_pct": 100,
                    "kv_value": 180,
                },
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
                "node_params": {
                    "target_flow_m3h": 10 if code == "O01" else 14,
                    "min_pressure_m": 18 if code == "O01" else 20,
                    "irrigation_area_mu": 38 if code == "O01" else 52,
                },
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
                "node_params": {
                    "sensor_kind": item["sensor_kind"],
                    "range_min": 0,
                    "range_max": 80 if item["sensor_kind"] == "flow" else 160,
                },
                "pump_units": [],
                "cad_x": x,
                "cad_y": y,
                "latitude": None,
                "longitude": None,
                "altitude": altitude,
            }

        nodes.append(node)

    coords = point_lookup()
    pipes = []
    for item in PIPES:
        from_code = item["from"]
        to_code = item["to"]
        start = coords[from_code]
        end = coords[to_code]
        pipes.append(
            {
                "pipe_code": item["code"],
                "pipe_type": "main" if item["code"] in {"P03", "P04", "P07", "P09", "P10", "P12"} else "branch",
                "from_node_code": from_code,
                "to_node_code": to_code,
                "length_m": round(((end[0] - start[0]) ** 2 + (end[1] - start[1]) ** 2) ** 0.5, 2),
                "diameter_mm": 180 if item["code"] in {"P03", "P04", "P07", "P09", "P10", "P12"} else 140,
                "geometry_points": [
                    {"x": float(start[0]), "y": float(start[1]), "z": altitude_for(from_code)},
                    {"x": float(end[0]), "y": float(end[1]), "z": altitude_for(to_code)},
                ],
            }
        )

    return {
        "import_mode": "unified_import_template",
        "overwrite_existing": True,
        "nodes": nodes,
        "pipes": pipes,
    }


def add_layers(doc: ezdxf.EzDxfDocument) -> None:
    for name, color_index, _label in LAYER_SPECS:
        if name not in doc.layers:
            doc.layers.add(name=name, color=color_index)


def ensure_symbol_blocks(doc: ezdxf.EzDxfDocument) -> None:
    if BLOCK_NAMES["source_station"] not in doc.blocks:
        block = doc.blocks.new(name=BLOCK_NAMES["source_station"])
        block.add_circle((0, 0), radius=4.5)
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

    coords = point_lookup()
    for item in PIPES:
        start = coords[item["from"]]
        end = coords[item["to"]]
        msp.add_lwpolyline([start, end], dxfattribs={"layer": "HJ_PIPE"})


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
# 厚基农服 DXF 导入模板说明

## 1. 文件说明
- 模板文件：`{DXF_NAME}`
- 说明文档：`{SPEC_NAME}`
- 映射示例：`{MANIFEST_NAME}`
- 元数据：`{META_NAME}`

## 2. 当前模板包含内容
- 6 个水源点位
- 6 个 `pump_units`
- 4 个阀门/电磁阀
- 2 个出水口
- 2 个传感器
- 12 段管道

## 3. 统一模型口径
- DXF 只表达 `点位 + 拓扑关系`，不要求先把完整设备树录完。
- 供水类点位统一落在 `HJ_SOURCE_STATION`，通过 `source_kind` 区分机井和泵站。
- 物理泵不再作为独立顶层节点，而是挂在 `pump_units[]` 下。
- 导入后推荐流程是：`点位 -> 控制器 -> 终端单元 -> 资产归口`。
- 点位经纬度需要在工作台中通过“基准点投射”或手工回填补齐。

## 4. 图层标准
| 图层名 | 中文说明 |
| --- | --- |
{rows}

## 5. 强制规则
1. 一张 DXF 只对应一个地块，不要把多个地块画在同一张导入图里。
2. 一个图层只放一种对象，不允许混放。
3. `HJ_PIPE` 只允许放管道中心线，只允许 `LINE` 或 `LWPOLYLINE`。
4. `HJ_SOURCE_STATION / HJ_VALVE / HJ_OUTLET / HJ_SENSOR` 建议使用标准块 `INSERT`，不要炸块。
5. DXF 中不要放图框、标题、图例、尺寸线、装饰符号。
6. DXF 不直接表达控制器、终端台账和资产归档，它只负责导入点位与网络关系。

## 6. 当前系统映射口径
- `HJ_SOURCE_STATION -> source_station`
- `HJ_VALVE -> valve`
- `HJ_PIPE -> pipe_main / pipe_branch`
- `HJ_OUTLET -> outlet`
- `HJ_SENSOR -> sensor`

补充说明：

- `source_kind=groundwater` 的点位显示为“机井”
- `source_kind=surface_water / river / canal` 的点位显示为“泵站”
- `pump_units` 作为终端单元配置保存在 sidecar 中

## 7. 推荐提交流程
1. 设计单位按本模板出图，每个地块单独出一张 DXF。
2. 在工作台下载 `DXF 模板 + 出图规范 + import.json`。
3. 上传 DXF 后完成图层映射。
4. 设置基准点经纬度，自动把 CAD 平面坐标投射成点位经纬度。
5. 按需补录控制器能力、控制通道和终端单元绑定。
6. 发布前确认点位经纬度、可达水源站和站下泵能力都已补齐。
"""
    (output_dir / SPEC_NAME).write_text(textwrap.dedent(content).strip() + "\n", encoding="utf-8")


def write_manifest(output_dir: Path) -> None:
    graph_draft = build_graph_draft()
    manifest = {
        "type": "dxf_import_manifest",
        "template_name": "houji_import_template_unified",
        "layer_mapping": LAYER_MAPPING,
        "layers": [name for name, _color, _label in LAYER_SPECS],
        "counts": {
            "source_stations": sum(1 for item in POINTS if item["kind"] == "source_station"),
            "pump_units": sum(1 for node in graph_draft["nodes"] for unit in node["pump_units"] if unit.get("enabled", True)),
            "valves": sum(1 for item in POINTS if item["kind"] == "valve"),
            "outlets": sum(1 for item in POINTS if item["kind"] == "outlet"),
            "sensors": sum(1 for item in POINTS if item["kind"] == "sensor"),
            "pipes": len(PIPES),
        },
        "point_symbol_mode": "insert_block",
        "required_insert_layers": ["HJ_SOURCE_STATION", "HJ_VALVE", "HJ_OUTLET", "HJ_SENSOR"],
        "parameter_profiles": {
            "source_model": "source_station_nodes_with_pump_units",
            "source_kind_options": ["groundwater", "surface_water", "river", "canal"],
            "coordinate_rule": "base_point_projection_required_for_latlng",
        },
        "graph_draft": graph_draft,
    }
    (output_dir / MANIFEST_NAME).write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")


def write_metadata(output_dir: Path) -> None:
    graph_draft = build_graph_draft()
    metadata = {
        "template_name": "houji_import_template_unified",
        "format": "DXF",
        "version": "R2000",
        "units": "meter",
        "counts": {
            "source_stations": sum(1 for item in POINTS if item["kind"] == "source_station"),
            "pump_units": sum(1 for node in graph_draft["nodes"] for unit in node["pump_units"] if unit.get("enabled", True)),
            "valves": sum(1 for item in POINTS if item["kind"] == "valve"),
            "outlets": sum(1 for item in POINTS if item["kind"] == "outlet"),
            "sensors": sum(1 for item in POINTS if item["kind"] == "sensor"),
            "pipes": len(PIPES),
        },
        "layer_mapping": LAYER_MAPPING,
        "topology_features": {
            "source_station_unified": True,
            "uses_pump_units": True,
            "has_mixed_source_kind": True,
        },
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
    doc = create_doc()
    doc.saveas(OUTPUT_DIR / DXF_NAME)
    write_spec(OUTPUT_DIR)
    write_manifest(OUTPUT_DIR)
    write_metadata(OUTPUT_DIR)
    copy_to_public(OUTPUT_DIR)
    print(f"[cad-template] generated import DXF in {OUTPUT_DIR}")
    print(f"[cad-template] copied public downloads to {PUBLIC_DIR}")


if __name__ == "__main__":
    main()
