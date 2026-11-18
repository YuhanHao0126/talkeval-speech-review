"""Dedicated authenticated sharing server. Never binds a public interface."""
import argparse,json,socket
from pathlib import Path
from waitress import create_server


def create_bound_server(application,port=18766):
    listener=socket.socket(socket.AF_INET,socket.SOCK_STREAM)
    try:
        if hasattr(socket,'SO_EXCLUSIVEADDRUSE'):listener.setsockopt(socket.SOL_SOCKET,socket.SO_EXCLUSIVEADDRUSE,1)
        listener.bind(('127.0.0.1',port));listener.listen(64)
        return create_server(application,sockets=[listener],threads=8,connection_limit=64,channel_timeout=120,
                             max_request_body_size=200*1024*1024,trusted_proxy='127.0.0.1',trusted_proxy_headers={'x-forwarded-proto'})
    except BaseException:listener.close();raise


def make_server(config):
    from app import app
    from team_access import protect_app
    protect_app(app,config['access_code'],config['share_id'])
    return create_bound_server(app)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--config',type=Path,required=True);args=parser.parse_args()
    config=json.loads(args.config.read_text('utf-8'))
    make_server(config).run()
