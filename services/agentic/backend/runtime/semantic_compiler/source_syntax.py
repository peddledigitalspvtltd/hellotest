"""Small literal readers, never eval, execution or imports from a scanned repository."""
from __future__ import annotations
import json
import re


def mask_js(text, strings=False):
    out = list(text)
    i = 0
    size = len(text)
    while i < size:
        ch = text[i]
        if ch in {'"', "'", '`'}:
            start = i
            i += 1
            while i < size:
                if text[i] == '\\':
                    i += 2
                elif text[i] == ch:
                    i += 1
                    break
                else:
                    i += 1
            if strings:
                for j in range(start, min(i, size)):
                    if out[j] not in '\r\n': out[j] = ' '
            continue
        if text.startswith('//', i) or text.startswith('/*', i):
            end = text.find('\n', i + 2) if text.startswith('//', i) else text.find('*/', i + 2)
            if end < 0: end = size
            elif text.startswith('/*', i): end += 2
            for j in range(i, end):
                if out[j] not in '\r\n': out[j] = ' '
            i = end
            continue
        i += 1
    return ''.join(out)


def literal(text):
    """Read JSON-like JS literals without coercing expressions or executing code."""
    value, pos = _value(text, 0, 0)
    if text[pos:].strip():
        raise ValueError('Not a static literal')
    return value


def _value(text, pos, depth):
    if depth > 24:
        raise ValueError('Literal is too deeply nested')
    while pos < len(text) and text[pos].isspace(): pos += 1
    if pos >= len(text): raise ValueError('Missing literal')
    ch = text[pos]
    if ch in {'"', "'", '`'}:
        quote = ch
        pos += 1
        chars = []
        while pos < len(text):
            ch = text[pos]
            if ch == quote:
                result = ''.join(chars)
                if quote == '`' and '${' in result: raise ValueError('Dynamic template')
                return result, pos + 1
            if ch == '\\':
                pos += 1
                if pos >= len(text): raise ValueError('Incomplete escape')
                ch = text[pos]
                if ch in {'u', 'x'}:
                    width = 4 if ch == 'u' else 2
                    raw = text[pos+1:pos+1+width]
                    if len(raw) != width or not re.fullmatch(r'[0-9a-fA-F]+', raw): raise ValueError('Invalid escape')
                    chars.append(chr(int(raw, 16)))
                    pos += width + 1
                    continue
                chars.append({'n': '\n', 'r': '\r', 't': '\t', 'b': '\b', 'f': '\f'}.get(ch, ch))
            else:
                chars.append(ch)
            pos += 1
        raise ValueError('Unclosed string')
    if ch in '{[':
        is_object = ch == '{'
        result = {} if is_object else []
        closing = '}' if is_object else ']'
        pos += 1
        count = 0
        while True:
            while pos < len(text) and text[pos].isspace(): pos += 1
            if pos < len(text) and text[pos] == closing: return result, pos + 1
            if count > 2000: raise ValueError('Literal is too large')
            if is_object:
                if pos < len(text) and text[pos] in {'"', "'"}:
                    key, pos = _value(text, pos, depth + 1)
                else:
                    match = re.match(r'[A-Za-z_$][\w$]*|\d+', text[pos:])
                    if not match: raise ValueError('Nonliteral object key')
                    key = match.group(0)
                    pos += len(key)
                while pos < len(text) and text[pos].isspace(): pos += 1
                if pos >= len(text) or text[pos] != ':': raise ValueError('Expected property separator')
                value, pos = _value(text, pos + 1, depth + 1)
                result[key] = value
            else:
                value, pos = _value(text, pos, depth + 1)
                result.append(value)
            while pos < len(text) and text[pos].isspace(): pos += 1
            if pos < len(text) and text[pos] == ',': pos += 1
            elif pos < len(text) and text[pos] == closing: return result, pos + 1
            else: raise ValueError('Expected literal separator')
            count += 1
    match = re.match(r'(true|false|null)(?![\w$])|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?', text[pos:])
    if match:
        raw = match.group(0)
        return json.loads(raw), pos + len(raw)
    raise ValueError('Expression is not a literal')


def maybe_literal(text, default=None):
    try:
        return literal(text.strip())
    except (ValueError, RecursionError):
        return default


def json_string(value):
    # ASCII escapes also protect JavaScript line separators in generated literals.
    return json.dumps(str(value), ensure_ascii=True)
