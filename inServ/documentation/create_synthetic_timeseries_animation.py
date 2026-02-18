import argparse
import math
import os
import shutil
import subprocess

from PIL import Image, ImageDraw, ImageFont


parser = argparse.ArgumentParser(
    description="Generate synthetic intent-related timeseries animation"
)
parser.add_argument(
    "--layoutOnly",
    action="store_true",
    help="Only create the first frame for layout preview",
)
parser.add_argument(
    "--redBlink",
    action="store_true",
    help="Add red blinking boxes before key animations",
)
parser.add_argument(
    "--fancyAnimation",
    action="store_true",
    default=True,
    help="Add dissolve effect: packets move to target center and shrink (default: on)",
)
parser.add_argument(
    "--noFancyAnimation",
    dest="fancyAnimation",
    action="store_false",
    help="Disable dissolve effect",
)
args = parser.parse_args()


W, H = 1280, 820


def load_font(size: int) -> ImageFont.FreeTypeFont:
    for p in [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    ]:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def load_bold_font(size: int) -> ImageFont.FreeTypeFont:
    for p in [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    ]:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return load_font(size)


FONT_TITLE = load_font(32)
FONT = load_font(22)
FONT_SMALL = load_font(18)
FONT_TINY = load_font(15)
FONT_TINY_BOLD = load_bold_font(15)
FONT_MICRO = load_font(13)


def rounded_rectangle(draw, xy, r=18, outline=(30, 30, 30), width=3, fill=(245, 245, 245)):
    x1, y1, x2, y2 = xy
    draw.rounded_rectangle([x1, y1, x2, y2], radius=r, outline=outline, width=width, fill=fill)


def arrow(draw, start, end, width=5):
    sx, sy = start
    ex, ey = end
    draw.line([sx, sy, ex, ey], fill=(40, 40, 40), width=width)
    angle = math.atan2(ey - sy, ex - sx)
    head_len = 18
    head_w = 10
    p1 = (ex, ey)
    p2 = (
        ex - head_len * math.cos(angle) + head_w * math.sin(angle),
        ey - head_len * math.sin(angle) - head_w * math.cos(angle),
    )
    p3 = (
        ex - head_len * math.cos(angle) - head_w * math.sin(angle),
        ey - head_len * math.sin(angle) + head_w * math.cos(angle),
    )
    draw.polygon([p1, p2, p3], fill=(40, 40, 40))


def text_width(font, s: str) -> float:
    return font.getlength(s)


def wrap_lines(lines, font, max_w):
    out = []
    for line in lines:
        bullet = ""
        core = line
        for pref in ["• ", "- "]:
            if core.startswith(pref):
                bullet = pref
                core = core[len(pref) :]
                break
        words = core.split()
        if not words:
            out.append(line)
            continue
        cur = bullet
        for w in words:
            test = (cur + ("" if cur.endswith(("• ", "- ")) else " ") + w) if cur.strip() else (bullet + w)
            if text_width(font, test) <= max_w:
                cur = test
            else:
                out.append(cur)
                cur = bullet + w
        if cur:
            out.append(cur)
    return out


