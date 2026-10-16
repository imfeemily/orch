# คู่มือใช้งาน claude-codex-orch

`orch` คือตัวกลางในเครื่องที่รับงานเขียนโค้ด แล้วเลือกส่งให้ **Claude Code** หรือ **Codex**
ถ้าตัวแรกติด usage limit หรือล้ม จะส่งงานต่อให้อีกตัวอัตโนมัติ (ส่ง prompt เดิม + `git diff`
+ สรุปงานจากตัวแรกถ้ายังตอบได้) เริ่มจากเครื่องมือไหนก่อนก็ได้

## สิ่งที่ต้องมีบนเครื่อง

- Node.js 20 ขึ้นไป
- ติดตั้ง `claude` และ `codex` และ login ให้เรียบร้อยทั้งคู่
- macOS หรือ Linux

## ติดตั้ง (เครื่องไหนก็ได้)

```bash
npm install -g claude-codex-orch
orch init
```

`orch init` สร้าง `~/.orch/config.yaml` ให้ถ้ายังไม่มี (ถ้ามีแล้วจะไม่เขียนทับ)

## ใช้งานจากเทอร์มินัล

```bash
orch run "เพิ่ม endpoint health check"
orch run --cwd ~/code/app "แก้ test ที่พัง"
orch status
orch daemon stop
```

- `orch run` ทำงานในโฟลเดอร์ปัจจุบัน (หรือโฟลเดอร์จาก `--cwd`)
- `orch status` ดูว่า agent ไหนอยู่ในช่วงพัก (cooldown) กี่นาที และงานล่าสุด
- daemon เปิดเองเมื่อสั่งครั้งแรก ถ้าแก้ `config.yaml` ให้ `orch daemon stop` ก่อน

## ใช้จากใน Claude Code และ Codex (MCP)

```bash
claude mcp add orch -- orch-mcp
codex mcp add orch -- orch-mcp
```

จากนั้นในแต่ละเครื่องมือสั่งได้ เช่น "ใช้ tool orch_run ทำงานนี้" ถ้า Codex ไม่มีคำสั่ง
`codex mcp add` ให้เพิ่มใน `~/.codex/config.toml`:

```toml
[mcp_servers.orch]
command = "orch-mcp"
tool_timeout_sec = 1800
```

ต้องตั้ง `tool_timeout_sec` ให้สูง เพราะค่าเริ่มต้นของ Codex สั้นเกินไปสำหรับงานจริง

## หลักการทำงาน

1. เลือก agent จากกฎใน config (ตรงกับ regex ของ prompt) ถ้าไม่ตรงใช้ `defaultAgent`
   และข้าม agent ที่กำลังพัก
2. รัน agent แบบ headless (`claude -p`, `codex exec`)
3. ถ้าล้ม สลับให้อีกตัวหนึ่งครั้งเดียว เฉพาะกรณีเจอข้อความ rate limit ถึงจะพัก agent นั้น
   ถ้าข้อความบอกเวลา reset (เช่น "try again at 10:05 PM") จะพักถึงเวลานั้น ไม่งั้นใช้ค่า
   เริ่มต้น 1 ชั่วโมง ส่วนกรณี login หมดอายุ จะบอกวิธีแก้ (`claude` แล้ว `/login` หรือ
   `codex login`) และไม่พัก agent
4. ส่งงานต่อแบบประหยัดโทเค่น: ส่ง prompt เดิม + `git status` ถ้า diff เล็ก (ไม่เกิน 4000
   ตัวอักษร) แนบ diff เต็ม ถ้าใหญ่กว่านั้นแนบแค่ `git diff --stat` ให้ agent ไปอ่านไฟล์เอง
   และขอสรุปจากตัวแรกเฉพาะเมื่อมันล้มธรรมดา (ไม่ขอหลังติด limit หรือ login หมดอายุ)
5. agent ที่ orch เรียกจะเรียก orch ซ้อนไม่ได้ และเมื่อยกเลิกคำสั่ง agent จะถูกหยุดด้วย

## ปรับแต่ง `~/.orch/config.yaml`

- `rules` กำหนดว่างานแบบไหนไป agent ไหน และเลือก **model/effort ตามชนิดงาน** ได้เพื่อประหยัดโทเค่น
  (งานเล็กใช้ model เล็ก งานหนักใช้ model ใหญ่) เช่น
  `match: "typo|rename"`, `agent: codex`, `model: gpt-6-luna`, `effort: low`
  ค่านี้ใช้เฉพาะ agent ของ rule นั้น ถ้าสลับไปอีกตัวจะไม่ใช้ model นี้ (ชื่อ model ไม่ตรงกันข้ามค่าย)
  ชื่อ model ต้องเป็นของที่บัญชีคุณใช้ได้ (ดูจาก `/model` ใน `codex`)
- `args` ใส่ flag สิทธิ์/sandbox ของแต่ละ agent ได้ที่นี่
- ลบ `summaryArgs` ถ้าไม่ต้องการให้ขอสรุปจากตัวแรกก่อนส่งต่อ
- `defaultCooldownSec` ระยะพักของ agent เมื่อเจอ limit

ดู config เต็มและค่าเริ่มต้นใน [README](../README.md)

## แก้ปัญหา

| อาการ | สาเหตุ / วิธีแก้ |
|---|---|
| `Failed to authenticate: OAuth session expired` | เปิด `claude` แล้วพิมพ์ `/login` |
| `The '<model>' model is not supported ... ChatGPT account` | ชื่อ model ใน `~/.codex/config.toml` ผิด เปิด `codex` แล้วพิมพ์ `/model` เลือกจากรายการ แล้วลอง `codex exec -c model='"<slug>"' "say pong"` (slug อาจต่างจากชื่อที่แสดง) |
| `You've hit your usage limit` | limit จริงของบัญชี orch จะพัก agent นั้นแล้วใช้อีกตัว ดูเวลาที่ `orch status` |
| `orch daemon did not start` | รัน `node "$(npm root -g)/claude-codex-orch/dist/daemon/index.js"` เพื่อดู error (มักเป็น `config.yaml` พิมพ์ผิด) |
| แก้ config แล้วไม่เปลี่ยน | `orch daemon stop` แล้วสั่งใหม่ |

## ความปลอดภัย

daemon ฟังที่ `~/.orch/sock` (สิทธิ์ 0600 เฉพาะเจ้าของ) agent ทำงานด้วยสิทธิ์ของคุณ
ดังนั้นโปรเซสที่คุยกับ socket นี้ได้คือสั่ง agent ในนามคุณได้

## ถอนการติดตั้ง

```bash
orch daemon stop
npm uninstall -g claude-codex-orch
claude mcp remove orch
rm -rf ~/.orch
```

แล้วลบบล็อก `[mcp_servers.orch]` ออกจาก `~/.codex/config.toml` ถ้าเคยเพิ่มเอง

## ติดตั้งบนเครื่องอื่นโดยไม่ผ่าน npm

บนเครื่องนี้:

```bash
cd ~/Documents/workspace/orch && npm pack
```

จะได้ไฟล์ `claude-codex-orch-0.1.0.tgz` คัดลอกไปเครื่องปลายทาง (AirDrop/scp) แล้วรัน
`npm install -g ./claude-codex-orch-0.1.0.tgz` จากนั้น `orch init`
