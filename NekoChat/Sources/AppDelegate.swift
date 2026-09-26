import UIKit
import UserNotifications

@main
final class AppDelegate: UIResponder, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    var window: UIWindow?
    private var backgroundTask: UIBackgroundTaskIdentifier = .invalid

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in }
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = WebViewController()
        window.makeKeyAndVisible()
        self.window = window
        return true
    }

    // iOS suspends apps soon after they leave the screen: ask for extra time so the
    // connection survives short trips to other apps (there is no tray on a phone).
    func applicationDidEnterBackground(_ application: UIApplication) {
        endBackgroundTask()
        backgroundTask = application.beginBackgroundTask(withName: "NekoChat connection") { [weak self] in self?.endBackgroundTask() }
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        endBackgroundTask()
        Notifier.cancelCall()
    }

    private func endBackgroundTask() {
        guard backgroundTask != .invalid else { return }
        UIApplication.shared.endBackgroundTask(backgroundTask)
        backgroundTask = .invalid
    }

    // Like the desktop toast: show message notifications even while the app is open.
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .list, .sound])
    }
}
