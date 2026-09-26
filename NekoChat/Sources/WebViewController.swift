import UIKit
import WebKit

/// Hosts the desktop web UI (ios/host.html) in a WKWebView served from the app bundle.
final class WebViewController: UIViewController, WKUIDelegate, WKNavigationDelegate {
    static let scheme = "nekochat"
    static let origin = "nekochat://app"

    private let themes = ThemeManager()
    private var webView: WKWebView!
    private var bridge: NativeBridge!
    private var bottomConstraint: NSLayoutConstraint!

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    override func loadView() {
        let view = UIView()
        // XP title bar blue behind the status bar and the home indicator.
        view.backgroundColor = UIColor(red: 0.04, green: 0.14, blue: 0.42, alpha: 1)
        self.view = view
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(WebContent(themes: themes), forURLScheme: Self.scheme)
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.websiteDataStore = .default()
        bridge = NativeBridge(themes: themes, presenter: self)
        configuration.userContentController.addScriptMessageHandler(bridge, contentWorld: .page, name: "neko")

        webView = WKWebView(frame: .zero, configuration: configuration)
        bridge.webView = webView
        webView.uiDelegate = self
        webView.navigationDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = .clear
        // The page lays itself out like a window: the web view itself must never scroll.
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        if #available(iOS 16.4, *) { webView.isInspectable = true }
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)

        let guide = view.safeAreaLayoutGuide
        bottomConstraint = webView.bottomAnchor.constraint(equalTo: guide.bottomAnchor)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: guide.topAnchor),
            webView.leadingAnchor.constraint(equalTo: guide.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: guide.trailingAnchor),
            bottomConstraint,
        ])
        NotificationCenter.default.addObserver(self, selector: #selector(keyboardWillChange(_:)), name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(keyboardWillChange(_:)), name: UIResponder.keyboardWillHideNotification, object: nil)

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            self?.themes.load()
            DispatchQueue.main.async { self?.loadHost() }
        }
    }

    private func loadHost() {
        webView.load(URLRequest(url: URL(string: "\(Self.origin)/ios/host.html")!))
    }

    /// Shrinks the page above the keyboard, like Android's adjustResize, so the message
    /// field stays visible instead of the whole page scrolling away.
    @objc private func keyboardWillChange(_ notification: Notification) {
        var overlap: CGFloat = 0
        if notification.name != UIResponder.keyboardWillHideNotification,
           let frame = notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect {
            let keyboard = view.convert(frame, from: nil)
            overlap = max(0, view.bounds.maxY - keyboard.minY - view.safeAreaInsets.bottom)
        }
        bottomConstraint.constant = -overlap
        UIView.animate(withDuration: 0.25) {
            self.view.layoutIfNeeded()
            self.webView.scrollView.contentOffset = .zero
        }
    }

    // MARK: - WKUIDelegate

    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        // Voice calls: the system still asks the user (NSMicrophoneUsageDescription).
        decisionHandler(type == .microphone ? .grant : .deny)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url { UIApplication.shared.open(url) }
        return nil
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = UIAlertController(title: "NekoChat Reloaded", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: "NekoChat Reloaded", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        present(alert, animated: true)
    }

    // MARK: - WKNavigationDelegate

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        // Links to the outside world open in Safari, never inside the app shell.
        if navigationAction.navigationType == .linkActivated, let url = navigationAction.request.url, url.scheme != Self.scheme {
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        // iOS may kill the web process while the app is in the background.
        loadHost()
    }
}
