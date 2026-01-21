import argparse
import math, os, shutil, subprocess
from PIL import Image, ImageDraw, ImageFont

# Parse command line arguments
parser = argparse.ArgumentParser(description='Generate inOrch animation')
parser.add_argument('--layoutOnly', action='store_true', 
                    help='Only create the first frame to preview layout')
args = parser.parse_args()

W, H = 1280, 820

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
        # Preserve leading whitespace for continuation lines
        leading_ws = ""
        stripped_line = line.lstrip()
        if stripped_line != line:
            leading_ws = line[:len(line) - len(stripped_line)]
        
        bullet = ""
        core = stripped_line
        for pref in ["• ", "- "]:
            if core.startswith(pref):
                bullet = pref
                core = core[len(pref):]
                break
        words = core.split()
        if not words:
            out.append(line)
            continue
        prefix = leading_ws + bullet
        cur = prefix
        for w in words:
            test = (cur + ("" if cur.endswith(("• ","- ")) else " ") + w) if cur.strip() else (prefix + w)
            if text_width(font, test) <= max_w:
                cur = test
            else:
                out.append(cur)
                cur = prefix + w
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
        # Measure leading whitespace and apply as extra indentation
        stripped = line.lstrip()
        leading_spaces = len(line) - len(stripped)
        indent = text_width(used_font, " ") * leading_spaces
        draw.text((x1+padding+indent, y), stripped, font=used_font, fill=fill)
        y += used_font.size + line_gap

# Layout
# Moved inServ and inOrch left, reduced gap to 2/3 (from 120px to 80px)
# inGraph moved to right side of inOrch
boxes = {
    "inServ": (30, 320, 320, 470),  # Moved up by 35px
    "inGraph": (1150, 320, 1250, 470),  # Right side of inOrch, vertically centered with inServ
    "inOrch": (370, 100, 1130, 760),  # Expanded left by 30px
}

# Kubernetes cluster box inside inOrch - moved down to avoid covering "inOrch" text
# Text "Kubernetes Cluster" at top needs ~40px space (12px offset + 18px font + 10px extra)
k8s_cluster = (390, 145, 1110, 750)  # Expanded left to match inOrch

# Components inside Kubernetes cluster - more vertical spacing
# Workload namespaces taller to accommodate Prometheus oval inside
# Centered horizontally in Kubernetes cluster (k8s center x = 750)
workload_namespaces = (550, 180, 950, 250)  # 400px wide, 70px tall, re-centered

# inOrch-TMF-Proxy is now outside inOrch namespace, below Workload namespaces
# Same width as inOrch namespace rectangle
inorch_tmf_proxy = (410, 290, 1095, 390)  # Extended right for scheduler gap

# Components inside inOrch namespace (now only Intel IDO and Planner)
# More vertical spacing between components
components = {
    "Intel IDO": (420, 500, 720, 615),  # Expanded left
    "Planner": (770, 500, 1070, 615),  # Gap to right edge
}

# Scheduler stacked rectangles below Intel IDO and Planner
# With stacked offset of 5*2=10px, rightmost edge will be at 1080, leaving 30px gap to k8s (1110)
scheduler_rect = (420, 655, 1070, 710)  # Gap to right side of k8s cluster