def fit_and_draw_text(
    draw,
    box,
    lines,
    font,
    fill=(40, 40, 40),
    padding=14,
    line_gap=6,
    valign="top",
):
    x1, y1, x2, y2 = box
    max_w = (x2 - x1) - 2 * padding
    max_h = (y2 - y1) - 2 * padding
    candidates = [font, FONT_TINY, FONT_MICRO, load_font(12)]
    used_font = candidates[-1]
    wrapped = None

    for f in candidates:
        w = wrap_lines(lines, f, max_w)
        total_h = len(w) * (f.size + line_gap) - line_gap
        if total_h <= max_h:
            used_font = f
            wrapped = w
            break
    if wrapped is None:
        f = used_font
        w = wrap_lines(lines, f, max_w)
        per = f.size + line_gap
        max_lines = max(1, (max_h + line_gap) // per)
        w = w[:max_lines]
        if w:
            last = w[-1]
            ell = "…"
            while text_width(f, last + ell) > max_w and len(last) > 0:
                last = last[:-1]
            w[-1] = (last + ell) if last else ell
        wrapped = w

    total_h = len(wrapped) * (used_font.size + line_gap) - line_gap
    if valign == "center":
        y = y1 + padding + (max_h - total_h) // 2
    else:
        y = y1 + padding

    for line in wrapped:
        draw.text((x1 + padding, y), line, font=used_font, fill=fill)
        y += used_font.size + line_gap


# Layout: horizontal timeline with branching futures
timeline_y_main = 430
timeline_start_x = 260
timeline_fork_x = 700
timeline_end_x = 1120
branch_gap = 120
timeline_y_A = timeline_y_main - branch_gap
timeline_y_B = timeline_y_main + branch_gap

# Markers along the main and forked timelines
markers = {
    "intent": (timeline_start_x, timeline_y_main),
    "reports_main": ((timeline_start_x + timeline_fork_x) // 2, timeline_y_main),
    "fork": (timeline_fork_x, timeline_y_main),
    "A_reports": ((timeline_fork_x + timeline_end_x) // 2, timeline_y_A),
    "A_status": (timeline_end_x, timeline_y_A),
    "B_reports": ((timeline_fork_x + timeline_end_x) // 2, timeline_y_B),
    "B_status": (timeline_end_x, timeline_y_B),
}

boxes = {
    "IntentOwner": (60, timeline_y_main - 50, 230, timeline_y_main + 50),
    "Monitoring": (60, timeline_y_main - 200, 230, timeline_y_main - 100),
    "inCoord": (900, 220, 1200, 360),
    "inGraph": (900, 460, 1200, 620),
}


def draw_scene(
    step,
    t=0.0,
    blink_target=None,
    blink_on=False,
    fancy_phase=0,
    fancy_t=0.0,
    timeline_phase=0,
    timeline_reveal=-1,
    intent_to_b_t=0.0,
    timeline_b_reveal=0,
):
    """
    timeline_phase: 0 = only Intent owner + first yellow
                    1 = same (used during intent fly)
                    2 = build main timeline progressively (no fork)
                    3 = full main + inCoord + fork vertical + 3 yellow rects on A,B,X
                    4 = same (0.5s pause)
                    5 = same + send intent from inCoord to B first yellow (intent_to_b_t 0..1)
                    6 = same + animate timeline B (timeline_b_reveal)
    """
    img = Image.new("RGB", (W, H), (255, 255, 255))
    d = ImageDraw.Draw(img)

    # Title
    title = "Synthetic Intent Timeseries — Single Intent with Forked Futures"
    d.text((40, 48), title, font=FONT_TITLE, fill=(15, 15, 15))
    d.line([40, 90, W - 40, 90], fill=(200, 200, 200), width=2)

    # Geometry
    timeline_y = 480
    start_x = 120
    fork_x = 640
    end_x = 1160
    g = 40
    branch_offsets = [-g, 0, int(1.5 * g)]
    rect_w = 10
    rect_h = 6
    dash_len = 12
    gap_len = 4
    base_line = (150, 150, 150)
    blue_line = (60, 110, 220)
    yellow_status = (230, 210, 80)
    green_status = (60, 150, 80)
    red_status = (210, 40, 40)
    conflict_color = (220, 0, 0)
    conflict_r = 7

    def draw_status_rect(cx, cy, color, outline=(40, 40, 40)):
        rx0 = int(cx - rect_w // 2)
        ry0 = int(cy - rect_h // 2)
        d.rectangle(
            (rx0, ry0, rx0 + rect_w, ry0 + rect_h),
            fill=color,
            outline=outline,
            width=1,
        )

    def draw_one_dash(x0, y):
        d.line([x0, y, x0 + dash_len, y], fill=blue_line, width=3)

    # Build list of timeline elements after first yellow: (kind, x) for progressive reveal
    def timeline_elements():
        x = start_x + rect_w // 2 + 20
        # 3 dashes
        for _ in range(3):
            yield ("dash", x)
            x += dash_len + gap_len
        x += 10
        yield ("rect_green", x)
        x += rect_w // 2 + 20
        for _ in range(3):
            yield ("dash", x)
            x += dash_len + gap_len
        x += 10
        yield ("rect_green", x)
        x += rect_w // 2 + 20
        for _ in range(3):
            yield ("dash", x)
            x += dash_len + gap_len
        x += 10
        yield ("rect_green", x)
        x += rect_w // 2 + 20
        for _ in range(3):
            yield ("dash", x)
            x += dash_len + gap_len
        x += 10
        for i in range(3):
            yield ("rect_red", x)
            x += rect_w // 2 + 20
            for _ in range(3):
                yield ("dash", x)
                x += dash_len + gap_len
            if i < 2:
                x += 10
        yield ("conflict", x + 22)

    elements = list(timeline_elements())
    first_yellow_center = (start_x, timeline_y)
    show_only_intent_and_yellow = timeline_phase in (0, 1)
    # Fork geometry (from conflict position)
    conflict_x_val = elements[-1][1] if elements and elements[-1][0] == "conflict" else (start_x + 200)
    branch_start_x_val = conflict_x_val + 24
    branch_end_x_val = end_x
    branch_ys_list = [timeline_y + off for off in branch_offsets]
    # Timeline B is the middle branch (index 1)
    branch_a_y = branch_ys_list[0]
    branch_b_y = branch_ys_list[1]
    first_yellow_a_center = (branch_start_x_val + 20, branch_a_y)

    # --- Intent owner box (above the timeline, inChat style) ---
    # ~2 cm above timeline, center-aligned with first yellow rectangle (start_x); snug fit to content
    gap_above_timeline = 76   # ~2 cm at 96 DPI
    intent_owner_label = "Intent owner"
    padding_h = 14
    padding_v_top = 8
    padding_v_bottom = 8
    text_height = FONT.size
    header_inner_v = 10
    intent_owner_w = int(text_width(FONT, intent_owner_label)) + 2 * padding_h
    intent_owner_h = padding_v_top + text_height + header_inner_v + padding_v_bottom
    intent_owner_x1 = start_x - intent_owner_w // 2
    intent_owner_x2 = start_x + intent_owner_w // 2
    intent_owner_box = (
        intent_owner_x1,
        timeline_y - gap_above_timeline - intent_owner_h,
        intent_owner_x2,
        timeline_y - gap_above_timeline,
    )
    rounded_rectangle(d, intent_owner_box, r=18, outline=(30, 30, 30), width=3, fill=(245, 245, 245))
    # Header like inChat: light cyan/teal
    header_colors_inchat = (150, 220, 220)
    header_top = intent_owner_box[1] + padding_v_top
    header_bottom = header_top + text_height + header_inner_v
    header_bg = (intent_owner_box[0] + 10, header_top, intent_owner_box[2] - 10, header_bottom)
    d.rounded_rectangle(header_bg, radius=10, fill=header_colors_inchat)
    box_cx = (intent_owner_box[0] + intent_owner_box[2]) / 2
    text_y = (header_top + header_bottom) / 2
    d.text((box_cx, text_y), intent_owner_label, font=FONT, fill=(10, 10, 10), anchor="mm")
    intent_owner_center = (start_x, timeline_y - gap_above_timeline - intent_owner_h // 2)

    # 1) First yellow rectangle (Received) — always visible
    draw_status_rect(start_x, timeline_y, yellow_status)

    # 2) Rest of main timeline: phase 2 up to timeline_reveal, or phase >= 3 full
    reveal_count = len(elements) if timeline_phase >= 3 else timeline_reveal
    if (timeline_phase == 2 or timeline_phase >= 3) and reveal_count > 0:
        for i in range(min(reveal_count, len(elements))):
            kind, x = elements[i]
            if kind == "dash":
                draw_one_dash(x, timeline_y)
            elif kind == "rect_green":
                draw_status_rect(x, timeline_y, green_status)
            elif kind == "rect_red":
                draw_status_rect(x, timeline_y, red_status, outline=(120, 0, 0))
            elif kind == "conflict":
                d.ellipse(
                    [
                        x - conflict_r,
                        timeline_y - conflict_r,
                        x + conflict_r,
                        timeline_y + conflict_r,
                    ],
                    fill=conflict_color,
                    outline=(120, 0, 0),
                    width=2,
                )
    # inCoord box (phase >= 3): above conflict, dark green header; body: "Select action" then "A...X"
    if timeline_phase >= 3:
        incoord_label = "inCoord"
        incoord_pad_h = 14
        incoord_pad_v_top = 8
        incoord_pad_v_bottom = 8
        incoord_header_h = text_height + 10
        line_gap = 4
        line1_h = FONT_SMALL.size
        line2_h = FONT_SMALL.size
        incoord_body_h = line1_h + line_gap + line2_h + 8  # two lines + padding
        # Second line "A...X": A, three dots (centered between A and X), X
        w_a = text_width(FONT_SMALL, "A")
        w_x = text_width(FONT_SMALL, "X")
        incoord_dot_r = 1.5
        incoord_dot_gap = 3
        incoord_dots_w = 2 * incoord_dot_r + incoord_dot_gap + 2 * incoord_dot_r + incoord_dot_gap + 2 * incoord_dot_r
        incoord_gap_ax = 6
        line2_w = w_a + incoord_gap_ax + incoord_dots_w + incoord_gap_ax + w_x
        line1_w = text_width(FONT_SMALL, "Select action")
        incoord_w = int(max(text_width(FONT, incoord_label), line1_w, line2_w) + 2 * incoord_pad_h)
        incoord_h = incoord_pad_v_top + incoord_header_h + incoord_body_h + incoord_pad_v_bottom
        # Place above conflict; fork top is timeline_y-40=440, so inCoord bottom at 400
        incoord_bottom = 400
        incoord_top = incoord_bottom - incoord_h
        incoord_cx = conflict_x_val
        incoord_box = (
            incoord_cx - incoord_w // 2,
            incoord_top,
            incoord_cx + incoord_w // 2,
            incoord_bottom,
        )
        rounded_rectangle(d, incoord_box, r=18, outline=(30, 30, 30), width=3, fill=(245, 245, 245))
        incoord_header_color = (40, 100, 60)  # dark green
        incoord_header_top = incoord_box[1] + incoord_pad_v_top
        incoord_header_bottom = incoord_header_top + incoord_header_h
        incoord_header_bg = (incoord_box[0] + 10, incoord_header_top, incoord_box[2] - 10, incoord_header_bottom)
        d.rounded_rectangle(incoord_header_bg, radius=10, fill=incoord_header_color)
        d.text(
            (incoord_cx, (incoord_header_top + incoord_header_bottom) / 2),
            incoord_label,
            font=FONT,
            fill=(255, 255, 255),
            anchor="mm",
        )
        body_top = incoord_header_bottom + 6
        d.text((incoord_cx, body_top + line1_h / 2), "Select action", font=FONT_SMALL, fill=(40, 40, 40), anchor="mm")
        line2_y = body_top + line1_h + line_gap + line2_h / 2
        line2_start_x = incoord_cx - line2_w / 2
        d.text((line2_start_x + w_a / 2, line2_y), "A", font=FONT_SMALL, fill=(40, 40, 40), anchor="mm")
        dots_center_x = line2_start_x + w_a + incoord_gap_ax + incoord_dots_w / 2
        dot_step = 2 * incoord_dot_r + incoord_dot_gap
        for i in range(3):
            dot_x = dots_center_x + (i - 1) * dot_step
            d.ellipse(
                [dot_x - incoord_dot_r, line2_y - incoord_dot_r, dot_x + incoord_dot_r, line2_y + incoord_dot_r],
                fill=(60, 60, 60),
                outline=None,
            )
        d.text((line2_start_x + w_a + incoord_gap_ax + incoord_dots_w + incoord_gap_ax + w_x / 2, line2_y), "X", font=FONT_SMALL, fill=(40, 40, 40), anchor="mm")
        incoord_center = (incoord_cx, (incoord_top + incoord_bottom) / 2)
        incoord_bottom_center = (incoord_cx, incoord_bottom)
        # Black vertical line of fork (single segment, integer coordinates for perfectly vertical line)
        fork_x = int(branch_start_x_val)
        fork_y_top = int(min(branch_ys_list))
        fork_y_bot = int(max(branch_ys_list))
        d.line([fork_x, fork_y_top, fork_x, fork_y_bot], fill=(0, 0, 0), width=2)
        # First three yellow rectangles on forked timelines A, B, X
        first_yellow_b_x = branch_start_x_val + 20
        letter_offset = 8
        for idx, by in enumerate(branch_ys_list):
            draw_status_rect(first_yellow_b_x, by, yellow_status)
            if idx == 0:
                d.text((first_yellow_b_x, by - letter_offset), "A", font=FONT_SMALL, fill=(40, 40, 40), anchor="mb")
            elif idx == 1:
                d.text((first_yellow_b_x, by - letter_offset), "B", font=FONT_SMALL, fill=(40, 40, 40), anchor="mb")
            else:
                d.text((first_yellow_b_x, by + letter_offset), "X", font=FONT_SMALL, fill=(40, 40, 40), anchor="mt")
        # Three dots between the second (B) and third (X) yellow rectangles
        dot_r = 2
        dot_gap = 7
        mid_y_bx = (branch_ys_list[1] + branch_ys_list[2]) / 2
        first_dot_y = mid_y_bx - dot_gap
        for i in range(3):
            cy = first_dot_y + i * dot_gap
            d.ellipse(
                [first_yellow_b_x - dot_r, cy - dot_r, first_yellow_b_x + dot_r, cy + dot_r],
                fill=(60, 60, 60),
                outline=None,
            )
        # Timeline A, B, X labels (to the right of the fork, within canvas)
        branch_labels = ["A", "B", "X"]
        label_x = int(branch_end_x_val) + 10
        for label, by in zip(branch_labels, branch_ys_list):
            d.text((label_x, int(by)), f"Timeline {label}", font=FONT_SMALL, fill=(40, 40, 40), anchor="lm")
        # Three dots between the texts "Timeline B" and "Timeline X", centered on the text
        timeline_text_w = text_width(FONT_SMALL, "Timeline B")
        dots_label_x = label_x + timeline_text_w / 2
        for i in range(3):
            cy = first_dot_y + i * dot_gap
            d.ellipse(
                [dots_label_x - dot_r, cy - dot_r, dots_label_x + dot_r, cy + dot_r],
                fill=(60, 60, 60),
                outline=None,
            )
        # Send intent from inCoord to first yellow on Timeline A (phase 5)
        if timeline_phase == 5 and 0 <= intent_to_b_t <= 1:
            ix = incoord_bottom_center[0] + intent_to_b_t * (first_yellow_a_center[0] - incoord_bottom_center[0])
            iy = incoord_bottom_center[1] + intent_to_b_t * (first_yellow_a_center[1] - incoord_bottom_center[1])
            intent_r = 8
            d.ellipse(
                [ix - intent_r, iy - intent_r, ix + intent_r, iy + intent_r],
                fill=(100, 80, 200),
                outline=(60, 40, 120),
                width=2,
            )
            if intent_to_b_t < 1:
                d.text((ix, iy - intent_r - 4), "New or modified intent", font=FONT_MICRO, fill=(60, 40, 120), anchor="md")
        # Timeline A progressive (phase 6): same as main but stop before first red (no reds, no conflict)
        NUM_B_ELEMENTS = 15  # 3 dashes, green, 3 dashes, green, 3 dashes, green, 3 dashes (indices 0..14)
        if timeline_phase == 6 and timeline_b_reveal > 0:
            offset_b = (branch_start_x_val + 20) - start_x
            for i in range(min(timeline_b_reveal, min(len(elements), NUM_B_ELEMENTS))):
                kind, x = elements[i]
                if kind in ("rect_red", "conflict"):
                    break
                x_b = x + offset_b
                if kind == "dash":
                    draw_one_dash(x_b, branch_a_y)
                elif kind == "rect_green":
                    draw_status_rect(x_b, branch_a_y, green_status)

    # Animated intent: from Intent owner to first yellow when step == 0 (only in phase 0/1)
    if show_only_intent_and_yellow and step == 0 and 0 <= t <= 1:
        ix = intent_owner_center[0] + t * (first_yellow_center[0] - intent_owner_center[0])
        iy = intent_owner_center[1] + t * (first_yellow_center[1] - intent_owner_center[1])
        intent_r = 8
        d.ellipse(
            [ix - intent_r, iy - intent_r, ix + intent_r, iy + intent_r],
            fill=(100, 80, 200),
            outline=(60, 40, 120),
            width=2,
        )
        if t < 1:
            d.text((ix, iy - intent_r - 4), "intent", font=FONT_MICRO, fill=(60, 40, 120), anchor="md")

    # Fork and branches: legacy full fork (not used when phase 3+; we draw fork in phase 3+ block above)
    if not show_only_intent_and_yellow and timeline_phase != 2 and timeline_phase < 3:
        conflict_x = elements[-1][1] if elements else start_x + 22
        branch_start_x = conflict_x + 24
        d.line([conflict_x + conflict_r + 6, timeline_y, branch_start_x, timeline_y], fill=base_line, width=1)
        branch_end_x = end_x
        labels = ["A", "B", "X"]
        branch_ys = [timeline_y + off for off in branch_offsets]
        for label, by in zip(labels, branch_ys):
            d.line([branch_start_x, timeline_y, branch_start_x, by], fill=base_line, width=1)
            x_b = branch_start_x + 20
            draw_status_rect(x_b, by, yellow_status)
            for _ in range(3):
                for _ in range(3):
                    draw_one_dash(x_b, by)
                    x_b += dash_len + gap_len
                x_b += 10
                draw_status_rect(x_b, by, green_status)
                x_b += rect_w // 2 + 20
            d.text((branch_end_x + 10, by), f"Timeline {label}", font=FONT_SMALL, fill=(40, 40, 40), anchor="lm")
        y_A, y_B, y_X = branch_ys
        dots_x = (branch_start_x + branch_end_x) / 2
        dot_r = 2
        dot_gap = 7
        mid_y = (y_B + y_X) / 2
        first_y = mid_y - dot_gap
        for i in range(3):
            cy = first_y + i * dot_gap
            d.ellipse([dots_x - dot_r, cy - dot_r, dots_x + dot_r, cy + dot_r], fill=(60, 60, 60), outline=None)

    # --- Legend at the bottom, laid out horizontally on a single line ---
    # Place legend close to the bottom of the drawing area
    base_y = H - 40
    col_gap = 70

    # Column 1: "Observation reports:" with dashed blue line
    col1_x = 40
    label_obs = "Observation reports:"
    d.text(
        (col1_x, base_y),
        label_obs,
        font=FONT_TINY_BOLD,
        fill=(40, 40, 40),
        anchor="lm",
    )
    line_x0 = col1_x + text_width(FONT_TINY_BOLD, label_obs) + 6
    x = line_x0
    sample_len = 70
    while x < line_x0 + sample_len:
        d.line([x, base_y, min(x + dash_len, line_x0 + sample_len), base_y], fill=blue_line, width=2)
        x += dash_len + gap_len

    # Column 2: "Status reports:" with color-coded rectangles
    col2_x = line_x0 + sample_len + col_gap
    label_status = "Status reports:"
    d.text(
        (col2_x, base_y),
        label_status,
        font=FONT_TINY_BOLD,
        fill=(40, 40, 40),
        anchor="lm",
    )
    sx = col2_x + text_width(FONT_TINY_BOLD, label_status) + 6
    sy = base_y - rect_h // 2
    status_samples = [
        ("Received", yellow_status),
        ("Compliant", green_status),
        ("Degraded", red_status),
    ]
    for label, color in status_samples:
        rx0 = int(sx)
        ry0 = int(sy)
        d.rectangle(
            (rx0, ry0, rx0 + rect_w, ry0 + rect_h),
            fill=color,
            outline=(40, 40, 40),
            width=1,
        )
        sx = rx0 + rect_w + 4
        d.text(
            (sx, base_y),
            label,
            font=FONT_MICRO,
            fill=(40, 40, 40),
            anchor="lm",
        )
        sx += text_width(FONT_MICRO, label) + 16

    # Column 3: "Conflict detected:" with red circle
    col3_x = sx + col_gap
    label_conflict = "Conflict detected:"
    d.text(
        (col3_x, base_y),
        label_conflict,
        font=FONT_TINY_BOLD,
        fill=(40, 40, 40),
        anchor="lm",
    )
    cx = col3_x + text_width(FONT_TINY_BOLD, label_conflict) + 8
    cy = base_y
    d.ellipse(
        [
            cx - conflict_r,
            cy - conflict_r,
            cx + conflict_r,
            cy + conflict_r,
        ],
        fill=conflict_color,
        outline=(120, 0, 0),
        width=1,
    )

    return img


frames = []


def add_blink_frames(target, step, t, duration_frames=28):
    if args.redBlink:
        for i in range(duration_frames):
            blink_on = (i // 4) % 2 == 0
            frames.append(draw_scene(step, t, blink_target=target, blink_on=blink_on))


def add_fancy_frames(step):
    if args.fancyAnimation:
        # Pause at arrow end
        for _ in range(28):
            frames.append(draw_scene(step, 1.0, fancy_phase=1, fancy_t=0.0))
        # Move to center
        for i in range(10):
            frames.append(draw_scene(step, 1.0, fancy_phase=1, fancy_t=i / 9))
        # Shrink/dissolve
        for i in range(10):
            frames.append(draw_scene(step, 1.0, fancy_phase=2, fancy_t=i / 9))
        return True
    return False


# Number of timeline elements after first yellow (dashes, rects, conflict)
NUM_TIMELINE_ELEMENTS = 28   # must match len(timeline_elements())
# Timeline B stops before first red (indices 0..14: dashes and greens only)
NUM_TIMELINE_ELEMENTS_B = 15
FRAMES_PER_HALF_SECOND = 7   # 0.5s at 70 ms/frame

if args.layoutOnly:
    # Show full animation state: main timeline + inCoord + fork + timeline B built (B truncated)
    frames = [draw_scene(-1, 0.0, timeline_phase=6, timeline_reveal=NUM_TIMELINE_ELEMENTS, timeline_b_reveal=NUM_TIMELINE_ELEMENTS_B)]
else:
    # 1) Only Intent owner + first yellow rectangle
    frames += [draw_scene(-1, 0.0, timeline_phase=0)] * 15
    # 2) Animate intent from Intent owner to first yellow rectangle
    for i in range(18):
        frames.append(draw_scene(0, i / 17, timeline_phase=1))
    # 3) Build main timeline: one element every 0.5 s (dashes, rects, conflict circle)
    for reveal in range(1, NUM_TIMELINE_ELEMENTS + 1):
        for _ in range(FRAMES_PER_HALF_SECOND):
            frames.append(draw_scene(-1, 0.0, timeline_phase=2, timeline_reveal=reveal))
    # Hold on conflict
    frames += [draw_scene(-1, 0.0, timeline_phase=2, timeline_reveal=NUM_TIMELINE_ELEMENTS)] * 15
    # 1a+1b) inCoord + black vertical fork + first 3 yellow rects on A, B, X
    frames += [draw_scene(-1, 0.0, timeline_phase=3)] * 5
    # 2) Wait 0.5 s
    for _ in range(FRAMES_PER_HALF_SECOND):
        frames.append(draw_scene(-1, 0.0, timeline_phase=4))
    # 3) Send intent from inCoord to first yellow on timeline B
    for i in range(18):
        frames.append(draw_scene(-1, 0.0, timeline_phase=5, intent_to_b_t=i / 17))
    # 4) Animate timeline B (same pacing; B stops before first red)
    for reveal in range(1, NUM_TIMELINE_ELEMENTS_B + 1):
        for _ in range(FRAMES_PER_HALF_SECOND):
            frames.append(draw_scene(-1, 0.0, timeline_phase=6, timeline_b_reveal=reveal))
    # Hold on final state
    frames += [draw_scene(-1, 0.0, timeline_phase=6, timeline_b_reveal=NUM_TIMELINE_ELEMENTS_B)] * 40


gif_path = "synthetic_timeseries_animation.gif"
frames[0].save(
    gif_path,
    save_all=True,
    append_images=frames[1:],
    duration=70,
    loop=0,
    disposal=2,
)

mp4_path = "synthetic_timeseries_animation.mp4"
ffmpeg = shutil.which("ffmpeg")
if ffmpeg:
    subprocess.run(
        [ffmpeg, "-y", "-i", gif_path, "-movflags", "faststart", "-pix_fmt", "yuv420p", mp4_path],
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

if args.layoutOnly:
    print(f"Layout preview saved to: {gif_path}")
    if os.path.exists(mp4_path) and os.path.getsize(mp4_path) > 0:
        print(f"Layout preview saved to: {mp4_path}")
else:
    print(f"Animation saved to: {gif_path}")
    if os.path.exists(mp4_path) and os.path.getsize(mp4_path) > 0:
        print(f"Animation saved to: {mp4_path}")

