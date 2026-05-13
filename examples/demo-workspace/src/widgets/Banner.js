"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Banner = Banner;
const legacy_api_1 = require("../legacy-api");
function Banner({ title }) {
    const subtitle = (0, legacy_api_1.oldGreeting)('visitor');
    return (<header>
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </header>);
}
//# sourceMappingURL=Banner.js.map