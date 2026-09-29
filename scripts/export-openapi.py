#!/usr/bin/env python3
"""Export the schema without running the controller, database or hardware."""
import json,sys
from pathlib import Path
root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root))
from backend.main import app
schema=app.openapi()
schema['servers']=[{'url':'http://localhost:8080','description':'Your Pi Control service'}]
(root/'frontend/public/openapi.json').write_text(json.dumps(schema,ensure_ascii=False,indent=2)+'\n')
