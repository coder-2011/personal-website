#!/usr/bin/env python3
"""Generate the public resume PDF from the current resume source content."""

from __future__ import annotations

import argparse
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import HRFlowable, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


PROJECTS = [
    (
        "Gemma 4 Inference Megakernel",
        "GitHub repo",
        ["Writing gemma.c, a Gemma 4 megakernel written in CUDA and PTX. Full forward pass is one kernel."],
    ),
    (
        "Sinter",
        "GitHub repo",
        [
            "Building an experimental H100 (sm_90) LLM inference engine that compiles declared model products into standalone CUDA serving repositories.",
        ],
    ),
    (
        "Writing Kernels",
        "",
        ["Writing custom GPU kernels in CUDA, PTX, and ThunderKittens, including flash attention, KDA, LatentMOE, etc."],
    ),
    (
        "Snaptokens",
        "GitHub repo",
        [
            "Built a Hugging Face-compatible Rust BPE tokenizer with exact token-ID parity; 2.04x faster than Gigatoken and 46.41x faster than Hugging Face across a 12-tokenizer, 15-host paired-median comparison.",
        ],
    ),
    (
        "LPT",
        "GitHub repo",
        [
            "Built a latent planning token path that injects planning tokens every n rollouts, then adds their final-layer hidden states to the next n rollouts.",
            "Improved perplexity by 4.6% for 0.3% overhead in a matched run; the mechanism should become more useful with scale.",
        ],
    ),
    (
        "STRATUS UAV: Optimizing Prescribed Burning using UAVs and Predictive Modeling",
        "",
        [
            "Led development of a patent-pending autonomous UAV to mitigate wildfire spread; 3D-printed a VTOL aircraft for autonomous backburning with 15 km range and 1.2 hour endurance.",
            "Targeted core field constraints: helicopter operations around $16k/day, custom aircraft and pilots, and pilot liability; designed for 5x lower price and 3x higher range than the closest drone competitor.",
        ],
    ),
    (
        "SBON (Strategic-Blackline-Optimization-Engine)",
        "GitHub repo",
        [
            "Built a wildfire prediction model that set state-of-the-art results and created the first ML approach to optimizing prescribed burns.",
            "Built a tri-branch multimodal architecture across 13 input modalities spanning fire imagery, weather, and geography; ConvNeXt and SSM encoders feed a larger SSM for 4-hour fire-mask prediction.",
            "Treated the model as an environment, rolled out predictions to 48 hours, and used PPO to optimize burn placement in a niche field with fewer than 20 papers in the last 30 years.",
        ],
    ),
    (
        "The no-circles project",
        "no-circles.com | GitHub repo",
        [
            "Built a personalized daily newsletter that learns from each reader's replies and behavior; scaled to triple-digit users within 3 weeks.",
            "Built the user memory, daily brief, and reply feedback loop to explain unfamiliar fields through topics each reader already cares about.",
        ],
    ),
    (
        "PHOENIX UAV / Science Fair Results",
        "GitHub repo",
        [
            "Built PHOENIX UAV for early wildfire detection; placed 2nd in the California State Science Fair, 1st at regionals, and won 5 awards including the Henkel aerospace award and Junior Lemelson-MIT Inventor Award.",
        ],
    ),
]

ASTRA_NOVA_URL = "https://www.astranova.org/home"

EDUCATION = [
    ("Astra Nova High School", "2026-2028", [], ASTRA_NOVA_URL),
    (
        "Independent Study / Competitions",
        "",
        [
            "Selected for SPARC '26 (3% acceptance rate); achieved USACO Gold and F=MA qualifying scores in the top 5% nationally.",
            "Competed in CALICO, Harker Physics Invitational, and Harker Programming Invitational; held a top 30 national placement in MSPF Debate with 2 tournament wins and elimination rounds at Stanford and TOC.",
        ],
        None,
    ),
]


