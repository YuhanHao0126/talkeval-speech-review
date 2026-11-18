import io

import numpy as np

from app import app
from motion import HISTORY, JOINTS


def test_forecast_endpoint_requires_exact_history():
    client = app.test_client()
    response = client.post('/api/forecast', json={"positions": [], "visibility": []})
    assert response.status_code == 400


def test_forecast_endpoint_returns_baseline_future():
    client = app.test_client()
    response = client.post('/api/forecast', json={
        "positions": np.zeros((HISTORY, len(JOINTS), 3)).tolist(),
        "visibility": np.ones((HISTORY, len(JOINTS))).tolist(),
        "method": "persistence",
    })
    assert response.status_code == 200
    assert len(response.json['positions']) == 10
    assert response.json['history_seconds'] == 2
    assert response.json['horizon_seconds'] == 0.5


def test_invalid_upload_and_result_path():
    client = app.test_client()
    assert client.post('/api/analyze').status_code == 400
    response = client.post('/api/analyze', data={"video": (io.BytesIO(b'text'), 'test.txt')})
    assert response.status_code == 400
    assert client.get('/api/result/not-a-valid-id').status_code == 400
