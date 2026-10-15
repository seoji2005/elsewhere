"""C063 Lise on the VRoid AvatarSample_D base (Blender 4.2 + VRM Add-on), AGENTS.md "Blender 제작 원칙".

Keeps the VRoid face, expressions, hair, springs and armature; replaces the sample outfit with
modifier-chain clothes (skin copy -> Shrinkwrap -> hem/sleeve/collar Extrude -> Solidify ->
Corrective Smooth -> Data Transfer weights -> Armature), bezier tie/hairpin and flat MToon colours.

  blender -b --python tools/blender/lise_vroid.py -- --vrm OUT.vrm
  LIBGL_ALWAYS_SOFTWARE=1 xvfb-run -a blender --window-geometry 0 0 1280 900 --python tools/blender/lise_vroid.py \
      -- --shots DIR --tag c063-rN --blend OUT.blend --quit 1      (EEVEE previews need a window; -b has no EGL)
"""
import bpy, bmesh, math, sys
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

SRC = '/home/dev/asset-packs/vroid-cc0/avatarsample_d_0/AvatarSample_D.vrm'
OLD_CLOTHES = ('_Tops_', '_Accessory_', '_Bottoms_', '_Shoes_')
# Concept sheet colours (sRGB): game-gen/batch1-153534/lise-*.png, batch3sheets-165626/g-lise-*.png
COLORS = {'cloth_shirt': 'F3F2EE', 'cloth_vest': '5F6F86', 'cloth_coat': '3B3B3E', 'cloth_skirt': '28324D',
          'cloth_tights': '2C2B31', 'cloth_loafer': '232027', 'acc_tie': 'C8893A', 'acc_hairpin': 'D8B25A'}
HAIR = '5A6C8E'               # slate blue
IRIS = ('3E4E6A', 'D39A4A')   # slate rim -> amber centre (dark -> light texels)
ARM = ('J_Bip_L_UpperArm', 'J_Bip_R_UpperArm', 'J_Sec_L_UpperArm', 'J_Sec_R_UpperArm')


def args():
    a = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    return {a[i].lstrip('-'): a[i + 1] for i in range(0, len(a) - 1, 2)}


