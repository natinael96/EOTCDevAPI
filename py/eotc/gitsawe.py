"""Read the generated shared Gitsawe/Sinksar catalog."""

from __future__ import annotations

import json
from importlib import resources
from typing import Any

from .citations import fold_ethiopic


_MODULE = resources.files("eotc").joinpath("gitsawe_catalog.js").read_text(encoding="utf-8")
_CATALOG: dict[str, Any] = json.loads(_MODULE.removeprefix("export default ").removesuffix(";\n"))


def gitsawe_coverage() -> dict[str, str]:
    return dict(_CATALOG["coverage"])


def fixed_gitsawe_on(month: int, day: int) -> dict[str, Any] | None:
    return _CATALOG["days"].get(f"{month}-{day}")


def search_sinksar(query: str) -> list[dict[str, Any]]:
    """Find the days on which a commemoration is kept, by any part of its name;
    twin of searchSinksar in ts/src/core/gitsawe.ts.

    Matching is homophone-folded, so a search spelled with any of the Ge'ez
    letters that share a sound still finds the entry. Annual commemorations
    appear on one day; monthly ones recur, so a name like ሚካኤል legitimately
    returns the same day across many months.
    """
    folded = fold_ethiopic(query)
    if not folded:
        return []
    matches: list[dict[str, Any]] = []
    for day in _CATALOG["days"].values():
        sinksar = day.get("sinksar")
        if not sinksar:
            continue
        for kind, key in (("annual", "annualFeasts"), ("monthly", "monthlyFeasts")):
            for item in (sinksar.get(key) or {}).get("items", []):
                folded_title = fold_ethiopic(item["title"])
                if not folded_title:
                    continue
                if folded_title == folded:
                    confidence = "exact"
                elif folded in folded_title:
                    confidence = "partial"
                else:
                    continue
                matches.append({
                    "title": item["title"],
                    "kind": kind,
                    "ethiopianMonth": day["ethiopianMonth"],
                    "ethiopianDay": day["ethiopianDay"],
                    "confidence": confidence,
                })
    # Exact names first, then in calendar order so a year reads top to bottom.
    matches.sort(key=lambda m: (0 if m["confidence"] == "exact" else 1,
                                m["ethiopianMonth"], m["ethiopianDay"]))
    return matches
