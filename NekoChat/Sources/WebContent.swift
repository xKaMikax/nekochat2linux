import Foundation
import WebKit

/// Serves the desktop web UI at nekochat://app/ with the same layout as the repository
/// root (assets/, prebuilt/), so `<base href="../../">` in the desktop HTML keeps working.
///
/// - `/assets/...`, `/prebuilt/...`, `/ios/...` come from the app bundle (`web/`).
/// - `/user-themes/<id>/...` are themes installed from the catalog or imported by the user.
/// - `/runtime-themes/<id>/...` are msstyles themes rendered on the device.
///
/// Every theme.css gets its url(...) references made absolute, like main.js does on PC.
final class WebContent: NSObject, WKURLSchemeHandler {
    private let themes: ThemeManager
    private let webRoot = Bundle.main.resourceURL!.appendingPathComponent("web", isDirectory: true)

    init(themes: ThemeManager) {
        self.themes = themes
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else { return }
        let path = url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard !path.split(separator: "/").contains(".."), let file = resolve(path), var data = try? Data(contentsOf: file) else {
            respond(urlSchemeTask, url: url, status: 404, headers: ["Content-Type": "text/plain"], body: Data())
            return
        }
        if file.lastPathComponent.lowercased() == "theme.css", let css = String(data: data, encoding: .utf8) {
            let directory = "\(WebViewController.origin)/\(path.split(separator: "/").dropLast().joined(separator: "/"))"
            data = Data(Self.absolutizeThemeCss(css, directoryUrl: directory).utf8)
        }
        var headers = ["Content-Type": Self.mimeType(path), "Cache-Control": "no-cache", "Access-Control-Allow-Origin": "*", "Accept-Ranges": "bytes"]
        // <audio> goes through AVFoundation, which asks for byte ranges.
        if let range = urlSchemeTask.request.value(forHTTPHeaderField: "Range"), let (start, end) = Self.byteRange(range, length: data.count) {
            headers["Content-Range"] = "bytes \(start)-\(end)/\(data.count)"
            headers["Content-Length"] = String(end - start + 1)
            respond(urlSchemeTask, url: url, status: 206, headers: headers, body: data.subdata(in: start..<(end + 1)))
            return
        }
        headers["Content-Length"] = String(data.count)
        respond(urlSchemeTask, url: url, status: 200, headers: headers, body: data)
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}

    private func resolve(_ path: String) -> URL? {
        let file: URL
        if path.hasPrefix("user-themes/") {
            file = themes.userThemesRoot.appendingPathComponent(String(path.dropFirst("user-themes/".count)))
        } else if path.hasPrefix("runtime-themes/") {
            file = themes.runtimeThemesRoot.appendingPathComponent(String(path.dropFirst("runtime-themes/".count)))
        } else {
            file = webRoot.appendingPathComponent(path)
        }
        var isDirectory: ObjCBool = false
        return FileManager.default.fileExists(atPath: file.path, isDirectory: &isDirectory) && !isDirectory.boolValue ? file : nil
    }

    private func respond(_ task: WKURLSchemeTask, url: URL, status: Int, headers: [String: String], body: Data) {
        let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
        task.didReceive(response)
        task.didReceive(body)
        task.didFinish()
    }

    private static func byteRange(_ header: String, length: Int) -> (Int, Int)? {
        guard length > 0, header.hasPrefix("bytes=") else { return nil }
        let parts = header.dropFirst("bytes=".count).split(separator: ",")[0].split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count == 2 else { return nil }
        if parts[0].isEmpty, let suffix = Int(parts[1]) { return (max(0, length - suffix), length - 1) }
        guard let start = Int(parts[0]), start < length else { return nil }
        let end = Int(parts[1]).map { min($0, length - 1) } ?? length - 1
        return end >= start ? (start, end) : nil
    }

    private static let cssUrl = try! NSRegularExpression(pattern: #"url\(\s*(["']?)([^"')]+)\1\s*\)"#)

    /// CSS custom properties resolve url(...) in the stylesheet that consumes them, so
    /// every theme asset URL must be absolute. Assets are looked up by basename next to
    /// the stylesheet (prebuilt CSS contains file:// paths from the PC build).
    static func absolutizeThemeCss(_ css: String, directoryUrl: String) -> String {
        let source = css as NSString
        var result = ""
        var last = 0
        for match in cssUrl.matches(in: css, range: NSRange(location: 0, length: source.length)) {
            result += source.substring(with: NSRange(location: last, length: match.range.location - last))
            let url = source.substring(with: match.range(at: 2)).trimmingCharacters(in: .whitespaces)
            if ["data:", "http:", "https:", "#", "\(WebViewController.scheme):"].contains(where: { url.hasPrefix($0) }) {
                result += source.substring(with: match.range)
            } else {
                result += "url(\"\(directoryUrl)/\(url.split(separator: "/").last.map(String.init) ?? url)\")"
            }
            last = match.range.location + match.range.length
        }
        result += source.substring(from: last)
        return result
    }

    static func mimeType(_ path: String) -> String {
        switch (path as NSString).pathExtension.lowercased() {
        case "html", "htm": return "text/html; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "json": return "application/json; charset=utf-8"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "gif": return "image/gif"
        case "webp": return "image/webp"
        case "svg": return "image/svg+xml"
        case "ico": return "image/x-icon"
        case "wav": return "audio/wav"
        case "mp3": return "audio/mpeg"
        case "ogg": return "audio/ogg"
        case "woff": return "font/woff"
        case "woff2": return "font/woff2"
        case "ttf": return "font/ttf"
        case "md", "txt": return "text/plain; charset=utf-8"
        default: return "application/octet-stream"
        }
    }
}