def lin(hexstr):
    c = [int(hexstr[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [x / 12.92 if x <= .04045 else ((x + .055) / 1.055) ** 2.4 for x in c]


def context():
    """Operators need a window when Blender runs with one (xvfb); -b has none and needs no override."""
    wm = bpy.context.window_manager
    if bpy.context.window is None and wm.windows:
        return bpy.context.temp_override(window=wm.windows[0], screen=wm.windows[0].screen)
    return bpy.context.temp_override()


def apply_modifier(ob, m):
    with context(), bpy.context.temp_override(object=ob, active_object=ob):
        bpy.ops.object.modifier_apply(modifier=m.name)


def delete_faces(me, dead):
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if dead(f)], context='FACES')
    bm.to_mesh(me); bm.free()


# ---------------------------------------------------------------- import / skin
def reset_and_import():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    bpy.data.orphans_purge(do_recursive=True)
    with context():
        bpy.ops.import_scene.vrm(filepath=SRC)
    body = bpy.data.objects['Body']
    bad = [i for i, m in enumerate(body.data.materials) if any(k in m.name for k in OLD_CLOTHES)]
    delete_faces(body.data, lambda f: f.material_index in bad)        # the sample outfit would show through
    for i in sorted(bad, reverse=True):
        body.data.materials.pop(index=i)
    return body.parent, body


def rest_proxy(body):
    """Static skin copy (no armature): Shrinkwrap target and Data Transfer source at rest."""
    p = body.copy(); p.data = body.data.copy(); p.name = p.data.name = '_lise_rest'
    p.modifiers.clear(); p.parent = None; p.matrix_world = body.matrix_world.copy()
    bpy.context.scene.collection.objects.link(p)
    delete_faces(p.data, lambda f: f.material_index != 0)
    p.hide_render = True; p.hide_set(True)
    return p


# ---------------------------------------------------------------- face regions (world, rest T-pose, -Y front)
def arm_weight(bm, f, vg):
    dl, ids = bm.verts.layers.deform.active, [vg[n].index for n in ARM if n in vg]
    return sum(sum(v[dl].get(i, 0) for i in ids) for v in f.verts) / len(f.verts)


def region(name, c, f, bm, vg):
    x, y, z = abs(c.x), c.y, c.z
    if name == 'tights':                                     # legs below the skirt (thighs stay bare skin inside it)
        return z < 0.8
    if name == 'loafer':
        return z < 0.092
    if name == 'skirt':
        return 0.935 < z < 0.985 and x < 0.2                 # above the crotch: one bottom loop to extrude
    if name == 'covered':                                    # skin under shirt/vest/coat (deleted from the body)
        return 0.885 < z < 1.345 and x < 0.53
    if name == 'shirt':                                      # only where it shows: collar, the V and the cuffs
        return 0.885 < z < 1.345 and x < 0.53 and (x > 0.42 or z > 1.3 or (z > 1.15 and y < 0 and x < 0.1))
    if name == 'coat':
        return (0.95 < z < 1.35 and x < 0.2) or (1.15 < z < 1.35 and x < 0.512)
    if name == 'vest':                                       # front panel: the coat hides sides and back
        if not (0.945 < z < 1.335) or x > 0.2 or y > 0.03 or arm_weight(bm, f, vg) > 0.35:
            return False
        return not (y < -0.02 and z > 1.17 + 2.3 * x)        # V-neck
    raise KeyError(name)


def boundary(bm, test):
    """Boundary edges whose vertices all pass test(co): a hem, cuff or neckline, even on a cut panel."""
    return [e for e in bm.edges if e.is_boundary and all(test(v.co) for v in e.verts)]


def extrude(bm, edges, rings, axis='z', pleat=0.0):
    """Extrude boundary edges ring by ring: rings = [(offset along axis, radial scale)], absolute from the source.
    Vertices are ordered by angle round the centre (enough for the radial rings and the pleat parity)."""
    if not edges:
        return []
    k = 'xyz'.index(axis); a, b = [i for i in range(3) if i != k]
    src = list({v for e in edges for v in e.verts})
    c0 = sum((v.co for v in src), Vector()) / len(src)
    src.sort(key=lambda v: math.atan2(v.co[b] - c0[b], v.co[a] - c0[a]))
    base, cur, prev, made = [v.co.copy() for v in src], list(edges), src, []
    for n, (off, scale) in enumerate(rings):
        geom = bmesh.ops.extrude_edge_only(bm, edges=cur)['geom']
        nv = {g for g in geom if isinstance(g, bmesh.types.BMVert)}
        cur = [g for g in geom if isinstance(g, bmesh.types.BMEdge) and set(g.verts) <= nv]
        link = {e.other_vert(v): v for v in nv for e in v.link_edges if e.other_vert(v) not in nv}
        verts = [link.get(v) for v in prev]
        for i, (v, q) in enumerate(zip(verts, base)):
            if v is None:
                continue
            d = q - c0; d[k] = 0
            p = c0 + d * (scale + pleat * (n + 1) / len(rings) / (d.length or 1) * (1 if i % 2 else -1))
            p[k] = (c0[k] if axis == 'z' else q[k]) + off
            v.co = p
        prev = verts; made += [v for v in verts if v]
    return made


def cuffs(bm, x0, rings):
    out = []
    for s in (1, -1):
        out += extrude(bm, boundary(bm, lambda co: s * co.x > x0), [(s * o, r) for o, r in rings], axis='x')
    return out


def build_shirt(bm):
    return cuffs(bm, 0.52, [(0.004, 1.12), (0.016, 1.12)]) + \
        extrude(bm, boundary(bm, lambda co: co.z > 1.325), [(0.012, 1.06), (0.026, 1.12)])          # collar


def build_vest(bm):
    return extrude(bm, boundary(bm, lambda co: co.z < 0.957), [(-0.018, 1.03)])                     # hem


def build_skirt(bm):                                                    # to ~z 0.67, just above the knee
    return extrude(bm, boundary(bm, lambda co: co.z < 0.95), [(-0.03 * i, 1.05 + 0.06 * i) for i in range(1, 10)], pleat=0.012)


def build_coat(bm):
    made = extrude(bm, boundary(bm, lambda co: co.z < 0.96), [(-0.032 * i, 1.12 + 0.09 * i) for i in range(1, 6)])
    made += cuffs(bm, 0.495, [(0.002, 1.1), (0.006, 1.08)]) + \
        extrude(bm, boundary(bm, lambda co: co.z > 1.338), [(0.012, 1.18), (0.03, 1.32)])         # collar
    def opening(f):                                                     # open front, widening to the collar
        c = f.calc_center_median()
        return c.y < -0.02 and abs(c.x) < 0.035 + 0.05 * min(1, max(0, (1.36 - c.z) / 0.2)) and c.z > 0.6
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if opening(f)], context='FACES')
    return [v for v in made if v.is_valid]


