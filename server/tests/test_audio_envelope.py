import time
import wave
import numpy as np
from audio_envelope import AudioEnvelopeCache, causal_rows


def ready(cache,path,at=1.5):
    for _ in range(200):
        result=cache.window(path,at,2)
        if result['status']!='loading':
            return result
        time.sleep(.02)
    raise AssertionError('Audio extraction did not finish')


def test_causal_frames_end_before_input():
    rms=np.arange(100,dtype=float)/100
    first=causal_rows(rms,2.02,1)
    rms[40:]=999
    assert causal_rows(rms,2.02,1)==first
    assert first[-1]['at']==2 and first[0]['at']>1.02
    assert causal_rows(rms,.049,2)==[]
    assert len(causal_rows(rms,.05,2))==1


def test_extract_cache_invalidation_and_no_audio(tmp_path):
    path=tmp_path/'source.wav'
    def write(amplitude):
        with wave.open(str(path),'wb') as w:
            w.setnchannels(1);w.setsampwidth(2);w.setframerate(16000)
            w.writeframes((amplitude*np.sin(2*np.pi*220*np.arange(32000)/16000)*32767).astype('<i2').tobytes())
    write(.1)
    cache=AudioEnvelopeCache(tmp_path/'cache')
    a=ready(cache,path)
    assert a['ready'] and not a['future_audio_used'] and a['input_end']==1.5
    assert np.isclose(a['samples'][-1]['rms'],.1/np.sqrt(2),rtol=.02)
    assert AudioEnvelopeCache(tmp_path/'cache').window(path,1.5,2)==a
    write(.3)
    b=ready(cache,path)
    assert b['samples'][-1]['rms']>a['samples'][-1]['rms']*2.9
    assert cache.window(None,2,2)['status']=='unavailable'
    broken=tmp_path/'invalid.mp4';broken.write_bytes(b'not video')
    assert ready(cache,broken)['status']=='unavailable'


def test_endpoint_validates_and_uses_registered_local_video(tmp_path,monkeypatch):
    from flask import Flask
    import integration
    monkeypatch.setattr(integration,'ROOT',tmp_path)
    app=Flask(__name__);app.register_blueprint(integration.create_integration(None));client=app.test_client()
    for args in ['at=nan','at=-1','history_seconds=11','history_seconds=nan']:
        assert client.get('/api/stage/audio?'+args).status_code==400
    assert client.get('/api/stage/audio?case_id=recording_../bad&at=3').json['status']=='unavailable'
    folder=tmp_path/'data/stage-sessions/demo';folder.mkdir(parents=True)
    (folder/'video.mp4').write_bytes(b'example')
    assert integration.local_video('recording_demo') is None
    (folder/'session.json').write_text('{}')
    assert integration.local_video('recording_demo')==folder/'video.mp4'
