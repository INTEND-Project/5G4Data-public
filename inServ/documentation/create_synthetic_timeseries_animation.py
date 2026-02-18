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


def draw_scene(step, t=0.0, blink_target=None, blink_on=False, fancy_phase=0, fancy_t=0.0):
    """
    Static layout of a single intent timeline with forked futures.
    Animation parameters are ignored for now.
    """
    img = Image.new("RGB", (W, H), (255, 255, 255))
    d = ImageDraw.Draw(img)

    # Title
    title = "Synthetic Intent Timeseries — Single Intent with Forked Futures"
    # Draw title slightly further down so it is clearly visible
    d.text((40, 48), title, font=FONT_TITLE, fill=(15, 15, 15))
    d.line([40, 90, W - 40, 90], fill=(200, 200, 200), width=2)

    # Geometry (move timelines slightly further down for clearer title area)
    timeline_y = 480
    start_x = 120
    fork_x = 640
    end_x = 1160

    # Vertical offsets for forked timelines (A, B, X).
    # Gap between A and B is g; between B and X is 1.5 * g (larger).
    g = 40
    branch_offsets = [-g, 0, int(1.5 * g)]  # A (top), B (middle), X (bottom)

    # Smaller visual elements
    rect_w = 10
    rect_h = 6
    dash_len = 12
    gap_len = 4

    # Colors
    base_line = (150, 150, 150)     # light gray, used only for vertical segments
    blue_line = (60, 110, 220)      # observations (blue dashed line)
    # Received should be yellow in this visualization
    yellow_status = (230, 210, 80)  # Received (yellow)
    green_status = (60, 150, 80)    # Compliant
    red_status = (210, 40, 40)      # Degraded
    conflict_color = (220, 0, 0)

    # Helper to draw a small status rectangle
    def draw_status_rect(cx, cy, color, outline=(40, 40, 40)):
        rx0 = int(cx - rect_w // 2)
        ry0 = int(cy - rect_h // 2)
        d.rectangle(
            (rx0, ry0, rx0 + rect_w, ry0 + rect_h),
            fill=color,
            outline=outline,
            width=1,
        )

    # Helper to draw N blue dashes starting from x0
    def draw_dashes(x0, y, n):
        x = x0
        for _ in range(n):
            d.line([x, y, x + dash_len, y], fill=blue_line, width=3)
            x += dash_len + gap_len
        return x

    # First yellow (Received) center for intent animation
    first_yellow_center = (start_x, timeline_y)

    # --- Main original timeline ---
    # (No solid baseline; the blue dashed line itself is the visual indicator.)
    x_cursor = start_x

    # 1) Yellow rectangle (Received)
    draw_status_rect(x_cursor, timeline_y, yellow_status)
    x_cursor += rect_w // 2 + 20

    # 2) Blue dashed line (three dashes)
    x_cursor = draw_dashes(x_cursor, timeline_y, 3)

    # 3) Green rectangle (Compliant)
    x_cursor += 10
    draw_status_rect(x_cursor, timeline_y, green_status)

    # 4) Two more cycles: three blue dashes + green rectangle (twice)
    for _ in range(2):
        x_cursor = draw_dashes(x_cursor + rect_w // 2 + 20, timeline_y, 3)
        x_cursor += 10
        draw_status_rect(x_cursor, timeline_y, green_status)

    # 5) Extra three blue dashes between last green and first red
    x_cursor = draw_dashes(x_cursor + rect_w // 2 + 20, timeline_y, 3)

    # 6) Three times: red rectangle (Degraded) followed by three blue dashes
    x_cursor += 10
    for i in range(3):
        draw_status_rect(x_cursor, timeline_y, red_status, outline=(120, 0, 0))
        x_cursor = draw_dashes(x_cursor + rect_w // 2 + 20, timeline_y, 3)
        if i < 2:
            x_cursor += 10

    # 6) Red circle (conflict detected)
    conflict_x = x_cursor + 22
    conflict_r = 7
    d.ellipse(
        [
            conflict_x - conflict_r,
            timeline_y - conflict_r,
            conflict_x + conflict_r,
            timeline_y + conflict_r,
        ],
        fill=conflict_color,
        outline=(120, 0, 0),
        width=2,
    )

    # 7) Fork the timeline vertically for A, B, X
    branch_start_x = conflict_x + 24
    # Small connector from conflict circle to vertical branches (light gray)
    d.line([conflict_x + conflict_r + 6, timeline_y, branch_start_x, timeline_y], fill=base_line, width=1)

    branch_end_x = end_x

    # --- Intent owner box (above the timeline, inChat style) ---
    # ~2 cm above timeline, center-aligned with first yellow rectangle (start_x)
    gap_above_timeline = 76   # ~2 cm at 96 DPI
    intent_owner_w = 160
    intent_owner_h = 90
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
    text_height = FONT.size
    header_top = intent_owner_box[1] + 8
    header_bottom = header_top + text_height + 10
    header_bg = (intent_owner_box[0] + 10, header_top, intent_owner_box[2] - 10, header_bottom)
    d.rounded_rectangle(header_bg, radius=10, fill=header_colors_inchat)
    box_cx = (intent_owner_box[0] + intent_owner_box[2]) / 2
    text_y = (header_top + header_bottom) / 2
    d.text((box_cx, text_y), "Intent owner", font=FONT, fill=(10, 10, 10), anchor="mm")
    # Center of box (bottom-center for animation: intent goes down to first yellow)
    intent_owner_center = (start_x, timeline_y - gap_above_timeline - intent_owner_h // 2)

    # Animated intent: from Intent owner to first yellow (Received) when step == 0
    if step == 0 and 0 <= t <= 1:
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

    # Top: A, middle: B, bottom: X
    labels = ["A", "B", "X"]
    branch_ys = [timeline_y + off for off in branch_offsets]

    for label, by in zip(labels, branch_ys):
        # vertical from branch_start_x to branch_y (only vertical baseline)
        d.line([branch_start_x, timeline_y, branch_start_x, by], fill=base_line, width=1)

        # 8) On each forked timeline: blue rect, 3 blue dashes, green rect, 3 dashes, green, etc.
        x_b = branch_start_x + 20
        # Blue rectangle at branch start
        draw_status_rect(x_b, by, yellow_status)

        # A few cycles of (3 dashes + green rect)
        cycles = 3
        for _ in range(cycles):
            x_b = draw_dashes(x_b + rect_w // 2 + 20, by, 3)
            x_b += 10
            draw_status_rect(x_b, by, green_status)

        # Branch label at the right-hand side
        d.text(
            (branch_end_x + 10, by),
            f"Timeline {label}",
            font=FONT_SMALL,
            fill=(40, 40, 40),
            anchor="lm",
        )

    # Three vertical dots between Timeline B and Timeline X, centered horizontally and vertically
    y_A, y_B, y_X = branch_ys  # A (top), B (middle), X (bottom)
    dots_x = (branch_start_x + branch_end_x) / 2
    dot_r = 2
    dot_gap = 7
    mid_y = (y_B + y_X) / 2
    first_y = mid_y - dot_gap
    for i in range(3):
        cy = first_y + i * dot_gap
        d.ellipse(
            [
                dots_x - dot_r,
                cy - dot_r,
                dots_x + dot_r,
                cy + dot_r,
            ],
            fill=(60, 60, 60),
            outline=None,
        )

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


if args.layoutOnly:
    frames = [draw_scene(-1, 0.0)]
else:
    # Short initial pause
    frames += [draw_scene(-1, 0.0)] * 10
    # Blink IntentOwner, then step 0
    add_blink_frames("IntentOwner", -1, 0.0, duration_frames=20)
    for i in range(18):
        frames.append(draw_scene(0, i / 17))
    add_fancy_frames(0)
    frames += [draw_scene(-1, 0.0)] * 20

    # Blink Monitoring and main reports area, then step 1
    add_blink_frames("Monitoring", -1, 0.0, duration_frames=20)
    add_blink_frames("reports_main", -1, 0.0, duration_frames=12)
    for i in range(18):
        frames.append(draw_scene(1, i / 17))
    add_fancy_frames(1)
    frames += [draw_scene(-1, 0.0)] * 20
    # Blink inCoord / fork point, then step 2
    add_blink_frames("inCoord", -1, 0.0, duration_frames=16)
    add_blink_frames("fork", -1, 0.0, duration_frames=16)
    for i in range(18):
        frames.append(draw_scene(2, i / 17))
    add_fancy_frames(2)
    frames += [draw_scene(-1, 0.0)] * 20
    # Blink branch A, then step 3
    add_blink_frames("branch_A", -1, 0.0, duration_frames=20)
    for i in range(18):
        frames.append(draw_scene(3, i / 17))
    add_fancy_frames(3)
    frames += [draw_scene(-1, 0.0)] * 20
    # Blink branch B, then step 4
    add_blink_frames("branch_B", -1, 0.0, duration_frames=20)
    for i in range(18):
        frames.append(draw_scene(4, i / 17))
    add_fancy_frames(4)

    # Tail pause to read final state
    frames += [draw_scene(-1, 0.0)] * 80


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

