// [[B2]] webTryDesktopFull, [[B18]] safeToShare: the Android app's files (docs/android.md § Folders on Android).
// Android gives an app the folders the user picks in its own folder picker (the Storage Access Framework), nothing
// else. This plugin asks for one, keeps the grant across restarts, and lists, reads and writes inside it. A path is the
// folder's tree address and a relative path under it: `content://…/tree/<id>/Notes/a.md`. scripts/android-prep.mjs
// copies this file into the generated project; src-tauri/src/saf.rs registers it and forwards the web side's calls.
package com.solenoid.app

import android.app.Activity
import android.content.ContentResolver
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import android.util.Base64
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.util.concurrent.Executors

@TauriPlugin
class SafPlugin(private val activity: Activity) : Plugin(activity) {
  // Off the main thread: walking a big vault takes a while, and the webview must keep drawing meanwhile.
  private val io = Executors.newSingleThreadExecutor()
  private val resolver: ContentResolver
    get() = activity.contentResolver

  // Document ids by tree and relative path, so a deep path isn't found again from the top on every call. Anything that
  // makes, moves or deletes a document clears it, and so does any failure (the folder may have changed outside).
  private val ids = HashMap<String, String>()

  private class Target(val tree: Uri, val rel: List<String>)

  private class Child(val id: String, val name: String, val dir: Boolean)

  private fun parse(path: String): Target {
    val m = Regex("^(content://[^/]+/tree/[^/]+)(?:/(.*))?$").find(path)
      ?: throw IllegalArgumentException("Not a folder Solenoid was given: $path")
    return Target(Uri.parse(m.groupValues[1]), m.groupValues[2].split('/').filter { it.isNotEmpty() })
  }

  private fun docUri(t: Target, id: String): Uri = DocumentsContract.buildDocumentUriUsingTree(t.tree, id)

