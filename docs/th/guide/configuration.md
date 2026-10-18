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
- `contexts`: preset ที่รวม flag เพิ่มเติมเพื่อลด context คงที่ของแต่ละการเรียก ดู [Context presets](#context-presets)
- `tiers`: model, effort และ context ต่อเอเจนต์สำหรับงาน `small`, `medium`, `large` ที่ `--only` ใช้ ดู [Tiers](#tiers-โหมดเอเจนต์เดียว)
- `auto`: การเลือก role อัตโนมัติ ดู [การเลือกอัตโนมัติ](#การเลือกอัตโนมัติ-auto)
- `roles`, `teams`, `pipeline`: การรันเฉพาะทาง และชุดของมันที่ตั้งชื่อไว้ ดู [Roles และทีม](#roles-และทีม)
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
- `writeArgs`: flags ที่ให้เอเจนต์แก้ไฟล์ได้ เพิ่มในโหมด `--only` เมื่อ tier มี `write: true` (ดู [Tiers](#tiers-โหมดเอเจนต์เดียว))
- `defaultCooldownSec`: เวลาพักหลังติด rate limit เมื่อข้อความไม่บอกเวลา reset (ค่าเริ่มต้น 3600)
- `timeoutSec`: ตัวเลขบวก (ไม่บังคับ) การรันที่นานกว่านี้จะถูกหยุดและนับเป็นความล้มเหลว (จึง failover ได้) ปิดอยู่ถ้าไม่ตั้ง ค่าสูงสุด 2147483

## key ของ rule (`rules[]`)

- `match`: regex แบบไม่สนตัวพิมพ์ ทดสอบกับ prompt
- `agent`: เอเจนต์ที่รับงาน
- `model`: model ของเอเจนต์นั้นเมื่อ rule ตรง ต้องมี `modelArgs` ของเอเจนต์
- `effort`: ระดับ effort/reasoning ต้องมี `effortArgs` ของเอเจนต์
- `context`: ชื่อ preset ใน `contexts` ที่จะใช้ ต่างจาก `model` ตรงที่ใช้ต่อเมื่อสลับไปอีกเอเจนต์ด้วย โดยใช้ flag ของเอเจนต์นั้นเอง

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

## Context presets

ทุกการเรียก Claude Code หรือ Codex จะโหลด context คงที่ก้อนใหญ่ก่อน ได้แก่ settings ระดับผู้ใช้ hooks plugins และ skills สำหรับงานเล็ก ส่วนนี้คือค่าใช้จ่ายส่วนใหญ่ preset คือชุด flag ที่ข้ามบางส่วนของมัน และปิดไว้จนกว่าจะเลือก จึงไม่เปลี่ยนอะไรโดยค่าเริ่มต้น

```yaml
contexts:
  lean:
    claude: ["--setting-sources", "project", "--disable-slash-commands"]
    codex: ["--disable", "hooks", "--disable", "plugins", "--disable", "apps"]
rules:
  - match: "typo|rename|small fix|explain"
    agent: claude
    model: haiku
    context: lean
```

preset ในตัว (ดู flag ที่แน่นอนที่ [defaults reference](/reference/config)):

- `lean`: ข้าม settings ระดับผู้ใช้ (plugins, hooks, คำสั่งส่วนตัว) และ skills ของ Claude กับ hooks, plugins, apps ของ Codex แต่ยังคงคำสั่งของโปรเจกต์ (`CLAUDE.md`, `AGENTS.md`) ผลวัด: ต้นทุนงานเล็กบน Claude ลดราว 48% และ input ต่อการเรียกของ Codex ลด 18% ที่ [ผลวัดจริง](/th/guide/benchmarks)
- `minimal`: Claude ใช้ `--safe-mode` และปิดฟีเจอร์ Codex เพิ่ม ประหยัดมากที่สุด (ลด 68% ในการเรียกคำเดียว) แต่ Claude จะไม่อ่าน `CLAUDE.md` ของโปรเจกต์ด้วย

เลือก preset ด้วย `context:` ใน rule, `orch run --context lean` หรือพารามิเตอร์ `context` ของ MCP tool `orch_run` ลำดับความสำคัญ: สั่งเอง แล้ว rule แล้วไม่ใช้ ชื่อที่ไม่มีอยู่จะถูกปฏิเสธพร้อมรายการชื่อที่ใช้ได้

ข้อควรรู้ก่อนใช้:

- `lean` ข้ามการตั้งค่า **ระดับผู้ใช้** กฎอนุญาต hooks และคำสั่งส่วนตัวของคุณจึงไม่มีผลกับการรันเหล่านั้น ให้ใส่สิทธิ์ที่เอเจนต์ต้องการใน `args` (เช่น `--permission-mode acceptEdits`) หรือในการตั้งค่าของโปรเจกต์เอง
- preset ของคุณถูกผสานกับของในตัวตามชื่อและตามเอเจนต์ จึงเพิ่ม `mine:` หรือแก้เฉพาะ `lean.codex` ได้
- ชื่อ flag และ feature เป็นของแต่ละ CLI และเปลี่ยนตามเวอร์ชัน ถ้า CLI ปฏิเสธ flag งานจะล้มและ orch จะสลับเอเจนต์ ให้แก้ preset แล้ว `orch daemon stop`
- `orch usage --by context` เทียบ preset จากการใช้งานจริงของคุณ

## Tiers (โหมดเอเจนต์เดียว)

`orch run --only claude "<prompt>"` รันเอเจนต์ตัวเดียวและเลือก model ตามขนาดของงาน tier มาจากคีย์เวิร์ดใน prompt ไม่เรียก model:

- **large**: refactor, migrate, architecture, redesign, rewrite, race condition, deadlock, concurrency, performance, security audit, investigate, root cause, design (และคำไทย เช่น รีแฟกเตอร์ ออกแบบ สถาปัตยกรรม) หรือ prompt ที่ยาวเกิน 2,000 ตัวอักษร large ชนะ small
- **small**: typo, rename, summarize, format, comment, docstring, changelog, bump (และคำไทย เช่น ตัวสะกด สรุป เปลี่ยนชื่อ)
- **medium**: นอกนั้นทั้งหมด และงานที่แยกไม่ออก

แต่ละเอเจนต์มีค่าของตัวเองต่อ tier ผสมกับค่าในตัวทีละ key:

```yaml
tiers:
  claude:
    small:  { model: haiku,  effort: low,    context: lean }
    medium: { model: sonnet, effort: medium }
    large:  { model: opus,   effort: high }
  codex:
    small:  { effort: low, context: lean }
    medium: { effort: medium }
    large:  { effort: high }
```

Codex ไม่มีชื่อ model ในตัวเพราะเปลี่ยนบ่อย ให้เพิ่ม `model:` ใน tier ด้วยชื่อจาก `/model` (เช่น `model: gpt-6-luna` ที่ `small`) `model` หรือ `effort` ต้องมี `modelArgs` หรือ `effortArgs` ของเอเจนต์ และ `context` ต้องมีอยู่จริง ไม่เช่นนั้น config ถูกปฏิเสธ rule ใน `rules` ของเอเจนต์เดียวกันที่ตรงกับ prompt จะทับ `model`, `effort`, `context` ของ tier ส่วน rule ของเอเจนต์อีกตัวถูกละเว้น ทุก tier มี `write: true` เป็นค่าเริ่มต้น งานในโหมด `--only` จึงแก้ไฟล์ได้: orch เพิ่ม `writeArgs` ของเอเจนต์ (Claude `--permission-mode acceptEdits`, Codex `-s workspace-write`) ตั้ง `write: false` ที่ tier เพื่อให้อ่านอย่างเดียว หรือแก้ `agents.<name>.writeArgs` เพื่อเปลี่ยนสิทธิ์ `orch run` ธรรมดา (ไม่มี `--only`) ไม่เปลี่ยนและไม่เพิ่ม flag เหล่านี้

## Roles และทีม

role คือการรันเฉพาะทาง (developer, tester, reviewer, ...) ดูวิธีรันที่หน้า [Roles](/th/guide/roles) ส่วนนี้แสดงคีย์ใน config role และทีมในตัวอยู่ที่ [defaults reference](/reference/config) ของคุณถูกผสานกับของในตัวตามชื่อและตามคีย์ จึงเพิ่ม `mine:` หรือแก้เฉพาะ `reviewer.model` ได้

```yaml
roles:
  reviewer:
    prompt: "You are a code reviewer. ..."
    agent: claude          # ไม่บังคับ: ตรึงเอเจนต์ ไม่งั้นใช้ routing ปกติ
    model: haiku           # ไม่บังคับ
    effort: low            # ไม่บังคับ
    context: lean          # ชื่อ context preset
    needs: []              # ความสามารถที่ role ต้องการ `image` ตรึงไว้กับ Codex
    writes: false          # role แก้ไฟล์โปรเจกต์ได้หรือไม่
    agentArgs:             # flag เพิ่มเติมต่อเอเจนต์ เช่น สิทธิ์
      claude: ["--permission-mode", "acceptEdits"]
teams:
  docs: [developer, reviewer]
pipeline:
  handoffChars: 4000
  parallel: true       # role อ่านอย่างเดียวที่อยู่ติดกันรันพร้อมกัน
  maxParallel: 2
```

คีย์ของ role: `prompt`, `agent`, `model`, `effort`, `context`, `needs`, `writes`, `agentArgs` คีย์ของ pipeline: `handoffChars`, `parallel`, `maxParallel`

- `roles.<name>.prompt`: คำสั่งที่กำหนด role (จำเป็นสำหรับ role ใหม่)
- `roles.<name>.agent`, `model`, `effort`, `context`: role รันที่ไหนและอย่างไร เป็นของ role เอง rule ใน `rules` ไม่มีผลกับมัน
- `roles.<name>.needs`: ความสามารถที่ role ต้องการจากเอเจนต์ มีเฉพาะ `image` role แบบนี้รันบน Codex เท่านั้น หลังตรวจความพร้อม และจะไม่ถูกย้ายไป Claude
- `roles.<name>.writes`: `true` ถ้า role แก้ไฟล์โปรเจกต์ได้ และเป็นค่าเริ่มต้นของ role ที่คุณเพิ่ม มันกำหนดการรันพร้อมกัน: เฉพาะ role ที่ `writes: false` เท่านั้นที่รันขนานได้ จึงตั้งเป็น `false` เฉพาะ role ที่ไม่เคยแก้ไฟล์ ส่วน flag สิทธิ์มาจาก `agentArgs`
- `roles.<name>.agentArgs`: อาร์กิวเมนต์เพิ่มเติมต่อเอเจนต์ ใส่ก่อน prompt role ที่เขียนไฟล์ต้องใส่ flag สิทธิ์ของเอเจนต์ที่นี่
- `teams.<name>`: รายการชื่อ role ทีมรันตามลำดับ architecture, designer, developer, tester, reviewer, security (role นอกรายการนี้ตามหลังตามลำดับที่เขียน)
- `pipeline.handoffChars`: จำนวนตัวอักษรสูงสุดของ handoff จาก role ก่อนหน้าที่ส่งให้ role (ค่าเริ่มต้น 4000)
- `pipeline.parallel`: ให้ role อ่านอย่างเดียวที่อยู่ติดกันรันพร้อมกัน (ค่าเริ่มต้น `true`) ตั้ง `false` เพื่อรันทีละตัว
- `pipeline.maxParallel`: จำนวน role สูงสุดที่รันพร้อมกัน (ค่าเริ่มต้น 2 จำนวนเต็มตั้งแต่ 1 ขึ้นไป)

การตรวจตอนโหลดจะระบุคีย์ที่ผิด: `agent` หรือ `context` ที่ไม่รู้จัก, ความสามารถใน `needs` ที่ไม่มี, role แบบ `image` ที่ตรึงไว้กับ Claude, ทีมที่อ้างถึง role ที่ไม่มี หรือ `handoffChars` ที่ไม่ใช่จำนวนเต็มบวก

### การเลือกอัตโนมัติ (`auto`)

```yaml
auto:
  enabled: false        # true: เลือก role ให้ทุกการรัน (ดู Roles)
  maxRoles: 3           # จำนวน role สูงสุดที่การเลือกอัตโนมัติจะรัน
  keywords:             # คำเพิ่มเติมต่อ role เพิ่มเข้ากับรายการในตัว
    security: [pii, gdpr]
```

คีย์ของ `auto`: `enabled`, `maxRoles`, `keywords`

- `auto.enabled`: ถ้าเป็น true `orch run` ธรรมดาจะเลือก role จาก prompt ใช้ `--no-auto` เพื่อปิดในรันเดียว ค่าเริ่มต้น false
- `auto.maxRoles`: จำนวนเต็มบวก ค่าเริ่มต้น 3
- `auto.keywords`: ชื่อ role ไปยังคำเพิ่มเติม (รายการข้อความ) ทั้ง role ในตัวและ role ที่คุณสร้างเอง (จะถูกเลือกเป็นลำดับสุดท้าย) ชื่อ role ที่ไม่มี, บล็อก `auto` ที่ไม่ใช่ mapping และคีย์ที่ไม่รู้จัก จะถูกปฏิเสธตอนโหลด

## ตัวแปรสภาพแวดล้อม

- `ORCH_HOME`: โฟลเดอร์สถานะ (ค่าเริ่มต้น `~/.orch`)
- `ORCH_CONFIG`: path ของไฟล์ตั้งค่า (ค่าเริ่มต้น `$ORCH_HOME/config.yaml`)
- `ORCH_DEPTH`: orch ตั้งให้เอเจนต์ที่มันเรียก ถ้าค่าตั้งแต่ 1 ขึ้นไป `orch` จะไม่ยอมรัน เพื่อกันเอเจนต์เรียก orch วนซ้ำ ห้ามตั้งเอง
