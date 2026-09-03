/**
 * Shared owner-only persistence kernel for capability credential stores.
 *
 * One serialized operation queue, one read path, and one atomic-write path:
 * ensure the 0700 directory, write a `wx` temp file, chmod it to 0600, rename
 * it into place, and unlink the temp file on failure. Domain stores keep their
 * schema, migration, and in-memory state; they only delegate I/O, queueing,
 * and permission handling here.
 */

import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** Legacy byte format shared by every current store: pretty JSON plus a trailing newline. */
function defaultSerialize(document) {
  return `${JSON.stringify(document, null, 2)}\n`
}

export class OwnerFileStore {
  constructor({
    path,
    dirMode = 0o700,
    fileMode = 0o600,
    parse,
    serialize = defaultSerialize,
    onInvalid = () => {},
  }) {
    this.path = path
    this.dirMode = dirMode
    this.fileMode = fileMode
    this.parse = parse
    this.serialize = serialize
    this.onInvalid = onInvalid
    this.closed = false
    this.operations = Promise.resolve()
  }

  /**
   * Read and parse the document. Resolves to the parsed document, to null when
   * the file is missing (ENOENT), or to undefined when the content is invalid.
   * An invalid content outcome is reported through onInvalid and leaves the
   * caller free to keep its last good state.
   */
  async load() {
    let text
    try {
      text = await readFile(this.path, 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') return null
      throw error
    }
    try {
      return this.parse(text)
    } catch (error) {
      this.onInvalid(error)
      return undefined
    }
  }

  /** Atomically replace the document; a failed write leaves no temp file behind. */
  async commit(document) {
    await mkdir(dirname(this.path), { recursive: true, mode: this.dirMode })
    const temp = `${this.path}.tmp-${process.pid}`
    try {
      await writeFile(temp, this.serialize(document), { flag: 'wx' })
      await chmod(temp, this.fileMode)
      await rename(temp, this.path)
    } catch (error) {
      await unlink(temp).catch(() => {})
      throw error
    }
  }

  /** Enqueue one operation behind earlier ones; a failed operation never breaks the chain. */
  enqueue(operation) {
    if (this.closed) return Promise.reject(new Error('owner file store is closed'))
    const task = this.operations.then(operation)
    this.operations = task.then(() => undefined, () => undefined)
    return task
  }

  /** Stop accepting operations and wait for the queue to drain. */
  async close() {
    this.closed = true
    await this.operations
  }
}
