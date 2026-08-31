"""
Every canonical Bible reference the API publishes must name a chapter and verse
the canon actually contains. Mirrors ts/test/reference-integrity.test.ts so a
regeneration that reintroduces an unresolvable reference fails both builds.

A citation can parse cleanly and still be unresolvable -- a misread Ge'ez
numeral, a mis-assigned book label, or a psalter numbering that was never
converted -- and the result is a reference that resolves to nothing for every
consumer. The compilers narrow such references and record the originals in the
quality reports, so this invariant holding is what proves the narrowing ran.
"""

from __future__ import annotations

from typing import Any

from eotc.bible import bible_books
from eotc.gitsawe import fixed_gitsawe_on
from eotc.sinq import sinq_catalog

_VERSE_COUNTS = {book["id"]: book["verseCounts"] for book in bible_books()}


def _out_of_range(ref: dict[str, Any]) -> str | None:
    """The reason a reference cannot resolve, or None when it is in range."""
    book = ref.get("book") or ref.get("bibleBook")
    counts = _VERSE_COUNTS.get(book)
    chapter = ref.get("chapter")
    if not counts or not chapter:
        return None
    if chapter > len(counts):
        return f"{book} has {len(counts)} chapters, reference names {chapter}"
    verses = counts[chapter - 1]
    start, end = ref.get("verseStart"), ref.get("verseEnd")
    if start and start > verses:
        return f"{book} {chapter} has {verses} verses, reference starts at {start}"
    if end and end > verses:
        return f"{book} {chapter} has {verses} verses, reference ends at {end}"
    return None


def _gitsawe_references() -> list[tuple[str, dict[str, Any]]]:
    found = []
    for month in range(1, 14):
        for day in range(1, 7 if month == 13 else 31):
            entry = fixed_gitsawe_on(month, day)
            if entry is None:
                continue
            for service, block in entry["gitsawe"]["services"].items():
                for group in ("psalms", "gospels", "epistlesAndActs"):
                    for reading in block.get(group, []):
                        ref = reading.get("canonicalReference")
                        if ref:
                            found.append((f"{month}-{day} {service} {group}", ref))
    return found


def _sinq_references() -> list[tuple[str, dict[str, Any]]]:
    catalog = sinq_catalog()
    entries: list[tuple[str, Any]] = [
        (f"daily {key}", entry) for key, entry in catalog["daily"].items()
    ]
    entries += [(f"seasonal {i}", e) for i, e in enumerate(catalog["seasonal"])]
    entries += [(f"monthly {i}", e) for i, e in enumerate(catalog["monthly"])]
    found = []
    for label, entry in entries:
        for service, block in entry["services"].items():
            for slot, readings in block["readings"].items():
                for reading in readings:
                    if reading["reference"].get("chapter"):
                        found.append((f"{label} {service} {slot}", reading["reference"]))
    return found


def test_references_exist_to_check() -> None:
    assert len(_gitsawe_references()) > 3000
    assert len(_sinq_references()) > 3000


def test_every_gitsawe_reference_is_in_range() -> None:
    broken = [f"{where}: {why}" for where, ref in _gitsawe_references()
              if (why := _out_of_range(ref))]
    assert broken == []


def test_every_sinq_reference_is_in_range() -> None:
    broken = [f"{where}: {why}" for where, ref in _sinq_references()
              if (why := _out_of_range(ref))]
    assert broken == []


def test_geez_psalter_maps_onto_hebrew_numbering() -> None:
    """The Ge'ez psalter runs a chapter behind the Hebrew numbering the editions
    use, so an unconverted psalm citation lands on the wrong psalm while staying
    in range. These anchors pin the conversion itself."""
    def psalm(month: int, day: int, service: str) -> dict[str, Any]:
        entry = fixed_gitsawe_on(month, day)
        return entry["gitsawe"]["services"][service]["psalms"][0]["canonicalReference"]

    # Meskerem 1, the New Year misbak: printed 64, "thou crownest the year".
    new_year = psalm(1, 1, "matins")
    assert (new_year["book"], new_year["chapter"], new_year["verseStart"]) == ("PSA", 65, 11)
    # Ge'ez 9 covers Hebrew 9 and 10; verse 25 falls in the second half.
    split = psalm(2, 19, "vespers")
    assert (split["book"], split["chapter"], split["verseStart"]) == ("PSA", 10, 4)
    # Ge'ez 113 splits into Hebrew 114 and 115.
    merged = psalm(2, 26, "liturgy")
    assert (merged["book"], merged["chapter"], merged["verseStart"]) == ("PSA", 115, 14)
