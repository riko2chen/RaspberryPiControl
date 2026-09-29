#!/usr/bin/env python3
"""Install a standalone Pi Control host without assuming an external /data disk."""
import argparse
import getpass
import hashlib
import ipaddress
import json
import os
import secrets
import shutil
import socket
import subprocess
from pathlib import Path

def private_ips():
    rows=json.loads(subprocess.check_output(['ip','-j','-4','addr','show'],text=True))
    nets=[ipaddress.ip_network(n) for n in ('10.0.0.0/8','172.16.0.0/12','192.168.0.0/16','100.64.0.0/10')]
    return sorted({a['local'] for row in rows for a in row.get('addr_info',[]) if a.get('family')=='inet' and any(ipaddress.ip_address(a['local']) in n for n in nets)})

def hostnames():
    result=['localhost','127.0.0.1',socket.gethostname(),socket.gethostname()+'.local']
    if shutil.which('tailscale'):
        try:
            status=json.loads(subprocess.check_output(['tailscale','status','--json'],text=True,timeout=5,stderr=subprocess.DEVNULL))
            name=status.get('Self',{}).get('DNSName','').rstrip('.')
            if name:result.append(name)
        except (OSError,ValueError,subprocess.SubprocessError):pass
    return result

def compose(gid,name,addresses):
    return {'name':'pi-control','services':{'pi-control':{
        'image':'pi-control:1.5.0','container_name':'pi-control','restart':'unless-stopped',
        'user':'10002:10002','group_add':[str(gid)],'cpus':1,'mem_limit':'512m','pids_limit':128,
        'read_only':True,'cap_drop':['ALL'],'security_opt':['no-new-privileges:true'],
        'stop_grace_period':'25s','device_cgroup_rules':['c 89:* rw'],
        'ports':[address+':8080:8080' for address in ['127.0.0.1',*addresses]],
        'environment':{'TZ':'Asia/Shanghai','PC_DEVICE_NAME':name,'PC_I2C_ROOT':'/dev/pi-control','PC_I2C_BUSES':'1',
            'PC_DISCOVERY_FILE':'/run/pi-control-discovery/peers.json','PC_SYS_ROOT':'/host/sys','PC_PROC_ROOT':'/host/proc',
            'PC_ALLOWED_HOSTS':','.join(hostnames()),
            'PC_BOOTSTRAP':'/run/secrets/pi-control-bootstrap'},
        'volumes':[{'type':'bind','source':src,'target':dst,'read_only':readonly,'bind':{'create_host_path':False}} for src,dst,readonly in [
            ('/var/lib/pi-control','/var/lib/pi-control',False),
            ('/dev/pi-control','/dev/pi-control',False),('/run/pi-control-discovery','/run/pi-control-discovery',True),
            ('/sys','/host/sys',True),('/proc/stat','/host/proc/stat',True),('/proc/meminfo','/host/proc/meminfo',True),
            ('/proc/uptime','/host/proc/uptime',True),('/etc/pi-control/bootstrap.json','/run/secrets/pi-control-bootstrap',True)]],
        'tmpfs':['/tmp:size=16m,mode=1777'],
        'healthcheck':{'test':['CMD','python','-c',"import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/healthz',timeout=3)"],'interval':'20s','timeout':'5s','retries':3,'start_period':'20s'},
        'logging':{'driver':'local','options':{'max-size':'10m','max-file':'3'}}
    }}}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--name',default=socket.gethostname())
    parser.add_argument('--username',default='pi')
    parser.add_argument('--print-compose',action='store_true',help='Print a preview without installing')
    args=parser.parse_args()
    if args.print_compose:
        print(json.dumps(compose(988,args.name,['192.168.1.100']),ensure_ascii=False,indent=2));return
    if os.geteuid()!=0:raise SystemExit('Run with sudo.')
    source=Path(__file__).resolve().parent.parent
    target=Path('/opt/pi-control/app')
    if target.exists():raise SystemExit('Existing installation found; preserve it and use a backed-up upgrade procedure.')
    subprocess.run(['docker','info'],check=True,stdout=subprocess.DEVNULL)
    subprocess.run(['docker','compose','version'],check=True)
    # Choose the account secret before making host changes. It is never stored in plaintext.
    password=getpass.getpass('New Pi Control password (12+ characters): ')
    if len(password)<12 or getpass.getpass('Repeat password: ')!=password:raise SystemExit('Passwords must match and have at least 12 characters.')
    subprocess.run(['apt-get','update'],check=True)
    subprocess.run(['apt-get','install','-y','--no-install-recommends','avahi-daemon','avahi-utils','python3-smbus','i2c-tools'],check=True)
    import grp
    gid=grp.getgrnam('i2c').gr_gid
    for path in ['/opt/pi-control','/etc/pi-control','/var/lib/pi-control','/usr/local/libexec']:
        Path(path).mkdir(parents=True,exist_ok=True)
    shutil.copytree(source,target,ignore=shutil.ignore_patterns('.git','.venv','.secrets','.test-data*','.cloudflare','.wrangler','node_modules','dist','dist-demo','__pycache__','.pytest_cache','artifacts','test-results','.env','.env.*','*.db','*.db-*','*.sqlite*','*.pem','*.key','*.tar.gz','*.png'))
    state=Path('/var/lib/pi-control');os.chown(state,10002,10002)
    salt=secrets.token_hex(16)
    hashed=salt+':'+hashlib.pbkdf2_hmac('sha256',password.encode(),bytes.fromhex(salt),600000).hex()
    del password
    bootstrap=Path('/etc/pi-control/bootstrap.json');bootstrap.write_text(json.dumps({'username':args.username,'password_hash':hashed}));bootstrap.chmod(0o640);os.chown(bootstrap,0,10002)
    Path('/etc/pi-control/hardware.json').write_text('{"buses":[1]}\n')
    Path('/opt/pi-control/compose.yaml').write_text(json.dumps(compose(gid,args.name,private_ips()),ensure_ascii=False,indent=2))
    for name in ['pi-control-devices','pi-control-discovery','pi-control-fan-safe']:
        dest=Path('/usr/local/libexec')/name;shutil.copy(source/'deploy'/name,dest);dest.chmod(0o755)
    for name in ['pi-control-devices.service','pi-control-devices.timer','pi-control-discovery.service','pi-control-discovery.timer','pi-control-fan-safe.service','pi-control-fan-safe.timer']:
        shutil.copy(source/'deploy'/name,Path('/etc/systemd/system')/name)
    Path('/etc/avahi/services').mkdir(parents=True,exist_ok=True)
    shutil.copy(source/'deploy/pi-control-avahi.service','/etc/avahi/services/pi-control.service')
    unit='''[Unit]
Description=Pi Control
Requires=docker.service
After=docker.service network-online.target pi-control-discovery.service
Wants=network-online.target pi-control-discovery.service pi-control-devices.timer pi-control-discovery.timer
[Service]
Type=oneshot
RemainAfterExit=yes
ExecStartPre=/usr/local/libexec/pi-control-devices
ExecStart=/usr/bin/docker compose -f /opt/pi-control/compose.yaml up -d --wait --wait-timeout 120
ExecStop=/usr/bin/docker compose -f /opt/pi-control/compose.yaml stop --timeout 20
TimeoutStartSec=180
TimeoutStopSec=45
[Install]
WantedBy=multi-user.target
'''
    Path('/etc/systemd/system/pi-control.service').write_text(unit)
    if shutil.which('raspi-config'):subprocess.run(['raspi-config','nonint','do_i2c','0'],check=True)
    subprocess.run(['modprobe','i2c-dev'],check=True)
    subprocess.run(['systemctl','enable','--now','avahi-daemon'],check=True)
    subprocess.run(['systemctl','daemon-reload'],check=True)
    subprocess.run(['systemctl','start','pi-control-devices','pi-control-discovery'],check=True)
    subprocess.run(['systemctl','enable','--now','pi-control-devices.timer','pi-control-discovery.timer','pi-control-fan-safe.timer'],check=True)
    subprocess.run(['docker','build','-t','pi-control:1.5.0',str(target)],check=True)
    subprocess.run(['systemctl','enable','--now','pi-control'],check=True)
    print('Installed. Open http://'+(private_ips() or ['127.0.0.1'])[0]+':8080')
    print('If the I2C interface is not visible yet, reboot. The control page works without peripherals.')

if __name__=='__main__':main()
