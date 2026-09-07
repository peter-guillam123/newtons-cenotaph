"""Export the model for the web page: a GLB of the building, plus JSON for
cypress instances and star points. Does not save the .blend.
Run: Blender -b newton_cenotaph.blend -P export_web.py
"""
import bpy, os, json, random, math
O = bpy.data.objects; M = bpy.data.materials
here = os.path.dirname(bpy.data.filepath); out = os.path.join(here, "docs", "assets"); os.makedirs(out, exist_ok=True)

# flat colours the glTF exporter can carry (the procedural node trees cannot travel)
flat = {
  "Stone_Base": (0.46, 0.42, 0.36, 0.9, 0.0, None), "Stone_Paving": (0.40, 0.39, 0.35, 0.95, 0.0, None),
  "Sphere_Shell": (0.42, 0.40, 0.36, 0.8, 0.0, None), "Stone_Interior": (0.30, 0.29, 0.26, 0.9, 0.0, None),
  "Cypress_Foliage": (0.035, 0.06, 0.028, 1.0, 0.0, None), "Bronze": (0.62, 0.44, 0.20, 0.35, 1.0, None),
  "LampEmission": (1.0, 0.86, 0.62, 0.5, 0.0, (1.0, 0.86, 0.62)), "MoonEmission": (0.95, 0.97, 1.0, 0.5, 0.0, (0.95, 0.97, 1.0)),
  "Marble_Dark": (0.10, 0.09, 0.09, 0.3, 0.0, None), "Ground_Grass": (0.18, 0.20, 0.10, 1.0, 0.0, None),
}
for name, (r, g, b, rough, metal, emit) in flat.items():
    m = M.get(name)
    if not m: continue
    m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
    o = nt.nodes.new('ShaderNodeOutputMaterial'); p = nt.nodes.new('ShaderNodeBsdfPrincipled')
    p.inputs['Base Color'].default_value = (r, g, b, 1); p.inputs['Roughness'].default_value = rough; p.inputs['Metallic'].default_value = metal
    if emit:
        p.inputs['Emission Color'].default_value = (*emit, 1); p.inputs['Emission Strength'].default_value = 1.0
    nt.links.new(p.outputs[0], o.inputs[0])

names = ["SphereShell", "FrontBridge", "Drum", "UpperTier", "Platform", "PitFloor", "GrandStair", "ForecourtStair", "TunnelLanding",
         "TunnelStair", "Mound", "MoundStair", "SarcPlinth", "Sarcophagus", "SarcLid", "LampRod", "LampSun", "Moon", "Arm_Axis",
         "Arm_Equator", "Arm_Meridian1", "Arm_Meridian2", "Arm_Ecliptic", "Arm_Tropic1", "Arm_Tropic2", "Arm_Inner", "Cypress"]
cyp = O["Cypress"]; cyp.location = (0, 0, 0); cyp.hide_set(False); cyp.hide_render = False
for ob in O:
    ob.select_set(ob.name in names)
    m = ob.modifiers.get("SECTION")
    if m: m.show_viewport = False; m.show_render = False
bpy.ops.export_scene.gltf(filepath=os.path.join(out, "cenotaph.glb"), export_format='GLB', use_selection=True,
                          export_apply=True, export_yup=True, export_materials='EXPORT', export_normals=True,
                          export_texcoords=False, export_animations=False, export_cameras=False, export_lights=False)

def yup(x, y, z): return [round(x, 3), round(z, 3), round(-y, 3)]
random.seed(11)
inst = []
for name in ("Cypress_Ground", "Cypress_DrumTerrace", "Cypress_UpperTerrace"):
    for v in O[name].data.vertices:
        inst.append(yup(*v.co) + [round(random.uniform(0, 6.283), 3), round(random.uniform(0.85, 1.15), 3), round(random.uniform(0.8, 1.2), 3)])
json.dump(inst, open(os.path.join(out, "cypresses.json"), "w"), separators=(",", ":"))

# stars: points on the inner surface (r = 69.85) above z = 8, three brightness classes like the material
R, RI = 75.0, 69.85; stars = []
def sample(n, size):
    k = 0
    while k < n:
        u, v = random.random(), random.random()
        theta = 2*math.pi*u; phi = math.acos(2*v - 1)
        x = RI*math.sin(phi)*math.cos(theta); y = RI*math.sin(phi)*math.sin(theta); z = RI*math.cos(phi) + R
        if z < 8: continue
        stars.append(yup(x, y, z) + [round(size*random.uniform(0.7, 1.3), 2)]); k += 1
sample(5200, 0.16); sample(700, 0.36); sample(60, 0.95)
moon = O["Moon"].matrix_world.translation
json.dump({"stars": stars, "moon": yup(*moon)}, open(os.path.join(out, "stars.json"), "w"), separators=(",", ":"))
print("EXPORTED", len(inst), "cypresses,", len(stars), "stars; glb bytes:", os.path.getsize(os.path.join(out, "cenotaph.glb")), flush=True)
