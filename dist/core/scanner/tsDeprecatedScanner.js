"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanFileForDeprecated = scanFileForDeprecated;
const ts = __importStar(require("typescript"));
function scanFileForDeprecated(filePath, program, sourceFile) {
    const checker = program.getTypeChecker();
    const deprecatedItems = [];
    function visit(node) {
        const symbol = checker.getSymbolAtLocation(node);
        if (symbol) {
            const tags = symbol.getJsDocTags();
            const deprecatedTag = tags.find((tag) => tag.name === 'deprecated');
            if (deprecatedTag) {
                const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
                deprecatedItems.push({
                    id: `${symbol.getName()}-${line}-${character}`,
                    name: symbol.getName(),
                    filePath,
                    line: line + 1,
                    column: character + 1,
                    message: deprecatedTag.text?.map((t) => t.text).join(' '),
                    source: 'typescript'
                });
            }
        }
        ts.forEachChild(node, visit);
    }
    visit(sourceFile);
    return deprecatedItems;
}
