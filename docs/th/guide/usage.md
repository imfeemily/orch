# วิธีใช้งาน

## คำสั่ง

```bash
orch run "เพิ่ม endpoint health check"          # รันในโฟลเดอร์ปัจจุบัน
orch run --cwd ~/code/app "แก้ test ที่พัง"
orch status                                     # cooldown และงานล่าสุด
orch init                                       # สร้าง ~/.orch/config.yaml ถ้ายังไม่มี
orch daemon start                               # ไม่จำเป็น เพราะเปิดเองเมื่อต้องใช้
orch daemon stop                                # ต้องสั่งหลังแก้ config.yaml
```

- `orch run` แสดงผลของเอเจนต์ทันทีที่ได้ และจบด้วย exit code ไม่เป็นศูนย์ถ้าทั้งสองตัวล้ม เมื่อสลับเอเจนต์จะเห็น
  `orch: switched agent, finished with <agent>` ที่ stderr
- `orch status` แสดงแต่ละเอเจนต์เป็น `available` หรือ `cooling down, Nm left` ตามด้วยงานล่าสุด งานที่ใช้ model จาก rule จะมีชื่อ model ในวงเล็บเหลี่ยม
- สถานะอยู่ที่ `~/.orch/state.json` (cooldown และงานล่าสุด 50 รายการ) เปลี่ยนโฟลเดอร์ด้วย `ORCH_HOME`

รายการคำสั่งทั้งหมดสร้างจากโค้ดโดยตรง ดูที่ [CLI reference](/reference/cli)

## จาก Claude Code และ Codex (MCP)

```bash
claude mcp add orch -- orch-mcp
codex mcp add orch -- orch-mcp
```

ถ้า Codex ของคุณไม่มี `codex mcp add` ให้เพิ่มใน `~/.codex/config.toml`:

```toml
[mcp_servers.orch]
command = "orch-mcp"
tool_timeout_sec = 1800   # ค่าเริ่มต้นของ Codex สั้นเกินไปสำหรับงานจริง
```

Tools:

- `orch_run({ prompt, cwd? })` รันงานและคืนผลของเอเจนต์ ตามด้วยบรรทัด `[orch] status=... agent=... failedOver=...` ค่า `cwd` ต้องเป็นโฟลเดอร์ที่มีอยู่จริง
- `orch_status()` คืน cooldown และงานล่าสุดเป็น JSON

การยกเลิกคำสั่งจะหยุดเอเจนต์ที่กำลังรันด้วย

## งานหนึ่งงานทำงานอย่างไร

1. **เลือก:** rule แรกที่ `match` ตรงกับ prompt เลือกเอเจนต์ (และ `model`/`effort`) ถ้าไม่ตรงใช้ `defaultAgent` ข้ามเอเจนต์ที่พักอยู่
2. **รัน:** เอเจนต์เริ่มแบบ headless (`claude -p`, `codex exec`) ในโฟลเดอร์เป้าหมาย
3. **สลับหนึ่งครั้ง:** ถ้าออกด้วยค่าไม่เป็นศูนย์ ส่งให้อีกตัว เฉพาะเจอ rate limit เท่านั้นที่ตัวแรกถูกพัก จนถึงเวลา reset ในข้อความ (ถ้ามี) ไม่งั้นใช้ `defaultCooldownSec` ส่วน login หมดอายุจะบอกวิธีแก้และไม่พัก
4. **ส่งต่อแบบประหยัด:** เอเจนต์ตัวที่สองได้ prompt เดิมและ `git status` แนบ diff เต็มเมื่อไม่เกิน 4000 ตัวอักษร ถ้าใหญ่กว่านั้นแนบ `git diff --stat` ให้เอเจนต์อ่านไฟล์เอง และขอสรุปจากตัวแรกเฉพาะเมื่อมันล้มธรรมดา
5. **กันวนซ้ำ:** เอเจนต์ที่ orch เรียกจะเรียก orch ซ้ำไม่ได้ (`ORCH_DEPTH`)
