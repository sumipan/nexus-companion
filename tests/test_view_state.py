import os


def test_view_ts_exists():
    assert os.path.exists("src/state/view.ts"), "src/state/view.ts must exist"


def test_view_ts_exports():
    content = open("src/state/view.ts").read()
    assert "export type ViewName" in content
    assert "export function getView" in content
    assert "export function subscribe" in content
    assert "export function nextView" in content


def test_view_test_ts_exists():
    assert os.path.exists("tests/state/view.test.ts"), "tests/state/view.test.ts must exist"
    content = open("tests/state/view.test.ts").read()
    assert "nextView" in content
    assert "subscribe" in content
    assert "unsubscribe" in content or "unsub()" in content
