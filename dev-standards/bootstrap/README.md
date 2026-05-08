# Standards Bootstrap

This directory provides two distribution mechanisms for the standards package:

- `template-repo/`: a reusable starter payload for creating a new standards-enabled repository
- `../tooling/standards_init.py`: a CLI installer that applies the same payload to an existing repository

The bootstrap payload only installs repo-local controls that can be honestly
supported without live external systems by default:

- `dev-standards/`
- root standards control files
- `Makefile`
- `CHANGELOG.md`
- `docs/architecture.md`
- `docs/runbook.md`
- `docs/adr/ADR-001.md`
- `.github/workflows/verify.yml`

It does not enable runtime-proof, integration-proof, or external audit
publication workflows in target repositories by default, because those require
real external systems to be meaningful.
