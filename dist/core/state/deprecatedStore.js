"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deprecatedStore = void 0;
class DeprecatedStore {
    constructor() {
        this.items = [];
    }
    set(items) {
        this.items = items;
    }
    getAll() {
        return this.items;
    }
    clear() {
        this.items = [];
    }
}
exports.deprecatedStore = new DeprecatedStore();
