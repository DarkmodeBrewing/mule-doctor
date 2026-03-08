export function redactLine(line: string): string {
  return redactText(line);
}

export function redactText(text: string): string {
  return text
    .replace(/(authorization"\s*:\s*"bearer\s+)[^"]+/gi, "$1[redacted]")
    .replace(/(x-debug-token"\s*:\s*")[^"]+/gi, '$1[redacted]')
    .replace(/(openai_api_key\s*=\s*)\S+/gi, "$1[redacted]")
    .replace(/(api[_-]?key\s*[=:]\s*)\S+/gi, "$1[redacted]")
    .replace(/(token\s*[=:]\s*)\S+/gi, "$1[redacted]");
}
