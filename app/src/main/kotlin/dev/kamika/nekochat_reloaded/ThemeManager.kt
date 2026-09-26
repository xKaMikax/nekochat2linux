package dev.kamika.nekochat_reloaded

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.zip.ZipInputStream

/**
 * Android port of the theme system in main.js: built-in prebuilt themes (from the APK),
 * user themes (catalog / import) and on-device msstyles rendering (MsStylesImporter).
 * All methods are blocking and must run off the main thread.
 */
class ThemeManager(private val context: Context) {
    val userThemesRoot = File(context.filesDir, "themes")
    val runtimeThemesRoot = File(context.filesDir, "runtime-themes")
    private val themeStateFile = File(context.filesDir, "theme-selection.json")
    private val displayStateFile = File(context.filesDir, "display-settings.json")

    private data class Theme(val id: String, val prebuilt: Boolean, val source: File? = null, val css: Boolean = false, val userInstalled: Boolean = false, val catalogId: String? = null)
    private data class Prepared(val theme: Theme, val baseUrl: String, val metadata: JSONObject, val css: Boolean)

    var activeTheme: JSONObject? = null
        private set
    var activeDisplay: JSONObject = JSONObject().put("language", "ru").put("loginUi", "xp").put("micDeviceId", "")
        private set

    fun load() {
        try { activeDisplay = merge(activeDisplay, JSONObject(displayStateFile.readText())) } catch (_: Exception) {}
        var saved = JSONObject().put("id", "Classic")
        try { saved = JSONObject(themeStateFile.readText()) } catch (_: Exception) {}
        if (saved.optString("id").equals("aero", ignoreCase = true)) saved = JSONObject().put("id", "Classic").put("scheme", "classic")
        try { activateTheme(saved.optString("id"), saved.optString("scheme").ifEmpty { null }) }
        catch (_: Exception) { try { activateTheme("Classic", "classic") } catch (_: Exception) {} }
    }

    fun saveDisplaySettings(settings: JSONObject): JSONObject {
        activeDisplay = JSONObject()
            .put("language", if (settings.optString("language") == "en") "en" else "ru")
            .put("loginUi", if (settings.optString("loginUi") == "classic") "classic" else "xp")
            .put("micDeviceId", settings.optString("micDeviceId", ""))
        displayStateFile.writeText(activeDisplay.toString())
        return activeDisplay
    }

    // ---- discovery -------------------------------------------------------------------

    private fun discoverThemes(): List<Theme> {
        val found = LinkedHashMap<String, Theme>()
        for (id in context.assets.list("web/prebuilt").orEmpty().sorted()) {
            if (context.assets.list("web/prebuilt/$id").orEmpty().contains("theme.json")) found[id] = Theme(id, prebuilt = true)
        }
        for (directory in userThemesRoot.listFiles().orEmpty().filter { it.isDirectory && it.name !in RESERVED_IDS }.sortedBy { it.name }) {
            val files = directory.listFiles().orEmpty().filter { it.isFile }
            val source = files.firstOrNull { it.name.endsWith(".theme", true) }
                ?: files.firstOrNull { it.name.endsWith(".msstyles", true) }
                ?: files.firstOrNull { it.name.equals("theme.css", true) }
                ?: continue
            val catalogId = try { JSONObject(File(directory, "catalog-theme.json").readText()).optString("id").ifEmpty { null } } catch (_: Exception) { null }
            found[directory.name] = Theme(directory.name, prebuilt = false, source = source, css = source.name.equals("theme.css", true), userInstalled = true, catalogId = catalogId)
        }
        return found.values.toList()
    }

    private fun prepareTheme(id: String): Prepared {
        val theme = discoverThemes().firstOrNull { it.id == id } ?: throw IllegalArgumentException("Theme not found")
        if (theme.prebuilt) {
            val metadata = JSONObject(context.assets.open("web/prebuilt/$id/theme.json").use { it.readBytes().toString(Charsets.UTF_8) })
            return Prepared(theme, "${WebContent.ORIGIN}/prebuilt/${enc(id)}", metadata, css = false)
        }
        val source = theme.source!!
        if (theme.css) {
            val metadata = JSONObject().put("theme", id).put("schemes", JSONArray().put(JSONObject().put("id", "default").put("name", "Default"))).put("defaultScheme", "default")
            return Prepared(theme, "${WebContent.ORIGIN}/user-themes/${enc(id)}", metadata, css = true)
        }
        val output = File(runtimeThemesRoot, id)
        val stamp = "${source.lastModified()}:${source.length()}:${MsStylesImporter.VERSION}"
        val cached = try { JSONObject(File(output, ".cache.json").readText()).optString("stamp") == stamp } catch (_: Exception) { false }
        if (!cached) {
            output.deleteRecursively()
            MsStylesImporter.importTheme(source, output, "${WebContent.ORIGIN}/runtime-themes/${enc(id)}")
            File(output, ".cache.json").writeText(JSONObject().put("stamp", stamp).toString())
        }
        val metadata = JSONObject(File(output, "theme.json").readText())
        return Prepared(theme, "${WebContent.ORIGIN}/runtime-themes/${enc(id)}", metadata, css = false)
    }

