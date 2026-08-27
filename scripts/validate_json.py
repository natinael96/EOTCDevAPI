"""Validate every repository-owned JSON document without third-party packages."""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
JSON_ROOTS = (ROOT / "data", ROOT / "spec")


def main() -> None:
    paths = sorted(path for root in JSON_ROOTS for path in root.rglob("*.json"))
    failures: list[str] = []

    for path in paths:
        try:
            with path.open(encoding="utf-8") as source:
                json.load(source)
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            failures.append(f"{path.relative_to(ROOT)}: {exc}")

    if failures:
        raise SystemExit("Invalid JSON:\n" + "\n".join(failures))

    print(f"validated {len(paths)} JSON files")


if __name__ == "__main__":
    main()
