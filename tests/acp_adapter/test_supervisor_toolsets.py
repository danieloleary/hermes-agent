from acp_adapter.session import _expand_acp_enabled_toolsets
from toolsets import resolve_toolset


def test_supervisor_env_overrides_default_acp_toolset(monkeypatch):
    monkeypatch.setenv("HERMES_ACP_TOOLSETS", "codex-supervised-none")

    assert _expand_acp_enabled_toolsets(["hermes-acp"]) == [
        "codex-supervised-none"
    ]


def test_supervisor_read_toolset_has_no_mutation_or_execution_tools():
    tools = set(resolve_toolset("codex-supervised-read"))

    assert {"read_file", "search_files", "web_search"} <= tools
    assert not tools & {
        "terminal",
        "process",
        "write_file",
        "patch",
        "execute_code",
        "delegate_task",
        "memory",
        "skill_manage",
        "browser_click",
        "browser_type",
    }


def test_supervisor_none_toolset_is_empty():
    assert resolve_toolset("codex-supervised-none") == []
