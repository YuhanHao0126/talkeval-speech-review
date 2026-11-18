import json

import numpy as np
import pytest

from dataset import file_digest, load_speaker_manifest, sequence_anchors
from motion import HISTORY, HORIZON, JOINTS, Predictor
from train import make_dataset, train


def manifest_fixture(directory):
    records = []
    for index, split in enumerate(["train", "validation", "test"]):
        path = directory / f"person-{index}.npz"
        random = np.random.default_rng(index)
        positions = random.normal(0, 0.1, (100, len(JOINTS), 3)).astype(np.float32)
        visibility = np.ones((100, len(JOINTS)), dtype=np.float32)
        np.savez_compressed(path, positions=positions, visibility=visibility, fps=20)
        records.append({"speaker_id": f"person-{index}", "split": split, "sequence_path": path.name})
    manifest = directory / "manifest.json"
    manifest.write_text(json.dumps({"recordings": records}), encoding="utf-8")
    return manifest, records


def test_person_split_keeps_whole_recordings_and_windows_inside_one_person(tmp_path):
    manifest, _ = manifest_fixture(tmp_path)
    sequences, metadata = load_speaker_manifest(manifest)
    assert metadata["speakers_per_split"] == {"train": 1, "validation": 1, "test": 1}
    for sequence in sequences:
        for split in ["train", "validation", "test"]:
            anchors = sequence_anchors(sequence, split)
            assert bool(anchors) == (sequence["_split"] == split)
            assert all(anchor - HISTORY + 1 >= 0 and anchor + HORIZON < len(sequence["positions"]) for anchor in anchors)
        assert sequence_anchors(sequence, sequence["_split"])[0] == HISTORY - 1
    training = make_dataset(sequences, "train")
    assert len(training) == len(sequence_anchors(sequences[0], "train"))


def test_same_speaker_cannot_appear_in_training_and_test(tmp_path):
    manifest, records = manifest_fixture(tmp_path)
    records[2]["speaker_id"] = records[0]["speaker_id"]
    manifest.write_text(json.dumps({"recordings": records}), encoding="utf-8")
    with pytest.raises(ValueError, match="跨分区"):
        load_speaker_manifest(manifest)


def test_renamed_duplicate_recording_is_rejected(tmp_path):
    manifest, records = manifest_fixture(tmp_path)
    (tmp_path / records[2]["sequence_path"]).write_bytes((tmp_path / records[0]["sequence_path"]).read_bytes())
    with pytest.raises(ValueError, match="内容完全相同"):
        load_speaker_manifest(manifest)


def test_training_windows_do_not_cross_video_shot_changes():
    sequence = {"positions": np.zeros((200, len(JOINTS), 3)), "_split": "train", "segment_ids": np.repeat([0, 1], 100)}
    anchors = sequence_anchors(sequence, "train", stride=1)
    assert 90 not in anchors and 100 not in anchors
    assert 39 in anchors and 139 in anchors
    assert all(sequence["segment_ids"][anchor-HISTORY+1] == sequence["segment_ids"][anchor+HORIZON] for anchor in anchors)


def test_training_and_continued_training_have_separate_provenance(tmp_path):
    manifest, _ = manifest_fixture(tmp_path)
    first = tmp_path / "scratch"
    report = train(epochs=1, manifest_path=manifest, output_dir=first)
    assert report["metadata"]["training_type"] == "from_scratch"
    assert set(report["per_speaker_metrics"]) == {"person-2"}
    checkpoint = first / "forecast.pt"
    original_hash = file_digest(checkpoint)
    resumed = train(epochs=1, manifest_path=manifest, output_dir=tmp_path / "continued", initialize_from=checkpoint)
    assert resumed["metadata"]["training_type"] == "continued_training"
    assert resumed["metadata"]["initial_checkpoint_sha256"] == original_hash
    assert file_digest(checkpoint) == original_hash
    sequences, _ = load_speaker_manifest(manifest)
    predictor = Predictor(tmp_path / "continued" / "forecast.pt")
    forecast = predictor.predict(sequences[0]["positions"][:HISTORY], sequences[0]["visibility"][:HISTORY])
    assert forecast.shape == (HORIZON, len(JOINTS), 3)
    assert np.isfinite(forecast).all()