def paragraph(text: str, style: ParagraphStyle, link: str | None = None) -> Paragraph:
    content = escape(text)
    if link:
        content = f'<link href="{link}">{content}</link>'
    return Paragraph(content, style)


def entry(
    title: str,
    meta: str,
    bullets: list[str],
    styles: dict[str, ParagraphStyle],
    title_link: str | None = None,
) -> list[object]:
    title_cell = paragraph(title, styles["entry_title"], title_link)
    cells = [title_cell]
    col_widths = [7.4 * inch]
    if meta:
        cells.append(paragraph(meta, styles["entry_meta"]))
        col_widths = [5.55 * inch, 1.85 * inch]
    heading = Table(
        [cells],
        colWidths=col_widths,
        hAlign="LEFT",
    )
    table_style = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]
    if meta:
        table_style.append(("ALIGN", (1, 0), (1, 0), "RIGHT"))
    heading.setStyle(TableStyle(table_style))
    flowables: list[object] = [heading]
    for bullet in bullets:
        flowables.append(Paragraph(escape(bullet), styles["bullet"], bulletText="•"))
    flowables.append(Spacer(1, 2.5))
    return flowables


def section(title: str, styles: dict[str, ParagraphStyle]) -> list[object]:
    return [
        Paragraph(title.upper(), styles["section"]),
        HRFlowable(width="100%", thickness=0.6, color=colors.HexColor("#B8C3D0"), spaceAfter=3),
    ]


def build(output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    doc = SimpleDocTemplate(
        str(output),
        pagesize=letter,
        leftMargin=0.55 * inch,
        rightMargin=0.55 * inch,
        topMargin=0.33 * inch,
        bottomMargin=0.32 * inch,
        title="Naman Chetwani Resume",
        author="Naman Chetwani",
    )
    base = getSampleStyleSheet()
    styles = {
        "name": ParagraphStyle(
            "Name",
            parent=base["Normal"],
            alignment=1,
            fontName="Helvetica-Bold",
            fontSize=24,
            leading=26,
            textColor=colors.HexColor("#172033"),
            spaceAfter=2,
        ),
        "contact": ParagraphStyle(
            "Contact",
            parent=base["Normal"],
            alignment=1,
            fontName="Helvetica",
            fontSize=9.5,
            leading=10.8,
            textColor=colors.HexColor("#4D5865"),
            spaceAfter=7,
        ),
        "section": ParagraphStyle(
            "Section",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=12,
            leading=13.5,
            textColor=colors.HexColor("#47779D"),
            spaceBefore=2.5,
            spaceAfter=1.2,
        ),
        "entry_title": ParagraphStyle(
            "EntryTitle",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=10.8,
            leading=12.2,
            textColor=colors.HexColor("#1D2632"),
        ),
        "entry_meta": ParagraphStyle(
            "EntryMeta",
            parent=base["Normal"],
            alignment=2,
            fontName="Helvetica",
            fontSize=9.5,
            leading=10.8,
            textColor=colors.HexColor("#4D5865"),
        ),
        "bullet": ParagraphStyle(
            "Bullet",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=8.5,
            leading=9.7,
            leftIndent=12,
            firstLineIndent=-7,
            bulletIndent=3.5,
            textColor=colors.HexColor("#313B47"),
            spaceAfter=0.45,
        ),
    }

    story: list[object] = [
        Paragraph("Naman Chetwani", styles["name"]),
        Paragraph(
            "+1 925 895 9674 &nbsp; | &nbsp; naman.chetwani@gmail.com &nbsp; | &nbsp; github.com/coder-2011 &nbsp; | &nbsp; naman.world",
            styles["contact"],
        ),
    ]
    story.extend(section("Projects", styles))
    for project in PROJECTS:
        story.extend(entry(*project, styles))
    story.extend(section("Education", styles))
    for school, years, bullets, school_url in EDUCATION:
        story.extend(entry(school, years, bullets, styles, school_url))

    doc.build(story)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    build(args.output)
