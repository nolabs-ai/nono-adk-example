"""Package init — also quiets two harmless startup messages.

This runs for every entrypoint (`python main.py`, `adk run`, `adk web`) because
they all import this package. Delete this block if you'd rather see the messages.
"""

import logging
import os
import warnings

# 1. Mute ADK's feature-stage UserWarnings, e.g.
#    "[EXPERIMENTAL] feature FeatureName.JSON_SCHEMA_FOR_FUNC_DECL is enabled."
#    These are emitted via warnings.warn() from ADK's feature registry.
#    Filtering by message leaves the feature ENABLED (no behaviour change) —
#    unlike ADK_DISABLE_<FEATURE>, which would turn it off.
warnings.filterwarnings(
    "ignore",
    message=r"\[[A-Z]+\] feature .* is enabled\.",
    category=UserWarning,
)
# Also opt out of the separate @experimental-decorator warnings (official switch).
os.environ.setdefault("ADK_SUPPRESS_EXPERIMENTAL_FEATURE_WARNINGS", "1")

# 2. Silence google-genai's info line:
#    "Both GOOGLE_API_KEY and GEMINI_API_KEY are set. Using GOOGLE_API_KEY."
#    It's harmless (GOOGLE_API_KEY wins). The root-cause fix is to set only one
#    key; this just quiets that logger without touching your environment.
logging.getLogger("google_genai._api_client").setLevel(logging.ERROR)

from . import agent  # noqa: E402
