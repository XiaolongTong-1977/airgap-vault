package it.airgap.vault.plugin.legacystorage

import android.database.sqlite.SQLiteDatabase
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File

/**
 * One-shot migration of the legacy cordova-sqlite-storage backed vault metadata
 * to WebView localStorage.
 *
 * Background: releases <= 3.34.4 persisted Ionic Storage (localforage) through
 * cordova-sqlite-storage, whose plugin is no longer bundled (its native driver
 * is not 16 KB aligned and crashes on Android 15). The metadata therefore has
 * to be moved into the localStorage driver that replaced it.
 *
 * localforage's WebSQL/SQLite driver stored the *raw* key plus the serialized
 * value in a `keyvaluepairs (id, key, value)` table, while its localStorage
 * driver addresses keys as `<name>/<key>` with the identical serialized value.
 * Copying the raw pairs across therefore round-trips transparently.
 */
@CapacitorPlugin(name = "LegacyStorageMigration")
class LegacyStorageMigration : Plugin() {

    @PluginMethod
    fun migrate(call: PluginCall) {
        val context = context ?: run {
            call.reject("no context")
            return
        }

        val entries = JSArray()
        var found = false
        var migratedDb: File? = null

        for (dbName in context.databaseList()) {
            // Legacy cordova-sqlite-storage named the database after the
            // localforage instance (`__airgap_storage`); tolerate the
            // optional `.db` suffix some plugin versions appended.
            val normalized = dbName.removeSuffix(".db")
            if (normalized != DB_NAME) continue

            val dbFile = context.getDatabasePath(dbName)
            if (!dbFile.exists()) continue

            val extracted = try {
                extractKeyValuePairs(dbFile)
            } catch (e: Exception) {
                null
            }

            if (extracted != null && extracted.length() > 0) {
                found = true
                for (i in 0 until extracted.length()) {
                    entries.put(extracted.get(i))
                }
                migratedDb = dbFile
                // Only the first matching database is authoritative.
                break
            }
        }

        // Rename the migrated database so the one-shot migration cannot rerun
        // (and the WebView no longer opens stale data). Best-effort.
        migratedDb?.let {
            try {
                it.renameTo(File(it.path + MIGRATED_SUFFIX))
            } catch (e: Exception) {
                /* best effort */
            }
        }

        call.resolve(
            JSObject().apply {
                put("found", found)
                put("entries", entries)
            }
        )
    }

    private fun extractKeyValuePairs(dbFile: File): JSArray {
        val out = JSArray()
        val db = SQLiteDatabase.openDatabase(
            dbFile.path,
            null,
            SQLiteDatabase.OPEN_READONLY,
            null
        )
        try {
            // Confirm the expected localforage table exists before reading.
            val tableCursor = db.rawQuery(
                "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
                arrayOf(TABLE_NAME)
            )
            val hasTable = tableCursor.count > 0
            tableCursor.close()
            if (!hasTable) return out

            val cursor = db.rawQuery(
                "SELECT key, value FROM $TABLE_NAME WHERE key IS NOT NULL",
                null
            )
            try {
                val keyIdx = cursor.getColumnIndexOrThrow("key")
                val valueIdx = cursor.getColumnIndexOrThrow("value")
                while (cursor.moveToNext()) {
                    val key = cursor.getString(keyIdx)
                    val value = cursor.getString(valueIdx) ?: continue
                    out.put(
                        JSObject().apply {
                            put("key", key)
                            put("value", value)
                        }
                    )
                }
            } finally {
                cursor.close()
            }
        } finally {
            db.close()
        }
        return out
    }

    private companion object {
        const val DB_NAME = "__airgap_storage"
        const val TABLE_NAME = "keyvaluepairs"
        const val MIGRATED_SUFFIX = ".migrated_v3_35_0"
    }
}
