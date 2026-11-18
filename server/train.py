from __future__ import annotations

import argparse
import copy
import json
import random
from datetime import datetime
from pathlib import Path

import numpy as np
import torch
from torch.utils.data import DataLoader, TensorDataset

from motion import FPS, HISTORY, HORIZON, ROOT, WEIGHTS_PATH, ForecastGRU, Predictor, adaptive_forecast, baseline_forecast, errors, features, load_sequence, masked_loss, window_anchors, window_ranges
from dataset import file_digest, load_speaker_manifest, sequence_anchors


def make_dataset(sequences, split):
    inputs, last_poses, targets, weights = [], [], [], []
    for sequence in sequences:
        positions, visibility = sequence["positions"], sequence["visibility"]
        for anchor in sequence_anchors(sequence, split):
            past = slice(anchor - HISTORY + 1, anchor + 1)
            future = slice(anchor + 1, anchor + HORIZON + 1)
            if (visibility[past, 1:7] >= 0.4).mean() < 0.35 or (visibility[future, 1:7] >= 0.4).mean() < 0.35:
                continue
            inputs.append(features(positions[past], visibility[past]))
            last_poses.append(positions[anchor])
            targets.append(positions[future])
            weights.append(visibility[future])
    if not inputs:
        raise ValueError(f"{split}没有可用窗口；每个时间分区应超过2.5秒且有可见手臂。")
    return TensorDataset(*(torch.from_numpy(np.stack(values).astype(np.float32)) for values in (inputs, last_poses, targets, weights)))


def evaluate(sequences, predictor, include_speakers=False):
    methods = ("gru", "persistence", "velocity", "adaptive") if "motion_gate_threshold" in predictor.metadata else ("gru", "persistence", "velocity")
    results = {method: [] for method in methods}
    by_speaker = {}
    for sequence in sequences:
        positions, visibility = sequence["positions"], sequence["visibility"]
        for anchor in sequence_anchors(sequence, "test", stride=5):
            past = slice(anchor - HISTORY + 1, anchor + 1)
            future = slice(anchor + 1, anchor + HORIZON + 1)
            if (visibility[past, 1:7] >= 0.4).mean() < 0.35 or (visibility[future, 1:7] >= 0.4).mean() < 0.35:
                continue
            for method in results:
                prediction = predictor.predict(positions[past], visibility[past], method)
                measurement = errors(prediction, positions[future], visibility[future])
                results[method].append(measurement)
                if "_speaker" in sequence:
                    by_speaker.setdefault(sequence["_speaker"], {key: [] for key in results})[method].append(measurement)
    summary = summarize(results)
    return (summary, {speaker: summarize(values) for speaker, values in by_speaker.items()}) if include_speakers else summary


def calibrate_gate(sequences, predictor):
    candidates = [0.002, 0.005, 0.01, 0.02, 0.04]
    values = {threshold: {} for threshold in candidates}
    for sequence in sequences:
        p, v = sequence['positions'], sequence['visibility']
        for anchor in sequence_anchors(sequence, 'validation', stride=10):
            past = slice(anchor-HISTORY+1, anchor+1)
            future = slice(anchor+1, anchor+HORIZON+1)
            if (v[past,1:7]>=.4).mean()<.35 or (v[future,1:7]>=.4).mean()<.35: continue
            prediction = predictor.predict(p[past], v[past], 'gru')
            for threshold in candidates:
                measurement = errors(adaptive_forecast(p[past],v[past],prediction,threshold),p[future],v[future])
                values[threshold].setdefault(sequence.get('_speaker','temporal'),[]).append(measurement['ade'])
    scores = {threshold:float(np.mean([np.mean(rows) for rows in speakers.values()])) for threshold,speakers in values.items() if speakers}
    if not scores: raise ValueError('No validation windows for motion gate calibration')
    selected = min(scores, key=scores.get)
    return selected, {'selection':'Lowest speaker-macro ADE on validation only, stride 10. Test not used.', 'candidates':scores, 'threshold_units':'shoulder-width per sampled frame'}


def summarize(results):
    summary = {}
    for method, rows in results.items():
        summary[method] = {key: float(np.mean([row[key] for row in rows if row[key] is not None])) if any(row[key] is not None for row in rows) else None for key in ("ade", "fde", "wrist_ade")}
        summary[method]["windows"] = len(rows)
    return summary


