# EOTCDev API -- both implementations, one command each.

.PHONY: help install test test-ts test-py spec gitsawe validate-json check-generated ci dev-ts dev-py deploy typecheck

help:
	@grep -E '^[a-z-]+:.*?##' $(MAKEFILE_LIST) | sed 's/:.*##/\t/' | column -t -s "$$(printf '\t')"

install:            ## Install both toolchains
	cd ts && npm install
	cd py && python3 -m venv .venv && ./.venv/bin/pip install -e '.[dev]'

spec:               ## Regenerate the shared conformance + parity fixtures
	node --experimental-strip-types ts/scripts/gen-conformance.ts
	node --experimental-strip-types ts/scripts/dump-responses.ts

test-ts:            ## Run the TypeScript suite
	cd ts && npx vitest run

test-py:            ## Run the Python suite
	cd py && ./.venv/bin/python -m pytest -q

test: spec test-ts test-py   ## Regenerate fixtures, then test both implementations

typecheck:          ## Typecheck the TypeScript
	cd ts && npx tsc --noEmit

validate-json:      ## Parse every JSON data and specification file
	python3 scripts/validate_json.py

gitsawe:            ## Compile and validate the Gitsawe catalog and links
	node scripts/compile_gitsawe.mjs

check-generated: spec gitsawe   ## Fail when generated fixtures or Gitsawe artifacts are stale
	git diff --exit-code -- spec data/gitsawe/quality-report.json py/eotc/gitsawe_catalog.js

ci: validate-json gitsawe check-generated test-ts test-py typecheck   ## Run the complete CI verification suite

dev-ts:             ## Serve the Hono app on Cloudflare Workers locally
	cd ts && npx wrangler dev

dev-py:             ## Serve the FastAPI app locally
	cd py && ./.venv/bin/uvicorn eotc.api:app --reload --port 8000

deploy:             ## Deploy the Worker to Cloudflare
	cd ts && npx wrangler deploy
