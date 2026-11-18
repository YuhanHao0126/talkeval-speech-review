"""13 causal acoustic features per 50ms block, timestamped at block END.

No utterance/global normalization: learned normalization is fitted on train only.
Features: log RMS, zero crossings, 8 log spectral-band powers, log F0,
periodicity, validity. F0 is a simple autocorrelation estimate, not ASR.
"""
import hashlib
import subprocess
import threading
from pathlib import Path
import numpy as np

DIM=13
FPS=20
RATE=16000
BLOCK=800


def block_features(pcm):
    x=np.asarray(pcm,np.float32).reshape(-1,BLOCK)
    rms=np.sqrt(np.mean(x*x,axis=1))
    zcr=np.mean(x[:,1:]*x[:,:-1]<0,axis=1)
    centered=x-x.mean(axis=1,keepdims=True)
    spectrum=np.abs(np.fft.rfft(centered*np.hanning(BLOCK),n=1024))**2/1024
    freq=np.fft.rfftfreq(1024,1/RATE)
    edges=[0,125,250,500,1000,2000,3000,4000,8001]
    bands=[np.log(np.maximum(spectrum[:,(freq>=lo)&(freq<hi)].mean(axis=1),1e-8)) for lo,hi in zip(edges,edges[1:])]
    ac=np.fft.irfft(np.abs(np.fft.rfft(centered,n=2048))**2,n=2048)[:,:BLOCK]
    ac=ac/np.maximum(ac[:,:1],1e-9)
    low,high=RATE//400,RATE//70
    lag=np.argmax(ac[:,low:high],axis=1)+low
    periodicity=ac[np.arange(len(x)),lag]
    voiced=(rms>.004)&(periodicity>.35)
    pitch=np.where(voiced,np.log2((RATE/lag)/100),0)
    return np.stack([np.log(np.maximum(rms,1e-5)),zcr,*bands,pitch,np.clip(periodicity,0,1),np.ones(len(x))],axis=1).astype(np.float32)


def decode_features(source,start=0,seconds=14400,timeout=120):
    import imageio_ffmpeg
    command=[imageio_ffmpeg.get_ffmpeg_exe(),'-nostdin','-v','error']
    if str(source).startswith('https://'):
        from urllib.request import getproxies
        proxy=getproxies().get('https')
        if proxy:command+=['-http_proxy',proxy]
        command+=['-rw_timeout','20000000']
    command+=['-ss',f'{start:.6f}','-i',str(source),'-t',str(seconds),'-map','0:a:0','-vn','-ac','1','-ar',str(RATE),'-f','s16le','pipe:1']
    process=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    timer=threading.Timer(timeout,process.kill);timer.daemon=True;timer.start()
    chunks=[];tail=b''
    try:
        while True:
            block=process.stdout.read(BLOCK*2*200)
            if not block:break
            raw=tail+block;n=len(raw)//(BLOCK*2)*(BLOCK*2)
            if n:chunks.append(block_features(np.frombuffer(raw[:n],'<i2').astype(np.float32)/32768))
            tail=raw[n:]
        if process.wait()!=0 or not chunks:raise ValueError('没有可解码音轨，或音轨读取超时')
        return np.concatenate(chunks)
    finally:
        timer.cancel()
        if process.poll() is None:process.kill();process.wait()
        process.stdout.close()


def align_features(features,times):
    # Frame i describes [i/20,(i+1)/20]; never align a future block to a pose.
    indices=np.floor(np.asarray(times)*FPS+1e-7).astype(int)-1
    result=np.zeros((len(indices),DIM),np.float32)
    valid=(indices>=0)&(indices<len(features))
    result[valid]=features[indices[valid]]
    return result


class AcousticCache:
    def __init__(self,directory):
        self.directory=Path(directory);self.jobs={};self.lock=threading.Lock()

    def get(self,path,times):
        if path is None or not Path(path).is_file():return None,'没有可用的本机音轨'
        path=Path(path).resolve();stat=path.stat()
        key=hashlib.sha256(f'{path}|{stat.st_size}|{stat.st_mtime_ns}|acoustic-v15'.encode()).hexdigest()
        with self.lock:
            job=self.jobs.get(key)
            if job is None:
                self.directory.mkdir(parents=True,exist_ok=True);target=self.directory/(key+'.npz')
                try:
                    with np.load(target,allow_pickle=False) as data:features=data['features']
                    if features.ndim!=2 or features.shape[1]!=DIM or not np.isfinite(features).all():raise ValueError('invalid cache')
                    job=dict(status='ready',features=features)
                except (OSError,KeyError,ValueError):
                    job=dict(status='loading')
                    threading.Thread(target=self._prepare,args=(path,stat,target,job),daemon=True).start()
                if len(self.jobs)>=12:
                    old=next((k for k,v in self.jobs.items() if v['status']!='loading'),None)
                    if old is not None:del self.jobs[old]
                self.jobs[key]=job
            if job['status']!='ready':return None,'声学特征正在准备' if job['status']=='loading' else '音轨解码不可用'
            aligned=align_features(job['features'],times)
            if aligned[:,-1].mean()<.9:return None,'连续的历史音频不足'
            return aligned,'已使用历史声学特征'

    def _prepare(self,path,stat,target,job):
        try:
            features=decode_features(path)
            new=path.stat()
            if (new.st_size,new.st_mtime_ns)!=(stat.st_size,stat.st_mtime_ns):raise ValueError('source changed')
            temporary=target.with_suffix('.tmp')
            with temporary.open('wb') as output:np.savez_compressed(output,features=features)
            temporary.replace(target)
            with self.lock:job.update(status='ready',features=features)
        except (ValueError,OSError,subprocess.SubprocessError):
            with self.lock:job['status']='unavailable'
