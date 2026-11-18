from __future__ import annotations

import json
import math
import time
import urllib.request
from pathlib import Path

import numpy as np
import torch
from torch import nn

ROOT = Path(__file__).resolve().parent
FPS = 20
HISTORY = 40
HORIZON = 10
JOINTS = [0, 11, 12, 13, 14, 15, 16, 23, 24]
NAMES = ["鼻尖", "左肩", "右肩", "左肘", "右肘", "左腕", "右腕", "左髋", "右髋"]
BONES = [(0, 1), (0, 2), (1, 2), (1, 3), (3, 5), (2, 4), (4, 6), (1, 7), (2, 8), (7, 8)]
MODEL_URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task"
MODEL_PATH = ROOT / "models" / "pose_landmarker_lite.task"
WEIGHTS_PATH = ROOT / "models" / "forecast.pt"


def download_pose_model():
    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    if not MODEL_PATH.exists():
        temporary = MODEL_PATH.with_suffix(".download")
        urllib.request.urlretrieve(MODEL_URL, temporary)
        temporary.replace(MODEL_PATH)
    return MODEL_PATH


def extract_video(path: Path, destination: Path, progress=None, maximum_seconds=120, detect_cuts=False):
    import cv2
    import mediapipe as mp

    download_pose_model()
    capture = cv2.VideoCapture(str(path))
    source_fps = capture.get(cv2.CAP_PROP_FPS)
    frame_count = capture.get(cv2.CAP_PROP_FRAME_COUNT)
    if not capture.isOpened() or not math.isfinite(source_fps) or source_fps <= 0:
        capture.release()
        raise ValueError("无法读取视频，请使用有效的MP4、WebM或MOV文件。")
    duration = frame_count / source_fps
    if duration < 2.5:
        capture.release()
        raise ValueError("视频至少需要2.5秒，才能保留2秒观察和0.5秒复盘。")
    if duration > maximum_seconds:
        capture.release()
        raise ValueError(f"此原型每段视频最多{maximum_seconds}秒，请先截取演讲者片段。")
    options = mp.tasks.vision.PoseLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_buffer=MODEL_PATH.read_bytes()),
        running_mode=mp.tasks.vision.RunningMode.VIDEO,
        num_poses=1,
        min_pose_detection_confidence=0.4,
        min_tracking_confidence=0.4,
    )
    poses, confidence, image_points, timestamps = [], [], [], []
    last_pose = np.zeros((len(JOINTS), 3), dtype=np.float32)
    last_image = np.zeros((len(JOINTS), 2), dtype=np.float32)
    frame_index, target_time = 0, 0.0
    segments, segment_id, previous_thumbnail, fresh_pose = [], 0, None, True
    try:
        with mp.tasks.vision.PoseLandmarker.create_from_options(options) as detector:
            while True:
                success, frame = capture.read()
                if not success:
                    break
                at = frame_index / source_fps
                frame_index += 1
                if at + 1e-6 < target_time:
                    continue
                if at > maximum_seconds:
                    break
                target_time += 1 / FPS
                height, width = frame.shape[:2]
                if width > 960:
                    frame = cv2.resize(frame, (960, round(height * 960 / width)))
                if detect_cuts:
                    thumbnail = cv2.resize(frame, (64, 36)).astype(np.float32) / 255
                    if previous_thumbnail is not None and np.abs(thumbnail - previous_thumbnail).mean() > 0.16:
                        segment_id += 1
                        last_pose.fill(0)
                        last_image.fill(0)
                        fresh_pose = True
                    previous_thumbnail = thumbnail
                image = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
                result = detector.detect_for_video(image, round(at * 1000))
                visibility = np.zeros(len(JOINTS), dtype=np.float32)
                if result.pose_world_landmarks and result.pose_landmarks:
                    world = result.pose_world_landmarks[0]
                    image_landmarks = result.pose_landmarks[0]
                    raw = np.array([[world[index].x, world[index].y, world[index].z] for index in JOINTS], dtype=np.float32)
                    visibility = np.array([min(image_landmarks[index].visibility, image_landmarks[index].presence) for index in JOINTS], dtype=np.float32)
                    root = (raw[1] + raw[2]) / 2
                    scale = np.linalg.norm(raw[1] - raw[2])
                    if np.isfinite(raw).all() and 0.08 < scale < 1.5 and min(visibility[1:3]) > 0.4:
                        canonical = (raw - root) / scale
                        canonical[:, 1:] *= -1
                        reliable = visibility >= 0.35
                        smoothed = canonical if fresh_pose else 0.55 * canonical + 0.45 * last_pose
                        last_pose[reliable] = smoothed[reliable]
                        fresh_pose = False
                        last_image = np.array([[image_landmarks[index].x, image_landmarks[index].y] for index in JOINTS], dtype=np.float32)
                    else:
                        visibility[:] = 0
                poses.append(last_pose.copy())
                confidence.append(visibility)
                image_points.append(last_image.copy())
                timestamps.append(at)
                segments.append(segment_id)
                if progress and len(poses) % 20 == 0:
                    progress(min(0.99, at / max(duration, 0.001)))
    finally:
        capture.release()
    if len(poses) < HISTORY + HORIZON:
        raise ValueError("有效视频时长不足2.5秒。")
    positions = np.stack(poses)
    visibility = np.stack(confidence)
    if (visibility[:, 1:7] >= 0.4).mean() < 0.15:
        raise ValueError("未找到足够的上半身姿态，请使用肩膀、手臂清楚可见的单人视频。")
    destination.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(destination, positions=positions, visibility=visibility, timestamps=np.asarray(timestamps), image_points=np.stack(image_points), segment_ids=np.asarray(segments, dtype=np.int32), fps=FPS)
    return load_sequence(destination)


