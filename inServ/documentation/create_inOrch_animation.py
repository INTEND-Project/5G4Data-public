import math, os, shutil, subprocess
from PIL import Image, ImageDraw, ImageFont

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
    "inServ": (70, 185, 360, 335),
    "inGraph": (795, 590, 895, 650),  # Below inOrch rectangle, centered (inOrch center x=845), moved down for arrow space
    "inOrch": (480, 170, 1210, 550),  # Shrunk to fit snugly around Kubernetes cluster
}

# Kubernetes cluster box inside inOrch - shrunk to fit snugly around components
# Components: leftmost x=520, rightmost x=1170, top y=250, bottom y=510
# Text "Kubernetes Cluster" at top needs ~30px space (12px offset + 18px font)
k8s_cluster = (500, 190, 1190, 530)  # Padding: 20px left/right, 20px top (for text), 20px bottom

# Components inside Kubernetes cluster - moved down below "Kubernetes Cluster" text
# Width calculation: cluster width 690, padding 20 each side, gap 50 between = (690-40-50)/2 = 300px per component
components = {
    "inOrch-TMF-Proxy": (520, 250, 820, 350),  # Top left, wider gap to Intel IDO
    "Intel IDO": (870, 250, 1170, 350),  # Top right, wider gap from inOrch-TMF-Proxy
    "Planner": (520, 410, 820, 510),  # Bottom left, moved down
    "Prometheus": (870, 410, 1170, 510),  # Bottom right, moved down
}