def draw_scene(step, t=0.0):
    img = Image.new("RGB", (W,H), (255,255,255))
    d = ImageDraw.Draw(img)

    title = "inOrch — Intent-Driven Workload Orchestration"
    d.text((40, 28), title, font=FONT_TITLE, fill=(15,15,15))
    d.line([40, 78, W-40, 78], fill=(200,200,200), width=2)

    # Draw inServ
    rounded_rectangle(d, boxes["inServ"])
    cx = (boxes["inServ"][0]+boxes["inServ"][2])//2
    # Draw colored background for header text
    inServ_text_height = FONT.size
    inServ_header_top = boxes["inServ"][1] + 8
    inServ_header_bottom = inServ_header_top + inServ_text_height + 10
    inServ_header_bg = (boxes["inServ"][0]+10, inServ_header_top, boxes["inServ"][2]-10, inServ_header_bottom)
    d.rounded_rectangle(inServ_header_bg, radius=10, fill=(230,210,150))  # Light yellow/gold for inServ
    # Center text in the colored area
    inServ_text_y = (inServ_header_top + inServ_header_bottom) // 2
    d.text((cx, inServ_text_y), "inServ", font=FONT, fill=(10,10,10), anchor="mm")
    fit_and_draw_text(d, (boxes["inServ"][0], boxes["inServ"][1]+44, boxes["inServ"][2], boxes["inServ"][3]),
                      ["Sends workload intent", "to inOrch"], FONT_SMALL, padding=16, line_gap=6)

    # Draw inGraph
    rounded_rectangle(d, boxes["inGraph"], r=12, fill=(245,245,245))
    cx_graph = (boxes["inGraph"][0] + boxes["inGraph"][2]) // 2
    # Draw colored background for header text
    inGraph_text_height = FONT_SMALL.size
    inGraph_header_top = boxes["inGraph"][1] + 6
    inGraph_header_bottom = inGraph_header_top + inGraph_text_height + 8
    inGraph_header_bg = (boxes["inGraph"][0]+10, inGraph_header_top, boxes["inGraph"][2]-10, inGraph_header_bottom)
    d.rounded_rectangle(inGraph_header_bg, radius=8, fill=(200,210,230))  # Light gray-blue for inGraph
    # Center text in the colored area
    inGraph_text_y = (inGraph_header_top + inGraph_header_bottom) // 2
    d.text((cx_graph, inGraph_text_y), "inGraph", font=FONT_SMALL, fill=(10,10,10), anchor="mm")
    # Draw two circles stacked vertically: Workload KG (W) and Intent Observations (IO)
    # Position circles below the header background
    circle_radius = 12
    circle_spacing = 10
    # Workload KG circle (top)
    w_circle_y = inGraph_header_bottom + circle_radius + 12
    d.ellipse([cx_graph-circle_radius, w_circle_y-circle_radius, cx_graph+circle_radius, w_circle_y+circle_radius], 
             fill=(100,200,100), outline=(40,40,40), width=2)
    d.text((cx_graph, w_circle_y), "W", font=FONT_MICRO, fill=(255,255,255), anchor="mm")
    # Intent Observations circle (bottom) - purple color matching create_inServ_animation.py
    io_circle_y = w_circle_y + circle_radius * 2 + circle_spacing
    d.ellipse([cx_graph-circle_radius, io_circle_y-circle_radius, cx_graph+circle_radius, io_circle_y+circle_radius], 
             fill=(180,100,200), outline=(40,40,40), width=2)
    d.text((cx_graph, io_circle_y), "IO", font=load_font(10), fill=(255,255,255), anchor="mm")

    # Draw inOrch main box
    rounded_rectangle(d, boxes["inOrch"], fill=(250,250,250))
    cx_orch = (boxes["inOrch"][0]+boxes["inOrch"][2])//2
    # Draw colored background for header text
    inOrch_text_height = FONT.size
    inOrch_header_top = boxes["inOrch"][1] + 8
    inOrch_header_bottom = inOrch_header_top + inOrch_text_height + 10
    inOrch_header_bg = (boxes["inOrch"][0]+10, inOrch_header_top, boxes["inOrch"][2]-10, inOrch_header_bottom)
    d.rounded_rectangle(inOrch_header_bg, radius=10, fill=(220,180,200))  # Light pink/magenta for inOrch
    # Center text in the colored area
    inOrch_text_y = (inOrch_header_top + inOrch_header_bottom) // 2
    d.text((cx_orch, inOrch_text_y), "inOrch", font=FONT, fill=(10,10,10), anchor="mm")

    # Draw Kubernetes cluster box
    rounded_rectangle(d, k8s_cluster, r=14, fill=(240,248,255), outline=(100,149,237), width=3)
    d.text(((k8s_cluster[0]+k8s_cluster[2])//2, k8s_cluster[1]+12), "Kubernetes Cluster", font=FONT_SMALL, fill=(20,20,100), anchor="ma")

    # Legend at bottom
    legend_y = H - 45
    legend_items = [
        ("W", "Workload KG", (100,200,100)),
        ("IO", "Intent Observations KG", (180,100,200)),
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

    # Draw Workload namespaces with stacked effect (multiple rectangles offset)
    offset = 7  # Offset between stacked rectangles (moved apart)
    # Distinct colors for each layer
    stack_colors = [
        (235, 210, 210),  # Back - light pink/rose
        (240, 190, 190),  # Middle - light red
        (190, 210, 235),  # Front - light blue
    ]
    # Draw three rectangles with cascading effect
    for i in range(3):
        x1 = workload_namespaces[0] + i * offset
        y1 = workload_namespaces[1] + i * offset
        x2 = workload_namespaces[2] + i * offset
        y2 = workload_namespaces[3] + i * offset
        fill_color = stack_colors[i]
        rounded_rectangle(d, (x1, y1, x2, y2), r=10, fill=fill_color, outline=(60,60,60), width=2)
        # Only draw text on the topmost rectangle (shifted left to make room for Prometheus)
        if i == 2:
            cx_ns = (x1 + x2) // 2 - 30  # Shift text left to make room for Prometheus
            cy_ns = (y1 + y2) // 2
            d.text((cx_ns, cy_ns), "Workload namespaces", font=FONT_TINY, fill=(10,10,10), anchor="mm")
    # Draw ellipsis on the right side of the bottom rectangle to indicate more
    ellipsis_x = workload_namespaces[2] + offset * 2 - 15
    ellipsis_y = workload_namespaces[3] + offset * 2 - 8
    d.text((ellipsis_x, ellipsis_y), "...", font=FONT_TINY, fill=(100,100,100), anchor="mm")
    
    # Draw Prometheus oval inside the topmost Workload namespaces rectangle (on the right side)
    # Top rectangle coordinates after offset*2
    top_rect_x2 = workload_namespaces[2] + offset * 2
    top_rect_y1 = workload_namespaces[1] + offset * 2
    top_rect_y2 = workload_namespaces[3] + offset * 2
    prom_radius_x = 50  # Horizontal radius (wider for text)
    prom_radius_y = 25  # Vertical radius
    prom_circle_x = top_rect_x2 - prom_radius_x - 10  # Inside right edge with padding
    prom_circle_y = (top_rect_y1 + top_rect_y2) // 2  # Vertically centered
    d.ellipse([prom_circle_x-prom_radius_x, prom_circle_y-prom_radius_y, 
               prom_circle_x+prom_radius_x, prom_circle_y+prom_radius_y], 
              fill=(255,180,100), outline=(40,40,40), width=2)
    d.text((prom_circle_x, prom_circle_y), "Prometheus", font=FONT_TINY, fill=(10,10,10), anchor="mm")

    # Draw inOrch-TMF-Proxy (outside inOrch namespace, below Workload namespaces)
    rounded_rectangle(d, inorch_tmf_proxy, r=10, fill=(255,255,255), outline=(60,60,60), width=2)
    cx_proxy = (inorch_tmf_proxy[0] + inorch_tmf_proxy[2]) // 2
    # Draw colored background for header text
    proxy_text_height = FONT_TINY.size
    proxy_header_top = inorch_tmf_proxy[1] + 5
    proxy_header_bottom = proxy_header_top + proxy_text_height + 6
    proxy_header_bg = (inorch_tmf_proxy[0]+8, proxy_header_top, inorch_tmf_proxy[2]-8, proxy_header_bottom)
    d.rounded_rectangle(proxy_header_bg, radius=8, fill=(200,180,220))  # Light lavender/purple
    proxy_text_y = (proxy_header_top + proxy_header_bottom) // 2
    d.text((cx_proxy, proxy_text_y), "inOrch-TMF-Proxy", font=FONT_TINY, fill=(10,10,10), anchor="mm")
    # Two columns of bullet points
    proxy_desc_left = [
        "• Receives & parses intents",
        "• Identify workload",
        "• Retrieve helm chart URL from inGraph",
    ]
    proxy_desc_right = [
        "• Deploy workload to k8s namespace",
        "• Transform to IDO CRDs"
    ]
    # Left column
    fit_and_draw_text(d, (inorch_tmf_proxy[0], inorch_tmf_proxy[1]+30, cx_proxy, inorch_tmf_proxy[3]), 
                      proxy_desc_left, FONT_MICRO, padding=12, line_gap=2)
    # Right column
    fit_and_draw_text(d, (cx_proxy, inorch_tmf_proxy[1]+30, inorch_tmf_proxy[2], inorch_tmf_proxy[3]), 
                      proxy_desc_right, FONT_MICRO, padding=12, line_gap=2)

    # Draw inOrch namespace rectangle surrounding Intel IDO, Planner, and Scheduler
    # Components span: left=420, right=1070, top=500, bottom=710 (including scheduler)
    inorch_ns_rect = (410, 430, 1095, 740)  # Extended right for scheduler gap
    rounded_rectangle(d, inorch_ns_rect, r=12, fill=(248,252,248), outline=(80,80,80), width=2)
    # Draw header background (same color as component headers - light mint/seafoam green)
    inorch_ns_text_height = FONT_TINY.size
    inorch_ns_header_top = inorch_ns_rect[1] + 5
    inorch_ns_header_bottom = inorch_ns_header_top + inorch_ns_text_height + 6
    inorch_ns_header_bg = (inorch_ns_rect[0]+8, inorch_ns_header_top, inorch_ns_rect[2]-8, inorch_ns_header_bottom)
    d.rounded_rectangle(inorch_ns_header_bg, radius=8, fill=(200,230,210))  # Light mint/seafoam green
    # Center text in the colored area
    inorch_ns_cx = (inorch_ns_rect[0] + inorch_ns_rect[2]) // 2
    inorch_ns_text_y = (inorch_ns_header_top + inorch_ns_header_bottom) // 2
    d.text((inorch_ns_cx, inorch_ns_text_y), "inOrch namespace", font=FONT_TINY, fill=(10,10,10), anchor="mm")

    # Draw components inside inOrch namespace (Intel IDO and Planner)
    comp_descriptions = {
        "Intel IDO": ["• Intent CRD orchestration", "• Intent lifecycle management"],
        "Planner": ["• Workload optimization", "• Decision making"],
    }
    for name, xy in components.items():
        rounded_rectangle(d, xy, r=10, fill=(255,255,255), outline=(60,60,60), width=2)
        cx_comp = (xy[0]+xy[2])//2
        # Draw colored background for header text (light mint/seafoam green)
        comp_text_height = FONT_TINY.size
        comp_header_top = xy[1] + 5
        comp_header_bottom = comp_header_top + comp_text_height + 6
        comp_header_bg = (xy[0]+8, comp_header_top, xy[2]-8, comp_header_bottom)
        d.rounded_rectangle(comp_header_bg, radius=8, fill=(200,230,210))  # Light mint/seafoam green
        # Center text in the colored area
        comp_text_y = (comp_header_top + comp_header_bottom) // 2
        d.text((cx_comp, comp_text_y), name, font=FONT_TINY, fill=(10,10,10), anchor="mm")
        # Add descriptions
        desc = comp_descriptions.get(name, [])
        if desc:
            fit_and_draw_text(d, (xy[0], xy[1]+30, xy[2], xy[3]), desc, FONT_MICRO, padding=12, line_gap=2)
    
    # Draw Scheduler with stacked effect (under Intel IDO and Planner)
    sched_offset = 5
    sched_colors = [
        (235, 210, 210),  # Back - light pink/rose (matches Workload namespaces)
        (240, 190, 190),  # Middle - light red (matches Workload namespaces)
        (190, 210, 235),  # Front - light blue (matches Workload namespaces)
    ]
    for i in range(3):
        sx1 = scheduler_rect[0] + i * sched_offset
        sy1 = scheduler_rect[1] + i * sched_offset
        sx2 = scheduler_rect[2] + i * sched_offset
        sy2 = scheduler_rect[3] + i * sched_offset
        fill_color = sched_colors[i]
        rounded_rectangle(d, (sx1, sy1, sx2, sy2), r=10, fill=fill_color, outline=(60,60,60), width=2)
        if i == 2:
            sched_cx = (sx1 + sx2) // 2
            sched_cy = (sy1 + sy2) // 2
            d.text((sched_cx, sched_cy), "Scheduler", font=FONT_TINY, fill=(10,10,10), anchor="mm")

    # Arrows - positioned to avoid crossing rectangles
    # inServ to inOrch-TMF-Proxy (horizontal, connects at right edge of inServ to left edge of proxy)
    inServ_center_y = (boxes["inServ"][1] + boxes["inServ"][3]) // 2
    proxy_center_y = (inorch_tmf_proxy[1] + inorch_tmf_proxy[3]) // 2
    arrow(d, (boxes["inServ"][2], inServ_center_y), (inorch_tmf_proxy[0], proxy_center_y))
    
    # inGraph to inOrch (workload info) - from left of inGraph to right of inOrch
    # Moved down to avoid overlap with Prometheus to inGraph arrow, horizontal arrow
    graph_left = boxes["inGraph"][0]
    graph_lower_y = boxes["inGraph"][1] + (boxes["inGraph"][3] - boxes["inGraph"][1]) * 3 // 4  # 3/4 down
    inOrch_right = boxes["inOrch"][2]
    arrow(d, (graph_left, graph_lower_y), (inOrch_right, graph_lower_y))  # Same y for horizontal arrow

    # Internal arrows within Kubernetes cluster - connect at edges
    proxy_right = inorch_tmf_proxy[2]
    proxy_bottom = inorch_tmf_proxy[3]
    proxy_top = inorch_tmf_proxy[1]
    proxy_center_x = (inorch_tmf_proxy[0] + inorch_tmf_proxy[2]) // 2
    
    ido_left = components["Intel IDO"][0]
    ido_right = components["Intel IDO"][2]
    ido_top = components["Intel IDO"][1]
    ido_center_y = (components["Intel IDO"][1] + components["Intel IDO"][3]) // 2
    ido_center_x = (components["Intel IDO"][0] + components["Intel IDO"][2]) // 2
    ido_bottom = components["Intel IDO"][3]
    
    planner_left = components["Planner"][0]
    planner_top = components["Planner"][1]
    planner_center_y = (components["Planner"][1] + components["Planner"][3]) // 2
    planner_center_x = (components["Planner"][0] + components["Planner"][2]) // 2
    planner_right = components["Planner"][2]
    
    # inOrch-TMF-Proxy to Workload namespaces (vertical, from top center of proxy to bottom center of namespaces)
    namespaces_bottom = workload_namespaces[3] + 7 * 2  # Account for stack offset
    namespaces_center_x = (workload_namespaces[0] + workload_namespaces[2]) // 2 + 7  # Account for stack offset
    arrow(d, (proxy_center_x, proxy_top), (namespaces_center_x, namespaces_bottom))
    
    # inOrch-TMF-Proxy to Intel IDO (vertical down from proxy bottom to IDO top)
    arrow(d, (proxy_center_x, proxy_bottom), (ido_center_x, ido_top))
    
    # Intel IDO to Planner (horizontal, right to left)
    arrow(d, (ido_right, ido_center_y), (planner_left, planner_center_y))
    
    # Prometheus to Planner (from Prometheus oval bottom to top of Planner)
    arrow(d, (prom_circle_x, prom_circle_y + prom_radius_y), (planner_center_x, planner_top))
    
    # Intel IDO to Scheduler (from bottom of IDO to top of Scheduler)
    scheduler_top = scheduler_rect[1] + 5 * 2  # Account for stack offset
    scheduler_center_x = (scheduler_rect[0] + scheduler_rect[2]) // 2 + 5  # Account for stack offset
    arrow(d, (ido_center_x, ido_bottom), (scheduler_center_x - 100, scheduler_top))
    
    # Planner to Scheduler (from bottom of Planner to top of Scheduler)
    arrow(d, (planner_center_x, components["Planner"][3]), (scheduler_center_x + 100, scheduler_top))

    # Outgoing arrows from inOrch - route to avoid crossing
    # Prometheus to inGraph (store metrics) - from Prometheus oval right to left of inGraph
    graph_left = boxes["inGraph"][0]
    graph_center_y_prom = (boxes["inGraph"][1] + boxes["inGraph"][3]) // 2
    arrow(d, (prom_circle_x + prom_radius_x, prom_circle_y), (graph_left, graph_center_y_prom))

    # Packet drawing function
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

    # Animation paths
    # Step 0: Workload Info (from inGraph to inOrch - horizontal from right, moved down)
    graph_left_anim = boxes["inGraph"][0]
    graph_lower_y_anim = boxes["inGraph"][1] + (boxes["inGraph"][3] - boxes["inGraph"][1]) * 3 // 4
    inOrch_right_anim = boxes["inOrch"][2]
    p0s = (graph_left_anim-10, graph_lower_y_anim)
    p0e = (inOrch_right_anim+10, graph_lower_y_anim)  # Same y for horizontal animation
    
    # Step 1: Workload Intent (from inServ to inOrch-TMF-Proxy)
    p1s = (boxes["inServ"][2]-10, inServ_center_y)
    p1e = (inorch_tmf_proxy[0]+10, proxy_center_y)
    
    # Step 2: Parsing (inside proxy)
    # Step 3: Deployment (from top center of proxy to bottom center of Workload namespaces)
    p3s = (proxy_center_x, proxy_top+10)
    p3e = (namespaces_center_x, namespaces_bottom-10)
    
    # Step 4: Transform to IDO CRDs (from proxy bottom to IDO top)
    p4s = (proxy_center_x, proxy_bottom+10)
    p4e = (ido_center_x, ido_top-10)
    
    # Step 5: Deploy workload planner (from Intel IDO to Planner - horizontal)
    p5s = (ido_right+10, ido_center_y)
    p5e = (planner_left-10, planner_center_y)
    
    # Step 6: Metrics Observations (from Prometheus to inGraph AND from Prometheus to Planner in parallel)
    p6a_s = (prom_circle_x + prom_radius_x + 10, prom_circle_y)  # To inGraph (horizontal right)
    p6a_e = (graph_left - 10, graph_center_y_prom)
    p6b_s = (prom_circle_x, prom_circle_y + prom_radius_y + 10)  # To Planner
    p6b_e = (planner_center_x, planner_top-10)

    if step == 0:
        # Workload Info from inGraph to inOrch
        x = p0s[0] + (p0e[0]-p0s[0]) * t
        y = p0s[1] + (p0e[1]-p0s[1]) * t
        draw_packet(x, y, "Workload Info", fill=(100,200,100))
    elif step == 1:
        # Workload Intent flows from inServ to inOrch-TMF-Proxy
        x = p1s[0] + (p1e[0]-p1s[0]) * t
        y = p1s[1] + (p1e[1]-p1s[1]) * t
        draw_packet(x, y, "Workload Intent", fill=(230,250,230))
    elif step == 2:
        # Parsing and analysis
        draw_packet((inorch_tmf_proxy[0]+inorch_tmf_proxy[2])//2, proxy_center_y, 
                   "Parse & Analyze", fill=(255, 220, 180))
    elif step == 3:
        # Deployment to Kubernetes (Workload namespaces)
        x = p3s[0] + (p3e[0]-p3s[0]) * t
        y = p3s[1] + (p3e[1]-p3s[1]) * t
        draw_packet(x, y, "Deploy (Helm)", fill=(200,230,255))
    elif step == 4:
        # Transform to IDO CRDs
        x = p4s[0] + (p4e[0]-p4s[0]) * t
        y = p4s[1] + (p4e[1]-p4s[1]) * t
        draw_packet(x, y, "IDO Intent CRD", fill=(255,240,200))
    elif step == 5:
        # Deploy workload planner (from Intel IDO to Planner)
        x = p5s[0] + (p5e[0]-p5s[0]) * t
        y = p5s[1] + (p5e[1]-p5s[1]) * t
        draw_packet(x, y, "Deploy workload planner", fill=(240,240,255))
    elif step == 6:
        # Metrics Observations in parallel: from Prometheus to inGraph AND from Prometheus to Planner
        x1 = p6a_s[0] + (p6a_e[0]-p6a_s[0]) * t
        y1 = p6a_s[1] + (p6a_e[1]-p6a_s[1]) * t
        draw_packet(x1, y1, "Metrics Observations", fill=(180,100,200))
        x2 = p6b_s[0] + (p6b_e[0]-p6b_s[0]) * t
        y2 = p6b_s[1] + (p6b_e[1]-p6b_s[1]) * t
        draw_packet(x2, y2, "Metrics Observations", fill=(180,100,200))

    return img

# Frames
frames = []

if args.layoutOnly:
    # Only generate the first frame to preview layout
    frames = [draw_scene(-1, 0.0)]
    print("Layout-only mode: generating single frame...")
else:
    # Full animation
    # Initial pause: 16 seconds before any animation (4000ms / 70ms per frame ≈ 114 frames)
    frames += [draw_scene(-1, 0.0)] * 230
    # Step 0: Workload Info from inGraph to inOrch
    for i in range(18):
        frames.append(draw_scene(0, i/17))
    # Pause for 10 seconds after KG flow completes (10000ms / 70ms per frame ≈ 142 frames)
    frames += [draw_scene(0, 1.0)] * 142
    # Step 1: Workload Intent from inServ to inOrch-TMF-Proxy
    for i in range(18):
        frames.append(draw_scene(1, i/17))
    # Pause for 10 seconds after KG flow completes (10000ms / 70ms per frame ≈ 142 frames)
    frames += [draw_scene(1, 1.0)] * 30
    # Step 2: Parsing
    frames += [draw_scene(2, 0.0)] * 100
    # Step 3: Deployment to Workload namespaces
    for i in range(18):
        frames.append(draw_scene(3, i/17))
    # Pause for 10 seconds after KG flow completes (10000ms / 70ms per frame ≈ 142 frames)
    frames += [draw_scene(3, 1.0)] * 142
    # Step 4: Transform to IDO CRDs
    for i in range(18):
        frames.append(draw_scene(4, i/17))
    frames += [draw_scene(4, 1.0)] * 50
    # Step 5: Deploy workload planner
    for i in range(18):
        frames.append(draw_scene(5, i/17))
    frames += [draw_scene(5, 1.0)] * 50
    # Step 6: Metrics Observations (parallel: Prometheus to inGraph and Prometheus to Planner)
    for i in range(18):
        frames.append(draw_scene(6, i/17))
    frames += [draw_scene(6, 1.0)] * 142

gif_path = "inOrch_animation.gif"
frames[0].save(gif_path, save_all=True, append_images=frames[1:], duration=70, loop=0, disposal=2)

mp4_path = "inOrch_animation.mp4"
ffmpeg = shutil.which("ffmpeg")
if ffmpeg:
    subprocess.run([ffmpeg, "-y", "-i", gif_path, "-movflags", "faststart", "-pix_fmt", "yuv420p", mp4_path],
                   check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

if args.layoutOnly:
    print(f"Layout preview saved to: {gif_path}")
    if os.path.exists(mp4_path) and os.path.getsize(mp4_path) > 0:
        print(f"Layout preview saved to: {mp4_path}")
else:
    print(f"Animation saved to: {gif_path}")
    if os.path.exists(mp4_path) and os.path.getsize(mp4_path) > 0:
        print(f"Animation saved to: {mp4_path}")
