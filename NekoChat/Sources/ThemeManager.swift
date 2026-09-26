import Foundation

struct ThemeError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

/// Swift port of the theme system in main.js (same as ThemeManager.kt on Android):
/// built-in prebuilt themes from the bundle, user themes (catalog / import) and on-device
/// msstyles rendering (MsStylesImporter). All methods are blocking: call them off the main thread.
final class ThemeManager {
    static let catalogRoot = "https://raw.githubusercontent.com/xKaMikax/nekochat_reloaded_themes/main"
    private static let reservedIds: Set<String> = ["Current", "Luna", "Embedded", "Royale"]

    let userThemesRoot: URL
    let runtimeThemesRoot: URL
    private let prebuiltRoot = Bundle.main.resourceURL!.appendingPathComponent("web/prebuilt", isDirectory: true)
    private let themeStateFile: URL
    private let displayStateFile: URL
    private let files = FileManager.default
    private let lock = NSLock()

    private(set) var activeTheme: [String: Any]?
    private(set) var activeDisplay: [String: Any] = ["language": "ru", "loginUi": "xp", "micDeviceId": "", "noiseSuppression": "webrtc"]

    private struct Theme {
        let id: String
        let prebuilt: Bool
        var source: URL?
        var css = false
        var userInstalled = false
        var catalogId: String?
    }

    private struct Prepared {
        let theme: Theme
        let baseUrl: String
        let metadata: [String: Any]
        let css: Bool
    }

    init() {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        userThemesRoot = support.appendingPathComponent("themes", isDirectory: true)
        runtimeThemesRoot = support.appendingPathComponent("runtime-themes", isDirectory: true)
        themeStateFile = support.appendingPathComponent("theme-selection.json")
        displayStateFile = support.appendingPathComponent("display-settings.json")
        try? FileManager.default.createDirectory(at: userThemesRoot, withIntermediateDirectories: true)
        try? FileManager.default.createDirectory(at: runtimeThemesRoot, withIntermediateDirectories: true)
    }

    func load() {
        if let saved = readJSON(displayStateFile) as? [String: Any] { activeDisplay.merge(saved) { _, new in new } }
        var saved = readJSON(themeStateFile) as? [String: Any] ?? ["id": "Classic"]
        if (saved["id"] as? String)?.lowercased() == "aero" { saved = ["id": "Classic", "scheme": "classic"] }
        do { _ = try activateTheme(id: saved["id"] as? String ?? "Classic", requestedScheme: (saved["scheme"] as? String).flatMap { $0.isEmpty ? nil : $0 }) }
        catch { _ = try? activateTheme(id: "Classic", requestedScheme: "classic") }
    }

    func saveDisplaySettings(_ settings: [String: Any]) throws -> [String: Any] {
        activeDisplay = [
            "language": settings["language"] as? String == "en" ? "en" : "ru",
            "loginUi": settings["loginUi"] as? String == "classic" ? "classic" : "xp",
            "micDeviceId": settings["micDeviceId"] as? String ?? "",
            "noiseSuppression": ["off", "rnnoise"].contains(settings["noiseSuppression"] as? String ?? "") ? settings["noiseSuppression"] as! String : "webrtc",
        ]
        try writeJSON(activeDisplay, to: displayStateFile)
        return activeDisplay
    }

    // MARK: - Discovery

