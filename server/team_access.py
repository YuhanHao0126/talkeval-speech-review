"""Access-code gate for the separate, loopback-only team sharing server."""
import hashlib,hmac,secrets,time
from collections import deque
from datetime import timedelta
from threading import Lock
from urllib.parse import urlsplit,quote
from flask import jsonify,redirect,render_template_string,request,session
from werkzeug.middleware.proxy_fix import ProxyFix

LOGIN='''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>TalkEval++ · 团队访问</title><style>body{margin:0;background:#f3f7f5;color:#21483f;font-family:"Microsoft YaHei",sans-serif}main{max-width:360px;margin:12vh auto;padding:30px;background:white;border:1px solid #dce7e1;border-radius:16px}h1{font-size:26px;margin:0 0 12px}p{font-size:14px;line-height:1.7;color:#667b73}label{display:block;font-size:13px;margin:24px 0 8px}input,button{box-sizing:border-box;width:100%;padding:12px;border-radius:8px;font:inherit}input{border:1px solid #bed3c8}button{border:0;background:#2f7966;color:white;margin-top:14px;cursor:pointer}.error{color:#a54734}@media(max-width:440px){main{margin:10vh 18px}}</style>
<main><h1>TalkEval++</h1><p>输入团队访问码，查看演讲回放和快慢通道提示。</p><form method="post"><input type="hidden" name="next" value="{{ target }}"><label for="code">团队访问码</label><input id="code" name="code" type="password" autocomplete="current-password" required autofocus maxlength="128"><button>进入演示</button></form>{% if error %}<p class="error" role="alert">{{error}}</p>{% endif %}<p>访问码由分享者提供。电脑上的分享服务关闭后，链接将停止访问。</p></main></html>'''


def safe_target(value):
    value=value or '/static/demo-poisson-20261106.html'
    parsed=urlsplit(value)
    if not value.startswith('/') or value.startswith('//') or '\\' in value or parsed.scheme or parsed.netloc or any(ord(c)<32 for c in value):
        return '/site/'
    return value


def protect_app(app,code,share_id):
    if len(code)<16:raise ValueError('Team access code must contain at least 16 characters')
    expected=hashlib.sha256(code.encode()).digest()
    app.secret_key=secrets.token_bytes(32)
    app.config.update(SESSION_COOKIE_NAME='talkeval_team',SESSION_COOKIE_HTTPONLY=True,
                      SESSION_COOKIE_SECURE=True,SESSION_COOKIE_SAMESITE='Strict',PERMANENT_SESSION_LIFETIME=timedelta(hours=8))
    # cloudflared is the only network-facing hop; this server binds loopback only.
    app.wsgi_app=ProxyFix(app.wsgi_app,x_for=0,x_proto=1,x_host=0,x_port=0,x_prefix=0)
    failures=deque();lock=Lock()

    @app.before_request
    def team_gate():
        if request.method not in {'GET','HEAD','OPTIONS'}:
            origin=request.headers.get('Origin')
            if origin and origin.rstrip('/')!=request.host_url.rstrip('/'):
                return jsonify(error='跨站请求已拒绝。'),403
        if request.endpoint in {'team_login','team_health'}:return None
        if session.get('share_id')!=share_id:
            if request.path.startswith('/api/'):
                return jsonify(error='请先输入团队访问码。',login='/team/login'),401
            return redirect('/team/login?next='+quote(safe_target(request.full_path.rstrip('?')),safe=''))

    @app.after_request
    def team_headers(response):
        response.headers['Cache-Control']='private, no-store'
        response.headers['X-Robots-Tag']='noindex, nofollow, noarchive'
        response.headers['X-Frame-Options']='SAMEORIGIN'
        response.headers['Referrer-Policy']='same-origin'
        return response

    @app.get('/team/health')
    def team_health():return jsonify(ok=True,protected=True,share_id=share_id)

    @app.route('/team/login',methods=['GET','POST'])
    def team_login():
        if (request.content_length or 0)>8192:return 'Request too large',413
        target=safe_target(request.values.get('next'));error=None;status=200
        if request.method=='POST':
            with lock:
                now=time.monotonic()
                while failures and failures[0]<now-60:failures.popleft()
                if len(failures)>=30:return render_template_string(LOGIN,target=target,error='尝试次数较多，请一分钟后重试。'),429
                supplied=request.form.get('code','')
                if not hmac.compare_digest(hashlib.sha256(supplied.encode()).digest(),expected):
                    failures.append(now);error='访问码不正确，请向分享者核对。';status=401
                else:
                    session.clear();session['share_id']=share_id;session.permanent=True
                    return redirect(target)
        return render_template_string(LOGIN,target=target,error=error),status

    @app.post('/team/logout')
    def team_logout():session.clear();return redirect('/team/login')
    return app
