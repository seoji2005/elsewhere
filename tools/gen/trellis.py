# Image -> textured GLB with the public TRELLIS.2 Space (MIT), run on GitHub Actions with HF_TOKEN.
# usage: python tools/gen/trellis.py <input.png> <outdir>   (.trellis.json optional: resolution, faces, texture)
import json, os, shutil, sys, time
from gradio_client import Client, handle_file
src, out = sys.argv[1], sys.argv[2]
opt = json.load(open(".trellis.json")) if os.path.exists(".trellis.json") else {}
os.makedirs(out, exist_ok=True)
c = Client("microsoft/TRELLIS.2", hf_token=os.environ.get("HF_TOKEN") or None, verbose=False)
t = time.time()
try: c.predict(api_name="/start_session")
except Exception as e: print("start_session:", str(e)[:120])
img = c.predict(handle_file(src), api_name="/preprocess_image")
img = img if isinstance(img, str) else img["path"]
c.predict(handle_file(img), int(opt.get("seed", 0)), str(opt.get("resolution", "1024")), api_name="/image_to_3d")
print("shape done", round(time.time() - t), "s")
glb, dl = c.predict(int(opt.get("faces", 30000)), int(opt.get("texture", 1024)), api_name="/extract_glb")
path = glb if isinstance(glb, str) else (glb or {}).get("path") or dl
shutil.copy(path, os.path.join(out, "model.glb"))
print("glb", os.path.getsize(os.path.join(out, "model.glb")), "bytes", round(time.time() - t), "s")
