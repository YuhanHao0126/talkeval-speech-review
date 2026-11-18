import hashlib
import json
from pathlib import Path

import numpy as np

from motion import FPS, HISTORY, HORIZON, JOINTS, load_sequence, respect_segments, window_anchors

SPLITS = {"train", "validation", "test"}


def file_digest(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def sequence_anchors(sequence, split, stride=4, *, history_frames=HISTORY, horizon_frames=HORIZON):
    if "_split" not in sequence:
        return respect_segments(sequence, window_anchors(len(sequence["positions"]), split, stride, history_frames, horizon_frames), history_frames, horizon_frames)
    if sequence["_split"] != split:
        return []
    return respect_segments(sequence, range(history_frames - 1, len(sequence["positions"]) - horizon_frames, stride), history_frames, horizon_frames)


def load_speaker_manifest(path):
    path = Path(path).resolve()
    document = json.loads(path.read_text(encoding="utf-8-sig"))
    records = document.get("recordings", [])
    if not records:
        raise ValueError("数据清单没有recordings记录。")
    speaker_splits, normalized = {}, []
    for record in records:
        speaker = str(record.get("speaker_id", "")).strip()
        split = record.get("split")
        if not speaker or split not in SPLITS or not record.get("sequence_path"):
            raise ValueError("每条记录需要speaker_id、sequence_path及train/validation/test之一。")
        if speaker in speaker_splits and speaker_splits[speaker] != split:
            raise ValueError(f"演讲者{speaker}跨分区；同一人的所有录像必须属于同一分区。")
        speaker_splits[speaker] = split
        normalized.append((speaker, split, (path.parent / record["sequence_path"]).resolve()))
    if set(speaker_splits.values()) != SPLITS:
        raise ValueError("必须有演讲者互不重叠的训练、验证、测试三组，至少需要3位演讲者。")
    sequences, fingerprints, paths_seen = [], set(), set()
    for speaker, split, source in normalized:
        if source in paths_seen:
            raise ValueError(f"同一姿态文件重复列入数据清单：{source.name}")
        paths_seen.add(source)
        fingerprint = file_digest(source)
        if fingerprint in fingerprints:
            raise ValueError("发现内容完全相同的姿态文件，不能通过改文件名重复入库。")
        fingerprints.add(fingerprint)
        sequence = load_sequence(source)
        positions, visibility = sequence["positions"], sequence["visibility"]
        if positions.shape != (len(positions), len(JOINTS), 3) or visibility.shape != positions.shape[:2]:
            raise ValueError(f"{source.name}的关节点形状不符合9关节输入。")
        if len(positions) < HISTORY + HORIZON or not np.isfinite(positions).all() or not np.isfinite(visibility).all():
            raise ValueError(f"{source.name}的有效时长不足或存在无效数值。")
        if abs(float(sequence.get("fps", 0)) - FPS) > 0.01:
            raise ValueError(f"{source.name}必须按20fps提取姿态。")
        if np.abs(positions).max() > 20 or visibility.min() < 0 or visibility.max() > 1:
            raise ValueError(f"{source.name}的坐标或可见性超出范围。")
        segments = sequence.get("segment_ids")
        if segments is not None and (segments.shape != (len(positions),) or not np.isfinite(segments).all() or (np.diff(segments) < 0).any()):
            raise ValueError(f"{source.name}的镜头编号必须与帧对应且不递减。")
        sequence.update(_speaker=speaker, _split=split, _source=str(source), _sha256=fingerprint)
        sequences.append(sequence)
    return sequences, {
        "manifest_sha256": file_digest(path),
        "speaker_splits": speaker_splits,
        "speakers_per_split": {split: sum(value == split for value in speaker_splits.values()) for split in sorted(SPLITS)},
        "recordings": [{"speaker_id": sequence["_speaker"], "split": sequence["_split"], "sequence_path": sequence["_source"], "sha256": sequence["_sha256"]} for sequence in sequences],
    }
