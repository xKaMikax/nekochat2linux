import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// Swift port of tools/import_msstyles.py (the same as MsStylesImporter.kt on Android).
/// Produces the same theme.json / theme.css / PNG layout as the PC importer.
enum MsStylesImporter {
    static let version = 1

    // MARK: - Images (straight, non-premultiplied RGBA)

    struct Image {
        let width: Int
        let height: Int
        var pixels: [UInt8]

        init(width: Int, height: Int, pixels: [UInt8]? = nil) {
            self.width = width
            self.height = height
            self.pixels = pixels ?? [UInt8](repeating: 0, count: width * height * 4)
        }

        func crop(_ left: Int, _ top: Int, _ right: Int, _ bottom: Int) -> Image {
            let l = min(max(0, left), width), t = min(max(0, top), height)
            let r = min(max(l, right), width), b = min(max(t, bottom), height)
            guard r > l, b > t else { return Image(width: 1, height: 1) }
            var result = Image(width: r - l, height: b - t)
            for y in 0..<(b - t) {
                let source = ((t + y) * width + l) * 4
                result.pixels.replaceSubrange((y * result.width * 4)..<((y + 1) * result.width * 4), with: pixels[source..<(source + result.width * 4)])
            }
            return result
        }

        /// Pillow's alpha_composite: draws [other] over this image at (x, y).
        mutating func composite(_ other: Image, x: Int, y: Int) {
            for row in 0..<other.height {
                for column in 0..<other.width {
                    let tx = x + column, ty = y + row
                    guard tx >= 0, ty >= 0, tx < width, ty < height else { continue }
                    let s = (row * other.width + column) * 4, d = (ty * width + tx) * 4
                    let sa = Double(other.pixels[s + 3]) / 255, da = Double(pixels[d + 3]) / 255
                    let oa = sa + da * (1 - sa)
                    guard oa > 0 else { continue }
                    for channel in 0..<3 {
                        let value = (Double(other.pixels[s + channel]) * sa + Double(pixels[d + channel]) * da * (1 - sa)) / oa
                        pixels[d + channel] = UInt8(max(0, min(255, value.rounded())))
                    }
                    pixels[d + 3] = UInt8(max(0, min(255, (oa * 255).rounded())))
                }
            }
        }

        var cgImage: CGImage? {
            guard let provider = CGDataProvider(data: Data(pixels) as CFData) else { return nil }
            return CGImage(width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: width * 4,
                           space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.last.rawValue),
                           provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent)
        }

