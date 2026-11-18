import json
import numpy as np

def test_local_recording_cache_checks_source_and_past(tmp_path,monkeypatch):
    import integration
    root=tmp_path/'data/stage-sessions/import-case';root.mkdir(parents=True)
    video=root/'video.mp4';video.write_bytes(b'local-test-recording');(root/'session.json').write_text('{}')
    stat=video.stat();metadata=dict(video_file='video.mp4',source_bytes=stat.st_size,source_mtime_ns=stat.st_mtime_ns,fps=20,frames=120)
    (root/'pose-cache.json').write_text(json.dumps(metadata));positions=np.zeros((120,9,3));positions[81:]=999
    np.savez(root/'pose-cache.npz',positions=positions,visibility=np.ones((120,9)),segment_ids=np.zeros(120))
    monkeypatch.setattr(integration,'ROOT',tmp_path);integration.pose_arrays.cache_clear()
    records=integration.pose_records('recording_import-case');assert records[0]['split']=='user_replay_not_training'
    selected=integration.causal_record('recording_import-case',4,40)
    assert selected[2:]==(41,80) and not selected[1]['positions'][41:81].any()
    assert integration.pose_records('recording_../import-case')==[]
    video.write_bytes(b'changed video');assert integration.pose_records('recording_import-case')==[]
    integration.pose_arrays.cache_clear()
