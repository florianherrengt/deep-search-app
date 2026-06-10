# Research: Tauri v2 Child WebView Focus/Activation on macOS

## Question

When creating a child webview via `window.add_child()` with a `WebviewBuilder` in Tauri v2 on macOS, the app window comes to the foreground / gets activated. How can we prevent this so content extraction happens without stealing focus?

## TL;DR Summary

**There is currently no built-in way to prevent focus stealing when creating a child webview in Tauri v2.** The root cause is in wry's macOS webview creation code, which unconditionally calls `NSApplication::activate()` after creating any webview (child or main). Multiple known issues (tauri#9065, tauri#12055, tauri#15017) confirm `focused(false)` does not work on macOS. However, there are several viable workarounds.

---

## 1. Does `WebviewBuilder` have `.focused(false)` or similar?

**Yes, but it doesn't work on macOS for child webviews.**

- **WebviewBuilder::focused()** was added in Tauri v2 via PR #11569 (patch ~Nov 2024). It sets `WebviewAttributes.focus` which flows through to wry.
- In wry, the `focus` attribute is only respected on:
  - **Windows**: `MoveFocus` is skipped when `focused == false` (see wry commit `ebc4a20`)
  - **Linux/webkit2gtk**: `grab_focus()` is skipped when `focused == false`
  - **macOS**: The `focused` field is explicitly documented as **unsupported** for macOS in wry's `WebViewAttributes`:
    ```
    /// Whether the webview should be focused when created.
    /// Platform-specific:
    /// - **macOS / Android / iOS:** Unsupported.
    pub focused: bool,
    ```
- **WebviewWindowBuilder::focused(false)** controls both the window-level `focused` and webview-level `focus`, and for new windows it replaces `makeKeyAndOrderFront:` with `orderFront:` (in tao window.rs ~line 547). However, this only applies to new standalone windows, NOT to child webviews added to existing windows.

**Bottom line**: `.focused(false)` on a `WebviewBuilder` used with `window.add_child()` has no effect on macOS because:
1. The macOS wry code ignores the `focused` webview attribute
2. The `NSApplication::activate()` call in wry (see below) activates the entire app regardless

---

## 2. Is there a way to create a "headless" or background webview?

**No official headless mode exists in Tauri v2/Wry.** However, there are practical workarounds:

