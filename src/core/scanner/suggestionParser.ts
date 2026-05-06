/**
 * Parses the free-form text of a JSDoc @deprecated tag and tries to extract
 * the suggested replacement symbol name.
 *
 * Recognized patterns (case-insensitive):
 *   - "use `X` instead"
 *   - "use X instead"
 *   - "replaced by X"
 *   - "replaced with X"
 *   - "use X"
 *   - "utilize X"
 *   - "in favor of X"
 *   - "use {@link X}"
 *
 * Returns undefined when no clear suggestion can be extracted.
 */

const SYMBOL_PATTERN = '([A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*)*)'

const PATTERNS: RegExp[] = [
  new RegExp(`use\\s+\`?${SYMBOL_PATTERN}\`?\\s+instead`, 'i'),
  new RegExp(`replaced\\s+by\\s+\`?${SYMBOL_PATTERN}\`?`, 'i'),
  new RegExp(`replaced\\s+with\\s+\`?${SYMBOL_PATTERN}\`?`, 'i'),
  new RegExp(`in\\s+favor\\s+of\\s+\`?${SYMBOL_PATTERN}\`?`, 'i'),
  new RegExp(`utilize\\s+\`?${SYMBOL_PATTERN}\`?`, 'i'),
  new RegExp(`\\{@link\\s+${SYMBOL_PATTERN}[^}]*\\}`, 'i'),
  new RegExp(`use\\s+\`?${SYMBOL_PATTERN}\`?\\.?$`, 'i'),
  new RegExp(`prefer\\s+\`?${SYMBOL_PATTERN}\`?`, 'i')
]

export function parseSuggestion(deprecatedText: string): string | undefined {
  if (!deprecatedText) {
    return undefined
  }

  const cleaned = deprecatedText
    .replace(/\s+/g, ' ')
    .replace(/^@deprecated\s*/i, '')
    .trim()

  if (!cleaned) {
    return undefined
  }

  for (const pattern of PATTERNS) {
    const match = cleaned.match(pattern)
    if (match && match[1]) {
      return match[1]
    }
  }

  return undefined
}

/**
 * Tries to detect a different module specifier mentioned in the @deprecated text.
 * Examples:
 *   - "use X from 'new-pkg'"   → "new-pkg"
 *   - "import from \"new/path\"" → "new/path"
 */
export function parseSuggestionModule(
  deprecatedText: string
): string | undefined {
  if (!deprecatedText) {
    return undefined
  }

  const fromMatch = deprecatedText.match(
    /from\s+['"`]([^'"`]+)['"`]/i
  )
  if (fromMatch) {
    return fromMatch[1]
  }

  return undefined
}
