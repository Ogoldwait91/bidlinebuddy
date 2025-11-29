"use client";

import { useState } from "react";

type SourceChunk = {
  source?: string;
  page?: string;
  section?: string | null;
  similarity?: number | null;
};

type QAPair = {
  id: number;
  question: string;
  answer: string;
  sources: SourceChunk[];
  feedback?: "yes" | "no" | null;
};

function getConfidence(sources: SourceChunk[]) {
  if (!sources || sources.length === 0) {
    return {
      label: "Unknown",
      color: "#94a3b8",
      detail: "No matching rules were found above the similarity threshold."
    };
  }

  const sims = sources
    .map((s) => (typeof s.similarity === "number" ? s.similarity : null))
    .filter((v): v is number => v !== null);

  if (sims.length === 0) {
    return {
      label: "Unknown",
      color: "#94a3b8",
      detail: "Similarity scores are not available for these matches."
    };
  }

  const maxSim = Math.max(...sims);

  if (maxSim >= 0.8) {
    return {
      label: "High confidence",
      color: "#16a34a",
      detail:
        "The answer is based on rules that are a very strong match to your question."
    };
  } else if (maxSim >= 0.65) {
    return {
      label: "Medium confidence",
      color: "#eab308",
      detail:
        "The answer is based on reasonably relevant rules, but you should still double-check with BASC for edge cases."
    };
  } else {
    return {
      label: "Low confidence",
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

  if (q.includes("ownership") || q.includes("owned trip") || q.includes("trip buying")) {
    return [
      "When do I lose trip ownership?",
      "How does trip buying interact with disruption?",
      "Can my owned trip be removed for reserve or standby?"
    ];
  }

  if (q.includes("open time") || q.includes("open-time") || q.includes("open time")) {
    return [
      "In what order is open time allocated?",
      "Can open time be used to replace a standby duty?",
      "How does open time interact with TASS or reserve?"
    ];
  }

  // default generic
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
      line.toLowerCase().startsWith("4) pragmatic view (not official advice")
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
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState<QAPair[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const exampleQuestions = [
    "Can they assign into my TASS if it makes my next trip clash?",
    "What are the reserve contactability rules after a night stop?",
    "Do I keep trip ownership if I am taken for disruption?",
    "Can open time be used to replace my standby?"
  ];

  const ask = async () => {
    if (!question.trim() || loading) return;
    const currentQuestion = question.trim();

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: currentQuestion })
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        setError(
          data.error ||
            "Something went wrong contacting BidlineBuddy. Please try again."
        );
      } else {
        const answer: string =
          typeof data.answer === "string"
            ? data.answer
            : "No answer was returned.";

        const sources: SourceChunk[] = Array.isArray(data.chunks)
          ? data.chunks
          : [];

        setHistory((prev) => [
          ...prev,
          {
            id: prev.length + 1,
            question: currentQuestion,
            answer,
            sources,
            feedback: null
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      ask();
    }
  };

  const handleExampleClick = (q: string) => {
    setQuestion(q);
  };

  const copyScript = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
  };

  const handleFollowupClick = (followup: string) => {
    // NEW: replace the question with the follow-up only
    setQuestion(followup);
  };

  const handleFeedback = (id: number, value: "yes" | "no") => {
    setHistory((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, feedback: value } : item
      )
    );
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        justifyContent: "center",
        padding: "24px",
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
          borderRadius: 28,
          padding: 24,
          boxShadow:
            "0 20px 45px rgba(15, 23, 42, 0.5), 0 0 0 1px rgba(148, 163, 184, 0.35)",
          background:
            "linear-gradient(135deg, #020617 0%, #020617 32%, #0b1220 100%)",
          color: "#e5e7eb"
        }}
      >
        {/* BA red accent bar */}
        <div
          style={{
            height: 3,
            borderRadius: 999,
            background: "linear-gradient(90deg, #b91c1c, #ef4444)",
            marginBottom: 12
          }}
        />

        {/* Header */}
        <header style={{ marginBottom: 16 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              alignItems: "center"
            }}
          >
            <div>
              <h1
                style={{
                  fontSize: 26,
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
                Your conversational assistant for BA Bidline Rules and BASC
                guides. Ask in plain English; BidlineBuddy will quote the
                documents and suggest what to say to Global Ops. For anything
                unusual or career-critical, always confirm with BASC.
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
              BLR Feb 2025 · BASC 2022
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
            Try asking:
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
                  padding: "5px 10px",
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
            minHeight: 220,
            maxHeight: "55vh",
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
            const confidence = getConfidence(item.sources);
            const followups = getFollowups(item.question);
            const parsed = parseAnswer(item.answer);

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
                      maxWidth: "80%",
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
                      maxWidth: "85%",
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

                    {/* What the rules say */}
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
                          What the rules don’t say / grey area
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

                    {/* Pragmatic view */}
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
                          Pragmatic view (not official advice)
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

                    {/* Sources */}
                    {item.sources && item.sources.length > 0 && (
                      <div
                        style={{
                          marginTop: 8,
                          paddingTop: 6,
                          borderTop: "1px solid rgba(31, 41, 55, 0.9)"
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
                          Sources used
                        </div>
                        <ul
                          style={{
                            paddingLeft: 18,
                            margin: 0,
                            listStyle: "disc",
                            fontSize: 12,
                            color: "#e5e7eb"
                          }}
                        >
                          {item.sources.map((s, idx) => (
                            <li key={idx}>
                              {s.source || "Unknown source"}
                              {s.page ? ` – ${s.page}` : ""}
                              {s.section ? ` – ${s.section}` : ""}
                            </li>
                          ))}
                        </ul>
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
                color: "#9ca3af"
              }}
            >
              BidlineBuddy is thinking…
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
              rows={3}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                loading
                  ? "Hold on, I am working on your last question…"
                  : "Ask BidlineBuddy anything about BLR/BASC. Press Enter to send, Shift+Enter for a new line."
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
              <span
                style={{
                  fontSize: 11,
                  color: "#9ca3af"
                }}
              >
                BidlineBuddy summarises BLR Feb 2025 + BASC 2022. Always confirm
                anything unusual with BASC / Scheduling.
              </span>

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
      </div>
    </main>
  );
}
