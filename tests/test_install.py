import importlib.util
from pathlib import Path

def test_portable_compose_has_optional_devices_and_private_bindings():
    spec=importlib.util.spec_from_file_location('installer',Path(__file__).parents[1]/'deploy/install.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    service=module.compose(987,'Living room Pi',['192.168.1.50','100.100.1.2'])['services']['pi-control']
    assert 'devices' not in service
    assert not service.get('privileged')
    assert service['device_cgroup_rules']==['c 89:* rw']
    assert service['group_add']==['987']
    assert service['ports']==['127.0.0.1:8080:8080','192.168.1.50:8080:8080','100.100.1.2:8080:8080']
    assert service['environment']['PC_DEVICE_NAME']=='Living room Pi'
    assert all('/data'!=v['source'] for v in service['volumes'])
    assert all(v['source']!='/dev' for v in service['volumes'])
    assert not any('password' in k.lower() for k in service['environment'])