    private fun cssUrl(prepared: Prepared, scheme: String, revision: Long): String {
        val directory = if (prepared.css) prepared.baseUrl else "${prepared.baseUrl}/schemes/${enc(scheme)}"
        return "$directory/theme.css?theme=$revision"
    }

    private fun hasScheme(metadata: JSONObject, scheme: String): Boolean {
        val schemes = metadata.optJSONArray("schemes") ?: return false
        return (0 until schemes.length()).any { schemes.optJSONObject(it)?.optString("id") == scheme }
    }

    // ---- public API (mirrors ipcMain handlers) -----------------------------------------

    fun listThemes(): JSONArray {
        val result = JSONArray()
        for (theme in discoverThemes()) {
            try {
                val prepared = prepareTheme(theme.id)
                val name = prepared.metadata.optString("theme", theme.id).ifEmpty { theme.id }.replace(Regex("\\.(theme|msstyles)$", RegexOption.IGNORE_CASE), "")
                result.put(JSONObject().put("id", theme.id).put("name", name).put("schemes", prepared.metadata.optJSONArray("schemes") ?: JSONArray())
                    .put("removable", theme.userInstalled).put("catalogId", theme.catalogId ?: JSONObject.NULL))
            } catch (error: Exception) {
                android.util.Log.w("NekoChat", "Ignoring incomplete theme ${theme.id}: ${error.message}")
            }
        }
        return result
    }

    fun previewTheme(id: String, scheme: String?): JSONObject {
        val prepared = prepareTheme(id)
        val active = scheme?.ifEmpty { null } ?: prepared.metadata.optString("defaultScheme")
        val revision = System.currentTimeMillis()
        return JSONObject().put("id", id).put("scheme", active).put("revision", revision).put("cssUrl", cssUrl(prepared, active, revision))
    }

    fun activateTheme(id: String, requestedScheme: String?): JSONObject {
        if (!Regex("^[a-zA-Z0-9._ -]+$").matches(id) || (requestedScheme != null && !Regex("^[a-zA-Z0-9._-]+$").matches(requestedScheme))) throw IllegalArgumentException("Invalid theme name")
        val prepared = prepareTheme(id)
        val scheme = requestedScheme ?: prepared.metadata.optString("defaultScheme")
        if (!hasScheme(prepared.metadata, scheme)) throw IllegalArgumentException("Unknown colour scheme")
        val revision = System.currentTimeMillis()
        activeTheme = JSONObject().put("id", id).put("scheme", scheme).put("revision", revision).put("cssUrl", cssUrl(prepared, scheme, revision))
        themeStateFile.writeText(JSONObject().put("id", id).put("scheme", scheme).toString())
        return activeTheme!!
    }

    fun removeTheme(id: String): JSONObject {
        val theme = discoverThemes().firstOrNull { it.id == id }
        if (theme == null || !theme.userInstalled) throw IllegalArgumentException("Built-in themes cannot be removed.")
        if (activeTheme?.optString("id") == id) activateTheme("Classic", "classic")
        val directory = File(userThemesRoot, id).canonicalFile
        if (directory.parentFile != userThemesRoot.canonicalFile) throw IllegalArgumentException("Invalid theme location.")
        directory.deleteRecursively()
        File(runtimeThemesRoot, id).deleteRecursively()
        return JSONObject().put("themes", listThemes()).put("activeTheme", activeTheme ?: JSONObject.NULL)
    }

