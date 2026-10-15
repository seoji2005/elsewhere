"""C067 New-York building kit: 6 types as stackable base / mid (one floor) / top pieces, plus street props.
Run as dev from the repo: blender --background --python tools/blender/buildings.py [-- --no-render]
-> src/assets/buildings.glb (meshopt) and Cycles previews .shots/c067-<type>-front.png / -45.png. Deterministic.
Boxes are built with bmesh (Building Tools' edit-mode operators need a UI context), Bevel(segments=2) on corners and
trim, Weighted Normal, vertex-colour AO baked in Cycles. Materials carry only a name + palette colour
(docs/look/palette.json), so the toon and gouache looks hook onto the same names (wall_redbrick, glass, ...)."""
import bpy, bmesh, json, math, subprocess, sys
from pathlib import Path
from mathutils import Matrix, Vector
ROOT = Path(__file__).resolve().parents[2]
PAL = json.loads((ROOT / 'docs/look/palette.json').read_text())
COL = dict(wall_redbrick='brick_red', wall_brownstone='brownstone', wall_limestone='limestone', wall_tanbrick='#b08660',
           base_stone='#7f7b72', trim_cream='trim_cream', trim_dark='trim_green', trim_blue='steel_blue', metal_dark='charcoal',
           glass='#46536a', glass_shop='#9fb0b8', interior='#d8b98c', door_green='sign_green', door_red='wine', wood='#8a6646',
           awning_green='awning_green', awning_terra='awning_terra', sign_navy='sign_navy', sign_wine='sign_wine',
           sign_cream='letter_cream', bulb='bulb', roof='#6b6660', leaf='leaf', trunk='trunk', hydrant='hydrant')
QUADS = ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7))
FRONT, BACK, R = (0, 1, 2, 3, 5), (2,), .16  # keep only the outer face / drop the inner face; window recess depth
PIECES = []
bpy.ops.wm.read_factory_settings(use_empty=True)
def mat(n):
    if n in bpy.data.materials: return bpy.data.materials[n]
    h = PAL.get(COL[n], COL[n])
    c = [(lambda s: s / 12.92 if s <= .04045 else ((s + .055) / 1.055) ** 2.4)(int(h[i:i + 2], 16) / 255) for i in (1, 3, 5)]
    m = bpy.data.materials.new(n); m.use_nodes = True; p = m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = (*c, 1); p.inputs['Roughness'].default_value = .3 if 'glass' in n else .85
    if n == 'glass_shop': p.inputs['Alpha'].default_value = .4; m.blend_method = 'BLEND'
    if n == 'bulb': p.inputs['Emission Color'].default_value = (*c, 1); p.inputs['Emission Strength'].default_value = 4
    return m
