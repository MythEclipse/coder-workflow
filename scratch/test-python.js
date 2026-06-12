import { pythonParser } from "./dist/graph/parsers/python.js";

async function run() {
  const source = `
    class MyService:
        def process(self):
            pass
  `;
  try {
    console.log("Extracting symbols...");
    const symbols = await pythonParser.extractSymbols(source, "app/worker.py");
    console.log("Symbols extracted:", JSON.stringify(symbols, null, 2));
  } catch (err) {
    console.error("Error extracted:", err);
  }
}

run();