def train(paths=None, epochs=60, *, manifest_path=None, output_dir=None, initialize_from=None):
    torch.set_num_threads(4)
    torch.manual_seed(42)
    np.random.seed(42)
    random.seed(42)
    if manifest_path and paths:
        raise ValueError("请选择人员清单或传统NPZ列表中的一种输入。")
    if epochs < 1:
        raise ValueError("训练轮数至少为1。")
    provenance = {}
    if manifest_path:
        sequences, provenance = load_speaker_manifest(manifest_path)
        paths = [sequence["_source"] for sequence in sequences]
        output_dir = Path(output_dir) if output_dir else ROOT / "runs" / datetime.now().strftime("speakers-%Y%m%d-%H%M%S")
    else:
        if not paths:
            raise ValueError("需要提供NPZ文件或--manifest。")
        sequences = [load_sequence(path) for path in paths]
    weights_path = Path(output_dir) / "forecast.pt" if output_dir else WEIGHTS_PATH
    if output_dir and weights_path.exists():
        raise ValueError("输出目录已有forecast.pt，请换一个实验目录，保留既有结果。")
    training = make_dataset(sequences, "train")
    validation = make_dataset(sequences, "validation")
    train_loader = DataLoader(training, batch_size=48, shuffle=True, generator=torch.Generator().manual_seed(42))
    validation_loader = DataLoader(validation, batch_size=128)
    checkpoint = torch.load(initialize_from, map_location="cpu", weights_only=True) if initialize_from else None
    model = ForecastGRU(checkpoint.get("hidden_size", 64) if checkpoint else 64)
    if checkpoint:
        model.load_state_dict(checkpoint["state_dict"])
    learning_rate = 0.0002 if checkpoint else 0.001
    optimizer = torch.optim.AdamW(model.parameters(), lr=learning_rate, weight_decay=0.0001)
    best_state, best_loss, stalled = copy.deepcopy(model.state_dict()), float("inf"), 0
    history = []
    for epoch in range(epochs):
        model.train()
        train_losses = []
        for inputs, last_pose, target, visibility in train_loader:
            optimizer.zero_grad()
            prediction = model(inputs, last_pose)
            loss = masked_loss(prediction, target, visibility)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1)
            optimizer.step()
            train_losses.append(loss.item())
        model.eval()
        with torch.inference_mode():
            values = [masked_loss(model(inputs, last_pose), target, visibility).item() for inputs, last_pose, target, visibility in validation_loader]
        validation_loss = float(np.mean(values))
        history.append({"epoch": epoch + 1, "train_loss": float(np.mean(train_losses)), "validation_loss": validation_loss})
        print(json.dumps(history[-1]), flush=True)
        if validation_loss < best_loss - 1e-7:
            best_state, best_loss, stalled = copy.deepcopy(model.state_dict()), validation_loss, 0
        else:
            stalled += 1
        if stalled >= 12:
            break
    weights_path.parent.mkdir(parents=True, exist_ok=True)
    metadata = {
        "history_seconds": HISTORY / FPS, "horizon_seconds": HORIZON / FPS,
        "training_windows": len(training), "validation_windows": len(validation),
        "sources": [Path(path).name for path in paths], "best_validation_loss": best_loss,
        "split_policy": "Speaker-disjoint train/validation/test from manifest; all recordings from a speaker belong to one split. Windows remain within one recording." if manifest_path else "Each source recording is split chronologically 60/20/20 before constructing windows; no window crosses a boundary. Same-speaker temporal holdout only, not cross-speaker validation.",
        "coordinate_space": "MediaPipe estimated 3D, shoulder-centred, shoulder-width normalized",
        "training_type": "continued_training" if checkpoint else "from_scratch",
        "learning_rate": learning_rate,
        "initial_checkpoint_sha256": file_digest(initialize_from) if initialize_from else None,
        "data_provenance": provenance,
    }
    model.load_state_dict(best_state)
    model.eval()
    predictor = Predictor(weights=None)
    predictor.model = model
    predictor.metadata = metadata
    if manifest_path:
        threshold, calibration = calibrate_gate(sequences, predictor)
        metadata.update(motion_gate_threshold=threshold, gate_calibration=calibration,
                        adaptive_method='Last pose + recent joint visibility fraction × clipped median valid 5-step joint speed / validation threshold × GRU residual')
    metrics, per_speaker = evaluate(sequences, predictor, include_speakers=True)
    if not metrics["gru"]["windows"]:
        raise ValueError("测试集没有足够可见手臂的有效窗口，不保存可用于参赛的评测记录。")
    torch.save({"state_dict": best_state, "hidden_size": model.hidden_size, "metadata": metadata}, weights_path)
    report = {"metadata": metadata, "metrics": metrics, "per_speaker_metrics": per_speaker, "history": history}
    if per_speaker:
        report["speaker_macro_metrics"] = {
            method: {metric: float(np.mean([values[method][metric] for values in per_speaker.values() if values[method][metric] is not None]))
                     if any(values[method][metric] is not None for values in per_speaker.values()) else None
                     for metric in ("ade", "fde", "wrist_ade")}
            for method in metrics
        }
    (weights_path.parent / "evaluation.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(report["metrics"], indent=2), flush=True)
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("sequences", nargs="*", type=Path)
    parser.add_argument("--epochs", type=int, default=60)
    parser.add_argument("--manifest", type=Path, help="按演讲者分组的姿态数据JSON清单")
    parser.add_argument("--output-dir", type=Path, help="新实验的权重和评测记录目录")
    parser.add_argument("--init-from", type=Path, help="同结构GRU权重；提供时继续训练，否则从随机初始化开始")
    arguments = parser.parse_args()
    train(arguments.sequences, arguments.epochs, manifest_path=arguments.manifest, output_dir=arguments.output_dir, initialize_from=arguments.init_from)
