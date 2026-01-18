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

def load_bold_font(size):
    for p in [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    ]:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return load_font(size)  # Fallback to regular if bold not available

FONT_TITLE = load_font(32)
FONT = load_font(22)
FONT_SMALL = load_font(18)
FONT_SMALL_BOLD = load_bold_font(18)
FONT_TINY = load_font(15)
FONT_TINY_BOLD = load_bold_font(15)
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

# Layout - moved up 35px to give more space at the bottom
boxes = {
    # inGraph: header(30) + row1(24) + spacing(8) + row2(24) + padding(10) = 96px height
    "inGraph": (300, 345, 430, 441),  # Snug fit for 2 rows of circles
    "inChat": (70, 150, 360, 300),
    "inServ": (70, 490, 360, 660),  # Moved up
    "inOrch": (940, 250, 1210, 410),  # Adjusted to align with horizontal arrow at y=330
    "inNet":  (940, 500, 1210, 660),  # Adjusted to align with horizontal arrow at y=580
}
# Split box sized to fit snugly around subrectangles - moved up
# Top at 120, bottom at 725 (expanded to fit content)
# Width expanded from 800 to 830 to fit longer text lines
split_box = (480, 120, 830, 725)

def draw_scene(step, t=0.0):
    img = Image.new("RGB", (W,H), (255,255,255))
    d = ImageDraw.Draw(img)

    title = "inServ Intent Handling — If combined Intent => Split & Forward"
    d.text((40, 28), title, font=FONT_TITLE, fill=(15,15,15))
    d.line([40, 78, W-40, 78], fill=(200,200,200), width=2)

    for name, xy in boxes.items():
        if name == "inGraph":
            # Draw inGraph with five circles in 2 rows: I, W, P on row 1; IO, IN on row 2
            rounded_rectangle(d, xy, r=12, fill=(245,245,245))
            box_cx = (xy[0]+xy[2])//2
            # Draw colored background for header text (same style as other boxes)
            text_height = FONT_SMALL.size
            header_top = xy[1] + 6
            header_bottom = header_top + text_height + 8
            header_bg = (xy[0]+10, header_top, xy[2]-10, header_bottom)
            d.rounded_rectangle(header_bg, radius=8, fill=(200,210,230))  # Light gray-blue for inGraph
            # Center text in the colored area
            text_y = (header_top + header_bottom) // 2
            d.text((box_cx, text_y), name, font=FONT_SMALL, fill=(10,10,10), anchor="mm")
            
            header_height = 30
            available_width = (xy[2] - xy[0]) - 20  # Leave padding on sides
            available_height = (xy[3] - xy[1]) - header_height - 10  # Leave padding at bottom
            circle_radius = 12
            row_spacing = 8  # Vertical gap between rows
            
            # Row 1: 3 circles (I, W, P)
            row1_circles = 3
            row1_spacing = (available_width - row1_circles * circle_radius * 2) // (row1_circles + 1)
            row1_y = xy[1] + header_height + circle_radius + 5
            row1_x_start = xy[0] + 10 + circle_radius + row1_spacing
            
            # Infrastructure KG (blue) - "I"
            cx_i = row1_x_start
            d.ellipse([cx_i-circle_radius, row1_y-circle_radius, cx_i+circle_radius, row1_y+circle_radius], 
                     fill=(100,150,255), outline=(40,40,40), width=2)
            d.text((cx_i, row1_y), "I", font=FONT_MICRO, fill=(255,255,255), anchor="mm")
            # Workload KG (green) - "W"
            cx_w = cx_i + circle_radius * 2 + row1_spacing
            d.ellipse([cx_w-circle_radius, row1_y-circle_radius, cx_w+circle_radius, row1_y+circle_radius], 
                     fill=(100,200,100), outline=(40,40,40), width=2)
            d.text((cx_w, row1_y), "W", font=FONT_MICRO, fill=(255,255,255), anchor="mm")
            # Polygons KG (orange) - "P"
            cx_p = cx_w + circle_radius * 2 + row1_spacing
            d.ellipse([cx_p-circle_radius, row1_y-circle_radius, cx_p+circle_radius, row1_y+circle_radius], 
                     fill=(255,180,100), outline=(40,40,40), width=2)
            d.text((cx_p, row1_y), "P", font=FONT_MICRO, fill=(255,255,255), anchor="mm")
            
            # Row 2: 2 circles (IO, IN) - centered
            row2_circles = 2
            row2_spacing = (available_width - row2_circles * circle_radius * 2) // (row2_circles + 1)
            row2_y = row1_y + circle_radius * 2 + row_spacing
            row2_x_start = xy[0] + 10 + circle_radius + row2_spacing
            
            # Intent Observations (purple) - "IO"
            cx_io = row2_x_start
            d.ellipse([cx_io-circle_radius, row2_y-circle_radius, cx_io+circle_radius, row2_y+circle_radius], 
                     fill=(180,100,200), outline=(40,40,40), width=2)
            d.text((cx_io, row2_y), "IO", font=load_font(10), fill=(255,255,255), anchor="mm")
            # Intents (red) - "IN"
            cx_in = cx_io + circle_radius * 2 + row2_spacing
            d.ellipse([cx_in-circle_radius, row2_y-circle_radius, cx_in+circle_radius, row2_y+circle_radius], 
                     fill=(220,100,100), outline=(40,40,40), width=2)
            d.text((cx_in, row2_y), "IN", font=load_font(10), fill=(255,255,255), anchor="mm")
        else:
            rounded_rectangle(d, xy)
            cx = (xy[0]+xy[2])//2
            # Draw colored background for header text (snug fit to text height, full width)
            # Header colors - distinct from KG legend colors
            header_colors = {
                "inChat": (150,220,220),   # Light cyan/teal
                "inServ": (230,210,150),   # Light yellow/gold
                "inOrch": (220,180,200),   # Light pink/magenta
                "inNet": (180,190,210),    # Light slate/gray-blue
            }
            if name in header_colors:
                text_height = FONT.size
                # Move colored area down with 8px top margin, center text in colored area
                header_top = xy[1] + 8
                header_bottom = header_top + text_height + 10  # 5px padding top and bottom
                header_bg = (xy[0]+10, header_top, xy[2]-10, header_bottom)
                d.rounded_rectangle(header_bg, radius=10, fill=header_colors[name])
                # Center text in the colored area
                text_y = (header_top + header_bottom) // 2
                d.text((cx, text_y), name, font=FONT, fill=(10,10,10), anchor="mm")
            else:
                d.text((cx, xy[1]+12), name, font=FONT, fill=(10,10,10), anchor="ma")

    rounded_rectangle(d, split_box, fill=(250,250,250))
    # Draw colored background for "inServ Split Result" header (same color as inServ)
    split_text_height = FONT.size
    # Move colored area down with 8px top margin, center text in colored area
    split_header_top = split_box[1] + 8
    split_header_bottom = split_header_top + split_text_height + 10  # 5px padding top and bottom
    split_header_bg = (split_box[0]+10, split_header_top, split_box[2]-10, split_header_bottom)
    d.rounded_rectangle(split_header_bg, radius=10, fill=(230,210,150))  # inServ color
    # Center text in the colored area
    split_text_y = (split_header_top + split_header_bottom) // 2
    d.text(((split_box[0]+split_box[2])//2, split_text_y), "inServ Split Result", font=FONT, fill=(10,10,10), anchor="mm")

    # Legend at bottom
    legend_y = H - 45
    legend_items = [
        ("I", "Infrastructure KG", (100,150,255)),
        ("W", "Workload KG", (100,200,100)),
        ("P", "Polygons KG", (255,180,100)),
        ("IO", "Intent Observations KG", (180,100,200)),
        ("IN", "Intents KG", (220,100,100)),
    ]
    legend_x = 40
    circle_r = 10
    for abbrev, label, color in legend_items:
        # Draw circle
        d.ellipse([legend_x-circle_r, legend_y-circle_r, legend_x+circle_r, legend_y+circle_r],
                  fill=color, outline=(40,40,40), width=2)
        # Draw abbreviation in circle
        abbrev_font = load_font(9) if len(abbrev) > 1 else FONT_MICRO
        d.text((legend_x, legend_y), abbrev, font=abbrev_font, fill=(255,255,255), anchor="mm")
        # Draw label text
        d.text((legend_x + circle_r + 6, legend_y), label, font=FONT_TINY, fill=(40,40,40), anchor="lm")
        # Move to next item
        legend_x += circle_r * 2 + 10 + int(text_width(FONT_TINY, label)) + 25

    # Arrows
    # inGraph to inChat: from top left of inGraph to bottom center of inChat
    arrow(d, (boxes["inGraph"][0], boxes["inGraph"][1]), ((boxes["inChat"][0]+boxes["inChat"][2])//2, boxes["inChat"][3]))
    # inGraph to inServ: from bottom left of inGraph to top center of inServ
    arrow(d, (boxes["inGraph"][0], boxes["inGraph"][3]), ((boxes["inServ"][0]+boxes["inServ"][2])//2, boxes["inServ"][1]))
    # inGraph to Split Result: from center right of inGraph to center of left side of Split Result
    inGraph_center_y = (boxes["inGraph"][1] + boxes["inGraph"][3]) // 2
    split_box_center_y = (split_box[1] + split_box[3]) // 2
    arrow(d, (boxes["inGraph"][2], inGraph_center_y), (split_box[0], split_box_center_y))
    # inChat to inServ: vertical arrow from bottom of inChat to top of inServ
    arrow(d, ((boxes["inChat"][0]+boxes["inChat"][2])//2, boxes["inChat"][3]), ((boxes["inServ"][0]+boxes["inServ"][2])//2, boxes["inServ"][1]))
    # inServ to Split Result: horizontal from right side of inServ to center of left side of Split Result
    inServ_center_y = (boxes["inServ"][1] + boxes["inServ"][3]) // 2
    arrow(d, (boxes["inServ"][2], inServ_center_y), (split_box[0], split_box_center_y))
    # Split Result to inOrch: horizontal at y=330 (moved up)
    arrow(d, (split_box[2], 330), (boxes["inOrch"][0], 330))
    # Split Result to inNet: horizontal at y=580 (moved up)
    arrow(d, (split_box[2], 580), (boxes["inNet"][0], 580))

    # Wrapped text inside main boxes
    intent_id = "data5g:I7475…aab6"
    combined_desc = "Combined Intent: Rusty-LLM Deployment and Network Slice"
    # Draw inChat text with "Intent:" in bold
    inchat_text_y = boxes["inChat"][1] + 44 + 16  # Start y position (box top + header offset + padding)
    line_gap = 6
    # Intent: (bold)
    d.text((boxes["inChat"][0]+16, inchat_text_y), "Intent:", font=FONT_SMALL_BOLD, fill=(40,40,40))
    inchat_text_y += FONT_SMALL_BOLD.size + line_gap
    # ID line (regular)
    d.text((boxes["inChat"][0]+16, inchat_text_y), f"ID: {intent_id}", font=FONT_SMALL, fill=(40,40,40))
    inchat_text_y += FONT_SMALL.size + line_gap
    # Combined description - use fit_and_draw_text for wrapping
    fit_and_draw_text(
        d,
        (boxes["inChat"][0], inchat_text_y - 16, boxes["inChat"][2], boxes["inChat"][3]),
        [combined_desc],
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
    # Deployment Intent rectangle - expanded height to fit extra line (7 lines now)
    # header (34px) + body (7 lines * 19px + padding 32px) = 34 + 133 + 32 = 199px, use 210px
    wl_rect = (split_box[0]+18, split_box[1]+60, split_box[2]-18, split_box[1]+340)
    # Network Intent rectangle sized to fit text: header (34px) + body (9 lines * 19px + padding 32px) ≈ 240px
    nw_rect = (split_box[0]+18, split_box[1]+360, split_box[2]-18, split_box[1]+600)
    rounded_rectangle(d, wl_rect, r=14, fill=(245,250,245))
    rounded_rectangle(d, nw_rect, r=14, fill=(245,245,250))

    d.text((wl_rect[0]+14, wl_rect[1]+10), "Deployment Intent (to inOrch)", font=FONT_SMALL, fill=(20,60,20))
    # Draw body with bold for Expectation lines
    wl_body_y = wl_rect[1] + 34 + 16  # Start y position (box top + header + padding)
    line_gap = 4
    # DeploymentExpectation (bold)
    d.text((wl_rect[0]+16, wl_body_y), "DeploymentExpectation", font=FONT_TINY_BOLD, fill=(40,40,40))
    wl_body_y += FONT_TINY_BOLD.size + line_gap
    # Regular body lines
    regular_lines = [
        "• Application: rusty-llm",
        "• DataCenter: EC31",
        "• DeploymentDescriptor:",
        "  http://.../charts/rusty-llm.tgz",
    ]
    for line in regular_lines:
        d.text((wl_rect[0]+16, wl_body_y), line, font=FONT_TINY, fill=(40,40,40))
        wl_body_y += FONT_TINY.size + line_gap
    # ReportingExpectation: (bold)
    d.text((wl_rect[0]+16, wl_body_y), "ReportingExpectation:", font=FONT_TINY_BOLD, fill=(40,40,40))
    wl_body_y += FONT_TINY_BOLD.size + line_gap
    # Deployment metrics as bullet point (capital D)
    d.text((wl_rect[0]+16, wl_body_y), "• Deployment metrics", font=FONT_TINY, fill=(40,40,40))

    d.text((nw_rect[0]+14, nw_rect[1]+10), "Network Intent (to inNet)", font=FONT_SMALL, fill=(20,20,70))
    # Draw body with bold for specific lines
    nw_body_y = nw_rect[1] + 34 + 16  # Start y position (box top + header + padding)
    nw_line_gap = 4
    # NetworkExpectation (QoS slice): (bold)
    d.text((nw_rect[0]+16, nw_body_y), "NetworkExpectation (QoS slice):", font=FONT_TINY_BOLD, fill=(40,40,40))
    nw_body_y += FONT_TINY_BOLD.size + nw_line_gap
    # Regular bullet lines under NetworkExpectation
    nw_regular_lines1 = [
        "• Latency < 50 ms",
        "• Bandwidth > 300 mbit/s",
        "• P99 token target < 400 ms",
    ]
    for line in nw_regular_lines1:
        d.text((nw_rect[0]+16, nw_body_y), line, font=FONT_TINY, fill=(40,40,40))
        nw_body_y += FONT_TINY.size + nw_line_gap
    # Context: (bold)
    d.text((nw_rect[0]+16, nw_body_y), "Context:", font=FONT_TINY_BOLD, fill=(40,40,40))
    nw_body_y += FONT_TINY_BOLD.size + nw_line_gap
    # Regular bullet lines under Context
    nw_regular_lines2 = [
        "• Customer: +47 90914547",
        "• Region: geo polygon",
    ]
    for line in nw_regular_lines2:
        d.text((nw_rect[0]+16, nw_body_y), line, font=FONT_TINY, fill=(40,40,40))
        nw_body_y += FONT_TINY.size + nw_line_gap
    # ReportingExpectation: (bold)
    d.text((nw_rect[0]+16, nw_body_y), "ReportingExpectation:", font=FONT_TINY_BOLD, fill=(40,40,40))
    nw_body_y += FONT_TINY_BOLD.size + nw_line_gap
    # Slice metrics as bullet point
    d.text((nw_rect[0]+16, nw_body_y), "• Slice metrics", font=FONT_TINY, fill=(40,40,40))

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

    # steps = {
    #     0: "0) Knowledge graphs flow from inGraph to inChat (Infrastructure, Workload, Polygons), to inServ (Infrastructure, Workload), and to Split Result (Infrastructure) in parallel.",
    #     1: "1) inChat produces a combined intent (turtle).",
    #     2: "2) inServ receives the turtle intent.",
    #     3: "3) inServ parses and detects a combined intent (log:allOf contains workload + network expectations).",
    #     4: "4) inServ splits the intent and sends to Split Result.",
    #     5: "5) inServ splits into Workload Intent and Network Intent.",
    #     6: "6) inServ forwards Workload Intent to inOrch.",
    #     7: "7) inServ forwards Network Intent to inNet.",
    # }
    # footer_box = (40, H-80, W-40, H-20)
    # d.rounded_rectangle(footer_box, radius=16, fill=(248,248,248), outline=(220,220,220), width=2)
    # fit_and_draw_text(d, footer_box, [steps.get(step, "")], FONT_SMALL, padding=18, line_gap=4, valign="center", fill=(10,10,10))

    # Paths for animated packets
    # KG positions in inGraph (circles) - match the horizontal distribution in drawing code
    header_height = 30
    available_width = (boxes["inGraph"][2] - boxes["inGraph"][0]) - 20  # Leave padding on sides
    circle_radius = 12
    # Calculate spacing to distribute three circles evenly horizontally (same as drawing code)
    kg_spacing = (available_width - 3 * circle_radius * 2) // 4
    kg_inf_x = boxes["inGraph"][0] + 10 + circle_radius + kg_spacing  # Infrastructure KG x position
    kg_wl_x = kg_inf_x + circle_radius * 2 + kg_spacing  # Workload KG x position
    kg_poly_x = kg_wl_x + circle_radius * 2 + kg_spacing  # Polygons KG x position
    # All circles at same y position (centered vertically)
    available_height = (boxes["inGraph"][3] - boxes["inGraph"][1]) - header_height
    kg_y = boxes["inGraph"][1] + header_height + available_height // 2  # All KGs at same y
    
    # Paths for KG flows to inChat (all three) - spread horizontally to avoid overlap
    chat_center_x = (boxes["inChat"][0] + boxes["inChat"][2]) // 2
    chat_spread = 70  # horizontal spread between packet endpoints
    kg_to_chat_s = (kg_inf_x - circle_radius - 5, kg_y)
    kg_to_chat_e = (chat_center_x - chat_spread, boxes["inChat"][3] - 10)  # Left position
    kg_wl_to_chat_s = (kg_wl_x - circle_radius - 5, kg_y)
    kg_wl_to_chat_e = (chat_center_x, boxes["inChat"][3] - 10)  # Center position
    kg_poly_to_chat_s = (kg_poly_x - circle_radius - 5, kg_y)
    kg_poly_to_chat_e = (chat_center_x + chat_spread, boxes["inChat"][3] - 10)  # Right position
    
    # Paths for KG flows to inServ (infrastructure and workload only) - spread horizontally
    serv_center_x = (boxes["inServ"][0] + boxes["inServ"][2]) // 2
    serv_spread = 50  # horizontal spread between packet endpoints
    kg_to_serv_s = (kg_inf_x - circle_radius - 5, kg_y)
    kg_to_serv_e = (serv_center_x - serv_spread, boxes["inServ"][1] + 10)  # Left position
    kg_wl_to_serv_s = (kg_wl_x - circle_radius - 5, kg_y)
    kg_wl_to_serv_e = (serv_center_x + serv_spread, boxes["inServ"][1] + 10)  # Right position
    
    # Path for infrastructure KG flow to Split Result (from right side of inGraph)
    split_box_center_y = (split_box[1] + split_box[3]) // 2
    kg_to_split_s = (boxes["inGraph"][2] - 10, kg_y)
    kg_to_split_e = (split_box[0] + 10, split_box_center_y)
    
    # Original paths (renumbered)
    p1s = ((boxes["inChat"][0]+boxes["inChat"][2])//2, boxes["inChat"][3]-10)
    p1e = ((boxes["inServ"][0]+boxes["inServ"][2])//2, boxes["inServ"][1]+10)
    # Path for split animation: from inServ to Split Result (center of left side)
    inServ_center_y = (boxes["inServ"][1] + boxes["inServ"][3]) // 2
    split_box_center_y = (split_box[1] + split_box[3]) // 2
    p2s = (boxes["inServ"][2]-10, inServ_center_y)
    p2e = (split_box[0]+10, split_box_center_y)
    p3s = (split_box[2]-10, 330)  # Moved up
    p3e = (boxes["inOrch"][0]+10, 330)  # Moved up
    p4s = (split_box[2]-10, 580)  # Moved up
    p4e = (boxes["inNet"][0]+10, 580)  # Moved up

    if step == 0:
        # Flow from all three KGs to inChat AND from infrastructure and workload KG to inServ AND infrastructure KG to Split Result (parallel)
        # Vertical offsets to stack packets and avoid overlap (offset applied during middle of animation)
        v_offset = 55  # vertical spacing between stacked packets
        
        # To inChat - stacked vertically with offsets
        x1 = kg_to_chat_s[0] + (kg_to_chat_e[0]-kg_to_chat_s[0]) * t
        y1 = kg_to_chat_s[1] + (kg_to_chat_e[1]-kg_to_chat_s[1]) * t - v_offset
        x2 = kg_wl_to_chat_s[0] + (kg_wl_to_chat_e[0]-kg_wl_to_chat_s[0]) * t
        y2 = kg_wl_to_chat_s[1] + (kg_wl_to_chat_e[1]-kg_wl_to_chat_s[1]) * t
        x3 = kg_poly_to_chat_s[0] + (kg_poly_to_chat_e[0]-kg_poly_to_chat_s[0]) * t
        y3 = kg_poly_to_chat_s[1] + (kg_poly_to_chat_e[1]-kg_poly_to_chat_s[1]) * t + v_offset
        draw_packet(x1, y1, "Infra KG", fill=(100,150,255))
        draw_packet(x2, y2, "Workload KG", fill=(100,200,100))
        draw_packet(x3, y3, "Polygons KG", fill=(255,180,100))
        # To inServ (parallel) - stacked vertically with offsets
        x4 = kg_to_serv_s[0] + (kg_to_serv_e[0]-kg_to_serv_s[0]) * t
        y4 = kg_to_serv_s[1] + (kg_to_serv_e[1]-kg_to_serv_s[1]) * t - v_offset // 2
        x5 = kg_wl_to_serv_s[0] + (kg_wl_to_serv_e[0]-kg_wl_to_serv_s[0]) * t
        y5 = kg_wl_to_serv_s[1] + (kg_wl_to_serv_e[1]-kg_wl_to_serv_s[1]) * t + v_offset // 2
        draw_packet(x4, y4, "Infra KG", fill=(100,150,255))
        draw_packet(x5, y5, "Workload KG", fill=(100,200,100))
        # To Split Result (parallel)
        x6 = kg_to_split_s[0] + (kg_to_split_e[0]-kg_to_split_s[0]) * t
        y6 = kg_to_split_s[1] + (kg_to_split_e[1]-kg_to_split_s[1]) * t
        draw_packet(x6, y6, "Infra KG", fill=(100,150,255))
    elif step == 1:
        draw_packet((boxes["inChat"][0]+boxes["inChat"][2])//2, (boxes["inChat"][1]+boxes["inChat"][3])//2, "Combined Intent")
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
        draw_packet((split_box[0]+split_box[2])//2, 330, "Workload Intent", fill=(230,250,230))  # Moved up
        draw_packet((split_box[0]+split_box[2])//2, 580, "Network Intent", fill=(230,230,255))  # Moved up
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
# Initial pause: 5 seconds before any animation (5000ms / 70ms per frame ≈ 71 frames)
# Use a static scene with no animated packets (we'll use step -1 or step 0 at t=0 without drawing packets)
frames += [draw_scene(-1, 0.0)] * 71
# Step 0: KG flows to inChat (all three) AND to inServ (infrastructure and workload) in parallel
for i in range(18):
    frames.append(draw_scene(0, i/17))
# Pause for 4 seconds after KG flow completes (4000ms / 70ms per frame ≈ 57 frames)
frames += [draw_scene(0, 1.0)] * 57
frames += [draw_scene(1, 0.0)] * 10
for i in range(18):
    frames.append(draw_scene(2, i/17))
frames += [draw_scene(2, 1.0)] * 6
frames += [draw_scene(3, 0.0)] * 12
# Step 4: Split animation
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

gif_path = "inServ_intent_animation.gif"
frames[0].save(gif_path, save_all=True, append_images=frames[1:], duration=70, loop=0, disposal=2)

mp4_path = "inServ_intent_animation.mp4"
ffmpeg = shutil.which("ffmpeg")
if ffmpeg:
    subprocess.run([ffmpeg, "-y", "-i", gif_path, "-movflags", "faststart", "-pix_fmt", "yuv420p", mp4_path],
                   check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

(gif_path, mp4_path if os.path.exists(mp4_path) and os.path.getsize(mp4_path)>0 else None)

