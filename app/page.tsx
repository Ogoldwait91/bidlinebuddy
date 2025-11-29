"use client";

import { useState, useEffect } from "react";

type SourceChunk = {
  source?: string;
  page?: string;
  section?: string | null;
  similarity?: number | null;
};

type ConfidenceTag = "high" | "medium" | "low" | "unknown";

type QAPair = {
  id: number;
  question: string;
  answer: string;
  sources: SourceChunk[];
  feedback?: "yes" | "no" | null;
  confidenceTag?: ConfidenceTag;
};

const ACCESS_CODE = "BIDLINE2025"; // change this if you like
const ACCESS_STORAGE_KEY = "bidlinebuddy_access_v1";

function getConfidence(
  sources: SourceChunk[],
  tag?: ConfidenceTag
): { label: string; color: string; detail: string } {
  // Prefer model-provided tag if present
  if (tag === "high") {
    return {
      label: "Strong rule support",
      color: "#16a34a",
      detail:
        "The quoted BLR / BASC extracts clearly support this answer. Still confirm anything unusual with BASC."
    };
  }
  if (tag === "medium") {
    return {
      label: "Rules partly support",
      color: "#eab308",
      detail:
        "The rules are relevant but there may be caveats or grey areas. Use this as a strong steer and confirm with BASC if in doubt."
    };
  }
  if (tag === "low") {
    return {
      label: "Weak rule support",
      color: "#dc2626",
      detail:
        "The rules only partially match or are ambiguous. Treat this as a steer only and confirm with BASC / Scheduling."
    };
  }

  // Fallback: similarity-based if no tag
  if (!sources || sources.length === 0) {
    return {
      label: "Unknown",
      color: "#94a3b8",
      detail:
        "No strong matches were found in the indexed rules. Treat this as a steer only and check with BASC."
    };
  }

  const sims = sources
    .map((s) => (typeof s.similarity === "number" ? s.similarity : null))
    .filter((v): v is number => v !== null);

  if (sims.length === 0) {
    return {
      label: "Unknown",
      color: "#94a3b8",
      detail:
        "Similarity scores are not available for these matches. Treat this as a steer only and check with BASC."
    };
  }

  const maxSim = Math.max(...sims);

  if (maxSim >= 0.8) {
    return {
      label: "Strong rule support",
      color: "#16a34a",
      detail:
        "The answer is based on rules that are a very strong match to your question."
    };
  } else if (maxSim >= 0.65) {
    return {
      label: "Rules partly support",
      color: "#eab308",
      detail:
        "The answer is based on reasonably relevant rules, but you should still double-check with BASC for edge cases."
    };
  } else {
    return {
      label: "Weak rule support",
      color: "#dc2626",
      detail:
        "The match to the rules is weak. Treat this as a steer only and confirm with BASC / Scheduling."
    };
  }
}

function getFollowups(question: string): string[] {
  const q = question.toLowerCase();

  if (q.includes("tass")) {
    return [
      "How does TASS affect my trip ownership?",
      "What happens if I am given TASS twice in a month?",
      "Can TASS be used on my days off?"
    ];
  }

  if (q.includes("reserve") || q.includes("rph") || q.includes("standby")) {
    return [
      "What are the contactability rules for home standby?",
      "Can reserve be moved if it clashes with my owned trip?",
      "What rest must I get between reserve days?"
    ];
  }

  if (q.includes("disruption") || q.includes("disrupted") || q.includes("irrops")) {
    return [
      "Do I keep ownership if my trip is disrupted and I am reassigned?",
      "What rest do I get after a major disruption?",
      "Can they assign me into a day off after disruption?"
    ];
  }

  if (
    q.includes("ownership") ||
    q.includes("owned trip") ||
    q.includes("trip buying")
  ) {
    return [
      "When do I lose trip ownership?",
      "How does trip buying interact with disruption?",
      "Can my owned trip be removed for reserve or standby?"
    ];
  }

  if (q.includes("open time") || q.includes("open-time")) {
    return [
      "In what order is open time allocated?",
      "Can open time be used to replace a standby duty?",
      "How does open time interact with TASS or reserve?"
    ];
  }

  return [
    "What if this scenario happens more than once?",
    "How does this interact with disruption or reserve?",
    "What should I ask BASC to confirm?"
  ];
}

