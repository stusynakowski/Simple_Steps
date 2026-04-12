# ADR 006 — Agent / Chatbot Extension (LangGraph)

## Status
Accepted

## Context
Users need guidance when defining workflow steps — choosing which function to use from the operation catalogue and configuring the right arguments. The existing ChatSidebar was a static placeholder.

## Decision
Add a **LangGraph-powered agent** to the right-side chat panel that:

1. **Reviews available operations** in scope (system, developer packs, project ops)
2. **Recommends functions** for each step based on user intent and pipeline context
3. **Suggests complete formulas** with arguments (e.g. `=filter_rows(column="score", value="5")`)
4. **Iteratively refines** arguments through conversation
5. **Supports configurable LLM backends** — OpenAI, Anthropic, Ollama (local), Azure OpenAI

### Architecture

```
Frontend (React)                          Backend (FastAPI)
─────────────────                         ────────────────
ChatSidebar ──── REST POST /api/agent/chat ──→ AgentRouter
    │                                              │
    └─── WebSocket /api/agent/chat/stream ──→ LangGraph
                                                   │
                                           ┌───────┴───────┐
                                           │  gather_ctx    │  ← ops catalogue + workflow state
                                           │  reason (LLM)  │  ← langchain ChatModel
                                           │  respond        │  → formula + explanation
                                           └───────────────┘
```

### Agent Config
Stored at `agent_config/agent_config.json`, editable via:
- `PATCH /api/agent/config` (REST)
- AgentConfigPanel (modal UI)

### Dependencies (optional)
```
pip install simple-steps[agent]          # langgraph + langchain-openai
pip install simple-steps[agent-anthropic] # + langchain-anthropic
pip install simple-steps[agent-ollama]    # + langchain-ollama
```

## Consequences
- The agent is **opt-in** — the backend runs fine without LangGraph installed
- The `/api/agent/health` endpoint tells the frontend what's available
- System prompt is carefully scoped: the agent can only help with function selection and argument configuration — it cannot execute code, create operations, or modify pipeline structure