# ---------------------------------------------------------------- clothes
def make_cloth(name, arm, proxy, offset, thick, build=lambda bm: []):
    me = proxy.data.copy(); me.name = name
    ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob); ob.parent = arm
    for g in proxy.vertex_groups:
        ob.vertex_groups.new(name=g.name)
    bm = bmesh.new(); bm.from_mesh(me)
    bm.transform(proxy.matrix_world)                          # the body is rotated 180 deg: cloth lives in world space
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)   # close the glTF UV-seam splits so hems are whole
    keep = {f for f in bm.faces if region(name.split('_')[1], f.calc_center_median(), f, bm, ob.vertex_groups)}
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f not in keep], context='FACES')
    loose = set(build(bm))                                    # extruded hems keep their own shape (not wrapped)
    bm.verts.index_update(); fitted = [v.index for v in bm.verts if v not in loose]
    bm.to_mesh(me); bm.free()
    ob.vertex_groups.new(name='fit').add(fitted, 1.0, 'REPLACE')
    me.materials.clear(); me.materials.append(material(name))
    m = ob.modifiers.new('Shrinkwrap', 'SHRINKWRAP')
    m.target, m.wrap_method, m.wrap_mode, m.offset, m.vertex_group = proxy, 'NEAREST_SURFACEPOINT', 'ABOVE_SURFACE', offset, 'fit'
    m = ob.modifiers.new('Solidify', 'SOLIDIFY')
    m.thickness, m.offset, m.use_even_offset, m.use_rim = thick, 1.0, False, True   # even offset spikes at folded cuffs
    for m in list(ob.modifiers):                              # bake: Corrective Smooth needs the solidified count as rest
        apply_modifier(ob, m)
    m = ob.modifiers.new('CorrectiveSmooth', 'CORRECTIVE_SMOOTH')
    m.factor, m.iterations, m.rest_source, m.smooth_type, m.use_only_smooth = 0.5, 4, 'ORCO', 'LENGTH_WEIGHTED', True
    m = ob.modifiers.new('DataTransfer', 'DATA_TRANSFER')     # every vertex: extruded hems and cuffs need weights too
    m.object, m.use_vert_data, m.data_types_verts, m.vert_mapping = proxy, True, {'VGROUP_WEIGHTS'}, 'POLYINTERP_NEAREST'
    m.layers_vgroup_select_src, m.layers_vgroup_select_dst = 'ALL', 'NAME'
    ob.modifiers.new('Armature', 'ARMATURE').object = arm
    return ob


def material(name):
    """Flat MToon: a copy of the sample skin material without maps, shade = 0.62 x lit."""
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    m = next(m for m in bpy.data.materials if '_Body_00_SKIN' in m.name).copy(); m.name = name
    ext = m.vrm_addon_extension.mtoon1; pbr, mt = ext.pbr_metallic_roughness, ext.extensions.vrmc_materials_mtoon
    pbr.base_color_texture.index.source = None
    mt.shade_multiply_texture.index.source = None
    col = lin(COLORS[name])
    pbr.base_color_factor = col + [1.0]
    mt.shade_color_factor = [c * 0.62 for c in col]
    return m


