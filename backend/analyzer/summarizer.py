"""
Generates natural-language summaries of source files using the Claude API.
"""

import os
from pathlib import Path

import anthropic

MODEL = "claude-opus-4-8"
MAX_FILE_CHARS = 12000


class ModuleSummarizer:
    def __init__(self):
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        self._client = anthropic.Anthropic(api_key=api_key) if api_key else None
        self._cache: dict[str, str] = {}

    def summarize(self, module_id: str, file_path: str) -> str:
        if module_id in self._cache:
            return self._cache[module_id]

        source = Path(file_path).read_text(encoding="utf-8", errors="replace")[:MAX_FILE_CHARS]

        if self._client is None:
            summary = (
                "AI summaries are disabled: set the ANTHROPIC_API_KEY environment "
                "variable (or add it to backend/.env) to enable them."
            )
        else:
            response = self._client.messages.create(
                model=MODEL,
                max_tokens=300,
                system=(
                    "You summarize a single source file for a codebase architecture "
                    "visualizer. In 2-4 sentences, describe what the module does and "
                    "its role in the codebase. Be concise and concrete."
                ),
                messages=[
                    {
                        "role": "user",
                        "content": f"File: {module_id}\n\n```\n{source}\n```",
                    }
                ],
            )
            summary = next(
                (block.text for block in response.content if block.type == "text"), ""
            ).strip()

        self._cache[module_id] = summary
        return summary
