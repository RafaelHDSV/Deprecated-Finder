"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.addLine = addLine;
exports.snapshot = snapshot;
const legacy_api_1 = require("./legacy-api");
const lines = [];
function addLine(name) {
    lines.push((0, legacy_api_1.oldGreeting)(name));
}
function snapshot() {
    return lines;
}
//# sourceMappingURL=reports.js.map