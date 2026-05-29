# Sidecar Binaries

`npm run prepare:sidecars` generates the platform-specific Node sidecar here using Tauri's expected `node-<target-triple>` filename.

Set `NODE_SIDECAR_PATH` to copy a specific Node executable, or `TAURI_TARGET_TRIPLE`/`CARGO_BUILD_TARGET` when preparing a non-host target.
