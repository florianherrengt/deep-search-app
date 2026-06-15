---
name: release
description: Use when the user asks to create a release, publish a release, cut a release, or make a new version. Triggers the Publish Release GitHub Actions workflow to build and upload Tauri binaries for all platforms.
---

# Create a Release

Cut a new release by triggering the "Publish Release" GitHub Actions workflow, which builds Tauri desktop binaries for macOS (aarch64), Windows (x86_64), and Linux (x86_64) and uploads them as release assets.

## When to use

- User asks to create, publish, or cut a release
- User asks to make a new version or tag a release
- User asks to trigger the release pipeline

## Steps

### 1. Determine the version tag

Ask the user for the version if not provided. Follow the existing tag convention:

- Alpha/beta: `alpha-X.Y.Z` or `beta-X.Y.Z` (e.g. `alpha-0.0.3`)
- Stable: `vX.Y.Z` (e.g. `v1.0.0`)

Check existing tags to determine the next version:

```bash
git tag -l | sort -V
```

### 2. Verify working tree is clean

Ensure there are no uncommitted changes on the branch that will be released (typically `main`):

```bash
git status --porcelain
```

If dirty, ask the user whether to commit or stash before proceeding.

### 3. Fetch latest

```bash
git fetch origin main
```

### 4. Trigger the release workflow

Use `gh workflow run` to trigger the "Publish Release" workflow:

```bash
gh workflow run "Publish Release" \
  --ref main \
  -f version="<VERSION_TAG>" \
  -f notes="<RELEASE_NOTES>"
```

- `version` is required — the tag to create (e.g. `alpha-0.0.3`)
- `notes` is optional — leave empty to auto-generate notes from commits since the last release

Example with auto-generated notes:

```bash
gh workflow run "Publish Release" --ref main -f version="alpha-0.0.3"
```

Example with explicit notes:

```bash
gh workflow run "Publish Release" --ref main -f version="alpha-0.0.3" -f notes="Fix streaming persistence, improve sidebar UX"
```

### 5. Monitor the run

```bash
gh run list --workflow="Publish Release" --limit 1
```

Then watch the run:

```bash
gh run watch
```

### 6. Verify the release

Once complete, confirm the release exists with assets:

```bash
gh release view <VERSION_TAG>
```

Provide the release URL to the user:

```
https://github.com/<OWNER>/<REPO>/releases/tag/<VERSION_TAG>
```

## Do NOT

- Do not use `gh release create` directly — always trigger the "Publish Release" workflow so that Tauri binaries are built and uploaded
- Do not skip the workflow — the workflow handles version bumping (`npm run release:set-version`), code signing, updater artifacts, and cross-platform builds
- Do not create the tag manually — the workflow creates the tag and release
- Do not proceed if the working tree is dirty without asking the user

## Notes

- The workflow builds for 3 targets: `aarch64-apple-darwin`, `x86_64-pc-windows-msvc`, `x86_64-unknown-linux-gnu`
- The workflow requires secrets: `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, `TAURI_UPDATER_PUBKEY`
- The workflow is defined in `.github/workflows/release.yml`
- Version bumping uses `npm run release:set-version` which runs `scripts/set-release-version.mjs`