  private fun children(tree: Uri, parentId: String): List<Child> {
    val uri = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parentId)
    val cols = arrayOf(
      DocumentsContract.Document.COLUMN_DOCUMENT_ID,
      DocumentsContract.Document.COLUMN_DISPLAY_NAME,
      DocumentsContract.Document.COLUMN_MIME_TYPE,
    )
    val out = ArrayList<Child>()
    resolver.query(uri, cols, null, null, null)?.use { c ->
      while (c.moveToNext()) {
        out.add(Child(c.getString(0), c.getString(1) ?: "", c.getString(2) == DocumentsContract.Document.MIME_TYPE_DIR))
      }
    }
    return out
  }

  /** The document id `upTo` parts down the target's path, or null when a part is missing. */
  private fun find(t: Target, upTo: Int = t.rel.size): String? {
    var id = DocumentsContract.getTreeDocumentId(t.tree)
    for (i in 0 until upTo) {
      val key = t.tree.toString() + "|" + t.rel.subList(0, i + 1).joinToString("/")
      val cached = ids[key]
      if (cached != null) {
        id = cached
        continue
      }
      val hit = children(t.tree, id).firstOrNull { it.name == t.rel[i] } ?: return null
      ids[key] = hit.id
      id = hit.id
    }
    return id
  }

  private fun need(t: Target): String =
    find(t) ?: throw IllegalStateException("No such file or folder: ${t.rel.joinToString("/")}")

  /** The file at the target, made empty in its folder when it doesn't exist yet. */
  private fun fileFor(t: Target): Uri {
    if (t.rel.isEmpty()) throw IllegalArgumentException("A folder isn't a file")
    find(t)?.let { return docUri(t, it) }
    val parent = find(t, t.rel.size - 1)
      ?: throw IllegalStateException("No such folder: ${t.rel.dropLast(1).joinToString("/")}")
    // A generic type keeps the name exactly as given: a typed one can gain an extension (".md.txt").
    val made = DocumentsContract.createDocument(resolver, docUri(t, parent), "application/octet-stream", t.rel.last())
      ?: throw IllegalStateException("Couldn't create ${t.rel.last()}")
    ids.clear()
    return made
  }

  private fun run(invoke: Invoke, body: (JSObject) -> JSObject?) {
    io.execute {
      try {
        val out = body(invoke.getArgs())
        if (out == null) invoke.resolve() else invoke.resolve(out)
      } catch (e: Exception) {
        ids.clear()
        invoke.reject(e.message ?: e.javaClass.simpleName)
      }
    }
  }

  @Command
  fun pickFolder(invoke: Invoke) {
    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)
    intent.addFlags(
      Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
        Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or Intent.FLAG_GRANT_PREFIX_URI_PERMISSION,
    )
    startActivityForResult(invoke, intent, "folderPicked")
  }

  @ActivityCallback
  fun folderPicked(invoke: Invoke, result: ActivityResult) {
    val uri = result.data?.data
    if (result.resultCode != Activity.RESULT_OK || uri == null) {
      invoke.resolve(JSObject())
      return
    }
    try {
      resolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
      invoke.resolve(JSObject().put("uri", uri.toString()))
    } catch (e: Exception) {
      invoke.reject(e.message ?: "Couldn't keep access to that folder")
    }
  }

  /** The folders this app still holds a grant for, so the web side can tell a lost grant from a missing file. */
  @Command
  fun grants(invoke: Invoke) = run(invoke) {
    val arr = JSArray()
    for (p in resolver.persistedUriPermissions) arr.put(p.uri.toString())
    JSObject().put("uris", arr)
  }

  @Command
  fun list(invoke: Invoke) = run(invoke) { a ->
    val t = parse(a.getString("path"))
    val arr = JSArray()
    for (c in children(t.tree, need(t))) arr.put(JSObject().put("name", c.name).put("dir", c.dir))
    JSObject().put("entries", arr)
  }

  /** Every path under the target, `depth` folders deep, skipping hidden names: folders when `folders`, else files. One
   *  call for a whole vault, where listing folder by folder would cross from the webview once per folder. */
  @Command
  fun walk(invoke: Invoke) = run(invoke) { a ->
    val t = parse(a.getString("path"))
    val depth = a.getInteger("depth", 6)
    val folders = a.getBoolean("folders", false)
    val out = JSArray()
    fun go(id: String, prefix: String, d: Int) {
      if (d > depth) return
      for (c in children(t.tree, id)) {
        if (c.name.startsWith(".")) continue
        val rel = if (prefix.isEmpty()) c.name else "$prefix/${c.name}"
        if (c.dir) {
          if (folders) out.put(rel)
          go(c.id, rel, d + 1)
        } else if (!folders) {
          out.put(rel)
        }
      }
    }
    go(need(t), "", 0)
    JSObject().put("paths", out)
  }

  /** The file's text; with `max`, at most its first `max` characters, never reading the rest. */
  @Command
  fun readText(invoke: Invoke) = run(invoke) { a ->
    val t = parse(a.getString("path"))
    val max = a.getInteger("max", -1)
    val stream = resolver.openInputStream(docUri(t, need(t))) ?: throw IllegalStateException("Couldn't open the file")
    stream.use { s ->
      val r = s.bufferedReader(Charsets.UTF_8)
      val text = if (max < 0) {
        r.readText()
      } else {
        val buf = CharArray(max)
        var n = 0
        while (n < max) {
          val k = r.read(buf, n, max - n)
          if (k < 0) break
          n += k
        }
        String(buf, 0, n)
      }
      JSObject().put("text", text)
    }
  }

  @Command
  fun writeText(invoke: Invoke) = run(invoke) { a ->
    val uri = fileFor(parse(a.getString("path")))
    val stream = resolver.openOutputStream(uri, "rwt") ?: throw IllegalStateException("Couldn't write the file")
    stream.use { it.write(a.getString("text").toByteArray(Charsets.UTF_8)) }
    null
  }

  @Command
  fun readBinary(invoke: Invoke) = run(invoke) { a ->
    val t = parse(a.getString("path"))
    val stream = resolver.openInputStream(docUri(t, need(t))) ?: throw IllegalStateException("Couldn't open the file")
    val bytes = stream.use { it.readBytes() }
    JSObject().put("base64", Base64.encodeToString(bytes, Base64.NO_WRAP))
  }

  @Command
  fun writeBinary(invoke: Invoke) = run(invoke) { a ->
    val uri = fileFor(parse(a.getString("path")))
    val stream = resolver.openOutputStream(uri, "rwt") ?: throw IllegalStateException("Couldn't write the file")
    stream.use { it.write(Base64.decode(a.getString("base64"), Base64.NO_WRAP)) }
    null
  }

  @Command
  fun exists(invoke: Invoke) = run(invoke) { a ->
    ids.clear()
    JSObject().put("exists", find(parse(a.getString("path"))) != null)
  }

  @Command
  fun stat(invoke: Invoke) = run(invoke) { a ->
    val t = parse(a.getString("path"))
    var modified: Long? = null
    resolver.query(docUri(t, need(t)), arrayOf(DocumentsContract.Document.COLUMN_LAST_MODIFIED), null, null, null)?.use { c ->
      if (c.moveToFirst() && !c.isNull(0)) modified = c.getLong(0)
    }
    JSObject().put("mtime", modified)
  }

  /** Makes the folder and any missing folder above it. */
  @Command
  fun mkdir(invoke: Invoke) = run(invoke) { a ->
    val t = parse(a.getString("path"))
    var id = DocumentsContract.getTreeDocumentId(t.tree)
    for (i in t.rel.indices) {
      val next = find(Target(t.tree, t.rel.subList(0, i + 1)))
      id = next
        ?: DocumentsContract.createDocument(resolver, docUri(t, id), DocumentsContract.Document.MIME_TYPE_DIR, t.rel[i])
          ?.let { DocumentsContract.getDocumentId(it) }
        ?: throw IllegalStateException("Couldn't make the folder ${t.rel[i]}")
    }
    ids.clear()
    null
  }

  /** Moves or renames a file, replacing what is at `to` (a save writes beside the file, then renames over it). */
  @Command
  fun rename(invoke: Invoke) = run(invoke) { a ->
    val from = parse(a.getString("from"))
    val to = parse(a.getString("to"))
    if (from.rel.isEmpty() || to.rel.isEmpty()) throw IllegalArgumentException("Can't rename a granted folder itself")
    var uri = docUri(from, need(from))
    find(to)?.let { DocumentsContract.deleteDocument(resolver, docUri(to, it)) }
    ids.clear()
    if (from.tree != to.tree || from.rel.dropLast(1) != to.rel.dropLast(1)) {
      val src = find(from, from.rel.size - 1) ?: throw IllegalStateException("No such folder")
      val dst = find(to, to.rel.size - 1) ?: throw IllegalStateException("No such folder: ${to.rel.dropLast(1).joinToString("/")}")
      uri = DocumentsContract.moveDocument(resolver, uri, docUri(from, src), docUri(to, dst))
        ?: throw IllegalStateException("Couldn't move ${from.rel.last()}")
    }
    if (from.rel.last() != to.rel.last()) {
      DocumentsContract.renameDocument(resolver, uri, to.rel.last()) ?: throw IllegalStateException("Couldn't rename ${from.rel.last()}")
    }
    ids.clear()
    null
  }
}
