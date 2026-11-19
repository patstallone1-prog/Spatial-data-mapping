// Kerbside on the system's WebKit (WKWebView): the same site as desktop/ (Electron), with no
// bundled Chromium. One window, one web view, the site's own hosts kept in the app.
//
//   Kerbside.app/Contents/MacOS/Kerbside                 the live site
//   ... --url=<page>   (or KERBSIDE_URL=<page>)          any page of the site
//   ... --measure                                       City mode, polled each second, JSON lines on stdout
//
// Every machine-readable line on stdout is "kerbside: {json}" with a "kind" field
// (app, page-log, process, api, sample, enter, terminated, measure).
import AppKit
import WebKit

let SITE = "https://spatial-data-mapping.vercel.app/app-model.html"
let args = CommandLine.arguments
func argValue(_ name: String) -> String? {
    let p = "--\(name)="
    return args.first(where: { $0.hasPrefix(p) }).map { String($0.dropFirst(p.count)) }
}
let START = argValue("url") ?? ProcessInfo.processInfo.environment["KERBSIDE_URL"] ?? SITE
let MEASURE = args.contains("--measure")
let startURL = URL(string: START) ?? URL(string: SITE)!
let launched = Date()

func originOf(_ u: URL) -> String? {
    guard let s = u.scheme, let h = u.host else { return nil }
    return u.port.map { "\(s)://\(h):\($0)" } ?? "\(s)://\(h)"
}
let TRUSTED: Set<String> = {
    var t: Set<String> = ["https://spatial-data-mapping.vercel.app", "https://djllcgon03ax2.cloudfront.net"]
    if let o = originOf(startURL) { t.insert(o) }
    return t
}()
func trusted(_ u: URL?) -> Bool {
    guard let u = u else { return false }
    if u.host == "localhost" || u.host == "127.0.0.1" { return true }
    return originOf(u).map { TRUSTED.contains($0) } ?? false
}

// ---- stdout ------------------------------------------------------------------------------------
func emit(_ kind: String, _ fields: [String: Any] = [:]) {
    var o = fields
    o["kind"] = kind
    o["t"] = (Date().timeIntervalSince(launched) * 1000).rounded() / 1000
    o["wall"] = ISO8601DateFormatter().string(from: Date())
    let data = (try? JSONSerialization.data(withJSONObject: o, options: [.sortedKeys])) ?? Data("{}".utf8)
    FileHandle.standardOutput.write(Data("kerbside: ".utf8) + data + Data("\n".utf8))
}
func jsonObject(_ s: Any?) -> Any {
    guard let s = s as? String, let d = s.data(using: .utf8), let o = try? JSONSerialization.jsonObject(with: d) else { return s ?? NSNull() }
    return o
}

// ---- scripts injected at document start ----------------------------------------------------------
//: Errors and console warnings/errors forwarded to the app; an rAF frame counter (window.__kbFps).
let FORWARD_JS = """
(() => {
  const post = (level, text) => { try { window.webkit.messageHandlers.kerbsideLog.postMessage({ level, text: String(text).slice(0, 2000), page: location.pathname }); } catch (_) {} };
  const fmt = (a) => a.map((x) => { if (x instanceof Error) return x.stack || String(x); if (typeof x === 'object') { try { return JSON.stringify(x); } catch (_) { return String(x); } } return String(x); }).join(' ');
  addEventListener('error', (e) => post('onerror', (e.message || 'error') + ' @ ' + (e.filename || '') + ':' + (e.lineno || 0) + (e.error && e.error.stack ? '\\n' + e.error.stack : '')), true);
  addEventListener('unhandledrejection', (e) => post('unhandledrejection', e.reason && e.reason.stack ? e.reason.stack : String(e.reason)));
  for (const level of ['error', 'warn']) { const orig = console[level].bind(console); console[level] = (...a) => { post(level, fmt(a)); orig(...a); }; }
  const f = window.__kbFps = { fps: 0, maxMs: 0, frames: 0 };
  let n = 0, t0 = performance.now(), last = t0, worst = 0;
  const tick = (now) => { n++; worst = Math.max(worst, now - last); last = now;
    if (now - t0 >= 1000) { f.fps = Math.round(n * 10000 / (now - t0)) / 10; f.maxMs = Math.round(worst); f.frames += n; n = 0; worst = 0; t0 = now; }
    requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
})();
"""
let MEASURE_START_JS = "try { localStorage.setItem('kerbside:mode', 'city'); } catch (_) {}"

