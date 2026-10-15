"""Render normalized GLB from its +Z front and 45 degrees; Cycles CPU only."""
import bpy, sys, math
from pathlib import Path
from mathutils import Vector

source = Path(sys.argv[sys.argv.index('--') + 1]).resolve()
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(source))
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
points = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
if not points:
    raise ValueError('No mesh to preview')
lo = Vector(tuple(min(p[i] for p in points) for i in range(3)))
hi = Vector(tuple(max(p[i] for p in points) for i in range(3)))
center, diameter = (lo + hi) / 2, (hi - lo).length
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 16
scene.render.resolution_x = scene.render.resolution_y = 512
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs[0].default_value = (.18, .18, .18, 1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value = .6
scene.view_settings.view_transform = 'Standard'
bpy.ops.object.light_add(type='AREA', location=center + Vector((1, -2, 3)) * diameter)
bpy.context.object.data.energy = 150 * diameter ** 2
bpy.context.object.data.shape = 'DISK'
bpy.context.object.data.size = diameter * 2
bpy.context.object.rotation_euler = (center - bpy.context.object.location).to_track_quat('-Z', 'Y').to_euler()
bpy.ops.object.camera_add()
camera = bpy.context.object
camera.data.type = 'ORTHO'
camera.data.ortho_scale = diameter * 1.15
scene.camera = camera
for name, angle in [('front', 0), ('angle45', math.pi / 4)]:
    camera.location = center + Vector((math.sin(angle), -math.cos(angle), .25)) * diameter * 3
    camera.rotation_euler = (center - camera.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = str(source.parent / (name + '.png'))
    bpy.ops.render.render(write_still=True)