class Piece:
    """bmesh builder. Facade coordinates: u along the facade, w outwards, v up (+oz). side 0 = front (Blender -Y,
    glTF +Z), side 1 = right side (+X). The footprint is x in [-W/2, W/2], y in [0, D] behind the front plane y=0."""
    def __init__(s, W=0.): s.bm, s.mats, s.W, s.side, s.oz = bmesh.new(), [], W, 0, 0.
    def mi(s, m):
        if m not in s.mats: s.mats.append(m)
        return s.mats.index(m)
    def hexa(s, m, pts, bev=0., drop=(), axis=None):
        vs = [s.bm.verts.new(p) for p in pts]; c = sum((v.co for v in vs), Vector()) / 8; fs = []
        for k, q in enumerate(QUADS):
            if k in drop: continue
            f = [vs[i] for i in q]
            if (f[1].co - f[0].co).cross(f[2].co - f[0].co).dot(sum((v.co for v in f), Vector()) / 4 - c) < 0: f.reverse()
            fs.append(s.bm.faces.new(f)); fs[-1].material_index = s.mi(m)
        for v in vs:
            if not v.link_faces: s.bm.verts.remove(v)
        if bev:
            es = [e for e in {e for f in fs for e in f.edges} if not axis or abs((e.verts[0].co - e.verts[1].co).normalized().dot(axis)) > .9]
            bmesh.ops.bevel(s.bm, geom=es, offset=bev, segments=2, profile=.5, affect='EDGES', clamp_overlap=True)
    def box(s, m, x0, x1, y0, y1, z0, z1, bev=0., drop=()):  # faces: 0 bottom 1 top 2 front(y0) 3 +x 4 back 5 -x
        s.hexa(m, [(x, y, z) for z in (z0, z1) for x, y in ((x0, y0), (x1, y0), (x1, y1), (x0, y1))], bev, drop)
    def P(s, u, w, v): return (-s.W / 2 + u, -w, v + s.oz) if s.side == 0 else (s.W / 2 + w, u, v + s.oz)
    def F(s, m, u0, u1, w0, w1, v0, v1, bev=0., drop=(), along=None):  # along='u' / 'v': bevel only the edges on that axis
        axis = along and (Vector((0, 0, 1)) if along == 'v' else (Vector(s.P(1, 0, 0)) - Vector(s.P(0, 0, 0))).normalized())
        s.hexa(m, [s.P(u, w, v) for v in (v0, v1) for u, w in ((u0, w0), (u1, w0), (u1, w1), (u0, w1))], bev, drop, axis)
    def prism(s, m, u0, u1, ring): s.hexa(m, [s.P(u, w, v) for u in (u0, u1) for w, v in ring])  # (w, v) profile along u
    def cyl(s, m, x, y, z0, z1, r0, r1=None, n=8):
        out = bmesh.ops.create_cone(s.bm, cap_ends=True, segments=n, radius1=r0, radius2=r0 if r1 is None else r1,
                                    depth=z1 - z0, matrix=Matrix.Translation((x, y, (z0 + z1) / 2)))
        for f in {f for v in out['verts'] for f in v.link_faces}: f.material_index = s.mi(m)
    def blob(s, m, x, y, z, r):  # low-poly foliage lump (80 triangles)
        out = bmesh.ops.create_icosphere(s.bm, subdivisions=2, radius=r, matrix=Matrix.Translation((x, y, z)) @ Matrix.Diagonal((1, 1, .8, 1)))
        for f in {f for v in out['verts'] for f in v.link_faces}: f.material_index = s.mi(m)
    def done(s, name):
        me = bpy.data.meshes.new(name); s.bm.to_mesh(me); s.bm.free()
        for m in s.mats: me.materials.append(mat(m))
        me.shade_smooth(); me.set_sharp_from_angle(angle=math.radians(50))
        o = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(o)
        o.modifiers.new('wn', 'WEIGHTED_NORMAL').keep_sharp = True
        PIECES.append(o)
def windows(p, L, FH, cs, wall, trim, sash, style, ww=1.1, wh=1.9, s=.85, door=None):
    """One floor of skin with recessed windows (glass 14 cm in), sash cross, sill and lintel or brownstone hood."""
    t = s + wh
    def piers(cols, v0, v1):
        e = [0] + [x for c in cols for x in (c - ww / 2, c + ww / 2)] + [L]
        for a, b in zip(e[::2], e[1::2]): p.F(wall, a, b, -R, 0, v0, v1, drop=BACK)
    piers([c for i, c in enumerate(cs) if i == door], 0, s); piers(cs, s, t); p.F(wall, 0, L, -R, 0, t, FH, drop=BACK)
    for i, c in enumerate(cs):
        a, b, lo = c - ww / 2, c + ww / 2, 0 if i == door else s
        if i == door:
            p.F('wood', a, b, -R, -.14, 0, t - .5, drop=FRONT); p.F('glass', a, b, -R, -.14, t - .5, t, drop=FRONT)
        else:
            p.F('glass', a, b, -R, -.14, s, t, drop=FRONT); p.F(sash, c - .03, c + .03, -.14, -.1, s, t)
            p.F(sash, a, b, -.14, -.1, s + wh * .55, s + wh * .55 + .06); p.F(trim, a - .1, b + .1, 0, .08, s - .1, s, bev=.02, along='u')
        if style == 'lintel': p.F(trim, a - .12, b + .12, 0, .05, t, t + .3)  # unbevelled: keeps a 7-floor corner under 8k
        if style == 'hood':
            for q in (a - .14, b): p.F(wall, q, q + .14, 0, .06, lo, t)
            p.F(wall, a - .14, b + .14, 0, .06, t, t + .3); p.F(wall, a - .25, b + .25, 0, .18, t + .3, t + .45, bev=.02, along='u')  # narrower: neighbours' hoods must not overlap