type ParsedAnswer = {
  tldr: string;
  rules: string[];
  gaps: string[];
  pragmatic: string[];
  script: string;
};

function parseAnswer(answer: string): ParsedAnswer {
  const lines = answer.split(/\r?\n/).map((l) => l.trim());
  const result: ParsedAnswer = {
    tldr: "",
    rules: [],
    gaps: [],
    pragmatic: [],
    script: ""
  };

  let section: "none" | "tldr" | "rules" | "gaps" | "pragmatic" | "script" =
    "none";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!line) continue;

    if (line.toLowerCase().startsWith("1) tl;dr")) {
      section = "tldr";
      continue;
    }
    if (line.toLowerCase().startsWith("2) what the rules say")) {
      section = "rules";
      continue;
    }
    if (
      line.toLowerCase().startsWith("3) what the rules don’t") ||
      line.toLowerCase().startsWith("3) what the rules don't")
    ) {
      section = "gaps";
      continue;
    }
    if (
      line.toLowerCase().startsWith("4) pragmatic view") ||
      line
        .toLowerCase()
        .startsWith("4) pragmatic view (not official advice")
    ) {
      section = "pragmatic";
      continue;
    }
    if (line.toLowerCase().startsWith("what to say to global ops")) {
      section = "script";
      continue;
    }

    switch (section) {
      case "tldr": {
        if (!result.tldr && line.startsWith("-")) {
          result.tldr = line.replace(/^-+\s*/, "");
        } else if (!result.tldr) {
          result.tldr = line;
        }
        break;
      }
      case "rules": {
        if (line.startsWith("-")) {
          result.rules.push(line.replace(/^-+\s*/, ""));
        } else {
          result.rules.push(line);
        }
        break;
      }
      case "gaps": {
        if (line.startsWith("-")) {
          result.gaps.push(line.replace(/^-+\s*/, ""));
        } else {
          result.gaps.push(line);
        }
        break;
      }
      case "pragmatic": {
        if (line.startsWith("-")) {
          result.pragmatic.push(line.replace(/^-+\s*/, ""));
        } else {
          result.pragmatic.push(line);
        }
        break;
      }
      case "script": {
        result.script = result.script ? `${result.script} ${line}` : line;
        break;
      }
      default:
        break;
    }
  }

  if (!result.tldr) {
    result.tldr = answer.split(/\r?\n/)[0] || "";
  }
  if (!result.script) {
    result.script = answer;
  }

  return result;
}

