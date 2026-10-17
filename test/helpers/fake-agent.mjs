// usage: node fake-agent.mjs <mode> [args...]
const [mode, ...rest] = process.argv.slice(2);

if (mode === "ok") {
  console.log("done: " + rest.join(" "));
  process.exit(0);
}
if (mode === "limit") {
  console.error("Error: usage limit reached");
  process.exit(1);
}
if (mode === "fail") {
  console.error("boom");
  process.exit(2);
}
if (mode === "echo-args") {
  console.log(JSON.stringify(rest));
  process.exit(0);
}
if (mode === "depth") {
  console.log(process.env.ORCH_DEPTH);
  process.exit(0);
}
if (mode === "sleep") {
  setTimeout(() => {}, 60000);
}

if (mode === "split-utf8") {
  // the Thai letter "ก" is the three bytes e0 b8 81; send it in two writes
  process.stdout.write(Buffer.from([0xe0, 0xb8]));
  setTimeout(() => {
    process.stdout.write(Buffer.from([0x81, 0x0a]));
    process.exit(0);
  }, 80);
}
