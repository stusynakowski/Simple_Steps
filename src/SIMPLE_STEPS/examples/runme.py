"""
runme.py — run every example's checks, then the main example's own workflow.

    python examples/runme.py              # every sub-example, then all-examples
    python examples/runme.py --main-only  # just all-examples

Each sub-example's ``runme.py`` runs in its own process (one process serves
one App), then this one checks ``all-examples`` — a workflow that uses tools
from all three — against its Python twin (``main_pipeline.py``). Exits non-zero if
anything doesn't match.
"""

import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SUB_EXAMPLES = ("basic", "dummy_llm", "plotly_charts", "image_processing", "agent_demo", "bad_examples")


def run_sub_examples() -> dict:
    """Each sub-example's runme.py, in its own process: {name: passed}."""
    results = {}
    for name in SUB_EXAMPLES:
        print(f"━━ {name}/runme.py\n", flush=True)
        done = subprocess.run([sys.executable, str(HERE / name / "runme.py")])
        results[name] = done.returncode == 0
        print(flush=True)
    return results


def check_main() -> bool:
    """all-examples, through the main app, against its twin."""
    print("━━ all-examples (the main example)\n", flush=True)
    from SIMPLE_STEPS.example_check import Example

    example = Example(HERE / "app.py")
    import main_pipeline as pipeline

    example.check("main", "all-examples", twin=pipeline.build_all_examples,
                  live=pipeline.live_resources, expect={
        "big": {"city": ["NYC", "LA", "SF"], "n": [4, 2, 3]},
        "regions": {"region": ["east", "west", "west"]},
        "summaries": {"summary": ["[main-1] NYC", "[main-1] LA", "[main-1] SF"]},
        "total_n": {"total_n": [9]},
        "chart": lambda data, metrics: (list(data["chart"].iloc[0].data[0].y) == [4, 2, 3])
                 or "the chart's bars should be 4, 2, 3",
    })
    return example.finish() == 0


def main() -> int:
    results = {} if "--main-only" in sys.argv[1:] else run_sub_examples()
    results["all-examples"] = check_main()
    print("\n━━ summary")
    for name, passed in results.items():
        print(f"{'PASS' if passed else 'FAIL'}  {name}")
    return 0 if all(results.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
