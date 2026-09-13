// Sanitize WAHA OpenAPI spec: string enums declared with `type: object`.
import { readFileSync, writeFileSync } from "node:fs";
const spec = JSON.parse(readFileSync("spec/waha-openapi.json", "utf8"));
let fixed = 0;
function walk(node) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) return node.forEach(walk);
  if (Array.isArray(node.enum) && node.enum.every((x) => typeof x === "string") && node.type !== "string") {
    node.type = "string";
    fixed++;
  }
  Object.values(node).forEach(walk);
}
walk(spec);
writeFileSync("spec/waha-openapi.fixed.json", JSON.stringify(spec));
console.log("fixed", fixed, "enum nodes");
