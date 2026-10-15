"""Static GLB -> palette materials, metre scale, ground-centred origin, bounded triangles."""
import bpy, json, sys, numpy as np
from pathlib import Path
from mathutils import Matrix, Vector
source, target, kind, height = sys.argv[sys.argv.index('--') + 1:]
height, budget = float(height), {'prop': 3000, 'tree': 5000, 'building': 8000}[kind]
palette = json.loads((Path(__file__).resolve().parents[2] / 'docs/look/palette.json').read_text())
names = [n for n in palette if not n.startswith(('sky_', 'sun_', 'fill_', 'ink_', 'moon'))]
srgb = np.array([[int(palette[n][i:i+2], 16) / 255 for i in (1, 3, 5)] for n in names])
linear = np.where(srgb <= .04045, srgb / 12.92, ((srgb + .055) / 1.055) ** 2.4)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=source)
objects = [o for o in bpy.context.scene.objects if o.type == 'MESH']
if not objects or any(o.data.shape_keys or o.modifiers for o in objects):
    raise ValueError('Expected static meshes without shape keys or modifiers')
bpy.ops.object.select_all(action='DESELECT')
for o in objects: o.select_set(True)
bpy.context.view_layer.objects.active = objects[0]
bpy.ops.object.join()
o = bpy.context.object; o.data = o.data.copy(); o.data.transform(o.matrix_world)
o.parent = None; o.matrix_world = Matrix.Identity(4); mesh = o.data
def triangles():
    mesh.calc_loop_triangles()
    return len(mesh.loop_triangles)
def fit():
    points = np.array([mesh.vertices[i].co[:] for i in {i for f in mesh.polygons for i in f.vertices}]); lo, hi = points.min(0), points.max(0)
    if hi[2] - lo[2] <= 1e-8: raise ValueError('Mesh has zero height')
    offset = Vector(((lo[0]+hi[0])/2, (lo[1]+hi[1])/2, lo[2]))
    for v in mesh.vertices: v.co = (v.co - offset) * (height / (hi[2]-lo[2]))
    return ((hi-lo) * (height / (hi[2]-lo[2]))).tolist()
def apply(mod): bpy.ops.object.modifier_apply(modifier=mod.name)
def reduce():
    for _ in range(4):
        count = triangles()
        if count <= budget: return
        mod = o.modifiers.new('Budget', 'DECIMATE'); mod.ratio = .95 * budget / count
        mod.use_collapse_triangulate = True; apply(mod)
    if triangles() > budget: raise ValueError('Cannot meet triangle budget')
before = triangles(); fit()
if not before: raise ValueError('Mesh has no faces')
# Follow only the Base Color graph; normal/roughness/AO images must not become albedo.
cache, samples = {}, []
for face in mesh.polygons:
    mat = mesh.materials[face.material_index] if mesh.materials else None
    bsdf = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None) if mat and mat.use_nodes else None
    color = np.array(bsdf.inputs['Base Color'].default_value[:3] if bsdf else mat.diffuse_color[:3] if mat else (.5, .5, .5))
    pending = [l.from_node for l in bsdf.inputs['Base Color'].links] if bsdf else []
    seen = set()
    while pending:
        node = pending.pop()
        if node in seen: continue
        seen.add(node)
        if node.type == 'TEX_IMAGE' and node.image and mesh.uv_layers.active:
            image = node.image
            if image.name not in cache:
                pixels = np.array(image.pixels[:], dtype=np.float32).reshape(image.size[1], image.size[0], 4)[:, :, :3]
                cache[image.name] = np.where(pixels <= .04045, pixels / 12.92, ((pixels+.055)/1.055)**2.4) if image.colorspace_settings.name == 'sRGB' else pixels
            uv = np.mean([mesh.uv_layers.active.data[i].uv[:] for i in face.loop_indices], axis=0) % 1
            color = cache[image.name][int(uv[1]*image.size[1]), int(uv[0]*image.size[0])]; break
        pending.extend(l.from_node for socket in node.inputs for l in socket.links)
    samples.append(color)
samples = np.array(samples)
centres = [samples[0]]
for _ in range(min(6, len(samples))-1):
    centres.append(samples[np.argmax(((samples[:, None]-np.array(centres))**2).sum(2).min(1))])
centres = np.array(centres)
for _ in range(12):
    labels = ((samples[:, None]-centres)**2).sum(2).argmin(1)
    centres = np.array([samples[labels == i].mean(0) if np.any(labels == i) else c for i, c in enumerate(centres)])
mapped = ((centres[:, None]-linear)**2).sum(2).argmin(1)
mesh.materials.clear()
for mat in list(bpy.data.materials): bpy.data.materials.remove(mat)
for i in sorted(set(mapped.tolist())):
    mat = bpy.data.materials.new(names[i]); mat.use_nodes = True; mat.diffuse_color = (*linear[i], 1)
    bsdf = mat.node_tree.nodes.get('Principled BSDF'); bsdf.inputs['Base Color'].default_value = mat.diffuse_color
    bsdf.inputs['Roughness'].default_value = 1; bsdf.inputs['Metallic'].default_value = 0
    mesh.materials.append(mat)
slots = {n.name: i for i, n in enumerate(mesh.materials)}
for face, label in zip(mesh.polygons, labels): face.material_index = slots[names[mapped[label]]]
for attr in list(mesh.color_attributes): mesh.color_attributes.remove(attr)
reduce()
mod = o.modifiers.new('Small bevel', 'BEVEL'); mod.width = .05 if kind == 'building' else .02
mod.segments = 2; mod.limit_method = 'ANGLE'; apply(mod)
reduce()
mod = o.modifiers.new('Weighted normals', 'WEIGHTED_NORMAL'); mod.keep_sharp = True; apply(mod)
size = fit()
bpy.ops.export_scene.gltf(filepath=target, export_format='GLB', use_selection=True, export_animations=False)
Path(target + '.json').write_text(json.dumps({'triangles_before': before, 'triangles_after': triangles(),
    'palette': sorted({mesh.materials[f.material_index].name for f in mesh.polygons}), 'size_m': dict(zip(('width', 'depth', 'height'), size))}))