def load_sequence(path):
    with np.load(path, allow_pickle=False) as archive:
        return {key: archive[key].copy() for key in archive.files}


def features(positions, visibility):
    positions = np.asarray(positions, dtype=np.float32)
    visibility = np.asarray(visibility, dtype=np.float32)
    masked = positions * visibility[..., None]
    velocity = np.zeros_like(masked)
    velocity[1:] = masked[1:] - masked[:-1]
    return np.concatenate((masked.reshape(len(positions), -1), velocity.reshape(len(positions), -1), visibility), axis=-1)


def validate_history(positions, visibility, history_frames=HISTORY):
    positions = np.asarray(positions, dtype=np.float32)
    visibility = np.asarray(visibility, dtype=np.float32)
    if positions.shape != (history_frames, len(JOINTS), 3) or visibility.shape != (history_frames, len(JOINTS)):
        raise ValueError(f"需要恰好{history_frames}帧、每帧9个3D关节及其可见性。")
    if not np.isfinite(positions).all() or not np.isfinite(visibility).all():
        raise ValueError("姿态数据包含无效数值。")
    if np.abs(positions).max() > 20 or visibility.min() < 0 or visibility.max() > 1:
        raise ValueError("姿态数值或可见性超出允许范围。")
    return positions, visibility


class ForecastGRU(nn.Module):
    def __init__(self, hidden_size=64, horizon_frames=HORIZON):
        super().__init__()
        self.hidden_size = hidden_size
        self.horizon_frames = horizon_frames
        self.encoder = nn.GRU(len(JOINTS) * 7, hidden_size, num_layers=2, batch_first=True, dropout=0.1)
        self.head = nn.Sequential(nn.Linear(hidden_size, hidden_size), nn.SiLU(), nn.Linear(hidden_size, horizon_frames * len(JOINTS) * 3))
        nn.init.zeros_(self.head[-1].weight)
        nn.init.zeros_(self.head[-1].bias)

    def forward(self, inputs, last_pose):
        encoded, _ = self.encoder(inputs)
        residual = self.head(encoded[:, -1]).reshape(-1, self.horizon_frames, len(JOINTS), 3)
        return last_pose[:, None] + residual


def baseline_forecast(positions, method, horizon_frames=HORIZON):
    last = positions[-1]
    if method == "persistence":
        return np.repeat(last[None], horizon_frames, axis=0)
    if method == "velocity":
        velocity = np.median(np.diff(positions[-6:], axis=0), axis=0)
        offsets = np.arange(1, horizon_frames + 1, dtype=np.float32)[:, None, None]
        return last[None] + offsets * velocity[None]
    raise ValueError("未知基线方法。")


def motion_gate(positions, visibility, threshold=0.01):
    """Causal per-joint reliability/motion gate. Threshold is selected on validation only."""
    valid = visibility[-6:] >= 0.4
    paired = valid[1:] & valid[:-1]
    speeds = np.linalg.norm(np.diff(positions[-6:], axis=0), axis=-1)
    speeds = np.where(paired, speeds, 0)
    speed = np.median(speeds, axis=0)
    quality = valid.mean(axis=0) * valid[-1]
    return (quality * np.clip(speed / max(float(threshold), 1e-6), 0, 1)).astype(np.float32)


def adaptive_forecast(positions, visibility, prediction, threshold=0.01):
    gate = motion_gate(positions, visibility, threshold)
    return positions[-1][None] + gate[None, :, None] * (prediction - positions[-1][None])


