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
    ("HJ_WELL", 1, "机井"),
    ("HJ_PUMP", 3, "泵站"),
    ("HJ_VALVE", 30, "阀门/电磁阀"),
    ("HJ_PIPE", 5, "管道"),
    ("HJ_OUTLET", 6, "出水口"),
    ("HJ_SENSOR", 140, "传感器"),
]

POINTS = [
    {"code": "W01", "layer": "HJ_WELL", "kind": "well", "point": (40, 220)},
    {"code": "W02", "layer": "HJ_WELL", "kind": "well", "point": (170, 220)},
    {"code": "W03", "layer": "HJ_WELL", "kind": "well", "point": (300, 220)},
    {"code": "P01", "layer": "HJ_PUMP", "kind": "pump", "point": (70, 190)},
    {"code": "P02", "layer": "HJ_PUMP", "kind": "pump", "point": (180, 190)},
    {"code": "P03", "layer": "HJ_PUMP", "kind": "pump", "point": (290, 190)},
    {"code": "SV01", "layer": "HJ_VALVE", "kind": "valve", "point": (95, 175)},
    {"code": "SV02", "layer": "HJ_VALVE", "kind": "valve", "point": (180, 175)},
    {"code": "SV03", "layer": "HJ_VALVE", "kind": "valve", "point": (100, 130)},
    {"code": "SV04", "layer": "HJ_VALVE", "kind": "valve", "point": (265, 120)},
    {"code": "O01", "layer": "HJ_OUTLET", "kind": "outlet", "point": (80, 95)},
    {"code": "O02", "layer": "HJ_OUTLET", "kind": "outlet", "point": (300, 95)},
    {"code": "S01", "layer": "HJ_SENSOR", "kind": "sensor", "point": (145, 160)},
    {"code": "S02", "layer": "HJ_SENSOR", "kind": "sensor", "point": (215, 160)},
]

PIPES = [
    {"code": "PM01", "points": [(40, 220), (70, 190)]},
    {"code": "PM02", "points": [(170, 220), (180, 190)]},
    {"code": "PM03", "points": [(300, 220), (290, 190)]},
    {"code": "PM04", "points": [(70, 190), (95, 175), (120, 160)]},
    {"code": "PM05", "points": [(180, 190), (180, 175), (180, 160)]},
    {"code": "PM06", "points": [(290, 190), (265, 175), (240, 160)]},
    {"code": "PM07", "points": [(120, 160), (180, 160)]},
    {"code": "PM08", "points": [(180, 160), (240, 160)]},
    {"code": "PB01", "points": [(120, 160), (100, 130), (80, 95)]},
    {"code": "PB02", "points": [(240, 160), (265, 120), (300, 95)]},
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

    for point in POINTS:
        x, y = point["point"]
        layer = point["layer"]
        kind = point["kind"]
        msp.add_blockref(BLOCK_NAMES[kind], (x, y), dxfattribs={"layer": layer})

    for pipe in PIPES:
        msp.add_lwpolyline(pipe["points"], dxfattribs={"layer": "HJ_PIPE"})


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

## 2. 当前模板包含内容
- 3 个机井
- 3 个泵站
- 4 个阀门/电磁阀
- 2 个出水口
- 2 个传感器
- 10 段管道

## 3. 图层标准
| 图层名 | 中文说明 |
| --- | --- |
{rows}

## 4. 强制规则
1. 只允许提交 DXF 文件，推荐版本 R2000。
2. 一张 DXF 只对应一个地块，不允许把多个地块画在同一张导入图里。
3. 系统不会自动拆分地块，也不会根据图形范围自动识别多个地块；导入时以用户选择的目标地块为准。
4. 一个图层只放一种资产类型，不允许混放。
5. `HJ_PIPE` 只允许放管道中心线，只允许 `LINE` 或 `LWPOLYLINE`。
6. `HJ_PIPE` 图层中不允许绘制阀门、传感器、箭头、三角形、菱形、装饰框等符号。
7. `HJ_VALVE` 和 `HJ_SENSOR` 必须使用标准块插入 `INSERT`，不得炸块，不得用线段或多段线手工拼符号。
8. 不要在导入模板图中放图框、标题、图例、说明文字、尺寸线。
9. 不要在导入模板图中放变压器、网关、气象站、控制柜等当前未直接导入的参考资产。
10. 如果需要文字说明，请单独放在 PDF 或 Word 文档中，不要写入导入 DXF。

## 5. 当前系统映射口径
- `HJ_WELL -> 机井`
- `HJ_PUMP -> 泵站`
- `HJ_VALVE -> 阀门/电磁阀`
- `HJ_PIPE -> 管道`
- `HJ_OUTLET -> 出水口`
- `HJ_SENSOR -> 传感器`

## 6. 系统兜底规则
1. 如果 `HJ_PIPE` 中出现很小的封闭多段线、三角形、菱形等疑似装饰符号，系统会优先按“非管道装饰图元”忽略，不参与管网生成。
2. 即使未手工映射，系统也会优先识别 `HJ_WELL / HJ_PUMP / HJ_VALVE / HJ_OUTLET / HJ_SENSOR` 这套标准图层名。
3. 但系统兜底不替代出图规范；若阀门和传感器仍画在 `HJ_PIPE` 上，最终导入结果仍可能不稳定。

## 7. 推荐提交流程
1. 设计单位按本模板出图，且每个地块单独出一张 DXF。
2. 文件命名建议包含项目名或项目编码，以及地块名或地块编码。
3. 在 `network-workbench` 中进入对应项目/地块。
4. 上传对应地块的 DXF 文件。
5. 在 `network-workbench` 中完成图层映射确认。
6. 保存前查看资产树清单。
7. 完成资产绑定后保存。
"""
    (output_dir / SPEC_NAME).write_text(textwrap.dedent(content).strip() + "\n", encoding="utf-8")


def write_manifest(output_dir: Path) -> None:
    manifest = {
        "type": "dxf_import_manifest",
        "template_name": "houji_import_template",
        "layer_mapping": LAYER_MAPPING,
        "layers": [name for name, _color, _label in LAYER_SPECS],
        "point_asset_codes": [item["code"] for item in POINTS],
        "pipe_codes": [item["code"] for item in PIPES],
        "point_symbol_mode": "insert_block",
        "required_insert_layers": ["HJ_VALVE", "HJ_SENSOR"],
    }
    (output_dir / MANIFEST_NAME).write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")


def write_metadata(output_dir: Path) -> None:
    metadata = {
        "template_name": "houji_import_template",
        "format": "DXF",
        "version": "R2000",
        "units": "meter",
        "counts": {
            "wells": 3,
            "pumps": 3,
            "valves": 4,
            "outlets": 2,
            "sensors": 2,
            "pipes": 10,
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
    print(f"[cad-template] generated import-only DXF template in {OUTPUT_DIR}")
    print(f"[cad-template] copied public downloads to {PUBLIC_DIR}")


if __name__ == "__main__":
    main()
