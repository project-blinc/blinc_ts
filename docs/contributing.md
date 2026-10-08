# Code conventions

Use the pinned tool versions from `package-lock.json` and Node.js 22.13+.

```sh
npm ci
npm run check
```

## Formatting and linting

```sh
npm run format        # format code, configuration and Markdown
npm run format:check  # verify formatting
npm run lint         # check code; warnings fail
npm run lint:fix     # apply safe lint fixes
```

Prettier owns whitespace: two spaces, single quotes, semicolons, trailing commas,
100-column wrapping and LF endings. EditorConfig and the recommended VS Code
extensions provide the same defaults while editing.

ESLint uses flat configuration, recommended JavaScript checks and
typescript-eslint's recommended and stylistic type-aware rules. The project
service reads the same TypeScript configuration as the compiler. Rules check
unhandled promises, unsafe values, unused bindings, exhaustive switches,
type imports, strict equality and braced control flow.

Prettier and ESLint run separately, with `eslint-config-prettier` preventing
formatting conflicts. This follows
[Prettier's integration guidance](https://prettier.io/docs/integrating-with-linters)
and [typescript-eslint's typed linting setup](https://typescript-eslint.io/getting-started/typed-linting/).

Generated native bindings are type checked and formatted by the generation
script; lint rules target authored code. Change the generator rather than
editing generated bindings. Build output, captures and temporary fixtures are
excluded. The TypeScript version stays within typescript-eslint's supported
range; upgrade them together.

CI runs type checking, linting, formatting and tests on Node 22 and 24.

## Native and visual changes

Run `npm run test:native` after native changes. For renderer or motion changes,
capture representative scenes, inspect the PNGs or frame viewer, and compare
against a reviewed baseline. Keep the capture and diff artifacts when diagnosing
a failure. See [snapshots](snapshots.md) and [performance](performance.md).

Platform execution gates currently run locally. Native CI needs published
revisions of the new binding target before it can check out and build the same
dependency set.

## Issue tracking

Use git-bug for implementation work, defects and follow-up tasks. Keep a concrete
scope and validation criteria in each issue, record implementation and test
results in comments, and close it only when that scope is complete.

```sh
git bug bug --format plain
git bug bug new --non-interactive --title 'Short title' --message 'Scope and acceptance checks'
git bug bug label new ISSUE area:layout priority:high
git bug bug comment new ISSUE --non-interactive --message 'Implementation and verification results'
git bug bug status close ISSUE
```

Use `area:abi`, `area:reactive`, `area:layout`, `area:render`, `area:debug`,
`area:style`, `area:theme`, `area:ui` or `area:docs` to identify the area. Use
`bug`, `perf` and `priority:high` when applicable. `git bug user` shows the active
identity. Provide `--message` for issue bodies; `--file` expects both the title
and body and can replace a separately supplied title.

Synchronize tracking refs alongside source changes using the repository's
configured Git credentials:

```sh
git push origin 'refs/bugs/*:refs/bugs/*' 'refs/identities/*:refs/identities/*'
```