    private func discoverThemes() -> [Theme] {
        var found: [Theme] = []
        let prebuilt = (try? files.contentsOfDirectory(atPath: prebuiltRoot.path)) ?? []
        for id in prebuilt.sorted() where files.fileExists(atPath: prebuiltRoot.appendingPathComponent("\(id)/theme.json").path) {
            found.append(Theme(id: id, prebuilt: true))
        }
        let user = (try? files.contentsOfDirectory(at: userThemesRoot, includingPropertiesForKeys: [.isDirectoryKey])) ?? []
        for directory in user.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) {
            guard (try? directory.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory == true, !Self.reservedIds.contains(directory.lastPathComponent) else { continue }
            let names = ((try? files.contentsOfDirectory(atPath: directory.path)) ?? []).sorted()
            guard let source = names.first(where: { $0.lowercased().hasSuffix(".theme") })
                    ?? names.first(where: { $0.lowercased().hasSuffix(".msstyles") })
                    ?? names.first(where: { $0.lowercased() == "theme.css" }) else { continue }
            let catalogId = (readJSON(directory.appendingPathComponent("catalog-theme.json")) as? [String: Any])?["id"] as? String
            let id = directory.lastPathComponent
            found.removeAll { $0.id == id }
            found.append(Theme(id: id, prebuilt: false, source: directory.appendingPathComponent(source), css: source.lowercased() == "theme.css", userInstalled: true, catalogId: catalogId))
        }
        return found
    }

