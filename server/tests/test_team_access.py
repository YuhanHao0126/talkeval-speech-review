from flask import Flask,jsonify
from team_access import protect_app,safe_target

def make_client():
    app=Flask(__name__)
    app.add_url_rule('/api/example',endpoint='example_api',view_func=lambda:jsonify(ok=True))
    app.add_url_rule('/stage-media/example',endpoint='example_media',view_func=lambda:'private video')
    app.add_url_rule('/site/',endpoint='example_site',view_func=lambda:'site')
    protect_app(app,'correct-code-123456789','example-share')
    return app.test_client()

def test_private_media_api_and_cookie():
    c=make_client();base='https://team.example'
    assert c.get('/api/example',base_url=base).status_code==401
    assert c.get('/stage-media/example',base_url=base).status_code==302
    assert c.get('/team/login',base_url=base).status_code==200
    assert c.post('/team/login',data={'code':'wrong'},base_url=base).status_code==401
    login=c.post('/team/login',data={'code':'correct-code-123456789','next':'/site/'},base_url=base)
    assert login.status_code==302 and login.headers['Location']=='/site/'
    assert all(x in login.headers['Set-Cookie'] for x in ['Secure','HttpOnly','SameSite=Strict'])
    result=c.get('/api/example',base_url=base)
    assert result.json=={'ok':True} and 'no-store' in result.headers['Cache-Control']
    assert c.get('/stage-media/example',base_url=base).data==b'private video'
    assert c.post('/team/logout',headers={'Origin':'https://attacker.example'},base_url=base).status_code==403
    assert c.post('/team/logout',base_url=base).status_code==302
    assert c.get('/api/example',base_url=base).status_code==401

def test_no_external_redirect_and_bounded_attempts():
    for value in ['//evil.example','https://evil.example','/\\evil.example','/\nevil']:
        assert safe_target(value)=='/site/'
    c=make_client()
    for _ in range(30):assert c.post('/team/login',data={'code':'wrong'}).status_code==401
    assert c.post('/team/login',data={'code':'wrong'}).status_code==429


def test_real_proxy_preserves_https_origin_and_exclusive_port():
    import http.client,threading,socket
    from serve_team import create_bound_server
    from urllib.parse import urlencode
    app=Flask('proxy-test');protect_app(app,'correct-code-123456789','proxy-test')
    server=create_bound_server(app,0);port=server.socket.getsockname()[1]
    threading.Thread(target=server.run,daemon=True).start()
    try:
        connection=http.client.HTTPConnection('127.0.0.1',port,timeout=5)
        connection.request('POST','/team/login',body=urlencode({'code':'correct-code-123456789'}),
                           headers={'Host':'team.example','Origin':'https://team.example','X-Forwarded-Proto':'https','Content-Type':'application/x-www-form-urlencoded'})
        response=connection.getresponse();response.read()
        assert response.status==302 and 'Secure' in response.getheader('Set-Cookie');connection.close()
        competing=socket.socket()
        try:
            competing.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
            try:competing.bind(('127.0.0.1',port))
            except OSError:pass
            else:raise AssertionError('Port must be exclusive')
        finally:competing.close()
    finally:server.close()
