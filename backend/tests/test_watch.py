from __future__ import annotations

import pytest

from app.services.watch import MAX_POSITION_SEC, apply_control, initial_state, validate_source

HOSTS = ["upload.wikimedia.org", "archive.org"]


@pytest.mark.parametrize(
    "url",
    [
        "http://upload.wikimedia.org/a.webm",  # not https
        "https://evil.example/a.mp4",  # host not allowed
        "https://upload.wikimedia.org.evil.example/a.mp4",  # suffix trick
        "https://user:pw@upload.wikimedia.org/a.mp4",  # credentials
        "https://203.0.113.5/a.mp4",  # IP literal
        "https://upload.wikimedia.org:8443/a.mp4",  # odd port
        "https://upload.wikimedia.org/page.html",  # not a video file
        "javascript:alert(1)",
        "https://upload.wikimedia.org/a\n.mp4",
        "https://upload.wikimedia.org/" + "a" * 2100 + ".mp4",
    ],
)
def test_rejects_unsafe_sources(url: str) -> None:
    assert validate_source(url, "x", HOSTS) is None


def test_accepts_allowed_video_and_cleans_title() -> None:
    src = validate_source("https://ia800.us.archive.org/1/items/x/film.MP4", "  My\x00 film ", HOSTS)
    assert src == {"kind": "url", "url": "https://ia800.us.archive.org/1/items/x/film.MP4", "title": "My film"}


def test_control_clamps_and_stamps_time() -> None:
    st = {**initial_state(), "source": {"kind": "url", "url": "https://archive.org/a.mp4", "title": "a"}}
    played = apply_control(st, "play", 10**9)
    assert played["status"] == "playing" and played["positionSec"] == MAX_POSITION_SEC
    seeked = apply_control(played, "seek", 5)
    assert seeked["status"] == "playing" and seeked["positionSec"] == 5
    assert apply_control(st, "seek", 3)["status"] == "paused"  # seeking from idle doesn't auto-play
