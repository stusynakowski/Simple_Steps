"""
runme.py — run the dummy LLM example's workflows and check every step.

    python examples/dummy_llm/runme.py

``resources`` runs through the app, then is compared step by step with its
Python twin (``llm_pipeline.py``) run straight in simple-steps-core, and checked
against the dummy models' known answers. ``local-llm`` uses a real model,
so it runs only when Ollama has one (see ``llm_tools.py``) — and since a real
model's words can't be predicted, each answer must just be non-empty text.
Exits non-zero if any step doesn't match.
"""

import sys
from pathlib import Path

from SIMPLE_STEPS.example_check import Example

HERE = Path(__file__).resolve().parent
example = Example(HERE / "app.py")

import llm_pipeline as pipeline  # noqa: E402
from llm_tools import local_llm_missing  # noqa: E402


def answered(column="value"):
    """Every row of *column* is non-empty text: what a real model must give."""
    def check(data, metrics):
        values = list(data[column])
        return all(isinstance(v, str) and v.strip() for v in values) or f"empty answers: {values}"
    return check


example.check("dummy_llm", "resources", twin=pipeline.build_resources, live=pipeline.live_resources,
              expect={
    "regions": {"regions": ["west", "east", "west", "west"]},
    "summaries": {"summaries": ["[fake-1] A", "[fake-1] B"]},
    "tiny_summaries": {"tiny_summaries": ["[tiny-1] A", "[tiny-1] B"]},
    # a map step is only its results: the keys stay in wf["keys"], linked by row id
    "regions_bound": {"regions_bound": ["west", "east", "west", "west"]},
    "hello": {"value": ["[fake-1] HI"]},
    "inferred": lambda data, metrics: metrics.get("verb") == "map" or f"ran as {metrics.get('verb')}, not map",
    # the ready-made house_llm is "house-1"; the workflow's saved override wins
    "house_summaries": {"house_summaries": ["[house-2] A", "[house-2] B"]},
})

example.check("dummy_llm", "local-llm", skip=local_llm_missing, expect={
    "summaries": answered("summaries"),
    "hello": answered(),
})

sys.exit(example.finish())
