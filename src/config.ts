export type Config = {
  chargeServerUrl: string;
  ghdagUiUrl: string;
};

const DEFAULTS: Config = {
  chargeServerUrl: "http://localhost:8088",
  ghdagUiUrl: "http://localhost:8080",
};

export function loadConfig(): Config {
  return {
    chargeServerUrl:
      import.meta.env.VITE_CHARGE_SERVER_URL ??
      localStorage.getItem("nc.chargeServerUrl") ??
      DEFAULTS.chargeServerUrl,
    ghdagUiUrl:
      import.meta.env.VITE_GHDAG_UI_URL ??
      localStorage.getItem("nc.ghdagUiUrl") ??
      DEFAULTS.ghdagUiUrl,
  };
}