def articulate(p, L, H, pil, corner=False):
    """Vertical articulation: end pilasters (corners bevelled 5 cm) and a downpipe."""
    p.F(pil, 0, .4, 0, .08, 0, H, bev=.05, along='v'); p.F(pil, L - .4, L + (.08 if corner else 0), 0, .08, 0, H, bev=.05, along='v')
    x, y, z = p.P(L - .6, .08, 0); p.cyl('metal_dark', x, y, z, z + H, .055, n=6)
def ground(p, u0, u1, G, pier, frame, cap='trim_cream', awn=None, dx=None, fascia=None, inside='shop', k=2.6):
    """Shopfront between two piers: 0.6 m bulkhead plinth, see-through glass, mullions, transom, recessed door,
    lit interior (back wall, ceiling, counter / shelves or washers), sign fascia, storefront cornice, awning."""
    a, b, h = u0 + .45, u1 - .45, G - 1.0
    for q in (u0, b): p.F(pier, q, q + .45, -k, .05, 0, G - .16, bev=.04, along='v'); p.F('base_stone', q - .01, q + .46, 0, .1, 0, .6)
    p.F(fascia or frame, a, b, -.3, .06, h, G - .16); p.F(cap, u0, u1, 0, .2, G - .16, G, bev=.02)
    p.F('interior', a, b, -k, -.3, h - .05, h, drop=(1, 2, 3, 4, 5)); p.F('interior', a, b, -k, -k + .1, 0, h, drop=FRONT)
    p.F('wood', a, b, -k, -.3, 0, .03, drop=(0, 2, 3, 4, 5))
    for g0, g1 in [(a, b)] if dx is None else [(a, dx), (dx + 1.1, b)]:
        p.F(frame, g0, g1, -.3, 0, 0, .6); p.F('glass_shop', g0, g1, -.32, -.3, .6, h, drop=FRONT)
        n = max(1, round((g1 - g0) / 1.6))
        for i in range(n + 1): u = g0 + (g1 - g0) * i / n; p.F(frame, u - .05, u + .05, -.34, -.22, .6, h)
        p.F(frame, g0, g1, -.34, -.22, h - .5, h - .42)
    if dx is not None:
        p.F('door_green' if frame != 'door_green' else 'wood', dx, dx + 1.1, -.9, -.84, 0, h - .5)
        p.F('glass', dx + .2, dx + .9, -.84, -.82, 1.0, h - 1.0, drop=FRONT); p.F('glass_shop', dx, dx + 1.1, -.32, -.3, h - .5, h, drop=FRONT)
        for q in (dx - .06, dx + 1.1): p.F(frame, q, q + .06, -.9, -.3, 0, h)
    if inside == 'laundry':
        for i in range(int((b - a - .4) / .8)):
            x = a + .3 + i * .8; p.F('trim_cream', x, x + .7, -k + .1, -k + .75, 0, .95)
            p.F('glass', x + .17, x + .53, -k + .75, -k + .77, .35, .75, drop=FRONT)
    else:
        p.F('trim_dark', a + .5, (a + b) / 2, -1.9, -1.4, 0, 1.0)
        for z in (1.1, 1.7): p.F('wood', a + .2, b - .2, -k + .1, -k + .4, z, z + .05)
    if awn:
        p.prism(awn, a - .1, b + .1, [(0, h + .2), (1.5, h - .6), (1.5, h - .55), (0, h + .25)])
        p.F(awn, a - .1, b + .1, 1.46, 1.5, h - .9, h - .6)
        for q in (a - .1, b + .07): p.prism(awn, q, q + .03, [(0, h + .2), (1.5, h - .6), (1.5, h - .9), (0, h - .2)])
