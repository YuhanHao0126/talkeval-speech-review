"""Local, bounded RMS extraction. Consumers receive only audio ending at/before t.

This is a signal feature cache, not a learned speech/gesture model. Each value
covers a non-overlapping 50ms block; its timestamp is the END of that block.
"""
from pathlib import Path
import hashlib
import subprocess
import threading

import numpy as np


def causal_rows(rms, at, history_seconds, fps=20):
    end = min(len(rms), max(0, int(np.floor(at * fps + 1e-7))))
    start = max(0, int(np.ceil((at - history_seconds) * fps - 1e-7)))
    return [{'at': round((i + 1) / fps, 4), 'rms': round(float(rms[i]), 7)}
            for i in range(start, end)]


class AudioEnvelopeCache:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.lock = threading.Lock()
        self.jobs = {}

    def window(self, path, at, history_seconds):
        if path is None or not Path(path).is_file():
            return dict(ready=False, status='unavailable', message='本机没有这段视频的音轨。')
        path = Path(path).resolve()
        stat = path.stat()
        key = hashlib.sha256(f'{path}|{stat.st_size}|{stat.st_mtime_ns}|rms-v1'.encode()).hexdigest()
        with self.lock:
            job = self.jobs.get(key)
            if job is None:
                self.directory.mkdir(parents=True, exist_ok=True)
                saved = self.directory / (key + '.npz')
                try:
                    with np.load(saved, allow_pickle=False) as data:
                        values = data['rms']
                        if values.ndim != 1 or len(values) > 288000 or not np.isfinite(values).all():
                            raise ValueError('Invalid audio cache')
                        job = dict(status='ready', rms=values)
                except (OSError, ValueError, KeyError):
                    job = dict(status='loading')
                    threading.Thread(target=self._extract, args=(path, stat, saved, job), daemon=True).start()
                # Bound resident recordings; on-disk cache remains source-fingerprinted.
                if len(self.jobs) >= 12:
                    oldest = next((k for k,v in self.jobs.items() if v['status'] != 'loading'), None)
                    if oldest is not None:
                        del self.jobs[oldest]
                self.jobs[key] = job
            status = job['status']
            if status != 'ready':
                return dict(ready=False, status=status, message='正在准备音频能量缓存。' if status == 'loading' else '音轨不可用，按动作单独推演。')
            rows = causal_rows(job['rms'], at, history_seconds)
        return dict(ready=bool(rows), status='ready', samples=rows, source='本机视频音轨',
                    input_end=rows[-1]['at'] if rows else None, future_audio_used=False, sampling_fps=20)

    def _extract(self, path, stat, saved, job):
        process = None
        watchdog = None
        try:
            import imageio_ffmpeg
            command = [imageio_ffmpeg.get_ffmpeg_exe(), '-nostdin', '-v', 'error', '-i', str(path),
                       '-map', '0:a:0', '-t', '14400', '-vn', '-ac', '1', '-ar', '16000',
                       '-f', 's16le', 'pipe:1']
            process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                       creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            watchdog = threading.Timer(120, process.kill)
            watchdog.daemon = True
            watchdog.start()
            chunks = []
            remainder = b''
            while True:
                block = process.stdout.read(1600 * 200)
                if not block:
                    break
                raw = remainder + block
                usable = len(raw) // 1600 * 1600
                if usable:
                    pcm = np.frombuffer(raw[:usable], dtype='<i2').astype(np.float32).reshape(-1, 800) / 32768
                    chunks.append(np.sqrt(np.mean(pcm * pcm, axis=1)))
                remainder = raw[usable:]
            if process.wait() != 0 or not chunks:
                raise ValueError('No decodable audio')
            current = path.stat()
            if (current.st_size, current.st_mtime_ns) != (stat.st_size, stat.st_mtime_ns):
                raise ValueError('Source changed during extraction')
            rms = np.concatenate(chunks)
            temp = saved.with_suffix('.tmp')
            with temp.open('wb') as output:
                np.savez_compressed(output, rms=rms)
            temp.replace(saved)
            with self.lock:
                job.update(rms=rms, status='ready')
        except (OSError, ValueError, subprocess.SubprocessError):
            with self.lock:
                job['status'] = 'unavailable'
        finally:
            if watchdog:
                watchdog.cancel()
            if process:
                if process.poll() is None:
                    process.kill()
                    process.wait()
                process.stdout.close()
