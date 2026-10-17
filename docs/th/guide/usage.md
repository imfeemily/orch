# วิธีใช้งาน

## คำสั่ง

```bash
orch run "เพิ่ม endpoint health check"          # รันในโฟลเดอร์ปัจจุบัน
orch run --cwd ~/code/app "แก้ test ที่พัง"
orch run --context lean "แก้ typo ใน README"   # ข้าม hooks, plugins และ skills ระดับผู้ใช้
orch run --team standard "เพิ่ม test ให้ clamp()"   # developer, tester, reviewer (ดู Roles)
orch status                                     # cooldown และงานล่าสุด
orch init                                       # สร้าง ~/.orch/config.yaml ถ้ายังไม่มี
orch daemon start                               # ไม่จำเป็น เพราะเปิดเองเมื่อต้องใช้
orch daemon stop                                # ต้องสั่งหลังแก้ config.yaml
orch usage --since 7d --by model                # ยอดโทเค่นจาก ledger
```

- `orch run` พิมพ์คำตอบสุดท้ายของเอเจนต์ (เอเจนต์ที่ตั้ง `output: text` จะสตรีมสด) และจบด้วย exit code ไม่เป็นศูนย์ถ้าทั้งสองตัวล้ม เมื่อสลับเอเจนต์จะเห็น
  `orch: switched agent, finished with <agent>` ที่ stderr
- `orch status` แสดงแต่ละเอเจนต์เป็น `available` หรือ `cooling down, Nm left` ตามด้วยงานล่าสุด งานที่ใช้ model จาก rule จะมีชื่อ model ในวงเล็บเหลี่ยม
- สถานะอยู่ที่ `~/.orch/state.json` (cooldown และงานล่าสุด 50 รายการ) เปลี่ยนโฟลเดอร์ด้วย `ORCH_HOME`

รายการคำสั่งทั้งหมดสร้างจากโค้ดโดยตรง ดูที่ [CLI reference](/reference/cli)

## Roles

รันงานผ่าน role เฉพาะทางแทนการเรียกครั้งเดียวแบบทั่วไป `orch run` ธรรมดาไม่เปลี่ยน

```bash
orch run --role reviewer "review the last commit"             # role เดียว
orch run --team standard "เพิ่ม test ให้ clamp()"             # ทีมที่ตั้งชื่อไว้
orch run --roles developer,tester "แก้บั๊กใน parser.ts"       # รายการของคุณ ตามลำดับ
orch run --team standard --dry-run "เพิ่ม test ให้ clamp()"   # แสดงแผน ไม่เสียโทเค่น
```

- `--role`, `--roles` และ `--team` ใช้ร่วมกันไม่ได้
- `--dry-run` แสดง role เอเจนต์ของมัน และจำนวนการเรียก model โดยไม่รันอะไร
- `--require-codex` หยุดก่อนเริ่มเมื่อมี role ที่ต้องใช้ Codex และ Codex ไม่พร้อม ถ้าไม่ใส่ role นั้นจะถูกข้าม
- `--keep-going` รัน role ที่เหลือต่อหลังมี role ล้ม ค่าเริ่มต้นทีมจะหยุด

ดู [Roles](/th/guide/roles) สำหรับหน้าที่ของแต่ละ role, handoff และไฟล์ที่บันทึก

## การใช้งานและค่าใช้จ่าย

orch บันทึกทุก attempt ของเอเจนต์ลง `~/.orch/usage.jsonl` (เก็บ 90 วัน) และอ่านจำนวนโทเค่นจาก JSON output ของเอเจนต์

```bash
orch usage                         # 24 ชั่วโมงล่าสุด แยกตามเอเจนต์
orch usage --since 7d --by model   # 7 วันล่าสุด แยกตาม model
orch usage --by context            # เทียบ context preset
orch usage --by role               # ต้นทุนของแต่ละ role
```

- ตัวเลขโทเค่นคือ *billable tokens*: input ที่ไม่รวม cache read บวก output (reasoning รวมอยู่ใน output แล้ว) เป็นค่าประมาณไว้ติดตามโควต้า ไม่ใช่การนับของผู้ให้บริการ
- Claude รายงานค่าใช้จ่ายเป็น USD ด้วย ส่วน Codex รายงานเฉพาะโทเค่น
- `orch status` แสดงยอด 24 ชั่วโมงล่าสุดต่อเอเจนต์ และผลของ MCP `orch_run` ปิดท้ายด้วย `tokens=<n>`
- เอเจนต์ถูกเรียกในโหมด JSON (`--output-format json` ของ Claude, `--json` ของ Codex) ดังนั้น `orch run` จะพิมพ์เฉพาะคำตอบสุดท้ายหนึ่งครั้งเมื่อเอเจนต์ทำงานเสร็จ

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

- `orch_run({ prompt, cwd?, context?, role?, roles?, team?, dryRun?, requireCodex?, keepGoing? })` รันงานและคืนผลของเอเจนต์ ตามด้วยบรรทัด `[orch] status=... agent=... failedOver=...` ค่า `cwd` ต้องเป็นโฟลเดอร์ที่มีอยู่จริง
- `orch_status()` คืน cooldown และงานล่าสุดเป็น JSON

การยกเลิกคำสั่งจะหยุดเอเจนต์ที่กำลังรันด้วย

## งานหนึ่งงานทำงานอย่างไร

1. **เลือก:** rule แรกที่ `match` ตรงกับ prompt เลือกเอเจนต์ (และ `model`/`effort`) ถ้าไม่ตรงใช้ `defaultAgent` ข้ามเอเจนต์ที่พักอยู่
2. **รัน:** เอเจนต์เริ่มแบบ headless (`claude -p`, `codex exec`) ในโฟลเดอร์เป้าหมาย
3. **สลับหนึ่งครั้ง:** ถ้าออกด้วยค่าไม่เป็นศูนย์ ส่งให้อีกตัว เฉพาะเจอ rate limit เท่านั้นที่ตัวแรกถูกพัก จนถึงเวลา reset ในข้อความ (ถ้ามี) ไม่งั้นใช้ `defaultCooldownSec` ส่วน login หมดอายุจะบอกวิธีแก้และไม่พัก
4. **ส่งต่อแบบประหยัด:** เอเจนต์ตัวที่สองได้ prompt เดิมและ `git status` แนบ diff เต็มเมื่อไม่เกิน 4000 ตัวอักษร ถ้าใหญ่กว่านั้นแนบ `git diff --stat` ให้เอเจนต์อ่านไฟล์เอง และขอสรุปจากตัวแรกเฉพาะเมื่อมันล้มธรรมดา
5. **กันวนซ้ำ:** เอเจนต์ที่ orch เรียกจะเรียก orch ซ้ำไม่ได้ (`ORCH_DEPTH`)
