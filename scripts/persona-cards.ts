// Prints one card per seed enquiry for HUMAN test calls to the live Vaani number.
// After each test call, the dashboard shows what the system decided.
//   npm run persona-cards > eval/persona-cards.md
import { seedCases } from "../eval/seed-cases";
console.log("# Test-call persona cards\n\nCall the Aangan number and play the caller. Don't read the card aloud — talk naturally.\n");
for (const c of seedCases) {
  console.log(`## ${c.id} (${c.channel})\n\n${c.persona}\n\n**The system should end with:** ${c.expect.route.replace("_", " ")}${c.expect.flags?.length ? ` · flags: ${c.expect.flags.join(", ")}` : ""}\n`);
}
