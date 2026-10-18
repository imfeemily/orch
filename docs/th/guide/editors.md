# Editor และแอปแชท

orch ใช้ได้จากทุกแอปที่รองรับ MCP (Model Context Protocol) ไม่ต้องผ่านบรรทัดคำสั่ง: **VS Code + Copilot** (agent mode), **Cursor** และ **Claude Desktop** แอปจะเปิด `orch-mcp` เอง และได้เครื่องมือ `orch_run`, `orch_status` กับ prompt สำเร็จรูปสามอัน คุณไม่ต้องรัน `orch` ด้วยมือ

ติดตั้ง orch ก่อน (`npm install -g claude-codex-orch`) แล้วเพิ่มเข้าแอป

## คำสั่งเดียว

```bash
orch mcp-config vscode            # พิมพ์ JSON และไฟล์ที่ต้องใส่
orch mcp-config vscode --write    # เพิ่ม entry ลงไฟล์นั้น
```

เปลี่ยน `vscode` เป็น `cursor` หรือ `claude-desktop` สำหรับแอปนั้น `--write` เก็บ server อื่นในไฟล์ไว้ครบ บอก `unchanged` ถ้ามี orch อยู่แล้ว และปฏิเสธ (ไม่แก้อะไร) ถ้าไฟล์มี comment หรือไม่ใช่ JSON ล้วน กรณีนั้นให้วาง entry ที่พิมพ์ออกมาเอง แล้วรีสตาร์ตแอป

| แอป | ไฟล์ | ขอบเขต |
|---|---|---|
| VS Code (Copilot agent mode) | `.vscode/mcp.json` ในโปรเจกต์ (`--cwd DIR` เลือกโปรเจกต์) | หนึ่งโปรเจกต์ |
| Cursor | `~/.cursor/mcp.json` | ทุกโปรเจกต์ |
| Claude Desktop | macOS `~/Library/Application Support/Claude/claude_desktop_config.json`, Windows `%APPDATA%\Claude\claude_desktop_config.json`, Linux `~/.config/Claude/claude_desktop_config.json` | ทุกแชท |

เขียนเอง entry ของ VS Code คือ:

```json
{ "servers": { "orch": { "type": "stdio", "command": "orch-mcp", "args": [] } } }
```

Cursor และ Claude Desktop ใช้ `mcpServers` แทน `servers` และไม่มี `type`:

```json
{ "mcpServers": { "orch": { "command": "orch-mcp", "args": [] } } }
```

## วิธีใช้

- สั่งในแชท: "use orch to fix the typo in README.md" ผู้ช่วยจะเรียก `orch_run` orch เลือก Claude Code หรือ Codex สลับเมื่อติด rate limit แล้วส่งคำตอบกลับพร้อมเอเจนต์ โทเค่น และ role ที่ใช้
- prompt `orch-fix`, `orch-review`, `orch-explain` อยู่ในเมนู prompt ของแอป (ใน VS Code พิมพ์ `/` ในแชทแล้วหา `mcp.orch`) แต่ละอันรับ `task` หนึ่งค่า และบอกผู้ช่วยว่าจะเรียก `orch_run` อย่างไร: `orch-fix` ใช้ role `developer`, `orch-review` ใช้ role `reviewer`, `orch-explain` ถามหนึ่งคำถามกับ Claude โดยไม่แก้ไฟล์
- ตัวเลือกทั้งหมดใน [วิธีใช้งาน](/th/guide/usage) (`role`, `team`, `auto`, `only`, `context`, `dryRun`) สั่งด้วยภาษาธรรมดาหรือส่งเป็น argument ของเครื่องมือได้

## ตรวจว่าใช้ได้

1. รัน `orch mcp-config <แอป>` และดูว่าไฟล์ที่บอกมี entry
2. รีสตาร์ตแอป แล้วเปิดรายการเครื่องมือหรือ MCP server: ต้องเห็น `orch` ทำงานอยู่พร้อม `orch_run` และ `orch_status`
3. ขอ dry run: "call orch_run with dryRun true, roles developer and tester, and show the plan" ไม่ใช้โทเค่น

ถ้าแอปหา `orch-mcp` ไม่เจอ แปลว่าติดตั้งไว้ในที่ที่ PATH ของแอปไม่รวม (พบบ่อยกับ nvm) ใส่ path เต็มใน `command` ดูได้จาก `which orch-mcp`

## สิ่งที่ใช้ไม่ได้

แชทบนเว็บและมือถือ (claude.ai ในเบราว์เซอร์ แอปมือถือ) เปิดโปรแกรมบนเครื่องคุณไม่ได้ จึงใช้ orch ไม่ได้ ต้องมี HTTP server ระยะไกลพร้อมระบบล็อกอิน ซึ่ง orch ยังไม่มี
