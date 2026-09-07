"""Eevee flyby clips for the web page. Does not save the .blend.
Run: Blender -b newton_cenotaph.blend -P render_flyby.py -- approach vault orbit
Add --quick for a 25% test at 8 fps.
"""
import bpy, sys, os, time, math, mathutils
sc = bpy.context.scene; O = bpy.data.objects; W = bpy.data.worlds
here = os.path.dirname(bpy.data.filepath)
out = os.path.join(here, "docs", "media"); os.makedirs(out, exist_ok=True)
args = sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else []
quick = "--quick" in args; clips = [a for a in args if not a.startswith("--")] or ["approach", "vault", "orbit"]
FPS = 8 if quick else 24

sc.render.engine = 'BLENDER_EEVEE'
sc.eevee.taa_render_samples = 16 if quick else 48
sc.eevee.use_shadows = True; sc.eevee.shadow_ray_count = 2; sc.eevee.shadow_step_count = 4
sc.eevee.volumetric_tile_size = '8'; sc.eevee.volumetric_samples = 64
sc.render.fps = FPS
sc.render.resolution_x, sc.render.resolution_y = 1280, 720
sc.render.resolution_percentage = 25 if quick else 100
# this Blender build has no video encoder: render PNG frames, then encode with ffmpeg
import subprocess, shutil
sc.render.image_settings.file_format = 'PNG'; sc.render.image_settings.color_mode = 'RGB'
FFMPEG = shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"
sc.view_settings.view_transform = 'AgX'

def catmull(pts, u):
    n = len(pts) - 1; u = max(0.0, min(0.999999, u)); seg = int(u * n); t = u * n - seg
    p0 = pts[max(seg-1, 0)]; p1 = pts[seg]; p2 = pts[min(seg+1, n)]; p3 = pts[min(seg+2, n)]
    return 0.5 * ((2*p1) + (-p0 + p2)*t + (2*p0 - 5*p1 + 4*p2 - p3)*t*t + (-p0 + 3*p1 - 3*p2 + p3)*t*t*t)
def ease(u): return u*u*(3-2*u)

def stars_node():
    return O["SphereShell"].data.materials[0].node_tree.nodes["StarsOn"].outputs[0]
def world_bg(w):
    return [n for n in w.node_tree.nodes if n.type == 'BACKGROUND'][0].inputs['Strength']
def ensure_volume(w):
    nt = w.node_tree; outn = [n for n in nt.nodes if n.type == 'OUTPUT_WORLD'][0]
    if outn.inputs['Volume'].is_linked: return outn.inputs['Volume'].links[0].from_node.inputs['Density']
    vs = nt.nodes.new('ShaderNodeVolumeScatter'); vs.inputs['Anisotropy'].default_value = 0.35
    vs.inputs['Density'].default_value = 0.0; nt.links.new(vs.outputs[0], outn.inputs['Volume']); return vs.inputs['Density']
def lamp_strength():
    return [n for n in bpy.data.materials["LampEmission"].node_tree.nodes if n.type == 'EMISSION'][0].inputs['Strength']
def moon_strength():
    return [n for n in bpy.data.materials["MoonEmission"].node_tree.nodes if n.type == 'MIX'][0].inputs[3]

def set_day(day):
    stars_node().default_value = 1.0 if day else 0.0
    O["Sun"].data.energy = 5.0 if day else 0.0
    O["TombGlow"].data.energy = 900 if day else 0.0
    O["ArmillaryLamp"].data.energy = 0.0 if day else 1.6e6   # Eevee needs far less than Cycles here
    lamp_strength().default_value = 0.0 if day else 120.0
    moon_strength().default_value = 80.0 if day else 0.0
    world_bg(W["Day sky"]).default_value = 0.05 if day else 0.002
    ensure_volume(W["Day sky"]).default_value = 0.0 if day else 0.0015
def key_day(frame):
    for tgt, attr in [(stars_node(), 'default_value'), (O["Sun"].data, 'energy'), (O["TombGlow"].data, 'energy'),
                      (O["ArmillaryLamp"].data, 'energy'), (lamp_strength(), 'default_value'), (moon_strength(), 'default_value'),
                      (world_bg(W["Day sky"]), 'default_value'), (ensure_volume(W["Day sky"]), 'default_value')]:
        tgt.keyframe_insert(attr, frame=frame)

