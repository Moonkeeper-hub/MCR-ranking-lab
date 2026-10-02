from __future__ import annotations

from pathlib import Path
import streamlit.components.v1 as components

_COMPONENT_DIR = Path(__file__).parent / "components" / "formula_picker"

_formula_picker = components.declare_component(
    "formula_picker",
    path=str(_COMPONENT_DIR),
)


def formula_picker(
    formula_id: str,
    selected: str | None = None,
    eu_weight: float | None = None,
    t5_weight: float | None = None,
    key: str | None = None,
):
    return _formula_picker(
        formula_id=formula_id,
        selected=selected,
        eu_weight=eu_weight,
        t5_weight=t5_weight,
        default=selected,
        key=key,
    )
