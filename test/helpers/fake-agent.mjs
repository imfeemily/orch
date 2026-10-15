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
