package dev.kamika.nekochat_reloaded

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.OpenableColumns
import android.view.ViewGroup
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewAssetLoader
import java.util.concurrent.Executors

class MainActivity : ComponentActivity() {
    private lateinit var webView: WebView
    private lateinit var themes: ThemeManager
    private lateinit var assetLoader: WebViewAssetLoader
    var isInForeground = false
        private set

    private var pendingFileChooser: ValueCallback<Array<Uri>>? = null
    private var pendingThemePick: ((String?, ByteArray?) -> Unit)? = null
    private var pendingMicrophone = mutableListOf<(Boolean) -> Unit>()

    private val fileChooser = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val callback = pendingFileChooser ?: return@registerForActivityResult
        pendingFileChooser = null
        callback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data))
    }

    private val themePicker = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        val callback = pendingThemePick ?: return@registerForActivityResult
        pendingThemePick = null
        if (uri == null) { callback(null, null); return@registerForActivityResult }
        Executors.newSingleThreadExecutor().execute {
            try {
                val name = contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
                    if (cursor.moveToFirst()) cursor.getString(0) else null
                } ?: uri.lastPathSegment ?: "theme"
                val bytes = contentResolver.openInputStream(uri)!!.use { it.readBytes() }
                callback(name, bytes)
            } catch (_: Exception) {
                callback(null, null)
            }
        }
    }

    private val microphonePermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        val callbacks = pendingMicrophone.toList()
        pendingMicrophone.clear()
        callbacks.forEach { it(granted) }
    }

    private val screenCapturePermission = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val data = result.data
        if (result.resultCode != RESULT_OK || data == null) {
            ScreenCapture.pendingStart?.invoke(0, 0, "NotAllowedError: screen capture was cancelled")
            ScreenCapture.pendingStart = null
            return@registerForActivityResult
        }
        try { KeepAliveService.startCapture(this, result.resultCode, data) }
        catch (error: Exception) { ScreenCapture.pendingStart?.invoke(0, 0, error.message); ScreenCapture.pendingStart = null }
    }

    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) {}

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        if (intent?.action == ACTION_QUIT) { quitApp(); return }

        Notifier.createChannels(this)
        themes = ThemeManager(this)
        val web = WebContent(this, themes)
        assetLoader = WebViewAssetLoader.Builder().addPathHandler("/", web).build()

        val root = FrameLayout(this)
        if (applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0) WebView.setWebContentsDebuggingEnabled(true)
        webView = WebView(this)
        root.addView(webView, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        setContentView(root)
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
            WindowInsetsCompat.CONSUMED
        }

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = false
            // Users may point the client at their own http:// NekoChat server.
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            textZoom = 100
            setSupportZoom(false)
        }
        webView.addJavascriptInterface(NativeBridge(this, webView, themes), "NekoNative")
        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                assetLoader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (request.url.host == Uri.parse(WebContent.ORIGIN).host) return false
                // Links to the outside world open in the browser, never inside the app shell.
                try { startActivity(Intent(Intent.ACTION_VIEW, request.url)) } catch (_: Exception) {}
                return true
            }
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                val wanted = request.resources.filter { it == PermissionRequest.RESOURCE_AUDIO_CAPTURE }
                if (wanted.isEmpty()) { request.deny(); return }
                runOnUiThread {
                    ensureMicrophonePermission { granted -> if (granted) request.grant(wanted.toTypedArray()) else request.deny() }
                }
            }

            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                pendingFileChooser?.onReceiveValue(null)
                pendingFileChooser = callback
                return try {
                    fileChooser.launch(params.createIntent())
                    true
                } catch (_: Exception) {
                    pendingFileChooser = null
                    false
                }
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                webView.evaluateJavascript("window.NKHost ? NKHost.back() : false") { handled ->
                    if (handled != "true") moveTaskToBack(true)
                }
            }
        })

        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }

        Executors.newSingleThreadExecutor().execute {
            themes.load()
            runOnUiThread { if (!isFinishing) webView.loadUrl("${WebContent.ORIGIN}/android/host.html") }
        }
        KeepAliveService.start(this)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.action == ACTION_QUIT) quitApp()
    }

    override fun onResume() {
        super.onResume()
        isInForeground = true
        Notifier.cancelCall(this)
    }

    override fun onPause() {
        super.onPause()
        isInForeground = false
        // WebView timers are deliberately NOT paused: the chat must keep its socket open.
    }

    override fun onDestroy() {
        if (::webView.isInitialized) {
            (webView.parent as? ViewGroup)?.removeView(webView)
            webView.destroy()
        }
        super.onDestroy()
    }

    fun ensureMicrophonePermission(callback: (Boolean) -> Unit) {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) { callback(true); return }
        pendingMicrophone += callback
        if (pendingMicrophone.size == 1) microphonePermission.launch(Manifest.permission.RECORD_AUDIO)
    }

    fun requestScreenCapture(callback: (Int, Int, String?) -> Unit) {
        ScreenCapture.pendingStart?.invoke(0, 0, "Screen capture request replaced")
        ScreenCapture.pendingStart = callback
        val manager = getSystemService(android.media.projection.MediaProjectionManager::class.java)
        try { screenCapturePermission.launch(manager.createScreenCaptureIntent()) }
        catch (error: Exception) { ScreenCapture.pendingStart = null; callback(0, 0, error.message ?: error.toString()) }
    }

    fun pickThemeFile(callback: (String?, ByteArray?) -> Unit) {
        pendingThemePick?.invoke(null, null)
        pendingThemePick = callback
        try { themePicker.launch(arrayOf("*/*")) } catch (_: Exception) { pendingThemePick = null; callback(null, null) }
    }

    fun quitApp() {
        KeepAliveService.stop(this)
        Notifier.cancelCall(this)
        finishAndRemoveTask()
    }

    companion object {
        const val ACTION_QUIT = "dev.kamika.nekochat_reloaded.QUIT"
    }
}
