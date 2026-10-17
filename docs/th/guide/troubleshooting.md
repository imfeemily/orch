# แก้ปัญหา

| อาการ | สาเหตุ / วิธีแก้ |
|---|---|
| `Failed to authenticate: OAuth session expired` | Claude หลุด login เปิด `claude` แล้วพิมพ์ `/login` orch จะรายงานว่า "not logged in" และสลับไปอีกตัว |
| `The '<model>' model is not supported when using Codex with a ChatGPT account` | ชื่อ model ใน `~/.codex/config.toml` หรือใน rule ผิด เปิด `codex` พิมพ์ `/model` เลือกจากรายการ แล้วทดสอบด้วย `codex exec -c model='"<slug>"' "say pong"` (slug อาจต่างจากชื่อที่แสดง) |
| `You've hit your usage limit` | limit จริง orch จะพักเอเจนต์นั้นจนถึงเวลา reset ในข้อความ แล้วใช้อีกตัว ดูที่ `orch status` |
| `Not inside a trusted directory` (Codex) | รันในโฟลเดอร์ที่เป็น git repository หรือเพิ่ม `--skip-git-repo-check` ใน `args` ของ Codex |
| `orch daemon did not start` | รัน `node "$(npm root -g)/claude-codex-orch/dist/daemon/index.js"` ในเทอร์มินัลเพื่อดู error (มักเป็น `config.yaml` พิมพ์ผิด) |
| `orch usage` ไม่แสดงอะไร หรือโทเค่นเป็น 0 | orch ถอยกลับเป็นข้อความธรรมดา: เขียนทับ `args` โดยไม่มี flag JSON หรือ CLI เปลี่ยนรูปแบบ output ใส่ `--output-format json` (Claude) หรือ `--json` (Codex) กลับ หรือตั้ง `output: text` เพื่อเลิกคาดหวัง JSON |
| preset `--context` ทำให้เอเจนต์ล้มด้วย unknown option | CLI ของเอเจนต์ไม่รู้จัก flag ใน preset (ชื่อ feature ต่างกันตามเวอร์ชัน) แก้ preset ใต้ `contexts` ใน `~/.orch/config.yaml` แล้ว `orch daemon stop` |
| ใช้ `context: lean` แล้วเอเจนต์ไม่ใช้สิทธิ์หรือคำสั่งส่วนกลางของคุณ | เป็นไปตามดีไซน์: `lean` ข้ามการตั้งค่าระดับผู้ใช้ ให้ใส่สิทธิ์ที่ต้องการใน `args` ของเอเจนต์ (เช่น `--permission-mode acceptEdits`) หรือในการตั้งค่าของโปรเจกต์เอง |
| `role "x" skipped: not logged in ...` | role นั้นต้องใช้ Codex และ Codex ไม่พร้อม ทำตามเหตุผลที่แจ้ง (เช่น `codex login`) หรือใส่ `--require-codex` เพื่อหยุดแทนการข้าม |
| `unknown role` หรือ `unknown team` | ชื่อไม่อยู่ใน `roles` หรือ `teams` ข้อความจะแสดงชื่อที่ใช้ได้ |
| ทีมหยุดและ role ที่เหลือขึ้น `not-run` | มี role ล้มหลัง failover แก้สาเหตุแล้วรันใหม่ หรือใช้ `--keep-going` คำตอบเต็มอยู่ที่ `.orch/runs/<run-id>/` |
| `developer` หรือ `tester` แก้ไฟล์ไม่ได้ | role ขาด flag สิทธิ์ของเอเจนต์ role ในตัวมีให้แล้ว ส่วน role ของคุณที่เขียนไฟล์ต้องเพิ่ม `agentArgs` |
| แก้ config แล้วไม่เปลี่ยน | daemon อ่าน config ครั้งเดียว สั่ง `orch daemon stop` แล้วคำสั่งถัดไปจะเปิดใหม่ |
| `cwd must be an existing absolute directory` | MCP client ส่ง path ที่ไม่มีอยู่จริง ให้ส่ง `cwd` เป็น absolute path |
| งานนานแล้ว timeout จาก Codex | เพิ่ม `tool_timeout_sec` ของ MCP server `orch` ใน `~/.codex/config.toml` |

## ดูว่า orch ทำอะไรไป

```bash
orch status
```

แสดง cooldown และงานล่าสุด พร้อม `(failover)` และ model ถ้ามี rate limit จะเห็นเป็น cooldown ส่วนการล้มธรรมดาไม่มี

## ข้อจำกัดที่ทราบ

- ตัวอักษรหลายไบต์ (เช่นภาษาไทย) อาจเพี้ยนถ้าถูกตัดกลางที่รอยต่อ chunk
- `orch daemon stop` ระหว่างงานกำลังรัน อาจลบ socket ของ daemon ตัวใหม่
- งานหลักยังไม่มี timeout รวม
- ไม่รองรับ Windows
