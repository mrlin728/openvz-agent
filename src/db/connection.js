import Database from 'better-sqlite3'
import { paths } from '../paths.js'
import { initializeSchema } from './schema.js'
import { completeUpgradeMigration, prepareUpgradeBackup, restoreUpgradeBackup } from '../upgrade-migration.js'

const DB_PATH = paths.dbFile

let db

export function getDB() {
  if (!db) {
    prepareUpgradeBackup({ userDir: paths.userDir, configFile: paths.configFile, dbFile: DB_PATH })
    try {
      db = new Database(DB_PATH)
      db.pragma('journal_mode = WAL')
      initializeSchema(db)
      completeUpgradeMigration({ userDir: paths.userDir })
    } catch (error) {
      try { db?.close() } catch {}
      db = undefined
      const restored = restoreUpgradeBackup({ userDir: paths.userDir })
      throw new Error(`OpenVZ Agent data migration failed${restored ? '; the pre-upgrade backup was restored' : ''}: ${error.message}`, { cause: error })
    }
  }
  return db
}

export function closeDBForTest() {
  if (!db) return
  db.close()
  db = null
}
