"""Read the generated shared Gitsawe/Sinksar catalog."""

from __future__ import annotations

import json
from importlib import resources
from typing import Any


_MODULE = resources.files("eotc").joinpath("gitsawe_catalog.js").read_text(encoding="utf-8")
_CATALOG: dict[str, Any] = json.loads(_MODULE.removeprefix("export default ").removesuffix(";\n"))


def gitsawe_coverage() -> dict[str, str]:
    return dict(_CATALOG["coverage"])


def fixed_gitsawe_on(month: int, day: int) -> dict[str, Any] | None:
    return _CATALOG["days"].get(f"{month}-{day}")
