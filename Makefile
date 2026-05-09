PYTHON ?= python3
REPO_ROOT := .
PY_FILES := $(shell find tests dev-standards -type f -name '*.py' -print 2>/dev/null)
PYCACHE_PREFIX := $(REPO_ROOT)/.artifacts/pycache
BASE_REF ?=
CHANGE_RISK ?= high
CHANGE_KIND ?= policy
CHANGE_REVERSIBILITY ?= reversible
CHANGE_REFERENCE ?= ADR-001
CHANGE_REVIEW_MODE ?= human-plus-evidence
CHANGE_PROVENANCE ?= human
CHANGE_HUMAN_INSTRUCTION ?= true
CHANGE_COMMANDS ?= make verify
CHANGE_EVIDENCE ?= local-verify
RELEASE_ENV ?= dev

.PHONY: lint typecheck test build verify

lint:
	$(PYTHON) dev-standards/tooling/validate_policy_files.py --repo-root $(REPO_ROOT)
	$(PYTHON) dev-standards/tooling/validate_waivers.py --repo-root $(REPO_ROOT)
	CHANGE_KIND=$(CHANGE_KIND) CHANGE_REFERENCE=$(CHANGE_REFERENCE) $(PYTHON) dev-standards/tooling/validate_approval_proof.py --repo-root $(REPO_ROOT) $(if $(BASE_REF),--base-ref $(BASE_REF))
	CHANGE_KIND=$(CHANGE_KIND) CHANGE_REFERENCE=$(CHANGE_REFERENCE) $(PYTHON) dev-standards/tooling/validate_live_approval.py --repo-root $(REPO_ROOT) $(if $(BASE_REF),--base-ref $(BASE_REF))
	CHANGE_KIND=$(CHANGE_KIND) CHANGE_REFERENCE=$(CHANGE_REFERENCE) $(PYTHON) dev-standards/tooling/validate_traceability.py --repo-root $(REPO_ROOT)
	CHANGE_RISK=$(CHANGE_RISK) CHANGE_KIND=$(CHANGE_KIND) CHANGE_REVERSIBILITY=$(CHANGE_REVERSIBILITY) CHANGE_REFERENCE=$(CHANGE_REFERENCE) CHANGE_REVIEW_MODE=$(CHANGE_REVIEW_MODE) CHANGE_PROVENANCE=$(CHANGE_PROVENANCE) CHANGE_HUMAN_INSTRUCTION=$(CHANGE_HUMAN_INSTRUCTION) CHANGE_COMMANDS="$(CHANGE_COMMANDS)" CHANGE_EVIDENCE="$(CHANGE_EVIDENCE)" $(PYTHON) dev-standards/tooling/validate_change_metadata.py --repo-root $(REPO_ROOT) $(if $(BASE_REF),--base-ref $(BASE_REF))
	CHANGE_KIND=$(CHANGE_KIND) CHANGE_PROVENANCE=$(CHANGE_PROVENANCE) $(PYTHON) dev-standards/tooling/validate_agent_intent.py --repo-root $(REPO_ROOT) $(if $(BASE_REF),--base-ref $(BASE_REF))
	$(PYTHON) dev-standards/tooling/validate_shell_boundaries.py --repo-root $(REPO_ROOT) $(if $(BASE_REF),--base-ref $(BASE_REF))
	$(PYTHON) dev-standards/tooling/validate_config_boundaries.py --repo-root $(REPO_ROOT) $(if $(BASE_REF),--base-ref $(BASE_REF))
	$(PYTHON) dev-standards/tooling/validate_architecture.py --repo-root $(REPO_ROOT) $(if $(BASE_REF),--base-ref $(BASE_REF))
	$(PYTHON) dev-standards/tooling/validate_visual_identity.py --repo-root $(REPO_ROOT) $(if $(BASE_REF),--base-ref $(BASE_REF))
	npm run design:tokens:check
	npm run design:tokens:enforce
	CHANGE_KIND=$(CHANGE_KIND) CHANGE_REFERENCE=$(CHANGE_REFERENCE) $(PYTHON) dev-standards/tooling/validate_docs_freshness.py --repo-root $(REPO_ROOT) $(if $(BASE_REF),--base-ref $(BASE_REF))
	CHANGE_KIND=$(CHANGE_KIND) CHANGE_REVERSIBILITY=$(CHANGE_REVERSIBILITY) $(PYTHON) dev-standards/tooling/validate_release_evidence.py --repo-root $(REPO_ROOT) --environment $(RELEASE_ENV)
	$(PYTHON) dev-standards/tooling/check_maintainability.py --repo-root $(REPO_ROOT)

typecheck:
	@if [ -n "$(PY_FILES)" ]; then PYTHONPYCACHEPREFIX=$(PYCACHE_PREFIX) $(PYTHON) -m py_compile $(PY_FILES); fi

test:
	$(PYTHON) dev-standards/tooling/run_python_tests.py

build:
	PYTHONPYCACHEPREFIX=$(PYCACHE_PREFIX) $(PYTHON) -m compileall tests dev-standards

verify: lint typecheck test build
	$(PYTHON) dev-standards/tooling/validate_artifact_provenance.py --repo-root $(REPO_ROOT)
	CHANGE_KIND=$(CHANGE_KIND) $(PYTHON) dev-standards/tooling/validate_test_policy.py --repo-root $(REPO_ROOT) $(if $(BASE_REF),--base-ref $(BASE_REF))