export default function Home() {
  const [authorised, setAuthorised] = useState(false);
  const [codeInput, setCodeInput] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);

  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState<QAPair[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [isMobile, setIsMobile] = useState(false);

  const exampleQuestions = [
    "Can they assign from home standby into a trip that touches my days off?",
    "What are the contactability rules for RPH (home standby) the day before reserve?",
    "Do I keep trip ownership if my long-haul trip is disrupted and I am reassigned?",
    "In what order is open time allocated and who gets priority?",
    "How is TASS discharged and can TASS be put on my days off?",
    "What rest must I get between a long-haul trip and the next reserve day?"
  ];

  useEffect(() => {
    if (typeof window === "undefined") return;

    const check = () => {
      setIsMobile(window.innerWidth < 640);
    };

    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(ACCESS_STORAGE_KEY);
    if (stored === "granted") {
      setAuthorised(true);
    }
  }, []);

  const handleCodeSubmit = () => {
    const trimmed = codeInput.trim();
    if (!trimmed) {
      setCodeError("Please enter your access code.");
      return;
    }
    if (trimmed === ACCESS_CODE) {
      setAuthorised(true);
      setCodeError(null);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(ACCESS_STORAGE_KEY, "granted");
      }
    } else {
      setCodeError("That code is not recognised.");
    }
  };

  const handleCodeKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleCodeSubmit();
    }
  };

  // Core "ask with a specific query" function – used for normal sends + chips
  const askDirect = async (rawQuery: string) => {
    if (!rawQuery.trim() || loading) return;
    const currentQuestion = rawQuery.trim();

    setLoading(true);
    setError(null);

    try {
      // Only send compact history (question + answer) to keep tokens down
      const compactHistory = history.map((h) => ({
        question: h.question,
        answer: h.answer
      }));

      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: currentQuestion,
          history: compactHistory
        })
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        setError(
          data.error ||
            "Something went wrong talking to BidlineBuddy. Please try again."
        );
      } else {
        const answer: string =
          typeof data.answer === "string"
            ? data.answer
            : "No answer was returned.";

        const sources: SourceChunk[] = Array.isArray(data.chunks)
          ? data.chunks
          : [];

        const confidenceTagRaw =
          typeof data.confidenceTag === "string"
            ? data.confidenceTag.toLowerCase()
            : "unknown";
        const confidenceTag: ConfidenceTag =
          confidenceTagRaw === "high" ||
          confidenceTagRaw === "medium" ||
          confidenceTagRaw === "low"
            ? confidenceTagRaw
            : "unknown";

        setHistory((prev) => [
          ...prev,
          {
            id: prev.length + 1,
            question: currentQuestion,
            answer,
            sources,
            feedback: null,
            confidenceTag
          }
        ]);
        setQuestion("");
      }
    } catch (e) {
      setError("Network error talking to BidlineBuddy.");
    } finally {
      setLoading(false);
    }
  };

  const ask = () => {
    if (!question.trim() || loading) return;
    void askDirect(question);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      ask();
    }
  };

  const handleExampleClick = (q: string) => {
    // Auto-send example questions to feel conversational
    void askDirect(q);
  };

  const copyScript = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
  };

  const handleFollowupClick = (followup: string) => {
    // Treat follow-up as a new turn but with conversation history
    void askDirect(followup);
  };

  const handleFeedback = (id: number, value: "yes" | "no") => {
    setHistory((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, feedback: value } : item
      )
    );

    // If "Not quite", pre-fill a follow-up prompt for the pilot to send
    if (value === "no") {
      const target = history.find((h) => h.id === id);
      if (target) {
        const followup =
          target.question +
          " Can you tighten this answer and focus on any edge cases or grey areas that might apply to me?";
        setQuestion(followup);
      }
    }
  };

  // Build compact source summary string like: "BLR Feb 2025 (p.104, p.117); BASC 2022 (p.17)"
  function summariseSources(sources: SourceChunk[]): string {
    if (!sources || sources.length === 0) return "No specific pages quoted.";

    const map: Record<string, Set<string>> = {};

    for (const s of sources) {
      const key = s.source || "Unknown source";
      if (!map[key]) map[key] = new Set<string>();
      if (s.page) map[key].add(s.page);
    }

    const parts: string[] = [];

    for (const [source, pagesSet] of Object.entries(map)) {
      const pages = Array.from(pagesSet);
      if (pages.length === 0) {
        parts.push(source);
      } else {
        parts.push(`${source} (${pages.join(", ")})`);
      }
    }

    return parts.join("; ");
  }

  // ⛔ Access gate
  if (!authorised) {
    return (
      <main
        style={{
          minHeight: "100vh",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          padding: isMobile ? "12px" : "24px",
          background:
            "radial-gradient(circle at top, #011b3a 0, #001326 35%, #020617 100%)",
          fontFamily:
            "system-ui, -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif"
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 420,
            borderRadius: isMobile ? 20 : 28,
            padding: isMobile ? 18 : 24,
            boxShadow: isMobile
              ? "0 10px 25px rgba(15,23,42,0.6)"
              : "0 20px 45px rgba(15, 23, 42, 0.5), 0 0 0 1px rgba(148, 163, 184, 0.35)",
            background:
              "linear-gradient(135deg, #020617 0%, #020617 32%, #0b1220 100%)",
            color: "#e5e7eb"
          }}
        >
          <div
            style={{
              height: 3,
              borderRadius: 4,
              background: "linear-gradient(90deg, #b91c1c, #ef4444)",
              marginBottom: 16
            }}
          />
          <h1
            style={{
              fontSize: isMobile ? 22 : 24,
              fontWeight: 700,
              letterSpacing: -0.5,
              marginBottom: 2,
              color: "#f9fafb"
            }}
          >
            BidlineBuddy
          </h1>
          <p
            style={{
              fontSize: 13,
              color: "#9ca3af",
              marginBottom: 16
            }}
          >
            Private beta access for BA pilots. Enter your access code to unlock
            BLR / BASC search.
          </p>

          <label
            style={{
              display: "block",
              fontSize: 12,
              color: "#d1d5db",
              marginBottom: 6
            }}
          >
            Access code
          </label>
          <input
            type="password"
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value)}
            onKeyDown={handleCodeKeyDown}
            placeholder="Enter the code you were given"
            style={{
              width: "100%",
              borderRadius: 999,
              border: "1px solid rgba(148,163,184,0.7)",
              padding: "9px 12px",
              fontSize: 14,
              boxSizing: "border-box",
              outline: "none",
              backgroundColor: "rgba(15,23,42,0.95)",
              color: "#e5e7eb",
              marginBottom: 10
            }}
          />

          {codeError && (
            <div
              style={{
                fontSize: 12,
                color: "#fecaca",
                marginBottom: 10
              }}
            >
              {codeError}
            </div>
          )}

          <button
            type="button"
            onClick={handleCodeSubmit}
            style={{
              width: "100%",
              borderRadius: 999,
              padding: "9px 18px",
              border: "none",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
              background: "linear-gradient(135deg, #b91c1c, #1d4ed8)",
              color: "#f9fafb",
              boxShadow: "0 10px 24px rgba(37, 99, 235, 0.6)",
              marginBottom: 8
            }}
          >
            Unlock BidlineBuddy
          </button>

          <p
            style={{
              fontSize: 11,
              color: "#9ca3af",
              marginTop: 4
            }}
          >
            If you don&apos;t have a code, please contact the person who shared
            BidlineBuddy with you.
          </p>
        </div>
      </main>
    );
  }

  // ✅ Main app once authorised
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        justifyContent: "center",
        padding: isMobile ? "12px" : "24px",
        background:
          "radial-gradient(circle at top, #011b3a 0, #001326 35%, #020617 100%)",
        fontFamily:
          "system-ui, -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif"
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 900,
          display: "flex",
          flexDirection: "column",
          borderRadius: isMobile ? 18 : 28,
          padding: isMobile ? 16 : 24,
          boxShadow: isMobile
            ? "0 10px 25px rgba(15,23,42,0.6)"
            : "0 20px 45px rgba(15, 23, 42, 0.5), 0 0 0 1px rgba(148, 163, 184, 0.35)",
          background:
            "linear-gradient(135deg, #020617 0%, #020617 32%, #0b1220 100%)",
          color: "#e5e7eb"
        }}
      >
        {/* BA red accent bar */}
        <div
          style={{
            height: 3,
            borderRadius: 4,
            background: "linear-gradient(90deg, #b91c1c, #ef4444)",
            marginBottom: 12
          }}
        />

        {/* Header */}
        <header style={{ marginBottom: isMobile ? 12 : 16 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              alignItems: isMobile ? "flex-start" : "center",
              flexDirection: isMobile ? "column" : "row"
            }}
          >
            <div>
              <h1
                style={{
                  fontSize: isMobile ? 24 : 26,
                  fontWeight: 700,
                  letterSpacing: -0.5,
                  marginBottom: 2,
                  color: "#f9fafb"
                }}
              >
                BidlineBuddy
              </h1>
              <p
                style={{
                  color: "#9ca3af",
                  fontSize: 13,
                  maxWidth: 640
                }}
              >
                BLR &amp; BASC copilot for BA pilots. Ask in plain English and
                BidlineBuddy will quote the rules, highlight grey areas, and
                suggest what to say to Global Ops. For anything unusual or
                career-critical, always confirm with BASC.
              </p>
            </div>
            <div
              style={{
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: 1,
                color: "#e5e7eb",
                borderRadius: 999,
                border: "1px solid rgba(239, 68, 68, 0.8)",
                padding: "4px 10px",
                whiteSpace: "nowrap",
                background:
                  "linear-gradient(135deg, rgba(239,68,68,0.15), rgba(15,23,42,0.9))"
              }}
            >
              Private beta · v0.3
            </div>
          </div>
        </header>

        {/* Example questions */}
        <section style={{ marginBottom: 14 }}>
          <p
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: "#9ca3af",
              marginBottom: 6
            }}
          >
            Quick starts:
          </p>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8
            }}
          >
            {exampleQuestions.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => handleExampleClick(q)}
                style={{
                  borderRadius: 999,
                  border: "1px solid rgba(148, 163, 184, 0.4)",
                  padding: "6px 10px",
                  fontSize: 11,
                  backgroundColor: "rgba(15, 23, 42, 0.8)",
                  cursor: "pointer",
                  color: "#e5e7eb",
                  whiteSpace: "nowrap"
                }}
              >
                {q}
              </button>
            ))}
          </div>
        </section>

        {/* Conversation area */}
        <section
          style={{
            flex: 1,
            minHeight: isMobile ? 260 : 220,
            maxHeight: isMobile ? "70vh" : "55vh",
            overflowY: "auto",
            padding: "12px 4px",
            borderRadius: 18,
            background:
              "linear-gradient(135deg, rgba(15,23,42,0.9), rgba(15,23,42,0.6))",
            border: "1px solid rgba(148, 163, 184, 0.5)",
            marginBottom: 16
          }}
        >
          {history.length === 0 && (
            <div
              style={{
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#6b7280",
                fontSize: 14,
                textAlign: "center",
                padding: "0 16px"
              }}
            >
              Ask your first question about TASS, reserve, disruption, open
              time, or trip ownership. Press Enter to send.
            </div>
          )}

          {history.map((item) => {
            const confidence = getConfidence(
              item.sources,
              item.confidenceTag
            );
            const followups = getFollowups(item.question);
            const parsed = parseAnswer(item.answer);
            const sourcesSummary = summariseSources(item.sources);

            return (
              <div key={item.id} style={{ marginBottom: 18 }}>
                {/* Pilot question bubble */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    marginBottom: 4
                  }}
                >
                  <div
                    style={{
                      maxWidth: "85%",
                      borderRadius: 18,
                      padding: "8px 12px",
                      background:
                        "linear-gradient(135deg, #0b1120, #1d4ed8)",
                      color: "#f9fafb",
                      fontSize: 14,
                      whiteSpace: "pre-wrap",
                      boxShadow: "0 12px 24px rgba(15, 23, 42, 0.7)"
                    }}
                  >
                    {item.question}
                  </div>
                </div>

                {/* BidlineBuddy answer bubble */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "flex-start"
                  }}
                >
                  <div
                    style={{
                      maxWidth: "100%",
                      borderRadius: 18,
                      padding: "10px 12px",
                      background:
                        "linear-gradient(135deg, #020617, #020617)",
                      border: "1px solid rgba(148, 163, 184, 0.5)",
                      fontSize: 14,
                      color: "#e5e7eb",
                      whiteSpace: "pre-wrap",
                      position: "relative",
                      boxShadow: "0 12px 28px rgba(15, 23, 42, 0.8)"
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: 6
                      }}
                    >
                      <div
                        style={{
                          fontSize: 11,
                          textTransform: "uppercase",
                          letterSpacing: 0.08,
                          color: "#9ca3af",
                          fontWeight: 600
                        }}
                      >
                        BidlineBuddy
                      </div>
                      <span
                        style={{
                          fontSize: 11,
                          padding: "2px 8px",
                          borderRadius: 999,
                          border: `1px solid ${confidence.color}`,
                          color: confidence.color,
                          backgroundColor: "rgba(15,23,42,0.9)"
                        }}
                      >
                        {confidence.label}
                      </span>
                    </div>

                    {/* TL;DR */}
                    <div
                      style={{
                        marginBottom: 8,
                        padding: "6px 8px",
                        borderRadius: 10,
                        backgroundColor: "rgba(15,23,42,0.9)",
                        border: "1px solid rgba(59,130,246,0.5)"
                      }}
                    >
                      <div
                        style={{
                          fontSize: 11,
                          textTransform: "uppercase",
                          letterSpacing: 0.08,
                          color: "#93c5fd",
                          marginBottom: 2,
                          fontWeight: 600
                        }}
                      >
                        TL;DR
                      </div>
                      <div
                        style={{
                          fontSize: 13,
                          color: "#e5e7eb"
                        }}
                      >
                        {parsed.tldr}
                      </div>
                    </div>

                    {/* What the rules say (compact but always visible) */}
                    {parsed.rules.length > 0 && (
                      <div style={{ marginBottom: 6 }}>
                        <div
                          style={{
                            fontSize: 11,
                            textTransform: "uppercase",
                            letterSpacing: 0.08,
                            color: "#9ca3af",
                            marginBottom: 2,
                            fontWeight: 600
                          }}
                        >
                          What the rules say
                        </div>
                        <ul
                          style={{
                            paddingLeft: 18,
                            margin: 0,
                            listStyle: "disc",
                            fontSize: 13,
                            color: "#e5e7eb"
                          }}
                        >
                          {parsed.rules.map((r, idx) => (
                            <li key={idx}>{r}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Gaps / grey area */}
                    {parsed.gaps.length > 0 && (
                      <div style={{ marginBottom: 6 }}>
                        <div
                          style={{
                            fontSize: 11,
                            textTransform: "uppercase",
                            letterSpacing: 0.08,
                            color: "#fbbf24",
                            marginBottom: 2,
                            fontWeight: 600
                          }}
                        >
                          What the rules don&apos;t say / grey area
                        </div>
                        <ul
                          style={{
                            paddingLeft: 18,
                            margin: 0,
                            listStyle: "disc",
                            fontSize: 13,
                            color: "#e5e7eb"
                          }}
                        >
                          {parsed.gaps.map((g, idx) => (
                            <li key={idx}>{g}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Operational steer */}
                    {parsed.pragmatic.length > 0 && (
                      <div style={{ marginBottom: 8 }}>
                        <div
                          style={{
                            fontSize: 11,
                            textTransform: "uppercase",
                            letterSpacing: 0.08,
                            color: "#93c5fd",
                            marginBottom: 2,
                            fontWeight: 600
                          }}
                        >
                          Operational steer (not official advice)
                        </div>
                        <ul
                          style={{
                            paddingLeft: 18,
                            margin: 0,
                            listStyle: "disc",
                            fontSize: 13,
                            color: "#e5e7eb"
                          }}
                        >
                          {parsed.pragmatic.map((p, idx) => (
                            <li key={idx}>{p}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Script for Global Ops */}
                    <div
                      style={{
                        marginTop: 4,
                        padding: "6px 8px",
                        borderRadius: 10,
                        backgroundColor: "rgba(15,23,42,0.9)",
                        border: "1px solid rgba(148,163,184,0.7)"
                      }}
                    >
                      <div
                        style={{
                          fontSize: 11,
                          textTransform: "uppercase",
                          letterSpacing: 0.08,
                          color: "#9ca3af",
                          marginBottom: 2,
                          fontWeight: 600
                        }}
                      >
                        What to say to Global Ops
                      </div>
                      <div
                        style={{
                          fontSize: 13,
                          color: "#e5e7eb",
                          whiteSpace: "pre-wrap"
                        }}
                      >
                        {parsed.script}
                      </div>
                    </div>

                    {/* Confidence detail */}
                    <div
                      style={{
                        marginTop: 6,
                        fontSize: 11,
                        color: "#9ca3af"
                      }}
                    >
                      {confidence.detail}
                    </div>

                    {/* Sources summary */}
                    {item.sources && item.sources.length > 0 && (
                      <div
                        style={{
                          marginTop: 8,
                          paddingTop: 6,
                          borderTop: "1px solid rgba(31, 41, 55, 0.9)",
                          fontSize: 11,
                          color: "#9ca3af"
                        }}
                      >
                        <span
                          style={{
                            textTransform: "uppercase",
                            letterSpacing: 0.08,
                            fontWeight: 600
                          }}
                        >
                          Sources:
                        </span>{" "}
                        {sourcesSummary}
                      </div>
                    )}

                    {/* Follow-up suggestions */}
                    <div
                      style={{
                        marginTop: 8,
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 6
                      }}
                    >
                      {followups.map((f) => (
                        <button
                          key={f}
                          type="button"
                          onClick={() => handleFollowupClick(f)}
                          style={{
                            borderRadius: 999,
                            border: "1px solid rgba(148, 163, 184, 0.6)",
                            padding: "4px 9px",
                            fontSize: 11,
                            cursor: "pointer",
                            backgroundColor: "rgba(15,23,42,0.9)",
                            color: "#e5e7eb"
                          }}
                        >
                          {f}
                        </button>
                      ))}
                    </div>

                    {/* Copy + feedback row */}
                    <div
                      style={{
                        marginTop: 8,
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 8,
                        flexWrap: "wrap"
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => copyScript(parsed.script)}
                        style={{
                          borderRadius: 999,
                          border: "1px solid rgba(148, 163, 184, 0.6)",
                          padding: "4px 10px",
                          fontSize: 11,
                          cursor: "pointer",
                          backgroundColor: "rgba(15,23,42,0.9)",
                          color: "#e5e7eb"
                        }}
                      >
                        Copy script for Global Ops
                      </button>

                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          fontSize: 11,
                          color: "#9ca3af"
                        }}
                      >
                        {item.feedback == null ? (
                          <>
                            <span>Was this helpful?</span>
                            <button
                              type="button"
                              onClick={() => handleFeedback(item.id, "yes")}
                              style={{
                                borderRadius: 999,
                                border: "1px solid rgba(34,197,94,0.6)",
                                padding: "3px 8px",
                                fontSize: 11,
                                cursor: "pointer",
                                backgroundColor: "rgba(22,163,74,0.15)",
                                color: "#bbf7d0"
                              }}
                            >
                              👍 Yes
                            </button>
                            <button
                              type="button"
                              onClick={() => handleFeedback(item.id, "no")}
                              style={{
                                borderRadius: 999,
                                border: "1px solid rgba(248,113,113,0.6)",
                                padding: "3px 8px",
                                fontSize: 11,
                                cursor: "pointer",
                                backgroundColor: "rgba(248,113,113,0.12)",
                                color: "#fecaca"
                              }}
                            >
                              👎 Not quite
                            </button>
                          </>
                        ) : (
                          <span style={{ color: "#a3e635" }}>
                            Thanks for the feedback.
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {loading && (
            <div
              style={{
                marginTop: 8,
                fontSize: 12,
                color: "#9ca3af",
                display: "flex",
                alignItems: "center",
                gap: 6
              }}
            >
              <span>BidlineBuddy is thinking</span>
              <span
                style={{
                  display: "inline-block",
                  width: 24,
                  textAlign: "left"
                }}
              >
                . . .
              </span>
            </div>
          )}
        </section>

        {/* Error message */}
        {error && (
          <div
            style={{
              marginBottom: 8,
              fontSize: 13,
              color: "#fecaca",
              backgroundColor: "rgba(153,27,27,0.25)",
              borderRadius: 10,
              padding: "6px 8px",
              border: "1px solid rgba(248,113,113,0.6)"
            }}
          >
            {error}
          </div>
        )}

        {/* Input area */}
        <section>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8
            }}
          >
            <textarea
              rows={isMobile ? 4 : 3}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                loading
                  ? "Working on your last question…"
                  : "Ask BidlineBuddy anything about BLR / BASC. Press Enter to send, Shift+Enter for a new line."
              }
              style={{
                width: "100%",
                resize: "none",
                borderRadius: 16,
                border: "1px solid rgba(148,163,184,0.7)",
                padding: 10,
                fontSize: 14,
                boxSizing: "border-box",
                outline: "none",
                backgroundColor: "rgba(15,23,42,0.95)",
                color: "#e5e7eb",
                boxShadow: "inset 0 0 0 1px rgba(15,23,42,0.9)"
              }}
            />

            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap"
              }}
            >
              <button
                type="button"
                onClick={ask}
                disabled={loading || !question.trim()}
                style={{
                  borderRadius: 999,
                  padding: "8px 18px",
                  border: "none",
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: loading || !question.trim() ? "default" : "pointer",
                  background:
                    loading || !question.trim()
                      ? "#1f2937"
                      : "linear-gradient(135deg, #b91c1c, #1d4ed8)",
                  color: "#f9fafb",
                  boxShadow:
                    loading || !question.trim()
                      ? "none"
                      : "0 10px 24px rgba(37, 99, 235, 0.6)"
                }}
              >
                {loading ? "Thinking…" : "Ask BidlineBuddy"}
              </button>
            </div>
          </div>
        </section>

        {/* Disclaimer bar */}
        <div
          style={{
            marginTop: 10,
            fontSize: 11,
            color: "#9ca3af",
            padding: "6px 8px",
            borderRadius: 10,
            backgroundColor: "rgba(15,23,42,0.9)",
            border: "1px solid rgba(31,41,55,0.9)"
          }}
        >
          BidlineBuddy summarises BLR Feb 2025 and BASC 2022. It is not
          official advice. Always confirm anything unusual or
          career-critical with BASC / Scheduling.
        </div>
      </div>
    </main>
  );
}