def draw_scene(step, t=0.0):
    img = Image.new("RGB", (W,H), (255,255,255))
    d = ImageDraw.Draw(img)

    title = "inOrch — Intent-Driven Workload Orchestration"
    d.text((40, 28), title, font=FONT_TITLE, fill=(15,15,15))
    d.line([40, 78, W-40, 78], fill=(200,200,200), width=2)

    # Draw inServ
    rounded_rectangle(d, boxes["inServ"])
    cx = (boxes["inServ"][0]+boxes["inServ"][2])//2
    d.text((cx, boxes["inServ"][1]+12), "inServ", font=FONT, fill=(10,10,10), anchor="ma")
    fit_and_draw_text(d, (boxes["inServ"][0], boxes["inServ"][1]+44, boxes["inServ"][2], boxes["inServ"][3]),
                      ["Sends workload intent", "to inOrch"], FONT_SMALL, padding=16, line_gap=6)

    # Draw inGraph
    rounded_rectangle(d, boxes["inGraph"], r=12, fill=(245,245,245))
    cx_graph = (boxes["inGraph"][0] + boxes["inGraph"][2]) // 2
    d.text((cx_graph, boxes["inGraph"][1]+10), "inGraph", font=FONT_SMALL, fill=(10,10,10), anchor="ma")
    # Draw workload KG circle - positioned to fit completely inside rectangle
    # Text takes ~18px, so circle center at text_bottom + padding + radius
    circle_y = boxes["inGraph"][1] + 10 + 18 + 12 + 5  # text top + text height + padding + radius + extra
    circle_radius = 12
    # Ensure circle fits: check if circle bottom (circle_y + radius) is within rectangle
    if circle_y + circle_radius > boxes["inGraph"][3] - 5:
        circle_y = boxes["inGraph"][3] - circle_radius - 5
    d.ellipse([cx_graph-circle_radius, circle_y-circle_radius, cx_graph+circle_radius, circle_y+circle_radius], 
             fill=(100,200,100), outline=(40,40,40), width=2)
    d.text((cx_graph, circle_y), "W", font=FONT_MICRO, fill=(255,255,255), anchor="mm")

    # Draw inOrch main box
    rounded_rectangle(d, boxes["inOrch"], fill=(250,250,250))
    d.text(((boxes["inOrch"][0]+boxes["inOrch"][2])//2, boxes["inOrch"][1]+12), "inOrch", font=FONT, fill=(10,10,10), anchor="ma")

    # Draw Kubernetes cluster box
    rounded_rectangle(d, k8s_cluster, r=14, fill=(240,248,255), outline=(100,149,237), width=3)
    d.text(((k8s_cluster[0]+k8s_cluster[2])//2, k8s_cluster[1]+12), "Kubernetes Cluster", font=FONT_SMALL, fill=(20,20,100), anchor="ma")

    # Draw components inside Kubernetes cluster
    comp_descriptions = {
        "inOrch-TMF-Proxy": [
            "• Receives & parses intents",
            "• Identify workload",
            "• Retrieve helm chart URL from inGraph",
            "• Deploy workload to k8s cluster namespace",
            "• Transform to IDO CRDs"
        ],
        "Intel IDO": ["• Intent CRD orchestration"],
        "Planner": ["• Workload optimization"],
        "Prometheus": ["• Metrics monitoring"],
    }
    for name, xy in components.items():
        rounded_rectangle(d, xy, r=10, fill=(255,255,255), outline=(60,60,60), width=2)
        cx_comp = (xy[0]+xy[2])//2
        d.text((cx_comp, xy[1]+6), name, font=FONT_TINY, fill=(10,10,10), anchor="ma")
        # Add descriptions
        desc = comp_descriptions.get(name, [])
        if desc:
            fit_and_draw_text(d, (xy[0], xy[1]+30, xy[2], xy[3]), desc, FONT_MICRO, padding=4, line_gap=2)

    # Arrows - positioned to avoid crossing rectangles
    # inServ to inOrch-TMF-Proxy (horizontal, connects at right edge of inServ to left edge of proxy)
    inServ_center_y = (boxes["inServ"][1] + boxes["inServ"][3]) // 2
    proxy_center_y = (components["inOrch-TMF-Proxy"][1] + components["inOrch-TMF-Proxy"][3]) // 2
    arrow(d, (boxes["inServ"][2], inServ_center_y), (components["inOrch-TMF-Proxy"][0], proxy_center_y))
    
    # inGraph to inOrch (workload info) - from top of inGraph to bottom of inOrch
    graph_top = boxes["inGraph"][1]
    graph_center_x = (boxes["inGraph"][0] + boxes["inGraph"][2]) // 2
    arrow(d, (graph_center_x, graph_top), (graph_center_x, boxes["inOrch"][3]))

    # Internal arrows within Kubernetes cluster - connect at edges
    proxy_right = components["inOrch-TMF-Proxy"][2]
    proxy_bottom = components["inOrch-TMF-Proxy"][3]
    ido_left = components["Intel IDO"][0]
    ido_center_y = (components["Intel IDO"][1] + components["Intel IDO"][3]) // 2
    ido_bottom = components["Intel IDO"][3]
    planner_left = components["Planner"][0]
    planner_top = components["Planner"][1]
    planner_center_y = (components["Planner"][1] + components["Planner"][3]) // 2
    prom_left = components["Prometheus"][0]
    prom_center_y = (components["Prometheus"][1] + components["Prometheus"][3]) // 2
    prom_top = components["Prometheus"][1]
    
    # inOrch-TMF-Proxy to Intel IDO (horizontal, right to left)
    arrow(d, (proxy_right, proxy_center_y), (ido_left, ido_center_y))
    # Intel IDO to Planner (vertical, bottom to top - route around to avoid crossing)
    arrow(d, (ido_left, ido_bottom), (planner_left, planner_top))
    # Prometheus to inOrch-TMF-Proxy (route upward to avoid crossing Intel IDO)
    arrow(d, (prom_left, prom_top), (proxy_right, proxy_bottom))

    # Outgoing arrows from inOrch - route to avoid crossing
    # To inGraph (store metrics) - from bottom of Prometheus to right side of inGraph
    prom_bottom = components["Prometheus"][3]
    prom_center_x = (components["Prometheus"][0] + components["Prometheus"][2]) // 2
    graph_right = boxes["inGraph"][2]
    graph_center_y = (boxes["inGraph"][1] + boxes["inGraph"][3]) // 2
    arrow(d, (prom_center_x, prom_bottom), (graph_right, graph_center_y))

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
    # Step 0: Intent from inServ to inOrch-TMF-Proxy
    p0s = (boxes["inServ"][2]-10, inServ_center_y)
    p0e = (components["inOrch-TMF-Proxy"][0]+10, proxy_center_y)
    
    # Step 1: Parsing (inside proxy)
    # Step 2: Deployment (from proxy to cluster)
    p2s = (components["inOrch-TMF-Proxy"][2]-10, proxy_center_y - 20)
    p2e = (k8s_cluster[0] + 50, k8s_cluster[1] + 50)
    
    # Step 3: Transform to IDO CRDs (from proxy to IDO)
    p3s = (proxy_right-10, proxy_center_y)
    p3e = (ido_left+10, ido_center_y)
    
    # Step 4: Monitoring and reporting
    # To inGraph (from bottom of Prometheus to right side of inGraph)
    prom_bottom = components["Prometheus"][3]
    prom_center_x = (components["Prometheus"][0] + components["Prometheus"][2]) // 2
    graph_right = boxes["inGraph"][2]
    graph_center_y = (boxes["inGraph"][1] + boxes["inGraph"][3]) // 2
    p4b_s = (prom_center_x, prom_bottom+10)
    p4b_e = (graph_right-10, graph_center_y)
    # From inGraph to inOrch (workload info - from top center to bottom of inOrch)
    graph_center_x = (boxes["inGraph"][0] + boxes["inGraph"][2]) // 2
    graph_top = boxes["inGraph"][1]
    p4c_s = (graph_center_x, graph_top+10)
    p4c_e = (graph_center_x, boxes["inOrch"][3]-10)

    if step == 0:
        # Intent flows from inServ to inOrch-TMF-Proxy
        x = p0s[0] + (p0e[0]-p0s[0]) * t
        y = p0s[1] + (p0e[1]-p0s[1]) * t
        draw_packet(x, y, "Workload Intent", fill=(230,250,230))
    elif step == 1:
        # Parsing and analysis
        draw_packet((components["inOrch-TMF-Proxy"][0]+components["inOrch-TMF-Proxy"][2])//2, proxy_center_y, 
                   "Parse & Analyze", fill=(255, 220, 180))
    elif step == 2:
        # Deployment to Kubernetes
        x = p2s[0] + (p2e[0]-p2s[0]) * t
        y = p2s[1] + (p2e[1]-p2s[1]) * t
        draw_packet(x, y, "Deploy (Helm)", fill=(200,230,255))
    elif step == 3:
        # Transform to IDO CRDs
        x = p3s[0] + (p3e[0]-p3s[0]) * t
        y = p3s[1] + (p3e[1]-p3s[1]) * t
        draw_packet(x, y, "IDO Intent CRD", fill=(255,240,200))
    elif step == 4:
        # Workload info from inGraph
        x1 = p4c_s[0] + (p4c_e[0]-p4c_s[0]) * t
        y1 = p4c_s[1] + (p4c_e[1]-p4c_s[1]) * t
        draw_packet(x1, y1, "Workload Info", fill=(100,200,100))
    elif step == 5:
        # Monitoring and reporting - store metrics in inGraph
        x2 = p4b_s[0] + (p4b_e[0]-p4b_s[0]) * t
        y2 = p4b_s[1] + (p4b_e[1]-p4b_s[1]) * t
        draw_packet(x2, y2, "Metrics", fill=(200,200,255))

    return img

# Frames
frames = []
# Step 0: Intent from inServ to inOrch-TMF-Proxy
for i in range(18):
    frames.append(draw_scene(0, i/17))
frames += [draw_scene(0, 1.0)] * 6
# Step 1: Parsing
frames += [draw_scene(1, 0.0)] * 12
# Step 2: Deployment
for i in range(18):
    frames.append(draw_scene(2, i/17))
frames += [draw_scene(2, 1.0)] * 6
# Step 3: Transform to IDO CRDs
for i in range(18):
    frames.append(draw_scene(3, i/17))
frames += [draw_scene(3, 1.0)] * 6
# Step 4: Workload info from inGraph
for i in range(18):
    frames.append(draw_scene(4, i/17))
frames += [draw_scene(4, 1.0)] * 6
# Step 5: Monitoring and reporting
for i in range(18):
    frames.append(draw_scene(5, i/17))
frames += [draw_scene(5, 1.0)] * 14

gif_path = "inOrch_animation.gif"
frames[0].save(gif_path, save_all=True, append_images=frames[1:], duration=70, loop=0, disposal=2)

mp4_path = "inOrch_animation.mp4"
ffmpeg = shutil.which("ffmpeg")
if ffmpeg:
    subprocess.run([ffmpeg, "-y", "-i", gif_path, "-movflags", "faststart", "-pix_fmt", "yuv420p", mp4_path],
                   check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

(gif_path, mp4_path if os.path.exists(mp4_path) and os.path.getsize(mp4_path)>0 else None)
