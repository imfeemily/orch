/** The final answer to print after a run: nothing if it was already streamed live. */
export function finalOutputToPrint(streamed: boolean, output: string): string {
  if (streamed || output === "") return "";
  return output.endsWith("\n") ? output : `${output}\n`;
}
