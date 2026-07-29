#!/usr/bin/env python3
"""生成 standalone HTML 单文件 — 把所有本地 CSS/JS inline 到 index.html"""
import re, os, sys

BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BASE, 'powergame-v18-standalone.html')

def read(path):
    with open(os.path.join(BASE, path), 'r', encoding='utf-8') as f:
        return f.read()

html = read('index.html')

# 1. 替换本地 CSS: <link rel="stylesheet" href="M1-CSS.css">
def replace_css(m):
    href = m.group(1)
    if href.startswith('http'):  # 保留 Google Fonts CDN
        return m.group(0)
    css = read(href)
    return f'<style>\n/* ===== {href} ===== */\n{css}\n</style>'

html = re.sub(r'<link\s+rel="stylesheet"\s+href="([^"]+)"\s*>', replace_css, html)

# 2. 替换本地 JS: <script src="FILE.js"></script>
def replace_js(m):
    src = m.group(1)
    if src.startswith('http'):
        return m.group(0)
    js = read(src)
    return f'<script>\n/* ===== {src} ===== */\n{js}\n</script>'

html = re.sub(r'<script\s+src="([^"]+)"\s*></script>', replace_js, html)

# 3. 写出
with open(OUT, 'w', encoding='utf-8') as f:
    f.write(html)

size = os.path.getsize(OUT)
print(f'OK: {OUT} ({size/1024:.0f} KB)')