def body(p, W, D, z1, corner=False, y0=R, drop=(0, 1, 2), z0=0):
    p.box(p.wall, -W / 2, W / 2 - (R if corner else 0), y0, D, z0, z1, drop=drop + ((3,) if corner else ()))
def top(p, L, D, trim, brackets=True, corner=False, h=1.2):
    """Roof storey: parapet skin, frieze, brackets, 50 cm crown cornice, coping, side/back parapets, roof."""
    x0, x1 = -p.W / 2, p.W / 2 - (R if corner else 0)
    for side, n in ((0, L), (1, D)) if corner else ((0, L),):
        p.side = side; p.F(p.wall, R * side, n, -R, 0, 0, h, drop=BACK); p.F(trim, 0, n, 0, .06, .1, .6)
        if brackets:
            for i in range(int(n / 1.1)): u = .55 + i * 1.1; p.F(trim, u - .09, u + .09, .06, .42, .15, .62)
        p.F(trim, 0, n + (.5 if corner and side == 0 else 0), 0, .5, .62, .82, bev=.02); p.F(trim, 0, n, -R - .1, .03, h, h + .08)
    p.side = 0; p.box('roof', x0, x1, R, D, 0, h - .35, drop=(0, 2, 3, 4, 5))
    for xa, xb, ya in ((x0, x0 + .25, R), (x1 - .25, x1, R), (x0, x1, D - .25)):
        p.box(p.wall, xa, xb, ya, D, 0, h, drop=(0,))
def stack(name, W, D, wall, base, mid, roof):
    for part, make in (('base', base), ('mid', mid), ('top', roof)):
        p = Piece(W); p.wall = wall; make(p); p.done(f'{name}_{part}')
def fire_escape(p, u0, u1, FH, m='metal_dark', stair=True):  # stair=False: the top landing (roof piece)
    p.F(m, u0, u1, .1, 1.2, -.07, 0)
    for v in (.5, 1.0): p.F(m, u0, u1, 1.15, 1.2, v - .04, v)
    for i in range(int((u1 - u0) / .5) + 1): u = u0 + i * (u1 - u0) / int((u1 - u0) / .5); p.F(m, u - .02, u + .02, 1.15, 1.19, 0, 1.0)
    for u in (u0, u1 - .04): p.F(m, u, u + .04, .1, 1.2, .96, 1.0)
    a, b = u0 + .5, u0 + 3.1
    for w0, w1, lift, th in ((.3, .8, 0, .08), (.78, .82, .9, .04)) if stair else ():  # sloped stair to the platform above, its handrail
        p.hexa(m, [p.P(u, w, v) for w in (w0, w1) for u, v in ((a, lift), (b, FH + lift), (b, FH + lift + th), (a, lift + th))])
def tank(p, x, y, z):
    for dx, dy in ((-.7, -.7), (.7, -.7), (.7, .7), (-.7, .7)): p.box('metal_dark', x + dx - .06, x + dx + .06, y + dy - .06, y + dy + .06, z, z + 1.6)
    p.box('metal_dark', x - .95, x + .95, y - .95, y + .95, z + 1.6, z + 1.72)
    p.cyl('wood', x, y, z + 1.72, z + 3.6, 1.0, n=10); p.cyl('trim_dark', x, y, z + 3.6, z + 4.2, 1.08, 0, n=10)
def walkup_mid(p):
    windows(p, 8, 3.2, [1.93, 4, 6.07], p.wall, 'trim_cream', 'trim_cream', 'lintel')
    articulate(p, 8, 3.2, p.wall); fire_escape(p, .9, 5.0, 3.2); body(p, 8, 13, 3.2)
def walkup_top(p): top(p, 8, 13, 'trim_dark'); tank(p, -1.5, 8, .85); fire_escape(p, .9, 5.0, 3.2, stair=False)
def corner_side(p, L, D, G, pier, frame, awn):  # limestone / office: shopfront on the side street too
    cap = 'trim_cream' if awn else pier
    p.side = 1; p.F('base_stone', 0, 2.65, 0, .1, 0, .6); p.F(pier, 0, 2.65, 0, .05, .6, G - .16); p.F(cap, -.2, 2.65, 0, .2, G - .16, G, bev=.02)
    ground(p, 2.65, D, G, pier, frame, awn=awn, cap=cap); p.side = 0
    p.box(p.wall, -L / 2, L / 2 - 2.6, 2.6, D, 0, G, drop=(0, 1, 2))
