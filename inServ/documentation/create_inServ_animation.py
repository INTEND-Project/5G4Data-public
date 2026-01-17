import math, os, shutil, subprocess
from PIL import Image, ImageDraw, ImageFont

W, H = 1280, 820  # increased height to expand view area

def load_font(size):
    for p in [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    ]:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()

FONT_TITLE = load_font(32)
FONT = load_font(22)
FONT_SMALL = load_font(18)
FONT_TINY = load_font(15)
FONT_MICRO = load_font(13)

def rounded_rectangle(draw, xy, r=18, outline=(30,30,30), width=3, fill=(245,245,245)):
    x1,y1,x2,y2 = xy
    draw.rounded_rectangle([x1,y1,x2,y2], radius=r, outline=outline, width=width, fill=fill)

def arrow(draw, start, end, width=5):
    sx, sy = start
    ex, ey = end
    draw.line([sx, sy, ex, ey], fill=(40,40,40), width=width)
    angle = math.atan2(ey - sy, ex - sx)
    head_len = 18
    head_w = 10
    p1 = (ex, ey)
    p2 = (ex - head_len*math.cos(angle) + head_w*math.sin(angle),
          ey - head_len*math.sin(angle) - head_w*math.cos(angle))
    p3 = (ex - head_len*math.cos(angle) - head_w*math.sin(angle),
          ey - head_len*math.sin(angle) + head_w*math.cos(angle))
    draw.polygon([p1,p2,p3], fill=(40,40,40))

def text_width(font, s):
    return font.getlength(s)

def wrap_lines(lines, font, max_w):
    out = []
    for line in lines:
        bullet = ""
        core = line
        for pref in ["• ", "- "]:
            if core.startswith(pref):
                bullet = pref
                core = core[len(pref):]
                break
        words = core.split()
        if not words:
            out.append(line)
            continue
        cur = bullet
        for w in words:
            test = (cur + ("" if cur.endswith(("• ","- ")) else " ") + w) if cur.strip() else (bullet + w)
            if text_width(font, test) <= max_w:
                cur = test
            else:
                out.append(cur)
                cur = bullet + w
        if cur:
            out.append(cur)
    return out