        init?(cgImage: CGImage) {
            let width = cgImage.width, height = cgImage.height
            var buffer = [UInt8](repeating: 0, count: width * height * 4)
            let drawn: Bool = buffer.withUnsafeMutableBytes { raw in
                guard let context = CGContext(data: raw.baseAddress, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
                                              space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
                context.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))
                return true
            }
            guard drawn else { return nil }
            for index in stride(from: 0, to: buffer.count, by: 4) {
                let alpha = Int(buffer[index + 3])
                guard alpha > 0, alpha < 255 else { continue }
                for channel in 0..<3 { buffer[index + channel] = UInt8(min(255, Int(buffer[index + channel]) * 255 / alpha)) }
            }
            self.init(width: width, height: height, pixels: buffer)
        }
    }

    private static func save(_ image: Image, _ output: URL, _ name: String) throws {
        guard let cgImage = image.cgImage else { throw ThemeError("Cannot encode \(name)") }
        try writePNG(cgImage, to: output.appendingPathComponent(name))
    }

    private static func writePNG(_ image: CGImage, to url: URL) throws {
        guard let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else { throw ThemeError("Cannot write \(url.lastPathComponent)") }
        CGImageDestinationAddImage(destination, image, nil)
        guard CGImageDestinationFinalize(destination) else { throw ThemeError("Cannot write \(url.lastPathComponent)") }
    }

    private static func decodeImage(_ data: Data) -> CGImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        return CGImageSourceCreateImageAtIndex(source, 0, nil)
    }

    // MARK: - PE resources

    private final class PeFile {
        struct Node { let id: Int?; let name: String?; let offset: Int; let isDirectory: Bool }
        private let bytes: [UInt8]
        private var sections: [(address: Int, virtualSize: Int, raw: Int, rawSize: Int)] = []
        private var resourceOffset = -1

        init(_ data: Data) throws {
            bytes = [UInt8](data)
            guard bytes.count > 0x40, u16(0) == 0x5A4D else { throw ThemeError("Not a PE file") }
            let pe = u32(0x3C)
            guard pe + 24 < bytes.count, u32(pe) == 0x00004550 else { throw ThemeError("Not a PE file") }
            let sectionCount = u16(pe + 6)
            let optionalSize = u16(pe + 20)
            let optional = pe + 24
            let directories = optional + (u16(optional) == 0x20B ? 112 : 96)
            let resourceRva = u32(directories + 2 * 8)
            var section = optional + optionalSize
            for _ in 0..<sectionCount {
                sections.append((u32(section + 12), u32(section + 8), u32(section + 20), u32(section + 16)))
                section += 40
            }
            resourceOffset = resourceRva == 0 ? -1 : rvaToOffset(resourceRva)
        }

        func u16(_ offset: Int) -> Int { Int(bytes[offset]) | Int(bytes[offset + 1]) << 8 }
        func u32(_ offset: Int) -> Int { u16(offset) | u16(offset + 2) << 16 }

        func rvaToOffset(_ rva: Int) -> Int {
            for section in sections where rva >= section.address && rva < section.address + max(section.virtualSize, section.rawSize) {
                return rva - section.address + section.raw
            }
            return rva
        }

        func children(_ directoryOffset: Int = 0) -> [Node] {
            guard resourceOffset >= 0 else { return [] }
            let base = resourceOffset + directoryOffset
            let count = u16(base + 12) + u16(base + 14)
            return (0..<count).map { index in
                let entry = base + 16 + index * 8
                let nameField = u32(entry)
                let target = u32(entry + 4)
                let named = nameField & 0x8000_0000 != 0
                var name: String?
                if named {
                    let at = resourceOffset + (nameField & 0x7FFF_FFFF)
                    let length = u16(at)
                    let units = (0..<length).map { UInt16(u16(at + 2 + $0 * 2)) }
                    name = String(decoding: units, as: UTF16.self)
                }
                return Node(id: named ? nil : nameField & 0xFFFF, name: name, offset: target & 0x7FFF_FFFF, isDirectory: target & 0x8000_0000 != 0)
            }
        }

        /// Follows the first child until a data entry is reached (name → language → data).
        func leafData(_ node: Node) -> Data? {
            var current = node
            while current.isDirectory {
                guard let first = children(current.offset).first else { return nil }
                current = first
            }
            let entry = resourceOffset + current.offset
            let offset = rvaToOffset(u32(entry)), size = u32(entry + 4)
            guard offset >= 0, offset + size <= bytes.count else { return nil }
            return Data(bytes[offset..<(offset + size)])
        }
    }

    // MARK: - DIB decoding (decode_dib)

    private static func decodeDib(_ data: Data, preserveAlpha: Bool) -> Image? {
        let bytes = [UInt8](data)
        guard bytes.count >= 16 else { return nil }
        func u16(_ o: Int) -> Int { Int(bytes[o]) | Int(bytes[o + 1]) << 8 }
        func u32(_ o: Int) -> Int { u16(o) | u16(o + 2) << 16 }
        func s32(_ o: Int) -> Int { Int(Int32(truncatingIfNeeded: u32(o))) }
        let headerSize = u32(0)
        let width = s32(4), rawHeight = s32(8)
        let bpp = u16(14)
        let compression = headerSize >= 20 ? u32(16) : 0
        var colours = headerSize >= 36 ? u32(32) : 0
        if colours == 0 && bpp <= 8 { colours = 1 << bpp }
        let height = abs(rawHeight)
        let bottomUp = rawHeight > 0
        let masksSize = compression == 3 && headerSize == 40 ? 12 : 0
        let pixelOffset = headerSize + masksSize + colours * 4
        var image: Image
        if width > 0, height > 0, compression == 0 || (compression == 3 && bpp == 32), [1, 4, 8, 24, 32].contains(bpp) {
            let stride = ((width * bpp + 31) / 32) * 4
            guard pixelOffset + stride * height <= bytes.count else { return nil }
            let palette: [(UInt8, UInt8, UInt8)] = bpp <= 8 ? (0..<colours).map { index in
                let at = headerSize + masksSize + index * 4
                return (bytes[at + 2], bytes[at + 1], bytes[at])
            } : []
            image = Image(width: width, height: height)
            for y in 0..<height {
                let row = pixelOffset + (bottomUp ? height - 1 - y : y) * stride
                for x in 0..<width {
                    var r: UInt8 = 0, g: UInt8 = 0, b: UInt8 = 0, a: UInt8 = 255
                    switch bpp {
                    case 32:
                        let at = row + x * 4
                        (b, g, r) = (bytes[at], bytes[at + 1], bytes[at + 2])
                        // Pillow drops the fourth byte; in msstyles it is the real alpha of glyphs.
                        if preserveAlpha { a = bytes[at + 3] }
                    case 24:
                        let at = row + x * 3
                        (b, g, r) = (bytes[at], bytes[at + 1], bytes[at + 2])
                    default:
                        let index: Int
                        switch bpp {
                        case 8: index = Int(bytes[row + x])
                        case 4: index = Int(bytes[row + x / 2] >> (x % 2 == 0 ? 4 : 0)) & 0x0F
                        default: index = Int(bytes[row + x / 8] >> (7 - x % 8)) & 1
                        }
                        if index < palette.count { (r, g, b) = palette[index] }
                    }
                    let at = (y * width + x) * 4
                    image.pixels[at] = r; image.pixels[at + 1] = g; image.pixels[at + 2] = b; image.pixels[at + 3] = a
                }
            }
        } else {
            // RLE and other rare formats: let ImageIO decode a synthesized .bmp file.
            // BITMAPFILEHEADER: "BM", file size, two reserved words, pixel data offset.
            var file = Data([0x42, 0x4D])
            withUnsafeBytes(of: UInt32(14 + bytes.count).littleEndian) { file.append(contentsOf: $0) }
            file.append(contentsOf: [0, 0, 0, 0])
            withUnsafeBytes(of: UInt32(14 + pixelOffset).littleEndian) { file.append(contentsOf: $0) }
            file.append(contentsOf: bytes)
            guard let decoded = decodeImage(file), let converted = Image(cgImage: decoded) else { return nil }
            image = converted
            for index in stride(from: 3, to: image.pixels.count, by: 4) { image.pixels[index] = 255 }
        }
        // Magenta is the transparent key colour in msstyles bitmaps.
        for index in stride(from: 0, to: image.pixels.count, by: 4) where image.pixels[index] > 245 && image.pixels[index + 1] < 12 && image.pixels[index + 2] > 245 {
            image.pixels[index + 3] = 0
        }
        return image
    }

    private static func bitmaps(_ pe: PeFile) -> [(String, Image)] {
        guard let root = pe.children().first(where: { $0.name == nil && $0.id == 2 }) else { return [] }
        return pe.children(root.offset).compactMap { entry -> (String, Image)? in
            let name = entry.name ?? String(entry.id ?? 0)
            guard let data = pe.leafData(entry), let image = decodeDib(data, preserveAlpha: name.uppercased().hasSuffix("GLYPH_BMP")) else { return nil }
            return (name, image)
        }
    }

    private static func namedPng(_ pe: PeFile, type: String, id: Int) -> Data? {
        guard let root = pe.children().first(where: { $0.name == type }),
              let item = pe.children(root.offset).first(where: { $0.id == id }),
              let data = pe.leafData(item), data.starts(with: [0x89, 0x50, 0x4E, 0x47]) else { return nil }
        return data
    }

    // MARK: - Sprite helpers

    private static func find(_ images: [(String, Image)], _ suffix: String, _ prefix: String = "") throws -> Image {
        guard let match = images.first(where: { entry in
            entry.0.uppercased().hasSuffix(suffix) && (prefix.isEmpty || entry.0.uppercased().hasPrefix(prefix.uppercased() + "_"))
        }) else { throw ThemeError("Missing theme resource \(suffix)") }
        return match.1
    }

    private static func state(_ image: Image, _ index: Int) -> Image {
        let side = image.width
        let rows = max(1, image.height / max(1, side))
        let top = min(index, rows - 1) * side
        return image.crop(0, top, image.width, min(top + side, image.height))
    }

    private static func buttonState(_ image: Image, _ index: Int) -> Image {
        let frameHeight = image.height % 5 == 0 ? image.height / 5 : image.width
        let top = min(index, max(0, image.height / max(1, frameHeight) - 1)) * frameHeight
        return image.crop(0, top, image.width, top + frameHeight)
    }

    private static func stripState(_ image: Image, _ frameHeight: Int, _ index: Int) -> Image {
        let top = min(index, max(0, image.height / frameHeight - 1)) * frameHeight
        return image.crop(0, top, image.width, top + frameHeight)
    }

    // MARK: - .theme (INI)

    private static func readIni(_ file: URL) -> [String: [String: String]] {
        guard let data = try? Data(contentsOf: file) else { return [:] }
        var result: [String: [String: String]] = [:]
        var section = ""
        for raw in (String(data: data, encoding: .isoLatin1) ?? "").components(separatedBy: .newlines) {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.isEmpty || line.hasPrefix(";") || line.hasPrefix("#") { continue }
            if line.hasPrefix("[") && line.hasSuffix("]") { section = String(line.dropFirst().dropLast()).lowercased(); continue }
            guard let separator = line.firstIndex(where: { $0 == "=" || $0 == ":" }), separator != line.startIndex else { continue }
            let key = line[..<separator].trimmingCharacters(in: .whitespaces).lowercased()
            if result[section]?[key] == nil { result[section, default: [:]][key] = line[line.index(after: separator)...].trimmingCharacters(in: .whitespaces) }
        }
        return result
    }

    private static func iniGet(_ ini: [String: [String: String]], _ section: String, _ key: String) -> String? {
        ini[section.lowercased()]?[key.lowercased()]
    }

    private static func isTheme(_ url: URL) -> Bool { url.pathExtension.lowercased() == "theme" }

    private static func resolveTheme(_ source: URL) throws -> URL {
        if source.pathExtension.lowercased() == "msstyles" { return source }
        let path = iniGet(readIni(source), "VisualStyles", "Path") ?? ""
        let filename = path.replacingOccurrences(of: "\\", with: "/").split(separator: "/").last.map(String.init) ?? ""
        var all: [URL] = []
        if let enumerator = FileManager.default.enumerator(at: source.deletingLastPathComponent(), includingPropertiesForKeys: nil) {
            while let file = enumerator.nextObject() as? URL { all.append(file) }
        }
        let candidates = (filename.isEmpty ? [] : all.filter { $0.lastPathComponent.lowercased() == filename.lowercased() }) + all.filter { $0.pathExtension.lowercased() == "msstyles" }
        guard let first = candidates.first else { throw ThemeError("The .theme file has no nearby .msstyles file") }
        return first
    }

    private static func themeColours(_ source: URL) -> [String: String] {
        var colours = ["Window": "#ece9d8", "ButtonFace": "#d4d0c8", "WindowText": "#000000", "Hilight": "#316ac5"]
        guard isTheme(source) else { return colours }
        let ini = readIni(source)
        guard ini["control panel\\colors"] != nil else { return colours }
        for key in Array(colours.keys) {
            let value = (iniGet(ini, "Control Panel\\Colors", key) ?? "").replacingOccurrences(of: ",", with: " ").split(separator: " ").map(String.init)
            if value.count == 3, let r = Int(value[0]), let g = Int(value[1]), let b = Int(value[2]) {
                colours[key] = String(format: "#%02x%02x%02x", r, g, b)
            }
        }
        return colours
    }

    private static func themeDisplayName(_ source: URL, _ msstyles: URL) -> String {
        if isTheme(source) {
            let value = (iniGet(readIni(source), "Theme", "DisplayName") ?? "").trimmingCharacters(in: .whitespaces)
            if !value.isEmpty && !value.hasPrefix("@") { return value }
        }
        let stem = (isTheme(source) ? source : msstyles).deletingPathExtension().lastPathComponent
        return ["aero": "Aero", "aerolite": "Aero Lite"][stem.lowercased()] ?? stem
    }

    private static func isAeroStyle(_ source: URL, _ msstyles: URL) -> Bool {
        ["aero", "aerolite"].contains(source.deletingPathExtension().lastPathComponent.lowercased())
            || ["aero", "aerolite"].contains(msstyles.deletingPathExtension().lastPathComponent.lowercased())
    }

    private static func schemeLabel(_ prefix: String) -> String {
        ["BLUE": "Default (blue)", "HOMESTEAD": "Homestead (green)", "METALLIC": "Metallic (silver)", "DEFAULT": "Default", "ROYALE": "Royale"][prefix.uppercased()]
            ?? prefix.replacingOccurrences(of: "_", with: " ").lowercased().split(separator: " ").map { $0.prefix(1).uppercased() + $0.dropFirst() }.joined(separator: " ")
    }

    private static func sourceScheme(_ source: URL, _ prefixes: [String]) -> String {
        if isTheme(source) {
            var requested = (iniGet(readIni(source), "VisualStyles", "ColorStyle") ?? "NormalColor").uppercased()
            requested = ["NORMALCOLOR": "BLUE", "HOMESTEAD": "HOMESTEAD", "METALLIC": "METALLIC"][requested] ?? requested
            if prefixes.contains(requested) { return requested }
        }
        return prefixes[0]
    }

    // MARK: - Writers

    private static func writeScheme(_ output: URL, _ images: [(String, Image)], _ prefix: String, _ colours: [String: String], _ asset: String) throws {
        try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
        var caption = try find(images, "_FRAMECAPTION_BMP", prefix)
        let capHeight = caption.height / 2
        caption = caption.crop(0, 0, caption.width, capHeight)
        var left = 28, right = 35
        if caption.width <= left + right { left = max(1, caption.width / 4); right = max(1, caption.width / 4) }
        try save(caption.crop(0, 0, left, capHeight), output, "title-left.png")
        try save(caption.crop(left, 0, caption.width - right, capHeight), output, "title-fill.png")
        try save(caption.crop(caption.width - right, 0, caption.width, capHeight), output, "title-right.png")
        try save(try find(images, "_FRAMELEFT_BMP", prefix), output, "frame-left.png")
        try save(try find(images, "_FRAMERIGHT_BMP", prefix), output, "frame-right.png")
        let bottom = try find(images, "_FRAMEBOTTOM_BMP", prefix)
        let bleft = min(5, bottom.width / 3), bright = min(5, bottom.width / 3)
        try save(bottom.crop(0, 0, bleft, bottom.height), output, "bottom-left.png")
        try save(bottom.crop(bleft, 0, bottom.width - bright, bottom.height), output, "bottom-fill.png")
        try save(bottom.crop(bottom.width - bright, 0, bottom.width, bottom.height), output, "bottom-right.png")
        let states = ["normal", "hover", "pressed"]
        for (name, resource) in [("caption", "_CAPTIONBUTTON_BMP"), ("close", "_CLOSEBUTTON_BMP")] {
            let button = try find(images, resource, prefix)
            for (index, stateName) in states.enumerated() { try save(state(button, index), output, "\(name)-\(stateName).png") }
        }
        let button = try find(images, "_BUTTON_BMP", prefix)
        for (index, stateName) in states.enumerated() { try save(buttonState(button, index), output, "button-\(stateName).png") }
        let checkbox = try find(images, "_CHECKBOX13_BMP", prefix)
        for (index, stateName) in [(0, "unchecked-normal"), (1, "unchecked-hover"), (2, "unchecked-pressed"), (4, "checked-normal"), (5, "checked-hover"), (6, "checked-pressed")] {
            try save(state(checkbox, index), output, "checkbox-\(stateName).png")
        }
        try save(try find(images, "_GROUPBOX_BMP", prefix), output, "groupbox.png")
        try save(try find(images, "_FIELDOUTLINEBLUE_BMP", prefix), output, "field-outline.png")
        let arrows = try find(images, "_SCROLLARROWS_BMP", prefix)
        let arrowGlyphs = try find(images, "_SCROLLARROWGLYPHS_BMP", prefix)
        for (direction, index) in [("up", 0), ("down", 4), ("left", 8), ("right", 12)] {
            for (stateIndex, stateName) in states.enumerated() {
                var arrow = state(arrows, index + stateIndex)
                let glyph = state(arrowGlyphs, index + stateIndex)
                arrow.composite(glyph, x: (arrow.width - glyph.width) / 2, y: (arrow.height - glyph.height) / 2)
                try save(arrow, output, "scroll-\(direction)-\(stateName).png")
            }
        }
        try save(state(try find(images, "_SCROLLSHAFTVERTICAL_BMP", prefix), 0), output, "scroll-shaft-vertical.png")
        try save(state(try find(images, "_SCROLLSHAFTHORIZONTAL_BMP", prefix), 0), output, "scroll-shaft-horizontal.png")
        let thumbVertical = try find(images, "_SCROLLTHUMBVERTICAL_BMP", prefix)
        let thumbHorizontal = try find(images, "_SCROLLTHUMBHORIZONTAL_BMP", prefix)
        for (stateIndex, stateName) in states.enumerated() {
            try save(stripState(thumbVertical, 22, stateIndex), output, "scroll-thumb-vertical-\(stateName).png")
            try save(stripState(thumbHorizontal, 20, stateIndex), output, "scroll-thumb-horizontal-\(stateName).png")
        }
        for (name, resource) in [("minimize", "_MINIMIZEGLYPH_BMP"), ("maximize", "_MAXIMIZEGLYPH_BMP"), ("close", "_CLOSEGLYPH_BMP")] {
            let glyph = try find(images, resource, prefix)
            for (index, stateName) in states.enumerated() { try save(state(glyph, index), output, "\(name)-glyph-\(stateName).png") }
        }
        func u(_ name: String) -> String { "url(\"\(asset)/\(name)\")" }
        var css = ":root { --xp-caption-left: \(left)px; --xp-caption-right: \(right)px; --xp-caption-middle: 1px; --xp-caption-height: \(capHeight)px; --xp-bottom-left: \(bleft)px; --xp-bottom-right: \(bright)px; --xp-bottom-middle: 1px; --xp-bottom-height: \(bottom.height)px; "
        css += "--xp-theme-window: \(colours["Window"]!); --xp-theme-buttonface: \(colours["ButtonFace"]!); --xp-theme-windowtext: \(colours["WindowText"]!); --xp-theme-highlight: \(colours["Hilight"]!); "
        css += "--xp-title-fill: \(u("title-fill.png")); --xp-title-left: \(u("title-left.png")); --xp-title-right: \(u("title-right.png")); --xp-frame-left: \(u("frame-left.png")); --xp-frame-right: \(u("frame-right.png")); --xp-bottom-fill: \(u("bottom-fill.png")); --xp-bottom-left-image: \(u("bottom-left.png")); --xp-bottom-right-image: \(u("bottom-right.png")); "
        css += "--xp-caption-normal: \(u("caption-normal.png")); --xp-caption-hover: \(u("caption-hover.png")); --xp-caption-pressed: \(u("caption-pressed.png")); --xp-close-normal: \(u("close-normal.png")); --xp-close-hover: \(u("close-hover.png")); --xp-close-pressed: \(u("close-pressed.png")); "
        css += "--xp-close-glyph: \(u("close-glyph-normal.png")); --xp-close-glyph-hover: \(u("close-glyph-hover.png")); --xp-close-glyph-pressed: \(u("close-glyph-pressed.png")); --xp-minimize-glyph: \(u("minimize-glyph-normal.png")); --xp-minimize-glyph-hover: \(u("minimize-glyph-hover.png")); --xp-minimize-glyph-pressed: \(u("minimize-glyph-pressed.png")); "
        css += "--xp-maximize-glyph: \(u("maximize-glyph-normal.png")); --xp-maximize-glyph-hover: \(u("maximize-glyph-hover.png")); --xp-maximize-glyph-pressed: \(u("maximize-glyph-pressed.png")); --xp-button-normal: \(u("button-normal.png")); --xp-button-hover: \(u("button-hover.png")); --xp-button-pressed: \(u("button-pressed.png")); }\n"
        css += ":root { --xp-checkbox-unchecked: \(u("checkbox-unchecked-normal.png")); --xp-checkbox-unchecked-hover: \(u("checkbox-unchecked-hover.png")); --xp-checkbox-unchecked-pressed: \(u("checkbox-unchecked-pressed.png")); --xp-checkbox-checked: \(u("checkbox-checked-normal.png")); --xp-checkbox-checked-hover: \(u("checkbox-checked-hover.png")); --xp-checkbox-checked-pressed: \(u("checkbox-checked-pressed.png")); --xp-groupbox: \(u("groupbox.png")); --xp-field-outline: \(u("field-outline.png")); }\n"
        css += ":root { "
        for direction in ["up", "down", "left", "right"] {
            css += "--xp-scroll-\(direction): \(u("scroll-\(direction)-normal.png")); --xp-scroll-\(direction)-hover: \(u("scroll-\(direction)-hover.png")); --xp-scroll-\(direction)-pressed: \(u("scroll-\(direction)-pressed.png")); "
        }
        css += "--xp-scroll-shaft-vertical: \(u("scroll-shaft-vertical.png")); --xp-scroll-shaft-horizontal: \(u("scroll-shaft-horizontal.png")); "
        for axis in ["vertical", "horizontal"] {
            css += "--xp-scroll-thumb-\(axis): \(u("scroll-thumb-\(axis)-normal.png")); --xp-scroll-thumb-\(axis)-hover: \(u("scroll-thumb-\(axis)-hover.png")); --xp-scroll-thumb-\(axis)-pressed: \(u("scroll-thumb-\(axis)-pressed.png")); "
        }
        css += "}\n"
        try css.write(to: output.appendingPathComponent("theme.css"), atomically: true, encoding: .utf8)
    }

    private static func writeAeroScheme(_ output: URL, _ pe: PeFile, _ asset: String) throws {
        try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
        for (filename, id) in [("aero-close-strip.png", 936), ("aero-close-glyphs.png", 937)] {
            try namedPng(pe, type: "IMAGE", id: id)?.write(to: output.appendingPathComponent(filename))
        }
        if let raw = namedPng(pe, type: "IMAGE", id: 934), let image = decodeImage(raw) {
            let activeHeight = image.height / 2
            let left = min(16, image.width / 3), right = min(16, image.width / 3)
            for (name, rect) in [("aero-title-left.png", CGRect(x: 0, y: 0, width: left, height: activeHeight)),
                                 ("aero-title-fill.png", CGRect(x: left, y: 0, width: image.width - left - right, height: activeHeight)),
                                 ("aero-title-right.png", CGRect(x: image.width - right, y: 0, width: right, height: activeHeight))] {
                if let slice = image.cropping(to: rect) { try writePNG(slice, to: output.appendingPathComponent(name)) }
            }
        }
        if let raw = namedPng(pe, type: "STREAM", id: 971), let atlas = decodeImage(raw), let reflection = atlas.cropping(to: CGRect(x: 555, y: 0, width: 802, height: 604)) {
            try writePNG(reflection, to: output.appendingPathComponent("aero-glass-reflection.png"))
        }
        try aeroCss.replacingOccurrences(of: "{asset}", with: asset).write(to: output.appendingPathComponent("theme.css"), atomically: true, encoding: .utf8)
    }

    /// import_theme(): renders [source] (.theme or .msstyles) into [output]; [assetUrl] is output's web URL.
    static func importTheme(source: URL, output: URL, assetUrl: String) throws {
        let msstyles = try resolveTheme(source)
        let pe = try PeFile(try Data(contentsOf: msstyles))
        let displayName = themeDisplayName(source, msstyles)
        if isAeroStyle(source, msstyles) {
            let scheme = "normalcolor"
            try writeAeroScheme(output, pe, assetUrl)
            try writeAeroScheme(output.appendingPathComponent("schemes/\(scheme)", isDirectory: true), pe, "\(assetUrl)/schemes/\(scheme)")
            let metadata: [String: Any] = ["theme": displayName, "msstyles": msstyles.lastPathComponent, "schemes": [["id": scheme, "name": "Default (blue)"]], "defaultScheme": scheme]
            try JSONSerialization.data(withJSONObject: metadata, options: .prettyPrinted).write(to: output.appendingPathComponent("theme.json"))
            return
        }
        let images = bitmaps(pe)
        try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
        let colours = themeColours(source)
        let suffix = "_FRAMECAPTION_BMP"
        let prefixes = images.map(\.0).filter { $0.uppercased().hasSuffix(suffix) }.map { String($0.dropLast(suffix.count)) }
        guard !prefixes.isEmpty else { throw ThemeError("Theme has no frame resources") }
        let selected = sourceScheme(source, prefixes)
        try writeScheme(output, images, selected, colours, assetUrl)
        var schemes: [[String: String]] = []
        for prefix in prefixes {
            let schemeId = prefix.lowercased()
            schemes.append(["id": schemeId, "name": schemeLabel(prefix)])
            try writeScheme(output.appendingPathComponent("schemes/\(schemeId)", isDirectory: true), images, prefix, colours, "\(assetUrl)/schemes/\(schemeId)")
        }
        let metadata: [String: Any] = ["theme": displayName, "msstyles": msstyles.lastPathComponent, "schemes": schemes, "defaultScheme": selected.lowercased()]
        try JSONSerialization.data(withJSONObject: metadata, options: .prettyPrinted).write(to: output.appendingPathComponent("theme.json"))
    }
}
