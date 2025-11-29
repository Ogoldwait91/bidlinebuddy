import { NextRequest, NextResponse } from "next/server";
import { OpenAI } from "openai";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const query = body?.query;
    const history = Array.isArray(body?.history) ? body.history : [];

    if (!query || typeof query !== "string") {
      return NextResponse.json({ error: "Missing query" }, { status: 400 });
    }

    // Build a short conversational history (last 3 Q&A pairs)
    let historyText = "";
    if (history.length > 0) {
      const recent = history.slice(-3);
      historyText = recent
        .map((h: any, idx: number) => {
          const q =
            typeof h.question === "string" ? h.question : "(no question text)";
          const a =
            typeof h.answer === "string" ? h.answer : "(no answer text)";
          return `Previous Q${idx + 1}: ${q}\nPrevious A${idx + 1}: ${a}`;
        })
        .join("\n\n");
    }

    const embeddingResponse = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: query
    });
    const queryEmbedding = embeddingResponse.data[0].embedding;

    const { data: chunks, error } = await supabase.rpc("match_blr_chunks", {
      query_embedding: queryEmbedding,
      match_threshold: 0.4,
      match_count: 12
    });

    if (error) {
      console.error("Supabase error:", error);
      return NextResponse.json(
        { error: "Database search failed in BidlineBuddy." },
        { status: 500 }
      );
    }

    console.log(
      "BidlineBuddy: retrieved chunks count =",
      chunks?.length ?? 0
    );

    if (!chunks || chunks.length === 0) {
      const fallbackAnswer = [
        "1) TL;DR:",
        "- Unclear from BLR / BASC.",
        "",
        "2) What the rules say:",
        "- I couldn't find any clearly relevant rules in the indexed Bidline Rules / BASC extracts.",
        "",
        "3) What the rules don’t say / grey area:",
        "- The documents I have do not directly cover this scenario, so I cannot safely infer an answer.",
        "",
        "4) Pragmatic view (not official advice):",
        "- For anything borderline or career-critical, the safest course is to speak directly with BASC or Scheduling and follow their written guidance.",
        "",
        "What to say to Global Ops:",
        '"BidlineBuddy could not find a clear rule covering this situation in BLR / BASC. I would like to check with you or BASC for the official position, please."',
        "",
        "Confidence tag: Low"
      ].join("\n");

      return NextResponse.json({
        answer: fallbackAnswer.replace(/Confidence tag:.*$/i, "").trim(),
        chunks: [],
        confidenceTag: "low"
      });
    }

    const contextText = chunks
      .map((c: any, idx: number) => {
        const labelParts = [
          `[${idx + 1}]`,
          c.source || "Unknown source",
          c.page ? `(${c.page})` : "",
          c.section ? `– ${c.section}` : ""
        ].filter(Boolean);

        const label = labelParts.join(" ");
        const content = typeof c.content === "string" ? c.content : "";
        const trimmedContent =
          content.length > 1200 ? content.slice(0, 1200) + " …" : content;

        return `${label}\n${trimmedContent}`;
      })
      .join("\n\n");

    const historyPrefix = historyText
      ? `Here is the recent conversation context between the pilot and BidlineBuddy:\n\n${historyText}\n\nTreat the following as a follow-up question that may refer back to this context.\n\n`
      : "";

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [
        {
          role: "system",
          content: `
You are BidlineBuddy, an assistant specialising in BA Bidline Rules and BASC guides.

Hard safety rules:
- You MUST base every answer ONLY on the provided context chunks, which are labelled [1], [2], etc.
- If the context does NOT clearly answer the question, you MUST say this explicitly rather than guessing.
- NEVER invent BLR / BASC rules, numbers, definitions, or pages that are not shown in the context.
- If different chunks appear to conflict or be ambiguous, you MUST say that and advise contacting BASC.
- If a chunk is clearly about a different duty type or scenario (e.g. hotel report vs home standby, airport report vs home standby, long-haul vs short-haul, reserve vs open time), you MUST NOT directly apply that rule to the question. Instead, you should say that the section appears to be about a different context and treat it as not answering the question.
- When the pilot's question clearly mentions a specific context (e.g. "home standby", "RPH", "hotel report", "airport report"), you should prefer chunks that explicitly mention that same context and down-weight or ignore chunks that clearly refer to something else.
- Always prefer chunks where the wording closely matches the key terms in the pilot's question (e.g. "home standby", "RPH", "open time", "disruption") over more generic or different-scenario chunks.
- If the question is clearly outside the scope of BLR / BASC (e.g. medical, HR disputes, pay scales), say it is outside scope and advise the right channel.

When you reference specific rules, refer back to the chunk labels [1], [2], etc, and any pages that appear in the context, e.g. "From [1], BLR Feb 2025 p.104: …" or "From [3], BASC 2022 p.17: …".

Format every response exactly as:

1) TL;DR:
- One sentence.
- Be as specific and helpful as the rules allow (e.g. "Usually yes, if …", "No, unless …", "Yes, but only when …").
- Only use the wording "Unclear from BLR / BASC" when the provided extracts genuinely do NOT cover the scenario or are clearly ambiguous.

2) What the rules say:
- 3–6 bullet points.
- Each bullet should, where possible, reference the chunk labels and pages, e.g. "From [1], BLR Feb 2025 p.104: …".
- Be factual and neutral.

3) What the rules don’t say / grey area:
- 2–4 bullet points.
- Highlight any gaps, ambiguity, or places where the docs are silent.
- If something feels like a judgement call, say that clearly.

4) Pragmatic view (not official advice):
- 2–4 bullet points in plain English, suggesting a sensible, conservative approach a professional pilot might take.
- Make it clear this is NOT official advice and should be checked with BASC / Scheduling for anything high-stakes.

Finally, append:

What to say to Global Ops:
- A short, polite script the pilot can read out word-for-word.
- Base it on the rules you have just explained.
- If the answer is unclear, the script should ask Global Ops / BASC for their official view rather than asserting a right.

At the very end of your message, after everything else, add a single line in this exact format (for the UI only):
Confidence tag: High
or
Confidence tag: Medium
or
Confidence tag: Low

Choose:
- High if the rules clearly and directly answer the question.
- Medium if the rules are relevant but there are caveats or mild ambiguity.
- Low if the rules only partially match or the situation is mostly outside the provided extracts.

If the context does not contain enough information to confidently answer, you MUST say so clearly rather than guessing, and your confidence should be Low.
`
        },
        {
          role: "user",
          content: `${historyPrefix}Here are the most relevant rule extracts from BLR / BASC:\n\n${contextText}\n\nCurrent pilot question: ${query}\n\nAnswer using ONLY these extracts. If they do not clearly answer, say so.`
        }
      ]
    });

    const raw = completion.choices[0].message.content ?? "";
    const tagMatch = raw.match(/Confidence tag:\s*(High|Medium|Low)/i);
    const confidenceTag = tagMatch
      ? tagMatch[1].toLowerCase()
      : "unknown";

    const answer = raw.replace(/Confidence tag:.*$/i, "").trim();

    return NextResponse.json({ answer, chunks, confidenceTag });
  } catch (err: any) {
    console.error("Unexpected error:", err);

    if (err?.status === 429 || err?.code === "insufficient_quota") {
      return NextResponse.json(
        {
          error:
            "BidlineBuddy cannot contact OpenAI because the API quota is exhausted. Top up or adjust your OpenAI billing, then try again."
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { error: "Unexpected error in BidlineBuddy API." },
      { status: 500 }
    );
  }
}
