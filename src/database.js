import initSqlJs from 'sql.js'
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import { createMatchRowId, OPTION_QUESTION_TYPES } from './model'

const SCHEMA = [
  'PRAGMA foreign_keys = ON',
  `CREATE TABLE categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    sort_order INTEGER DEFAULT 0
  )`,
  `CREATE TABLE packages (
    id TEXT PRIMARY KEY,
    category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    difficulty TEXT DEFAULT '',
    sort_order INTEGER DEFAULT 0
  )`,
  `CREATE TABLE questions (
    id TEXT PRIMARY KEY,
    package_id TEXT NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
    position INTEGER DEFAULT 0,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    explanation TEXT DEFAULT ''
  )`,
  `CREATE TABLE options (
    id TEXT PRIMARY KEY,
    question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    option_text TEXT NOT NULL,
    is_correct INTEGER DEFAULT 0,
    score_weight REAL,
    position INTEGER DEFAULT 0
  )`,
  `CREATE TABLE matches (
    id TEXT PRIMARY KEY,
    question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    premise_text TEXT NOT NULL,
    target_id TEXT NOT NULL
  )`,
  `CREATE TABLE targets (
    id TEXT PRIMARY KEY,
    question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    target_text TEXT NOT NULL,
    position INTEGER DEFAULT 0
  )`,
  `CREATE TABLE learning_materials (
    id TEXT PRIMARY KEY,
    category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    summary TEXT DEFAULT '',
    content TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0
  )`,
  'CREATE INDEX idx_learning_materials_category_order ON learning_materials(category_id, sort_order, title)',
]

let sqlPromise

async function getSql() {
  if (!sqlPromise) {
    sqlPromise = initSqlJs({ locateFile: () => sqlWasmUrl }).catch((error) => {
      sqlPromise = null
      throw new Error(`Mesin SQLite gagal dimuat: ${error.message}`)
    })
  }
  return sqlPromise
}

function insertRows(db, table, columns, rows) {
  if (!rows.length) return
  const statement = db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
  try {
    rows.forEach((values) => statement.run(values))
  } finally {
    statement.free()
  }
}

export async function buildDatabase(data) {
  const SQL = await getSql()
  const db = new SQL.Database()
  let inTransaction = false
  try {
    db.run(SCHEMA.join(';'))
    const categories = data.categories.map((item, index) => [item.id, item.name.trim(), item.description.trim(), index + 1])
    const packages = data.packages.map((item, index) => [item.id, item.category_id, item.title.trim(), item.description.trim(), item.difficulty.trim(), index + 1])
    const questions = data.questions.map((item) => {
      const position = data.questions.filter((question) => question.package_id === item.package_id).findIndex((question) => question.id === item.id) + 1
      return [item.id, item.package_id, position, item.type, item.content, item.explanation || '']
    })
    const options = data.questions.flatMap((question) => (OPTION_QUESTION_TYPES.includes(question.type) ? question.options || [] : []).map((option, index) => [
      option.id,
      question.id,
      option.option_text,
      option.is_correct ? 1 : 0,
      option.score_weight === '' || option.score_weight === null || option.score_weight === undefined ? null : Number(option.score_weight),
      index + 1,
    ]))
    const matches = data.questions.flatMap((question) => (question.matches || []).map((match, index) => [
      createMatchRowId(question.id, index), question.id, match.premise_text, match.target_id,
    ]))
    const targets = data.questions.flatMap((question) => (question.targets || []).map((target, index) => [
      target.id, question.id, target.target_text, index + 1,
    ]))
    const materials = data.materials.map((item, index) => [
      item.id, item.category_id || null, item.title.trim(), item.summary.trim(), item.content, index + 1,
    ])

    db.run('BEGIN TRANSACTION')
    inTransaction = true
    insertRows(db, 'categories', ['id', 'name', 'description', 'sort_order'], categories)
    insertRows(db, 'packages', ['id', 'category_id', 'title', 'description', 'difficulty', 'sort_order'], packages)
    insertRows(db, 'questions', ['id', 'package_id', 'position', 'type', 'content', 'explanation'], questions)
    insertRows(db, 'options', ['id', 'question_id', 'option_text', 'is_correct', 'score_weight', 'position'], options)
    insertRows(db, 'targets', ['id', 'question_id', 'target_text', 'position'], targets)
    insertRows(db, 'matches', ['id', 'question_id', 'premise_text', 'target_id'], matches)
    insertRows(db, 'learning_materials', ['id', 'category_id', 'title', 'summary', 'content', 'sort_order'], materials)
    db.run('COMMIT')
    inTransaction = false

    const integrity = db.exec('PRAGMA integrity_check')[0]?.values?.[0]?.[0]
    if (integrity !== 'ok') throw new Error(`Pemeriksaan integritas SQLite gagal: ${integrity || 'hasil kosong'}.`)
    const foreignKeyErrors = db.exec('PRAGMA foreign_key_check')
    if (foreignKeyErrors.length) throw new Error('Pemeriksaan foreign key SQLite menemukan relasi yang tidak valid.')
    return db.export()
  } catch (error) {
    if (inTransaction) db.run('ROLLBACK')
    throw new Error(`Database gagal dibuat: ${error.message}`)
  } finally {
    db.close()
  }
}
