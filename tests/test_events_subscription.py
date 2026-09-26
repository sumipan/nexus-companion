import os
import re


def _read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def test_events_ts_exists():
    assert os.path.exists("src/api/events.ts"), "src/api/events.ts must exist"
    assert os.path.exists("tests/api/events.test.ts"), "tests/api/events.test.ts must exist"


def test_events_ts_exports():
    content = _read("src/api/events.ts")
    assert "export function parseSseChunk" in content
    assert "export function subscribeEvents" in content
    assert "export type SseEvent" in content
    assert "EventSource" in content
    assert "getReader()" in content
    assert "/events" in content


def test_main_subscribes_once_and_dispatches():
    content = _read("src/main.ts")
    assert 'from "./api/events"' in content
    assert len(re.findall(r"\bsubscribeEvents\(", content)) == 1
    # 3 ビューへ配る
    assert "receiveMessageEvent" in content
    assert "receiveRowsEvent" in content
    assert "receiveQueueEvent" in content
    assert "receiveUsageEvent" in content


def test_main_falls_back_to_polling_when_subscription_is_null():
    content = _read("src/main.ts")
    assert re.search(r"if \(\s*!?events\s*(===\s*null)?\s*\)", content) or (
        "events === null" in content
    )
    assert "setStreamConnected(false)" in content


def test_main_fans_out_connection_state():
    content = _read("src/main.ts")
    assert "setMessageStreamConnected(connected)" in content
    assert "setDashboardStreamConnected(connected)" in content


def test_main_reconnects_on_foreground():
    content = _read("src/main.ts")
    assert '"visibilitychange"' in content
    assert "reconnect()" in content
    assert "FOREGROUND_ENTER_EVENT" in content


def test_fallback_poll_interval_is_60s():
    for path in ("src/views/message.ts", "src/views/dashboard.ts"):
        content = _read(path)
        assert "FALLBACK_POLL_INTERVAL_MS = 60_000" in content, path
        # 旧 30 秒 / 10 秒の常時ポーラーは残さない
        assert "30_000" not in content, path
        assert "10_000" not in content, path


def test_message_view_stops_polling_while_connected():
    content = _read("src/views/message.ts")
    assert "export function setMessageStreamConnected" in content
    assert "export function receiveMessageEvent" in content
    assert "export function refreshMessageOnce" in content
    body = content.split("export function setMessageStreamConnected", 1)[1]
    assert "stopMessagePoller()" in body
    assert "startMessagePoller()" in body


def test_dashboard_view_stops_polling_while_connected():
    content = _read("src/views/dashboard.ts")
    assert "export function setDashboardStreamConnected" in content
    assert "export function receiveRowsEvent" in content
    assert "export function receiveQueueEvent" in content
    assert "export function receiveUsageEvent" in content
    assert re.search(r"export (async )?function refreshDashboardOnce", content)
    body = content.split("export function setDashboardStreamConnected", 1)[1]
    assert "stopPollTimer()" in body
    assert "startPollTimer()" in body


def test_charge_view_has_cache_setter():
    content = _read("src/views/charge.ts")
    assert "export function setCachedCharge" in content


def test_readme_documents_events_and_fallback():
    content = _read("README.md")
    assert "/events" in content
    assert "60 秒" in content
