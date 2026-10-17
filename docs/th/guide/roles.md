# Roles

**role** คือการรันเอเจนต์แบบเฉพาะทาง: developer ลงมือเขียน, tester เขียน test, reviewer ตรวจ แทนที่จะเรียกครั้งเดียวแบบทั่วไป orch รันหลาย role ต่อกันได้ แต่ละ role มีคำสั่งของตัวเอง และส่งสรุปสั้นๆ ต่อให้ role ถัดไป

role เป็น opt-in `orch run "..."` ที่ไม่มี flag ของ role ทำงานเหมือนเดิมทุกอย่าง

::: info ในเวอร์ชันนี้
role ในตัวหกตัว: `architecture`, `designer`, `developer`, `tester`, `reviewer`, `security` ทีม: `quick` (`developer`), `standard` (`developer`, `tester`, `reviewer`) และ `full` (ครบทั้งหก) มีการเลือก role อัตโนมัติ (`--auto`) และ role สร้างภาพบน Codex แล้ว การรัน role อ่านอย่างเดียวขนานกันอยู่ในแผน และคุณกำหนด role กับทีมของตัวเองใน config ได้
:::

## วิธีรัน

```bash
orch run --role reviewer "review the last commit"             # role เดียว
orch run --team standard "add a test for clamp() in src/math.ts"   # ทีมที่ตั้งชื่อไว้
orch run --roles developer,tester "fix the bug in parser.ts"  # รายการที่คุณกำหนด ตามลำดับนี้
orch run --team standard --dry-run "add a test for clamp()"   # แสดงแผน ไม่เสียโทเค่น
```

`--role`, `--roles` และ `--team` ใช้ร่วมกันไม่ได้ ตัวเลือกเดียวกันมีใน MCP tool `orch_run` (`role`, `roles`, `team`, `dryRun`, `requireCodex`, `keepGoing`)

- **role เดียว** (`--role`): เรียกครั้งเดียวด้วยคำสั่ง, agent, model และ context ของ role นั้น แสดงคำตอบตามปกติ
- **ทีม** (`--team`): role ของทีมรันตามลำดับคงที่: architecture, designer, developer, tester, reviewer, security (เฉพาะที่ทีมมี)
- **รายการ** (`--roles`): รันตามลำดับที่คุณระบุ

## แต่ละ role ทำอะไร

| Role | ทำอะไร | แก้ไฟล์โปรเจกต์ |
|---|---|---|
| `developer` | ทำงานตามโจทย์ด้วยการเปลี่ยนแปลงที่น้อยที่สุด | ใช่ |
| `tester` | เพิ่มหรืออัปเดต test (เฉพาะไฟล์ test) | ใช่ |
| `reviewer` | ตรวจการเปลี่ยนแปลงใน working tree และรายงานบั๊กกับความเสี่ยง | ไม่ |
| `architecture` | อธิบายดีไซน์ ขอบเขตโมดูล และความเสี่ยง พร้อมแผนภาพ Mermaid เมื่อช่วยได้ | ไม่ |
| `designer` | สร้างภาพ mockup หรือ diagram (ต้องใช้ Codex) เก็บในโฟลเดอร์ assets ของการรัน | ไม่ (เฉพาะ assets) |
| `security` | ตรวจการเปลี่ยนแปลงใน working tree เรื่องความปลอดภัย | ไม่ |

แต่ละ role คือการรัน orch ตามปกติหนึ่งครั้ง จึงใช้ routing, failover เมื่อติด rate limit, context preset และ ledger ได้ครบ เมื่อ failover ไปอีกเอเจนต์ role ยังคงชื่อ context preset และใช้ flag ของเอเจนต์นั้นเอง

## role ส่งงานต่อกันอย่างไร

1. ทุก role ในทีมถูกขอให้ปิดคำตอบด้วยหัวข้อ `## Handoff` ไม่เกิน 150 คำ
2. orch บันทึกคำตอบเต็มของ role ที่ `.orch/runs/<run-id>/<role>.md` ในโปรเจกต์ และเก็บ handoff ไว้ ถ้า role ไม่เขียนหัวข้อนี้ จะใช้ 1,500 ตัวอักษรสุดท้ายของคำตอบ
3. role ถัดไปได้รับโจทย์พร้อม handoff ก่อนหน้า จำกัดที่ `pipeline.handoffChars` (ค่าเริ่มต้น 4,000 ตัวอักษร) เอาของใหม่สุดก่อน

