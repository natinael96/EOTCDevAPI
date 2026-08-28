"""
Integrity invariants for the generated Sinq catalog, mirroring
ts/test/sinq-catalog.test.ts so both implementations reject a regeneration
that breaks structure, referential integrity, or the license boundary.
"""

from __future__ import annotations

from eotc.sinq import (
    sinq_catalog, sinq_daily_on, sinq_feasts, sinq_mahlets,
    sinq_monthly, sinq_seasonal, sinq_sub_feasts,
)

SLOTS = {"psalm", "gospel", "paulineEpistle", "catholicEpistle", "acts"}
SERVICES = {"matins", "liturgy", "vespers"}


def _all_services():
    catalog = sinq_catalog()
    entries = list(catalog["daily"].values()) + catalog["seasonal"] + catalog["monthly"]
    for entry in entries:
        yield from entry["services"].items()


def test_collection_counts() -> None:
    catalog = sinq_catalog()
    assert len(catalog["daily"]) == 366
    assert len(catalog["seasonal"]) == 43
    assert len(catalog["monthly"]) == 9
    assert len(catalog["feasts"]) == 21
    assert len(catalog["subFeasts"]) == 40
    assert len(catalog["mahlets"]) == 37


def test_daily_covers_every_ethiopian_month_day() -> None:
    for month in range(1, 14):
        days = 6 if month == 13 else 30
        for day in range(1, days + 1):
            entry = sinq_daily_on(month, day)
            assert entry is not None, f"{month}-{day}"
            assert entry["ethiopianMonth"] == month
            assert entry["ethiopianDay"] == day
        assert sinq_daily_on(month, days + 1) is None


def test_unique_ids() -> None:
    catalog = sinq_catalog()
    for collection in (
        list(catalog["daily"].values()), catalog["seasonal"], catalog["monthly"],
        catalog["feasts"], catalog["subFeasts"], catalog["mahlets"],
    ):
        ids = [entry["id"] for entry in collection]
        assert len(set(ids)) == len(ids)


def test_feast_graph_referential_integrity() -> None:
    feast_ids = {feast["id"] for feast in sinq_feasts()}
    for sub in sinq_sub_feasts():
        assert sub["feast"] in feast_ids, sub["id"]
    sub_feast_ids = {sub["id"] for sub in sinq_sub_feasts()}
    for mahlet in sinq_mahlets():
        assert mahlet["subFeast"] in sub_feast_ids, mahlet["id"]


def test_fixed_feasts_link_to_real_dates() -> None:
    for feast in sinq_feasts():
        if feast["movable"]:
            assert feast["dateKey"] is None
        else:
            assert feast["dateKey"] == f"{feast['monthNum']}-{feast['day']}"
            assert sinq_daily_on(feast["monthNum"], feast["day"]) is not None


def test_known_services_and_slots() -> None:
    for name, service in _all_services():
        assert name in SERVICES
        assert set(service["readings"]) <= SLOTS
        for slot, readings in service["readings"].items():
            for reading in readings:
                assert reading["slot"] == slot


def test_license_boundary_excludes_text_bodies() -> None:
    for _, service in _all_services():
        for readings in service["readings"].values():
            for reading in readings:
                assert "text" not in reading
                assert all(isinstance(flag, bool) for flag in reading["textAvailable"].values())
    for mahlet in sinq_mahlets():
        for chant in mahlet["chants"]:
            assert set(chant) == {"role"}


def test_monthly_rules_are_sunday_rules_with_spans() -> None:
    for entry in sinq_monthly():
        assert entry["match"]["appliesTo"] == "sunday"
        assert entry["match"]["nthSunday"] is not None or entry["match"]["fromDay"] is not None


def test_seasonal_ids_are_stable() -> None:
    for entry in sinq_seasonal():
        part = f":{entry['part']}" if entry["part"] is not None else ""
        assert entry["id"] == f"sinq:seasonal:{entry['season']}:{entry['week'] or 0}{part}"
        assert entry["sourceKey"]
