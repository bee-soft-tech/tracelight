# tracelight-load

Randomized traffic generator for the Tracelight demo app. Hits `/order` (with valid,
premium, high-value and invalid variants) and `/search`, so every branch in the demo
lights up on the graph.

## Run

```bash
cd tracelight-load
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

python -m tracelight_load --url http://localhost:8080 --rps 20
```

Options:

| Flag | Default | Meaning |
|---|---|---|
| `--url` | `http://localhost:8080` | base URL of the demo app |
| `--rps` | `10` | target requests per second |
| `--duration` | `0` | seconds to run (`0` = until Ctrl-C) |
