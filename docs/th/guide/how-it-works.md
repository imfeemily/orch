# การทำงานเบื้องหลัง

orch อยู่ระหว่างเครื่องมือของคุณกับเอเจนต์เขียนโค้ดสองตัว ทุกอย่างรันบนเครื่องคุณ โดยใช้สิทธิ์ Claude Code และ Codex ที่คุณมีอยู่แล้ว

## สถาปัตยกรรม

![client คุยกับ daemon ของ orch ผ่าน unix socket, router เลือกเอเจนต์ โมเดล และ tier, runner เปิด CLI ของ Claude หรือ Codex, ส่วน state กับ usage ledger อยู่ข้างๆ](/img/architecture.svg)

client ใดก็ได้ (เทอร์มินัล, Claude Code, Codex, VS Code, Cursor, Claude Desktop) ส่งงานไปที่ daemon ในเครื่องตัวเดียว **router** เลือกเอเจนต์ โมเดล และ tier จาก prompt และ rule ของคุณ **runner** เปิดคำสั่ง `claude` หรือ `codex` จริง **state** จำเวลา cooldown และ **usage ledger** บันทึกโทเค่น `orch usage` จึงบอกได้ว่าแต่ละเอเจนต์ โมเดล และ role ใช้ไปเท่าไร

## Failover

![งานถูกจัด tier เลือกเอเจนต์ และรัน เมื่อติด rate limit หรือล้มเหลว orch บันทึก cooldown เขียน handoff แล้วทำต่อที่เอเจนต์อีกตัว](/img/failover.svg)

เมื่อเอเจนต์ติด rate limit หรือล้มเหลว orch บันทึก cooldown (ตามเวลา reset ที่เอเจนต์แจ้ง) สร้าง handoff จาก prompt เดิม `git diff` ของคุณ และสรุปสั้นๆ แล้วทำงานให้จบที่เอเจนต์อีกตัว ถ้าใช้ `--only` จะไม่ failover แต่แจ้งให้ทราบ

## Role และทีม

![Developer ตามด้วย tester แล้ว reviewer กับ security ทำงานขนานกัน เก็บเป็น artifact ส่วน role designer ใช้ Codex สร้างภาพ](/img/roles.svg)

ทีมรัน role ตามลำดับและส่ง handoff สั้นๆ จาก role หนึ่งไปอีก role role แบบอ่านอย่างเดียวที่อยู่ติดกัน (reviewer, security) รันขนานกัน ประหยัดเวลาแต่ไม่ประหยัดโทเค่น role designer ต้องใช้ Codex เพราะมีแต่ Codex ที่สร้างภาพได้ ดู [Roles](/th/guide/roles)
