"""Create a private bootstrap file; only a salted password hash is written."""
import argparse,getpass,json,os
from pathlib import Path
from .store import password_hash

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',default='/secrets/bootstrap.json');p.add_argument('--username',default='pi');a=p.parse_args()
    target=Path(a.output)
    if target.exists():raise SystemExit('Bootstrap already exists; refusing to replace it.')
    password=getpass.getpass('New password (12+ characters): ')
    if len(password)<12 or password!=getpass.getpass('Repeat password: '):raise SystemExit('Passwords must match and have at least 12 characters.')
    target.parent.mkdir(parents=True,exist_ok=True)
    fd=os.open(target,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
    with os.fdopen(fd,'w') as f:json.dump({'username':a.username,'password_hash':password_hash(password)},f)
    print('Bootstrap created. It contains a password hash, not your password.')
if __name__=='__main__':main()
