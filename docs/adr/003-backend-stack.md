# ADR 003: Backend Technology Stack

## Context
The core value proposition of the system is to bridge the gap between non-technical users and complicated data operations. These operations are predominantly written in Python by data scientists. The backend must be able to execute these scripts natively and efficiently.

## Decision
We will use **Python** for the backend processing engine.

## Consequences
**Positive:**
- **Native Execution:** Can run data science libraries (Pandas, NumPy, Scikit-learn) directly without translation layers.
- **Talent Pool:** Aligns with the skills of the "Data Scientist/Developer" stakeholder group mentioned in the introduction.
- **Ecosystem:** Python has the strongest ecosystem for data analysis and processing.

**Negative:**
- **Integration:** Requires a robust API layer (REST or WebSocket) to communicate with the React frontend.
- **Performance:** Pure Python processes can be slower than compiled languages for certain tasks, though usually sufficient for data orchestration.