class Predictor:
    def __init__(self, weights=WEIGHTS_PATH):
        self.model = None
        self.metadata = {}
        self.history_options = [HISTORY]
        self.horizon_options = [HORIZON]
        if weights is not None and Path(weights).exists():
            checkpoint = torch.load(weights, map_location="cpu", weights_only=True)
            if checkpoint.get('model_type') == 'temporal_v4':
                from temporal_model import ForecastTemporal
                self.model = ForecastTemporal(checkpoint.get('hidden_size', 64), checkpoint.get('horizon_frames', 60))
            else:
                self.model = ForecastGRU(checkpoint.get("hidden_size", 64), checkpoint.get('horizon_frames', HORIZON))
            self.model.load_state_dict(checkpoint["state_dict"])
            self.model.eval()
            self.metadata = checkpoint.get("metadata", {})
            self.history_options = self.metadata.get('history_options_frames', [HISTORY])
            self.horizon_options = self.metadata.get('horizon_options_frames', [HORIZON])

    def predict(self, positions, visibility, method="gru", *, horizon_frames=None):
        history_frames = len(positions)
        horizon_frames = self.horizon_options[0] if horizon_frames is None else horizon_frames
        if history_frames not in self.history_options or horizon_frames not in self.horizon_options:
            raise ValueError('所选观察或预测时长不在该模型训练支持的范围内。')
        positions, visibility = validate_history(positions, visibility, history_frames)
        if method not in {"gru", "adaptive"}:
            return baseline_forecast(positions, method, horizon_frames)
        if self.model is None:
            raise ValueError("尚无训练权重，请先训练，或选择保持姿态／匀速外推基线。")
        with torch.inference_mode():
            if self.metadata.get('architecture') == 'temporal_convolution_ordered_pooling_smooth_knots_damped_motion':
                from temporal_model import temporal_features
                inputs=temporal_features(torch.from_numpy(positions)[None],torch.from_numpy(visibility)[None])
            else:
                inputs = torch.from_numpy(features(positions, visibility))[None]
            last_pose = torch.from_numpy(positions[-1])[None]
            prediction = self.model(inputs, last_pose)[0, :horizon_frames].numpy()
            if method == "adaptive":
                threshold = self.metadata.get('gate_thresholds', {}).get(f'{history_frames}:{horizon_frames}', self.metadata.get('motion_gate_threshold', .01))
                return adaptive_forecast(positions, visibility, prediction, threshold)
            return prediction


def window_ranges(length):
    train_end = int(length * 0.6)
    validation_end = int(length * 0.8)
    return {"train": (0, train_end), "validation": (train_end, validation_end), "test": (validation_end, length)}


def window_anchors(length, split, stride=4, history_frames=HISTORY, horizon_frames=HORIZON):
    start, end = window_ranges(length)[split]
    return list(range(start + history_frames - 1, end - horizon_frames, stride))


def respect_segments(sequence, anchors, history_frames=HISTORY, horizon_frames=HORIZON):
    segments = sequence.get("segment_ids")
    if segments is None:
        return list(anchors)
    return [anchor for anchor in anchors if segments[anchor - history_frames + 1] == segments[anchor + horizon_frames]]


def masked_loss(prediction, target, visibility):
    weights = (visibility >= 0.4).float() * visibility
    difference = nn.functional.smooth_l1_loss(prediction, target, reduction="none").mean(dim=-1)
    return (difference * weights).sum() / weights.sum().clamp_min(1)


def errors(prediction, target, visibility):
    distances = np.linalg.norm(prediction - target, axis=-1)
    valid = visibility >= 0.4
    wrists = valid[:, [5, 6]]
    return {
        "ade": float(distances[valid].mean()) if valid.any() else None,
        "fde": float(distances[-1][valid[-1]].mean()) if valid[-1].any() else None,
        "wrist_ade": float(distances[:, [5, 6]][wrists].mean()) if wrists.any() else None,
    }


def forecast_sequence(sequence, predictor, method="gru", stride=5, *, history_frames=HISTORY, horizon_frames=HORIZON):
    positions, visibility = sequence["positions"], sequence["visibility"]
    rows = []
    started = time.perf_counter()
    for anchor in respect_segments(sequence, range(history_frames - 1, len(positions) - horizon_frames, stride), history_frames, horizon_frames):
        prediction = predictor.predict(positions[anchor - history_frames + 1:anchor + 1], visibility[anchor - history_frames + 1:anchor + 1], method, horizon_frames=horizon_frames)
        rows.append({"anchor": anchor, "positions": prediction.round(5).tolist()})
    return rows, (time.perf_counter() - started) * 1000 / max(1, len(rows))


def to_payload(sequence, forecasts=None, *, history_frames=HISTORY, horizon_frames=HORIZON):
    payload = {
        "fps": FPS, "history_frames": history_frames, "horizon_frames": horizon_frames,
        "joint_names": NAMES, "bones": BONES,
        "timestamps": sequence["timestamps"].round(4).tolist(),
        "positions": sequence["positions"].round(5).tolist(),
        "visibility": sequence["visibility"].round(3).tolist(),
        "forecasts": forecasts or {},
        "split_ranges": window_ranges(len(sequence["positions"])),
        "coordinate_note": "单目估计的肩部中心相对3D坐标；1单位约为本帧肩宽。未来实测也来自同一姿态模型，并非动作捕捉真值。",
    }
    for key in ['detailed_positions','detailed_visibility','detailed_image_points']:
        if key in sequence:payload[key]=sequence[key].round(5).tolist()
    if 'pose_backend' in sequence:payload['pose_backend']=str(sequence['pose_backend'])
    return payload
