package dev.kamika.nekochat_reloaded

import android.app.Activity
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

/**
 * The Android equivalent of the desktop tray: keeps the process (and so the WebView's
 * WebSocket) alive while the app is in the background, so messages and calls arrive.
 * While the screen is shared it also carries the mediaProjection foreground type.
 */
class KeepAliveService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val capture = intent?.action == ACTION_START_CAPTURE
        try {
            goForeground(capture)
        } catch (error: Exception) {
            if (capture) { ScreenCapture.pendingStart?.invoke(0, 0, error.message ?: error.toString()); ScreenCapture.pendingStart = null }
            stopSelf()
            return START_NOT_STICKY
        }
        when (intent?.action) {
            ACTION_START_CAPTURE -> {
                val data = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(EXTRA_DATA, Intent::class.java) else @Suppress("DEPRECATION") intent.getParcelableExtra(EXTRA_DATA)
                val projection = data?.let { getSystemService(MediaProjectionManager::class.java).getMediaProjection(intent.getIntExtra(EXTRA_RESULT, Activity.RESULT_CANCELED), it) }
                if (projection == null) { ScreenCapture.pendingStart?.invoke(0, 0, "MediaProjection unavailable"); ScreenCapture.pendingStart = null; goForeground(false) }
                else ScreenCapture.start(this, projection)
            }
            ACTION_STOP_CAPTURE -> { ScreenCapture.stop(notify = false); goForeground(false) }
        }
        // The chat lives in the activity's WebView: restarting the service alone would be useless.
        return START_NOT_STICKY
    }

    private fun goForeground(capture: Boolean) {
        val quit = PendingIntent.getActivity(
            this, 1,
            Intent(this, MainActivity::class.java).setAction(MainActivity.ACTION_QUIT).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(this, Notifier.CHANNEL_BACKGROUND)
            .setSmallIcon(R.drawable.ic_stat_neko)
            .setContentTitle(getString(if (capture) R.string.screen_sharing else R.string.background_running))
            .setContentText(getString(R.string.background_hint))
            .setContentIntent(Notifier.openAppIntent(this))
            .addAction(0, getString(R.string.action_quit), quit)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .build()
        val type = ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING or (if (capture) ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION else 0)
        ServiceCompat.startForeground(this, Notifier.ID_BACKGROUND, notification, type)
    }

    override fun onDestroy() {
        ScreenCapture.stop(notify = true)
        super.onDestroy()
    }

    companion object {
        const val ACTION_START_CAPTURE = "dev.kamika.nekochat_reloaded.START_CAPTURE"
        const val ACTION_STOP_CAPTURE = "dev.kamika.nekochat_reloaded.STOP_CAPTURE"
        const val EXTRA_RESULT = "result"
        const val EXTRA_DATA = "data"

        fun start(context: Context) {
            try { context.startForegroundService(Intent(context, KeepAliveService::class.java)) } catch (_: Exception) {}
        }

        fun startCapture(context: Context, resultCode: Int, data: Intent) {
            context.startForegroundService(Intent(context, KeepAliveService::class.java).setAction(ACTION_START_CAPTURE).putExtra(EXTRA_RESULT, resultCode).putExtra(EXTRA_DATA, data))
        }

        fun stopCapture(context: Context) {
            try { context.startService(Intent(context, KeepAliveService::class.java).setAction(ACTION_STOP_CAPTURE)) } catch (_: Exception) {}
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, KeepAliveService::class.java))
        }
    }
}
