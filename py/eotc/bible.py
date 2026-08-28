"""Bible metadata catalog and book resolution; twin of ts/src/core/bible.ts."""

from __future__ import annotations

import json
from importlib import resources
from typing import Any

from .citations import fold_ethiopic

_MODULE = resources.files("eotc").joinpath("bible_catalog.js").read_text(encoding="utf-8")
_CATALOG: dict[str, Any] = json.loads(_MODULE.removeprefix("export default ").removesuffix(";\n"))


def bible_versification() -> str:
    return _CATALOG["versification"]


def bible_canon_note() -> str:
    return _CATALOG["canonNote"]


def bible_books() -> list[dict[str, Any]]:
    return _CATALOG["books"]


def bible_editions() -> list[dict[str, Any]]:
    return _CATALOG["editions"]


def bible_book(id_or_slug: str) -> dict[str, Any] | None:
    wanted = (id_or_slug or "").strip().lower()
    for book in _CATALOG["books"]:
        if book["id"].lower() == wanted or book["slug"] == wanted:
            return book
    return None


_INDEX: dict[str, tuple[dict[str, Any], str]] | None = None


def _index() -> dict[str, tuple[dict[str, Any], str]]:
    global _INDEX
    if _INDEX is not None:
        return _INDEX
    _INDEX = {}

    def add(key: str | None, book: dict[str, Any], label: str) -> None:
        if not key:
            return
        folded = fold_ethiopic(key)
        if folded and folded not in _INDEX:
            _INDEX[folded] = (book, label)

    import re

    for book in _CATALOG["books"]:
        names = book["names"]
        add(book["id"], book, "id")
        add(book["slug"], book, "slug")
        add(names["english"], book, "english")
        add(names["amharic"], book, "amharic")
        add(names["amharicAbbreviation"], book, "amharicAbbreviation")
        if names["amharic"]:
            stripped = re.sub(r"^(ኦሪት|መጽሐፈ|መልእክተ|የ)\s*", "", names["amharic"])
            stripped = re.sub(r"^የ", "", stripped)
            add(stripped, book, "amharicStripped")
    return _INDEX


def chapter_text(edition_id: str, book: dict[str, Any], chapter: int) -> list[dict[str, Any]] | None:
    """
    Verse text for one chapter, or None when no local edition is present.

    Text serving is an explicit self-host opt-in: it activates only when
    EOTC_BIBLE_TEXT_DIR points at a directory laid out like data/bible/
    (the operator's own licensed copy). The public deployment never sets it,
    which keeps the MIT runtime free of the CC BY-NC-ND text and keeps this
    endpoint's public behavior identical to the TypeScript Worker's.
    """
    import os

    root = os.environ.get("EOTC_BIBLE_TEXT_DIR")
    if not root:
        return None
    path = os.path.join(root, edition_id, "books", f"{book['order']:02d}-{book['slug']}.json")
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as source:
        data = json.load(source)
    if chapter < 1 or chapter > len(data["chapters"]):
        return None
    return [
        {"n": verse["n"], "geezNumeral": verse.get("alt"), "text": verse["t"]}
        for verse in data["chapters"][chapter - 1]["verses"]
    ]


def resolve_book(label: str) -> dict[str, Any] | None:
    """Resolve a book label to {book, matchedOn, confidence}; None if ambiguous."""
    folded = fold_ethiopic(label)
    if not folded:
        return None
    exact = _index().get(folded)
    if exact:
        return {"book": exact[0], "matchedOn": exact[1], "confidence": "exact"}
    hits: list[tuple[dict[str, Any], str]] = []
    for key, entry in _index().items():
        if folded in key or key in folded:
            if not any(hit[0]["id"] == entry[0]["id"] for hit in hits):
                hits.append(entry)
    if len(hits) == 1:
        return {"book": hits[0][0], "matchedOn": hits[0][1], "confidence": "partial"}
    return None
