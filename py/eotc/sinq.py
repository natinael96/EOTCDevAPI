"""Read the generated Sinq-derived Gitsawe catalog (seasonal, monthly, feast graph)."""

from __future__ import annotations

import json
from importlib import resources
from typing import Any


_MODULE = resources.files("eotc").joinpath("sinq_catalog.js").read_text(encoding="utf-8")
_CATALOG: dict[str, Any] = json.loads(_MODULE.removeprefix("export default ").removesuffix(";\n"))


def sinq_catalog() -> dict[str, Any]:
    return _CATALOG


def sinq_daily_on(month: int, day: int) -> dict[str, Any] | None:
    return _CATALOG["daily"].get(f"{month}-{day}")


def sinq_seasonal() -> list[dict[str, Any]]:
    return _CATALOG["seasonal"]


def sinq_monthly() -> list[dict[str, Any]]:
    return _CATALOG["monthly"]


def sinq_feasts() -> list[dict[str, Any]]:
    return _CATALOG["feasts"]


def sinq_sub_feasts() -> list[dict[str, Any]]:
    return _CATALOG["subFeasts"]


def sinq_mahlets() -> list[dict[str, Any]]:
    return _CATALOG["mahlets"]
