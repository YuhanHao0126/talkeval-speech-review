"""Local webcam processing. Frames stay in memory; no recording is persisted."""
from collections import deque
import time
import numpy as np
from motion import FPS, HISTORY, JOINTS, MODEL_PATH, NAMES, download_pose_model
from fine_pose import FinePose


def resample_history(rows,history_frames=HISTORY):
    times=np.array([row[0] for row in rows],dtype=float)
    if len(times)<2 or times[-1]-times[0]<(history_frames-1)/FPS-1e-9: return None
    target=times[-1]-np.arange(history_frames-1,-1,-1)/FPS
    coordinates=np.stack([r[1] for r in rows])
    visibility=np.stack([r[2] for r in rows])
    positions=np.stack([np.interp(target,times,coordinates[:,j,a]) for j in range(9) for a in range(3)],axis=-1).reshape(history_frames,9,3).astype(np.float32)
    left=np.clip(np.searchsorted(times,target,side='right')-1,0,len(times)-1)
    right=np.clip(left+1,0,len(times)-1)
    # Interpolated coordinates never receive better quality than either neighbor.
    quality=np.minimum(visibility[left],visibility[right])
    # Do not turn a long camera interruption into confident interpolated observations.
    quality[(times[right]-times[left])>.8]=0
    exact=np.abs(target-times[left])<1e-6
    quality[exact]=visibility[left[exact]]
    return positions,quality,target


class LiveSession:
    def __init__(self):
        self.tracker=FinePose()
        self.rows=deque(maxlen=1000);self.last=np.zeros((9,3),np.float32);self.fresh=True;self.last_timestamp=-1
        self.updated=time.monotonic()

    def close(self):self.tracker.close()

    def process(self,frame,timestamp_ms,predictor,method,*,history_frames=HISTORY,horizon_frames=10):
        import cv2
        timestamp=round(float(timestamp_ms))
        if not 0<=timestamp<=86400000 or timestamp<=self.last_timestamp:raise ValueError('帧时间戳必须递增。')
        # A modest camera/CPU delay must not repeatedly erase the entire history.
        if self.last_timestamp>=0 and timestamp-self.last_timestamp>2000:
            self.rows.clear();self.fresh=True;self.tracker.reset()
        self.last_timestamp=timestamp;self.updated=time.monotonic();started=time.perf_counter()
        detailed,detail_visibility,image=self.tracker.process(frame,timestamp)
        self.last=detailed[JOINTS];visibility=detail_visibility[JOINTS]
        self.rows.append((timestamp/1000,self.last.copy(),visibility))
        while len(self.rows)>2 and self.rows[1][0]<timestamp/1000-max(4.2,history_frames/FPS+.25):self.rows.popleft()
        observed=bool((visibility[1:7]>=.4).mean()>=.5 and min(visibility[1:3])>=.4)
        pose_ms=(time.perf_counter()-started)*1000
        observation=dict(current=self.last.round(5).tolist(),visibility=visibility.round(3).tolist(),
                         detail=dict(positions=detailed.round(5).tolist(),visibility=detail_visibility.round(3).tolist()),
                         image_points=image.round(5).tolist()) if observed else None
        common=dict(at=timestamp/1000,observed_ready=observed,observation=observation,pose_ms=pose_ms,
                    history_frames=history_frames,horizon_frames=horizon_frames,history_seconds=history_frames/FPS,
                    horizon_seconds=horizon_frames/FPS,sampling_fps=FPS,pose_backend='mediapipe_full_33_adaptive_v1')
        if not observed:return dict(**common,ready=False,tracking_state='lost',processing_ms=(time.perf_counter()-started)*1000,message='暂未识别到可靠的肩肘腕，正在重新识别。')
        history=resample_history(self.rows,history_frames)
        if history is None:return dict(**common,ready=False,tracking_state='warming',processing_ms=(time.perf_counter()-started)*1000,message=f'已显示当前姿态，正在积累过去{history_frames/FPS:g}秒观察。')
        positions,quality,times=history
        if (quality[:,1:7]>=.4).mean()<.35 or (quality[-1,1:7]>=.4).mean()<.5:return dict(**common,ready=False,tracking_state='warming',processing_ms=(time.perf_counter()-started)*1000,message='人物已识别，连续观测还不足，暂不生成新的预测。')
        forecast_started=time.perf_counter()
        prediction=predictor.predict(positions,quality,method,horizon_frames=horizon_frames)
        capture_fps=(len(self.rows)-1)/(self.rows[-1][0]-self.rows[0][0])
        return dict(**common,ready=True,tracking_state='tracking',method=method,history=positions.round(5).tolist(),visibility=quality.round(3).tolist(),timestamps=times.tolist(),positions=prediction.round(5).tolist(),capture_fps=capture_fps,processing_ms=(time.perf_counter()-started)*1000,forecast_ms=(time.perf_counter()-forecast_started)*1000,
                    target_at=float(times[-1]+horizon_frames/FPS),future_offsets=[(i+1)/FPS for i in range(horizon_frames)],
                    detail=observation['detail'],image_points=observation['image_points'],
                    joint_names=NAMES,coordinate_note='本机摄像头估计；历史插值为20Hz，实际采集帧率另行显示。未来可见性未知，建议仅作练习参考。')
