import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import * as pdfParse from "pdf-parse";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

dotenv.config({ path: ".env.local" });

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!OPENAI_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing one of OPENAI_API_KEY / SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function chunkText(text, maxChars = 1600) {
  const chunks = [];
  const paragraphs = text
    .split(/\n\s*\n/g)
    .map((p) => p.trim())
    .filter(Boolean);

  let current = "";

  for (const p of paragraphs) {
    if (p.length > maxChars) {
      if (current) {
        chunks.push(current.trim());
        current = "";
      }
      for (let i = 0; i < p.length; i += maxChars) {
        chunks.push(p.slice(i, i + maxChars));
      }
      continue;
    }

    if ((current + "\n\n" + p).length > maxChars) {
      if (current) chunks.push(current.trim());
      current = p;
    } else {
      current = current ? current + "\n\n" + p : p;
    }
  }

  if (current) chunks.push(current.trim());
  return chunks;
}

async function main() {
  try {
    const pdfPath = path.join(process.cwd(), "data", "Bidline Rules Feb 2025.pdf");
    console.log("Reading PDF:", pdfPath);

    if (!fs.existsSync(pdfPath)) {
      console.error("PDF file not found at:", pdfPath);
      process.exit(1);
    }

    const dataBuffer = fs.readFileSync(pdfPath);
    const pdfData = await pdfParse(dataBuffer);

    console.log("PDF loaded. Length of text:", pdfData.text.length);

    const chunks = chunkText(pdfData.text);
    console.log(`Generated ${chunks.length} chunks. Creating embeddings and inserting into Supabase...`);

    const batchSize = 20;
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      console.log(`Embedding batch ${i + 1}–${i + batch.length} of ${chunks.length}`);

      const embeddingResponse = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: batch,
      });

      const rows = batch.map((content, j) => ({
        content,
        source: "Bidline Rules Feb 2025",
        section: "",
        page: "",
        embedding: embeddingResponse.data[j].embedding,
      }));

      const { error } = await supabase.from("blr_chunks").insert(rows);
      if (error) {
        console.error("Supabase insert error:", error);
        process.exit(1);
      }
    }

    console.log("? Import complete. Bidline Rules chunks are now in blr_chunks.");
  } catch (err) {
    console.error("Import failed:", err);
    process.exit(1);
  }
}

main();