let POLL_JS = """
(() => { const o = {};
  try { const s = window.kerbsideLoadState?.(); if (s) { o.loaded = !!s.loaded; o.waiting = (s.waiting || []).slice(0, 6).map(String); } } catch (e) { o.loadErr = String(e).slice(0, 200); }
  try { const f = window.kerbsideLoadFraction?.(); o.fraction = typeof f === 'number' ? Math.round(f * 1000) / 1000 : null; } catch (e) {}
  const home = document.getElementById('home'); o.home = !!home;
  o.loadscreen = !!document.querySelector('#home .loadscreen');
  o.line = document.querySelector('#home .loadscreen .line')?.textContent || null;
  o.status = document.querySelector('#home .status')?.textContent || null;
  o.pct = document.querySelector('#home .loadscreen .pct')?.textContent || null;
  try { const c = window.kerbsideCity?.(); if (c && typeof c.visible === 'function') { const v = c.visible(); o.city = true; o.people = v?.people?.length ?? null; o.vehicles = v?.vehicles?.length ?? null; } else o.city = !!c; } catch (e) { o.cityErr = String(e).slice(0, 200); }
  try { const r = window.kerbside?.renderer; if (r && r.info) { o.geometries = r.info.memory.geometries; o.textures = r.info.memory.textures; o.calls = r.info.render.calls; o.triangles = r.info.render.triangles; o.programs = r.info.programs ? r.info.programs.length : null; } } catch (e) {}
  const f = window.__kbFps; if (f) { o.fps = f.fps; o.frameMaxMs = f.maxMs; }
  if (performance.memory) { o.heapUsed = performance.memory.usedJSHeapSize; o.heapTotal = performance.memory.totalJSHeapSize; o.heapLimit = performance.memory.jsHeapSizeLimit; }
  try { const m = window.kerbsideMemory?.(); if (m) o.governor = { level: m.level, sheds: m.sheds, heap: m.heap }; } catch (e) {}
  o.hidden = document.hidden; o.path = location.pathname; o.mode = (() => { try { return localStorage.getItem('kerbside:mode'); } catch (_) { return null; } })();
  return JSON.stringify(o); })()
"""

let API_JS = """
const o = {};
const c = document.createElement('canvas'); const gl = c.getContext('webgl2');
o.webgl2 = !!gl;
if (gl) { const d = gl.getExtension('WEBGL_debug_renderer_info'); o.glRenderer = d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  o.glVersion = gl.getParameter(gl.VERSION); o.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  o.extensions = (gl.getSupportedExtensions() || []).length; gl.getExtension('WEBGL_lose_context')?.loseContext(); }
o.pageHasWebGL2Context = (() => { try { const r = window.kerbside?.renderer; return r ? (r.getContext() instanceof WebGL2RenderingContext) : null; } catch (_) { return null; } })();
o.performanceMemory = !!performance.memory;
o.measureUserAgentSpecificMemory = typeof performance.measureUserAgentSpecificMemory === 'function';
o.pointerLock = 'requestPointerLock' in Element.prototype;
o.webgpu = !!navigator.gpu;
o.offscreenCanvas = typeof OffscreenCanvas === 'function';
o.offscreenWebGL2 = (() => { try { return !!new OffscreenCanvas(4, 4).getContext('webgl2'); } catch (_) { return false; } })();
o.sharedArrayBuffer = typeof SharedArrayBuffer === 'function';
o.crossOriginIsolated = !!window.crossOriginIsolated;
o.deviceMemory = navigator.deviceMemory ?? null;
o.hardwareConcurrency = navigator.hardwareConcurrency ?? null;
o.userAgent = navigator.userAgent;
o.devicePixelRatio = devicePixelRatio;
o.storagePersisted = await navigator.storage?.persisted?.().catch(() => null) ?? null;
try { const e = await navigator.storage.estimate(); o.storageEstimate = { usage: e.usage ?? null, quota: e.quota ?? null }; } catch (e) { o.storageEstimate = String(e); }
return JSON.stringify(o);
"""

