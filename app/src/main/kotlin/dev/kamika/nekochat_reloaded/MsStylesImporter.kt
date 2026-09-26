package dev.kamika.nekochat_reloaded

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Kotlin port of tools/import_msstyles.py (pefile + Pillow are not available on Android).
 * Produces the same theme.json / theme.css / PNG layout, so the web UI cannot tell the
 * difference between a theme rendered on the phone and a prebuilt one.
 */
object MsStylesImporter {
    const val VERSION = 1

    // ---- PE resources ----------------------------------------------------------------

    private class PeFile(private val data: ByteArray) {
        private val buffer: ByteBuffer = ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN)
        private val sections = mutableListOf<IntArray>() // virtualAddress, virtualSize, rawPointer, rawSize
        private var resourceRva = 0
        private var resourceOffset = -1

        class Node(val id: Int?, val name: String?, val offset: Int, val isDirectory: Boolean)

        init {
            if (u16(0) != 0x5A4D) throw IllegalArgumentException("Not a PE file")
            val pe = u32(0x3C)
            if (u32(pe) != 0x00004550) throw IllegalArgumentException("Not a PE file")
            val sectionCount = u16(pe + 6)
            val optionalSize = u16(pe + 20)
            val optional = pe + 24
            val magic = u16(optional)
            val directories = optional + if (magic == 0x20B) 112 else 96
            resourceRva = u32(directories + 2 * 8)
            var section = optional + optionalSize
            repeat(sectionCount) {
                sections += intArrayOf(u32(section + 12), u32(section + 8), u32(section + 20), u32(section + 16))
                section += 40
            }
            resourceOffset = if (resourceRva == 0) -1 else rvaToOffset(resourceRva)
        }

        fun u16(offset: Int) = buffer.getShort(offset).toInt() and 0xFFFF
        fun u32(offset: Int) = buffer.getInt(offset)

        fun rvaToOffset(rva: Int): Int {
            for ((address, virtualSize, raw, rawSize) in sections.map { it.toList() }) {
                if (rva >= address && rva < address + maxOf(virtualSize, rawSize)) return rva - address + raw
            }
            return rva
        }

        fun children(directoryOffset: Int = 0): List<Node> {
            if (resourceOffset < 0) return emptyList()
            val base = resourceOffset + directoryOffset
            val count = u16(base + 12) + u16(base + 14)
            return (0 until count).map { index ->
                val entry = base + 16 + index * 8
                val nameField = u32(entry)
                val target = u32(entry + 4)
                val named = nameField and 0x80000000.toInt() != 0
                val name = if (named) {
                    val at = resourceOffset + (nameField and 0x7FFFFFFF)
                    val length = u16(at)
                    String(data, at + 2, length * 2, Charsets.UTF_16LE)
                } else null
                Node(if (named) null else nameField and 0xFFFF, name, target and 0x7FFFFFFF, target and 0x80000000.toInt() != 0)
            }
        }

