from pathlib import Path
import json,hashlib
root=Path(__file__).resolve().parent/'data/stage-sessions'
for manifest in root.glob('*/pose-cache.json'):
    row=json.loads(manifest.read_text('utf-8'))
    if row.get('video_file') not in {'video.mp4','video.webm'}:raise ValueError('Unexpected video file')
    video=manifest.parent/row['video_file']
    with video.open('rb') as stream:actual=hashlib.file_digest(stream,'sha256').hexdigest()
    if actual!=row.get('source_sha256') or video.stat().st_size!=row['source_bytes']:
        raise ValueError('Video changed; rebuild this pose cache: '+str(video))
    row['source_mtime_ns']=video.stat().st_mtime_ns
    manifest.write_text(json.dumps(row,ensure_ascii=False,indent=2),'utf-8')
    print('Restored:',manifest.parent.name)
