#!/usr/bin/env python3
"""Prepare an assets-only cf CLI deployment from the static demo build.

Uses the v0 Build Output Specification supported by cf 1.0.0-beta.5.
Only frontend/dist-demo is copied; no backend or runtime data is uploaded.
"""
import argparse
import json
import re
import shutil
from pathlib import Path

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--name', default='pi-control-demo')
parser.add_argument('--domain', help='Optional custom hostname in your Cloudflare account')
args = parser.parse_args()
if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,62}', args.name):
    parser.error('Invalid Worker name')
if args.domain and not re.fullmatch(r'[a-z0-9.-]+\.[a-z]{2,}', args.domain):
    parser.error('Use a hostname without a scheme or path')
source = root / 'frontend/dist-demo'
if not (source / '_headers').is_file() or not (source / 'index.html').is_file():
    parser.error('Run npm --prefix frontend run build:demo first')
for path in source.rglob('*'):
    if path.is_symlink() or path.suffix in {'.py', '.db', '.sqlite', '.pem', '.key', '.map'} or path.name.startswith('.env'):
        raise SystemExit(f'Refusing unexpected deployment file: {path.relative_to(source)}')
output = root / '.cloudflare/output/v0'
if output.exists():
    shutil.rmtree(output)
worker = output / 'workers/default'
shutil.copytree(source, worker / 'assets')
config = {
    'name': args.name,
    'compatibilityDate': '2026-09-29',
    'assets': {'htmlHandling': 'auto-trailing-slash', 'notFoundHandling': 'none'},
    'observability': {'enabled': False},
}
if args.domain:
    config['domains'] = [args.domain]
(worker / 'worker.config.json').write_text(json.dumps(config, indent=2) + '\n')
(output / 'config.json').write_text(json.dumps({'buildContext': {'isPreview': False}}) + '\n')
print('Prepared static assets only. Deploy from the project root with: cf deploy --prebuilt')
