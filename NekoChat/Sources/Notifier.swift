import Foundation
import UserNotifications

/// iPhone counterpart of showMessageNotification() in main.js (plus incoming-call alerts).
enum Notifier {
    private static let callId = "incoming-call"

    static func message(sender: String, content: String, avatarUrl: String) {
        DispatchQueue.global(qos: .utility).async {
            let notification = UNMutableNotificationContent()
            notification.title = sender.isEmpty ? "User" : sender
            notification.body = content
            notification.subtitle = "NekoChat Reloaded"
            notification.sound = .default
            if let attachment = avatarAttachment(avatarUrl) { notification.attachments = [attachment] }
            UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: UUID().uuidString, content: notification, trigger: nil))
        }
    }

    static func call(title: String, status: String) {
        let notification = UNMutableNotificationContent()
        notification.title = title
        notification.body = status
        notification.sound = .default
        notification.interruptionLevel = .timeSensitive
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: callId, content: notification, trigger: nil))
    }

    static func cancelCall() {
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [callId])
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [callId])
    }

    /// Blocking: downloads the sender's avatar next to the notification.
    private static func avatarAttachment(_ url: String) -> UNNotificationAttachment? {
        guard url.hasPrefix("http"), let downloaded = try? ThemeManager.download(url), (200..<300).contains(downloaded.0), !downloaded.1.isEmpty else { return nil }
        let data = downloaded.1
        let isPng = data.starts(with: [0x89, 0x50, 0x4E, 0x47])
        let isGif = data.starts(with: [0x47, 0x49, 0x46])
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("avatar-\(UUID().uuidString).\(isPng ? "png" : isGif ? "gif" : "jpg")")
        do {
            try data.write(to: file)
            return try UNNotificationAttachment(identifier: "avatar", url: file)
        } catch {
            return nil
        }
    }
}
