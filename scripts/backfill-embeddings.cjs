require("dotenv").config({ path: ".env.local" });

const { createClient } = require("@supabase/supabase-js");
const OpenAI = require("openai");

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!OPENAI_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing one of OPENAI_API_KEY / SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  try {
    const { data: rows, error } = await supabase
      .from("blr_chunks")
      .select("id, content")
      .is("embedding", null);

    if (error) {
      console.error("Supabase select error:", error);
      process.exit(1);
    }

    if (!rows || rows.length === 0) {
      console.log("No rows without embeddings. Nothing to do.");
      process.exit(0);
    }

    console.log(`Found ${rows.length} rows without embeddings. Creating embeddings...`);

    const batchSize = 20;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      console.log(`Embedding batch ${i + 1}–${i + batch.length} of ${rows.length}`);

      const embeddingResponse = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: batch.map((r) => r.content),
      });

      for (let j = 0; j < batch.length; j++) {
        const row = batch[j];
        const embedding = embeddingResponse.data[j].embedding;

        const { error: updateError } = await supabase
          .from("blr_chunks")
          .update({ embedding })
          .eq("id", row.id);

        if (updateError) {
          console.error("Supabase update error:", updateError);
          process.exit(1);
        }
      }
    }

    console.log("✅ Embedding backfill complete.");
  } catch (err) {
    console.error("Backfill failed:", err);
    process.exit(1);
  }
}

main();
