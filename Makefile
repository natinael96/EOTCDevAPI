# EOTCDev API -- both implementations, one command each.

# Python interpreter: the local venv when present, system python3 otherwise
# (CI installs dependencies into the runner's Python and has no venv).
PY := $(if $(wildcard py/.venv/bin/python),./.venv/bin/python,python3)

.PHONY: help setup-check install install-ts install-py test test-ts test-py spec gitsawe validate-json check-generated ci dev-ts dev-py deploy typecheck examples sync-docs

help:
	@grep -E '^[a-z-]+:.*?##' $(MAKEFILE_LIST) | sed 's/:.*##/\t/' | column -t -s "$$(printf '\t')"

setup-check:        ## Verify supported Node and Python versions are available
	@node -e "const major=Number(process.versions.node.split('.')[0]); if(major!==22){console.error('Node.js 22 required; found '+process.version); process.exit(1)}"
	@python3 -c "import sys; assert sys.version_info[:2] == (3, 12), f'Python 3.12 required; found {sys.version.split()[0]}'"

install-ts: setup-check   ## Install the locked TypeScript dependencies
	cd ts && npm ci

install-py: setup-check   ## Create the Python environment and install development dependencies
	python3 -m venv py/.venv
	py/.venv/bin/python -m pip install --upgrade pip
	py/.venv/bin/python -m pip install -e 'py[dev]'

install: install-ts install-py   ## Install both toolchains reproducibly

spec:               ## Regenerate the shared conformance + parity fixtures
	node --experimental-strip-types ts/scripts/gen-conformance.ts
	node --experimental-strip-types ts/scripts/dump-responses.ts

test-ts:            ## Run the TypeScript suite
	cd ts && npx vitest run

test-py:            ## Run the Python suite
	cd py && $(PY) -m pytest -q

test: spec test-ts test-py   ## Regenerate fixtures, then test both implementations

typecheck:          ## Typecheck the TypeScript
	cd ts && npx tsc --noEmit

validate-json:      ## Parse every JSON data and specification file
	python3 scripts/validate_json.py

gitsawe:            ## Compile and validate the Gitsawe, Sinq, and Bible catalogs
	node scripts/compile_gitsawe.mjs
	node scripts/compile_sinq_gitsawe.mjs
	node scripts/compile_bible_meta.mjs

examples:           ## Run the documentation examples against a local API
	./scripts/run_examples.sh $(PY)

sync-docs:          ## Inline examples/ into the integration guides
	node scripts/sync_examples.mjs

check-generated: spec gitsawe sync-docs   ## Fail when generated fixtures, Gitsawe artifacts, or docs are stale
	git diff --exit-code -- spec data/gitsawe/quality-report.json py/eotc/gitsawe_catalog.js \
		data/sinq-gitsawe py/eotc/sinq_catalog.js py/eotc/bible_catalog.js \
		docs/INTEGRATION.md web/docs/integration.html

ci: validate-json gitsawe check-generated test-ts test-py typecheck examples   ## Run the complete CI verification suite

dev-ts:             ## Serve the Hono app on Cloudflare Workers locally
	cd ts && npx wrangler dev

dev-py:             ## Serve the FastAPI app locally
	cd py && $(PY) -m uvicorn eotc.api:app --reload --port 8000

deploy:             ## Deploy the Worker to Cloudflare
	cd ts && npx wrangler deploy
