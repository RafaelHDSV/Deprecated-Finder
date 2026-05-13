"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_ITEMS_V2 = exports.MAX_ITEMS = void 0;
exports.oldGreeting = oldGreeting;
exports.newGreeting = newGreeting;
/**
 * Prefer {@link newGreeting} for user-facing strings.
 * @deprecated use newGreeting instead
 */
function oldGreeting(name) {
    return `Hello, ${name}`;
}
function newGreeting(name) {
    return `Hi there, ${name}!`;
}
/** @deprecated replaced by MAX_ITEMS_V2 */
exports.MAX_ITEMS = 10;
exports.MAX_ITEMS_V2 = 100;
//# sourceMappingURL=legacy-api.js.map