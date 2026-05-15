import { createApplicationInfo } from "#app/application.ts";

export { createApplicationInfo } from "#app/application.ts";

const info = createApplicationInfo();

console.log(`${info.name} ${info.version}`);
console.log(info.purpose);
console.log("");
console.log("Reverse-tunnel commands are not implemented yet.");
