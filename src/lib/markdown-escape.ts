// src/lib/markdown-escape.ts

/**
 * Escapes special characters for Telegram's MarkdownV2 format.
 * The following characters must be escaped with a backslash if they are part of raw text:
 * '_', '*', '[', ']', '(', ')', '~', '`', '>', '#', '+', '-', '=', '|', '{', '}', '.', '!'
 */
export function escapeMarkdownV2(text: string | null | undefined): string {
  if (!text) return '';
  // Escapes backslash first, then other special MarkdownV2 symbols
  return text.replace(/([\\_*\[\]\(\)~`>#\+\-=\|\{\}\.!])/g, '\\$1');
}
