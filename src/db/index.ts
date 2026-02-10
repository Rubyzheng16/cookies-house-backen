// SQLite 数据库初始化，与 README 中 users / emotion_cookies / cookie_goals 表设计一致
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, 'emotion_house.db');

export const db = new Database(dbPath);

// 基础表：用户表 + 情绪饼干表 + 目标表
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wx_open_id TEXT NOT NULL UNIQUE,
    phone TEXT,
    vip_level TEXT NOT NULL DEFAULT 'free',
    settings TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_wx_open_id ON users(wx_open_id);

  -- 情绪饼干：一行代表某用户某一天的数据（entries/analysis 以 JSON 文本存储）
  CREATE TABLE IF NOT EXISTS emotion_cookies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    data TEXT NOT NULL, -- { entries: CookieEntry[], analysis?: string }
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    is_deleted INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_emotion_cookies_user_date
    ON emotion_cookies(user_id, date);

  -- 目标数据：与 README 中 cookie_goals 表对齐，steps 等结构也放 JSON
  CREATE TABLE IF NOT EXISTS cookie_goals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    steps TEXT NOT NULL, -- GoalStep[] JSON
    candy_count INTEGER NOT NULL DEFAULT 0,
    is_completed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_cookie_goals_user
    ON cookie_goals(user_id);
`);

export interface UserRow {
  id: number;
  wx_open_id: string;
  phone: string | null;
  vip_level: string;
  settings: string;
  created_at: string;
  updated_at: string;
}

export function findUserByWxOpenId(wxOpenId: string): UserRow | undefined {
  const row = db.prepare('SELECT * FROM users WHERE wx_open_id = ?').get(wxOpenId) as UserRow | undefined;
  return row;
}

export function createUser(wxOpenId: string, phone?: string): UserRow {
  const now = new Date().toISOString();
  const id = db.prepare(
    `INSERT INTO users (wx_open_id, phone, vip_level, settings, created_at, updated_at)
     VALUES (?, ?, 'free', '{}', ?, ?)`
  ).run(wxOpenId, phone ?? null, now, now);
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id.lastInsertRowid) as UserRow;
  return row;
}

export function updateUserPhone(userId: number, phone: string): void {
  const now = new Date().toISOString();
  db.prepare('UPDATE users SET phone = ?, updated_at = ? WHERE id = ?').run(phone, now, userId);
}

export function getUserById(userId: number): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow | undefined;
}

// ========== 情绪饼干：仅供 VIP 云端存储使用 ==========

export interface EmotionDayRow {
  id: number;
  user_id: number;
  date: string;
  data: string;
  created_at: string;
  updated_at: string;
  is_deleted: number;
}

/** 保存（插入或更新）某用户某一天的情绪饼干数据；data 为 JSON 字符串 */
export function upsertEmotionDay(userId: number, date: string, dataJson: string): EmotionDayRow {
  const now = new Date().toISOString();
  const existed = db
    .prepare('SELECT id FROM emotion_cookies WHERE user_id = ? AND date = ? AND is_deleted = 0')
    .get(userId, date) as { id: number } | undefined;

  if (existed) {
    db.prepare(
      'UPDATE emotion_cookies SET data = ?, updated_at = ? WHERE id = ?'
    ).run(dataJson, now, existed.id);
    return db
      .prepare('SELECT * FROM emotion_cookies WHERE id = ?')
      .get(existed.id) as EmotionDayRow;
  }

  const result = db
    .prepare(
      'INSERT INTO emotion_cookies (user_id, date, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    )
    .run(userId, date, dataJson, now, now);

  return db
    .prepare('SELECT * FROM emotion_cookies WHERE id = ?')
    .get(result.lastInsertRowid) as EmotionDayRow;
}

/** 查询某用户最近 N 天（或半年内）的情绪饼干 */
export function listEmotionDaysWithinMonths(
  userId: number,
  months: number
): EmotionDayRow[] {
  const now = new Date();
  const since = new Date();
  since.setMonth(now.getMonth() - months);
  const sinceIso = since.toISOString();

  return db
    .prepare(
      `SELECT * FROM emotion_cookies
       WHERE user_id = ?
         AND is_deleted = 0
         AND created_at >= ?
       ORDER BY date DESC`
    )
    .all(userId, sinceIso) as EmotionDayRow[];
}
