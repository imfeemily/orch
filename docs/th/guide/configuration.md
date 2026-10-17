# การตั้งค่า

ไฟล์ตั้งค่าอยู่ที่ `~/.orch/config.yaml` (สร้างด้วย `orch init`) ทุก key เป็น optional: ที่ไม่ได้เขียนจะใช้ค่าเริ่มต้นในตัว
ซึ่งดูได้ที่ [defaults reference](/reference/config) (สร้างจากโค้ด) หลังแก้ไฟล์ให้ `orch daemon stop`

```yaml
defaultAgent: claude
agents:
  claude:
    command: claude
    args: ["-p", "--", "{prompt}"]
    defaultCooldownSec: 3600
rules:
  - match: "typo|rename|quick|small fix"
    agent: codex
    model: gpt-6-luna
    effort: low
```

## key ระดับบนสุด

- `defaultAgent`: `claude` หรือ `codex` ใช้เมื่อไม่มี rule ตรง
- `agents`: ค่าของแต่ละเอเจนต์ (`claude`, `codex`) ดูด้านล่าง
- `rules`: รายการเรียงลำดับ rule แรกที่ `match` ตรงกับ prompt จะถูกใช้

## key ของเอเจนต์ (`agents.<name>`)

- `command`: โปรแกรมที่จะรัน
- `args`: แม่แบบอาร์กิวเมนต์ `{prompt}` จะถูกแทนด้วย prompt เสมอในรูปอาร์กิวเมนต์เดียวโดยไม่ผ่าน shell ให้เก็บ `--` ไว้หน้า `{prompt}` เพื่อให้ prompt ที่ขึ้นต้นด้วย `-` ไม่ถูกอ่านเป็น flag ใส่ flag สิทธิ์/sandbox ที่นี่
- `output`: วิธีที่ orch อ่าน stdout ของเอเจนต์: `claude-json`, `codex-jsonl` หรือ `text` แบบ JSON ให้ orch ได้คำตอบที่สะอาดและยอดโทเค่น ถ้าผลลัพธ์ไม่ตรงรูปแบบจะถอยกลับเป็นข้อความธรรมดาโดยไม่มี usage `args` เริ่มต้นมี `--output-format json` (Claude) และ `--json` (Codex) ถ้าเขียนทับ `args` ให้คง flag นี้ไว้ หรือตั้ง `output: text`
- `summaryArgs`: แม่แบบสำหรับขอสรุปส่งต่อ (resume session ล่าสุด) ลบทิ้งถ้าไม่ต้องการสรุป
- `modelArgs`: ถูกแทรกก่อน `--` เมื่อ rule กำหนด `model` ทุก `{model}` ถูกแทนด้วยชื่อ model
- `effortArgs`: ถูกแทรกก่อน `--` เมื่อ rule กำหนด `effort` ทุก `{effort}` ถูกแทนด้วยระดับ
- `limitPatterns`: regex แบบไม่สนตัวพิมพ์ ถ้า exit code ไม่เป็นศูนย์และ stderr หรือ 20 บรรทัดท้ายของ stdout ตรงกับอันใดอันหนึ่ง ถือเป็น rate limit และเอเจนต์ถูกพัก
- `authPatterns`: จับคู่แบบเดียวกัน ตรงแปลว่าเอเจนต์ยังไม่ได้ login ตรวจหลัง `limitPatterns`
- `defaultCooldownSec`: เวลาพักหลังติด rate limit เมื่อข้อความไม่บอกเวลา reset (ค่าเริ่มต้น 3600)

## key ของ rule (`rules[]`)

- `match`: regex แบบไม่สนตัวพิมพ์ ทดสอบกับ prompt
- `agent`: เอเจนต์ที่รับงาน
- `model`: model ของเอเจนต์นั้นเมื่อ rule ตรง ต้องมี `modelArgs` ของเอเจนต์
- `effort`: ระดับ effort/reasoning ต้องมี `effortArgs` ของเอเจนต์

`model` และ `effort` ใช้เฉพาะเมื่อใช้เอเจนต์ของ rule นั้นเอง ถ้าเอเจนต์นั้นพักอยู่หรืองานสลับไปอีกตัว อีกตัวจะรันด้วยค่าของมันเอง
เพราะชื่อ model ใช้ข้ามค่ายระหว่าง Claude กับ Codex ไม่ได้ ต้องใช้ชื่อ model ที่บัญชีคุณใช้ได้ (ใน Codex ดูด้วย `/model`)

ตัวอย่างประหยัดโทเค่น: งานแก้เล็กส่งให้ model เล็ก งานยากเก็บ model ใหญ่ไว้

```yaml
rules:
  - match: "typo|rename|small fix"
    agent: codex
    model: gpt-6-luna
    effort: low
  - match: "refactor|architecture|migrate"
    agent: claude
    model: opus
    effort: high
```

## ตัวแปรสภาพแวดล้อม

- `ORCH_HOME`: โฟลเดอร์สถานะ (ค่าเริ่มต้น `~/.orch`)
- `ORCH_CONFIG`: path ของไฟล์ตั้งค่า (ค่าเริ่มต้น `$ORCH_HOME/config.yaml`)
- `ORCH_DEPTH`: orch ตั้งให้เอเจนต์ที่มันเรียก ถ้าค่าตั้งแต่ 1 ขึ้นไป `orch` จะไม่ยอมรัน เพื่อกันเอเจนต์เรียก orch วนซ้ำ ห้ามตั้งเอง
