package dev.kamika.nekochat_reloaded

import android.content.Context
import android.webkit.WebResourceResponse
import androidx.webkit.WebViewAssetLoader
import java.io.ByteArrayInputStream
import java.io.File
import java.io.InputStream

/**
 * Serves the desktop web UI at https://appassets.androidplatform.net/ with the same
 * layout as the repository root (assets/, prebuilt/), so `<base href="../../">` in the
 * desktop HTML keeps working unchanged.
 *
 * - `/assets/...`, `/prebuilt/...`, `/android/...` come from the APK (`web/` in assets).
 * - `/user-themes/<id>/...` are themes installed from the catalog or imported by the user.
 * - `/runtime-themes/<id>/...` are msstyles themes rendered on the device.
 *
 * Every theme.css gets its url(...) references made absolute, like main.js does on PC.
 */
class WebContent(private val context: Context, private val themes: ThemeManager) : WebViewAssetLoader.PathHandler {

    override fun handle(path: String): WebResourceResponse? {
        val clean = path.substringBefore('?').substringBefore('#').trimStart('/')
        if (clean.split('/').any { it == ".." }) return notFound()
        return try {
            when {
                clean == "android-screen/frame.jpg" -> screenFrame()
                clean.startsWith("user-themes/") -> fileResponse(File(themes.userThemesRoot, clean.removePrefix("user-themes/")), clean)
                clean.startsWith("runtime-themes/") -> fileResponse(File(themes.runtimeThemesRoot, clean.removePrefix("runtime-themes/")), clean)
                else -> assetResponse(clean)
            }
        } catch (_: Exception) {
            notFound()
        }
    }

    private fun screenFrame(): WebResourceResponse {
        val frame = ScreenCapture.latestFrame ?: return notFound()
        val response = WebResourceResponse("image/jpeg", null, ByteArrayInputStream(frame))
        response.responseHeaders = mapOf("Cache-Control" to "no-store", "X-Frame" to ScreenCapture.frameNumber.toString())
        return response
    }

    private fun assetResponse(path: String): WebResourceResponse {
        val stream = context.assets.open("web/$path")
        return respond(path, stream)
    }

    private fun fileResponse(file: File, path: String): WebResourceResponse {
        if (!file.isFile) return notFound()
        return respond(path, file.inputStream())
    }

    private fun respond(path: String, stream: InputStream): WebResourceResponse {
        val mime = mimeType(path)
        val name = path.substringAfterLast('/')
        val body: InputStream = when {
            name.equals("theme.css", ignoreCase = true) -> {
                val directory = "${ORIGIN}/${path.substringBeforeLast('/')}"
                ByteArrayInputStream(absolutizeThemeCss(stream.use { it.readBytes().toString(Charsets.UTF_8) }, directory).toByteArray())
            }
            else -> stream
        }
        val response = WebResourceResponse(mime, if (mime.startsWith("text/") || mime.endsWith("javascript") || mime.endsWith("json")) "utf-8" else null, body)
        response.responseHeaders = mapOf("Cache-Control" to "no-cache", "Access-Control-Allow-Origin" to "*")
        return response
    }

    private fun notFound() = WebResourceResponse("text/plain", "utf-8", 404, "Not Found", emptyMap(), ByteArrayInputStream(ByteArray(0)))

    companion object {
        const val ORIGIN = "https://appassets.androidplatform.net"
        private val CSS_URL = Regex("""url\(\s*(["']?)([^"')]+)\1\s*\)""")

        /**
         * CSS custom properties resolve url(...) in the stylesheet that consumes them, not
         * where the variable is declared, so every theme asset URL must be absolute.
         * Like materializePrebuiltTheme() in main.js, assets are looked up by basename
         * next to the stylesheet (prebuilt CSS contains file:// paths from the PC build).
         */
        fun absolutizeThemeCss(css: String, directoryUrl: String): String = CSS_URL.replace(css) { match ->
            val url = match.groupValues[2].trim()
            if (url.startsWith("data:") || url.startsWith("http:") || url.startsWith("https:") || url.startsWith("#")) match.value
            else "url(\"$directoryUrl/${url.substringAfterLast('/')}\")"
        }

        fun mimeType(path: String): String = when (path.substringAfterLast('.', "").lowercase()) {
            "html", "htm" -> "text/html"
            "css" -> "text/css"
            "js", "mjs" -> "text/javascript"
            "json" -> "application/json"
            "png" -> "image/png"
            "jpg", "jpeg" -> "image/jpeg"
            "gif" -> "image/gif"
            "webp" -> "image/webp"
            "svg" -> "image/svg+xml"
            "ico" -> "image/x-icon"
            "wav" -> "audio/wav"
            "mp3" -> "audio/mpeg"
            "ogg" -> "audio/ogg"
            "woff" -> "font/woff"
            "woff2" -> "font/woff2"
            "ttf" -> "font/ttf"
            "md", "txt" -> "text/plain"
            else -> "application/octet-stream"
        }
    }
}