def limestone_mid(p):
    windows(p, 9, 3.2, [1.7, 4.5, 7.3], p.wall, 'trim_cream', 'trim_dark', 'lintel'); articulate(p, 9, 3.2, p.wall, True)
    p.side = 1; windows(p, 13, 3.2, [2.5, 5.8, 9.1, 12.0], p.wall, 'trim_cream', 'trim_dark', 'lintel', ww=1.0)
    articulate(p, 13, 3.2, p.wall); p.side = 0; body(p, 9, 13, 3.2, True)
def office_mid(p, FH=3.6):
    for side, L in ((0, 14), (1, 15)):
        p.side = side; p.F('glass', 0, L, -.25, -.2, 0, FH, drop=FRONT); p.F('metal_dark', 0, L, -.2, .04, 0, .9)
        n = round(L / 1.5)
        for i in range(n + 1): u = L * i / n; p.F('metal_dark', u - .05, u + .05, -.2, .14, 0, FH)
        for u in (0, L / 2 - .45, L - .9): p.F(p.wall, u, u + .9 + (.12 if side == 0 and u > L / 2 else 0), -.25, .12, 0, FH, bev=.05, along='v')
    p.side = 0; p.box(p.wall, -7, 7 - .25, .25, 15, 0, FH, drop=(0, 1, 2, 3))
def office_base(p, G=4.6):
    ground(p, 0, 7, G, p.wall, 'metal_dark', cap=p.wall, dx=3.0); ground(p, 7, 14, G, p.wall, 'metal_dark', cap=p.wall)
    p.F('metal_dark', 2.4, 4.7, 0, 1.8, 3.25, 3.45, bev=.02); corner_side(p, 14, 15, G, p.wall, 'metal_dark', None)
def theater_base(p, L=11, G=5.2):
    for q in (0, 9.6): p.F(p.wall, q, q + 1.4, -1.5, .08, 0, 3.0, bev=.05, along='v'); p.F('base_stone', q - .01, q + 1.41, 0, .12, 0, .6)
    for q in (.3, 9.9): p.F('trim_dark', q, q + .8, .08, .12, 1.0, 2.6); p.F('sign_cream', q + .08, q + .72, .12, .13, 1.08, 2.52)
    p.F(p.wall, 0, L, -R, 0, 3.0, G, drop=BACK); p.F('interior', 1.4, 9.6, -1.4, -R, 2.95, 3.0, drop=(1, 2, 3, 4, 5))
    p.F('interior', 1.4, 9.6, -1.5, -1.4, 0, 3.0, drop=FRONT)
    for i in range(4):
        u = 1.75 + i * 2.0; p.F('door_red', u, u + 1.5, -1.4, -1.34, 0, 2.6); p.F('glass', u + .25, u + 1.25, -1.34, -1.32, 1.1, 2.3, drop=FRONT)
    p.F('trim_cream', 4.9, 6.1, -.9, .1, 0, 1.0); p.F('glass', 4.9, 6.1, -.9, .1, 1.0, 2.2); p.F('sign_wine', 4.8, 6.2, -1.0, .2, 2.2, 2.45, bev=.02)
    p.F('sign_cream', 1.0, 10.0, 0, 2.6, 3.4, 4.6, bev=.03)
    for v0, v1 in ((3.25, 3.4), (4.6, 4.8)): p.F('sign_wine', .95, 10.05, 0, 2.7, v0, v1, bev=.02)
    for i in range(30): u = 1.15 + i * .3; p.F('bulb', u - .05, u + .05, 2.7, 2.76, 4.66, 4.74); p.F('bulb', u - .05, u + .05, 2.7, 2.76, 3.29, 3.37)
    theater_blade(p, 4.8, G); body(p, L, 16, 3.0, y0=1.5); body(p, L, 16, G, z0=3.0)
