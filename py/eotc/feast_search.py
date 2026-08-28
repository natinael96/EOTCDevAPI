"""Feast lookup and homophone-aware search; twin of ts/src/core/feast-search.ts."""

from __future__ import annotations

from typing import Any

from .bahirehasab import MOVABLE_FEASTS
from .citations import fold_ethiopic
from .feasts import FIXED_FEASTS

FEAST_ALIASES: dict[str, list[str]] = {
    "enkutatash": ["አዲስ ዓመት", "ርዕሰ ዓውደ ዓመት", "ቅዱስ ዮሐንስ", "New Year", "Kudus Yohannes"],
    "meskel": ["ደመራ", "Demera", "Meskel"],
    "gena": ["ልደት", "Lidet", "Genna", "Christmas", "Nativity"],
    "timket": ["ጥምቀት", "Timkat", "Epiphany", "Theophany", "አስተርእዮ", "Astereyo"],
    "kana_zegelila": ["Cana", "ቃና"],
    "kidane_mihret": ["Kidane Mehret"],
    "giyorgis": ["ጊዮርጊስ", "St George", "Giorgis"],
    "lideta": ["ልደታ", "Lideta"],
    "petros_pawlos": ["ጴጥሮስ እና ጳውሎስ", "Peter and Paul"],
    "gabriel": ["ገብርኤል", "Gabriel"],
    "buhe": ["ደብረ ታቦር", "Debre Tabor", "Transfiguration"],
    "filseta": ["ፍልሰታ", "ጾመ ፍልሰታ", "Filseta", "Assumption"],
    "nineveh": ["ነነዌ", "ጾመ ነነዌ", "Nineveh", "Tsome Nenewe"],
    "abiy_tsome": ["ሁዳዴ", "ዐቢይ ጾም", "Hudade", "Great Lent", "Lent", "Abiy Tsom"],
    "debre_zeit": ["ደብረ ዘይት", "Debre Zeyt", "Mid-Lent"],
    "hosanna": ["ሆሣዕና", "Hosaena", "Palm Sunday"],
    "siklet": ["ስቅለት", "Good Friday", "Crucifixion", "Siqlet"],
    "fasika": ["ፋሲካ", "ትንሣኤ", "Tinsae", "Easter", "Pascha", "Resurrection"],
    "rikbe_kahnat": ["ርክበ ካህናት", "Rikbe Kahinat"],
    "erget": ["ዕርገት", "Ascension"],
    "peraklitos": ["ጰራቅሊጦስ", "ጴንጤቆስጤ", "Pentecost", "Paraclete"],
    "tsome_hawaryat": ["ጾመ ሐዋርያት", "Apostles' Fast", "Tsome Hawariyat"],
    "tsome_dihnet": ["ጾመ ድኅነት", "Fast of Salvation"],
}


def feast_definitions() -> list[dict[str, Any]]:
    movable = [{
        "key": feast["key"], "amharic": feast["amharic"], "translit": feast["translit"],
        "english": feast["english"], "movable": True, "major": None,
        "aliases": FEAST_ALIASES.get(feast["key"], []),
    } for feast in MOVABLE_FEASTS]
    fixed = [{
        "key": feast["key"], "amharic": feast["amharic"], "translit": feast["translit"],
        "english": feast["english"], "movable": False, "major": feast["major"],
        "aliases": FEAST_ALIASES.get(feast["key"], []),
    } for feast in FIXED_FEASTS]
    return movable + fixed


def feast_by_key(key_or_alias: str) -> dict[str, Any] | None:
    folded = fold_ethiopic(key_or_alias)
    if not folded:
        return None
    for definition in feast_definitions():
        if fold_ethiopic(definition["key"]) == folded:
            return definition
        names = [definition["amharic"], definition["translit"], definition["english"],
                 *definition["aliases"]]
        if any(fold_ethiopic(name) == folded for name in names):
            return definition
    return None


def search_feasts(query: str) -> list[dict[str, Any]]:
    folded = fold_ethiopic(query)
    if not folded:
        return []
    matches: list[dict[str, Any]] = []
    for definition in feast_definitions():
        candidates: list[tuple[str, str]] = [
            ("key", definition["key"]),
            ("amharic", definition["amharic"]),
            ("translit", definition["translit"]),
            ("english", definition["english"]),
            *[("alias", alias) for alias in definition["aliases"]],
        ]
        best: dict[str, Any] | None = None
        for label, value in candidates:
            folded_value = fold_ethiopic(value)
            if not folded_value:
                continue
            confidence = None
            if folded_value == folded:
                confidence = "exact"
            elif folded in folded_value or folded_value in folded:
                confidence = "partial"
            if not confidence:
                continue
            candidate = {"definition": definition, "matchedOn": label,
                         "matchedValue": value, "confidence": confidence}
            if best is None or (best["confidence"] == "partial" and confidence == "exact"):
                best = candidate
            if best["confidence"] == "exact":
                break
        if best:
            matches.append(best)
    matches.sort(key=lambda match: 0 if match["confidence"] == "exact" else 1)
    return matches