def fit_and_draw_text(draw, box, lines, font, fill=(40,40,40), padding=14, line_gap=6, valign="top"):
    x1,y1,x2,y2 = box
    max_w = (x2-x1) - 2*padding
    max_h = (y2-y1) - 2*padding
    candidates = [font, FONT_TINY, FONT_MICRO, load_font(12)]
    used_font = candidates[-1]
    wrapped = None

    for f in candidates:
        w = wrap_lines(lines, f, max_w)
        total_h = len(w)* (f.size + line_gap) - line_gap
        if total_h <= max_h:
            used_font = f
            wrapped = w
            break
    if wrapped is None:
        f = used_font
        w = wrap_lines(lines, f, max_w)
        per = f.size + line_gap
        max_lines = max(1, (max_h + line_gap)//per)
        w = w[:max_lines]
        if w:
            last = w[-1]
            ell = "…"
            while text_width(f, last + ell) > max_w and len(last) > 0:
                last = last[:-1]
            w[-1] = (last + ell) if last else ell
        wrapped = w

    total_h = len(wrapped)* (used_font.size + line_gap) - line_gap
    if valign == "center":
        y = y1 + padding + (max_h - total_h)//2
    else:
        y = y1 + padding

    for line in wrapped:
        draw.text((x1+padding, y), line, font=used_font, fill=fill)
        y += used_font.size + line_gap

# Layout
boxes = {
    "inChat": (70, 120, 360, 270),
    "inServ": (70, 330, 360, 500),  # Moved down to make arrow from inChat longer
    "inOrch": (940, 220, 1210, 380),  # Adjusted to align with horizontal arrow at y=300
    "inNet":  (940, 470, 1210, 630),  # Adjusted to align with horizontal arrow at y=550
}
# Split box sized to fit snugly around subrectangles
# Top at 90 (for title), bottom at 678 (nw_rect ends at 660 + 18px padding)
split_box = (480, 90, 800, 678)

def draw_scene(step, t=0.0):
    img = Image.new("RGB", (W,H), (255,255,255))
    d = ImageDraw.Draw(img)

    title = "inServ Intent Handling — Combined Intent Split & Forward"
    d.text((40, 28), title, font=FONT_TITLE, fill=(15,15,15))
    d.line([40, 78, W-40, 78], fill=(200,200,200), width=2)

    for name, xy in boxes.items():
        rounded_rectangle(d, xy)
        cx = (xy[0]+xy[2])//2
        d.text((cx, xy[1]+12), name, font=FONT, fill=(10,10,10), anchor="ma")

    rounded_rectangle(d, split_box, fill=(250,250,250))
    d.text(((split_box[0]+split_box[2])//2, split_box[1]+12), "Split Result", font=FONT, fill=(10,10,10), anchor="ma")

    # Arrows
    # inChat to inServ: vertical arrow from bottom of inChat to top of inServ
    arrow(d, ((boxes["inChat"][0]+boxes["inChat"][2])//2, boxes["inChat"][3]), ((boxes["inServ"][0]+boxes["inServ"][2])//2, boxes["inServ"][1]))
    # inServ to Split Result: horizontal from right side of inServ to left side of Split Result
    inServ_center_y = (boxes["inServ"][1] + boxes["inServ"][3]) // 2
    arrow(d, (boxes["inServ"][2], inServ_center_y), (split_box[0], inServ_center_y))
    # Split Result to inOrch: horizontal at y=300
    arrow(d, (split_box[2], 300), (boxes["inOrch"][0], 300))
    # Split Result to inNet: horizontal at y=550
    arrow(d, (split_box[2], 550), (boxes["inNet"][0], 550))

    # Wrapped text inside main boxes
    intent_id = "data5g:I7475…aab6"
    combined_desc = "Combined Intent: Rusty-LLM Deployment and Network Slice"
    fit_and_draw_text(
        d,
        (boxes["inChat"][0], boxes["inChat"][1]+44, boxes["inChat"][2], boxes["inChat"][3]),
        ["Turtle intent", f"ID: {intent_id}", combined_desc],
        FONT_SMALL,
        padding=16, line_gap=6
    )

    fit_and_draw_text(
        d,
        (boxes["inServ"][0], boxes["inServ"][1]+44, boxes["inServ"][2], boxes["inServ"][3]),
        ["• Receives intent from inChat", "• Parses turtle", "• Detects combined intent", "• Splits by expectations"],
        FONT_SMALL,
        padding=16, line_gap=6
    )

    # Split cards sized to new split_box - Network Intent sized to fit text
    wl_rect = (split_box[0]+18, split_box[1]+60, split_box[2]-18, split_box[1]+320)
    # Network Intent rectangle sized to fit text: header (34px) + body (8 lines * 19px + padding 32px) ≈ 230px
    nw_rect = (split_box[0]+18, split_box[1]+340, split_box[2]-18, split_box[1]+570)
    rounded_rectangle(d, wl_rect, r=14, fill=(245,250,245))
    rounded_rectangle(d, nw_rect, r=14, fill=(245,245,250))

    d.text((wl_rect[0]+14, wl_rect[1]+10), "Workload Intent (to inOrch)", font=FONT_SMALL, fill=(20,60,20))
    wl_body = [
        "DeploymentExpectation",
        "• Application: rusty-llm",
        "• DataCenter: EC31",
        "• DeploymentDescriptor:",
        "  http://.../charts/rusty-llm.tgz",
        "ReportingExpectation: deployment metrics",
    ]
    fit_and_draw_text(d, (wl_rect[0], wl_rect[1]+34, wl_rect[2], wl_rect[3]),
                      wl_body, FONT_TINY, padding=16, line_gap=4)

    d.text((nw_rect[0]+14, nw_rect[1]+10), "Network Intent (to inNet)", font=FONT_SMALL, fill=(20,20,70))
    nw_body = [
        "NetworkExpectation (QoS slice)",
        "• Latency < 50 ms",
        "• Bandwidth > 300 mbit/s",
        "• P99 token target < 400 ms",
        "Context",
        "• Customer: +47 90914547",
        "• Region: geo polygon",
        "ReportingExpectation: slice metrics",
    ]
    fit_and_draw_text(d, (nw_rect[0], nw_rect[1]+34, nw_rect[2], nw_rect[3]),
                      nw_body, FONT_TINY, padding=16, line_gap=4)

    # Destinations
    fit_and_draw_text(d, (boxes["inOrch"][0], boxes["inOrch"][1]+44, boxes["inOrch"][2], boxes["inOrch"][3]),
                      ["• Deploy workload", "• Monitor deployment"], FONT_SMALL, padding=16, line_gap=6)
    fit_and_draw_text(d, (boxes["inNet"][0], boxes["inNet"][1]+44, boxes["inNet"][2], boxes["inNet"][3]),
                      ["• Create/adjust slice", "• Monitor QoS"], FONT_SMALL, padding=16, line_gap=6)

    # Packet
    def draw_packet(x, y, label, fill=(255, 245, 210)):
        pw, ph = 190, 46
        rr = (x-pw//2, y-ph//2, x+pw//2, y+ph//2)
        d.rounded_rectangle(rr, radius=12, fill=fill, outline=(80,80,80), width=2)
        lines = wrap_lines([label], FONT_MICRO, pw-24)
        if len(lines) > 1:
            f = load_font(12)
            lines = wrap_lines([label], f, pw-24)
            total_h = len(lines)* (f.size+2) - 2
            yy = y - total_h//2
            for ln in lines:
                d.text((x, yy + f.size//2), ln, font=f, fill=(20,20,20), anchor="mm")
                yy += f.size+2
        else:
            d.text((x, y), label, font=FONT_MICRO, fill=(20,20,20), anchor="mm")

    steps = {
        1: "1) inChat produces a combined intent (turtle).",
        2: "2) inServ receives the turtle intent.",
        3: "3) inServ parses and detects a combined intent (log:allOf contains workload + network expectations).",
        4: "4) inServ splits the intent and sends to Split Result.",
        5: "5) inServ splits into Workload Intent and Network Intent.",
        6: "6) inServ forwards Workload Intent to inOrch.",
        7: "7) inServ forwards Network Intent to inNet.",
    }
    footer_box = (40, H-80, W-40, H-20)
    d.rounded_rectangle(footer_box, radius=16, fill=(248,248,248), outline=(220,220,220), width=2)
    fit_and_draw_text(d, footer_box, [steps.get(step, "")], FONT_SMALL, padding=18, line_gap=4, valign="center", fill=(10,10,10))

    # Paths for animated packets
    p1s = ((boxes["inChat"][0]+boxes["inChat"][2])//2, boxes["inChat"][3]-10)
    p1e = ((boxes["inServ"][0]+boxes["inServ"][2])//2, boxes["inServ"][1]+10)
    # Path for split animation: from inServ to Split Result
    inServ_center_y = (boxes["inServ"][1] + boxes["inServ"][3]) // 2
    p2s = (boxes["inServ"][2]-10, inServ_center_y)
    p2e = (split_box[0]+10, inServ_center_y)
    p3s = (split_box[2]-10, 300)
    p3e = (boxes["inOrch"][0]+10, 300)
    p4s = (split_box[2]-10, 550)
    p4e = (boxes["inNet"][0]+10, 550)

    if step == 1:
        draw_packet((boxes["inChat"][0]+boxes["inChat"][2])//2, 195, "Combined Intent")
    elif step == 2:
        x = p1s[0] + (p1e[0]-p1s[0]) * t
        y = p1s[1] + (p1e[1]-p1s[1]) * t
        draw_packet(x, y, "Turtle Intent")
    elif step == 3:
        inServ_center_y = (boxes["inServ"][1] + boxes["inServ"][3]) // 2
        draw_packet((boxes["inServ"][0]+boxes["inServ"][2])//2, inServ_center_y, "Parse + Detect")
    elif step == 4:
        # Split animation: packet moving from inServ to Split Result
        x = p2s[0] + (p2e[0]-p2s[0]) * t
        y = p2s[1] + (p2e[1]-p2s[1]) * t
        draw_packet(x, y, "Split", fill=(255, 220, 180))
    elif step == 5:
        draw_packet((split_box[0]+split_box[2])//2, 300, "Workload Intent", fill=(230,250,230))
        draw_packet((split_box[0]+split_box[2])//2, 550, "Network Intent", fill=(230,230,255))
    elif step == 6:
        x = p3s[0] + (p3e[0]-p3s[0]) * t
        y = p3s[1] + (p3e[1]-p3s[1]) * t
        draw_packet(x, y, "Workload Intent", fill=(230,250,230))
    elif step == 7:
        x = p4s[0] + (p4e[0]-p4s[0]) * t
        y = p4s[1] + (p4e[1]-p4s[1]) * t
        draw_packet(x, y, "Network Intent", fill=(230,230,255))

    return img

# Frames
frames = []
frames += [draw_scene(1, 0.0)] * 10
for i in range(18):
    frames.append(draw_scene(2, i/17))
frames += [draw_scene(2, 1.0)] * 6
frames += [draw_scene(3, 0.0)] * 12
# New step 4: Split animation
for i in range(18):
    frames.append(draw_scene(4, i/17))
frames += [draw_scene(4, 1.0)] * 6
frames += [draw_scene(5, 0.0)] * 14
for i in range(18):
    frames.append(draw_scene(6, i/17))
frames += [draw_scene(6, 1.0)] * 8
for i in range(18):
    frames.append(draw_scene(7, i/17))
frames += [draw_scene(7, 1.0)] * 14

gif_path = "inServ_intent_animation_expanded.gif"
frames[0].save(gif_path, save_all=True, append_images=frames[1:], duration=70, loop=0, disposal=2)

mp4_path = "inServ_intent_animation_expanded.mp4"
ffmpeg = shutil.which("ffmpeg")
if ffmpeg:
    subprocess.run([ffmpeg, "-y", "-i", gif_path, "-movflags", "faststart", "-pix_fmt", "yuv420p", mp4_path],
                   check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

(gif_path, mp4_path if os.path.exists(mp4_path) and os.path.getsize(mp4_path)>0 else None)