def theater_blade(p, v0, v1):  # vertical blade sign with bulbs along its edge
    p.F('sign_wine', 5.3, 5.7, .08, 1.3, v0, v1)
    for v in [v0 + .2 + .4 * i for i in range(int((v1 - v0) / .4))]: p.F('bulb', 5.45, 5.55, 1.3, 1.36, v, v + .1)
def theater_mid(p):
    windows(p, 11, 3.6, [3.1, 7.9], p.wall, 'trim_cream', 'trim_dark', 'lintel', ww=1.4, wh=2.3)
    articulate(p, 11, 3.6, p.wall); theater_blade(p, 0, 3.6); body(p, 11, 16, 3.6)
def theater_top(p):
    top(p, 11, 16, 'trim_cream', brackets=False); p.F(p.wall, 3.5, 7.5, -R, .0, 1.2, 2.2)
    p.F('trim_cream', 3.4, 7.6, -R - .1, .05, 2.2, 2.3, bev=.02)
def brownstone_base(p, L=6.5, c=4.82, n=9):
    p.F('base_stone', 0, L, 0, .06, 0, .5); windows(p, L, 1.9, [1.68, 3.25], p.wall, p.wall, 'trim_cream', 'lintel', ww=1.0, wh=.9, s=.65)
    p.oz = 1.9; windows(p, L, 3.6, [1.68, 3.25, c], p.wall, p.wall, 'trim_cream', 'hood', wh=2.5, s=.5, door=2); p.oz = 0
    for k in range(n): p.F(p.wall, c - .8, c + .8, (n - k - 1) * .28, (n - k) * .28, 0, (k + 1) * 1.9 / n)
    for q in (c - 1.05, c + .8):
        p.prism(p.wall, q, q + .25, [(0, 0), (n * .28 + .1, 0), (n * .28 + .1, .9), (0, 2.8)])
        p.F(p.wall, q - .05, q + .3, n * .28 - .1, n * .28 + .25, 0, 1.15, bev=.03)
    for v in (.1, .95): p.F('metal_dark', 0, c - 1.15, 1.1, 1.14, v, v + .05)
    for i in range(int((c - 1.15) / .18)): p.F('metal_dark', .1 + i * .18, .13 + i * .18, 1.105, 1.135, 0, 1.0)
    articulate(p, L, 5.5, p.wall); body(p, L, 13, 5.5)
def brownstone_mid(p):
    windows(p, 6.5, 3.0, [1.68, 3.25, 4.82], p.wall, p.wall, 'trim_cream', 'hood', ww=1.0, wh=1.8, s=.7)
    articulate(p, 6.5, 3.0, p.wall); body(p, 6.5, 13, 3.0)
def laundry_blade(p, G):  # projecting sign on the left pier, its bracket rod
    p.F('sign_navy', .16, .28, .3, 1.15, G + .2, G + 1.7, bev=.02); p.F('sign_cream', .155, .285, .4, 1.05, G + .3, G + 1.6)
    for v in (G + .1, G + 1.7): p.F('metal_dark', .19, .25, 0, 1.2, v, v + .06)
