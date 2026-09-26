package dev.kamika.nekochat_reloaded

import android.content.Context
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.os.Handler
import android.os.HandlerThread
import java.io.ByteArrayOutputStream

/**
 * Screen sharing: Android WebView has no getDisplayMedia(), so the screen is captured with
 * MediaProjection and the latest frame is served as /android-screen/frame.jpg. The page
 * (android-bridge.js) draws it into a canvas stream, which nekochat.js encodes as on the PC.
 */
object ScreenCapture {
    @Volatile var latestFrame: ByteArray? = null
        private set
    @Volatile var frameNumber = 0L
        private set

    private var projection: MediaProjection? = null
    private var display: VirtualDisplay? = null
    private var reader: ImageReader? = null
    private var thread: HandlerThread? = null
    private var lastFrameAt = 0L

    /** Called by the page bridge when the system ends the capture (e.g. from the status bar). */
    var onEnded: (() -> Unit)? = null
    /** Waiting for the consent + foreground service start: gets (width, height) or an error. */
    var pendingStart: ((Int, Int, String?) -> Unit)? = null

    val isRunning get() = projection != null

    fun start(context: Context, mediaProjection: MediaProjection) {
        stop(notify = false)
        val metrics = context.resources.displayMetrics
        val scale = minOf(1f, 1280f / maxOf(metrics.widthPixels, metrics.heightPixels))
        val width = (metrics.widthPixels * scale).toInt() / 2 * 2
        val height = (metrics.heightPixels * scale).toInt() / 2 * 2
        val handlerThread = HandlerThread("screen-capture").apply { start() }
        val handler = Handler(handlerThread.looper)
        mediaProjection.registerCallback(object : MediaProjection.Callback() {
            override fun onStop() { stop(notify = true) }
        }, handler)
        val imageReader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2)
        imageReader.setOnImageAvailableListener({ source ->
            val image = source.acquireLatestImage() ?: return@setOnImageAvailableListener
            try {
                val now = System.currentTimeMillis()
                if (now - lastFrameAt < 80) return@setOnImageAvailableListener
                lastFrameAt = now
                val plane = image.planes[0]
                val rowPixels = plane.rowStride / plane.pixelStride
                val bitmap = Bitmap.createBitmap(rowPixels, image.height, Bitmap.Config.ARGB_8888)
                bitmap.copyPixelsFromBuffer(plane.buffer)
                val cropped = if (rowPixels != image.width) Bitmap.createBitmap(bitmap, 0, 0, image.width, image.height) else bitmap
                val output = ByteArrayOutputStream()
                cropped.compress(Bitmap.CompressFormat.JPEG, 70, output)
                latestFrame = output.toByteArray()
                frameNumber++
            } finally {
                image.close()
            }
        }, handler)
        projection = mediaProjection
        reader = imageReader
        thread = handlerThread
        display = mediaProjection.createVirtualDisplay("NekoChat screen", width, height, metrics.densityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, imageReader.surface, null, handler)
        pendingStart?.invoke(width, height, null)
        pendingStart = null
    }

    fun stop(notify: Boolean) {
        val wasRunning = projection != null
        display?.release(); display = null
        reader?.close(); reader = null
        projection?.let { current -> projection = null; try { current.stop() } catch (_: Exception) {} }
        thread?.quitSafely(); thread = null
        latestFrame = null
        if (wasRunning && notify) onEnded?.invoke()
    }
}