`.orch/runs/` มี `.gitignore` ของตัวเองที่เขียนว่า `*` ไฟล์เหล่านี้จึงไม่เข้า git โดยไม่แตะ `.gitignore` ของคุณ ถ้าเขียนไฟล์ไม่ได้ งานยังรันต่อไปโดยไม่มีไฟล์เหล่านั้น

role ที่แก้ไฟล์ได้รันทีละตัว ถ้า role หนึ่งล้ม (หลัง failover แล้ว) ทีมจะหยุดและ role ที่เหลือถูกรายงานเป็น `not-run` ใส่ `--keep-going` เพื่อรันต่อ

## role ที่ต้องใช้ Codex

role ที่มี `needs: [image]` (เช่น role ที่สร้างภาพ mockup หรือ diagram) รันบน Codex เท่านั้น และเมื่อ orch ตรวจแล้วว่า Codex พร้อม โดยไม่เสียโทเค่นเลย:

- มีคำสั่ง `codex` ติดตั้งอยู่
- `codex login status` สำเร็จ
- ฟีเจอร์ `image_generation` เปิดอยู่ใน `codex features list`
- Codex ไม่ติด cooldown จาก rate limit

orch ตรวจอีกครั้งก่อน role แบบนี้ทุกตัวรัน ดังนั้นถ้า Codex ติด rate limit ระหว่าง role ก่อนหน้า role นั้นก็ถูกข้ามเช่นกัน ถ้า Codex ไม่พร้อม role นั้นจะถูก **ข้าม** พร้อมเหตุผล (เช่น `not logged in: run codex login`) และ role อื่นทำงานต่อ ใส่ `--require-codex` เพื่อหยุดก่อนเริ่มอะไรเลยแทน role ที่ต้องการความสามารถพิเศษจะไม่ถูกย้ายไป Claude เพราะ Claude ทำงานนั้นไม่ได้

```yaml
roles:
  mockup:
    prompt: "You are a UX designer. Describe and generate a mockup image of the screen in the task."
    needs: [image]
    writes: false
```

การสร้างภาพผ่าน Codex แบบ headless ใช้งานได้: ในการทดสอบมันสร้างไฟล์ PNG ที่ถูกต้องตาม path ที่สั่ง ต้องใช้ `-s workspace-write` ซึ่ง `designer` ในตัวมีให้แล้ว แต่ก็แพง: โลโก้เล็กๆ หนึ่งอันใช้ input ราว 121,000 โทเค่นของโควต้า Codex (ส่วนใหญ่เป็น cache) จากการเรียกเครื่องมือหลายรอบ จึงควรรัน role สร้างภาพเมื่อตั้งใจเท่านั้น

