package dev.kamika.nekochat_reloaded

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

/** Android counterpart of showMessageNotification() in main.js (plus incoming-call alerts). */
object Notifier {
    const val CHANNEL_MESSAGES = "messages"
    const val CHANNEL_CALLS = "calls"
    const val CHANNEL_BACKGROUND = "background"
    const val ID_BACKGROUND = 1
    private const val ID_CALL = 2
    private var nextMessageId = 100

    fun createChannels(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL_MESSAGES, context.getString(R.string.channel_messages), NotificationManager.IMPORTANCE_HIGH))
        manager.createNotificationChannel(NotificationChannel(CHANNEL_CALLS, context.getString(R.string.channel_calls), NotificationManager.IMPORTANCE_HIGH))
        manager.createNotificationChannel(NotificationChannel(CHANNEL_BACKGROUND, context.getString(R.string.channel_background), NotificationManager.IMPORTANCE_MIN).apply { setShowBadge(false) })
    }

    fun openAppIntent(context: Context): PendingIntent = PendingIntent.getActivity(
        context, 0,
        Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_NEW_TASK),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    private fun allowed(context: Context) = Build.VERSION.SDK_INT < 33 ||
        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    /** Blocking (downloads the avatar): call from a background thread. */
    fun showMessage(context: Context, sender: String, content: String, avatarUrl: String) {
        if (!allowed(context)) return
        val avatar = if (avatarUrl.startsWith("http")) try {
            val (status, bytes) = ThemeManager.download(avatarUrl)
            if (status in 200..299) BitmapFactory.decodeByteArray(bytes, 0, bytes.size) else null
        } catch (_: Exception) { null } else null
        val notification = NotificationCompat.Builder(context, CHANNEL_MESSAGES)
            .setSmallIcon(R.drawable.ic_stat_neko)
            .setContentTitle(sender.ifEmpty { "User" })
            .setContentText(content)
            .setSubText(context.getString(R.string.app_name))
            .setStyle(NotificationCompat.BigTextStyle().bigText(content))
            .setLargeIcon(avatar ?: BitmapFactory.decodeResource(context.resources, R.mipmap.ic_launcher))
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setContentIntent(openAppIntent(context))
            .setAutoCancel(true)
            .build()
        try { NotificationManagerCompat.from(context).notify(nextMessageId++, notification) } catch (_: SecurityException) {}
    }

    fun showCall(context: Context, title: String, status: String) {
        if (!allowed(context)) return
        val notification = NotificationCompat.Builder(context, CHANNEL_CALLS)
            .setSmallIcon(R.drawable.ic_stat_neko)
            .setContentTitle(title)
            .setContentText(status)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setContentIntent(openAppIntent(context))
            .setFullScreenIntent(openAppIntent(context), true)
            .setOngoing(true)
            .build()
        try { NotificationManagerCompat.from(context).notify(ID_CALL, notification) } catch (_: SecurityException) {}
    }

    fun cancelCall(context: Context) = NotificationManagerCompat.from(context).cancel(ID_CALL)
}
