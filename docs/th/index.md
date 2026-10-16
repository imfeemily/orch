---
layout: home
hero:
  name: claude-codex-orch
  text: งานเดียว สองเอเจนต์เขียนโค้ด
  tagline: สลับงานระหว่าง Claude Code กับ Codex สลับให้อัตโนมัติเมื่อติด limit และประหยัดโทเค่นมากขึ้น
  actions:
    - theme: brand
      text: เริ่มต้นใช้งาน
      link: /th/guide/getting-started
    - theme: alt
      text: Developer guide (English)
      link: /developer/architecture
features:
  - title: เริ่มจากเครื่องมือไหนก็ได้
    details: เรียก orch จากเทอร์มินัล, Claude Code หรือ Codex (MCP) ทั้งสามทางใช้ daemon ตัวเดียวกัน
  - title: สลับเองเมื่อติด limit หรือล้ม
    details: งานถูกส่งต่อให้อีกเอเจนต์พร้อม prompt เดิมและสถานะ git โดย cooldown ตามเวลา reset ที่เอเจนต์แจ้ง
  - title: ประหยัดโทเค่นตั้งแต่ดีไซน์
    details: เลือก model เล็กตามชนิดงาน ส่งต่อเฉพาะสรุป diff เมื่อการเปลี่ยนแปลงใหญ่ และข้ามขั้นตอนที่ไม่มีทางสำเร็จ
---