for ob in ("ArmillaryLamp", "LampSun", "TombGlow", "Moon"): O[ob].hide_render = False
sc.world = W["Day sky"]
for ob in O:
    m = ob.modifiers.get("SECTION")
    if m: m.show_render = False
    if ob.name.endswith("_SectionHalf"): ob.hide_render = True

cam = bpy.data.objects.new("FlyCam", bpy.data.cameras.new("FlyCam")); sc.collection.objects.link(cam)
cam.data.clip_end = 6000; cam.data.clip_start = 0.3; sc.camera = cam

def animate_path(P, T, frames, lens):
    cam.data.lens = lens
    P = [mathutils.Vector(p) for p in P]; T = [mathutils.Vector(t) for t in T]
    for f in range(frames):
        u = ease(f / (frames - 1))
        pos = catmull(P, u); tgt = catmull(T, u)
        cam.location = pos; cam.rotation_euler = (tgt - pos).to_track_quat('-Z', 'Y').to_euler()
        cam.keyframe_insert('location', frame=f+1); cam.keyframe_insert('rotation_euler', frame=f+1)
    sc.frame_start, sc.frame_end = 1, frames

def render(name):
    frames_dir = os.path.join(out, "frames_" + name); shutil.rmtree(frames_dir, ignore_errors=True); os.makedirs(frames_dir)
    sc.render.filepath = os.path.join(frames_dir, "f_")
    t = time.time(); bpy.ops.render.render(animation=True)
    mp4 = os.path.join(out, name + ("_quick" if quick else "") + ".mp4")
    subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-framerate", str(FPS), "-i", os.path.join(frames_dir, "f_%04d.png"),
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "22", "-movflags", "+faststart", mp4], check=True)
    shutil.rmtree(frames_dir, ignore_errors=True)
    print(f"RENDERED {name} ({sc.frame_end} frames) in {time.time()-t:.0f}s -> {os.path.getsize(mp4)//1024} KB", flush=True)

if "approach" in clips:
    # along the entrance axis, under the notch, into the tunnel, up to the tomb
    P = [(80,-700,55), (30,-380,32), (0,-230,16), (0,-130,9.5), (0,-62,8.3), (0,-40,8.3), (0,-24,8.3), (0,-13,8.3), (0,-9.5,9.0)]
    T = [(0,0,72), (0,0,66), (0,0,58), (0,0,48), (0,0,26), (0,0,16), (0,0,14), (0,4,22), (0,6,60)]
    set_day(True); cam.animation_data_clear(); animate_path(P, T, 20*FPS, 22); render("approach")

if "vault" in clips:
    # at the tomb, tilting up into the vault while day becomes night
    frames = 12*FPS
    P = [(0,-9.5,9.0), (0,-9.0,9.2), (0,-8.5,9.4)]
    T = [(0,6,60), (0,3,110), (0,0,150)]
    cam.animation_data_clear(); animate_path(P, T, frames, 16)
    set_day(True); key_day(1); key_day(int(frames*0.40)); set_day(False); key_day(int(frames*0.62)); key_day(frames)
    render("vault")
    # clear the day/night keys so later clips are static
    for tgt in (O["Sun"].data, O["TombGlow"].data, O["ArmillaryLamp"].data): tgt.animation_data_clear()
    for nt in (O["SphereShell"].data.materials[0].node_tree, bpy.data.materials["LampEmission"].node_tree,
               bpy.data.materials["MoonEmission"].node_tree, W["Day sky"].node_tree): nt.animation_data_clear()

if "orbit" in clips:
    # slow half orbit round the front at terrace height, daylight
    frames = 14*FPS; n = 9
    P = [(520*math.sin(math.radians(-70 + 140*i/(n-1))), -520*math.cos(math.radians(-70 + 140*i/(n-1))), 75) for i in range(n)]
    T = [(0,0,62)]*n
    set_day(True); cam.animation_data_clear(); animate_path(P, T, frames, 40); render("orbit")
print("ALL DONE", flush=True)
