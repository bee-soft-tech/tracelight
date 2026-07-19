# Screenshots for the main README

The root `README.md` references the images below. Drop PNGs with these exact names here
(~1600 px wide so the graph stays crisp).

| File | What to capture |
|---|---|
| `graph-webgl.png` | The `<TraceGraph>` (WebGL) under live traffic — populated graph, per-edge `min / avg / max` labels, and a red exception node. **Light** mode. |
| `dark-mode.png` | The same graph in **dark** mode (toolbar 🌙 toggle, or set your OS to dark). |
| `replay.png` | **Record & replay** review mode — the review bar visible and the slow-motion dot mid-hop. **Dark** mode so the dot is legible. |

## How to capture

1. Start everything:
   ```bash
   ./gradlew :tracelight-demo-app:bootRun          # backend :8080
   npm run dev -w tracelight-web                    # frontend :5173
   python -m tracelight_load --url http://localhost:8080 --rps 20   # traffic
   ```
2. Open http://localhost:5173, pick a route (e.g. `POST /order`) and let the graph populate; use the
   **⏱ timings** and **dark-mode** toggles to set up the first two shots. **Fit view** first.
3. For `replay.png`: click **● Record**, let some traffic run, click **■ Stop**, step to a
   `POST /order` request, **🐢 Play** at ¼×, and capture while the dot is on a slow hop.
4. Save each PNG here under the name from the table above (1600×950 works well).
