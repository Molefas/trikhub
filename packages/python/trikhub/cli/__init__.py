"""
TrikHub CLI - Command-line interface for managing Python triks.

Commands:
    trikhub install @scope/name   Install a trik from the registry or pip
    trikhub uninstall @scope/name Uninstall a trik
    trikhub list                  List installed triks
    trikhub sync                  Discover triks in site-packages
    trikhub search query          Search for triks in the registry
    trikhub info @scope/name      Show trik details
"""

from trikhub.cli.main import cli
from trikhub.cli.config import (
    TriksConfig,
    InstalledTrik,
    read_config,
    write_config,
    add_trik_to_config,
    remove_trik_from_config,
    is_trik_installed,
    get_trik_secrets,
    set_trik_secrets,
)
from trikhub.cli.registry import (
    RegistryClient,
    TrikInfo,
    TrikVersion,
    SearchResult,
    get_registry,
)
from trikhub.cli.discovery import (
    DiscoveredTrik,
    discover_triks_in_site_packages,
    discover_triks_in_directory,
    get_package_info,
)

__all__ = [
    # Main CLI
    "cli",
    # Config
    "TriksConfig",
    "InstalledTrik",
    "read_config",
    "write_config",
    "add_trik_to_config",
    "remove_trik_from_config",
    "is_trik_installed",
    "get_trik_secrets",
    "set_trik_secrets",
    # Registry
    "RegistryClient",
    "TrikInfo",
    "TrikVersion",
    "SearchResult",
    "get_registry",
    # Discovery
    "DiscoveredTrik",
    "discover_triks_in_site_packages",
    "discover_triks_in_directory",
    "get_package_info",
]
