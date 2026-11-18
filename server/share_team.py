"""Start/stop a temporary HTTPS tunnel to the access-code-protected team server.

Runtime credentials remain under data/team-share and must never enter a package.
The normal local application on port 8765 is left running independently.
"""
import argparse,hashlib,json,os,re,secrets,socket,subprocess,threading,time,urllib.request,urllib.error
from pathlib import Path

ROOT=Path(__file__).resolve().parent
RUNTIME=ROOT/'data/team-share'
STATE=RUNTIME/'current.owner.json'
PUBLIC=RUNTIME/'status.json'
BINARY=ROOT/'tools/bin/cloudflared.exe'
EXPECTED='d5c1d82031da6253dcdcff64c944cd0fe063016edeb2e4fd088075fc9bd52d0a'


def save(state):
    target=STATE.with_suffix('.tmp');target.write_text(json.dumps(state,ensure_ascii=False,indent=2),'utf-8');target.replace(STATE)
    target=PUBLIC.with_suffix('.tmp');target.write_text(json.dumps({k:v for k,v in state.items() if k!='access_code'},ensure_ascii=False,indent=2),'utf-8');target.replace(PUBLIC)


def local_health():
    try:
        with urllib.request.build_opener(urllib.request.ProxyHandler({})).open('http://127.0.0.1:18766/team/health',timeout=2) as r:return json.load(r)
    except Exception:return None


def external_gate_ready(origin,share_id):
    try:
        with urllib.request.urlopen(origin+'/team/health',timeout=10) as r:
            if json.load(r)!=dict(ok=True,protected=True,share_id=share_id):return False
        try:
            with urllib.request.urlopen(origin+'/api/status',timeout=10):return False
        except urllib.error.HTTPError as error:
            return error.code==401 and 'no-store' in error.headers.get('Cache-Control','')
    except Exception:return False


def start():
    with socket.socket() as probe:
        probe.settimeout(1)
        if probe.connect_ex(('127.0.0.1',18766))==0:raise RuntimeError('Port 18766 is occupied; sharing was not opened.')
    if not BINARY.is_file() or hashlib.sha256(BINARY.read_bytes()).hexdigest()!=EXPECTED:raise RuntimeError('Verified cloudflared 2026.11.0 is required in tools/bin.')
    RUNTIME.mkdir(parents=True,exist_ok=True)
    run=secrets.token_hex(12);state=dict(share_id=run,access_code=secrets.token_urlsafe(15),status='starting',started=time.strftime('%Y-%m-%d %H:%M:%S'),manager_pid=os.getpid())
    save(state);server=None;tunnel=None
    try:
        from serve_team import make_server
        server=make_server(state);threading.Thread(target=server.run,daemon=True).start()
        # Verify the exact run AND access gate before giving any origin to a tunnel.
        if local_health()!=dict(ok=True,protected=True,share_id=run):raise RuntimeError('Protected server identity check failed.')
        opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
        try:
            with opener.open('http://127.0.0.1:18766/api/status',timeout=3) as response:
                raise RuntimeError('Access gate unexpectedly allowed an anonymous API request.')
        except urllib.error.HTTPError as error:
            if error.code!=401 or 'no-store' not in error.headers.get('Cache-Control',''):raise RuntimeError('Access gate verification failed.')
        logpath=RUNTIME/(run+'.cloudflared.log')
        env=os.environ.copy()
        proxy=urllib.request.getproxies().get('https')
        if proxy:env.setdefault('HTTPS_PROXY',proxy)
        tunnel=subprocess.Popen([str(BINARY),'tunnel','--url','http://127.0.0.1:18766','--no-autoupdate','--protocol','http2','--edge-ip-version','4','--metrics','127.0.0.1:0'],
                                cwd=ROOT,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        state.update(tunnel_pid=tunnel.pid,log_path=str(logpath));save(state)
        public_url=[None];registered=threading.Event()
        def read_log():
            with logpath.open('w',encoding='utf-8') as output:
                for raw in iter(tunnel.stdout.readline,b''):
                    line=raw.decode('utf-8','replace');output.write(line);output.flush()
                    match=re.search(r'https://[a-z0-9-]+\.trycloudflare\.com',line)
                    if match:public_url[0]=match.group(0)
                    if 'Registered tunnel connection' in line:registered.set()
        threading.Thread(target=read_log,daemon=True).start()
        since=time.monotonic();announced=False
        while tunnel.poll() is None:
            if (RUNTIME/(run+'.stop')).exists():state['status']='stopped';break
            if public_url[0] and registered.is_set() and not announced and external_gate_ready(public_url[0],run):
                state.update(status='ready',origin=public_url[0],url=public_url[0]+'/site/?case=recording_import-poisson-20261106-demo&at=31.12&view=record&history=2&horizon=2&method=audio&display=trend&strength=4&audio=on');save(state);announced=True
                print(json.dumps(dict(status='ready',url=state['url']),ensure_ascii=False),flush=True)
            if not announced and time.monotonic()-since>120:
                state.update(status='failed',error='Tunnel did not connect within 120 seconds. See cloudflared log.');break
            time.sleep(.5)
        else:state.update(status='failed',error='cloudflared exited; see its log.')
    except BaseException as error:
        state.update(status='failed',error=str(error));raise
    finally:
        if tunnel and tunnel.poll() is None:
            tunnel.terminate()
            try:tunnel.wait(timeout=5)
            except subprocess.TimeoutExpired:tunnel.kill();tunnel.wait()
        if server:server.close()
        save(state)


def stop():
    if not STATE.exists():print('No team sharing state.');return
    state=json.loads(STATE.read_text('utf-8'))
    if not re.fullmatch('[a-f0-9]{24}',state['share_id']):raise ValueError('Invalid share identifier')
    (RUNTIME/(state['share_id']+'.stop')).write_text('stop','utf-8');print('Stop requested; the local port 8765 demo is unchanged.')


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['start','stop','status']);args=parser.parse_args()
    if args.action=='start':start()
    elif args.action=='stop':stop()
    else:print(PUBLIC.read_text('utf-8') if PUBLIC.exists() else 'No team sharing state.')
