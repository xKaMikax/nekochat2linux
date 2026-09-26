package dev.kamika.nekochat_reloaded

import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * `window.NekoNative` in the host page. It replaces the ipcMain handlers of main.js:
 * android/host.js implements window.windowControls in JavaScript and calls into this
 * bridge only for what needs the platform (files, network downloads, notifications).
 *
 * Async calls: `NekoNative.call(id, method, argsJson)` answers later through
 * `NKHost.resolveNative(id, ok, jsonOrMessage)`.
 */
class NativeBridge(private val activity: MainActivity, private val webView: WebView, private val themes: ThemeManager) {
    private val worker = Executors.newSingleThreadExecutor()
    private val notifications = Executors.newSingleThreadExecutor()

    @JavascriptInterface
    fun call(id: String, method: String, argsJson: String) {
        val args = try { JSONArray(argsJson) } catch (_: Exception) { JSONArray() }
        // JSON null/undefined arguments must not turn into the string "null".
        fun arg(index: Int): String = if (args.isNull(index)) "" else args.optString(index)
        if (method == "screen:start") {
            activity.runOnUiThread {
                activity.requestScreenCapture { width, height, error ->
                    if (error != null) resolve(id, false, error)
                    else resolve(id, true, JSONObject().put("width", width).put("height", height).toString())
                }
            }
            return
        }
        if (method == "theme:import") {
            activity.runOnUiThread {
                activity.pickThemeFile { name, bytes ->
                    if (name == null || bytes == null) resolve(id, true, "null")
                    else worker.execute { run(id) { themes.importTheme(name, bytes) } }
                }
            }
            return
        }
        worker.execute {
            run(id) {
                when (method) {
                    "theme:list" -> themes.listThemes()
                    "theme:current" -> themes.activeTheme ?: JSONObject.NULL
                    "theme:preview" -> themes.previewTheme(arg(0), arg(1).ifEmpty { null })
                    "theme:apply" -> themes.activateTheme(arg(0), arg(1).ifEmpty { null })
                    "theme:remove" -> themes.removeTheme(arg(0))
                    "theme:browser-list" -> themes.fetchCatalog()
                    "theme:browser-details" -> themes.fetchCatalogThemeDetails(arg(0))
                    "theme:browser-install" -> themes.installCatalogTheme(arg(0))
                    "display:current" -> themes.activeDisplay
                    "display:apply" -> themes.saveDisplaySettings(args.optJSONObject(0) ?: JSONObject())
                    else -> throw IllegalArgumentException("Unknown method $method")
                }
            }
        }
    }

    private fun run(id: String, block: () -> Any) {
        try {
            val value = block()
            resolve(id, true, if (value == JSONObject.NULL) "null" else value.toString())
        } catch (error: Throwable) {
            resolve(id, false, error.message ?: error.toString())
        }
    }

    private fun resolve(id: String, ok: Boolean, payload: String) {
        val script = "window.NKHost && NKHost.resolveNative(${JSONObject.quote(id)}, $ok, ${JSONObject.quote(payload)})"
        webView.post { webView.evaluateJavascript(script, null) }
    }

    @JavascriptInterface
    fun notifyMessage(sender: String, content: String, avatarUrl: String) {
        notifications.execute { Notifier.showMessage(activity.applicationContext, sender, content, avatarUrl) }
    }

    @JavascriptInterface
    fun notifyCall(title: String, status: String) {
        if (!activity.isInForeground) Notifier.showCall(activity.applicationContext, title, status)
    }

    @JavascriptInterface
    fun cancelCall() = Notifier.cancelCall(activity.applicationContext)

    @JavascriptInterface
    fun stopScreenCapture() = KeepAliveService.stopCapture(activity.applicationContext)

    init {
        ScreenCapture.onEnded = { webView.post { webView.evaluateJavascript("window.NKHost && NKHost.screenCaptureEnded()", null) } }
    }

    @JavascriptInterface
    fun isForeground(): Boolean = activity.isInForeground

    /** Like hiding the desktop window to the tray: the chat keeps running in the background. */
    @JavascriptInterface
    fun moveToBack() { activity.runOnUiThread { activity.moveTaskToBack(true) } }

    @JavascriptInterface
    fun quit() { activity.runOnUiThread { activity.quitApp() } }

    @JavascriptInterface
    fun ensureMicrophone() { activity.runOnUiThread { activity.ensureMicrophonePermission {} } }
}
