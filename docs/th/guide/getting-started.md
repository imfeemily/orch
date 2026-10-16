# เริ่มต้นใช้งาน

`orch` คือ daemon, CLI และ MCP server ในเครื่อง ทำหน้าที่ส่งงานเขียนโค้ดให้ **Claude Code** หรือ **Codex**
และสลับไปอีกตัวเมื่อตัวแรกติด rate limit หรือล้ม

## สิ่งที่ต้องมี

- Node.js 20 ขึ้นไป
- ติดตั้ง `claude` และ `codex` และ login ให้เรียบร้อยบนเครื่องเดียวกัน
- macOS หรือ Linux (ใช้ unix domain socket)

## ติดตั้ง

```bash
npm install -g claude-codex-orch
orch init
```

`orch init` สร้าง `~/.orch/config.yaml` ถ้ายังไม่มี และไม่เขียนทับไฟล์ที่มีอยู่

## ลองรันงานแรก

```bash
orch run "reply with exactly the word pong and nothing else"
```

ควรเห็นคำว่า `pong` daemon จะเปิดเองตอนสั่งครั้งแรก

## ใช้จากใน Claude Code และ Codex

```bash
claude mcp add orch -- orch-mcp
codex mcp add orch -- orch-mcp
```

จากนั้นสั่งให้เครื่องมือใช้ tool `orch_run` รายละเอียดและการตั้ง timeout ของ Codex ดูที่ [วิธีใช้งาน](/th/guide/usage)

## ต่อไป

- [วิธีใช้งาน](/th/guide/usage): ทุกคำสั่งและ MCP tools
- [การตั้งค่า](/th/guide/configuration): กฎ routing, model, cooldown
- [แก้ปัญหา](/th/guide/troubleshooting)
