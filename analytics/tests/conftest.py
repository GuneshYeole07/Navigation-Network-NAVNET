import os
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("AUTO_TRAIN", "false")
os.environ.setdefault("ANALYTICS_KEY", "test-key")
os.environ.setdefault("MODEL_PATH", str(Path(__file__).parent / ".tmp-model.joblib"))

from app.simulate import random_ride, simulate_ride  # noqa: E402


@pytest.fixture(scope="session")
def known_ride():
    """60 km bike ride with group stops at km 20 (20 min) and 45 (10 min), slow ghat at km 30-38."""
    ride, scenario = simulate_ride(np.random.default_rng(1), km=60, stops=[(20_000, 20), (45_000, 10)], slow=[(30_000, 38_000, 0.5)])
    return ride, scenario


@pytest.fixture(scope="session")
def history():
    rng = np.random.default_rng(42)
    return [random_ride(rng) for _ in range(40)]
