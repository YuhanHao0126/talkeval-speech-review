"""Full pose observation: 33 landmarks, causal speed-sensitive smoothing.

The forecaster still predicts nine upper-body joints. Palm landmarks are
observations, never represented as independently predicted fingers.
"""
import urllib.request
from pathlib import Path
import numpy as np
from motion import ROOT, JOINTS, FPS, load_sequence

FULL_PATH = ROOT / 'models/pose_landmarker_full.task'
FULL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task'


def full_model():
    if not FULL_PATH.exists():
        FULL_PATH.parent.mkdir(parents=True, exist_ok=True)
        temporary = FULL_PATH.with_suffix('.download')
        urllib.request.urlretrieve(FULL_URL, temporary)
        temporary.replace(FULL_PATH)
    return FULL_PATH


class FinePose:
    def __init__(self):
        import mediapipe as mp
        self.mp = mp
        options = mp.tasks.vision.PoseLandmarkerOptions(
            base_options=mp.tasks.BaseOptions(model_asset_buffer=full_model().read_bytes()),
            running_mode=mp.tasks.vision.RunningMode.VIDEO, num_poses=1,
            min_pose_detection_confidence=.5, min_tracking_confidence=.5)
        self.detector = mp.tasks.vision.PoseLandmarker.create_from_options(options)
        self.reset()

    def reset(self):
        self.last = np.zeros((33, 3), np.float32)
        self.last_quality = np.zeros(33, np.float32)
        self.last_time = None

    def close(self):
        self.detector.close()

    def process(self, frame, timestamp_ms):
        import cv2
        timestamp_ms = int(timestamp_ms)
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        result = self.detector.detect_for_video(self.mp.Image(image_format=self.mp.ImageFormat.SRGB, data=rgb), timestamp_ms)
        quality = np.zeros(33, np.float32); image = np.zeros((33, 2), np.float32)
        if result.pose_world_landmarks and result.pose_landmarks:
            world = result.pose_world_landmarks[0]; landmarks = result.pose_landmarks[0]
            raw = np.array([[j.x, j.y, j.z] for j in world], np.float32)
            quality = np.array([min(j.visibility, j.presence) for j in landmarks], np.float32)
            image = np.array([[j.x, j.y] for j in landmarks], np.float32)
            scale = np.linalg.norm(raw[11] - raw[12])
            if np.isfinite(raw).all() and .08 < scale < 1.5 and min(quality[11:13]) > .4:
                canonical = (raw - (raw[11] + raw[12]) / 2) / scale
                canonical[:, 1:] *= -1
                dt = .05 if self.last_time is None else max(.01, (timestamp_ms-self.last_time)/1000)
                speed = np.linalg.norm(canonical-self.last, axis=1)/dt
                # One-pole adaptive cutoff: smooth stillness, follow a moving wrist.
                cutoff = 1.2 + .8 * np.minimum(speed, 8)
                alpha = 1 - np.exp(-2*np.pi*cutoff*dt)
                alpha[self.last_quality < .35] = 1
                smooth = self.last + alpha[:, None]*(canonical-self.last)
                valid = quality >= .35
                self.last[valid] = smooth[valid]
            else:
                quality[:] = 0
        self.last_quality = quality.copy(); self.last_time = timestamp_ms
        return self.last.copy(), quality, image


def extract_fine_video(path, destination, progress=None, maximum_seconds=120, detect_cuts=True):
    import cv2
    capture = cv2.VideoCapture(str(path)); source_fps = capture.get(cv2.CAP_PROP_FPS)
    duration = capture.get(cv2.CAP_PROP_FRAME_COUNT)/max(source_fps, 1e-9)
    if not capture.isOpened() or not np.isfinite(duration) or source_fps <= 0 or not 2.5 <= duration <= maximum_seconds:
        capture.release(); raise ValueError(f'视频需为2.5至{maximum_seconds}秒的可读单人片段。')
    tracker = FinePose(); rows=[]; qualities=[]; images=[]; times=[]; segments=[]
    previous=None; segment=0; source_index=0; next_target=0
    try:
        while True:
            ok, frame = capture.read()
            if not ok: break
            at=source_index/source_fps; source_index+=1
            if at+1e-6 < next_target: continue
            next_target+=1/FPS
            height,width=frame.shape[:2]
            if width>1280: frame=cv2.resize(frame,(1280,round(height*1280/width)))
            thumb=cv2.resize(frame,(64,36)).astype(np.float32)/255
            if detect_cuts and previous is not None and np.abs(thumb-previous).mean()>.16:
                segment+=1;tracker.reset()
            previous=thumb
            p,v,img=tracker.process(frame,round(at*1000))
            rows.append(p);qualities.append(v);images.append(img);times.append(at);segments.append(segment)
            if progress and len(rows)%20==0:progress(min(.99,at/duration))
    finally:
        tracker.close();capture.release()
    if len(rows)<50:raise ValueError('有效视频不足2.5秒。')
    positions=np.stack(rows);visibility=np.stack(qualities); image_points=np.stack(images)
    if (visibility[:,11:17]>=.4).mean()<.15:raise ValueError('上半身观测不足，请让肩、肘、腕保持入镜。')
    # Match the trained 20 Hz grid even when sources are 16 or 25 fps.
    times=np.asarray(times); grid=np.arange(int(np.floor(times[-1]*FPS))+1)/FPS
    def interpolate(values):
        flat=values.reshape(len(times),-1)
        return np.stack([np.interp(grid,times,flat[:,i]) for i in range(flat.shape[1])],axis=-1).reshape(len(grid),*values.shape[1:]).astype(np.float32)
    left=np.clip(np.searchsorted(times,grid,side='right')-1,0,len(times)-1);right=np.clip(left+1,0,len(times)-1)
    seg=np.asarray(segments); crossed=seg[left]!=seg[right]
    positions=interpolate(positions);image_points=interpolate(image_points)
    visibility=np.minimum(visibility[left],visibility[right]); visibility[crossed]=0
    destination=Path(destination);destination.parent.mkdir(parents=True,exist_ok=True)
    np.savez_compressed(destination,positions=positions[:,JOINTS],visibility=visibility[:,JOINTS],image_points=image_points[:,JOINTS],
                        detailed_positions=positions,detailed_visibility=visibility,detailed_image_points=image_points,
                        timestamps=grid,segment_ids=seg[left],fps=FPS,pose_backend='mediapipe_full_33_adaptive_v1')
    return load_sequence(destination)
