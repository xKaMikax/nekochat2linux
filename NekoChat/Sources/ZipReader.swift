import Compression
import Foundation

/// Minimal ZIP extractor (stored + deflate), a port of readZipEntries/extractZip in main.js.
enum ZipReader {
    private struct Entry {
        let name: String
        let method: Int
        let compressedSize: Int
        let uncompressedSize: Int
        let localHeaderOffset: Int
    }

    static func extract(_ zip: Data, to root: URL) throws {
        let bytes = [UInt8](zip)
        let entries = try readEntries(bytes)
        let base = root.standardizedFileURL
        try FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        for entry in entries {
            let name = entry.name.replacingOccurrences(of: "\\", with: "/")
            if name.hasPrefix("/") || name.split(separator: "/").contains("..") { throw ThemeError("Theme.ZIP contains an unsafe path.") }
            let target = base.appendingPathComponent(name).standardizedFileURL
            // "./" entries (zip -r .) resolve to the root itself and are harmless.
            guard target.path == base.path || target.path.hasPrefix(base.path + "/") else { throw ThemeError("Theme.ZIP contains an unsafe path.") }
            if name.hasSuffix("/") {
                try FileManager.default.createDirectory(at: target, withIntermediateDirectories: true)
                continue
            }
            try FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
            try entryData(bytes, entry).write(to: target)
        }
    }

    private static func u16(_ bytes: [UInt8], _ offset: Int) -> Int { Int(bytes[offset]) | Int(bytes[offset + 1]) << 8 }
    private static func u32(_ bytes: [UInt8], _ offset: Int) -> Int { u16(bytes, offset) | u16(bytes, offset + 2) << 16 }

    private static func readEntries(_ bytes: [UInt8]) throws -> [Entry] {
        guard bytes.count >= 22 else { throw ThemeError("Invalid ZIP file: end of central directory not found.") }
        var eocd = -1
        var index = bytes.count - 22
        while index >= 0 && index >= bytes.count - 22 - 0xFFFF {
            if u32(bytes, index) == 0x06054B50 { eocd = index; break }
            index -= 1
        }
        guard eocd >= 0 else { throw ThemeError("Invalid ZIP file: end of central directory not found.") }
        let count = u16(bytes, eocd + 10)
        var offset = u32(bytes, eocd + 16)
        var entries: [Entry] = []
        for _ in 0..<count {
            guard offset + 46 <= bytes.count, u32(bytes, offset) == 0x02014B50 else { throw ThemeError("Invalid ZIP file: corrupt central directory.") }
            let nameLength = u16(bytes, offset + 28)
            let extraLength = u16(bytes, offset + 30)
            let commentLength = u16(bytes, offset + 32)
            let name = String(decoding: bytes[(offset + 46)..<(offset + 46 + nameLength)], as: UTF8.self)
            entries.append(Entry(name: name, method: u16(bytes, offset + 10), compressedSize: u32(bytes, offset + 20), uncompressedSize: u32(bytes, offset + 24), localHeaderOffset: u32(bytes, offset + 42)))
            offset += 46 + nameLength + extraLength + commentLength
        }
        return entries
    }

    private static func entryData(_ bytes: [UInt8], _ entry: Entry) throws -> Data {
        let header = entry.localHeaderOffset
        guard header + 30 <= bytes.count, u32(bytes, header) == 0x04034B50 else { throw ThemeError("Invalid ZIP file: corrupt local header.") }
        let start = header + 30 + u16(bytes, header + 26) + u16(bytes, header + 28)
        guard start + entry.compressedSize <= bytes.count else { throw ThemeError("Invalid ZIP file: truncated entry.") }
        let compressed = Array(bytes[start..<(start + entry.compressedSize)])
        switch entry.method {
        case 0:
            return Data(compressed)
        case 8:
            // COMPRESSION_ZLIB is raw DEFLATE, exactly what ZIP stores.
            if entry.uncompressedSize == 0 { return Data() }
            var output = [UInt8](repeating: 0, count: entry.uncompressedSize)
            let written = compression_decode_buffer(&output, output.count, compressed, compressed.count, nil, COMPRESSION_ZLIB)
            guard written == entry.uncompressedSize else { throw ThemeError("Invalid ZIP file: cannot inflate \(entry.name).") }
            return Data(output)
        default:
            throw ThemeError("Unsupported ZIP compression method: \(entry.method).")
        }
    }
}
