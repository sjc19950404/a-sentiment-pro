/* 保持 02 视觉册第 8 节代码块与运行时 tokens.css 逐字一致
 * 用法：node design/sync_tokens.cjs
 * 每次修改 tokens.css 后运行一次，避免文档与代码漂移。
 */
const fs = require('fs');
const path = require('path');
const dir = 'D:/app 1/2026-11-14-21-47-50/design';
const tok = fs.readFileSync(path.join(dir, 'prototype/tokens.css'), 'utf8');
const docPath = path.join(dir, '02_视觉语言与设计令牌.md');
let doc = fs.readFileSync(docPath, 'utf8');
const start = doc.indexOf('## 8. ');
if (start < 0) throw new Error('未找到第 8 节');
const cs = doc.indexOf('```css', start);
const ce = doc.indexOf('\n```', cs + 7);
if (cs < 0 || ce < 0) throw new Error('未找到 CSS 代码块边界');
doc = doc.slice(0, cs) + '```css\n' + tok.trimEnd() + '\n```' + doc.slice(ce + 4);
fs.writeFileSync(docPath, doc);
console.log('synced:', tok.split('\n').length, 'lines,', Buffer.byteLength(tok), 'bytes');
