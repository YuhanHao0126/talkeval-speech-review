import numpy as np
import pytest
import torch

from motion import HISTORY, HORIZON, JOINTS, ForecastGRU, Predictor, errors, features, masked_loss, window_anchors, window_ranges
from motion import adaptive_forecast


def history():
    positions = np.zeros((HISTORY, len(JOINTS), 3), dtype=np.float32)
    positions[:, :, 0] = np.arange(HISTORY)[:, None] * 0.01
    visibility = np.ones((HISTORY, len(JOINTS)), dtype=np.float32)
    return positions, visibility


def test_baselines_have_correct_time_horizon_and_velocity(tmp_path):
    positions, visibility = history()
    predictor = Predictor(tmp_path / "missing.pt")
    persistence = predictor.predict(positions, visibility, "persistence")
    velocity = predictor.predict(positions, visibility, "velocity")
    assert persistence.shape == (HORIZON, len(JOINTS), 3)
    np.testing.assert_allclose(persistence[-1], positions[-1])
    np.testing.assert_allclose(velocity[-1, :, 0], 0.49, atol=1e-6)


def test_training_windows_do_not_cross_chronological_boundaries():
    ranges = window_ranges(1000)
    for split in ranges:
        start, end = ranges[split]
        for anchor in window_anchors(1000, split):
            assert anchor - HISTORY + 1 >= start
            assert anchor + HORIZON < end
    assert max(window_anchors(1000, "train")) + HORIZON < min(window_anchors(1000, "validation")) - HISTORY + 1


def test_missing_joint_targets_do_not_affect_loss():
    prediction = torch.zeros(1, HORIZON, len(JOINTS), 3)
    target = torch.zeros_like(prediction)
    visibility = torch.ones(1, HORIZON, len(JOINTS))
    visibility[:, :, 5] = 0
    target[:, :, 5] = 100
    assert masked_loss(prediction, target, visibility).item() == 0


def test_invalid_inputs_rejected(tmp_path):
    positions, visibility = history()
    positions[0, 0, 0] = np.nan
    with pytest.raises(ValueError):
        Predictor(tmp_path / "missing.pt").predict(positions, visibility, "persistence")
    with pytest.raises(ValueError):
        Predictor(tmp_path / "missing.pt").predict(positions[:10], visibility[:10], "persistence")


def test_trained_model_checkpoint_can_reload_without_future_inputs(tmp_path):
    positions, visibility = history()
    model = ForecastGRU()
    checkpoint = tmp_path / "model.pt"
    torch.save({"state_dict": model.state_dict(), "hidden_size": 64, "metadata": {}}, checkpoint)
    predictor = Predictor(checkpoint)
    first = predictor.predict(positions, visibility)
    second = predictor.predict(positions.copy(), visibility.copy())
    np.testing.assert_allclose(first, second)
    assert first.shape == (HORIZON, len(JOINTS), 3)


def test_metric_excludes_invisible_joints():
    prediction = np.zeros((HORIZON, len(JOINTS), 3))
    target = prediction.copy()
    target[:, 5] = 100
    visibility = np.ones((HORIZON, len(JOINTS)))
    visibility[:, 5] = 0
    assert errors(prediction, target, visibility)["ade"] == 0


def test_adaptive_gate_holds_static_or_occluded_joints_and_keeps_motion():
    p, v = history()
    forecast = np.repeat(p[-1][None], HORIZON, axis=0) + 0.5
    moving = adaptive_forecast(p, v, forecast, .005)
    np.testing.assert_allclose(moving, forecast)
    v[:,5] = 0
    p[:,6] = p[-1,6]
    gated = adaptive_forecast(p, v, forecast, .005)
    np.testing.assert_allclose(gated[:,5], np.repeat(p[-1,5][None], HORIZON, axis=0))
    np.testing.assert_allclose(gated[:,6], np.repeat(p[-1,6][None], HORIZON, axis=0))
