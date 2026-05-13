"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildWelcome = buildWelcome;
exports.getLimit = getLimit;
const legacy_api_1 = require("./legacy-api");
function buildWelcome(user) {
    return (0, legacy_api_1.oldGreeting)(user);
}
function getLimit() {
    return legacy_api_1.MAX_ITEMS;
}
//# sourceMappingURL=app.js.map