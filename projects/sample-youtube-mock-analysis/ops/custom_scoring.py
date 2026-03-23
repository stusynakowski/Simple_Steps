"""
Example: Project-Level Custom Operations
==========================================
This file lives inside a project's ``ops/`` folder and demonstrates how
a user adds project-specific operations.

When Simple Steps opens this project, the platform automatically scans
the ``ops/`` directory and registers any @simple_step-decorated functions.

These operations are only relevant to *this* project — they won't pollute
other projects' operation lists.

Location:
    projects/sample-youtube-mock-analysis/ops/custom_scoring.py
"""

import pandas as pd
from SIMPLE_STEPS.decorators import simple_step


@simple_step(
    id="custom_engagement_score",
    name="Calculate Engagement Score",
    category="Custom Scoring",
    operation_type="dataframe",
)
def calculate_engagement_score(
    df: pd.DataFrame,
    views_col: str = "views",
    weight: float = 1.0,
) -> pd.DataFrame:
    """
    Calculate a custom engagement score for each row.

    This is a project-specific operation — it only makes sense for this
    particular analysis pipeline, so it lives in the project's ops/ folder
    rather than in a developer pack.
    """
    result = df.copy()
    if views_col in result.columns:
        result["engagement_score"] = result[views_col].apply(
            lambda v: round(float(v) * weight / 1000, 2)
        )
    else:
        result["engagement_score"] = 0.0
    return result


@simple_step(
    id="custom_tag_tier",
    name="Tag Video Tier",
    category="Custom Scoring",
    operation_type="dataframe",
)
def tag_video_tier(
    df: pd.DataFrame,
    score_col: str = "engagement_score",
) -> pd.DataFrame:
    """
    Tag each video with a tier label based on its engagement score.

    Tiers:
        - 🔥 Hot:    score >= 50
        - 👍 Good:   score >= 10
        - 🆗 Normal: below 10
    """
    result = df.copy()
    if score_col in result.columns:
        result["tier"] = result[score_col].apply(
            lambda s: "🔥 Hot" if s >= 50 else ("👍 Good" if s >= 10 else "🆗 Normal")
        )
    else:
        result["tier"] = "unknown"
    return result
