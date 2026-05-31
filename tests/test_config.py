import os


def test_config_ts_exists():
    assert os.path.exists("src/config.ts"), "src/config.ts must exist"


def test_config_ts_exports():
    content = open("src/config.ts").read()
    assert "export type Config" in content
    assert "export function loadConfig" in content


def test_config_ts_defaults():
    content = open("src/config.ts").read()
    assert "http://localhost:8088" in content
    assert "http://localhost:8080" in content


def test_config_ts_fallback_chain():
    content = open("src/config.ts").read()
    assert "VITE_CHARGE_SERVER_URL" in content
    assert "VITE_GHDAG_UI_URL" in content
    assert "nc.chargeServerUrl" in content
    assert "nc.ghdagUiUrl" in content


def test_main_ts_imports_config():
    content = open("src/main.ts").read()
    assert 'from "./config"' in content or "from './config'" in content
    assert "loadConfig" in content
