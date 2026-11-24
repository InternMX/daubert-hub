# Documentation-only CI

A pull request uses docs mode when the diff from the first parent of its GitHub
merge commit contains only regular, non-executable Markdown files under
`docs/` or the exact root path `README.md`. Paths are case sensitive.
Additions, modifications and deletions qualify. Both paths of a rename must
qualify.

Any file outside that allowlist forces full CI. Every push to `main` also
uses full CI. Both modes run documentation checks and report the required
`validate` and `release-plan` checks. Docs mode skips dependency installation,
build, lint, typecheck, and the heavier application and release test suites.