def props():
    p = Piece(); p.cyl('metal_dark', 0, 0, 0, .5, .2, .16); p.cyl('metal_dark', 0, 0, .5, 3.7, .07, .06)
    p.cyl('metal_dark', 0, 0, 3.7, 3.8, .16); p.cyl('bulb', 0, 0, 3.8, 4.25, .2, .24); p.cyl('metal_dark', 0, 0, 4.25, 4.5, .3, 0)
    p.done('prop_lamp')
    p = Piece(); p.cyl('hydrant', 0, 0, 0, .08, .2); p.cyl('hydrant', 0, 0, .08, .6, .13); p.cyl('hydrant', 0, 0, .6, .75, .15, .05)
    p.box('hydrant', -.22, .22, -.05, .05, .36, .48, bev=.02); p.done('prop_hydrant')
    p = Piece()
    for x in (-.75, .75): p.box('metal_dark', x - .03, x + .03, -.22, .22, 0, .43); p.box('metal_dark', x - .03, x + .03, .2, .24, .43, .85)
    for y in (-.2, -.06, .08): p.box('wood', -.9, .9, y, y + .12, .43, .47, bev=.015)
    for z in (.55, .72): p.box('wood', -.9, .9, .24, .28, z, z + .1, bev=.015)
    p.done('prop_bench')
    p = Piece(); p.cyl('metal_dark', 0, 0, 0, .9, .26, .3, n=10); p.cyl('metal_dark', 0, 0, .9, .95, .32, n=10); p.done('prop_bin')
    p = Piece(); p.box('metal_dark', -.2, .2, -.18, .18, 0, .3); p.box('sign_navy', -.25, .25, -.22, .22, .3, 1.05, bev=.02); p.done('prop_newsbox')
    p = Piece(); p.cyl('trunk', 0, 0, 0, 2.6, .12, .08, n=6); p.box('trunk', -.65, .65, -.65, .65, 0, .03)
    for x, y, z, r in ((0, 0, 3.4, 1.15), (.75, .2, 2.85, .85), (-.65, -.3, 2.95, .85), (.1, .6, 3.85, .7), (-.2, -.5, 3.8, .65)): p.blob('leaf', x, y, z, r)
    p.done('prop_tree')
# name: width, depth, wall, base, mid, top, (ground height, floor height, preview mid count) - block.ts mirrors the numbers
KIT = {
    'walkup': (8, 13, 'wall_redbrick', lambda p: (ground(p, 0, 8, 4.0, p.wall, 'trim_dark', awn='awning_terra', dx=6.0),
               p.cyl('metal_dark', *p.P(7.4, .08, 0)[:2], 0, 4.0, .055, n=6), body(p, 8, 13, 4.0, y0=2.6)), walkup_mid, walkup_top, (4.0, 3.2, 4)),
    'brownstone': (6.5, 13, 'wall_brownstone', brownstone_base, brownstone_mid, lambda p: top(p, 6.5, 13, 'trim_dark'), (5.5, 3.0, 2)),
    'limestone': (9, 13, 'wall_limestone', lambda p: (ground(p, 0, 9, 4.2, p.wall, 'door_green', awn='awning_green', dx=7.15),
                  corner_side(p, 9, 13, 4.2, p.wall, 'door_green', 'awning_green')), limestone_mid,
                  lambda p: top(p, 9, 13, 'trim_cream', corner=True), (4.2, 3.2, 4)),
    'office': (14, 15, 'wall_limestone', office_base, office_mid, lambda p: top(p, 14, 15, p.wall, brackets=False, corner=True), (4.6, 3.6, 3)),
    'theater': (11, 16, 'wall_limestone', theater_base, theater_mid, theater_top, (5.2, 3.6, 1)),
    'laundry': (7, 12, 'wall_tanbrick', lambda p: (ground(p, 0, 7, 4.2, 'trim_blue', 'trim_blue', fascia='sign_navy', dx=4.6, inside='laundry'),
                laundry_blade(p, 4.2), body(p, 7, 12, 4.2, y0=2.6)), lambda p: (windows(p, 7, 3.1, [2.0, 5.0], p.wall, 'trim_cream', 'trim_cream', 'lintel', ww=1.2),
                articulate(p, 7, 3.1, p.wall), body(p, 7, 12, 3.1)), lambda p: top(p, 7, 12, 'trim_cream'), (4.2, 3.1, 3)),
}
for name, (W, D, wall, base, mid, roof, _) in KIT.items(): stack(name, W, D, wall, base, mid, roof)
props()
# Vertex-colour AO, baked per piece over a ground plane (Cycles CPU), remapped to 0.6..1 so it shades without blackening.
scene = bpy.context.scene; scene.render.engine = 'CYCLES'; scene.cycles.device = 'CPU'; scene.cycles.samples = 24
scene.world = bpy.data.worlds.new('sky'); scene.world.light_settings.distance = 2.0
g = Piece(); g.box('base_stone', -80, 80, -80, 80, -.2, 0); g.done('ground'); ground_obj = PIECES.pop()
for o in PIECES:
    o.data.color_attributes.active_color = o.data.color_attributes.new('AO', 'BYTE_COLOR', 'POINT')
    for q in PIECES: q.hide_render = q is not o
    ground_obj.hide_render = not o.name.endswith('_base') and not o.name.startswith('prop')  # upper floors: no ground band
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o
    bpy.ops.object.bake(type='AO', target='VERTEX_COLORS')
    for d in o.data.color_attributes['AO'].data: v = .6 + .4 * d.color[0]; d.color = (v, v, v, 1)
