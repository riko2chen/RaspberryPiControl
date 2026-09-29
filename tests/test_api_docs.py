"""Check that the published API reference agrees with actual requests/responses."""
from copy import deepcopy
from fastapi.routing import APIRoute
from jsonschema import Draft202012Validator
from openapi_spec_validator import validate_spec
from test_control import client, login
from backend.api_docs import OPERATIONS

def validator(spec, schema):
    return Draft202012Validator({**schema, 'components': spec['components']})

def test_openapi_covers_routes_and_declares_auth(client):
    from backend.main import app
    assert client.get('/api/docs').status_code == 401
    assert client.get('/api/v1/openapi.json').status_code == 401
    login(client)
    spec=client.get('/api/v1/openapi.json').json()
    validate_spec(spec)
    assert spec['openapi']=='3.1.0'
    assert '/' not in spec['paths'] and '/api/v1/live' not in spec['paths']
    assert spec['x-websocket']['url']=='/api/v1/live'
    operation_ids=[]
    for route in app.routes:
        if not isinstance(route,APIRoute) or not route.include_in_schema:continue
        assert route.name in OPERATIONS
        for method in route.methods:
            operation=spec['paths'][route.path][method.lower()]
            operation_ids.append(operation['operationId'])
            assert operation['summary'] and operation['description'] and operation['tags']
            scope=OPERATIONS[route.name][2]
            assert operation['x-required-scope']==(scope or 'public')
            assert bool(operation['security'])==bool(scope)
            if scope:assert '401' in operation['responses']
            for content in operation.get('requestBody',{}).get('content',{}).values():
                if 'example' in content:validator(spec,content['schema']).validate(content['example'])
            for response in operation['responses'].values():
                for content in response.get('content',{}).values():
                    if 'example' in content:validator(spec,content['schema']).validate(content['example'])
    assert len(operation_ids)==len(set(operation_ids))==32
    html=client.get('/api/docs')
    assert html.status_code==200
    assert "script-src 'self'" in html.headers['Content-Security-Policy']
    assert '/assets/api-docs/swagger-ui-bundle.js' in html.text
    assert '<script>' not in html.text
    for file in ['swagger-ui-bundle.js','swagger-ui.css','docs.js','docs.css']:
        assert client.get('/assets/api-docs/'+file).status_code==200

def test_documented_models_match_read_responses(client):
    state=login(client);spec=client.get('/api/v1/openapi.json').json()
    paths=['/healthz','/readyz','/api/v1/device','/api/v1/status','/api/v1/hardware',
           '/api/v1/devices','/api/v1/oled/frame','/api/v1/events','/api/v1/metrics',
           '/api/v1/frames','/api/v1/scenes','/api/v1/tokens']
    for path in paths:
        response=client.get(path)
        assert response.status_code==200, path
        schema=spec['paths'][path]['get']['responses']['200']['content']['application/json']['schema']
        validator(spec,schema).validate(response.json())
    frame=client.get('/api/v1/frames').json()['items'][0]
    path='/api/v1/frames/{frame_id}'
    response=client.get('/api/v1/frames/'+str(frame['id']))
    validator(spec,spec['paths'][path]['get']['responses']['200']['content']['application/json']['schema']).validate(response.json())

def test_control_and_error_examples_follow_runtime_contract(client):
    state=login(client);spec=client.get('/api/v1/openapi.json').json()
    op=spec['paths']['/api/v1/fans/case']['put']
    body=deepcopy(op['requestBody']['content']['application/json']['example'])
    body['expected_version']=state['version']
    response=client.put('/api/v1/fans/case',json=body)
    assert response.status_code==200
    validator(spec,op['responses']['200']['content']['application/json']['schema']).validate(response.json())
    assert response.json()['applied']['fan']['level']==3
    # A retried command does not increment the configuration version.
    assert client.put('/api/v1/fans/case',json=body).json()['version']==response.json()['version']
    body['request_id']='new-command-stale-version'
    error=client.put('/api/v1/fans/case',json=body)
    assert error.status_code==409
    validator(spec,op['responses']['409']['content']['application/json']['schema']).validate(error.json())
    preview=client.post('/api/v1/oled/preview',json={'mode':'text','text':'API test'})
    assert preview.status_code==200
    validator(spec,spec['paths']['/api/v1/oled/preview']['post']['responses']['200']['content']['application/json']['schema']).validate(preview.json())
    assert client.get('/api/v1/status').json()['version']==response.json()['version']

def test_docs_do_not_expand_token_permissions(client):
    login(client)
    issued=client.post('/api/v1/tokens',json={'name':'documentation-read','scope':'read','days':1}).json()
    client.cookies.clear()
    client.headers['Authorization']='Bearer '+issued['token']
    assert client.get('/api/v1/openapi.json').status_code==200
    assert client.get('/api/docs').status_code==200
    assert client.get('/api/v1/tokens').status_code==403
    state=client.get('/api/v1/status').json()
    assert client.put('/api/v1/fans/case',json={'expected_version':state['version'],'request_id':'read-client-cannot-write','value':state['config']['fan']}).status_code==403
