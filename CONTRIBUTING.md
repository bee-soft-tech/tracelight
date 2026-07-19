# Contributing to Tracelight

Thanks for your interest in improving Tracelight! Contributions are welcome.

## Ground rules

- **`main` is protected.** All changes land through a **pull request** that must pass CI and be
  **reviewed and approved** before it can be merged. Direct pushes to `main` are rejected.
- Keep pull requests focused; one logical change per PR is easier to review.
- By submitting a contribution you agree to license it under the project's
  [Apache License 2.0](LICENSE).

## Workflow

1. Fork the repository (or create a branch if you have write access).
2. Create a topic branch: `git checkout -b feature/my-change`.
3. Make your change, with tests where it makes sense.
4. Run the checks locally (see below) — they must be green.
5. Open a pull request against `main` and fill in what/why.

## Local development

Requirements:

- **Java 17+** — the build uses the Gradle wrapper (Gradle 8.7 is fetched automatically; always use
  `./gradlew`, not a system Gradle).
- **Node 18+ / npm** — the frontend uses npm **workspaces** (no pnpm/yarn).
- **Python 3.9+** — only for the `tracelight-load` load generator.

Build and test everything:

```bash
# JVM libraries + demo apps
./gradlew build

# Frontend library + web demo
npm ci
npm --workspace @tracelight/react test   # vitest
npm run build
```

## Reporting bugs / requesting features

Use the GitHub issue templates under **Issues**. Please include reproduction steps, the Spring
integration you use (MVC vs WebFlux), and versions.