def restyle_hair():
    """Sample clip removed (a bezier pin replaces it); hair/brow maps slate blue with the strand shading kept, iris
    slate -> amber. Renamed so the game's wardrobe (HAIR/FaceBrow/EyeIris slots) leaves the baked colours alone."""
    hair = bpy.data.objects['Hair001']
    clip = [i for i, m in enumerate(hair.data.materials) if m.name.endswith('HAIR_02')]
    delete_faces(hair.data, lambda f: f.material_index in clip)
    done = set()
    for mat in bpy.data.materials:
        hairy, iris = '_HAIR' in mat.name or 'FaceBrow' in mat.name, 'EyeIris' in mat.name
        if not (hairy or iris):
            continue
        ext = mat.vrm_addon_extension.mtoon1
        if hairy:                                         # the sample tints hair near-black by factor: the map carries it now
            ext.pbr_metallic_roughness.base_color_factor = (1, 1, 1, 1)
            ext.extensions.vrmc_materials_mtoon.shade_color_factor = (.66, .68, .78)
        img = ext.pbr_metallic_roughness.base_color_texture.index.source
        if not img or img.name in done:
            continue
        done.add(img.name)
        px = list(img.pixels); n = len(px) // 4
        lum = [.3 * px[4 * i] + .59 * px[4 * i + 1] + .11 * px[4 * i + 2] for i in range(n)]
        if hairy:
            vis = [lum[i] for i in range(n) if px[4 * i + 3] > .03]
            mean, target = max(sum(vis) / max(1, len(vis)), .02), lin(HAIR)
            for i in range(n):
                px[4 * i:4 * i + 3] = [c * min(1.8, max(.55, (lum[i] / mean) ** .8)) for c in target]
        else:
            lo, hi = lin(IRIS[0]), lin(IRIS[1])
            for i in range(n):
                t = min(1, lum[i] * 1.6)
                px[4 * i:4 * i + 3] = [p + (q - p) * t for p, q in zip(lo, hi)]
        img.pixels = px; img.update(); img.pack()
    for mat in bpy.data.materials:
        mat.name = mat.name.replace('_HAIR', '_LiseHair_').replace('FaceBrow', 'FaceLiseBrow').replace('EyeIris', 'EyeLiseIris')


# ---------------------------------------------------------------- bezier accessories
def curve(name, pts, closed=False):
    cu = bpy.data.curves.new(name, 'CURVE'); sp = cu.splines.new('BEZIER')
    sp.bezier_points.add(len(pts) - 1); sp.use_cyclic_u = closed
    for bp, p in zip(sp.bezier_points, pts):
        bp.co = p; bp.handle_left_type = bp.handle_right_type = 'AUTO'
    cu.resolution_u = 3                                       # bevel and taper: a few segments are enough
    ob = bpy.data.objects.new(name, cu); bpy.context.scene.collection.objects.link(ob)
    return ob


def ribbon(name, pts, w, h, taper, arm, bone):
    """Bezier (3-4 points) + flat closed bevel w x h + taper curve -> mesh weighted to one bone."""
    bev = curve('_bevel', [(w, 0, 0), (0, h, 0), (-w, 0, 0), (0, -h, 0)], closed=True)
    tap = curve('_taper', [(i / (len(taper) - 1), t, 0) for i, t in enumerate(taper)])
    ob = curve('_' + name, pts)
    ob.data.dimensions = '3D'; ob.data.bevel_mode, ob.data.bevel_object, ob.data.taper_object = 'OBJECT', bev, tap
    ob.data.use_fill_caps = True; ob.data.resolution_u = 4
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get())); me.name = name
    for o in (ob, bev, tap):
        bpy.data.objects.remove(o)
    out = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(out); out.parent = arm
    me.materials.append(material(name))
    out.vertex_groups.new(name=bone).add(range(len(me.vertices)), 1.0, 'REPLACE')
    out.modifiers.new('Armature', 'ARMATURE').object = arm


def front_hit(ob, x, z):
    bm = bmesh.new(); bm.from_mesh(ob.data); bm.transform(ob.matrix_world)
    hit = BVHTree.FromBMesh(bm).ray_cast(Vector((x, -1, z)), Vector((0, 1, 0)))[0]; bm.free()
    return hit


def build_tie(arm, proxy):
    def y(z):
        return min(h.y for x in (-0.04, -0.02, 0, 0.02, 0.04) for h in [front_hit(proxy, x, z)] if h) - 0.012
    ribbon('acc_tie', [Vector((0, y(z), z)) for z in (1.338, 1.31, 1.26, 1.205)], 0.016, 0.0025,
           [1.0, 0.55, 0.75, 1.0, 0.25], arm, 'J_Bip_C_UpperChest')
    ribbon('acc_tie', [Vector((0, y(z) - 0.004, z)) for z in (1.342, 1.33, 1.318)], 0.011, 0.006,     # knot
           [0.9, 1.0, 0.75], arm, 'J_Bip_C_UpperChest')


def build_hairpin(arm):
    hair = bpy.data.objects['Hair001']
    pts = [(front_hit(hair, x, z) or Vector((x, -0.1, z))) + Vector((0, -0.003, 0))
           for x, z in ((-0.045, 1.535), (-0.063, 1.52), (-0.08, 1.50))]
    ribbon('acc_hairpin', pts, 0.0035, 0.0018, [0.7, 1.0, 1.0, 0.7], arm, 'J_Bip_C_Head')


