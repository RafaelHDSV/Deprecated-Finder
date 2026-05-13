"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LIMIT_CAP = exports.MAX_ITEMS = void 0;
exports.oldGreeting = oldGreeting;
exports.formatUserGreeting = formatUserGreeting;
/**
 * Prefer formatUserGreeting for user-facing strings.
 * @deprecated use formatUserGreeting instead
 */
function oldGreeting(name) {
    return `Hello, ${name}`;
}
function formatUserGreeting(name) {
    return `Hi there, ${name}!`;
}
/** @deprecated use LIMIT_CAP instead */
exports.MAX_ITEMS = 10;
exports.LIMIT_CAP = 100;
//# sourceMappingURL=legacy-api.js.map