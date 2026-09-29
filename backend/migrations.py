"""Upgrade saved configurations without accepting retired effects in the API."""
import json
import time
from .models import Settings


def migrate_native_breathing(store):
    # One transaction keeps active settings, scenes and the audit event together.
    # Do not rewrite events: they describe what actually happened in the past.
    with store.lock, store.db:
        before = {}
        after = {}
        stored = store.get('configuration')
        if stored and stored['config'].get('lights', {}).get('effect') == 'breathe':
            before['configuration'] = json.loads(json.dumps(stored))
            stored['config']['lights']['effect'] = 'native_breathe'
            stored['config'] = Settings.model_validate(stored['config']).model_dump()
            stored['version'] += 1
            store.db.execute('UPDATE settings SET value=? WHERE key=?',
                             (json.dumps(stored, ensure_ascii=False), 'configuration'))
            after['configuration'] = stored
        for row in store.query('SELECT id,config FROM scenes'):
            config = json.loads(row['config'])
            if config.get('lights', {}).get('effect') != 'breathe':
                continue
            before.setdefault('scenes', {})[row['id']] = json.loads(row['config'])
            config['lights']['effect'] = 'native_breathe'
            config = Settings.model_validate(config).model_dump()
            store.db.execute('UPDATE scenes SET config=? WHERE id=?',
                             (json.dumps(config, ensure_ascii=False), row['id']))
            after.setdefault('scenes', {})[row['id']] = config
        if before:
            store.db.execute(
                'INSERT INTO events(ts,kind,source,before_json,after_json,outcome) VALUES (?,?,?,?,?,?)',
                (time.time(), 'system.migrate', 'native-breathing-1.3',
                 json.dumps(before, ensure_ascii=False), json.dumps(after, ensure_ascii=False), 'success'))
