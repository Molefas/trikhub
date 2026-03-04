"""TrikHub linter — manifest validation and capability scanning."""

from trikhub.linter.scanner import (
    scan_capabilities,
    format_scan_result,
    adjust_tier_for_manifest,
    cross_check_manifest,
)

__all__ = ["scan_capabilities", "format_scan_result", "adjust_tier_for_manifest", "cross_check_manifest"]
