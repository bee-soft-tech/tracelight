# Screenshots for the main README

The root `README.md` references the images below. Drop PNGs with these exact names here.

| File | What to capture |
|---|---|
| `graph-reactflow.png` | The default `<TraceGraph>` (React Flow) under live traffic — a node mid-pulse, a dot on an edge, the `min / avg / max` label visible. Light mode. |
| `graph-webgl.png` | The same graph with the **WebGL** renderer selected, ideally at high rps so dots fill the edges. |
| `dark-mode.png` | Either renderer in **dark mode** (toolbar 🌙 toggle, or set your OS to dark). |

## How to capture

1. Start everything:
   ```bash
   ./gradlew :tracelight-demo-app:bootRun          # backend :8080
   npm run dev -w tracelight-web                    # frontend :5173
   python -m tracelight_load --url http://localhost:8080 --rps 50   # traffic
   ```
2. Open http://localhost:5173, let the graph populate, then use the toolbar toggles
   (**React Flow / WebGL**, **dark mode**, **⏱ timings**) to set up each shot.
3. Screenshot the canvas (e.g. Chrome DevTools → capture node screenshot, or any OS tool)
   and save it here under the name from the table above.

Recommended width ~1600px so the graph stays crisp in the README.
