import hashlib
import json
import secrets
import sqlite3
import threading
import time
from pathlib import Path

def hashed(value): return hashlib.sha256(value.encode()).hexdigest()

def password_hash(password, salt=None):
    salt=salt or secrets.token_hex(16)
    return salt+':'+hashlib.pbkdf2_hmac('sha256',password.encode(),bytes.fromhex(salt),600000).hex()

def check_password(password, stored):
    return secrets.compare_digest(password_hash(password,stored.split(':')[0]),stored)

class Store:
    def __init__(self, root:Path):
        self.root=root
        for name in ['state','history','frames','assets','exports']: (root/name).mkdir(parents=True,exist_ok=True)
        self.lock=threading.RLock()
        self.db=sqlite3.connect(root/'state/control.db',check_same_thread=False)
        self.db.row_factory=sqlite3.Row
        self.db.executescript('''PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
        PRAGMA journal_size_limit=4194304; PRAGMA max_page_count=131072;
        CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY,ts REAL,kind TEXT,source TEXT,request_id TEXT UNIQUE,payload_hash TEXT,before_json TEXT,after_json TEXT,outcome TEXT,error TEXT);
        CREATE INDEX IF NOT EXISTS events_ts ON events(ts);
        CREATE TABLE IF NOT EXISTS metrics(ts REAL PRIMARY KEY,temperature REAL,cpu_fan_rpm INTEGER,cpu_percent REAL,memory_percent REAL,case_level INTEGER);
        CREATE TABLE IF NOT EXISTS frames(id INTEGER PRIMARY KEY,ts REAL,pixel_hash TEXT,pixels BLOB NOT NULL,mode TEXT);
        CREATE TABLE IF NOT EXISTS tokens(id TEXT PRIMARY KEY,name TEXT,hash TEXT UNIQUE,scope TEXT,created REAL,expires REAL,last_used REAL,kind TEXT);
        CREATE TABLE IF NOT EXISTS scenes(id TEXT PRIMARY KEY,name TEXT,icon TEXT,config TEXT,builtin INTEGER DEFAULT 0);
        PRAGMA user_version=1;''')
        if self.query('PRAGMA quick_check')[0]['quick_check']!='ok': raise RuntimeError('Database integrity check failed')

    def query(self, sql,args=()):
        with self.lock: return [dict(r) for r in self.db.execute(sql,args).fetchall()]
    def execute(self, sql,args=()):
        with self.lock,self.db: return self.db.execute(sql,args).lastrowid
    def get(self,key,default=None):
        rows=self.query('SELECT value FROM settings WHERE key=?',(key,))
        return json.loads(rows[0]['value']) if rows else default
    def set(self,key,value): self.execute('INSERT OR REPLACE INTO settings VALUES (?,?)',(key,json.dumps(value,ensure_ascii=False)))
    def event(self,kind,source,before,after,outcome='success',error=None,request_id=None,payload_hash=None):
        return self.execute('INSERT INTO events(ts,kind,source,request_id,payload_hash,before_json,after_json,outcome,error) VALUES (?,?,?,?,?,?,?,?,?)',(time.time(),kind,source,request_id,payload_hash,json.dumps(before,ensure_ascii=False),json.dumps(after,ensure_ascii=False),outcome,error))
    def token(self,name,scope,days=90,kind='api',raw=None):
        raw=raw or 'pc_'+secrets.token_urlsafe(32)
        ident=secrets.token_hex(8)
        self.execute('INSERT INTO tokens VALUES (?,?,?,?,?,?,?,?)',(ident,name,hashed(raw),scope,time.time(),time.time()+days*86400,None,kind))
        return ident,raw
    def authenticate(self,raw):
        if not raw or len(raw)>256:return None
        rows=self.query('SELECT id,name,scope,kind,expires FROM tokens WHERE hash=? AND expires>?',(hashed(raw),time.time()))
        if not rows:return None
        row=rows[0]
        self.execute('UPDATE tokens SET last_used=? WHERE id=?',(time.time(),row['id']))
        return row
    def prune(self):
        week=time.time()-7*86400
        with self.lock,self.db:
            self.db.execute('DELETE FROM tokens WHERE expires<?',(time.time(),))
            self.db.execute('DELETE FROM frames WHERE ts<? OR id < COALESCE((SELECT id FROM frames ORDER BY id DESC LIMIT 1 OFFSET 99999),0)',(week,))
            self.db.execute('DELETE FROM metrics WHERE ts<?',(week,))
            self.db.execute('DELETE FROM events WHERE id < COALESCE((SELECT id FROM events ORDER BY id DESC LIMIT 1 OFFSET 49999),0)')
        with self.lock: self.db.execute('PRAGMA wal_checkpoint(PASSIVE)')
    def backup(self,path):
        with self.lock:
            dest=sqlite3.connect(path)
            try: self.db.backup(dest)
            finally: dest.close()