    /** Imports a user-picked file: .msstyles, .theme, theme.css or a .zip bundle. */
    fun importTheme(fileName: String, bytes: ByteArray): JSONObject {
        val base = fileName.substringBeforeLast('.').replace(Regex("[^a-zA-Z0-9._ -]"), "_").take(60).ifEmpty { "Custom-theme" }
        val destination = File(userThemesRoot, "$base-${System.currentTimeMillis()}")
        try {
            when {
                fileName.endsWith(".zip", true) -> installBundle(bytes, destination)
                fileName.endsWith(".css", true) -> { destination.mkdirs(); File(destination, "theme.css").writeBytes(bytes) }
                fileName.endsWith(".msstyles", true) || fileName.endsWith(".theme", true) -> { destination.mkdirs(); File(destination, fileName.replace(Regex("[/\\\\]"), "_")).writeBytes(bytes) }
                else -> throw IllegalArgumentException("Выберите файл .msstyles, .theme, theme.css или .zip с темой.")
            }
            val id = destination.name
            val prepared = prepareTheme(id)
            val scheme = prepared.metadata.optString("defaultScheme")
            val revision = System.currentTimeMillis()
            return JSONObject().put("themes", listThemes()).put("id", id).put("scheme", scheme).put("revision", revision).put("cssUrl", cssUrl(prepared, scheme, revision))
        } catch (error: Exception) {
            destination.deleteRecursively()
            File(runtimeThemesRoot, destination.name).deleteRecursively()
            throw error
        }
    }

    // ---- catalog -------------------------------------------------------------------------

    private fun catalogEntries(manifest: Any): JSONArray {
        val entries = mutableListOf<JSONObject>()
        when {
            manifest is JSONArray -> for (i in 0 until manifest.length()) entries += manifest.optJSONObject(i) ?: JSONObject()
            manifest is JSONObject && manifest.optJSONArray("themes") != null -> manifest.getJSONArray("themes").let { for (i in 0 until it.length()) entries += it.optJSONObject(i) ?: JSONObject() }
            manifest is JSONObject -> manifest.keys().forEach { key -> entries += (manifest.optJSONObject(key) ?: JSONObject()).put("theme_id", key) }
        }
        val result = JSONArray()
        entries.forEachIndexed { index, entry ->
            fun pick(vararg keys: String): String? = keys.firstNotNullOfOrNull { key -> entry.opt(key)?.takeIf { it != JSONObject.NULL }?.toString()?.ifEmpty { null } }
            val details = entry.optJSONObject("Details") ?: entry.optJSONObject("details") ?: JSONObject()
            fun detail(vararg keys: String): String? = keys.firstNotNullOfOrNull { key -> details.optString(key).ifEmpty { null } }
            val themeId = pick("theme_id", "id") ?: "theme-${index + 1}"
            val directory = (pick("directory") ?: themeId).trim('/')
            val schemes = entry.optJSONArray("ColorSchemes") ?: entry.optJSONArray("ColorShemas") ?: entry.optJSONArray("colorSchemes") ?: JSONArray()
            result.put(JSONObject()
                .put("id", themeId).put("directory", directory)
                .put("displayName", pick("DisplayName", "displayName") ?: themeId)
                .put("colorSchemes", schemes)
                .put("type", detail("Type", "type") ?: pick("Type", "type") ?: "WindowsThemeFile")
                .put("author", detail("Author", "author") ?: pick("Author", "author") ?: "Unknown")
                .put("version", detail("Version", "version") ?: pick("Version", "version") ?: "Unknown")
                .put("previewUrl", pick("Preview", "preview") ?: "$CATALOG_ROOT/$directory/Preview.png")
                .put("descriptionUrl", pick("Description", "description") ?: "$CATALOG_ROOT/$directory/Description.md")
                .put("detailsUrl", pick("DetailsFile", "detailsFile") ?: "$CATALOG_ROOT/$directory/Details.json")
                .put("zipUrl", pick("ThemeZIP", "themeZip") ?: "$CATALOG_ROOT/$directory/Theme.ZIP"))
        }
        return result
    }

    fun fetchCatalog(): JSONArray {
        val (status, body) = download("$CATALOG_ROOT/themes.json")
        if (status !in 200..299) throw IllegalStateException(if (status == 404) "Theme catalog has not been published yet." else "Unable to load theme catalog ($status).")
        val text = body.toString(Charsets.UTF_8).trim()
        return catalogEntries(if (text.startsWith("[")) JSONArray(text) else JSONObject(text))
    }

    private fun catalogItem(id: String): JSONObject {
        val catalog = fetchCatalog()
        return (0 until catalog.length()).map { catalog.getJSONObject(it) }.firstOrNull { it.optString("id") == id }
            ?: throw IllegalArgumentException("Theme no longer exists in the catalog.")
    }

    fun fetchCatalogThemeDetails(id: String): JSONObject {
        val item = catalogItem(id)
        var description = ""
        try {
            val (status, body) = download(item.getString("descriptionUrl"))
            if (status in 200..299) description = body.toString(Charsets.UTF_8)
        } catch (_: Exception) {}
        return JSONObject(item.toString()).put("description", description)
    }