    private func prepareTheme(_ id: String) throws -> Prepared {
        guard let theme = discoverThemes().first(where: { $0.id == id }) else { throw ThemeError("Theme not found") }
        if theme.prebuilt {
            guard let metadata = readJSON(prebuiltRoot.appendingPathComponent("\(id)/theme.json")) as? [String: Any] else { throw ThemeError("Theme not found") }
            return Prepared(theme: theme, baseUrl: "\(WebViewController.origin)/prebuilt/\(Self.encode(id))", metadata: metadata, css: false)
        }
        let source = theme.source!
        if theme.css {
            let metadata: [String: Any] = ["theme": id, "schemes": [["id": "default", "name": "Default"]], "defaultScheme": "default"]
            return Prepared(theme: theme, baseUrl: "\(WebViewController.origin)/user-themes/\(Self.encode(id))", metadata: metadata, css: true)
        }
        let output = runtimeThemesRoot.appendingPathComponent(id, isDirectory: true)
        let attributes = try files.attributesOfItem(atPath: source.path)
        let modified = (attributes[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0
        let stamp = "\(modified):\((attributes[.size] as? NSNumber)?.intValue ?? 0):\(MsStylesImporter.version)"
        if (readJSON(output.appendingPathComponent(".cache.json")) as? [String: Any])?["stamp"] as? String != stamp {
            try? files.removeItem(at: output)
            try MsStylesImporter.importTheme(source: source, output: output, assetUrl: "\(WebViewController.origin)/runtime-themes/\(Self.encode(id))")
            try writeJSON(["stamp": stamp], to: output.appendingPathComponent(".cache.json"))
        }
        guard let metadata = readJSON(output.appendingPathComponent("theme.json")) as? [String: Any] else { throw ThemeError("Theme not found") }
        return Prepared(theme: theme, baseUrl: "\(WebViewController.origin)/runtime-themes/\(Self.encode(id))", metadata: metadata, css: false)
    }

    private func cssUrl(_ prepared: Prepared, scheme: String, revision: Int64) -> String {
        let directory = prepared.css ? prepared.baseUrl : "\(prepared.baseUrl)/schemes/\(Self.encode(scheme))"
        return "\(directory)/theme.css?theme=\(revision)"
    }

    private func hasScheme(_ metadata: [String: Any], _ scheme: String) -> Bool {
        (metadata["schemes"] as? [[String: Any]])?.contains { $0["id"] as? String == scheme } ?? false
    }

    private static func now() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }

    // MARK: - Public API (mirrors ipcMain handlers)

    func listThemes() throws -> [[String: Any]] {
        lock.lock(); defer { lock.unlock() }
        return listThemesLocked()
    }

    private func listThemesLocked() -> [[String: Any]] {
        discoverThemes().compactMap { theme -> [String: Any]? in
            guard let prepared = try? prepareTheme(theme.id) else { return nil }
            var name = prepared.metadata["theme"] as? String ?? theme.id
            if name.isEmpty { name = theme.id }
            name = name.replacingOccurrences(of: #"\.(theme|msstyles)$"#, with: "", options: [.regularExpression, .caseInsensitive])
            return ["id": theme.id, "name": name, "schemes": prepared.metadata["schemes"] ?? [], "removable": theme.userInstalled, "catalogId": theme.catalogId ?? NSNull()]
        }
    }

    func previewTheme(id: String, scheme: String?) throws -> [String: Any] {
        lock.lock(); defer { lock.unlock() }
        let prepared = try prepareTheme(id)
        let active = scheme ?? prepared.metadata["defaultScheme"] as? String ?? ""
        let revision = Self.now()
        return ["id": id, "scheme": active, "revision": revision, "cssUrl": cssUrl(prepared, scheme: active, revision: revision)]
    }

    func activateTheme(id: String, requestedScheme: String?) throws -> [String: Any] {
        lock.lock(); defer { lock.unlock() }
        return try activateThemeLocked(id: id, requestedScheme: requestedScheme)
    }

    private func activateThemeLocked(id: String, requestedScheme: String?) throws -> [String: Any] {
        guard id.range(of: #"^[a-zA-Z0-9._ -]+$"#, options: .regularExpression) != nil,
              requestedScheme.map({ $0.range(of: #"^[a-zA-Z0-9._-]+$"#, options: .regularExpression) != nil }) ?? true else { throw ThemeError("Invalid theme name") }
        let prepared = try prepareTheme(id)
        let scheme = requestedScheme ?? prepared.metadata["defaultScheme"] as? String ?? ""
        guard hasScheme(prepared.metadata, scheme) else { throw ThemeError("Unknown colour scheme") }
        let revision = Self.now()
        let theme: [String: Any] = ["id": id, "scheme": scheme, "revision": revision, "cssUrl": cssUrl(prepared, scheme: scheme, revision: revision)]
        activeTheme = theme
        try writeJSON(["id": id, "scheme": scheme], to: themeStateFile)
        return theme
    }

    func removeTheme(id: String) throws -> [String: Any] {
        lock.lock(); defer { lock.unlock() }
        guard let theme = discoverThemes().first(where: { $0.id == id }), theme.userInstalled else { throw ThemeError("Built-in themes cannot be removed.") }
        if activeTheme?["id"] as? String == id { _ = try activateThemeLocked(id: "Classic", requestedScheme: "classic") }
        let directory = userThemesRoot.appendingPathComponent(id, isDirectory: true).standardizedFileURL
        guard directory.deletingLastPathComponent().path == userThemesRoot.standardizedFileURL.path else { throw ThemeError("Invalid theme location.") }
        try? files.removeItem(at: directory)
        try? files.removeItem(at: runtimeThemesRoot.appendingPathComponent(id))
        return ["themes": listThemesLocked(), "activeTheme": activeTheme ?? NSNull()]
    }

    /// Imports a user-picked file: .msstyles, .theme, theme.css or a .zip bundle.
    func importTheme(fileName: String, data: Data) throws -> [String: Any] {
        lock.lock(); defer { lock.unlock() }
        let stem = (fileName as NSString).deletingPathExtension
        var base = String(stem.replacingOccurrences(of: #"[^a-zA-Z0-9._ -]"#, with: "_", options: .regularExpression).prefix(60))
        if base.isEmpty { base = "Custom-theme" }
        let destination = userThemesRoot.appendingPathComponent("\(base)-\(Self.now())", isDirectory: true)
        let lower = fileName.lowercased()
        do {
            if lower.hasSuffix(".zip") {
                try installBundle(data, destination: destination)
            } else if lower.hasSuffix(".css") {
                try files.createDirectory(at: destination, withIntermediateDirectories: true)
                try data.write(to: destination.appendingPathComponent("theme.css"))
            } else if lower.hasSuffix(".msstyles") || lower.hasSuffix(".theme") {
                try files.createDirectory(at: destination, withIntermediateDirectories: true)
                try data.write(to: destination.appendingPathComponent(fileName.replacingOccurrences(of: "/", with: "_")))
            } else {
                throw ThemeError("Выберите файл .msstyles, .theme, theme.css или .zip с темой.")
            }
            let id = destination.lastPathComponent
            let prepared = try prepareTheme(id)
            let scheme = prepared.metadata["defaultScheme"] as? String ?? ""
            let revision = Self.now()
            return ["themes": listThemesLocked(), "id": id, "scheme": scheme, "revision": revision, "cssUrl": cssUrl(prepared, scheme: scheme, revision: revision)]
        } catch {
            try? files.removeItem(at: destination)
            try? files.removeItem(at: runtimeThemesRoot.appendingPathComponent(destination.lastPathComponent))
            throw error
        }
    }

    // MARK: - Catalog

    private func catalogEntries(_ manifest: Any) -> [[String: Any]] {
        var entries: [[String: Any]] = []
        if let array = manifest as? [Any] {
            entries = array.map { $0 as? [String: Any] ?? [:] }
        } else if let object = manifest as? [String: Any], let themes = object["themes"] as? [Any] {
            entries = themes.map { $0 as? [String: Any] ?? [:] }
        } else if let object = manifest as? [String: Any] {
            entries = object.keys.sorted().map { key -> [String: Any] in var entry = object[key] as? [String: Any] ?? [:]; entry["theme_id"] = key; return entry }
        }
        return entries.enumerated().map { (index, entry) -> [String: Any] in
            func pick(_ keys: String...) -> String? {
                for key in keys { if let value = entry[key], !(value is NSNull) { let text = "\(value)"; if !text.isEmpty { return text } } }
                return nil
            }
            let details = entry["Details"] as? [String: Any] ?? entry["details"] as? [String: Any] ?? [:]
            func detail(_ keys: String...) -> String? { keys.lazy.compactMap { details[$0] as? String }.first { !$0.isEmpty } }
            let themeId = pick("theme_id", "id") ?? "theme-\(index + 1)"
            let directory = (pick("directory") ?? themeId).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            let schemes = entry["ColorSchemes"] ?? entry["ColorShemas"] ?? entry["colorSchemes"] ?? []
            return [
                "id": themeId, "directory": directory,
                "displayName": pick("DisplayName", "displayName") ?? themeId,
                "colorSchemes": schemes,
                "type": detail("Type", "type") ?? pick("Type", "type") ?? "WindowsThemeFile",
                "author": detail("Author", "author") ?? pick("Author", "author") ?? "Unknown",
                "version": detail("Version", "version") ?? pick("Version", "version") ?? "Unknown",
                "previewUrl": pick("Preview", "preview") ?? "\(Self.catalogRoot)/\(directory)/Preview.png",
                "descriptionUrl": pick("Description", "description") ?? "\(Self.catalogRoot)/\(directory)/Description.md",
                "detailsUrl": pick("DetailsFile", "detailsFile") ?? "\(Self.catalogRoot)/\(directory)/Details.json",
                "zipUrl": pick("ThemeZIP", "themeZip") ?? "\(Self.catalogRoot)/\(directory)/Theme.ZIP",
            ]
        }
    }

    func fetchCatalog() throws -> [[String: Any]] {
        let (status, body) = try Self.download("\(Self.catalogRoot)/themes.json")
        guard (200..<300).contains(status) else { throw ThemeError(status == 404 ? "Theme catalog has not been published yet." : "Unable to load theme catalog (\(status)).") }
        return catalogEntries(try JSONSerialization.jsonObject(with: body))
    }

    private func catalogItem(_ id: String) throws -> [String: Any] {
        guard let item = try fetchCatalog().first(where: { $0["id"] as? String == id }) else { throw ThemeError("Theme no longer exists in the catalog.") }
        return item
    }

    func fetchCatalogThemeDetails(id: String) throws -> [String: Any] {
        var item = try catalogItem(id)
        var description = ""
        if let url = item["descriptionUrl"] as? String, let downloaded = try? Self.download(url), (200..<300).contains(downloaded.0) {
            description = String(data: downloaded.1, encoding: .utf8) ?? ""
        }
        item["description"] = description
        return item
    }

    func installCatalogTheme(id: String) throws -> [String: Any] {
        let item = try catalogItem(id)
        let (status, zip) = try Self.download(item["zipUrl"] as? String ?? "")
        guard (200..<300).contains(status) else { throw ThemeError("Unable to download Theme.ZIP (\(status)).") }
        lock.lock(); defer { lock.unlock() }
        let itemId = item["id"] as? String ?? id
        let safe = itemId.replacingOccurrences(of: #"[^a-zA-Z0-9._-]"#, with: "_", options: .regularExpression)
        let destination = userThemesRoot.appendingPathComponent("\(safe)-\(Self.now())", isDirectory: true)
        do {
            try installBundle(zip, destination: destination)
            try writeJSON(["id": itemId], to: destination.appendingPathComponent("catalog-theme.json"))
            return ["id": destination.lastPathComponent, "themes": listThemesLocked()]
        } catch {
            try? files.removeItem(at: destination)
            throw error
        }
    }

    /// Extracts a Theme.ZIP and keeps only what the theme needs, like installCatalogTheme() in main.js.
    private func installBundle(_ zip: Data, destination: URL) throws {
        let temporary = files.temporaryDirectory.appendingPathComponent("theme-\(UUID().uuidString)", isDirectory: true)
        defer { try? files.removeItem(at: temporary) }
        try ZipReader.extract(zip, to: temporary)
        guard let source = findThemeSource(temporary) else { throw ThemeError("Theme.ZIP must contain a .theme, .msstyles, or theme.css file.") }
        try files.createDirectory(at: destination, withIntermediateDirectories: true)
        let sourceRoot = source.deletingLastPathComponent()
        let copyAll = source.lastPathComponent.lowercased() == "theme.css"
        let enumerator = files.enumerator(at: sourceRoot, includingPropertiesForKeys: [.isRegularFileKey])
        while let file = enumerator?.nextObject() as? URL {
            guard (try? file.resourceValues(forKeys: [.isRegularFileKey]))?.isRegularFile == true else { continue }
            if !copyAll && file.lastPathComponent.range(of: #"\.(theme|msstyles|dll|mui)$"#, options: [.regularExpression, .caseInsensitive]) == nil { continue }
            let relative = String(file.standardizedFileURL.path.dropFirst(sourceRoot.standardizedFileURL.path.count)).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            let target = destination.appendingPathComponent(relative)
            try files.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? files.removeItem(at: target)
            try files.copyItem(at: file, to: target)
        }
    }

    private func findThemeSource(_ root: URL) -> URL? {
        let entries = ((try? files.contentsOfDirectory(at: root, includingPropertiesForKeys: [.isDirectoryKey])) ?? []).sorted { $0.lastPathComponent < $1.lastPathComponent }
        for entry in entries {
            if (try? entry.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory == true {
                if let found = findThemeSource(entry) { return found }
                continue
            }
            let name = entry.lastPathComponent.lowercased()
            if name.hasSuffix(".theme") || name.hasSuffix(".msstyles") || name == "theme.css" { return entry }
        }
        return nil
    }

    // MARK: - Helpers

    private static func encode(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/"))) ?? value
    }

    private func readJSON(_ url: URL) -> Any? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONSerialization.jsonObject(with: data)
    }

    private func writeJSON(_ value: Any, to url: URL) throws {
        try files.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONSerialization.data(withJSONObject: value).write(to: url)
    }

    static func download(_ url: String) throws -> (Int, Data) {
        guard let target = URL(string: url) else { throw ThemeError("Invalid URL: \(url)") }
        var request = URLRequest(url: target)
        request.timeoutInterval = 30
        let semaphore = DispatchSemaphore(value: 0)
        var result: Result<(Int, Data), Error> = .failure(ThemeError("Download failed"))
        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error { result = .failure(error) }
            else { result = .success(((response as? HTTPURLResponse)?.statusCode ?? 0, data ?? Data())) }
            semaphore.signal()
        }.resume()
        semaphore.wait()
        return try result.get()
    }
}
