import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import initSqlJs from 'sql.js'

const require = createRequire(import.meta.url)
const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm')
const databasePath = resolve(process.env.CBT_DATABASE_PATH || 'data/cbt-workspace.sqlite')
let databasePromise
let SQLModule
let writeQueue = Promise.resolve()

async function openDatabase() {
  if (!databasePromise) {
    databasePromise = (async () => {
      const SQL = await initSqlJs({ locateFile: () => wasmPath })
      SQLModule = SQL
      await mkdir(dirname(databasePath), { recursive: true })
      let database
      try {
        database = new SQL.Database(new Uint8Array(await readFile(databasePath)))
      } catch (error) {
        if (error.code !== 'ENOENT') throw new Error(`Database ${databasePath} tidak dapat dibaca: ${error.message}`)
        database = new SQL.Database()
      }
      database.run(`
        PRAGMA journal_mode = DELETE;
        CREATE TABLE IF NOT EXISTS workspace (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          data_json TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS images (
          path TEXT PRIMARY KEY,
          filename TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          content BLOB NOT NULL,
          size INTEGER NOT NULL,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `)
      return database
    })().catch((error) => {
      databasePromise = null
      throw error
    })
  }
  return databasePromise
}

async function persistDatabase(database) {
  const temporaryPath = `${databasePath}.${process.pid}.tmp`
  try {
    await writeFile(temporaryPath, Buffer.from(database.export()))
    await rename(temporaryPath, databasePath)
  } catch (error) {
    throw new Error(`Database lokal gagal ditulis (${databasePath}): ${error.message}`)
  }
}

function queueWrite(operation) {
  const write = writeQueue.then(async () => {
    const database = await openDatabase()
    const snapshot = database.export()
    database.run('BEGIN TRANSACTION')
    let committed = false
    try {
      const result = operation(database)
      database.run('COMMIT')
      committed = true
      await persistDatabase(database)
      return result
    } catch (error) {
      if (committed) {
        database.close()
        databasePromise = Promise.resolve(new SQLModule.Database(snapshot))
      } else {
        try {
          database.run('ROLLBACK')
        } catch {
          database.close()
          databasePromise = Promise.resolve(new SQLModule.Database(snapshot))
        }
      }
      throw error
    }
  })
  writeQueue = write.catch(() => {})
  return write
}

function queryRows(database, query, parameters = []) {
  const statement = database.prepare(query)
  try {
    statement.bind(parameters)
    const rows = []
    while (statement.step()) rows.push(statement.getAsObject())
    return rows
  } finally {
    statement.free()
  }
}

export async function readWorkspace() {
  const database = await openDatabase()
  const rows = queryRows(database, 'SELECT data_json FROM workspace WHERE id = 1')
  return rows.length ? JSON.parse(rows[0].data_json) : null
}

export async function writeWorkspace(data) {
  const dataJson = JSON.stringify(data)
  if (typeof dataJson !== 'string') throw new Error('Data workspace bukan JSON yang valid.')
  await queueWrite((database) => {
    const statement = database.prepare(`
      INSERT INTO workspace (id, data_json, updated_at)
      VALUES (1, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json, updated_at = CURRENT_TIMESTAMP
    `)
    try {
      statement.run([dataJson])
    } finally {
      statement.free()
    }
  })
}

export async function listImages() {
  const database = await openDatabase()
  return queryRows(database, 'SELECT path, filename, mime_type AS type, size FROM images ORDER BY path')
}

export async function readImage(path) {
  const database = await openDatabase()
  const statement = database.prepare('SELECT path, filename, mime_type AS type, content, size FROM images WHERE path = ?')
  try {
    statement.bind([path])
    if (!statement.step()) return null
    const row = statement.getAsObject()
    return {
      path: row.path,
      filename: row.filename,
      type: row.type,
      size: row.size,
      blob: Buffer.from(row.content),
    }
  } finally {
    statement.free()
  }
}

export async function writeImage({ path, filename, type, content }) {
  await queueWrite((database) => {
    const statement = database.prepare(`
      INSERT INTO images (path, filename, mime_type, content, size, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(path) DO UPDATE SET filename = excluded.filename,
        mime_type = excluded.mime_type, content = excluded.content, size = excluded.size,
        updated_at = CURRENT_TIMESTAMP
    `)
    try {
      statement.run([path, filename, type, content, content.byteLength])
    } finally {
      statement.free()
    }
  })
}