# ---------------------------------------------------------------- preview / export
def shots(arm, outdir, tag):
    """A-pose, then front / 45 / side / face close-up PNGs (EEVEE, one sun, grey world)."""
    for side, s in (('L', 1), ('R', -1)):
        pb = arm.pose.bones['J_Bip_%s_UpperArm' % side]; h = pb.head.copy()
        pb.matrix = Matrix.Translation(h) @ Matrix.Rotation(math.radians(58) * s, 4, 'Y') @ Matrix.Translation(-h) @ pb.matrix
    bpy.context.view_layer.update()
    sc = bpy.context.scene
    for eng in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE'):
        try:
            sc.render.engine = eng; break
        except TypeError:
            pass
    sc.render.resolution_x, sc.render.resolution_y = 768, 1024
    sc.eevee.taa_render_samples = 8; sc.view_settings.view_transform = 'Standard'
    sc.world = sc.world or bpy.data.worlds.new('World'); sc.world.use_nodes = True
    bg = next(n for n in sc.world.node_tree.nodes if n.type == 'BACKGROUND')
    bg.inputs[0].default_value = lin('C8C8C8') + [1]
    sun = bpy.data.objects.new('preview_sun', bpy.data.lights.new('preview_sun', 'SUN')); sc.collection.objects.link(sun)
    sun.data.energy = 3.0; sun.rotation_euler = (math.radians(50), 0, math.radians(-25))
    cam = bpy.data.objects.new('preview_cam', bpy.data.cameras.new('preview_cam')); sc.collection.objects.link(cam)
    sc.camera = cam
    for view, (az, z, dist, lens) in {'front': (0, 0.86, 3.2, 40), '45': (45, 0.86, 3.2, 40),
                                      'side': (90, 0.86, 3.2, 40), 'face': (15, 1.42, 0.75, 50)}.items():
        a = math.radians(az)
        cam.data.lens = lens; cam.location = (dist * math.sin(a), -dist * math.cos(a), z)
        cam.rotation_euler = (math.radians(90), 0, a)
        sc.render.filepath = '%s/%s-%s.png' % (outdir, tag, view)
        bpy.ops.render.render(write_still=True)


def export_vrm(arm, path):
    """Rest pose, cloth modifiers baked (Armature and the add-on's outline nodes stay), helpers removed -> VRM 0.x."""
    for pb in arm.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    for ob in [o for o in bpy.data.objects if o.name.startswith('cloth_')]:
        for m in [m for m in ob.modifiers if m.type in ('CORRECTIVE_SMOOTH', 'DATA_TRANSFER')]:
            apply_modifier(ob, m)
        ob.vertex_groups.remove(ob.vertex_groups['fit'])
    for ob in [o for o in bpy.data.objects if o.name.startswith(('_', 'preview_'))]:   # the proxy fed Data Transfer
        bpy.data.objects.remove(ob)
    with context():
        print('VRM', bpy.ops.export_scene.vrm(filepath=path, armature_object_name=arm.name, ignore_warning=True))


def main():
    opt = args()
    arm, body = reset_and_import()
    proxy = rest_proxy(body)
    for name, off, th, build in (('cloth_tights', 0.0015, 0.0012, None), ('cloth_shirt', 0.003, 0.0015, build_shirt),
                                 ('cloth_skirt', 0.007, 0.002, build_skirt), ('cloth_vest', 0.011, 0.0025, build_vest),
                                 ('cloth_coat', 0.017, 0.004, build_coat), ('cloth_loafer', 0.006, 0.005, None)):
        make_cloth(name, arm, proxy, off, th, *[build] if build else [])
    vg = body.vertex_groups                                   # skin under the clothes never pokes through
    bm = bmesh.new(); bm.from_mesh(body.data)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index == 0 and any(
        region(n, f.calc_center_median(), f, bm, vg) for n in ('covered', 'tights'))], context='FACES')
    bm.to_mesh(body.data); bm.free()
    build_tie(arm, proxy)
    build_hairpin(arm)
    restyle_hair()
    if 'shots' in opt:
        shots(arm, opt['shots'], opt.get('tag', 'c063'))
    if 'blend' in opt:
        with context():
            bpy.ops.wm.save_as_mainfile(filepath=opt['blend'], copy=True)
    if 'vrm' in opt:
        export_vrm(arm, opt['vrm'])
    if 'quit' in opt:
        bpy.ops.wm.quit_blender()


main()
