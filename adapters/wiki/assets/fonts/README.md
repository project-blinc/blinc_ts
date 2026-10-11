# Wiki font

`wiki-mono.woff2` is an ASCII subset of `FiraCode-Regular.ttf` from
[Blinc's font assets](https://github.com/project-blinc/Blinc/tree/main/assets/fonts).
Copyright 2014–2021 The Fira Code Project Authors.
The font is distributed under the SIL Open Font License 1.1; see
[OFL-FiraCode.txt](OFL-FiraCode.txt) for the full license.

It was generated with FontTools:

```sh
pyftsubset FiraCode-Regular.ttf --output-file=wiki-mono.woff2 --flavor=woff2 \
  --unicodes=U+0020-007E --name-IDs='0,1,2,3,4,5,6,13,14,16,17' \
  --name-legacy --name-languages='*'
```