        /** Follows the first child until a data entry is reached (name → language → data). */
        fun leafData(node: Node): ByteArray {
            var current = node
            while (current.isDirectory) current = children(current.offset).first()
            val entry = resourceOffset + current.offset
            val offset = rvaToOffset(u32(entry))
            val size = u32(entry + 4)
            return data.copyOfRange(offset, offset + size)
        }
    }

    // ---- DIB decoding (decode_dib) -------------------------------------------------------

    private fun decodeDib(data: ByteArray, preserveAlpha: Boolean): Bitmap {
        val b = ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN)
        val headerSize = b.getInt(0)
        val width = b.getInt(4)
        val rawHeight = b.getInt(8)
        val bpp = b.getShort(14).toInt()
        val compression = if (headerSize >= 20) b.getInt(16) else 0
        val colours = (if (headerSize >= 36) b.getInt(32) else 0).let { if (it == 0 && bpp <= 8) 1 shl bpp else it }
        val height = kotlin.math.abs(rawHeight)
        val bottomUp = rawHeight > 0
        val masksSize = if (compression == 3 && headerSize == 40) 12 else 0
        val pixelOffset = headerSize + masksSize + colours * 4
        val bitmap: Bitmap
        if (width > 0 && height > 0 && (compression == 0 || (compression == 3 && bpp == 32)) && bpp in setOf(1, 4, 8, 24, 32)) {
            val stride = ((width * bpp + 31) / 32) * 4
            val pixels = IntArray(width * height)
            val palette = IntArray(if (bpp <= 8) colours else 0) { index ->
                val at = headerSize + masksSize + index * 4
                (0xFF shl 24) or ((data[at + 2].toInt() and 0xFF) shl 16) or ((data[at + 1].toInt() and 0xFF) shl 8) or (data[at].toInt() and 0xFF)
            }
            for (y in 0 until height) {
                val row = pixelOffset + (if (bottomUp) height - 1 - y else y) * stride
                for (x in 0 until width) {
                    val colour = when (bpp) {
                        32 -> {
                            val at = row + x * 4
                            val alpha = if (preserveAlpha) data[at + 3].toInt() and 0xFF else 0xFF
                            (alpha shl 24) or ((data[at + 2].toInt() and 0xFF) shl 16) or ((data[at + 1].toInt() and 0xFF) shl 8) or (data[at].toInt() and 0xFF)
                        }
                        24 -> {
                            val at = row + x * 3
                            (0xFF shl 24) or ((data[at + 2].toInt() and 0xFF) shl 16) or ((data[at + 1].toInt() and 0xFF) shl 8) or (data[at].toInt() and 0xFF)
                        }
                        8 -> palette.getOrElse(data[row + x].toInt() and 0xFF) { 0xFF000000.toInt() }
                        4 -> palette.getOrElse((data[row + x / 2].toInt() shr (if (x % 2 == 0) 4 else 0)) and 0x0F) { 0xFF000000.toInt() }
                        else -> palette.getOrElse((data[row + x / 8].toInt() shr (7 - x % 8)) and 1) { 0xFF000000.toInt() }
                    }
                    pixels[y * width + x] = colour
                }
            }
            bitmap = Bitmap.createBitmap(pixels, width, height, Bitmap.Config.ARGB_8888).copy(Bitmap.Config.ARGB_8888, true)
        } else {
            // RLE and other rare formats: let the platform decoder handle a synthesized .bmp.
            val file = ByteBuffer.allocate(14 + data.size).order(ByteOrder.LITTLE_ENDIAN)
            file.put('B'.code.toByte()).put('M'.code.toByte()).putInt(14 + data.size).putShort(0).putShort(0).putInt(14 + pixelOffset).put(data)
            val decoded = BitmapFactory.decodeByteArray(file.array(), 0, file.capacity()) ?: throw IllegalArgumentException("Unsupported bitmap")
            bitmap = decoded.copy(Bitmap.Config.ARGB_8888, true)
        }
        // Magenta is the transparent key colour in msstyles bitmaps.
        val all = IntArray(bitmap.width * bitmap.height)
        bitmap.getPixels(all, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
        var changed = false
        for (i in all.indices) {
            val p = all[i]
            val r = (p shr 16) and 0xFF; val g = (p shr 8) and 0xFF; val bl = p and 0xFF
            if (r > 245 && g < 12 && bl > 245) { all[i] = p and 0x00FFFFFF; changed = true }
        }
        if (changed) bitmap.setPixels(all, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
        return bitmap
    }

    private fun bitmaps(pe: PeFile): Map<String, Bitmap> {
        val root = pe.children().firstOrNull { it.name == null && it.id == 2 } ?: return emptyMap()
        val result = LinkedHashMap<String, Bitmap>()
        for (entry in pe.children(root.offset)) {
            val name = entry.name ?: entry.id.toString()
            try { result[name] = decodeDib(pe.leafData(entry), name.uppercase().endsWith("GLYPH_BMP")) } catch (_: Exception) {}
        }
        return result
    }

    private fun namedPng(pe: PeFile, type: String, id: Int): ByteArray? = try {
        val root = pe.children().first { it.name == type }
        val item = pe.children(root.offset).first { it.id == id }
        pe.leafData(item).takeIf { it.size > 8 && it[0] == 0x89.toByte() && it[1] == 'P'.code.toByte() && it[2] == 'N'.code.toByte() && it[3] == 'G'.code.toByte() }
    } catch (_: Exception) { null }

    // ---- image helpers -------------------------------------------------------------------

    private fun crop(image: Bitmap, left: Int, top: Int, right: Int, bottom: Int): Bitmap {
        val l = left.coerceIn(0, image.width); val t = top.coerceIn(0, image.height)
        val r = right.coerceIn(l, image.width); val b = bottom.coerceIn(t, image.height)
        if (r - l <= 0 || b - t <= 0) return Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888)
        return Bitmap.createBitmap(image, l, t, r - l, b - t)
    }

    private fun save(image: Bitmap, output: File, name: String) {
        File(output, name).outputStream().use { image.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }

    private fun find(images: Map<String, Bitmap>, suffix: String, prefix: String = ""): Bitmap =
        images.entries.firstOrNull { (name, _) -> name.uppercase().endsWith(suffix) && (prefix.isEmpty() || name.uppercase().startsWith(prefix.uppercase() + "_")) }?.value
            ?: throw IllegalArgumentException("Missing theme resource $suffix")

    private fun state(image: Bitmap, index: Int): Bitmap {
        val side = image.width
        val rows = maxOf(1, image.height / side)
        val top = minOf(index, rows - 1) * side
        return crop(image, 0, top, image.width, minOf(top + side, image.height))
    }

    private fun buttonState(image: Bitmap, index: Int): Bitmap {
        val frameHeight = if (image.height % 5 == 0) image.height / 5 else image.width
        val top = minOf(index, maxOf(0, image.height / frameHeight - 1)) * frameHeight
        return crop(image, 0, top, image.width, top + frameHeight)
    }

    private fun stripState(image: Bitmap, frameHeight: Int, index: Int): Bitmap {
        val top = minOf(index, maxOf(0, image.height / frameHeight - 1)) * frameHeight
        return crop(image, 0, top, image.width, top + frameHeight)
    }

    // ---- .theme (INI) --------------------------------------------------------------------

    private fun readIni(file: File): Map<String, Map<String, String>> {
        val result = LinkedHashMap<String, LinkedHashMap<String, String>>()
        var section = ""
        file.readBytes().toString(Charsets.ISO_8859_1).lines().forEach { raw ->
            val line = raw.trim()
            if (line.isEmpty() || line.startsWith(";") || line.startsWith("#")) return@forEach
            if (line.startsWith("[") && line.endsWith("]")) { section = line.substring(1, line.length - 1).lowercase(); return@forEach }
            val separator = line.indexOfFirst { it == '=' || it == ':' }
            if (separator > 0) result.getOrPut(section) { LinkedHashMap() }.putIfAbsent(line.substring(0, separator).trim().lowercase(), line.substring(separator + 1).trim())
        }
        return result
    }

    private fun iniGet(ini: Map<String, Map<String, String>>, section: String, key: String) = ini[section.lowercase()]?.get(key.lowercase())

    private fun resolveTheme(source: File): File {
        if (source.name.endsWith(".msstyles", true)) return source
        val filename = (iniGet(readIni(source), "VisualStyles", "Path") ?: "").replace('\\', '/').substringAfterLast('/')
        val all = source.parentFile!!.walkTopDown().filter { it.isFile }.toList()
        val candidates = (if (filename.isNotEmpty()) all.filter { it.name.equals(filename, true) } else emptyList()) + all.filter { it.name.endsWith(".msstyles", true) }
        if (candidates.isEmpty()) throw IllegalArgumentException("The .theme file has no nearby .msstyles file")
        return candidates.first()
    }

    private fun themeColours(source: File): Map<String, String> {
        val defaults = linkedMapOf("Window" to "#ece9d8", "ButtonFace" to "#d4d0c8", "WindowText" to "#000000", "Hilight" to "#316ac5")
        if (!source.name.endsWith(".theme", true)) return defaults
        val ini = readIni(source)
        if (ini["control panel\\colors"] == null) return defaults
        for (key in defaults.keys.toList()) {
            val value = (iniGet(ini, "Control Panel\\Colors", key) ?: "").replace(',', ' ').split(Regex("\\s+")).filter { it.isNotEmpty() }
            if (value.size == 3 && value.all { part -> part.all { it.isDigit() } }) defaults[key] = "#%02x%02x%02x".format(value[0].toInt(), value[1].toInt(), value[2].toInt())
        }
        return defaults
    }

    private fun themeDisplayName(source: File, msstyles: File): String {
        if (source.name.endsWith(".theme", true)) {
            val value = (iniGet(readIni(source), "Theme", "DisplayName") ?: "").trim()
            if (value.isNotEmpty() && !value.startsWith("@")) return value
        }
        val stem = (if (source.name.endsWith(".theme", true)) source else msstyles).nameWithoutExtension
        return mapOf("aero" to "Aero", "aerolite" to "Aero Lite")[stem.lowercase()] ?: stem
    }

    private fun isAeroStyle(source: File, msstyles: File) =
        source.nameWithoutExtension.lowercase() in setOf("aero", "aerolite") || msstyles.nameWithoutExtension.lowercase() in setOf("aero", "aerolite")

    private fun schemeLabel(prefix: String) = mapOf("BLUE" to "Default (blue)", "HOMESTEAD" to "Homestead (green)", "METALLIC" to "Metallic (silver)", "DEFAULT" to "Default", "ROYALE" to "Royale")[prefix.uppercase()]
        ?: prefix.replace('_', ' ').lowercase().split(' ').joinToString(" ") { it.replaceFirstChar(Char::uppercase) }

    private fun sourceScheme(source: File, prefixes: List<String>): String {
        if (source.name.endsWith(".theme", true)) {
            var requested = (iniGet(readIni(source), "VisualStyles", "ColorStyle") ?: "NormalColor").uppercase()
            requested = mapOf("NORMALCOLOR" to "BLUE", "HOMESTEAD" to "HOMESTEAD", "METALLIC" to "METALLIC")[requested] ?: requested
            if (requested in prefixes) return requested
        }
        return prefixes.first()
    }

    // ---- writers -------------------------------------------------------------------------

    private fun writeScheme(output: File, images: Map<String, Bitmap>, prefix: String, colours: Map<String, String>, asset: String) {
        output.mkdirs()
        var caption = find(images, "_FRAMECAPTION_BMP", prefix)
        val capHeight = caption.height / 2
        caption = crop(caption, 0, 0, caption.width, capHeight)
        var left = 28; var right = 35
        if (caption.width <= left + right) { left = maxOf(1, caption.width / 4); right = maxOf(1, caption.width / 4) }
        save(crop(caption, 0, 0, left, capHeight), output, "title-left.png")
        save(crop(caption, left, 0, caption.width - right, capHeight), output, "title-fill.png")
        save(crop(caption, caption.width - right, 0, caption.width, capHeight), output, "title-right.png")
        save(find(images, "_FRAMELEFT_BMP", prefix), output, "frame-left.png")
        save(find(images, "_FRAMERIGHT_BMP", prefix), output, "frame-right.png")
        val bottom = find(images, "_FRAMEBOTTOM_BMP", prefix)
        val bleft = minOf(5, bottom.width / 3); val bright = minOf(5, bottom.width / 3)
        save(crop(bottom, 0, 0, bleft, bottom.height), output, "bottom-left.png")
        save(crop(bottom, bleft, 0, bottom.width - bright, bottom.height), output, "bottom-fill.png")
        save(crop(bottom, bottom.width - bright, 0, bottom.width, bottom.height), output, "bottom-right.png")
        val states = listOf("normal", "hover", "pressed")
        for ((name, resource) in listOf("caption" to "_CAPTIONBUTTON_BMP", "close" to "_CLOSEBUTTON_BMP")) {
            val button = find(images, resource, prefix)
            states.forEachIndexed { index, stateName -> save(state(button, index), output, "$name-$stateName.png") }
        }
        val button = find(images, "_BUTTON_BMP", prefix)
        states.forEachIndexed { index, stateName -> save(buttonState(button, index), output, "button-$stateName.png") }
        val checkbox = find(images, "_CHECKBOX13_BMP", prefix)
        for ((index, stateName) in listOf(0 to "unchecked-normal", 1 to "unchecked-hover", 2 to "unchecked-pressed", 4 to "checked-normal", 5 to "checked-hover", 6 to "checked-pressed")) {
            save(state(checkbox, index), output, "checkbox-$stateName.png")
        }
        save(find(images, "_GROUPBOX_BMP", prefix), output, "groupbox.png")
        save(find(images, "_FIELDOUTLINEBLUE_BMP", prefix), output, "field-outline.png")
        val arrows = find(images, "_SCROLLARROWS_BMP", prefix)
        val arrowGlyphs = find(images, "_SCROLLARROWGLYPHS_BMP", prefix)
        for ((direction, index) in listOf("up" to 0, "down" to 4, "left" to 8, "right" to 12)) {
            states.forEachIndexed { stateIndex, stateName ->
                val arrow = state(arrows, index + stateIndex).copy(Bitmap.Config.ARGB_8888, true)
                val glyph = state(arrowGlyphs, index + stateIndex)
                Canvas(arrow).drawBitmap(glyph, ((arrow.width - glyph.width) / 2).toFloat(), ((arrow.height - glyph.height) / 2).toFloat(), null)
                save(arrow, output, "scroll-$direction-$stateName.png")
            }
        }
        save(state(find(images, "_SCROLLSHAFTVERTICAL_BMP", prefix), 0), output, "scroll-shaft-vertical.png")
        save(state(find(images, "_SCROLLSHAFTHORIZONTAL_BMP", prefix), 0), output, "scroll-shaft-horizontal.png")
        val thumbVertical = find(images, "_SCROLLTHUMBVERTICAL_BMP", prefix)
        val thumbHorizontal = find(images, "_SCROLLTHUMBHORIZONTAL_BMP", prefix)
        states.forEachIndexed { stateIndex, stateName ->
            save(stripState(thumbVertical, 22, stateIndex), output, "scroll-thumb-vertical-$stateName.png")
            save(stripState(thumbHorizontal, 20, stateIndex), output, "scroll-thumb-horizontal-$stateName.png")
        }
        for ((name, resource) in listOf("minimize" to "_MINIMIZEGLYPH_BMP", "maximize" to "_MAXIMIZEGLYPH_BMP", "close" to "_CLOSEGLYPH_BMP")) {
            val glyph = find(images, resource, prefix)
            states.forEachIndexed { index, stateName -> save(state(glyph, index), output, "$name-glyph-$stateName.png") }
        }
        fun u(name: String) = "url(\"$asset/$name\")"
        val css = StringBuilder()
        css.append(":root { --xp-caption-left: ${left}px; --xp-caption-right: ${right}px; --xp-caption-middle: 1px; --xp-caption-height: ${capHeight}px; --xp-bottom-left: ${bleft}px; --xp-bottom-right: ${bright}px; --xp-bottom-middle: 1px; --xp-bottom-height: ${bottom.height}px; ")
        css.append("--xp-theme-window: ${colours["Window"]}; --xp-theme-buttonface: ${colours["ButtonFace"]}; --xp-theme-windowtext: ${colours["WindowText"]}; --xp-theme-highlight: ${colours["Hilight"]}; ")
        css.append("--xp-title-fill: ${u("title-fill.png")}; --xp-title-left: ${u("title-left.png")}; --xp-title-right: ${u("title-right.png")}; --xp-frame-left: ${u("frame-left.png")}; --xp-frame-right: ${u("frame-right.png")}; --xp-bottom-fill: ${u("bottom-fill.png")}; --xp-bottom-left-image: ${u("bottom-left.png")}; --xp-bottom-right-image: ${u("bottom-right.png")}; ")
        css.append("--xp-caption-normal: ${u("caption-normal.png")}; --xp-caption-hover: ${u("caption-hover.png")}; --xp-caption-pressed: ${u("caption-pressed.png")}; --xp-close-normal: ${u("close-normal.png")}; --xp-close-hover: ${u("close-hover.png")}; --xp-close-pressed: ${u("close-pressed.png")}; ")
        css.append("--xp-close-glyph: ${u("close-glyph-normal.png")}; --xp-close-glyph-hover: ${u("close-glyph-hover.png")}; --xp-close-glyph-pressed: ${u("close-glyph-pressed.png")}; --xp-minimize-glyph: ${u("minimize-glyph-normal.png")}; --xp-minimize-glyph-hover: ${u("minimize-glyph-hover.png")}; --xp-minimize-glyph-pressed: ${u("minimize-glyph-pressed.png")}; ")
        css.append("--xp-maximize-glyph: ${u("maximize-glyph-normal.png")}; --xp-maximize-glyph-hover: ${u("maximize-glyph-hover.png")}; --xp-maximize-glyph-pressed: ${u("maximize-glyph-pressed.png")}; --xp-button-normal: ${u("button-normal.png")}; --xp-button-hover: ${u("button-hover.png")}; --xp-button-pressed: ${u("button-pressed.png")}; }\n")
        css.append(":root { --xp-checkbox-unchecked: ${u("checkbox-unchecked-normal.png")}; --xp-checkbox-unchecked-hover: ${u("checkbox-unchecked-hover.png")}; --xp-checkbox-unchecked-pressed: ${u("checkbox-unchecked-pressed.png")}; --xp-checkbox-checked: ${u("checkbox-checked-normal.png")}; --xp-checkbox-checked-hover: ${u("checkbox-checked-hover.png")}; --xp-checkbox-checked-pressed: ${u("checkbox-checked-pressed.png")}; --xp-groupbox: ${u("groupbox.png")}; --xp-field-outline: ${u("field-outline.png")}; }\n")
        css.append(":root { ")
        for (direction in listOf("up", "down", "left", "right")) css.append("--xp-scroll-$direction: ${u("scroll-$direction-normal.png")}; --xp-scroll-$direction-hover: ${u("scroll-$direction-hover.png")}; --xp-scroll-$direction-pressed: ${u("scroll-$direction-pressed.png")}; ")
        css.append("--xp-scroll-shaft-vertical: ${u("scroll-shaft-vertical.png")}; --xp-scroll-shaft-horizontal: ${u("scroll-shaft-horizontal.png")}; ")
        for (axis in listOf("vertical", "horizontal")) css.append("--xp-scroll-thumb-$axis: ${u("scroll-thumb-$axis-normal.png")}; --xp-scroll-thumb-$axis-hover: ${u("scroll-thumb-$axis-hover.png")}; --xp-scroll-thumb-$axis-pressed: ${u("scroll-thumb-$axis-pressed.png")}; ")
        css.append("}\n")
        File(output, "theme.css").writeText(css.toString())
    }

    private fun writeAeroScheme(output: File, pe: PeFile, asset: String) {
        output.mkdirs()
        for ((filename, id) in listOf("aero-close-strip.png" to 936, "aero-close-glyphs.png" to 937)) namedPng(pe, "IMAGE", id)?.let { File(output, filename).writeBytes(it) }
        namedPng(pe, "IMAGE", 934)?.let { raw ->
            val image = BitmapFactory.decodeByteArray(raw, 0, raw.size)
            val activeHeight = image.height / 2
            val active = crop(image, 0, 0, image.width, activeHeight)
            val left = minOf(16, active.width / 3); val right = minOf(16, active.width / 3)
            save(crop(active, 0, 0, left, activeHeight), output, "aero-title-left.png")
            save(crop(active, left, 0, active.width - right, activeHeight), output, "aero-title-fill.png")
            save(crop(active, active.width - right, 0, active.width, activeHeight), output, "aero-title-right.png")
        }
        namedPng(pe, "STREAM", 971)?.let { raw ->
            val atlas = BitmapFactory.decodeByteArray(raw, 0, raw.size)
            save(crop(atlas, 555, 0, 1357, 604), output, "aero-glass-reflection.png")
        }
        File(output, "theme.css").writeText(AERO_CSS.replace("{asset}", asset))
    }

    /** import_theme(): renders [source] (.theme or .msstyles) into [output]; [assetUrl] is output's web URL. */
    fun importTheme(source: File, output: File, assetUrl: String) {
        val msstyles = resolveTheme(source)
        val pe = PeFile(msstyles.readBytes())
        if (isAeroStyle(source, msstyles)) {
            val scheme = "normalcolor"
            writeAeroScheme(output, pe, assetUrl)
            writeAeroScheme(File(output, "schemes/$scheme"), pe, "$assetUrl/schemes/$scheme")
            File(output, "theme.json").writeText(JSONObject().put("theme", themeDisplayName(source, msstyles)).put("msstyles", msstyles.name)
                .put("schemes", JSONArray().put(JSONObject().put("id", scheme).put("name", "Default (blue)"))).put("defaultScheme", scheme).toString(2))
            return
        }
        val images = bitmaps(pe)
        output.mkdirs()
        val colours = themeColours(source)
        val suffix = "_FRAMECAPTION_BMP"
        val prefixes = images.keys.filter { it.uppercase().endsWith(suffix) }.map { it.substring(0, it.length - suffix.length) }
        if (prefixes.isEmpty()) throw IllegalArgumentException("Theme has no frame resources")
        val selected = sourceScheme(source, prefixes)
        writeScheme(output, images, selected, colours, assetUrl)
        val schemes = JSONArray()
        for (prefix in prefixes) {
            val schemeId = prefix.lowercase()
            schemes.put(JSONObject().put("id", schemeId).put("name", schemeLabel(prefix)))
            writeScheme(File(output, "schemes/$schemeId"), images, prefix, colours, "$assetUrl/schemes/$schemeId")
        }
        File(output, "theme.json").writeText(JSONObject().put("theme", themeDisplayName(source, msstyles)).put("msstyles", msstyles.name).put("schemes", schemes).put("defaultScheme", selected.lowercase()).toString(2))
    }

    private val AERO_CSS = """/* Windows 7 Aero Glass renderer generated for Aero.msstyles. */
:root {
  font-family: "Segoe UI", Tahoma, sans-serif;
  --aero-glass: rgba(116, 184, 252, .42); --aero-glass-dark: rgba(29, 73, 112, .58);
  --xp-caption-height: 29px; --xp-caption-left: 16px; --xp-caption-right: 16px;
  --xp-caption-middle: 1px; --xp-bottom-height: 1px; --xp-bottom-left: 0px;
  --xp-bottom-right: 0px; --xp-bottom-middle: 1px; --xp-controls-width: 88px;
  --xp-control-width: 28px; --xp-control-height: 17px; --xp-control-gap: 2px;
  --xp-theme-window: #f9fbfd; --xp-theme-buttonface: #e8f1fa;
  --xp-theme-windowtext: #1d1d1d; --xp-theme-highlight: #5a9bd5;
  --xp-title-fill: url("{asset}/aero-title-fill.png");
  --xp-title-left: url("{asset}/aero-title-left.png"); --xp-title-right: url("{asset}/aero-title-right.png"); --xp-frame-left: linear-gradient(#7299bd,#31587d);
  --xp-frame-right: linear-gradient(#7299bd,#31587d); --xp-bottom-fill: #31587d;
  --xp-bottom-left-image: none; --xp-bottom-right-image: none;
  --xp-caption-normal: linear-gradient(to bottom, rgba(235,249,255,.78), rgba(91,146,192,.68));
  --xp-caption-hover: linear-gradient(to bottom, #eaf8ff, #75b9ee); --xp-caption-pressed: #4d87bc;
  --xp-close-normal: url("{asset}/aero-close-strip.png"); --xp-close-hover: url("{asset}/aero-close-strip.png"); --xp-close-pressed: url("{asset}/aero-close-strip.png");
  --xp-close-glyph: url("{asset}/aero-close-glyphs.png"); --xp-close-glyph-hover: url("{asset}/aero-close-glyphs.png"); --xp-close-glyph-pressed: url("{asset}/aero-close-glyphs.png");
  --xp-button-border: 1px solid #7195b7; --xp-button-frame: none; --xp-button-frame-hover: none; --xp-button-frame-pressed: none;
  --xp-button-background: linear-gradient(#ffffff,#e8f2fa); --xp-button-background-hover: linear-gradient(#ffffff,#c7e7fb); --xp-button-background-pressed: linear-gradient(#b9d8ed,#eff8ff);
  --xp-button-shadow: inset 0 0 0 1px rgba(255,255,255,.82); --xp-button-shadow-hover: inset 0 0 0 1px rgba(255,255,255,.92); --xp-button-shadow-pressed: inset 0 1px 2px rgba(45,87,120,.45);
}
.xp-window { border: 0; border-radius: 0; background: transparent; box-shadow: 0 0 12px rgba(31,108,181,.78), 0 5px 15px rgba(0,0,0,.38); }
.xp-titlebar { padding: 6px 8px; border-radius: 7px 7px 0 0; border-bottom: 0; font: 600 12px/15px 'Segoe UI', Tahoma, sans-serif; text-shadow: 0 1px 1px #173d63; background-color: var(--aero-glass-dark); background-image: url("{asset}/aero-glass-reflection.png"), var(--xp-title-fill); background-size: 390px 294px, 34px 29px; background-position: center 42%, left top; background-repeat: no-repeat, repeat-x; background-blend-mode: screen, normal; -webkit-backdrop-filter: blur(18px) saturate(160%); backdrop-filter: blur(18px) saturate(160%); }
.xp-titlebar::before,.xp-titlebar::after { display: block; z-index: 2; background-size: 16px 29px; }
.xp-window-controls { top: 0; right: 5px; }.xp-window-controls button { border: 0; border-radius: 0 0 4px 4px; box-shadow: none; }
.xp-window-controls button::after { width: auto; height: auto; margin: 0; background: none !important; color: #fff; font: 400 16px/18px "Segoe UI Symbol", Arial, sans-serif; text-shadow: 0 1px #174e87; }
#minimize::after { content: '−'; } #maximize::after { content: '□'; font-size: 13px; } #close::after { content: ''; width: 13px; height: 13px; margin: 3px auto 0; background: var(--xp-close-glyph) center top/13px 104px no-repeat !important; }
#close:hover::after { background-position: center -13px !important; } #close:active::after { background-position: center -26px !important; }
#close { background-size: 28px 136px !important; background-position: center top; }
.xp-dialog .dialog-close { border: 1px solid rgba(31,78,121,.82); border-top-color: rgba(255,255,255,.8); border-radius: 0 0 4px 4px; background-size: 28px 136px; background-position: center top; box-shadow: inset 0 0 0 1px rgba(220,244,255,.35); }
.xp-dialog .dialog-close::after { width: 13px; height: 13px; top: 3px; left: 7px; background: var(--xp-close-glyph) center top/13px 104px no-repeat !important; content: ''; }
.xp-dialog .dialog-close:hover::after { background-position: center -13px !important; }.xp-dialog .dialog-close:active::after { background-position: center -26px !important; }
.xp-side { width: 4px; background: var(--aero-glass); -webkit-backdrop-filter: blur(18px) saturate(160%); backdrop-filter: blur(18px) saturate(160%); }.xp-bottom { height: 4px; background: var(--aero-glass); -webkit-backdrop-filter: blur(18px) saturate(160%); backdrop-filter: blur(18px) saturate(160%); }.xp-bottom::before,.xp-bottom::after { display:none; }
.chat-app button,.settings-window button,.profile-window button,.call-window button { border: 1px solid #7f9db9; border-radius: 3px; background: linear-gradient(#fff,#e7eef7); box-shadow: inset 0 0 0 1px #fff; } .chat-app button:hover,.settings-window button:hover,.profile-window button:hover,.call-window button:hover { border-color: #3c7fb1; background: linear-gradient(#fafdff,#cfe9fc); }
input,select,textarea { border-color: #9db4cb !important; border-radius: 2px; }.sidebar { background: linear-gradient(90deg,#eef5fc,#dce9f5); border-color:#8ba9c4; }.account-card,.tabs,.sidebar-actions,.composer { background: linear-gradient(#f5f9fd,#dfeaf5); border-color:#a9bed1; }.chat-list,.conversation,.messages { background:#f9fbfd; }.chat-item.active,.tab.active,.conversation-header,.dialog-title { background: linear-gradient(#d9efff,#85b8e1 47%,#5d97ca 51%,#78add7) !important; color:#123f68; text-shadow:0 1px #e8f7ff; }.chat-item.active small,.conversation-header small { color:#244f75; }.search,.composer input { background:#fff; border-color:#9db4cb; }.message { border-color:#b4c7d8; border-radius:3px; box-shadow:0 1px 1px rgba(0,0,0,.08); }.message.mine { background:#e8f4ff; }
.preview-window { border: 1px solid rgba(20,51,82,.86); border-radius: 7px 7px 0 0; box-shadow: inset 0 0 0 1px rgba(236,250,255,.8), 0 2px 6px rgba(20,64,104,.7); background:rgba(249,251,253,.93); }
.preview-window header { height:29px; padding:6px 88px 4px 8px; border-radius:7px 7px 0 0; border-bottom:0; background-color:rgba(55,116,174,.66); background-image:url("{asset}/aero-glass-reflection.png"),url("{asset}/aero-title-fill.png"); background-size:250px 188px,34px 29px; background-position:center 45%,left top; background-repeat:no-repeat,repeat-x; background-blend-mode:screen,normal; -webkit-backdrop-filter:blur(12px) saturate(160%); backdrop-filter:blur(12px) saturate(160%); font-family:'Segoe UI',Tahoma,sans-serif; text-shadow:0 1px #173d63; }
.preview-window .controls { top:4px; right:5px; height:22px; gap:2px; }.preview-window .controls i { width:28px; height:22px; border:1px solid rgba(31,78,121,.82); border-top-color:rgba(255,255,255,.8); border-radius:0 0 4px 4px; background:linear-gradient(to bottom,rgba(235,249,255,.78),rgba(91,146,192,.68)); box-shadow:inset 0 0 0 1px rgba(220,244,255,.35); }.preview-window .controls .close { background-image:url("{asset}/aero-close-strip.png")!important; background-size:28px 136px; background-position:center top; }.preview-window .controls i img { display:none; }.preview-window .controls .min::after,.preview-window .controls .max::after { display:block; color:#fff; text-align:center; font:400 16px/18px 'Segoe UI Symbol',Arial,sans-serif; text-shadow:0 1px #174e87; }.preview-window .controls .min::after{content:'−';}.preview-window .controls .max::after{content:'□';font-size:13px;}.preview-window .controls .close::after{content:'';display:block;width:13px;height:13px;margin:3px auto 0;background:url("{asset}/aero-close-glyphs.png") center top/13px 104px no-repeat;}
"""
}