// ---- the app -------------------------------------------------------------------------------------
final class Delegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, NSWindowDelegate {
    var window: NSWindow!
    var web: WKWebView!
    var pollTimer: Timer?
    var apiNoted = false
    var enterPresses = 0
    var lastEnterAt = Date.distantPast
    var lobbyGoneAt: Double?
    var terminations = 0

    func applicationDidFinishLaunching(_ note: Notification) {
        menu()
        let cfg = WKWebViewConfiguration()
        cfg.websiteDataStore = .default()
        cfg.mediaTypesRequiringUserActionForPlayback = []
        let ucc = WKUserContentController()
        ucc.add(self, name: "kerbsideLog")
        ucc.addUserScript(WKUserScript(source: FORWARD_JS, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        if MEASURE { ucc.addUserScript(WKUserScript(source: MEASURE_START_JS, injectionTime: .atDocumentStart, forMainFrameOnly: true)) }
        cfg.userContentController = ucc
        cfg.preferences.setValue(true, forKey: "developerExtrasEnabled")
        cfg.preferences.isElementFullscreenEnabled = true

        let frame = NSRect(x: 0, y: 0, width: 1440, height: 900)
        window = NSWindow(contentRect: frame, styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Kerbside"
        window.minSize = NSSize(width: 640, height: 480)
        window.backgroundColor = NSColor(red: 0.043, green: 0.063, blue: 0.086, alpha: 1)
        window.collectionBehavior = [.fullScreenPrimary]
        window.setFrameAutosaveName("KerbsideMain")
        window.delegate = self
        web = WKWebView(frame: frame, configuration: cfg)
        web.autoresizingMask = [.width, .height]
        web.navigationDelegate = self
        web.uiDelegate = self
        if #available(macOS 13.3, *) { web.isInspectable = true }
        // Never slowed down behind another window (as the Electron app's
        // --disable-backgrounding-occluded-windows): WebKit SPI, set only if present.
        let setOcclusion = NSSelectorFromString("_setWindowOcclusionDetectionEnabled:")
        if web.responds(to: setOcclusion) {
            typealias SetBool = @convention(c) (AnyObject, Selector, Bool) -> Void
            unsafeBitCast(web.method(for: setOcclusion), to: SetBool.self)(web, setOcclusion, false)
        }
        window.contentView = web
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        emit("app", ["pid": ProcessInfo.processInfo.processIdentifier, "url": START, "measure": MEASURE,
                     "occlusionDetection": occlusionDetection(),
                     "windowVisible": window.occlusionState.contains(.visible),
                     "os": ProcessInfo.processInfo.operatingSystemVersionString])
        web.load(URLRequest(url: startURL))
        if MEASURE { pollTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.poll() } }
        // SIGTERM from the measuring script: quit cleanly.
        signal(SIGTERM, SIG_IGN)
        let src = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
        src.setEventHandler { emit("app", ["event": "sigterm"]); NSApp.terminate(nil) }
        src.resume()
        sigterm = src
    }
    var sigterm: DispatchSourceSignal?
    // No App Nap for the app's own process (WebKit still throttles a page that is hidden or occluded).
    let activity = ProcessInfo.processInfo.beginActivity(options: [.userInitiated, .latencyCritical], reason: "Kerbside is running a game")

    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { true }

    func occlusionDetection() -> Any {
        let get = NSSelectorFromString("_windowOcclusionDetectionEnabled")
        guard web.responds(to: get) else { return "n/a" }
        typealias GetBool = @convention(c) (AnyObject, Selector) -> Bool
        return unsafeBitCast(web.method(for: get), to: GetBool.self)(web, get)
    }

    // Helper process ids (WebKit SPI, read only if present).
    func processIDs() -> [String: Any] {
        var o: [String: Any] = [:]
        if web.responds(to: NSSelectorFromString("_webProcessIdentifier")), let n = web.value(forKey: "_webProcessIdentifier") as? NSNumber { o["webContent"] = n }
        let pool = web.configuration.processPool
        for (k, sel) in [("gpu", "_gpuProcessIdentifier"), ("networking", "_networkProcessIdentifier")] {
            if pool.responds(to: NSSelectorFromString(sel)), let n = pool.value(forKey: sel) as? NSNumber { o[k] = n }
        }
        return o
    }

    // ---- menu --------------------------------------------------------------------------------------
    func menu() {
        let main = NSMenu()
        func item(_ title: String, _ action: Selector?, _ key: String, _ mods: NSEvent.ModifierFlags = .command, target: AnyObject? = nil) -> NSMenuItem {
            let i = NSMenuItem(title: title, action: action, keyEquivalent: key); i.keyEquivalentModifierMask = mods; if let t = target { i.target = t }; return i
        }
        let appMenu = NSMenu()
        appMenu.addItem(item("Hide Kerbside", #selector(NSApplication.hide(_:)), "h"))
        appMenu.addItem(.separator())
        appMenu.addItem(item("Quit Kerbside", #selector(NSApplication.terminate(_:)), "q"))
        let edit = NSMenu(title: "Edit")
        edit.addItem(item("Undo", Selector(("undo:")), "z"))
        edit.addItem(item("Redo", Selector(("redo:")), "z", [.command, .shift]))
        edit.addItem(.separator())
        edit.addItem(item("Cut", #selector(NSText.cut(_:)), "x"))
        edit.addItem(item("Copy", #selector(NSText.copy(_:)), "c"))
        edit.addItem(item("Paste", #selector(NSText.paste(_:)), "v"))
        edit.addItem(item("Select All", #selector(NSText.selectAll(_:)), "a"))
        let view = NSMenu(title: "View")
        view.addItem(item("Reload", #selector(reload), "r", target: self))
        view.addItem(item("Open the live site", #selector(openLive), "", target: self))
        view.addItem(item("Open in the browser", #selector(openInBrowser), "", target: self))
        view.addItem(item("Open Web Inspector", #selector(inspector), "i", [.command, .option], target: self))
        view.addItem(.separator())
        view.addItem(item("Toggle Full Screen", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control]))
        let win = NSMenu(title: "Window")
        win.addItem(item("Minimize", #selector(NSWindow.performMiniaturize(_:)), "m"))
        win.addItem(item("Close", #selector(NSWindow.performClose(_:)), "w"))
        for (title, sub) in [("Kerbside", appMenu), ("Edit", edit), ("View", view), ("Window", win)] {
            let top = NSMenuItem(title: title, action: nil, keyEquivalent: ""); top.submenu = sub; main.addItem(top)
        }
        NSApp.mainMenu = main
        NSApp.windowsMenu = win
    }
    @objc func reload() { web.reload() }
    @objc func openLive() { web.load(URLRequest(url: URL(string: SITE)!)) }
    @objc func openInBrowser() { if let u = web.url { NSWorkspace.shared.open(u) } }
    @objc func inspector() {
        // The Web Inspector is reached through the context menu (Inspect Element) once developer
        // extras are on; WKWebView's own inspector object is SPI, used here only if present.
        if web.responds(to: NSSelectorFromString("_inspector")), let ins = web.value(forKey: "_inspector") as? NSObject,
           ins.responds(to: NSSelectorFromString("show")) { ins.perform(NSSelectorFromString("show")) }
    }

    // ---- navigation --------------------------------------------------------------------------------
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let u = action.request.url
        if action.targetFrame?.isMainFrame == false { decisionHandler(.allow); return }  // iframes: the page's business
        if trusted(u) || u?.scheme == "about" || u?.scheme == "blob" || u?.scheme == "data" { decisionHandler(.allow); return }
        if let u = u, u.scheme == "http" || u.scheme == "https" { NSWorkspace.shared.open(u) }
        decisionHandler(.cancel)
    }
    // window.open: trusted pages load here, others in the browser.
    func webView(_ webView: WKWebView, createWebViewWith cfg: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let u = action.request.url {
            if trusted(u) { webView.load(action.request) } else if u.scheme == "http" || u.scheme == "https" { NSWorkspace.shared.open(u) }
        }
        return nil
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        emit("process", ["event": "didFinish", "url": webView.url?.absoluteString ?? "", "pids": processIDs()])
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { emit("app", ["event": "didFail", "error": error.localizedDescription]) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { emit("app", ["event": "didFailProvisional", "error": error.localizedDescription]) }
    // A page whose process ended is loaded again rather than left blank.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        terminations += 1
        emit("terminated", ["count": terminations, "lastUrl": webView.url?.absoluteString ?? ""])
        apiNoted = false; lobbyGoneAt = nil; enterPresses = 0
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { webView.load(URLRequest(url: startURL)) }
    }

    // ---- permissions and panels ----------------------------------------------------------------------
    @available(macOS 12.0, *)
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        let o = origin.port == 0 ? "\(origin.protocol)://\(origin.host)" : "\(origin.protocol)://\(origin.host):\(origin.port)"
        decisionHandler(TRUSTED.contains(o) || origin.host == "localhost" || origin.host == "127.0.0.1" ? .grant : .deny)
    }
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        if MEASURE { emit("page-log", ["level": "alert", "text": message]); completionHandler(); return }
        let a = NSAlert(); a.messageText = "Kerbside"; a.informativeText = message; a.addButton(withTitle: "OK")
        a.beginSheetModal(for: window) { _ in completionHandler() }
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        if MEASURE { emit("page-log", ["level": "confirm", "text": message]); completionHandler(false); return }
        let a = NSAlert(); a.messageText = "Kerbside"; a.informativeText = message; a.addButton(withTitle: "OK"); a.addButton(withTitle: "Cancel")
        a.beginSheetModal(for: window) { r in completionHandler(r == .alertFirstButtonReturn) }
    }
    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        if MEASURE { completionHandler(nil); return }
        let a = NSAlert(); a.messageText = prompt; a.addButton(withTitle: "OK"); a.addButton(withTitle: "Cancel")
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 260, height: 24)); field.stringValue = defaultText ?? ""; a.accessoryView = field
        a.beginSheetModal(for: window) { r in completionHandler(r == .alertFirstButtonReturn ? field.stringValue : nil) }
    }

    // ---- page log -------------------------------------------------------------------------------------
    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "kerbsideLog" else { return }
        var f = (message.body as? [String: Any]) ?? ["text": "\(message.body)"]
        f["level"] = f["level"] ?? "log"
        emit("page-log", f)
    }

    // ---- measuring ------------------------------------------------------------------------------------
    func poll() {
        web.evaluateJavaScript(POLL_JS) { [weak self] result, error in
            guard let self = self else { return }
            if let error = error { emit("sample", ["error": error.localizedDescription]); return }
            guard let o = jsonObject(result) as? [String: Any] else { return }
            emit("sample", ["page": o])
            let home = o["home"] as? Bool ?? false, loaded = o["loaded"] as? Bool ?? false
            let now = Date().timeIntervalSince(launched)
            if !self.apiNoted, o["loaded"] != nil { self.apiNoted = true; self.noteAPIs() }
            // Enter once when the lobby is up (the loading screen then shows the phase), and again
            // once loading has finished if the lobby has not gone in by itself.
            if home, self.enterPresses == 0 || (loaded && Date().timeIntervalSince(self.lastEnterAt) > 3 && self.enterPresses < 6) {
                self.pressEnter(loaded: loaded, at: now)
            }
            if !home, self.enterPresses > 0, self.lobbyGoneAt == nil {
                self.lobbyGoneAt = now
                emit("enter", ["event": "lobby-gone", "seconds": now])
            }
        }
    }
    func pressEnter(loaded: Bool, at now: Double) {
        enterPresses += 1; lastEnterAt = Date()
        window.makeFirstResponder(web)
        web.evaluateJavaScript("window.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', code:'Enter', bubbles:true})); true") { _, _ in }
        emit("enter", ["event": "pressed", "loaded": loaded, "press": enterPresses, "seconds": now])
    }
    func noteAPIs() {
        web.callAsyncJavaScript(API_JS, arguments: [:], in: nil, in: .page) { r in
            switch r {
            case .success(let v): emit("api", ["apis": jsonObject(v), "pids": self.processIDs()])
            case .failure(let e): emit("api", ["error": e.localizedDescription])
            }
        }
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let delegate = Delegate()
app.delegate = delegate
app.run()
