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

const ACCESS_CODE = "BIDLINE2025";
const ACCESS_STORAGE_KEY = "bidlinebuddy_access_v1";

function getConfidence(
  sources: SourceChunk[],
  tag?: ConfidenceTag
): { label: string; color: string; detail: string } {
  if (tag === "high") {
    return {
      label: "Strong rule support",
      color: "#16a34a",
      detail:
        "BidlineBuddy believes the quoted rules clearly cover this scenario. Still confirm anything unusual with BASC."
    };
  }
  if (tag === "medium") {
    return {
      label: "Rules partly support",
      color: "#eab308",
      detail:
        "The rules look relevant but there may be caveats or grey areas. Treat this as a strong steer and confirm with BASC if in doubt."
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
};

function parseAnswer(answer: string): ParsedAnswer {
  const lines = answer.split(/\r?\n/).map((l) => l.trim());
  const result: ParsedAnswer = {
    tldr: "",
    rules: [],
    gaps: [],
    pragmatic: []
  };

  let section: "none" | "tldr" | "rules" | "gaps" | "pragmatic" = "none";

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
      line.toLowerCase().startsWith("4) operational steer") ||
      line.toLowerCase().startsWith("4) pragmatic view") ||
      line
        .toLowerCase()
        .startsWith("4) pragmatic view (not official advice")
    ) {
      section = "pragmatic";
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
      default:
        break;
    }
  }

  if (!result.tldr) {
    result.tldr = answer.split(/\r?\n/)[0] || "";
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

  const ask = async (overrideQuestion?: string) => {
    if ((!question.trim() && !overrideQuestion) || loading) return;
    const currentQuestion = (overrideQuestion ?? question).trim();
    if (!currentQuestion) return;

    setLoading(true);
    setError(null);

    try {
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      ask();
    }
  };

  const handleExampleClick = (q: string) => {
    setQuestion(q);
  };

  const copyText = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
  };

  const handleFollowupClick = (followup: string) => {
    ask(followup);
  };

  const handleFeedback = (id: number, value: "yes" | "no") => {
    setHistory((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, feedback: value } : item
      )
    );
  };

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
            borderRadius: isMobile ? 20 : 24,
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
              height: 2,
              borderRadius: 2,
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
              fontSize: 12,
              color: "#9ca3af",
              marginBottom: 14
            }}
          >
            BA Bidline Rules &amp; BASC guidance — explained clearly with page
            references. Private beta – access code required.
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

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: isMobile ? "10px" : "20px",
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
          borderRadius: isMobile ? 18 : 24,
          padding: isMobile ? 14 : 20,
          margin: isMobile ? "0 -8px" : "0 auto",
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
            height: 2,
            borderRadius: 2,
            background: "linear-gradient(90deg, #b91c1c, #ef4444)",
            marginBottom: 10
          }}
        />

        {/* Header */}
        <header style={{ marginBottom: isMobile ? 10 : 14 }}>
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
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 2
                }}
              >
                {/* Simple "logo" mark */}
                <div
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 999,
                    border: "1px solid rgba(148,163,184,0.7)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 10,
                    fontWeight: 700,
                    color: "#e5e7eb",
                    background:
                      "linear-gradient(135deg, rgba(15,23,42,0.9), rgba(30,64,175,0.9))"
                  }}
                >
                  BB
                </div>
                <h1
                  style={{
                    fontSize: isMobile ? 20 : 22,
                    fontWeight: 700,
                    letterSpacing: -0.4,
                    color: "#f9fafb",
                    margin: 0
                  }}
                >
                  BidlineBuddy
                </h1>
              </div>
              <p
                style={{
                  color: "#9ca3af",
                  fontSize: 12,
                  maxWidth: 640,
                  margin: 0
                }}
              >
                BA Bidline Rules &amp; BASC guidance — explained clearly with
                page references. Ask in plain English; BidlineBuddy will surface
                relevant rules and highlight any grey areas. Always confirm
                anything unusual or career-critical with BASC / Scheduling.
              </p>
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: isMobile ? "flex-start" : "flex-end",
                gap: 4
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                  color: "#e5e7eb",
                  borderRadius: 999,
                  border: "1px solid rgba(239, 68, 68, 0.8)",
                  padding: "3px 10px",
                  whiteSpace: "nowrap",
                  background:
                    "linear-gradient(135deg, rgba(239,68,68,0.18), rgba(15,23,42,0.9))"
                }}
              >
                Private beta · v0.3
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "#9ca3af"
                }}
              >
                BLR Feb 2025 · BASC 2022
              </div>
            </div>
          </div>
        </header>

        {/* Example questions */}
        <section style={{ marginBottom: 12 }}>
          <p
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: "#9ca3af",
              marginBottom: 6
            }}
          >
            Quick questions pilots often ask:
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
            minHeight: isMobile ? 240 : 220,
            maxHeight: isMobile ? "none" : "55vh",
            overflowY: isMobile ? "visible" : "auto",
            padding: "10px 4px",
            borderRadius: 16,
            background:
              "linear-gradient(135deg, rgba(15,23,42,0.9), rgba(15,23,42,0.6))",
            border: "1px solid rgba(148, 163, 184, 0.5)",
            marginBottom: 14
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
              Ask your first question about TASS, reserve contactability,
              disruption, open time or trip ownership. Press Enter to send.
            </div>
          )}

          {history.map((item) => {
            const confidence = getConfidence(
              item.sources,
              item.confidenceTag
            );
            const followups = getFollowups(item.question);
            const parsed = parseAnswer(item.answer);

            return (
              <div key={item.id} style={{ marginBottom: 14 }}>
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
                      borderRadius: 16,
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
                      borderRadius: 16,
                      padding: "9px 11px",
                      background:
                        "linear-gradient(135deg, #020617, #020617)",
                      border: "1px solid rgba(148, 163, 184, 0.4)",
                      fontSize: 14,
                      color: "#e5e7eb",
                      whiteSpace: "pre-wrap",
                      position: "relative",
                      boxShadow: "0 10px 24px rgba(15, 23, 42, 0.8)"
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: 4
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

                    {/* Quick summary (TL;DR) */}
                    <div
                      style={{
                        marginBottom: 6,
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
                        Quick summary
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

                    {/* Rule detail – collapsible */}
                    {parsed.rules.length > 0 && (
                      <details
                        style={{
                          marginBottom: 4
                        }}
                      >
                        <summary
                          style={{
                            fontSize: 12,
                            color: "#9ca3af",
                            cursor: "pointer",
                            listStyle: "none",
                            display: "flex",
                            alignItems: "center",
                            gap: 6
                          }}
                        >
                          <span
                            style={{
                              fontSize: 10,
                              borderRadius: 999,
                              border: "1px solid rgba(148,163,184,0.7)",
                              padding: "1px 6px",
                              textTransform: "uppercase"
                            }}
                          >
                            Rules
                          </span>
                          <span>View rules that apply</span>
                        </summary>
                        <ul
                          style={{
                            paddingLeft: 16,
                            marginTop: 6,
                            listStyle: "disc",
                            fontSize: 13,
                            color: "#e5e7eb"
                          }}
                        >
                          {parsed.rules.map((r, idx) => (
                            <li key={idx}>{r}</li>
                          ))}
                        </ul>
                      </details>
                    )}

                    {/* Grey area – collapsible */}
                    {parsed.gaps.length > 0 && (
                      <details
                        style={{
                          marginBottom: 6
                        }}
                      >
                        <summary
                          style={{
                            fontSize: 12,
                            color: "#facc15",
                            cursor: "pointer",
                            listStyle: "none",
                            display: "flex",
                            alignItems: "center",
                            gap: 6
                          }}
                        >
                          <span
                            style={{
                              fontSize: 10,
                              borderRadius: 999,
                              border: "1px solid rgba(250,204,21,0.8)",
                              padding: "1px 6px",
                              textTransform: "uppercase"
                            }}
                          >
                            Grey area
                          </span>
                          <span>View what isn&apos;t covered</span>
                        </summary>
                        <ul
                          style={{
                            paddingLeft: 16,
                            marginTop: 6,
                            listStyle: "disc",
                            fontSize: 13,
                            color: "#e5e7eb"
                          }}
                        >
                          {parsed.gaps.map((g, idx) => (
                            <li key={idx}>{g}</li>
                          ))}
                        </ul>
                      </details>
                    )}

                    {/* Operational considerations */}
                    {parsed.pragmatic.length > 0 && (
                      <div style={{ marginBottom: 6 }}>
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
                          Operational considerations (not official advice)
                        </div>
                        <ul
                          style={{
                            paddingLeft: 16,
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

                    {/* Confidence detail */}
                    <div
                      style={{
                        marginTop: 5,
                        fontSize: 11,
                        color: "#9ca3af"
                      }}
                    >
                      {confidence.detail}
                    </div>

                    {/* Compact sources */}
                    {item.sources && item.sources.length > 0 && (
                      <div
                        style={{
                          marginTop: 6,
                          fontSize: 11,
                          color: "#9ca3af"
                        }}
                      >
                        <span style={{ fontWeight: 600 }}>Sources:&nbsp;</span>
                        {(() => {
                          const labels = item.sources.map((s) => {
                            const parts: string[] = [];
                            if (s.source) parts.push(s.source);
                            if (s.page) parts.push(s.page);
                            if (s.section) parts.push(s.section);
                            return parts.join(" ");
                          });
                          const unique = Array.from(new Set(labels));
                          return unique
                            .filter((l) => l)
                            .map((l, idx) => (
                              <span
                                key={idx}
                                style={{
                                  display: "inline-block",
                                  borderRadius: 999,
                                  border:
                                    "1px solid rgba(148,163,184,0.7)",
                                  padding: "1px 6px",
                                  marginRight: 4,
                                  marginBottom: 2
                                }}
                              >
                                {l}
                              </span>
                            ));
                        })()}
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
                            color: "#e5e7eb",
                            display: "flex",
                            alignItems: "center",
                            gap: 4
                          }}
                        >
                          <span>{f}</span>
                          <span style={{ fontSize: 10 }}>↗</span>
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
                        onClick={() => copyText(item.answer)}
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
                        Copy answer
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
                marginTop: 4,
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
                  display: "inline-flex",
                  gap: 3
                }}
              >
                <span
                  style={{
                    width: 4,
                    height: 4,
                    borderRadius: 999,
                    backgroundColor: "#9ca3af",
                    opacity: 0.7
                  }}
                />
                <span
                  style={{
                    width: 4,
                    height: 4,
                    borderRadius: 999,
                    backgroundColor: "#9ca3af",
                    opacity: 0.7
                  }}
                />
                <span
                  style={{
                    width: 4,
                    height: 4,
                    borderRadius: 999,
                    backgroundColor: "#9ca3af",
                    opacity: 0.7
                  }}
                />
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
                  : "Ask about TASS, reserve, disruption, open time, ownership, etc. Press Enter to send, Shift+Enter for a new line."
              }
              style={{
                width: "100%",
                resize: "none",
                borderRadius: 14,
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
                onClick={() => ask()}
                disabled={loading || !question.trim()}
                style={{
                  borderRadius: 999,
                  padding: isMobile ? "8px 14px" : "7px 16px",
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
                      : "0 8px 20px rgba(37, 99, 235, 0.6)"
                }}
              >
                {loading ? "Thinking…" : "Ask BidlineBuddy"}
              </button>
            </div>
          </div>
        </section>
      </div>

      {/* Footer disclaimer bar */}
      <div
        style={{
          marginTop: 10,
          fontSize: 11,
          color: "#9ca3af",
          textAlign: "center",
          maxWidth: 900
        }}
      >
        BidlineBuddy is an unofficial tool created by a BA pilot. It does not replace BLR / BASC, the FOM or advice from BASC, Scheduling or your manager.<br /> BidlineBuddy summarises BLR Feb 2025 and BASC 2022. Always confirm anything unusual or career-critical with BASC / Scheduling.
      </div>
    </main>
  );
}



