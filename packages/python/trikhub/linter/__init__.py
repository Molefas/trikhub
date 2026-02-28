"""TrikHub linter — manifest validation and capability scanning."""

from trikhub.linter.scanner import scan_capabilities, format_scan_result

__all__ = ["scan_capabilities", "format_scan_result"]
