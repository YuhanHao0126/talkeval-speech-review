from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch

from motion import ROOT, Predictor, extract_video, forecast_sequence, load_sequence, to_payload
from train import train


def prepare(video, epochs=60, skip_extract=False, skip_training=False):
    torch.set_num_threads(4)
    sequence_path = ROOT / "data" / "sample.npz"
    if not skip_extract:
        extract_video(video, sequence_path, lambda value: print(f"pose_progress={value:.2f}", flush=True))
    sequence = load_sequence(sequence_path)
    if not skip_training:
        train([sequence_path], epochs)
    predictor = Predictor()
    predictions, timings = {}, {}
    for method in ["persistence", "velocity"] + (["gru"] if predictor.model else []):
        predictions[method], timings[method] = forecast_sequence(sequence, predictor, method)
    payload = to_payload(sequence, predictions)
    payload.update(
        title="团队演讲片段 · 动作预测实验",
        source="团队提供的屏幕录制中的摄像头片段",
        video_url="/static/sample.mp4",
        latency_ms=timings,
        evaluation_scope="同一演讲者按原录像时间先划分60/20/20，再构造窗口。测试窗口不跨分区，未证明跨人泛化。",
    )
    output = ROOT / "static" / "sample.json"
    output.write_text(json.dumps(payload, ensure_ascii=False, allow_nan=False), encoding="utf-8")
    print(json.dumps({"frames": len(sequence["positions"]), "mean_visibility": float(sequence["visibility"].mean()), "latency_ms": timings}, indent=2), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", type=Path, default=ROOT / "static" / "sample.mp4")
    parser.add_argument("--epochs", type=int, default=60)
    parser.add_argument("--skip-extract", action="store_true")
    parser.add_argument("--skip-training", action="store_true")
    arguments = parser.parse_args()
    prepare(arguments.video, arguments.epochs, arguments.skip_extract, arguments.skip_training)
