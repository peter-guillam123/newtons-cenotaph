"""Render the five presentation views of the Newton cenotaph model.
Run headless:  /Applications/Blender.app/Contents/MacOS/Blender -b newton_cenotaph.blend -P render_views.py
Optional: -- --quick   (half resolution, 32 samples)   -- --only=03,04   (render a subset by number)
"""
import bpy, sys, time, os
sc = bpy.context.scene
O = bpy.data.objects
here = os.path.dirname(bpy.data.filepath)
out = os.path.join(here, "renders")
os.makedirs(out, exist_ok=True)
quick = "--quick" in sys.argv
only = [a for a in sys.argv if a.startswith("--only=")]
only = only[0].split("=",1)[1].split(",") if only else None

sc.render.engine = 'CYCLES'
sc.cycles.samples = 32 if quick else 128
sc.cycles.use_denoising = True
sc.render.resolution_percentage = 50 if quick else 100
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'; prefs.get_devices()
    for d in prefs.devices: d.use = True
    sc.cycles.device = 'GPU'
except Exception as e:
    print("GPU setup:", e)

def stars(on):
    O["SphereShell"].data.materials[0].node_tree.nodes["StarsOn"].outputs[0].default_value = 1.0 if on else 0.0
def section(on):
    for ob in O:
        m = ob.modifiers.get("SECTION")
        if m: m.show_render = on; m.show_viewport = on
    # cypress point clouds have no boolean; swap to the back-half copies instead
    for ob in O:
        if ob.name.startswith("Cypress_") and ob.name != "Cypress":
            half = ob.name.endswith("_SectionHalf")
            ob.hide_render = (on != half)
def lamp(on):
    O["ArmillaryLamp"].hide_render = not on; O["LampSun"].hide_render = not on
def show(name, on):
    O[name].hide_render = not on

views = [
  # name, camera, world, stars, lamp, tombglow, moon, section
  ("01_exterior_elevation", "Cam_Exterior", "Day sky", True,  False, False, True,  False),
  ("02_interior_day_stars", "Cam_Interior", "Day sky", True,  False, True,  True,  False),
  ("03_interior_night_lamp","Cam_Interior", "Night",   False, True,  False, False, False),
  ("04_section_day",        "Cam_Section",  "Day sky", True,  False, True,  True,  True),
  ("05_plan",               "Cam_Plan",     "Day sky", True,  False, False, True,  False),
]
for name, cam, world, st, lp, glow, moon, sec in views:
    if only and name[:2] not in only: continue
    t = time.time()
    sc.camera = O[cam]; sc.world = bpy.data.worlds[world]
    stars(st); lamp(lp); show("TombGlow", glow); show("Moon", moon); section(sec)
    sc.render.filepath = os.path.join(out, name + ".png")
    bpy.ops.render.render(write_still=True)
    print(f"RENDERED {name} in {time.time()-t:.0f}s", flush=True)
section(False)
print("ALL DONE", flush=True)
