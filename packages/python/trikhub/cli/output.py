"""Shared CLI output helpers for consistent feedback formatting."""

from __future__ import annotations

import click


def ok(msg: str) -> None:
    """Print a success message with green checkmark."""
    click.echo(click.style("✔ ", fg="green") + msg)


def fail(msg: str) -> None:
    """Print a failure message with red cross."""
    click.echo(click.style("✖ ", fg="red") + msg)


def warn(msg: str) -> None:
    """Print a warning message with yellow symbol."""
    click.echo(click.style("⚠ ", fg="yellow") + msg)


def info(msg: str) -> None:
    """Print an indented dim info line."""
    click.echo(click.style(f"  {msg}", dim=True))
