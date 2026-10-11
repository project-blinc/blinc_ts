# Original font fixtures

These geometric ASCII fonts and their outlines were authored for this repository
and are covered by its Apache-2.0 license. They contain no third-party font data.
Different advances and outlines distinguish regular, bold and italic faces.

Regenerate them with Python, `fonttools[woff]` and `brotli`:

```sh
python tests/fixtures/fonts/generate.py
```

The checked-in bytes keep native tests independent of system fonts and Python
packages. `regular.woff2` contains the same face as `regular.ttf`.
