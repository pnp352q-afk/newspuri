// 자료 창고: data/news.db (SQLite, 파일 하나짜리 DB). Node 내장 node:sqlite 를 쓴다.
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { p } from './paths.js';

export function openDb() {
  fs.mkdirSync(p('data'), { recursive: true });
  const db = new DatabaseSync(process.env.NEWSPURI_DB || p('data/news.db')); // 시험 때만 NEWSPURI_DB 로 다른 파일
  db.exec(`
    PRAGMA journal_mode = WAL;
    -- 공시 목록(DART list.json 한 줄 = 한 행)
    CREATE TABLE IF NOT EXISTS disclosure (
      rcept_no   TEXT PRIMARY KEY,  -- 접수번호(공시 고유번호)
      corp_code  TEXT, corp_name TEXT, stock_code TEXT, corp_cls TEXT,
      report_nm  TEXT, rcept_dt TEXT, flr_nm TEXT, rm TEXT,
      event_type TEXT,              -- config/event_types.csv 의 코드
      is_fix     INTEGER DEFAULT 0, -- 정정 공시면 1
      source     TEXT NOT NULL,     -- 허락 대장의 출처(dart / sample)
      fetched_at TEXT NOT NULL
    );
    -- 이어받기 장부: 끝낸 날짜·쪽을 적는다
    CREATE TABLE IF NOT EXISTS fetch_done (
      source TEXT, day TEXT, page INTEGER, total_page INTEGER, n INTEGER, done_at TEXT,
      PRIMARY KEY (source, day, page)
    );
    -- 일별 종가(사건 연구 재료). 원천은 허락 대장을 지난 곳만
    CREATE TABLE IF NOT EXISTS price (
      code TEXT, day TEXT, close REAL, source TEXT,
      PRIMARY KEY (code, day)
    );
    -- 사건 연구 결과(공시 종류 × 기간)
    CREATE TABLE IF NOT EXISTS event_stats (
      event_type TEXT, horizon INTEGER, median_ar REAL, n INTEGER,
      period_from TEXT, period_to TEXT, source TEXT, computed_at TEXT,
      PRIMARY KEY (event_type, horizon)
    );
    -- 공시 원문 글(해석 때 받은 것) — check.js 가 근거 문장을 인터넷 없이 다시 대조한다
    CREATE TABLE IF NOT EXISTS document (
      rcept_no TEXT PRIMARY KEY, text TEXT NOT NULL, fetched_at TEXT
    );
    -- LLM 해석(공시 하나에 한 번만)
    CREATE TABLE IF NOT EXISTS interpretation (
      rcept_no TEXT PRIMARY KEY, json TEXT NOT NULL, model TEXT, source TEXT, created_at TEXT
    );
  `);
  return db;
}

export const now = () => new Date().toISOString();