    fun installCatalogTheme(id: String): JSONObject {
        val item = catalogItem(id)
        val (status, zip) = download(item.getString("zipUrl"))
        if (status !in 200..299) throw IllegalStateException("Unable to download Theme.ZIP ($status).")
        val destination = File(userThemesRoot, "${item.getString("id").replace(Regex("[^a-zA-Z0-9._-]"), "_")}-${System.currentTimeMillis()}")
        try {
            installBundle(zip, destination)
            File(destination, "catalog-theme.json").writeText(JSONObject().put("id", item.getString("id")).toString())
            return JSONObject().put("id", destination.name).put("themes", listThemes())
        } catch (error: Exception) {
            destination.deleteRecursively()
            throw error
        }
    }

    /** Extracts a Theme.ZIP and keeps only what the theme needs, like installCatalogTheme() in main.js. */
    private fun installBundle(zip: ByteArray, destination: File) {
        val temporary = File(context.cacheDir, "theme-${System.nanoTime()}")
        try {
            extractZip(zip, temporary)
            val source = findThemeSource(temporary) ?: throw IllegalArgumentException("Theme.ZIP must contain a .theme, .msstyles, or theme.css file.")
            destination.mkdirs()
            if (source.name.equals("theme.css", true)) source.parentFile!!.copyRecursively(destination, overwrite = true)
            else copyThemeBundle(source, destination)
        } finally {
            temporary.deleteRecursively()
        }
    }

    private fun extractZip(bytes: ByteArray, root: File) {
        val canonicalRoot = root.canonicalFile
        ZipInputStream(ByteArrayInputStream(bytes)).use { zip ->
            while (true) {
                val entry = zip.nextEntry ?: break
                val name = entry.name.replace('\\', '/')
                if (name.startsWith("/") || name.split('/').contains("..")) throw IllegalArgumentException("Theme.ZIP contains an unsafe path.")
                val target = File(canonicalRoot, name).canonicalFile
                // "./" entries (zip -r .) resolve to the root itself and are harmless.
                if (target != canonicalRoot && !target.path.startsWith(canonicalRoot.path + File.separator)) throw IllegalArgumentException("Theme.ZIP contains an unsafe path.")
                if (entry.isDirectory) { target.mkdirs(); continue }
                target.parentFile?.mkdirs()
                target.outputStream().use { zip.copyTo(it) }
            }
        }
    }

    private fun findThemeSource(root: File): File? {
        for (entry in root.listFiles().orEmpty().sortedBy { it.name }) {
            if (entry.isDirectory) findThemeSource(entry)?.let { return it }
            if (entry.isFile && (Regex("\\.(theme|msstyles)$", RegexOption.IGNORE_CASE).containsMatchIn(entry.name) || entry.name.equals("theme.css", true))) return entry
        }
        return null
    }

    private fun copyThemeBundle(sourceFile: File, destination: File) {
        val sourceRoot = sourceFile.parentFile!!
        sourceRoot.walkTopDown().filter { it.isFile && Regex("\\.(theme|msstyles|dll|mui)$", RegexOption.IGNORE_CASE).containsMatchIn(it.name) }.forEach { file ->
            val target = File(destination, file.relativeTo(sourceRoot).path)
            target.parentFile?.mkdirs()
            file.copyTo(target, overwrite = true)
        }
    }

    companion object {
        const val CATALOG_ROOT = "https://raw.githubusercontent.com/xKaMikax/nekochat_reloaded_themes/main"
        private val RESERVED_IDS = setOf("Current", "Luna", "Embedded", "Royale")

        private fun enc(value: String) = java.net.URLEncoder.encode(value, "UTF-8").replace("+", "%20")

        private fun merge(base: JSONObject, extra: JSONObject): JSONObject {
            val result = JSONObject(base.toString())
            extra.keys().forEach { result.put(it, extra.get(it)) }
            return result
        }

        fun download(url: String): Pair<Int, ByteArray> {
            val connection = URL(url).openConnection() as HttpURLConnection
            connection.connectTimeout = 15000
            connection.readTimeout = 30000
            connection.instanceFollowRedirects = true
            return try {
                val status = connection.responseCode
                val stream = if (status in 200..299) connection.inputStream else connection.errorStream
                status to (stream?.use { it.readBytes() } ?: ByteArray(0))
            } finally {
                connection.disconnect()
            }
        }
    }
}
