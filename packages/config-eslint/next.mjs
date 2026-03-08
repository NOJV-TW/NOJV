import nextVitals from "eslint-config-next/core-web-vitals";

import baseConfig from "./base.mjs";

export default [...baseConfig, ...nextVitals];