### Option A: Create a hidden standalone window (not `add_child`)
Instead of using `window.add_child()`, create a separate `WebviewWindow` with `.visible(false)`:
```rust
let webview = tauri::WebviewWindowBuilder::new(
    &app_handle,
    "extraction",
    tauri::WebviewUrl::External("https://example.com".parse().unwrap()),
)
.visible(false)
.build()?;
```
**Problem**: Even with `visible(false)`, the window still briefly activates the app on macOS (due to the `NSApplication::activate()` call in wry). Users report a flash/flicker (issue #13452).

### Option B: Create the child webview but immediately hide it
```rust
let webview = window.add_child(
    webview_builder,
    tauri::LogicalPosition::new(0, 0),
    tauri::LogicalSize::new(1, 1),
)?;
// Immediately hide the webview
webview.set_visible(false)?;
```
**Problem**: The app still activates BEFORE the hide call.

### Option C: Offscreen positioning
Position the child webview offscreen (e.g., at extremely negative coordinates) so it's technically visible but not seen. This doesn't prevent activation but may be acceptable visually. Not recommended.

### Option D: Use `NSApplication.deactivate()` after creation (racy)
```rust
#[cfg(target_os = "macos")]
{
    use objc2_app_kit::NSApplication;
    use objc2_foundation::MainThreadMarker;
    let mtm = MainThreadMarker::new().unwrap();
    let app = NSApplication::sharedApplication(mtm);
    // Deactivate our app, returning focus to the previous app
    app.deactivate();
}
```
**Problem**: Race condition — there's a visible flash as the app activates then deactivates.

### Option E: Community approach — hidden WebviewWindow for content scraping
The Chinese blog post (bbs.songma.com/131646) documents a workflow using `.visible(false)` WebviewWindows for content scraping in a Tauri v2 "Saga Reader" project. They accept the brief activation and clean up.

---

## 3. macOS-level approaches

### 3a. `NSApplicationActivationPolicy::Accessory`
Tauri v2 exposes this via `AppHandle::set_activation_policy()` (added in PR #9842, Tauri patch May 2024):

```rust
tauri::Builder::default()
    .setup(|app| {
        #[cfg(target_os = "macos")]
        app.handle().set_activation_policy(tauri::ActivationPolicy::Accessory)?;
        Ok(())
    })
```

**Effects of Accessory policy**:
- App does NOT appear in the Dock
- App does NOT appear in Cmd+Tab app switcher
- App can still have windows
- App may be activated programmatically or by clicking its windows
- Windows go behind other apps when switching workspaces

**Caveat** from the dev.to overlay article (2026): When switching to Accessory policy, existing windows may become hidden behind other apps. The activation policy change may also cause windows to go backward (see tao issue #298).

### 3b. `set_activate_ignoring_other_apps(false)`
Tao exposes `EventLoopExtMacOS::set_activate_ignoring_other_apps(false)` to prevent the app from stealing focus on launch. However, Tauri **does not wire this through** the runtime trait (as of 2026). Issue tauri#15017 (March 2026) requests this:

```rust
// Currently NOT available in Tauri:
app.set_activate_ignoring_other_apps(false);
```

Tao does have this internally — the `activate_ignoring_other_apps` flag in `AuxDelegateState` controls whether `applicationDidFinishLaunching` calls `activateIgnoringOtherApps(YES)` or `activateIgnoringOtherApps(NO)`. Default is `true` (steals focus).

**Note**: Even if exposed, this only affects the initial launch activation, NOT the `NSApplication::activate()` called by wry every time a webview is created.

### 3c. Direct objc2 calls to control focus
You can directly call macOS APIs via `objc2` crate:

```rust
#[cfg(target_os = "macos")]
{
    use objc2_app_kit::{NSApp, NSApplication, NSApplicationActivationPolicy};
    use objc2_foundation::MainThreadMarker;

    let mtm = MainThreadMarker::new().unwrap();
    let ns_app = NSApp(mtm);

    // Hide the app entirely
    ns_app.hide(None);

    // Or deactivate (returns focus to previous app)
    // Note: deprecated but still works
    #[allow(deprecated)]
    ns_app.deactivate();
}
```

### 3d. Override `canBecomeKeyWindow` on NSWindow (NSPanel approach)
A commenter on tauri#9065 mentioned attempting this:
- Creating a custom `NSPanel` subclass
- Overriding `canBecomeKeyWindow` to return `NO`
- Using `tauri-nspanel` plugin

This is a complex approach requiring deep Objective-C interop. The `tauri-nspanel` plugin (mentioned in the dev.to overlay article) converts windows to `NSPanel` for floating-over-fullscreen behavior. It may be adaptable for preventing key window status.

### 3e. `set_focusable(false)` on the window
Tauri exposes `Window::set_focusable(false)`:
```rust
window.set_focusable(false)?;
```
**macOS caveat from docs**: "If the window is already focused, it is not possible to unfocus it after calling `set_focusable(false)`. In this case, you might consider calling `Window.set_focus` but it will move the window to the back."

Internally, `set_focusable` sets an ivar `focusable` on `NSWindow` (tao window.rs). This prevents the window from becoming key, but doesn't prevent app activation from wry.

---

## 4. Can we use Window/WindowBuilder methods to hide/minimize after creation?

### `Window::hide()` / `Window::set_visible(false)`
Available on any `WebviewWindow`. Can be called immediately after creation. However, the activation happens DURING creation (in the wry callback), before you can call hide.

### `Window::minimize()`
Same problem — can't call it before the activation.

### `Window::set_focusable(false)`
As noted above, mostly useful for preventing future focus stealing, not preventing the initial activation.

### `visible(false)` in WindowBuilder
Works for the main window in `tauri.conf.json` or when building via `WebviewWindowBuilder::new().visible(false).build()`. But the `NSApplication::activate()` in wry still activates the app process (even if the window is invisible).

---

## 5. Tauri plugins for focus management

### `tauri-plugin-window-state`
Saves/restores window position and size. Does NOT help with focus management.

### `tauri-plugin-single-instance`
Ensures single instance. Has no focus prevention features (actually includes `set_focus()` in its example to bring the window to front on second instance).

### `tauri-nspanel` (community)
Converts Tauri windows to `NSPanel` on macOS. Used by the dev.to overlay article author to float above fullscreen apps. Could potentially help with focus behavior if panel is configured to be non-activating. Not an official plugin.

### `tauri-plugin-frameless-window` (community, insd47)
Creates frameless windows, starts hidden. Has modal popup support with native sheet on macOS. Doesn't directly help with background webviews.

### No plugin exists specifically for focus management or "background webview" creation.

---

## 6. Alternative approaches

### 6a. Use `window.add_child()` but patch wry locally
The root cause is in wry's `src/wkwebview/mod.rs`:
```rust
// make sure the window is always on top when we create a new webview
let app = NSApplication::sharedApplication(mtm);
if os_major_version >= 14 {
    NSApplication::activate(&app);
} else {
    #[allow(deprecated)]
    NSApplication::activateIgnoringOtherApps(&app, true);
}
```

This was added in wry PR #242 (May 2021) for "making sure the window is always on top when we create a new webview" and was updated for macOS 14 compatibility in PR #1389 (Oct 2024). The comment on PR #1389 from a reviewer: **"I think we should only call activate() when we want to focus the window right? sometimes we do not want that."** The response was: "I honestly don't know why this call is here."

**A local patch to wry** could make this conditional (e.g., only activate if the webview's `focused` attribute is true). This would be a relatively simple code change.

### 6b. Use `WebviewWindowBuilder` instead of `window.add_child()`
Create a separate hidden window for content extraction. Accept the brief activation as a trade-off. This is the approach used by the Saga Reader blog post author. They used:
```rust
let webview_window = tauri::WindowBuilder::new(
    &app_handle,
    "headless_feed_fetcher",
    tauri::WindowUrl::External(url.parse()?)
)
.visible(false)
.build()?;
```

### 6c. Use `reqwest` or other HTTP clients for simple content extraction
If JavaScript execution is not needed for your extraction, skip the webview entirely and use a Rust HTTP client. This is simpler and has no focus issues.

### 6d. Run extraction from a background thread or at app startup
If the extraction happens before the user is actively using another app, the focus steal is less noticeable. Combine with `ActivationPolicy::Accessory` for minimal disruption.

### 6e. Use `NSApplication.deactivate()` after child webview creation
Accept the brief activation but immediately return focus:

```rust
use tauri::Manager;

window.add_child(webview_builder, pos, size)?;

#[cfg(target_os = "macos")]
{
    // Small delay to let activation complete
    std::thread::sleep(std::time::Duration::from_millis(50));
    use objc2_app_kit::NSApplication;
    use objc2_foundation::MainThreadMarker;
    let mtm = MainThreadMarker::new().unwrap();
    let app = NSApplication::sharedApplication(mtm);
    #[allow(deprecated)]
    app.deactivate();
}
```

### 6f. `tauri-runtime-wry` uses `build_as_child` for child webviews
In PR #11616 (Nov 2024), the `create_webview` function was fixed to use:
```rust
WebviewKind::WindowChild => webview_builder.build_as_child(&window),
```
instead of `webview_builder.build(&window)`. This ensures the webview is added as a subview of the existing NSView, not as the main content view. However, the same `NSApplication::activate()` call runs regardless.

---

## 7. What happens in Tauri v2 source code when `add_child` is called?

### Call chain on macOS:

1. **`Window::add_child()`** (in `tauri/src/window/mod.rs`)
   - Dispatches to runtime's `create_webview()`

2. **`Context::create_webview()`** (in `tauri-runtime-wry/src/lib.rs`)
   - Sends `Message::CreateWebview` to the event loop
   - Passes `WebviewKind::WindowChild`

3. **`create_webview()` function** (in `tauri-runtime-wry/src/lib.rs`)
   - Calls `webview_builder.build_as_child(&window)` (for child webviews)

4. **`WebViewBuilder::build_as_child()`** → wry's `InnerWebView::new()` (in `wry/src/wkwebview/mod.rs`)
   - Creates `WKWebView` with frame from parent NSView
   - Sets autoresizing mask
   - Adds webview as subview of the parent NSView (NOT replacing contentView)
   - Calls `makeFirstResponder` on the webview (if not child? — code implies it happens for non-child, but for child it may also set responder)
   - **Calls `NSApplication::activate()` unconditionally** — this is what steals focus

5. **`NSApplication::activate()`** (Apple API)
   - On macOS 14+: the modern API that activates the app
   - On older macOS: `NSApplication.activateIgnoringOtherApps(true)` — forcibly activates and steals focus from other apps

### Key detail: `makeKeyAndOrderFront:` is NOT called for child webviews
When creating a new standalone window in tao, the code does:
```rust
if visible {
    if focused {
        window.ns_window.makeKeyAndOrderFront(nil);  // activates + shows
    } else {
        window.ns_window.orderFront(nil);  // shows without activating
    }
}
```

For child webviews (which don't create a new NSWindow), there is no `makeKeyAndOrderFront` call. The focus steal comes from `NSApplication::activate()` in wry, not from window-level APIs.

### The `window_activation_hack` in tao
In `tao/src/platform_impl/macos/app_state.rs`, the function `window_activation_hack()` iterates over all NSWindows and calls `makeKeyAndOrderFront` on visible windows during `applicationDidFinishLaunching`. This only runs once at startup, not during child webview creation.

### Related issue: focusable property on WebviewWindow
PR #13564 (June 2025) adds a `focusable` property to `tauri.conf.json` windows. This maps to `set_focusable(false)` which sets an ivar on NSWindow. It was requested in issue #11130. This is about making a standalone window non-focusable, not about child webviews.

---

## 8. Known GitHub Issues

| Issue | Title | Status |
|-------|-------|--------|
| tauri#9065 | can't create non focused window on MacOS | Open |
| tauri#12055 | focused(false) doesn't work on macOS | Closed (dup of #9065) |
| tauri#15017 | Expose set_activate_ignoring_other_apps from tao | Open (Mar 2026) |
| tauri#7519 | Windows do not respect "focus" property | Closed (fixed only for Windows) |
| tauri#11566 | focus: false in config doesn't work on Windows | Fixed by #11569 |
| tauri#5120 | Window loses focus when creating another window | Closed |
| tauri#12834 | window.set_focus broken after Tauri 2.3 on macOS | Open (tao bug) |
| tauri#13452 | cannot create window invisible (flash) | Open |
| tauri#15005 | Dock icon visible when installed (menu-bar app) | Open |
| tauri#11130 | Request for non-focusable windows | Closed (fixed in #13564) |
| wry#1389 (PR) | Use activateIgnoringOtherApps on older macOS | Merged, but includes comment "should only call activate() when we want to focus" |

---

## 9. Recommended Approach for Deep Search

Given the current state of Tauri v2 (as of 2026), here are the recommended approaches ranked:

### Option 1 (Best): Patch wry to conditionally skip `NSApplication::activate()`
The cleanest fix is a local patch to wry that only calls `NSApplication::activate()` when the webview's `focused` flag is true. This involves modifying `wry/src/wkwebview/mod.rs` in the `InnerWebView::new()` method. The `focus` attribute is already plumbed through from Tauri → wry (it's in `WebViewAttributes.focus`), just not used on the macOS code path.

**Patch location**: Around line ~520 in `wry/src/wkwebview/mod.rs`:
```rust
// Only activate the app if the webview should be focused
if attributes.focus {
    let app = NSApplication::sharedApplication(mtm);
    if os_major_version >= 14 {
        NSApplication::activate(&app);
    } else {
        #[allow(deprecated)]
        NSApplication::activateIgnoringOtherApps(&app, true);
    }
}
```

### Option 2 (Pragmatic): Accept brief activation with immediate deactivation
```rust
let webview = window.add_child(
    webview_builder.focused(false),
    tauri::LogicalPosition::new(0, 0),
    tauri::LogicalSize::new(800, 600),
)?;

// For macOS, deactivate the app after a small delay
#[cfg(target_os = "macos")]
{
    std::thread::sleep(std::time::Duration::from_millis(100));
    // Use objc2 to deactivate
}
```

### Option 3 (Architectural): Move extraction to a separate process
Use `tauri::api::process::Command` or sidecar to run extraction in a separate process that doesn't share the GUI app's activation state. More complex but completely avoids the issue.

### Option 4 (Minimal change): Use `ActivationPolicy::Accessory` at startup
```rust
.setup(|app| {
    #[cfg(target_os = "macos")]
    app.set_activation_policy(tauri::ActivationPolicy::Accessory)?;
    Ok(())
})
```
This prevents Dock icon, Cmd+Tab appearance, and reduces the impact of activation. The app window can still be brought to front by mouse click or programmatic `set_focus()`. Note: may cause issues with some macOS behaviors (menubar may be hidden initially).

---

## 10. Key Source Locations

| Component | File | Key lines |
|-----------|------|-----------|
| Tauri `Window.add_child` | `tauri/src/window/mod.rs` | ~line 201 |
| Tauri runtime `create_webview` | `tauri-runtime-wry/src/lib.rs` | ~line 383 |
| wry macOS webview creation | `wry/src/wkwebview/mod.rs` | ~line 517 (`NSApplication::activate`) |
| tao macOS window creation | `tao/src/platform_impl/macos/window.rs` | ~line 534 (`makeKeyAndOrderFront` vs `orderFront`) |
| tao app state activation hack | `tao/src/platform_impl/macos/app_state.rs` | `window_activation_hack()` function |
| Tauri `focused()` plumbing | `tauri/src/webview/webview_window.rs` | `focused()` method |
| WebviewAttributes.focus field | `tauri-runtime/src/lib.rs` | `WebviewAttributes` struct |

---

## References

- [tauri#9065 - can't create non focused window on MacOS](https://github.com/tauri-apps/tauri/issues/9065)
- [tauri#12055 - focused(false) doesn't work](https://github.com/tauri-apps/tauri/issues/12055)
- [tauri#15017 - Expose set_activate_ignoring_other_apps](https://github.com/tauri-apps/tauri/issues/15017)
- [wry#1389 - PR: use activateIgnoringOtherApps on older macOS](https://github.com/tauri-apps/wry/pull/1389)
- [wry#242 - PR: fix macOS windows order (added the activate call)](https://github.com/tauri-apps/wry/pull/242)
- [wry PR comment: "should only call activate when we want to focus"](https://github.com/tauri-apps/wry/pull/1389#issuecomment-2409601491)
- [tao#1197 - fix creating new windows while in fullscreen](https://github.com/tauri-apps/tao/pull/1197)
- [tauri#11569 - fix webview not focused by default](https://github.com/tauri-apps/tauri/pull/11569)
- [tauri#11616 - fix child webviews treated as full window](https://github.com/tauri-apps/tauri/pull/11616)
- [tauri#13564 - webview window focusable property](https://github.com/tauri-apps/tauri/pull/13564)
- [Dev.to: Building Tauri v2 overlay (2026)](https://dev.to/manasightgg/why-i-chose-tauri-v2-for-a-desktop-overlay-in-2026-597h)
- [bbs.songma.com: Tauri headless webview scraping](https://bbs.songma.com/131646.html)
- [NSApplication activateIgnoringOtherApps docs](https://developer.apple.com/documentation/appkit/nsapplication/activationoptions/activateignoringotherapps)
- [Tao PR #612: set_activate_ignoring_other_apps](https://github.com/tauri-apps/tao/commit/d2c6a91)
- [Tauri docs: set_activation_policy](https://v2.tauri.app/reference/javascript/api/namespacewindow/#setfocusable)
