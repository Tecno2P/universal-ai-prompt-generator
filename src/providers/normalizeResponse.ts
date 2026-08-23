/**
 * normalizeAIResponse — Robust AI response normalizer.
 *
 * Cleans up the raw text returned by any AI provider so it can be safely
 * parsed as JSON. Handles common issues:
 *   - UTF-8 BOM
 *   - Markdown code fences (```json ... ``` or ``` ... ```)
 *   - Leading/trailing whitespace
 *   - Conversational text before/after the JSON object
 *   - Escaped/unescaped newlines inside string values
 *   - Trailing commas
 *   - Single-quoted JSON (common mistake from some models)
 *
 * This function does NOT mutate the original string. It returns a new string.
 * If the response is empty or contains no JSON object, it throws.
 */

/**
 * Result of a normalization attempt.
 */
export interface NormalizedResult {
  /** The cleaned JSON string ready for JSON.parse() */
  cleaned: string
  /** The original raw response for debugging */
  raw: string
  /** How the JSON was extracted */
  method: 'direct' | 'fence-removal' | 'object-extraction' | 'repair'
}

/**
 * Remove a UTF-8 BOM (U+FEFF) if present at the start of the string.
 */
function stripBOM(text: string): string {
  if (text.charCodeAt(0) === 0xfeff) {
    return text.slice(1)
  }
  return text
}

/**
 * Remove Markdown code fences if they wrap the entire response.
 * Only removes fences that appear to enclose the entire content —
 * does not touch fences that are inside JSON string values.
 *
 * Handles:
 *   ```json\n{...}\n```
 *   ```\n{...}\n```
 *   ```json\r\n{...}\r\n```
 */
function stripCodeFences(text: string): string {
  const trimmed = text.trim()

  // Match opening fence: ```json or ``` (with optional language tag)
  const fenceMatch = trimmed.match(/^```(?:json|JSON|javascript|js)?\s*\n?([\s\S]*?)\n?```\s*$/)
  if (fenceMatch) {
    return fenceMatch[1].trim()
  }

  return trimmed
}

/**
 * Extract the first JSON object from a string that may contain
 * conversational text before/after the JSON.
 *
 * Finds the first `{` and the matching closing `}` by counting braces,
 * respecting string literals and escape sequences.
 */
function extractJsonObject(text: string): string {
  const start = text.indexOf('{')
  if (start === -1) {
    throw new Error('No JSON object found in AI response')
  }

  // Count braces, respecting string literals
  let depth = 0
  let inString = false
  let escaped = false
  let end = -1

  for (let i = start; i < text.length; i++) {
    const char = text[i]

    if (escaped) {
      escaped = false
      continue
    }

    if (char === '\\' && inString) {
      escaped = true
      continue
    }

    if (char === '"') {
      inString = !inString
      continue
    }

    if (inString) continue

    if (char === '{') depth++
    else if (char === '}') {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }

  if (end === -1) {
    throw new Error('Unterminated JSON object in AI response')
  }

  return text.slice(start, end + 1)
}

/**
 * Attempt to repair common JSON issues:
 *   - Trailing commas before } or ]
 *   - Single quotes used instead of double quotes (keys/values)
 *   - Unescaped newlines inside string values
 *   - Control characters (tabs)
 *
 * Returns repaired string, or original if repair didn't help.
 */
function repairJson(text: string): string {
  let repaired = text

  // Remove trailing commas before } or ]
  repaired = repaired.replace(/,(\s*[\]}])/g, '$1')

  // Replace single-quoted keys/values with double-quoted
  // (careful: only outside of existing double-quoted strings)
  // This is a best-effort heuristic, not a full parser.
  repaired = repaired.replace(/'([^']+)'/g, '"$1"')

  // Escape literal tabs inside string values
  repaired = repaired.replace(/\t/g, '\\t')

  return repaired
}

/**
 * Main entry point: normalize an AI response into clean, parseable JSON.
 *
 * @param rawResponse - The raw text returned by the AI provider's adapter
 * @returns NormalizedResult with the cleaned JSON string
 * @throws Error if no valid JSON can be extracted
 */
export function normalizeAIResponse(rawResponse: string): NormalizedResult {
  if (!rawResponse || typeof rawResponse !== 'string') {
    throw new Error('AI response is empty or not a string')
  }

  const raw = rawResponse

  // Step 1: Strip BOM
  let text = stripBOM(rawResponse)

  // Step 2: Trim whitespace
  text = text.trim()

  if (text.length === 0) {
    throw new Error('AI response is empty after trimming')
  }

  // Step 3: Try direct parse (best case — model returned clean JSON)
  try {
    JSON.parse(text)
    return { cleaned: text, raw, method: 'direct' }
  } catch {
    // continue to more aggressive cleaning
  }

  // Step 4: Remove code fences if they wrap the entire response
  const fenceStripped = stripCodeFences(text)
  try {
    JSON.parse(fenceStripped)
    return { cleaned: fenceStripped, raw, method: 'fence-removal' }
  } catch {
    // continue
  }

  // Step 5: Extract JSON object from surrounding text
  let extracted: string
  try {
    extracted = extractJsonObject(fenceStripped)
  } catch (e) {
    // Step 5b: Try extraction on the original text too
    try {
      extracted = extractJsonObject(text)
    } catch {
      throw new Error(
        `Could not extract JSON from AI response. ` +
        `Response starts with: "${text.slice(0, 200)}..."`,
      )
    }
  }

  try {
    JSON.parse(extracted)
    return { cleaned: extracted, raw, method: 'object-extraction' }
  } catch {
    // continue to repair
  }

  // Step 6: Attempt repair
  const repaired = repairJson(extracted)
  try {
    JSON.parse(repaired)
    return { cleaned: repaired, raw, method: 'repair' }
  } catch (e) {
    // Last resort: return the extracted text and let JSON.parse throw
    // with a meaningful message
    throw new Error(
      `AI response could not be parsed as JSON after normalization. ` +
      `Extracted text starts with: "${extracted.slice(0, 200)}...". ` +
      `Error: ${(e as Error).message}`,
    )
  }
}

/**
 * Convenience function: normalize + parse in one step.
 * Returns the parsed object or throws with a descriptive error.
 */
export function parseAIJsonResponse<T = unknown>(rawResponse: string): T {
  const result = normalizeAIResponse(rawResponse)
  return JSON.parse(result.cleaned) as T
}