ถ้าคุณส่ง [context preset](/th/guide/configuration#context-presets) ที่ปิดการสร้างภาพของ Codex (`minimal` ในตัวปิด) role สร้างภาพจะถูกข้ามพร้อมเหตุผลนั้น แทนที่จะรันโดยไม่มีความสามารถ

## ภาพและ diagram

role ที่มี `needs` จะได้โฟลเดอร์ assets คือ `.orch/runs/<run-id>/assets/` ซึ่ง orch สร้างให้และระบุไว้ท้าย prompt ของ role และสั่งให้บันทึกไฟล์ภาพและ diagram ที่นั่นเท่านั้น เมื่อ role จบ orch จะ **แสดงรายการไฟล์ที่อยู่ในโฟลเดอร์นั้นจริง** (`orch run` พิมพ์ส่วน `assets:` ผล MCP ก็แสดงรายการ) ไม่ได้อ่านชื่อไฟล์จากข้อความของ model ดังนั้น role ที่อ้างถึงไฟล์ที่ไม่ได้เขียนจะถูกรายงานว่าไม่มีไฟล์

diagram แบบข้อความไม่ต้องใช้ Codex: role `architecture` เขียน Mermaid ในบล็อกโค้ดในคำตอบ และถูกบันทึกไปกับ artifact ของ role

## การเลือกอัตโนมัติ

`orch run --auto "..."` เลือก role ให้ด้วยกฎคำสำคัญธรรมดา ไม่เรียก model จึงไม่เสียโทเค่นในการเลือก เปิดใช้กับทุกการรันด้วย `auto.enabled: true` ใน config และใช้ `--no-auto` เพื่อข้ามในรันเดียว

- **คำถามหรือการอธิบาย** ที่ไม่มีเจตนาเปลี่ยนโค้ด ("explain how...", "what does...") จะไม่เลือก role ใดเลย และรันเป็นการเรียกครั้งเดียว ซึ่งถูกที่สุด
- งานอื่นเลือก `developer` เสมอ บวก: `tester` เมื่อมี test, bug, fix, regression, feature, implement; `reviewer` เมื่อมี refactor, migrate, implement, feature หรือ prompt ยาว; `security` เมื่อมี auth, login, token, password, secret, crypto, sql, upload, permission, payment; `architecture` เมื่อมี architecture, "design the", module, boundary, "api design", migrate; `designer` เมื่อมี ui, ux, screen, layout, mockup, wireframe, diagram, image, logo จับคู่ทั้งคำ ไม่สนตัวพิมพ์ เพิ่มคำของคุณเองใน `auto.keywords`
- รันไม่เกิน `auto.maxRoles` role (ค่าเริ่มต้น 3) ถ้าตรงมากกว่านั้นจะเก็บตามลำดับ `developer`, `security`, `tester`, `reviewer`, `architecture`, `designer` และแสดงตัวที่ถูกตัด role ที่เลือกรันตามลำดับมาตรฐาน
- ลำดับความสำคัญ: `--role`, `--roles` หรือ `--team` ชนะ `--auto` ถ้าใช้ร่วมกันจะ error ส่วน `--auto` ชนะ `auto.enabled`

```bash
orch explain "implement login with a password reset token"   # เลือก role อะไร เพราะอะไร ไม่เรียก model
orch run --auto --dry-run "implement login with a password reset token"
orch run --auto "fix the typo in README"
```

การรันแบบ auto จริงพิมพ์หนึ่งบรรทัดก่อนเริ่ม role: `auto: roles developer, tester` พร้อมเหตุผล

## วางแผนก่อนด้วย `--dry-run`

`--dry-run` แสดงว่า role ไหนจะรันบนเอเจนต์ไหน และเรียก model กี่ครั้ง รวมถึง role ที่จะถูกข้าม โดยไม่เสียโทเค่น

```text
plan: 3 model calls planned
  developer  claude
  tester     claude
  reviewer   claude
```

## ต้นทุน

หลาย role คือหลายการเรียก และทุกการเรียกโหลด context คงที่ของเอเจนต์ก่อน (ดู [ผลวัดจริง](/th/guide/benchmarks)) ทีม `standard` จึงแพงราวสามเท่าของการเรียกครั้งเดียว ประโยชน์คือการตรวจและ test ไม่ใช่การประหยัด เพื่อคุมต้นทุน: ใช้เฉพาะ role ที่จำเป็น ให้ role อ่านอย่างเดียวใช้ [context preset](/th/guide/configuration#context-presets) เช่น `lean` (`reviewer` ในตัวใช้อยู่แล้ว) และเทียบด้วย `orch usage --by role`

## สิทธิ์

`developer` และ `tester` ถูกสร้างมาให้แก้โปรเจกต์ของคุณ เอเจนต์แบบ headless แก้ไฟล์ไม่ได้ถ้าไม่มี flag สิทธิ์ role เหล่านี้จึงพกมาผ่าน `agentArgs` (Claude `--permission-mode acceptEdits`, Codex `-s workspace-write`) การใช้ role เหล่านี้ทำให้เอเจนต์แก้ไฟล์ในโฟลเดอร์ที่คุณรันได้ ควรตรวจผลด้วย `git diff`

## การปรับแต่ง

role และทีมคือ config ธรรมดา ดู [Roles และทีม](/th/guide/configuration#roles-และทีม) สำหรับทุกคีย์ และ [defaults reference](/reference/config) สำหรับค่าในตัว