for o in PIECES: o.hide_render = False; o.select_set(True)
ground_obj.select_set(False)
raw, out = Path('/tmp/c067-buildings-raw.glb'), ROOT / 'src/assets/buildings.glb'
bpy.ops.export_scene.gltf(filepath=str(raw), export_format='GLB', use_selection=True, export_apply=True, export_texcoords=False,
                          export_vertex_color='ACTIVE', export_yup=True)
subprocess.run(['npx', '--no-install', 'gltf-transform', 'meshopt', str(raw), str(out)], cwd=ROOT, check=True)
tris = {o.name: sum(len(f.vertices) - 2 for f in o.data.polygons) for o in PIECES}
for name, (*_, (G, FH, n)) in KIT.items():
    b, m, t = (tris[f'{name}_{k}'] for k in ('base', 'mid', 'top'))
    print(f'C067 {name}: base {b} mid {m} top {t} -> {n + 1} floors {b + n * m + t}, 7 floors {b + 6 * m + t} triangles')
print('C067 props', {k: v for k, v in tris.items() if k.startswith('prop')}, f'GLB {out.stat().st_size / 1024:.0f} KB')
if '--no-render' not in sys.argv:  # previews: AO multiplied into the base colour, sun from the front left
    for m in bpy.data.materials:
        nt = m.node_tree; a = nt.nodes.new('ShaderNodeAttribute'); a.attribute_name = 'AO'; bsdf = nt.nodes['Principled BSDF']
        mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'; mx.blend_type = 'MULTIPLY'; mx.inputs[0].default_value = 1
        mx.inputs[6].default_value = bsdf.inputs['Base Color'].default_value
        nt.links.new(a.outputs['Color'], mx.inputs[7]); nt.links.new(mx.outputs[2], bsdf.inputs['Base Color'])
    scene.world.use_nodes = True; scene.world.node_tree.nodes['Background'].inputs[0].default_value = (.55, .68, .85, 1)
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); scene.collection.objects.link(sun)
    sun.data.energy = 3.5; sun.data.angle = .05; sun.rotation_euler = (math.radians(50), 0, math.radians(-30))
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); scene.collection.objects.link(cam); scene.camera = cam
    cam.data.lens = 35; scene.render.resolution_x, scene.render.resolution_y = 640, 800; scene.cycles.samples = 16
    scene.cycles.use_denoising = True; scene.view_settings.view_transform = 'Standard'
    for o in PIECES: o.hide_render = True
    for name, (W, D, *_, (G, FH, n)) in KIT.items():
        shown = [bpy.data.objects[f'{name}_base']] + [bpy.data.objects[f'{name}_mid'].copy() for _ in range(n)] + [bpy.data.objects[f'{name}_top']]
        for i, o in enumerate(shown):
            if o.name not in scene.collection.objects: scene.collection.objects.link(o)
            o.location.z = 0 if i == 0 else G + (i - 1) * FH; o.hide_render = False
        H = G + n * FH + 1.2; d = max(H * 1.2, W * 1.5)
        for view, ang in (('front', 0), ('45', 45)):
            aim = Vector((0, 0, H * .45)); cam.location = aim + Vector((d * math.sin(math.radians(ang)), -d * math.cos(math.radians(ang)), -H * .2))
            cam.rotation_euler = (aim - cam.location).to_track_quat('-Z', 'Y').to_euler()
            scene.render.filepath = str(ROOT / f'.shots/c067-{name}-{view}.png'); bpy.ops.render.render(write_still=True)
        for o in shown: o.hide_render = True
