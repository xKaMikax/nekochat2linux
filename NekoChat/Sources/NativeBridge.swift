import UIKit
import UniformTypeIdentifiers
import WebKit

/// `window.webkit.messageHandlers.neko` — the iPhone side of window.NekoNative (ios/native.js).
/// Like the Kotlin bridge on Android, it replaces the ipcMain handlers of main.js that need
/// the platform: themes on disk, downloads and notifications. Replies are JSON strings.
final class NativeBridge: NSObject, WKScriptMessageHandlerWithReply, UIDocumentPickerDelegate {
    weak var webView: WKWebView?
    private weak var presenter: UIViewController?
    private let themes: ThemeManager
    private let worker = DispatchQueue(label: "dev.kamika.nekochat-reloaded.bridge")
    private var pendingThemePick: ((String?, Data?) -> Void)?

    init(themes: ThemeManager, presenter: UIViewController) {
        self.themes = themes
        self.presenter = presenter
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        guard let body = message.body as? [String: Any], let method = body["method"] as? String else {
            replyHandler(nil, "Bad request")
            return
        }
        let args = body["args"] as? [Any] ?? []
        // JSON null/undefined arguments must not turn into the string "null".
        func arg(_ index: Int) -> String { index < args.count ? (args[index] as? String ?? "") : "" }
        let reply: (Result<Any?, Error>) -> Void = { result in
            DispatchQueue.main.async {
                switch result {
                case .success(let value): replyHandler(Self.json(value), nil)
                case .failure(let error): replyHandler(nil, (error as? LocalizedError)?.errorDescription ?? error.localizedDescription)
                }
            }
        }
        let run: (@escaping () throws -> Any?) -> Void = { [worker] block in
            worker.async { reply(Result { try block() }) }
        }

        switch method {
        case "notify:message":
            Notifier.message(sender: arg(0), content: arg(1), avatarUrl: arg(2))
            replyHandler(nil, nil)
        case "notify:call":
            if UIApplication.shared.applicationState != .active { Notifier.call(title: arg(0), status: arg(1)) }
            replyHandler(nil, nil)
        case "notify:cancel-call":
            Notifier.cancelCall()
            replyHandler(nil, nil)
        case "theme:import":
            pickThemeFile { [weak self] name, data in
                guard let self, let name, let data else { reply(.success(nil)); return }
                run { try self.themes.importTheme(fileName: name, data: data) }
            }
        case "theme:list": run { try self.themes.listThemes() }
        case "theme:current": run { self.themes.activeTheme }
        case "theme:preview": run { try self.themes.previewTheme(id: arg(0), scheme: arg(1).isEmpty ? nil : arg(1)) }
        case "theme:apply": run { try self.themes.activateTheme(id: arg(0), requestedScheme: arg(1).isEmpty ? nil : arg(1)) }
        case "theme:remove": run { try self.themes.removeTheme(id: arg(0)) }
        case "theme:browser-list": run { try self.themes.fetchCatalog() }
        case "theme:browser-details": run { try self.themes.fetchCatalogThemeDetails(id: arg(0)) }
        case "theme:browser-install": run { try self.themes.installCatalogTheme(id: arg(0)) }
        case "display:current": run { self.themes.activeDisplay }
        case "display:apply": run { try self.themes.saveDisplaySettings(args.first as? [String: Any] ?? [:]) }
        default: replyHandler(nil, "Unknown method \(method)")
        }
    }

    private static func json(_ value: Any?) -> String {
        guard let value, !(value is NSNull) else { return "null" }
        if let string = value as? String, let data = try? JSONSerialization.data(withJSONObject: [string]), let text = String(data: data, encoding: .utf8) {
            return String(text.dropFirst().dropLast())
        }
        guard JSONSerialization.isValidJSONObject(value), let data = try? JSONSerialization.data(withJSONObject: value) else { return "null" }
        return String(data: data, encoding: .utf8) ?? "null"
    }

    // MARK: - Theme import (dialog.showOpenDialog in main.js)

    private func pickThemeFile(_ callback: @escaping (String?, Data?) -> Void) {
        pendingThemePick?(nil, nil)
        pendingThemePick = callback
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.item], asCopy: true)
        picker.delegate = self
        picker.allowsMultipleSelection = false
        presenter?.present(picker, animated: true)
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        let callback = pendingThemePick
        pendingThemePick = nil
        guard let url = urls.first, let data = try? Data(contentsOf: url) else { callback?(nil, nil); return }
        callback?(url.lastPathComponent, data)
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        pendingThemePick?(nil, nil)
        pendingThemePick = nil
    }
}
