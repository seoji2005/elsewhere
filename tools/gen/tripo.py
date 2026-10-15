# Tripo API batch (official SDK tripo3d 1.x, MIT) on a GitHub runner; TRIPO_API_KEY is a repo secret.
# .tripo-jobs.json: {"opts": {...defaults}, "jobs": [{"id": "bench", "image": "bench.png" | "prompt": "...", "opts": {...}}]}
# Images live in .tripo-in/. Writes out/<id>/*.glb and out/report.json (status, seconds, credits per task, balance).
import asyncio, json, os, sys, time
from tripo3d import TripoClient, TaskStatus

out = sys.argv[1]
spec = json.load(open(".tripo-jobs.json"))
base = {"model_version": "v3.1-20260211", "texture": True, "pbr": False} | spec.get("opts", {})
gate = asyncio.Semaphore(4)  # API allows 5-10 queued tasks


async def run(c, job):
    o = base | job.get("opts", {})
    d = os.path.join(out, job["id"])
    os.makedirs(d, exist_ok=True)
    t = time.time()
    async with gate:
        if "image" in job:
            tid = await c.image_to_model(image=os.path.join(".tripo-in", job["image"]), **o)
        else:
            tid = await c.text_to_model(prompt=job["prompt"], **{k: v for k, v in o.items() if k != "texture_alignment"})
        task = await c.wait_for_task(tid)
    files = await c.download_task_models(task, d) if task.status == TaskStatus.SUCCESS else {}
    names = sorted({os.path.basename(p) for p in files.values() if p})
    print(job["id"], task.status.value, names, round(time.time() - t), "s", flush=True)
    return {"id": job["id"], "task": tid, "status": task.status.value, "files": names, "sec": round(time.time() - t)}


async def main():
    os.makedirs(out, exist_ok=True)
    async with TripoClient(api_key=os.environ["TRIPO_API_KEY"]) as c:
        before = await c.get_balance()
        print("balance", before.balance, "frozen", before.frozen, flush=True)
        res = await asyncio.gather(*(run(c, j) for j in spec["jobs"]), return_exceptions=True)
        res = [r if isinstance(r, dict) else {"id": j["id"], "status": "error", "error": str(r)[:300]} for j, r in zip(spec["jobs"], res)]
        for r in res:
            if r["status"] == "error":
                print(r["id"], "error", r["error"], flush=True)
        await asyncio.sleep(5)
        used = {u.task_id: u.credits_consumed for u in await c.get_usage(limit=len(res) + 10)}
        for r in res:
            r["credits"] = used.get(r.get("task"))
        after = await c.get_balance()
        print("balance", after.balance, "spent", before.balance - after.balance, flush=True)
        json.dump({"before": before.balance, "after": after.balance, "opts": base, "jobs": res}, open(os.path.join(out, "report.json"), "w"), indent=1)


asyncio.run(main())
